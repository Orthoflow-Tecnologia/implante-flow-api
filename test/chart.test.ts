import assert from 'node:assert/strict'
import { test } from 'node:test'
import { InvalidAccessTokenError } from '../src/auth/access-token.js'
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

const patientId = '11111111-1111-4111-8111-111111111111'
const procedureId = '22222222-2222-4222-8222-222222222222'
const followUpId = '33333333-3333-4333-8333-333333333333'
const locationId = '44444444-4444-4444-8444-444444444444'

test('o prontuário devolve o formato do app e preserva os ids do cliente', async () => {
  const database = await PgliteDatabase.create()
  await migrate(database)
  const ana = await dentistForAccessToken(database, {
    subject: 'user_ana',
    email: 'ana@example.com',
    name: 'Ana Costa',
  })
  const app = await buildApp({
    config,
    database,
    authenticate: async (authorization) => {
      if (authorization === 'Bearer ana') return ana
      throw new InvalidAccessTokenError()
    },
  })

  const location = await app.inject({
    method: 'POST',
    url: '/v1/locations',
    headers: { authorization: 'Bearer ana' },
    payload: { id: locationId, name: 'Barra', address: 'Av. das Américas' },
  })
  assert.equal(location.statusCode, 201)
  assert.equal(location.json<{ id: string }>().id, locationId)

  const profile = await app.inject({
    method: 'PATCH',
    url: '/v1/profile',
    headers: { authorization: 'Bearer ana' },
    payload: { cro: '12345/RJ', reminderDaysBefore: 7 },
  })
  assert.equal(profile.statusCode, 200)
  assert.equal(profile.json<{ cro: string; croUf: string }>().cro, '12345')
  assert.equal(profile.json<{ croUf: string }>().croUf, 'RJ')

  const patient = await app.inject({
    method: 'POST',
    url: '/v1/patients',
    headers: { authorization: 'Bearer ana' },
    payload: {
      id: patientId,
      name: 'Helena Costa',
      birthDate: '1980-01-02',
      phone: '21988887777',
    },
  })
  assert.equal(patient.statusCode, 201)
  assert.equal(patient.json<{ id: string }>().id, patientId)

  const linked = await app.inject({
    method: 'PUT',
    url: `/v1/patients/${patientId}/locations`,
    headers: { authorization: 'Bearer ana' },
    payload: { locationIds: [locationId] },
  })
  assert.equal(linked.statusCode, 200)

  const procedure = await app.inject({
    method: 'POST',
    url: `/v1/patients/${patientId}/procedures`,
    headers: { authorization: 'Bearer ana' },
    payload: {
      id: procedureId,
      modality: 'implante',
      subtype: 'unitario',
      surgeryDate: '2026-10-01',
      statusLabel: 'instalado',
      sites: [{ fdi: 11, role: 'pilar', piece: { manufacturer: 'Neodent', model: 'Helix GM', size: '3.5 × 10 mm' } }],
      followUps: [{ id: followUpId, scheduledOn: '2026-10-08', reason: 'sutura', reminderDaysBefore: 7 }],
    },
  })
  assert.equal(procedure.statusCode, 201)
  assert.equal(procedure.json<{ id: string }>().id, procedureId)

  const chart = await app.inject({
    method: 'GET',
    url: '/v1/chart',
    headers: { authorization: 'Bearer ana' },
  })
  assert.equal(chart.statusCode, 200)
  const body = chart.json<{
    profile: { name: string; cro: string; reminderDaysBefore: number; locations: { id: string }[] }
    patients: { id: string; birthDate: string; locationIds: string[] }[]
    procedures: {
      id: string
      surgeryDate: string
      sites: { fdi: number; piece: { manufacturer: string } | null }[]
      followUps: { id: string; date: string; reason: string }[]
    }[]
  }>()
  assert.equal(body.profile.name, 'Ana Costa')
  assert.equal(body.profile.cro, '12345/RJ')
  assert.equal(body.profile.reminderDaysBefore, 7)
  assert.equal(body.profile.locations[0]?.id, locationId)
  assert.equal(body.patients[0]?.id, patientId)
  assert.equal(body.patients[0]?.birthDate, '1980-01-02T00:00:00.000')
  assert.deepEqual(body.patients[0]?.locationIds, [locationId])
  assert.equal(body.procedures[0]?.id, procedureId)
  assert.equal(body.procedures[0]?.surgeryDate, '2026-10-01T00:00:00.000')
  assert.equal(body.procedures[0]?.sites[0]?.piece?.manufacturer, 'Neodent')
  assert.equal(body.procedures[0]?.followUps[0]?.id, followUpId)
  assert.equal(body.procedures[0]?.followUps[0]?.reason, 'sutura')

  const traced = await app.inject({
    method: 'PATCH',
    url: `/v1/procedures/${procedureId}`,
    headers: { authorization: 'Bearer ana' },
    payload: {
      statusLabel: 'instalado',
      sites: [{ fdi: 11, role: 'pilar', piece: { manufacturer: 'Straumann', model: 'BLX' } }],
    },
  })
  assert.equal(traced.statusCode, 200)
  const again = await app.inject({
    method: 'GET',
    url: '/v1/chart',
    headers: { authorization: 'Bearer ana' },
  })
  assert.equal(
    again.json<{ procedures: { sites: { piece: { manufacturer: string } | null }[] }[] }>().procedures[0]?.sites[0]?.piece
      ?.manufacturer,
    'Straumann',
  )
})
