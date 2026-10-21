import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { forbidUnlessAdmin } from '../auth/plugin.js'
import { errorResponseSchema } from '../http/error-handler.js'

function parsePositiveInt(value: unknown, fallback: number, max = 100): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : fallback
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.min(parsed, max)
}

function requirePermission(
  request: FastifyRequest,
  reply: FastifyReply,
  permission: string,
): boolean {
  return forbidUnlessAdmin(request, reply, permission)
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (admin) => {
      admin.addHook('preHandler', async (request, reply) => {
        if (!forbidUnlessAdmin(request, reply)) return
      })

      admin.get(
        '/dashboard/overview',
        {
          schema: {
            tags: ['admin'],
            operationId: 'getAdminDashboardOverview',
            summary: 'Indicadores operacionais agregados',
            security: [{ bearerAuth: [] }],
            response: {
              200: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'activeUsers',
                  'syncJobs',
                  'recentFailures',
                  'integrationsOnline',
                  'integrationsTotal',
                  'generatedAt',
                ],
                properties: {
                  activeUsers: { type: 'integer' },
                  syncJobs: { type: 'integer' },
                  recentFailures: { type: 'integer' },
                  integrationsOnline: { type: 'integer' },
                  integrationsTotal: { type: 'integer' },
                  generatedAt: { type: 'string', format: 'date-time' },
                },
              },
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async (request, reply) => {
          if (!requirePermission(request, reply, 'dashboard:read')) return
          const database = admin.database
          let activeUsers = 0
          if (database) {
            const rows = await database.query<{ count: string }>(
              'SELECT COUNT(*)::text AS count FROM dentists',
            )
            activeUsers = Number.parseInt(rows[0]?.count ?? '0', 10)
          }
          return {
            activeUsers,
            syncJobs: 0,
            recentFailures: 0,
            integrationsOnline: database ? 1 : 0,
            integrationsTotal: 2,
            generatedAt: admin.clock().toISOString(),
          }
        },
      )

      admin.get(
        '/dashboard/health',
        {
          schema: {
            tags: ['admin'],
            operationId: 'listAdminServiceHealth',
            summary: 'Saúde operacional agregada',
            security: [{ bearerAuth: [] }],
            response: {
              200: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['id', 'name', 'status', 'checkedAt'],
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    status: { type: 'string', enum: ['ok', 'degraded', 'down', 'unknown'] },
                    detail: { type: 'string' },
                    checkedAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async (request, reply) => {
          if (!requirePermission(request, reply, 'dashboard:read')) return
          const checkedAt = admin.clock().toISOString()
          const databaseOk = admin.database ? await admin.database.ping() : false
          return [
            {
              id: 'api',
              name: 'API clínica',
              status: 'ok' as const,
              detail: 'Processo respondendo',
              checkedAt,
            },
            {
              id: 'postgres',
              name: 'PostgreSQL',
              status: databaseOk ? ('ok' as const) : ('down' as const),
              detail: databaseOk ? 'Ping ok' : 'Sem conexão',
              checkedAt,
            },
          ]
        },
      )

      admin.get(
        '/users',
        {
          schema: {
            tags: ['admin'],
            operationId: 'listAdminUsers',
            summary: 'Lista usuários (dentistas) com paginação',
            security: [{ bearerAuth: [] }],
            querystring: {
              type: 'object',
              additionalProperties: false,
              properties: {
                q: { type: 'string' },
                status: { type: 'string' },
                page: { type: 'string' },
                pageSize: { type: 'string' },
              },
            },
            response: {
              200: {
                type: 'object',
                additionalProperties: false,
                required: ['items', 'page', 'pageSize', 'total'],
                properties: {
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: [
                        'id',
                        'name',
                        'email',
                        'status',
                        'role',
                        'permissions',
                        'createdAt',
                      ],
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        email: { type: 'string' },
                        cro: { type: ['string', 'null'] },
                        croUf: { type: ['string', 'null'] },
                        status: { type: 'string', enum: ['active', 'invited', 'inactive'] },
                        role: { type: 'string' },
                        permissions: { type: 'array', items: { type: 'string' } },
                        createdAt: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                  page: { type: 'integer' },
                  pageSize: { type: 'integer' },
                  total: { type: 'integer' },
                },
              },
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async (request, reply) => {
          if (!requirePermission(request, reply, 'users:read')) return
          const query = request.query as {
            q?: string
            page?: string
            pageSize?: string
          }
          const page = parsePositiveInt(query.page, 1)
          const pageSize = parsePositiveInt(query.pageSize, 20, 100)
          const offset = (page - 1) * pageSize
          const database = admin.database
          if (!database) {
            return { items: [], page, pageSize, total: 0 }
          }

          const search = query.q?.trim()
          const params: unknown[] = []
          let where = ''
          if (search) {
            params.push(`%${search}%`)
            where = `WHERE name ILIKE $1 OR email ILIKE $1 OR COALESCE(cro, '') ILIKE $1`
          }

          const totalRows = await database.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM dentists ${where}`,
            params,
          )
          const total = Number.parseInt(totalRows[0]?.count ?? '0', 10)
          const listParams = [...params, pageSize, offset]
          const limitIdx = params.length + 1
          const offsetIdx = params.length + 2
          const rows = await database.query<{
            id: string
            name: string
            email: string
            cro: string | null
            cro_uf: string | null
            created_at: Date
          }>(
            `SELECT id, name, email, cro, cro_uf, created_at
             FROM dentists
             ${where}
             ORDER BY created_at DESC
             LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
            listParams,
          )

          return {
            items: rows.map((row) => ({
              id: row.id,
              name: row.name,
              email: row.email,
              cro: row.cro,
              croUf: row.cro_uf,
              status: 'active' as const,
              role: 'member',
              permissions: [] as string[],
              createdAt: row.created_at.toISOString(),
            })),
            page,
            pageSize,
            total,
          }
        },
      )

      admin.get(
        '/integrations',
        {
          schema: {
            tags: ['admin'],
            operationId: 'listAdminIntegrations',
            summary: 'Status de integrações (sem segredos)',
            security: [{ bearerAuth: [] }],
            response: {
              200: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['id', 'name', 'kind', 'status'],
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    kind: {
                      type: 'string',
                      enum: ['email', 'push', 'storage', 'catalog', 'other'],
                    },
                    status: { type: 'string', enum: ['ok', 'error', 'unknown'] },
                    lastRunAt: { type: ['string', 'null'], format: 'date-time' },
                    lastError: { type: ['string', 'null'] },
                  },
                },
              },
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async (request, reply) => {
          if (!requirePermission(request, reply, 'integrations:manage')) return
          const storageOk = Boolean(admin.objectStore)
          return [
            {
              id: 'workos',
              name: 'WorkOS AuthKit',
              kind: 'other' as const,
              status: admin.config.workOs ? ('ok' as const) : ('unknown' as const),
              lastRunAt: null,
              lastError: null,
            },
            {
              id: 's3',
              name: 'Armazenamento de objetos',
              kind: 'storage' as const,
              status: storageOk ? ('ok' as const) : ('unknown' as const),
              lastRunAt: null,
              lastError: null,
            },
          ]
        },
      )

      admin.get(
        '/catalog/jobs',
        {
          schema: {
            tags: ['admin'],
            operationId: 'listAdminCatalogJobs',
            summary: 'Jobs de sincronização de catálogo',
            security: [{ bearerAuth: [] }],
            response: {
              200: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['id', 'label', 'status'],
                  properties: {
                    id: { type: 'string' },
                    label: { type: 'string' },
                    status: {
                      type: 'string',
                      enum: ['queued', 'running', 'succeeded', 'failed'],
                    },
                    startedAt: { type: ['string', 'null'], format: 'date-time' },
                    finishedAt: { type: ['string', 'null'], format: 'date-time' },
                  },
                },
              },
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async (request, reply) => {
          if (!requirePermission(request, reply, 'catalogs:manage')) return
          return []
        },
      )

      admin.get(
        '/settings',
        {
          schema: {
            tags: ['admin'],
            operationId: 'listAdminSettings',
            summary: 'Parâmetros globais não sensíveis',
            security: [{ bearerAuth: [] }],
            response: {
              200: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['key', 'label', 'value', 'sensitive', 'updatedAt'],
                  properties: {
                    key: { type: 'string' },
                    label: { type: 'string' },
                    value: { type: 'string' },
                    sensitive: { type: 'boolean' },
                    updatedAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async (request, reply) => {
          if (!requirePermission(request, reply, 'settings:manage')) return
          const updatedAt = admin.clock().toISOString()
          return [
            {
              key: 'app_env',
              label: 'Ambiente',
              value: admin.config.appEnv,
              sensitive: false,
              updatedAt,
            },
            {
              key: 'openapi_enabled',
              label: 'OpenAPI',
              value: String(admin.config.openApiEnabled),
              sensitive: false,
              updatedAt,
            },
          ]
        },
      )

      admin.get(
        '/audit-events',
        {
          schema: {
            tags: ['admin'],
            operationId: 'listAdminAuditEvents',
            summary: 'Eventos administrativos (sem dados clínicos)',
            security: [{ bearerAuth: [] }],
            querystring: {
              type: 'object',
              additionalProperties: false,
              properties: {
                page: { type: 'string' },
                pageSize: { type: 'string' },
                action: { type: 'string' },
              },
            },
            response: {
              200: {
                type: 'object',
                additionalProperties: false,
                required: ['items', 'page', 'pageSize', 'total'],
                properties: {
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['id', 'actorEmail', 'action', 'result', 'createdAt'],
                      properties: {
                        id: { type: 'string' },
                        actorEmail: { type: 'string' },
                        action: { type: 'string' },
                        target: { type: ['string', 'null'] },
                        result: { type: 'string', enum: ['success', 'denied', 'failure'] },
                        justification: { type: ['string', 'null'] },
                        createdAt: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                  page: { type: 'integer' },
                  pageSize: { type: 'integer' },
                  total: { type: 'integer' },
                },
              },
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async (request, reply) => {
          if (!requirePermission(request, reply, 'audit:read')) return
          const query = request.query as { page?: string; pageSize?: string }
          const page = parsePositiveInt(query.page, 1)
          const pageSize = parsePositiveInt(query.pageSize, 20, 100)
          return { items: [], page, pageSize, total: 0 }
        },
      )
    },
    { prefix: '/v1/admin' },
  )
}
