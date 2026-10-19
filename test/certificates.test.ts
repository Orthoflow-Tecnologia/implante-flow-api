import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dentistForAccessToken } from '../src/auth/dentist.js'
import { buildApp } from '../src/app.js'
import type { AppConfig } from '../src/config.js'
import { migrate } from '../src/db/migrate.js'
import { MemoryObjectStore } from '../src/files/object-store.js'
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

test('certificado incompleto é recusado e a reemissão cria outra versão sem assinatura', async () => {
  const database = await PgliteDatabase.create()
  await migrate(database)
  const ana = await dentistForAccessToken(database, { subject: 'user_ana', email: 'ana@example.com', name: 'Ana' })
  const bia = await dentistForAccessToken(database, { subject: 'user_bia', email: 'bia@example.com', name: 'Bia' })
  await database.query(`UPDATE dentists SET cro = '12345', cro_uf = 'RJ' WHERE id = $1`, [ana.id])
  const store = new MemoryObjectStore()
  const app = await buildApp({
    config,
    database,
    objectStore: store,
    authenticate: async (authorization) => (authorization === 'Bearer bia' ? bia : ana),
  })
  const patient = await app.inject({
    method: 'POST',
    url: '/v1/patients',
    headers: { authorization: 'Bearer ana' },
    payload: { name: 'Helena', birthDate: '1980-01-02' },
  })
  const procedure = await app.inject({
    method: 'POST',
    url: `/v1/patients/${patient.json<{ id: string }>().id}/procedures`,
    headers: { authorization: 'Bearer ana' },
    payload: {
      modality: 'implante',
      subtype: 'unitario',
      surgeryDate: '2026-10-01',
      sites: [{ fdi: 11, role: 'pilar' }],
    },
  })
  const procedureId = procedure.json<{ id: string }>().id
  const missing = await app.inject({
    method: 'POST',
    url: `/v1/procedures/${procedureId}/certificates`,
    headers: { authorization: 'Bearer ana' },
  })
  assert.equal(missing.statusCode, 400)
  await database.query(
    `INSERT INTO implant_pieces (dentist_id, site_id, manufacturer, model, size, manufactured_on, expires_on)
     SELECT dentist_id, id, 'Neodent', 'Drive', '3.5', '2026-01-01', '2031-01-01'
     FROM tooth_sites WHERE procedure_id = $1`,
    [procedureId],
  )
  const first = await app.inject({
    method: 'POST',
    url: `/v1/procedures/${procedureId}/certificates`,
    headers: { authorization: 'Bearer ana' },
  })
  assert.equal(first.statusCode, 201)
  const issued = first.json<{ version: number; signed: boolean; sha256: string; downloadUrl: string }>()
  assert.equal(issued.version, 1)
  assert.equal(issued.signed, false)
  assert.equal(issued.sha256.length, 64)
  assert.equal(issued.downloadUrl.includes('certificates'), true)
  const second = await app.inject({
    method: 'POST',
    url: `/v1/procedures/${procedureId}/certificates`,
    headers: { authorization: 'Bearer ana' },
  })
  assert.equal(second.json<{ version: number }>().version, 2)
  const signedApp = await buildApp({
    config,
    database,
    objectStore: store,
    documentSigner: async (pdf) => ({ pdf, signed: true }),
    authenticate: async () => ana,
  })
  const signed = await signedApp.inject({
    method: 'POST',
    url: `/v1/procedures/${procedureId}/certificates`,
    headers: { authorization: 'Bearer ana' },
  })
  assert.equal(signed.json<{ version: number; signed: boolean }>().signed, true)
  assert.equal(signed.json<{ version: number }>().version, 3)
  await signedApp.close()
  const hidden = await app.inject({
    method: 'POST',
    url: `/v1/procedures/${procedureId}/certificates`,
    headers: { authorization: 'Bearer bia' },
  })
  assert.equal(hidden.statusCode, 403)
  await app.close()
  await database.close()
})
