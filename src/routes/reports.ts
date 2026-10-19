import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Database } from '../db/database.js'
import { errorResponseSchema } from '../http/error-handler.js'
import {
  brasiliaDate,
  parseReportScope,
  reportAppointments,
  reportPatients,
  reportSummary,
} from '../reports/queries.js'

function databaseOf(request: FastifyRequest, reply: FastifyReply): Database | undefined {
  if (request.server.database && request.dentist) return request.server.database
  void reply.status(503).send({
    error: { code: 'unavailable', message: 'Relatórios indisponíveis.', requestId: request.id },
  })
  return undefined
}

const querySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    from: { type: 'string' },
    to: { type: 'string' },
    modality: { type: 'string' },
    patientId: { type: 'string' },
    q: { type: 'string' },
    status: { type: 'string' },
    kind: { type: 'string' },
    horizon: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    offset: { type: 'integer', minimum: 0 },
  },
} as const

const routeSchema = {
  tags: ['relatorios'],
  security: [{ bearerAuth: [] }],
  querystring: querySchema,
  response: { 400: errorResponseSchema, 503: errorResponseSchema },
}

export async function registerReportRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (v1) => {
    v1.get('/reports/summary', { schema: { ...routeSchema, operationId: 'reportSummary' } }, async (request, reply) => {
      const database = databaseOf(request, reply)
      if (!database || !request.dentist) return
      return reportSummary(
        database,
        request.dentist.id,
        parseReportScope(request.query as Record<string, unknown>, today(request), { period: 'required' }),
      )
    })

    v1.get('/reports/patients', { schema: { ...routeSchema, operationId: 'reportPatients' } }, async (request, reply) => {
      const database = databaseOf(request, reply)
      if (!database || !request.dentist) return
      const query = request.query as Record<string, unknown>
      const kind = query['kind']
      if (kind !== 'onTime' && kind !== 'missed' && kind !== 'overdue') {
        return reply.status(400).send({
          error: { code: 'validation_error', message: 'Lista de pacientes inválida.', requestId: request.id },
        })
      }
      return reportPatients(
        database,
        request.dentist.id,
        kind,
        parseReportScope(query, today(request), { period: kind === 'missed' ? 'required' : 'optional' }),
      )
    })

    v1.get('/reports/appointments', { schema: { ...routeSchema, operationId: 'reportAppointments' } }, async (request, reply) => {
      const database = databaseOf(request, reply)
      if (!database || !request.dentist) return
      const query = request.query as Record<string, unknown>
      const kind = query['kind']
      if (kind !== 'upcoming' && kind !== 'completed' && kind !== 'missed' && kind !== 'overdue') {
        return reply.status(400).send({
          error: { code: 'validation_error', message: 'Lista de retornos inválida.', requestId: request.id },
        })
      }
      return reportAppointments(
        database,
        request.dentist.id,
        kind,
        parseReportScope(query, today(request), { period: kind === 'overdue' ? 'optional' : 'required' }),
      )
    })
  }, { prefix: '/v1' })
}

function today(request: FastifyRequest): string {
  return brasiliaDate(request.server.clock())
}
