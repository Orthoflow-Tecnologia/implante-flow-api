import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Database } from '../db/database.js'
import type { ObjectStore } from '../files/object-store.js'
import { createPhotoUpload, readPhotoUrl } from '../files/photos.js'
import { errorResponseSchema } from '../http/error-handler.js'

function context(
  request: FastifyRequest,
  reply: FastifyReply,
): { database: Database; store: ObjectStore } | undefined {
  if (request.server.database && request.server.objectStore && request.dentist) {
    return { database: request.server.database, store: request.server.objectStore }
  }
  void reply.status(503).send({
    error: { code: 'unavailable', message: 'Arquivos indisponíveis.', requestId: request.id },
  })
  return undefined
}

export async function registerPhotoRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (v1) => {
    v1.post(
      '/procedures/:procedureId/photos',
      {
        schema: {
          tags: ['arquivos'],
          security: [{ bearerAuth: [] }],
          body: { type: 'object' },
          response: { 201: { type: 'object', additionalProperties: true }, 400: errorResponseSchema, 403: errorResponseSchema, 503: errorResponseSchema },
        },
      },
      async (request, reply) => {
        const files = context(request, reply)
        if (!files || !request.dentist) return
        const photo = await createPhotoUpload(
          files.database,
          files.store,
          request.dentist.id,
          (request.params as { procedureId: string }).procedureId,
          request.body as { contentType?: unknown; byteSize?: unknown; caption?: unknown; visitId?: unknown },
        )
        if (!photo) {
          return reply.status(403).send({ error: { code: 'forbidden', message: 'Acesso negado.', requestId: request.id } })
        }
        return reply.status(201).send(photo)
      },
    )

    v1.get(
      '/photos/:photoId',
      {
        schema: {
          tags: ['arquivos'],
          security: [{ bearerAuth: [] }],
          response: { 200: { type: 'object', additionalProperties: true }, 403: errorResponseSchema, 503: errorResponseSchema },
        },
      },
      async (request, reply) => {
        const files = context(request, reply)
        if (!files || !request.dentist) return
        const photo = await readPhotoUrl(
          files.database,
          files.store,
          request.dentist.id,
          (request.params as { photoId: string }).photoId,
        )
        if (!photo) {
          return reply.status(403).send({ error: { code: 'forbidden', message: 'Acesso negado.', requestId: request.id } })
        }
        return photo
      },
    )
  }, { prefix: '/v1' })
}
