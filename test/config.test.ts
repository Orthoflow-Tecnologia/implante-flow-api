import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConfigError, loadConfig } from '../src/config.js'

const baseEnv = {
  APP_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '3000',
  LOG_LEVEL: 'silent',
} satisfies NodeJS.ProcessEnv

test('carrega defaults seguros fora de produção', () => {
  const config = loadConfig({ APP_ENV: 'development' })
  assert.equal(config.appEnv, 'development')
  assert.equal(config.host, '0.0.0.0')
  assert.equal(config.port, 3000)
  assert.equal(config.logLevel, 'info')
  assert.equal(config.openApiEnabled, true)
  assert.deepEqual(config.corsOrigins, [])
  assert.equal(config.serviceName, 'implante-flow-api')
  assert.match(config.serviceVersion, /^\d+\.\d+\.\d+/)
})

test('desliga o OpenAPI em production quando a flag não vem', () => {
  const config = loadConfig({ APP_ENV: 'production' })
  assert.equal(config.openApiEnabled, false)
  assert.equal(config.logLevel, 'info')
})

test('aceita OpenAPI ligado em production por flag explícita', () => {
  const config = loadConfig({ ...baseEnv, APP_ENV: 'production', OPENAPI_ENABLED: 'true' })
  assert.equal(config.openApiEnabled, true)
})

test('separa origens CORS e ignora vazios', () => {
  const config = loadConfig({
    ...baseEnv,
    CORS_ORIGINS: ' https://app.example , ,https://admin.example ',
  })
  assert.deepEqual(config.corsOrigins, ['https://app.example', 'https://admin.example'])
})

test('rejeita ambiente, porta e flags inválidos sem repetir o valor recebido', () => {
  assert.throws(() => loadConfig({ APP_ENV: 'homolog' }), ConfigError)
  assert.throws(() => loadConfig({ ...baseEnv, PORT: '0' }), ConfigError)
  assert.throws(() => loadConfig({ ...baseEnv, PORT: '65536' }), ConfigError)
  assert.throws(() => loadConfig({ ...baseEnv, PORT: 'abc' }), ConfigError)
  assert.throws(() => loadConfig({ ...baseEnv, LOG_LEVEL: 'verbose' }), ConfigError)
  assert.throws(() => loadConfig({ ...baseEnv, OPENAPI_ENABLED: 'yes' }), ConfigError)

  try {
    loadConfig({ APP_ENV: 'segredo-no-valor' })
    assert.fail('deveria rejeitar APP_ENV')
  } catch (error) {
    assert.ok(error instanceof ConfigError)
    assert.equal(error.message.includes('segredo-no-valor'), false)
  }
})
