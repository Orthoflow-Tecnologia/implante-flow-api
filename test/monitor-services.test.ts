import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseMonitorServices,
  probeHttpHealth,
  probeMonitorServices,
  readRailwayRuntime,
} from '../src/ops/monitor-services.js'

test('parseMonitorServices ignora vazios e valida URL', () => {
  assert.deepEqual(parseMonitorServices(undefined), [])
  assert.deepEqual(parseMonitorServices(''), [])
  assert.deepEqual(
    parseMonitorServices('api|API|https://example.com/health'),
    [{ id: 'api', name: 'API', healthUrl: 'https://example.com/health' }],
  )
  assert.throws(() => parseMonitorServices('a|b|not-a-url'))
})

test('readRailwayRuntime só monta quando há variável', () => {
  assert.equal(readRailwayRuntime({}), null)
  assert.deepEqual(
    readRailwayRuntime({ RAILWAY_SERVICE_NAME: 'api' }),
    {
      environment: null,
      service: 'api',
      publicDomain: null,
      deploymentId: null,
    },
  )
})

test('probeHttpHealth classifica 2xx como ok', async () => {
  const ok = await probeHttpHealth('https://example.com/health', async () =>
    new Response('{"status":"ok"}', { status: 200 }),
  )
  assert.equal(ok.status, 'ok')

  const down = await probeHttpHealth('https://example.com/health', async () =>
    new Response('nope', { status: 503 }),
  )
  assert.equal(down.status, 'down')
  assert.match(down.detail, /503/)
})

test('probeMonitorServices agrega alvos', async () => {
  const results = await probeMonitorServices(
    [{ id: 'railway-api', name: 'API Railway', healthUrl: 'https://example.com/health' }],
    async () => new Response(null, { status: 200 }),
  )
  assert.equal(results.length, 1)
  assert.equal(results[0]?.status, 'ok')
})
