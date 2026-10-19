import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dentistForAccessToken } from '../src/auth/dentist.js'
import { buildApp } from '../src/app.js'
import type { AppConfig } from '../src/config.js'
import { migrate } from '../src/db/migrate.js'
import { PgliteDatabase } from './pglite-database.js'

test('catálogo é somente leitura para o dentista', async () => {
  const database = await PgliteDatabase.create()
  await migrate(database)
  const ana = await dentistForAccessToken(database, { subject: 'user_ana', email: 'ana@example.com', name: 'Ana' })
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
  const app = await buildApp({ config, database, authenticate: async () => ana })
  const implants = await app.inject({
    method: 'GET',
    url: '/v1/catalog/implants',
    headers: { authorization: 'Bearer ana' },
  })
  const grafts = await app.inject({
    method: 'GET',
    url: '/v1/catalog/grafts',
    headers: { authorization: 'Bearer ana' },
  })
  assert.equal(implants.statusCode, 200)
  const catalog = implants.json<{ manufacturers: { name: string; models: { name: string }[] }[] }>()
  assert.deepEqual(
    catalog.manufacturers.map((manufacturer) => manufacturer.name),
    ['Neodent', 'Nobel Biocare', 'Straumann'],
  )
  assert.ok(catalog.manufacturers[0]?.models.some((model) => model.name === 'Helix GM'))
  assert.equal(grafts.statusCode, 200)
  assert.equal(grafts.json<{ manufacturers: { name: string }[] }>().manufacturers.some((item) => item.name === 'Geistlich'), true)

  await assert.rejects(
    database.withDentist(ana.id, (tx) =>
      tx.query(`INSERT INTO implant_manufacturers (id, name) VALUES ('outro', 'Outro')`),
    ),
  )
  await app.close()
  await database.close()
})
