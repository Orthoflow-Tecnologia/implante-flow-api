import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dentistForAccessToken } from '../src/auth/dentist.js'
import { buildApp } from '../src/app.js'
import type { AppConfig } from '../src/config.js'
import { migrate } from '../src/db/migrate.js'
import { PgliteDatabase } from './pglite-database.js'

const config: AppConfig = {
  appEnv: 'test',
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  openApiEnabled: false,
  corsOrigins: [],
  serviceName: 'implante-flow-api',
  serviceVersion: '0.1.0',
  databaseUrl: null,
  workOs: null,
  s3: null,
}

test('relatório separa em dia, falta e atraso sem misturar dentistas', async () => {
  const database = await PgliteDatabase.create()
  await migrate(database)
  const ana = await dentistForAccessToken(database, { subject: 'user_ana', email: 'ana@example.com', name: 'Ana' })
  const bia = await dentistForAccessToken(database, { subject: 'user_bia', email: 'bia@example.com', name: 'Bia' })
  const app = await buildApp({
    config,
    database,
    clock: () => new Date('2026-10-19T15:00:00-03:00'),
    authenticate: async (authorization) => (authorization === 'Bearer bia' ? bia : ana),
  })
  const helena = await createPatient(app, 'ana', 'Helena')
  const ivo = await createPatient(app, 'ana', 'Ivo')
  const helenaProcedure = await createProcedure(app, 'ana', helena, [
    { scheduledOn: '2026-10-26', reason: 'controle' },
    { scheduledOn: '2026-10-10', reason: 'sutura' },
  ])
  const ivoProcedure = await createProcedure(app, 'ana', ivo, [
    { scheduledOn: '2026-10-01', reason: 'controle' },
    { scheduledOn: '2026-10-12', reason: 'reabertura' },
  ])
  await patchStatus(app, 'ana', followUpId(helenaProcedure, '2026-10-10'), 'realizado')
  await patchStatus(app, 'ana', followUpId(ivoProcedure, '2026-10-12'), 'faltou')
  const carla = await createPatient(app, 'bia', 'Carla')
  const carlaProcedure = await createProcedure(app, 'bia', carla, [{ scheduledOn: '2026-10-12', reason: 'controle' }])
  await patchStatus(app, 'bia', followUpId(carlaProcedure, '2026-10-12'), 'faltou')

  const summary = await app.inject({
    method: 'GET',
    url: '/v1/reports/summary?from=2026-10-01&to=2026-10-31',
    headers: { authorization: 'Bearer ana' },
  })
  assert.equal(summary.statusCode, 200)
  const totals = summary.json<{
    onTimePatients: number
    missedPatients: number
    overduePatients: number
    upcomingAppointments: number
    completedAppointments: number
    missedAppointments: number
    withoutOutcome: number
    attendancePercent: number | null
  }>()
  assert.deepEqual(totals, {
    onTimePatients: 1,
    missedPatients: 1,
    overduePatients: 1,
    upcomingAppointments: 1,
    completedAppointments: 1,
    missedAppointments: 1,
    withoutOutcome: 2,
    attendancePercent: 50,
    today: '2026-10-19',
  })

  const missed = await app.inject({
    method: 'GET',
    url: '/v1/reports/patients?kind=missed&from=2026-10-01&to=2026-10-31',
    headers: { authorization: 'Bearer ana' },
  })
  assert.equal(missed.statusCode, 200, missed.body)
  const missedRows = missed.json<{ name: string; appointmentCount: number }[]>()
  assert.deepEqual(missedRows.map((row) => row.name), ['Ivo'])
  assert.equal(missedRows[0]?.appointmentCount, 1)

  const overdue = await app.inject({
    method: 'GET',
    url: '/v1/reports/appointments?kind=overdue&from=2026-10-01&to=2026-10-31',
    headers: { authorization: 'Bearer ana' },
  })
  const overdueRows = overdue.json<{ patientName: string; status: string }[]>()
  assert.equal(overdueRows.length, 1)
  assert.equal(overdueRows[0]?.status, 'agendado')

  const week = await app.inject({
    method: 'GET',
    url: '/v1/reports/appointments?kind=upcoming&horizon=week',
    headers: { authorization: 'Bearer ana' },
  })
  assert.equal(week.json<unknown[]>().length, 0)
  const month = await app.inject({
    method: 'GET',
    url: '/v1/reports/appointments?kind=upcoming&horizon=month',
    headers: { authorization: 'Bearer ana' },
  })
  assert.equal(month.json<{ patientName: string }[]>().map((row) => row.patientName).includes('Helena'), true)

  const filtered = await app.inject({
    method: 'GET',
    url: '/v1/reports/summary?from=2026-10-01&to=2026-10-31&q=Ivo',
    headers: { authorization: 'Bearer ana' },
  })
  assert.equal(filtered.json<{ missedPatients: number; onTimePatients: number }>().missedPatients, 1)
  assert.equal(filtered.json<{ onTimePatients: number }>().onTimePatients, 0)

  const hidden = await app.inject({
    method: 'GET',
    url: '/v1/reports/patients?kind=missed&from=2026-10-01&to=2026-10-31',
    headers: { authorization: 'Bearer bia' },
  })
  assert.deepEqual(hidden.json<{ name: string }[]>().map((row) => row.name), ['Carla'])
  await app.close()
  await database.close()
})

async function createPatient(app: Awaited<ReturnType<typeof buildApp>>, who: string, name: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/patients',
    headers: { authorization: `Bearer ${who}` },
    payload: { name, birthDate: '1980-01-02' },
  })
  assert.equal(response.statusCode, 201)
  return response.json<{ id: string }>().id
}

async function createProcedure(
  app: Awaited<ReturnType<typeof buildApp>>,
  who: string,
  patientId: string,
  followUps: Array<{ scheduledOn: string; reason: string }>,
): Promise<{ followUps: Array<{ id: string; scheduled_on: string }> }> {
  const response = await app.inject({
    method: 'POST',
    url: `/v1/patients/${patientId}/procedures`,
    headers: { authorization: `Bearer ${who}` },
    payload: {
      modality: 'implante',
      subtype: 'unitario',
      surgeryDate: '2026-09-01',
      sites: [{ fdi: 11, role: 'pilar' }],
      followUps,
    },
  })
  assert.equal(response.statusCode, 201)
  return response.json()
}

function followUpId(
  procedure: { followUps: Array<{ id: string; scheduled_on: string | Date }> },
  day: string,
): string {
  const followUp = procedure.followUps.find((item) => String(item.scheduled_on).slice(0, 10) === day)
  assert.ok(followUp)
  return followUp.id
}

async function patchStatus(
  app: Awaited<ReturnType<typeof buildApp>>,
  who: string,
  followUpId: string,
  status: string,
): Promise<void> {
  const response = await app.inject({
    method: 'PATCH',
    url: `/v1/follow-ups/${followUpId}`,
    headers: { authorization: `Bearer ${who}` },
    payload: { status },
  })
  assert.equal(response.statusCode, 200)
}
