import { loadConfig } from '../config.js'
import { PgDatabase } from '../db/pg-database.js'
import { processDentistReminders, type ReminderNotifier } from './dispatch.js'

const config = loadConfig()
if (!config.databaseUrl) {
  throw new Error('DATABASE_URL é obrigatório para os lembretes.')
}

const webhook = process.env['REMINDER_WEBHOOK_URL']
const notifier: ReminderNotifier = async (input) => {
  if (!webhook) throw new Error('REMINDER_WEBHOOK_URL não configurado.')
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error('Falha ao entregar o lembrete.')
}

const database = new PgDatabase(config.databaseUrl)
try {
  const sent = await processDentistReminders(database, notifier)
  console.log(`lembretes enviados: ${sent}`)
} finally {
  await database.close()
}
