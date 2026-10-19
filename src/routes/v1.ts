import type { FastifyInstance } from 'fastify'
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
            response: {
              200: serviceSchema,
              400: errorResponseSchema,
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
    },
    { prefix: '/v1' },
  )
}
