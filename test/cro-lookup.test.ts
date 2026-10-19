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

test('consulta de CRO não inventa cadastro e não altera o perfil', async () => {
  const database = await PgliteDatabase.create()
  await migrate(database)
  const ana = await dentistForAccessToken(database, { subject: 'user_ana', email: 'ana@example.com', name: 'Ana' })
  const app = await buildApp({
    config,
    database,
    clock: () => new Date('2026-10-19T15:00:00-03:00'),
    authenticate: async (authorization) => {
      if (authorization !== 'Bearer ana') throw new InvalidAccessTokenError()
      return ana
    },
  })
  const lookup = await app.inject({
    method: 'GET',
    url: '/v1/dentists/cro-lookup?uf=rj&registration=12.345-6',
    headers: { authorization: 'Bearer ana' },
  })
  assert.equal(lookup.statusCode, 200)
  const body = lookup.json<{
    state: string
    category: string
    uf: string
    registration: string
    professional: null
    source: string
  }>()
  assert.equal(body.state, 'unavailable')
  assert.equal(body.category, 'CD')
  assert.equal(body.uf, 'RJ')
  assert.equal(body.registration, '123456')
  assert.equal(body.professional, null)
  assert.equal(body.source, 'https://busca-profissionais.cfo.org.br/')
  assert.equal(JSON.stringify(body).includes('Ana'), false)
  const invalid = await app.inject({
    method: 'GET',
    url: '/v1/dentists/cro-lookup?uf=XX&registration=',
    headers: { authorization: 'Bearer ana' },
  })
  assert.equal(invalid.json<{ state: string; professional: null }>().state, 'invalid_input')
  assert.equal(invalid.json<{ professional: null }>().professional, null)
  const profile = await app.inject({
    method: 'GET',
    url: '/v1/profile',
    headers: { authorization: 'Bearer ana' },
  })
  assert.equal(profile.json<{ cro: string; croUf: string }>().cro, '')
  assert.equal(profile.json<{ croUf: string }>().croUf, '')
  const anonymous = await app.inject({ method: 'GET', url: '/v1/dentists/cro-lookup?uf=RJ&registration=1' })
  assert.equal(anonymous.statusCode, 401)
  await app.close()
  await database.close()
})
