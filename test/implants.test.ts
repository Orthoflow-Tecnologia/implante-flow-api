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

test('inventário preexistente, vínculo opcional da prótese e isolamento', async () => {
  const database = await PgliteDatabase.create()
  await migrate(database)
  const ana = await dentistForAccessToken(database, {
    subject: 'user_ana',
    email: 'ana@example.com',
    name: 'Ana',
  })
  const bia = await dentistForAccessToken(database, {
    subject: 'user_bia',
    email: 'bia@example.com',
    name: 'Bia',
  })
  const app = await buildApp({
    config,
    database,
    authenticate: async (authorization) => {
      if (authorization === 'Bearer ana') return ana
      if (authorization === 'Bearer bia') return bia
      throw new InvalidAccessTokenError()
    },
  })

  const patient = await app.inject({
    method: 'POST',
    url: '/v1/patients',
    headers: { authorization: 'Bearer ana' },
    payload: { name: 'Helena Costa', birthDate: '1980-01-02', phone: '21988887777' },
  })
  assert.equal(patient.statusCode, 201)
  const patientId = patient.json<{ id: string }>().id

  const preexisting = await app.inject({
    method: 'POST',
    url: `/v1/patients/${patientId}/implants`,
    headers: { authorization: 'Bearer ana' },
    payload: { fdi: 16, manufacturer: 'Straumann', notes: 'Feito em outra clínica' },
  })
  assert.equal(preexisting.statusCode, 201)
  const implant = preexisting.json<{
    id: string
    origin: string
    sourceProcedureId: string | null
    manufacturer: string
  }>()
  assert.equal(implant.origin, 'preexisting')
  assert.equal(implant.sourceProcedureId, null)
  assert.equal(implant.manufacturer, 'Straumann')

  const denied = await app.inject({
    method: 'GET',
    url: `/v1/patients/${patientId}/implants`,
    headers: { authorization: 'Bearer bia' },
  })
  assert.equal(denied.statusCode, 403)

  const surgery = await app.inject({
    method: 'POST',
    url: `/v1/patients/${patientId}/procedures`,
    headers: { authorization: 'Bearer ana' },
    payload: {
      modality: 'implante',
      subtype: 'unitario',
      surgeryDate: '2026-09-01',
      statusLabel: 'instalado',
      sites: [{ fdi: 26, role: 'pilar', piece: { manufacturer: 'Neodent', model: 'Helix GM' } }],
    },
  })
  assert.equal(surgery.statusCode, 201)
  const surgeryId = surgery.json<{ id: string }>().id

  const listed = await app.inject({
    method: 'GET',
    url: `/v1/patients/${patientId}/implants`,
    headers: { authorization: 'Bearer ana' },
  })
  assert.equal(listed.statusCode, 200)
  const inventory = listed.json<
    { id: string; fdi: number; origin: string; sourceProcedureId: string | null }[]
  >()
  assert.equal(inventory.length, 2)
  const recorded = inventory.find((item) => item.origin === 'procedure_recorded')
  assert.ok(recorded)
  assert.equal(recorded?.fdi, 26)
  assert.equal(recorded?.sourceProcedureId, surgeryId)

  for (const subtype of ['unitario', 'ponte', 'protocolo'] as const) {
    const sites =
      subtype === 'unitario'
        ? [{ fdi: 14, role: 'pilar' }]
        : subtype === 'ponte'
          ? [
              { fdi: 14, role: 'pilar' },
              { fdi: 15, role: 'pontico' },
              { fdi: 16, role: 'pilar' },
            ]
          : [
              { fdi: 11, role: 'pilar' },
              { fdi: 21, role: 'pilar' },
            ]
    const payload: Record<string, unknown> = {
      modality: 'protese',
      subtype,
      surgeryDate: '2026-10-10',
      statusLabel: 'protese',
      linkedImplantIds: [],
      sites,
    }
    if (subtype === 'protocolo') payload.arch = 'superior'
    const empty = await app.inject({
      method: 'POST',
      url: `/v1/patients/${patientId}/procedures`,
      headers: { authorization: 'Bearer ana' },
      payload,
    })
    assert.equal(empty.statusCode, 201, subtype)
  }

  const linked = await app.inject({
    method: 'POST',
    url: `/v1/patients/${patientId}/procedures`,
    headers: { authorization: 'Bearer ana' },
    payload: {
      modality: 'protese',
      subtype: 'unitario',
      surgeryDate: '2026-10-11',
      statusLabel: 'protese',
      linkedImplantIds: [implant.id, recorded!.id],
      sites: [{ fdi: 16, role: 'pilar' }],
    },
  })
  assert.equal(linked.statusCode, 201)

  const chart = await app.inject({
    method: 'GET',
    url: '/v1/chart',
    headers: { authorization: 'Bearer ana' },
  })
  assert.equal(chart.statusCode, 200)
  const body = chart.json<{
    patients: { id: string; implants: { id: string; origin: string }[] }[]
    procedures: { modality: string; linkedImplantIds: string[]; linkedProcedureIds: string[] }[]
  }>()
  const chartPatient = body.patients.find((item) => item.id === patientId)
  assert.equal(chartPatient?.implants.length, 2)
  const prosthesis = body.procedures.find(
    (item) => item.modality === 'protese' && item.linkedImplantIds.length === 2,
  )
  assert.ok(prosthesis)
  assert.ok(prosthesis?.linkedProcedureIds.includes(surgeryId))

  const otherPatient = await app.inject({
    method: 'POST',
    url: '/v1/patients',
    headers: { authorization: 'Bearer ana' },
    payload: { name: 'Outro', birthDate: '1990-01-01' },
  })
  const otherId = otherPatient.json<{ id: string }>().id
  const cross = await app.inject({
    method: 'POST',
    url: `/v1/patients/${otherId}/procedures`,
    headers: { authorization: 'Bearer ana' },
    payload: {
      modality: 'protese',
      subtype: 'unitario',
      surgeryDate: '2026-10-12',
      statusLabel: 'protese',
      linkedImplantIds: [implant.id],
      sites: [{ fdi: 11, role: 'pilar' }],
    },
  })
  assert.equal(cross.statusCode, 400)

  const inactivated = await app.inject({
    method: 'PATCH',
    url: `/v1/implants/${implant.id}`,
    headers: { authorization: 'Bearer ana' },
    payload: { active: false, notes: 'Removido da boca' },
  })
  assert.equal(inactivated.statusCode, 200)
  assert.equal(inactivated.json<{ active: boolean; notes: string }>().active, false)
  assert.equal(inactivated.json<{ notes: string }>().notes, 'Removido da boca')
})
