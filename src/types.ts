import type { AuthenticatedDentist } from './auth/dentist.js'
import type { AppConfig } from './config.js'
import type { Database } from './db/database.js'
import type { ObjectStore } from './files/object-store.js'

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig
    database: Database | null
    objectStore: ObjectStore | null
  }

  interface FastifyRequest {
    dentist: AuthenticatedDentist | null
  }
}
