import type { FastifyInstance } from 'fastify'
import { errorResponseSchema } from '../http/error-handler.js'

export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (v1) => {
      v1.get(
        '/catalog/implants',
        {
          schema: {
            tags: ['catalogo'],
            operationId: 'listImplantCatalog',
            summary: 'Fabricantes, modelos e tamanhos de implante',
            security: [{ bearerAuth: [] }],
            response: { 401: errorResponseSchema, 503: errorResponseSchema },
          },
        },
        async (request, reply) => {
          if (!request.server.database || !request.dentist) {
            return reply.status(503).send({
              error: { code: 'unavailable', message: 'Catálogo indisponível.', requestId: request.id },
            })
          }
          return request.server.database.withDentist(request.dentist.id, async (tx) => {
            const manufacturers = await tx.query<{ id: string; name: string }>(
              'SELECT id, name FROM implant_manufacturers ORDER BY name',
            )
            const models = await tx.query<{ id: string; manufacturer_id: string; name: string }>(
              'SELECT id, manufacturer_id, name FROM implant_models ORDER BY name',
            )
            const sizes = await tx.query<{ id: string; label: string }>('SELECT id, label FROM implant_sizes ORDER BY label')
            return {
              manufacturers: manufacturers.map((manufacturer) => ({
                ...manufacturer,
                models: models
                  .filter((model) => model.manufacturer_id === manufacturer.id)
                  .map((model) => ({ id: model.id, name: model.name })),
              })),
              sizes,
            }
          })
        },
      )

      v1.get(
        '/catalog/grafts',
        {
          schema: {
            tags: ['catalogo'],
            operationId: 'listGraftCatalog',
            summary: 'Fabricantes e modelos de enxerto',
            security: [{ bearerAuth: [] }],
            response: { 401: errorResponseSchema, 503: errorResponseSchema },
          },
        },
        async (request, reply) => {
          if (!request.server.database || !request.dentist) {
            return reply.status(503).send({
              error: { code: 'unavailable', message: 'Catálogo indisponível.', requestId: request.id },
            })
          }
          return request.server.database.withDentist(request.dentist.id, async (tx) => {
            const manufacturers = await tx.query<{ id: string; name: string }>(
              'SELECT id, name FROM graft_manufacturers ORDER BY name',
            )
            const models = await tx.query<{
              id: string
              manufacturer_id: string
              name: string
              product_type: string
              presentations: string[]
              granulometries: string[]
            }>('SELECT id, manufacturer_id, name, product_type, presentations, granulometries FROM graft_models ORDER BY name')
            return {
              manufacturers: manufacturers.map((manufacturer) => ({
                ...manufacturer,
                models: models
                  .filter((model) => model.manufacturer_id === manufacturer.id)
                  .map(({ manufacturer_id: _manufacturerId, ...model }) => model),
              })),
            }
          })
        },
      )
    },
    { prefix: '/v1' },
  )
}
