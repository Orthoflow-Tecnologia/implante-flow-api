import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dentistForAccessToken } from '../src/auth/dentist.js'
import { buildApp } from '../src/app.js'
import type { AppConfig } from '../src/config.js'
import { migrate } from '../src/db/migrate.js'
import { MemoryObjectStore } from '../src/files/object-store.js'
import { PgliteDatabase } from './pglite-database.js'

test('URL de foto expira em cinco minutos e fica com o dentista dono', async () => {
  const database = await PgliteDatabase.create()
  await migrate(database)
  const ana = await dentistForAccessToken(database, { subject: 'user_ana', email: 'ana@example.com', name: 'Ana' })
  const bia = await dentistForAccessToken(database, { subject: 'user_bia', email: 'bia@example.com', name: 'Bia' })
  const store = new MemoryObjectStore()
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
  const upload = await app.inject({
    method: 'POST',
    url: `/v1/procedures/${procedure.json<{ id: string }>().id}/photos`,
    headers: { authorization: 'Bearer ana' },
    payload: { contentType: 'image/jpeg', byteSize: 1200, caption: 'oclusal' },
  })
  assert.equal(upload.statusCode, 201)
  const photo = upload.json<{ photoId: string; uploadUrl: string; expiresIn: number }>()
  assert.equal(photo.expiresIn, 300)
  assert.equal(photo.uploadUrl.includes(ana.id), true)
  const read = await app.inject({
    method: 'GET',
    url: `/v1/photos/${photo.photoId}`,
    headers: { authorization: 'Bearer ana' },
  })
  assert.equal(read.statusCode, 200)
  assert.equal(read.json<{ expiresIn: number }>().expiresIn, 300)
  const hidden = await app.inject({
    method: 'GET',
    url: `/v1/photos/${photo.photoId}`,
    headers: { authorization: 'Bearer bia' },
  })
  assert.equal(hidden.statusCode, 403)
  const rejected = await app.inject({
    method: 'POST',
    url: `/v1/procedures/${procedure.json<{ id: string }>().id}/photos`,
    headers: { authorization: 'Bearer ana' },
    payload: { contentType: 'application/pdf', byteSize: 1200 },
  })
  assert.equal(rejected.statusCode, 400)
  await app.close()
  await database.close()
})
