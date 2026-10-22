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
  monitorServices: [],
  railway: null,
}

test('grava paciente, procedimento, consulta e retorno só para o dono', async () => {
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

  const created = await app.inject({
    method: 'POST',
    url: '/v1/patients',
    headers: { authorization: 'Bearer ana' },
    payload: { name: '  Helena Costa ', birthDate: '2015-04-02', phone: '(21) 98888-7777', guardian: 'Marina Costa' },
  })
  assert.equal(created.statusCode, 201)
  const patient = created.json<{ id: string; phone: string; guardian: string }>()
  assert.equal(patient.phone, '21988887777')
  assert.equal(patient.guardian, 'Marina Costa')

  const hidden = await app.inject({
    method: 'GET',
    url: `/v1/patients/${patient.id}`,
    headers: { authorization: 'Bearer bia' },
  })
  assert.equal(hidden.statusCode, 403)

  const procedure = await app.inject({
    method: 'POST',
    url: `/v1/patients/${patient.id}/procedures`,
    headers: { authorization: 'Bearer ana' },
    payload: {
      modality: 'implante',
      subtype: 'unitario',
      surgeryDate: '2026-10-01',
      statusLabel: 'planejado',
      sites: [{ fdi: 11, role: 'pilar', piece: { manufacturer: 'Neodent', model: 'Helix GM' } }],
      followUps: [{ scheduledOn: '2026-10-08', reason: 'sutura' }],
    },
  })
  assert.equal(procedure.statusCode, 201)
  const saved = procedure.json<{ id: string; followUps: { id: string }[]; sites: { piece: { manufacturer: string } | null }[] }>()
  assert.equal(saved.sites[0]?.piece?.manufacturer, 'Neodent')
  const followUpId = saved.followUps[0]?.id
  assert.ok(followUpId)

  const rejected = await app.inject({
    method: 'POST',
    url: `/v1/patients/${patient.id}/procedures`,
    headers: { authorization: 'Bearer ana' },
    payload: {
      modality: 'implante',
      subtype: 'ponte',
      surgeryDate: '2026-10-02',
      sites: [
        { fdi: 11, role: 'pilar' },
        { fdi: 12, role: 'pontico', piece: { manufacturer: 'Neodent' } },
        { fdi: 13, role: 'pilar' },
      ],
    },
  })
  assert.equal(rejected.statusCode, 400)

  const visit = await app.inject({
    method: 'POST',
    url: `/v1/procedures/${saved.id}/visits`,
    headers: { authorization: 'Bearer ana' },
    payload: { date: '2026-10-08', note: 'sutura ok', statusLabel: 'instalado' },
  })
  assert.equal(visit.statusCode, 201)
  assert.equal(visit.json<{ statusLabel: string; visits: unknown[] }>().statusLabel, 'instalado')
  assert.equal(visit.json<{ visits: unknown[] }>().visits.length, 1)

  const done = await app.inject({
    method: 'PATCH',
    url: `/v1/follow-ups/${followUpId}`,
    headers: { authorization: 'Bearer ana' },
    payload: { status: 'realizado' },
  })
  assert.equal(done.statusCode, 200)
  assert.equal(done.json<{ status: string }>().status, 'realizado')

  const biaList = await app.inject({
    method: 'GET',
    url: '/v1/patients',
    headers: { authorization: 'Bearer bia' },
  })
  assert.deepEqual(biaList.json(), [])

  await assert.rejects(
    database.withDentist(ana.id, async (tx) => {
      await tx.query(
        `INSERT INTO patients (dentist_id, name, birth_date) VALUES ($1, 'Rollback', '1990-01-01')`,
        [ana.id],
      )
      throw new Error('falha no meio da transação')
    }),
  )
  const names = await database.withDentist(ana.id, (tx) => tx.query<{ name: string }>('SELECT name FROM patients ORDER BY name'))
  assert.deepEqual(names.map((row) => row.name), ['Helena Costa'])

  await app.close()
  await database.close()
})

test('menor sem responsável é rejeitado antes de gravar', async () => {
  const database = await PgliteDatabase.create()
  await migrate(database)
  const ana = await dentistForAccessToken(database, { subject: 'user_ana', email: '', name: 'Ana' })
  const app = await buildApp({
    config,
    database,
    authenticate: async () => ana,
  })
  const response = await app.inject({
    method: 'POST',
    url: '/v1/patients',
    headers: { authorization: 'Bearer ana' },
    payload: { name: 'Criança', birthDate: '2016-01-01' },
  })
  assert.equal(response.statusCode, 400)
  const rows = await database.withDentist(ana.id, (tx) => tx.query('SELECT id FROM patients'))
  assert.equal(rows.length, 0)
  await app.close()
  await database.close()
})
