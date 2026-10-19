import type { FastifyInstance } from 'fastify'

const probeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['ok', 'ready', 'unavailable'] },
  },
} as const

export type ReadinessCheck = () => Promise<boolean>

export function registerHealthRoutes(
  app: FastifyInstance,
  readinessCheck: ReadinessCheck,
): void {
  app.get(
    '/health',
    {
      schema: {
        tags: ['operacao'],
        operationId: 'getHealth',
        summary: 'Liveness do processo',
        description:
          'Probe público de processo. Não consulta banco, fila nem serviço externo e não exige autenticação.',
        response: { 200: probeSchema },
      },
    },
    async () => ({ status: 'ok' as const }),
  )

  app.get(
    '/ready',
    {
      schema: {
        tags: ['operacao'],
        operationId: 'getReady',
        summary: 'Readiness das dependências',
        description:
          'Probe público de prontidão. Responde 200 quando o processo pode atender tráfego e 503 quando uma dependência obrigatória falha. Não exige autenticação e não retorna dado clínico.',
        response: {
          200: probeSchema,
          503: probeSchema,
        },
      },
    },
    async (_request, reply) => {
      let ready = false
      try {
        ready = await readinessCheck()
      } catch (error) {
        app.log.error(
          { errName: error instanceof Error ? error.name : 'Error' },
          'verificação de readiness falhou',
        )
        ready = false
      }

      if (!ready) return reply.status(503).send({ status: 'unavailable' as const })
      return { status: 'ready' as const }
    },
  )
}
