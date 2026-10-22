import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dentistForAccessToken } from '../src/auth/dentist.js'
import { buildApp } from '../src/app.js'
import type { AppConfig } from '../src/config.js'
import { migrate } from '../src/db/migrate.js'
import { processDentistReminders, type ReminderNotifier } from '../src/reminders/dispatch.js'
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

test('lembrete vai ao dentista na antecedência e o atraso sai uma vez', async () => {
  const database = await PgliteDatabase.create()
  await migrate(database)
  const ana = await dentistForAccessToken(database, { subject: 'user_ana', email: 'ana@example.com', name: 'Ana' })
  const app = await buildApp({ config, database, authenticate: async () => ana })
  const patient = await app.inject({
    method: 'POST',
    url: '/v1/patients',
    headers: { authorization: 'Bearer ana' },
    payload: {
      name: 'Helena',
      birthDate: '1980-01-02',
      phone: '21988887777',
      email: 'helena@example.com',
    },
  })
  const created = await app.inject({
    method: 'POST',
    url: `/v1/patients/${patient.json<{ id: string }>().id}/procedures`,
    headers: { authorization: 'Bearer ana' },
    payload: {
      modality: 'implante',
      subtype: 'unitario',
      surgeryDate: '2026-09-01',
      sites: [{ fdi: 11, role: 'pilar' }],
      followUps: [
        { scheduledOn: '2026-10-20', reason: 'controle', reminderDaysBefore: 15 },
        { scheduledOn: '2026-10-01', reason: 'sutura', reminderDaysBefore: 15 },
      ],
    },
  })
  assert.equal(created.statusCode, 201)
  const sent: Array<{ channel: string; destination: string; body: string }> = []
  const notifier: ReminderNotifier = async (input) => {
    sent.push(input)
  }
  const overdue = await processDentistReminders(database, notifier, new Date('2026-10-02T12:00:00-03:00'))
  assert.equal(overdue, 2)
  assert.equal(sent.every((item) => item.body.startsWith('Retorno atrasado') && item.body.includes('sutura')), true)
  assert.equal(sent.some((item) => item.body.includes('21988887777') || item.body.includes('helena@example.com')), false)
  const overdueAgain = await processDentistReminders(database, notifier, new Date('2026-10-03T12:00:00-03:00'))
  assert.equal(overdueAgain, 0)
  sent.length = 0
  const first = await processDentistReminders(database, notifier, new Date('2026-10-05T12:00:00-03:00'))
  assert.equal(first, 2)
  assert.equal(sent.every((item) => item.destination === 'ana@example.com' || item.destination === `dentist:${ana.id}`), true)
  assert.equal(sent.every((item) => item.body.includes('Helena') && item.body.includes('11') && item.body.includes('controle')), true)
  const again = await processDentistReminders(database, notifier, new Date('2026-10-05T18:00:00-03:00'))
  assert.equal(again, 0)
  await database.query(`UPDATE dentists SET email_channel = false, push_channel = false WHERE id = $1`, [ana.id])
  const extra = await app.inject({
    method: 'POST',
    url: `/v1/patients/${patient.json<{ id: string }>().id}/procedures`,
    headers: { authorization: 'Bearer ana' },
    payload: {
      modality: 'implante',
      subtype: 'unitario',
      surgeryDate: '2026-09-02',
      sites: [{ fdi: 21, role: 'pilar' }],
      followUps: [{ scheduledOn: '2026-10-21', reason: 'controle', reminderDaysBefore: 15 }],
    },
  })
  assert.equal(extra.statusCode, 201)
  const silenced = await processDentistReminders(database, notifier, new Date('2026-10-06T12:00:00-03:00'))
  assert.equal(silenced, 0)
  await app.close()
  await database.close()
})
