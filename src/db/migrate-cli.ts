import { loadConfig } from '../config.js'
import { migrate } from './migrate.js'
import { PgDatabase } from './pg-database.js'

const config = loadConfig()
if (!config.databaseUrl) {
  throw new Error('DATABASE_URL é obrigatório para migrar.')
}

const database = new PgDatabase(config.databaseUrl)
try {
  const applied = await migrate(database)
  console.log(applied.length === 0 ? 'nenhuma migration pendente' : applied.join('\n'))
} finally {
  await database.close()
}
