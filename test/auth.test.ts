import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import { createAccessTokenVerifier, InvalidAccessTokenError } from '../src/auth/access-token.js'
import { dentistForAccessToken } from '../src/auth/dentist.js'
import { buildApp } from '../src/app.js'
import type { AppConfig } from '../src/config.js'
import { migrate } from '../src/db/migrate.js'
import { PgliteDatabase } from './pglite-database.js'

const issuer = 'https://auth.example'
const audience = 'client_123'

async function signer(): Promise<{
  sign: (claims: { subject: string; expiresIn?: string; audience?: string; issuer?: string }) => Promise<string>
  keys: ReturnType<typeof createLocalJWKSet>
}> {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = await exportJWK(publicKey)
  const keys = createLocalJWKSet({ keys: [{ ...jwk, alg: 'RS256', kid: 'test' } satisfies JWK] })
  return {
    keys,
    sign: ({ subject, expiresIn = '2m', audience: tokenAudience = audience, issuer: tokenIssuer = issuer }) =>
      new SignJWT({ email: `${subject}@example.com`, name: subject })
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setSubject(subject)
        .setIssuer(tokenIssuer)
        .setAudience(tokenAudience)
        .setExpirationTime(expiresIn)
        .sign(privateKey),
  }
}

test('rejeita token expirado, audiência errada e assinatura inválida', async () => {
  const { sign, keys } = await signer()
  const verify = createAccessTokenVerifier({ issuer, audience, keys })
  const valid = await verify(await sign({ subject: 'user_ana' }))
  assert.equal(valid.subject, 'user_ana')
  assert.equal(valid.email, 'user_ana@example.com')

  await assert.rejects(verify(await sign({ subject: 'user_ana', expiresIn: '-1s' })), InvalidAccessTokenError)
  await assert.rejects(verify(await sign({ subject: 'user_ana', audience: 'outro' })), InvalidAccessTokenError)
  await assert.rejects(verify(await sign({ subject: 'user_ana', issuer: 'https://outro.example' })), InvalidAccessTokenError)
  await assert.rejects(verify(`${await sign({ subject: 'user_ana' })}x`), InvalidAccessTokenError)
})

test('mapeia o sub ao mesmo dentista e bloqueia o prontuário alheio', async () => {
  const database = await PgliteDatabase.create()
  await migrate(database)
  const { sign, keys } = await signer()
  const verify = createAccessTokenVerifier({ issuer, audience, keys })
  const ana = await dentistForAccessToken(database, await verify(await sign({ subject: 'user_ana' })))
  const anaAgain = await dentistForAccessToken(database, await verify(await sign({ subject: 'user_ana' })))
  const bia = await dentistForAccessToken(database, await verify(await sign({ subject: 'user_bia' })))
  assert.equal(ana.id, anaAgain.id)
  assert.notEqual(ana.id, bia.id)

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
  }
  const anaToken = await sign({ subject: 'user_ana' })
  const app = await buildApp({
    config,
    authenticate: async (authorization) => {
      if (!authorization?.startsWith('Bearer ')) throw new InvalidAccessTokenError()
      return dentistForAccessToken(database, await verify(authorization.slice('Bearer '.length)))
    },
  })

  const missing = await app.inject({ method: 'GET', url: '/v1/session' })
  const session = await app.inject({
    method: 'GET',
    url: '/v1/session',
    headers: { authorization: `Bearer ${anaToken}` },
  })
  const own = await app.inject({
    method: 'GET',
    url: `/v1/dentists/${ana.id}`,
    headers: { authorization: `Bearer ${anaToken}` },
  })
  const crossed = await app.inject({
    method: 'GET',
    url: `/v1/dentists/${bia.id}`,
    headers: { authorization: `Bearer ${anaToken}` },
  })

  assert.equal(missing.statusCode, 401)
  assert.equal(session.statusCode, 200)
  assert.deepEqual(session.json(), { dentistId: ana.id })
  assert.equal(own.statusCode, 200)
  assert.equal(crossed.statusCode, 403)
  assert.equal(crossed.body.includes(bia.workOsUserId), false)
  await app.close()
  await database.close()
})
