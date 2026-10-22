import assert from 'node:assert/strict'
import { test } from 'node:test'
import { InvalidAccessTokenError } from '../src/auth/access-token.js'
import type { Authenticate } from '../src/auth/plugin.js'
import type { AppConfig } from '../src/config.js'
import { buildApp } from '../src/app.js'

const config: AppConfig = {
  appEnv: 'test',
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  openApiEnabled: true,
  corsOrigins: [],
  serviceName: 'implante-flow-api',
  serviceVersion: '0.1.0',
  databaseUrl: null,
  workOs: null,
  s3: null,
  monitorServices: [],
  railway: null,
}

const anaId = '11111111-1111-4111-8111-111111111111'
const authenticate: Authenticate = async (authorization) => {
  if (authorization !== 'Bearer ana') throw new InvalidAccessTokenError()
  return {
    id: anaId,
    workOsUserId: 'user_ana',
    email: 'ana@example.com',
    permissions: [],
  }
}
const auth = { config, authenticate }

test('probes públicos respondem sem autenticação', async () => {
  const app = await buildApp({ config })
  const health = await app.inject({ method: 'GET', url: '/health' })
  const ready = await app.inject({ method: 'GET', url: '/ready' })

  assert.equal(health.statusCode, 200)
  assert.deepEqual(health.json(), { status: 'ok' })
  assert.equal(ready.statusCode, 200)
  assert.deepEqual(ready.json(), { status: 'ready' })
  assert.equal(typeof health.headers['x-request-id'], 'string')
  await app.close()
})

test('readiness falha com 503 sem detalhe da dependência', async () => {
  const app = await buildApp({
    config,
    readinessCheck: async () => {
      throw new Error('postgres://user:secret@db:5432/clinic')
    },
  })
  const response = await app.inject({ method: 'GET', url: '/ready' })
  assert.equal(response.statusCode, 503)
  assert.deepEqual(response.json(), { status: 'unavailable' })
  assert.equal(response.body.includes('secret'), false)
  await app.close()
})

test('preserva x-request-id seguro e substitui valor inválido', async () => {
  const app = await buildApp({ config })
  const kept = await app.inject({
    method: 'GET',
    url: '/health',
    headers: { 'x-request-id': 'req-123' },
  })
  const replaced = await app.inject({
    method: 'GET',
    url: '/health',
    headers: { 'x-request-id': 'quebra\nlinha' },
  })

  assert.equal(kept.headers['x-request-id'], 'req-123')
  assert.notEqual(replaced.headers['x-request-id'], 'quebra\nlinha')
  assert.match(String(replaced.headers['x-request-id']), /^[0-9a-f-]{36}$/)
  await app.close()
})

test('GET /v1 identifica a API e rejeita query desconhecida', async () => {
  const app = await buildApp(auth)
  const ok = await app.inject({ method: 'GET', url: '/v1', headers: { authorization: 'Bearer ana' } })
  const invalid = await app.inject({
    method: 'GET',
    url: '/v1?paciente=ana',
    headers: { authorization: 'Bearer ana' },
  })

  assert.equal(ok.statusCode, 200)
  assert.deepEqual(ok.json(), {
    service: 'implante-flow-api',
    version: '0.1.0',
    apiVersion: 'v1',
    environment: 'test',
  })
  assert.equal(invalid.statusCode, 400)
  const body = invalid.json<{ error: { code: string; message: string; requestId: string } }>()
  assert.equal(body.error.code, 'validation_error')
  assert.equal(body.error.message, 'Requisição inválida.')
  assert.equal(invalid.body.includes('ana'), false)
  await app.close()
})

test('rota inexistente usa o envelope de erro', async () => {
  const app = await buildApp(auth)
  const response = await app.inject({
    method: 'GET',
    url: '/v1/nao-existe',
    headers: { authorization: 'Bearer ana' },
  })
  assert.equal(response.statusCode, 404)
  const body = response.json<{ error: { code: string; requestId: string } }>()
  assert.equal(body.error.code, 'not_found')
  assert.equal(body.error.requestId, response.headers['x-request-id'])
  await app.close()
})

test('OpenAPI descreve os probes e a versão', async () => {
  const app = await buildApp({ config })
  const response = await app.inject({ method: 'GET', url: '/docs/json' })
  assert.equal(response.statusCode, 200)
  const document = response.json<{ paths: Record<string, unknown> }>()
  assert.ok(document.paths['/health'])
  assert.ok(document.paths['/ready'])
  assert.ok(document.paths['/v1'])
  await app.close()
})

test('OpenAPI fica ausente quando desligado', async () => {
  const app = await buildApp({ config: { ...config, openApiEnabled: false } })
  const response = await app.inject({ method: 'GET', url: '/docs/json' })
  assert.equal(response.statusCode, 404)
  await app.close()
})

test('CORS só reflete origem configurada', async () => {
  const closed = await buildApp({ config })
  const closedResponse = await closed.inject({
    method: 'GET',
    url: '/health',
    headers: { origin: 'https://app.example' },
  })
  assert.equal(closedResponse.headers['access-control-allow-origin'], undefined)
  await closed.close()

  const open = await buildApp({
    config: { ...config, corsOrigins: ['https://app.example'] },
  })
  const allowed = await open.inject({
    method: 'GET',
    url: '/health',
    headers: { origin: 'https://app.example' },
  })
  const denied = await open.inject({
    method: 'GET',
    url: '/health',
    headers: { origin: 'https://outro.example' },
  })
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://app.example')
  assert.equal(denied.headers['access-control-allow-origin'], undefined)
  await open.close()
})
