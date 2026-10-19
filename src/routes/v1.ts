import type { FastifyInstance } from 'fastify'
import { forbidUnlessSelf } from '../auth/plugin.js'
import { errorResponseSchema } from '../http/error-handler.js'

const serviceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['service', 'version', 'apiVersion', 'environment'],
  properties: {
    service: { type: 'string', const: 'implante-flow-api' },
    version: { type: 'string' },
    apiVersion: { type: 'string', const: 'v1' },
    environment: { type: 'string', enum: ['development', 'staging', 'production', 'test'] },
  },
} as const

export async function registerV1Routes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (v1) => {
      v1.get(
        '/',
        {
          schema: {
            tags: ['operacao'],
            operationId: 'getApiV1',
            summary: 'Identidade da API v1',
            querystring: {
              type: 'object',
              additionalProperties: false,
              properties: {},
            },
            security: [{ bearerAuth: [] }],
            response: {
              200: serviceSchema,
              400: errorResponseSchema,
              401: errorResponseSchema,
            },
          },
        },
        async () => ({
          service: v1.config.serviceName,
          version: v1.config.serviceVersion,
          apiVersion: 'v1' as const,
          environment: v1.config.appEnv,
        }),
      )

      v1.get(
        '/session',
        {
          schema: {
            tags: ['operacao'],
            operationId: 'getSession',
            summary: 'Dentista dono do access token',
            security: [{ bearerAuth: [] }],
            response: {
              200: {
                type: 'object',
                additionalProperties: false,
                required: ['dentistId'],
                properties: { dentistId: { type: 'string', format: 'uuid' } },
              },
              401: errorResponseSchema,
            },
          },
        },
        async (request) => ({ dentistId: request.dentist?.id }),
      )

      v1.get(
        '/dentists/:dentistId',
        {
          schema: {
            tags: ['operacao'],
            operationId: 'getDentist',
            summary: 'Confere se o token é do dentista informado',
            security: [{ bearerAuth: [] }],
            params: {
              type: 'object',
              additionalProperties: false,
              required: ['dentistId'],
              properties: { dentistId: { type: 'string', format: 'uuid' } },
            },
            response: {
              200: {
                type: 'object',
                additionalProperties: false,
                required: ['dentistId'],
                properties: { dentistId: { type: 'string', format: 'uuid' } },
              },
              401: errorResponseSchema,
              403: errorResponseSchema,
            },
          },
        },
        async (request, reply) => {
          const { dentistId } = request.params as { dentistId: string }
          if (!forbidUnlessSelf(request, reply, dentistId)) return
          return { dentistId }
        },
      )
    },
    { prefix: '/v1' },
  )
}
