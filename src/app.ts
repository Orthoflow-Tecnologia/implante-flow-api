import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import Fastify, { LogController, type FastifyInstance } from 'fastify'
import type { Authenticate } from './auth/plugin.js'
import { registerAuth } from './auth/plugin.js'
import { type AppConfig, loadConfig } from './config.js'
import type { Database } from './db/database.js'
import type { DocumentSigner } from './certificates/issue.js'
import type { ObjectStore } from './files/object-store.js'
import { registerErrorHandler } from './http/error-handler.js'
import { requestIdFrom } from './http/request-id.js'
import { registerCertificateRoutes } from './routes/certificates.js'
import { registerCatalogRoutes } from './routes/catalog.js'
import { registerClinicRoutes } from './routes/clinic.js'
import { registerPhotoRoutes } from './routes/photos.js'
import { registerReportRoutes } from './routes/reports.js'
import { registerPracticeRoutes } from './routes/practice.js'
import { registerHealthRoutes, type ReadinessCheck } from './routes/health.js'
import { registerV1Routes } from './routes/v1.js'
import './types.js'

export type BuildAppOptions = {
  config?: AppConfig
  readinessCheck?: ReadinessCheck
  authenticate?: Authenticate
  database?: Database | null
  objectStore?: ObjectStore | null
  documentSigner?: DocumentSigner
  clock?: () => Date
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig()
  const readinessCheck = options.readinessCheck ?? (async () => true)

  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie'],
        censor: '[redacted]',
      },
    },
    genReqId: (request) => requestIdFrom(request.headers),
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    ajv: {
      customOptions: {
        removeAdditional: false,
        allErrors: true,
      },
    },
  })

  app.decorate('config', config)
  app.decorate('database', options.database ?? null)
  app.decorate('objectStore', options.objectStore ?? null)
  app.decorate('clock', options.clock ?? (() => new Date()))

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id)
  })

  registerErrorHandler(app)

  await app.register(helmet, config.openApiEnabled ? { contentSecurityPolicy: false } : {})

  if (config.corsOrigins.length > 0) {
    await app.register(cors, {
      origin: [...config.corsOrigins],
      credentials: false,
    })
  }

  if (config.openApiEnabled) {
    await app.register(swagger, {
      transform: ({ schema, url }) => ({
        schema,
        url: url.length > 1 && url.endsWith('/') ? url.slice(0, -1) : url,
      }),
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'Implante Flow API',
          description:
            'API clínica do prontuário Implante Flow. Rotas de negócio ficam em /v1. Probes /health e /ready são públicos e não versionados.',
          version: config.serviceVersion,
        },
        servers: [{ url: '/' }],
        tags: [
          { name: 'operacao', description: 'Contrato de execução e identidade da API.' },
          { name: 'prontuario', description: 'Pacientes, procedimentos, consultas e retornos.' },
          { name: 'catalogo', description: 'Fabricantes e modelos somente leitura.' },
        ],
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          },
        },
      },
    })
    await app.register(swaggerUi, {
      routePrefix: '/docs',
      staticCSP: true,
    })
  }

  registerHealthRoutes(app, readinessCheck)
  registerAuth(app, options.authenticate)
  await registerV1Routes(app)
  await registerClinicRoutes(app)
  await registerCatalogRoutes(app)
  await registerPracticeRoutes(app)
  await registerPhotoRoutes(app)
  await registerCertificateRoutes(app, options.documentSigner)
  await registerReportRoutes(app)

  return app
}
