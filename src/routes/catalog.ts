import type { FastifyInstance } from 'fastify'
import { errorResponseSchema } from '../http/error-handler.js'

type ManufacturerRow = { id: string; name: string }
type ModelRow = { id: string; manufacturer_id: string; name: string }
type SizeRow = { id: string; label: string }
type ReferenceRow = {
  id: string
  manufacturer_id: string
  model_id: string
  reference: string
  size_id: string
  anvisa: string
}

export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (v1) => {
      v1.get(
        '/catalog/implants',
        {
          schema: {
            tags: ['catalogo'],
            operationId: 'listImplantCatalog',
            summary: 'Fabricantes, modelos, referências e tamanhos de implante',
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
            const manufacturers = await tx.query<ManufacturerRow>(
              'SELECT id, name FROM implant_manufacturers ORDER BY name',
            )
            const models = await tx.query<ModelRow>(
              'SELECT id, manufacturer_id, name FROM implant_models ORDER BY name',
            )
            const sizes = await tx.query<SizeRow>('SELECT id, label FROM implant_sizes ORDER BY label')
            const references = await tx.query<ReferenceRow>(
              `SELECT id, manufacturer_id, model_id, reference, size_id, anvisa
               FROM implant_references ORDER BY reference`,
            )
            const sizeById = new Map(sizes.map((size) => [size.id, size.label]))
            const modelById = new Map(models.map((model) => [model.id, model.name]))
            return {
              manufacturers: manufacturers.map((manufacturer) => ({
                id: manufacturer.id,
                name: manufacturer.name,
                models: models
                  .filter((model) => model.manufacturer_id === manufacturer.id)
                  .map((model) => ({ id: model.id, name: model.name })),
                references: references
                  .filter((item) => item.manufacturer_id === manufacturer.id)
                  .map((item) => ({
                    id: item.id,
                    reference: item.reference,
                    model: modelById.get(item.model_id) ?? '',
                    size: sizeById.get(item.size_id) ?? '',
                    anvisa: item.anvisa,
                  })),
              })),
              sizes,
            }
          })
        },
      )

      v1.get(
        '/catalog/implants/lookup',
        {
          schema: {
            tags: ['catalogo'],
            operationId: 'lookupImplantReference',
            summary: 'Busca modelo pela referência comercial exata do fabricante',
            security: [{ bearerAuth: [] }],
            querystring: {
              type: 'object',
              required: ['manufacturer', 'reference'],
              properties: {
                manufacturer: { type: 'string' },
                reference: { type: 'string' },
              },
            },
            response: { 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema, 503: errorResponseSchema },
          },
        },
        async (request, reply) => {
          if (!request.server.database || !request.dentist) {
            return reply.status(503).send({
              error: { code: 'unavailable', message: 'Catálogo indisponível.', requestId: request.id },
            })
          }
          const query = request.query as { manufacturer?: string; reference?: string }
          const manufacturer = query.manufacturer?.trim() ?? ''
          const reference = query.reference?.trim() ?? ''
          if (!manufacturer || !reference) {
            return reply.status(400).send({
              error: {
                code: 'validation_error',
                message: 'Informe fabricante e referência comercial.',
                requestId: request.id,
              },
            })
          }
          return request.server.database.withDentist(request.dentist.id, async (tx) => {
            const rows = await tx.query<{
              manufacturer: string
              model: string
              reference: string
              size: string
              anvisa: string
            }>(
              `SELECT m.name AS manufacturer,
                      md.name AS model,
                      r.reference,
                      s.label AS size,
                      r.anvisa
               FROM implant_references r
               JOIN implant_manufacturers m ON m.id = r.manufacturer_id
               JOIN implant_models md ON md.id = r.model_id
               JOIN implant_sizes s ON s.id = r.size_id
               WHERE m.active AND md.active AND r.active AND s.active
                 AND lower(m.name) = lower($1)
                 AND lower(r.reference) = lower($2)`,
              [manufacturer, reference],
            )
            if (rows.length === 0) {
              return reply.status(404).send({
                error: {
                  code: 'not_found',
                  message: 'Referência não encontrada para este fabricante.',
                  requestId: request.id,
                },
              })
            }
            if (rows.length > 1) {
              return reply.status(404).send({
                error: {
                  code: 'ambiguous',
                  message: 'Referência ambígua no catálogo. Corrija o valor informado.',
                  requestId: request.id,
                },
              })
            }
            return rows[0]
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
