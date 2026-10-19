import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { migrate } from './db/migrate.js'
import { PgDatabase } from './db/pg-database.js'

const config = loadConfig()
const database = config.databaseUrl ? new PgDatabase(config.databaseUrl) : undefined
if (database) await migrate(database)
const app = await buildApp({
  config,
  readinessCheck: async () => (database ? database.ping() : true),
})

let shuttingDown = false

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  app.log.info({ signal }, 'encerrando a API')
  try {
    await app.close()
    await database?.close()
  } catch (error) {
    app.log.error({ err: error }, 'falha ao encerrar a API')
    process.exit(1)
  }
}

process.once('SIGINT', () => {
  void shutdown('SIGINT')
})
process.once('SIGTERM', () => {
  void shutdown('SIGTERM')
})

try {
  await app.listen({ host: config.host, port: config.port })
} catch (error) {
  app.log.error({ err: error }, 'falha ao iniciar a API')
  process.exit(1)
}
