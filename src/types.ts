import type { AuthenticatedDentist } from './auth/dentist.js'
import type { AppConfig } from './config.js'
import type { Database } from './db/database.js'

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig
    database: Database | null
  }

  interface FastifyRequest {
    dentist: AuthenticatedDentist | null
  }
}
