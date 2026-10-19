import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Database } from '../db/database.js'
import {
  createLocation,
  getProfile,
  inactivateLocation,
  listLocations,
  replacePatientLocations,
  setDefaultLocation,
  updateLocation,
  updateProfile,
} from '../practice/locations.js'
import { errorResponseSchema } from '../http/error-handler.js'

function databaseOf(request: FastifyRequest, reply: FastifyReply): Database | undefined {
  if (request.server.database && request.dentist) return request.server.database
  void reply.status(503).send({
    error: { code: 'unavailable', message: 'Prontuário indisponível.', requestId: request.id },
  })
  return undefined
}

const denied = (request: FastifyRequest) => ({
  error: { code: 'forbidden', message: 'Acesso negado.', requestId: request.id },
})

export async function registerPracticeRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (v1) => {
    v1.get('/profile', { schema: { tags: ['perfil'], security: [{ bearerAuth: [] }], response: { 401: errorResponseSchema, 403: errorResponseSchema, 503: errorResponseSchema } } }, async (request, reply) => {
      const database = databaseOf(request, reply)
      if (!database || !request.dentist) return
      const profile = await getProfile(database, request.dentist.id)
      if (!profile) return reply.status(403).send(denied(request))
      return profile
    })

    v1.patch('/profile', { schema: { tags: ['perfil'], security: [{ bearerAuth: [] }], body: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, phone: { type: 'string' } } }, response: { 200: { type: 'object', additionalProperties: true }, 400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema } } }, async (request, reply) => {
      const database = databaseOf(request, reply)
      if (!database || !request.dentist) return
      const profile = await updateProfile(database, request.dentist.id, request.body as { name?: unknown; phone?: unknown })
      if (!profile) return reply.status(403).send(denied(request))
      return profile
    })

    v1.get('/locations', { schema: { tags: ['perfil'], security: [{ bearerAuth: [] }] } }, async (request, reply) => {
      const database = databaseOf(request, reply)
      if (!database || !request.dentist) return
      return listLocations(database, request.dentist.id)
    })

    v1.post('/locations', { schema: { tags: ['perfil'], security: [{ bearerAuth: [] }], body: { type: 'object' }, response: { 201: { type: 'object', additionalProperties: true }, 400: errorResponseSchema } } }, async (request, reply) => {
      const database = databaseOf(request, reply)
      if (!database || !request.dentist) return
      const location = await createLocation(database, request.dentist.id, request.body as { name?: unknown; address?: unknown })
      return reply.status(201).send(location)
    })

    v1.patch('/locations/:locationId', { schema: { tags: ['perfil'], security: [{ bearerAuth: [] }], body: { type: 'object' }, response: { 400: errorResponseSchema, 403: errorResponseSchema } } }, async (request, reply) => {
      const database = databaseOf(request, reply)
      if (!database || !request.dentist) return
      const location = await updateLocation(database, request.dentist.id, (request.params as { locationId: string }).locationId, request.body as { name?: unknown; address?: unknown })
      if (!location) return reply.status(403).send(denied(request))
      return location
    })

    v1.post('/locations/:locationId/default', { schema: { tags: ['perfil'], security: [{ bearerAuth: [] }], response: { 400: errorResponseSchema, 403: errorResponseSchema } } }, async (request, reply) => {
      const database = databaseOf(request, reply)
      if (!database || !request.dentist) return
      const location = await setDefaultLocation(database, request.dentist.id, (request.params as { locationId: string }).locationId)
      if (!location) return reply.status(403).send(denied(request))
      return location
    })

    v1.post('/locations/:locationId/inactivate', { schema: { tags: ['perfil'], security: [{ bearerAuth: [] }], body: { type: 'object' }, response: { 400: errorResponseSchema, 403: errorResponseSchema } } }, async (request, reply) => {
      const database = databaseOf(request, reply)
      if (!database || !request.dentist) return
      const body = request.body as { replacementId?: unknown }
      const location = await inactivateLocation(
        database,
        request.dentist.id,
        (request.params as { locationId: string }).locationId,
        typeof body.replacementId === 'string' ? body.replacementId : undefined,
      )
      if (!location) return reply.status(403).send(denied(request))
      return location
    })

    v1.put('/patients/:patientId/locations', { schema: { tags: ['perfil'], security: [{ bearerAuth: [] }], body: { type: 'object', required: ['locationIds'], properties: { locationIds: { type: 'array', items: { type: 'string', format: 'uuid' } } } }, response: { 400: errorResponseSchema, 403: errorResponseSchema } } }, async (request, reply) => {
      const database = databaseOf(request, reply)
      if (!database || !request.dentist) return
      const body = request.body as { locationIds?: unknown }
      if (!Array.isArray(body.locationIds) || body.locationIds.some((id) => typeof id !== 'string')) {
        return reply.status(400).send({ error: { code: 'validation_error', message: 'Informe os locais.', requestId: request.id } })
      }
      const locationIds = await replacePatientLocations(database, request.dentist.id, (request.params as { patientId: string }).patientId, body.locationIds)
      if (!locationIds) return reply.status(403).send(denied(request))
      return { locationIds }
    })
  }, { prefix: '/v1' })
}
