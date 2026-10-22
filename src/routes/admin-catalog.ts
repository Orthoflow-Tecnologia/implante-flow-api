import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { forbidUnlessAdmin } from '../auth/plugin.js'
import { errorResponseSchema } from '../http/error-handler.js'
import {
  CatalogValidationError,
  createManufacturer,
  createModel,
  createSize,
  listManufacturers,
  listModels,
  listSizes,
  updateManufacturer,
  updateModel,
  updateSize,
} from '../ops/admin-catalog.js'

function requirePermission(
  request: FastifyRequest,
  reply: FastifyReply,
  permission: string,
): boolean {
  return forbidUnlessAdmin(request, reply, permission)
}

function badRequest(reply: FastifyReply, requestId: string, message: string) {
  return reply.status(400).send({
    error: { code: 'validation_error', message, requestId },
  })
}

function unavailable(reply: FastifyReply, requestId: string) {
  return reply.status(503).send({
    error: { code: 'unavailable', message: 'Banco indisponível.', requestId },
  })
}

const manufacturerSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'active', 'modelCount'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    active: { type: 'boolean' },
    modelCount: { type: 'integer' },
  },
} as const

const modelSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'manufacturerId', 'name', 'active'],
  properties: {
    id: { type: 'string' },
    manufacturerId: { type: 'string' },
    name: { type: 'string' },
    active: { type: 'boolean' },
  },
} as const

const sizeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'label', 'active'],
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    active: { type: 'boolean' },
  },
} as const

