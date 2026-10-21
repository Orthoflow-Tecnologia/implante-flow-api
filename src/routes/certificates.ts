import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { issueCertificate, type DocumentSigner } from '../certificates/issue.js'
import type { Database } from '../db/database.js'
import type { ObjectStore } from '../files/object-store.js'
import { errorResponseSchema } from '../http/error-handler.js'

function context(
  request: FastifyRequest,
  reply: FastifyReply,
): { database: Database; store: ObjectStore } | undefined {
  if (request.server.database && request.server.objectStore && request.dentist) {
    return { database: request.server.database, store: request.server.objectStore }
  }
  void reply.status(503).send({
    error: { code: 'unavailable', message: 'Certificado indisponível.', requestId: request.id },
  })
  return undefined
}

export async function registerCertificateRoutes(app: FastifyInstance, signer?: DocumentSigner): Promise<void> {
  await app.register(async (v1) => {
    v1.post(
      '/procedures/:procedureId/certificates',
      {
        schema: {
          tags: ['certificado'],
          security: [{ bearerAuth: [] }],
          response: {
            201: { type: 'object', additionalProperties: true },
            400: errorResponseSchema,
            403: errorResponseSchema,
            503: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const files = context(request, reply)
        if (!files || !request.dentist) return
        const raw = request.body
        const body =
          raw && typeof raw === 'object' && !Array.isArray(raw)
            ? (raw as { copies?: number; locationId?: string })
            : {}
        const issued = await issueCertificate(
          files.database,
          files.store,
          request.dentist.id,
          (request.params as { procedureId: string }).procedureId,
          body,
          signer,
        )
        if (!issued) {
          return reply.status(403).send({ error: { code: 'forbidden', message: 'Acesso negado.', requestId: request.id } })
        }
        return reply.status(201).send(issued)
      },
    )
  }, { prefix: '/v1' })
}
