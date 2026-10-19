import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dentistForAccessToken } from '../src/auth/dentist.js'
import { buildApp } from '../src/app.js'
import type { AppConfig } from '../src/config.js'
import { migrate } from '../src/db/migrate.js'
import { processStageNotices, reprocessNotice } from '../src/notices/stage-notices.js'
import { PgliteDatabase } from './pglite-database.js'

test('notifica a etapa uma vez e respeita revogação e falha', async () => {
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
  }
  const app = await buildApp({ config, database, authenticate: async () => ana })
  const patient = await app.inject({
    method: 'POST',
    url: '/v1/patients',
    headers: { authorization: 'Bearer ana' },
    payload: {
      name: 'Helena',
      birthDate: '1980-01-02',
      email: 'helena@example.com',
      phone: '21988887777',
      notifyByEmail: true,
      notifyByPhone: false,
    },
  })
  const patientId = patient.json<{ id: string }>().id
  const procedure = await app.inject({
    method: 'POST',
    url: `/v1/patients/${patientId}/procedures`,
    headers: { authorization: 'Bearer ana' },
    payload: {
      modality: 'implante',
      subtype: 'unitario',
      surgeryDate: '2026-10-01',
      statusLabel: 'planejado',
      sites: [{ fdi: 11, role: 'pilar' }],
    },
  })
  const procedureId = procedure.json<{ id: string }>().id
  const sent: string[] = []
  let failOnce = true
  const sender = async (input: { body: string }) => {
    if (failOnce) {
      failOnce = false
      throw new Error('provedor fora')
    }
    sent.push(input.body)
    assert.equal(input.body.includes('Neodent'), false)
    assert.equal(input.body.includes('Helena'), false)
  }

  await app.inject({
    method: 'PATCH',
    url: `/v1/procedures/${procedureId}`,
    headers: { authorization: 'Bearer ana' },
    payload: { statusLabel: 'instalado' },
  })
  assert.equal(await processStageNotices(database, sender), 0)
  const failed = await database.query<{ id: string; status: string }>('SELECT id, status FROM stage_notice_deliveries')
  assert.equal(failed.length, 1)
  assert.equal(failed[0]?.status, 'falha')
  assert.equal(await reprocessNotice(database, ana.id, failed[0]?.id ?? ''), true)
  assert.equal(await processStageNotices(database, sender), 1)
  assert.equal(await processStageNotices(database, sender), 0)

  await app.inject({
    method: 'PATCH',
    url: `/v1/procedures/${procedureId}`,
    headers: { authorization: 'Bearer ana' },
    payload: { statusLabel: 'osseointegracao' },
  })
  await app.inject({
    method: 'PATCH',
    url: `/v1/patients/${patientId}`,
    headers: { authorization: 'Bearer ana' },
    payload: { notifyByEmail: false },
  })
  const revoked = await database.query<{ status: string }>(
    `SELECT status FROM stage_notice_deliveries WHERE status = 'revogada'`,
  )
  assert.equal(revoked.length, 1)
  assert.equal(await processStageNotices(database, sender), 0)
  assert.equal(sent.length, 1)

  await app.close()
  await database.close()
})
