import { buildApp } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig()
const app = await buildApp({ config })

let shuttingDown = false

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  app.log.info({ signal }, 'encerrando a API')
  try {
    await app.close()
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