export async function registerAdminCatalogRoutes(admin: FastifyInstance): Promise<void> {
  admin.get(
    '/catalog/manufacturers',
    {
      schema: {
        tags: ['admin'],
        operationId: 'listAdminCatalogManufacturers',
        summary: 'Lista fabricantes de implante',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { includeInactive: { type: 'string' } },
        },
        response: {
          200: { type: 'array', items: manufacturerSchema },
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requirePermission(request, reply, 'catalogs:manage')) return
      if (!admin.database) return unavailable(reply, request.id)
      const query = request.query as { includeInactive?: string }
      return listManufacturers(admin.database, {
        includeInactive: query.includeInactive === 'true' || query.includeInactive === '1',
      })
    },
  )

  admin.post(
    '/catalog/manufacturers',
    {
      schema: {
        tags: ['admin'],
        operationId: 'createAdminCatalogManufacturer',
        summary: 'Cria fabricante de implante',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: {
            name: { type: 'string' },
            id: { type: 'string' },
          },
        },
        response: {
          201: manufacturerSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requirePermission(request, reply, 'catalogs:manage')) return
      if (!admin.database) return unavailable(reply, request.id)
      const body = request.body as { name?: string; id?: string }
      try {
        const created = await createManufacturer(admin.database, {
          name: body.name ?? '',
          ...(body.id ? { id: body.id } : {}),
        })
        return reply.status(201).send(created)
      } catch (error) {
        if (error instanceof CatalogValidationError) {
          return badRequest(reply, request.id, error.message)
        }
        throw error
      }
    },
  )

  admin.patch(
    '/catalog/manufacturers/:manufacturerId',
    {
      schema: {
        tags: ['admin'],
        operationId: 'updateAdminCatalogManufacturer',
        summary: 'Atualiza fabricante de implante',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['manufacturerId'],
          properties: { manufacturerId: { type: 'string' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            active: { type: 'boolean' },
          },
        },
        response: {
          200: manufacturerSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requirePermission(request, reply, 'catalogs:manage')) return
      if (!admin.database) return unavailable(reply, request.id)
      const { manufacturerId } = request.params as { manufacturerId: string }
      const body = request.body as { name?: string; active?: boolean }
      try {
        const updated = await updateManufacturer(admin.database, manufacturerId, body)
        if (!updated) {
          return reply.status(404).send({
            error: {
              code: 'not_found',
              message: 'Fabricante não encontrado.',
              requestId: request.id,
            },
          })
        }
        return updated
      } catch (error) {
        if (error instanceof CatalogValidationError) {
          return badRequest(reply, request.id, error.message)
        }
        throw error
      }
    },
  )

  admin.get(
    '/catalog/manufacturers/:manufacturerId/models',
    {
      schema: {
        tags: ['admin'],
        operationId: 'listAdminCatalogModels',
        summary: 'Lista modelos de um fabricante',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['manufacturerId'],
          properties: { manufacturerId: { type: 'string' } },
        },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { includeInactive: { type: 'string' } },
        },
        response: {
          200: { type: 'array', items: modelSchema },
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requirePermission(request, reply, 'catalogs:manage')) return
      if (!admin.database) return unavailable(reply, request.id)
      const { manufacturerId } = request.params as { manufacturerId: string }
      const query = request.query as { includeInactive?: string }
      return listModels(admin.database, manufacturerId, {
        includeInactive: query.includeInactive === 'true' || query.includeInactive === '1',
      })
    },
  )

  admin.post(
    '/catalog/manufacturers/:manufacturerId/models',
    {
      schema: {
        tags: ['admin'],
        operationId: 'createAdminCatalogModel',
        summary: 'Cria modelo de implante',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['manufacturerId'],
          properties: { manufacturerId: { type: 'string' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: {
            name: { type: 'string' },
            id: { type: 'string' },
          },
        },
        response: {
          201: modelSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requirePermission(request, reply, 'catalogs:manage')) return
      if (!admin.database) return unavailable(reply, request.id)
      const { manufacturerId } = request.params as { manufacturerId: string }
      const body = request.body as { name?: string; id?: string }
      try {
        const created = await createModel(admin.database, manufacturerId, {
          name: body.name ?? '',
          ...(body.id ? { id: body.id } : {}),
        })
        return reply.status(201).send(created)
      } catch (error) {
        if (error instanceof CatalogValidationError) {
          return badRequest(reply, request.id, error.message)
        }
        throw error
      }
    },
  )

  admin.patch(
    '/catalog/models/:modelId',
    {
      schema: {
        tags: ['admin'],
        operationId: 'updateAdminCatalogModel',
        summary: 'Atualiza modelo de implante',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['modelId'],
          properties: { modelId: { type: 'string' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            active: { type: 'boolean' },
          },
        },
        response: {
          200: modelSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requirePermission(request, reply, 'catalogs:manage')) return
      if (!admin.database) return unavailable(reply, request.id)
      const { modelId } = request.params as { modelId: string }
      const body = request.body as { name?: string; active?: boolean }
      try {
        const updated = await updateModel(admin.database, modelId, body)
        if (!updated) {
          return reply.status(404).send({
            error: {
              code: 'not_found',
              message: 'Modelo não encontrado.',
              requestId: request.id,
            },
          })
        }
        return updated
      } catch (error) {
        if (error instanceof CatalogValidationError) {
          return badRequest(reply, request.id, error.message)
        }
        throw error
      }
    },
  )

  admin.get(
    '/catalog/sizes',
    {
      schema: {
        tags: ['admin'],
        operationId: 'listAdminCatalogSizes',
        summary: 'Lista tamanhos de implante',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { includeInactive: { type: 'string' } },
        },
        response: {
          200: { type: 'array', items: sizeSchema },
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requirePermission(request, reply, 'catalogs:manage')) return
      if (!admin.database) return unavailable(reply, request.id)
      const query = request.query as { includeInactive?: string }
      return listSizes(admin.database, {
        includeInactive: query.includeInactive === 'true' || query.includeInactive === '1',
      })
    },
  )

  admin.post(
    '/catalog/sizes',
    {
      schema: {
        tags: ['admin'],
        operationId: 'createAdminCatalogSize',
        summary: 'Cria tamanho de implante',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['label'],
          properties: {
            label: { type: 'string' },
            id: { type: 'string' },
          },
        },
        response: {
          201: sizeSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requirePermission(request, reply, 'catalogs:manage')) return
      if (!admin.database) return unavailable(reply, request.id)
      const body = request.body as { label?: string; id?: string }
      try {
        const created = await createSize(admin.database, {
          label: body.label ?? '',
          ...(body.id ? { id: body.id } : {}),
        })
        return reply.status(201).send(created)
      } catch (error) {
        if (error instanceof CatalogValidationError) {
          return badRequest(reply, request.id, error.message)
        }
        throw error
      }
    },
  )

  admin.patch(
    '/catalog/sizes/:sizeId',
    {
      schema: {
        tags: ['admin'],
        operationId: 'updateAdminCatalogSize',
        summary: 'Atualiza tamanho de implante',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['sizeId'],
          properties: { sizeId: { type: 'string' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            label: { type: 'string' },
            active: { type: 'boolean' },
          },
        },
        response: {
          200: sizeSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requirePermission(request, reply, 'catalogs:manage')) return
      if (!admin.database) return unavailable(reply, request.id)
      const { sizeId } = request.params as { sizeId: string }
      const body = request.body as { label?: string; active?: boolean }
      try {
        const updated = await updateSize(admin.database, sizeId, body)
        if (!updated) {
          return reply.status(404).send({
            error: {
              code: 'not_found',
              message: 'Tamanho não encontrado.',
              requestId: request.id,
            },
          })
        }
        return updated
      } catch (error) {
        if (error instanceof CatalogValidationError) {
          return badRequest(reply, request.id, error.message)
        }
        throw error
      }
    },
  )
}
