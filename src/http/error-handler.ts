import type { FastifyError, FastifyInstance } from 'fastify'
import { writeSystemLogSafe } from '../ops/system-logs.js'

const clientErrorCodes: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  429: 'too_many_requests',
}

export const errorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message', 'requestId'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        requestId: { type: 'string' },
        details: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['message'],
            properties: {
              path: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
  },
} as const

type ErrorBody = {
  error: {
    code: string
    message: string
    requestId: string
    details?: { path?: string; message: string }[]
  }
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    const body: ErrorBody = {
      error: {
        code: 'not_found',
        message: 'Rota não encontrada.',
        requestId: request.id,
      },
    }
    return reply.status(404).send(body)
  })

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'falha ao processar a requisição')
      void writeSystemLogSafe(request.server.database, {
        level: 'error',
        message: 'falha ao processar a requisição',
        source: 'error-handler',
        requestId: request.id,
        context: {
          statusCode,
          errorName: error.name,
          errorMessage: error.message,
          route: request.routeOptions.url ?? request.url,
          method: request.method,
        },
      })
      const body: ErrorBody = {
        error: {
          code: 'internal_error',
          message: 'Erro interno.',
          requestId: request.id,
        },
      }
      return reply.status(500).send(body)
    }

    if (error.name === 'ClinicValidationError') {
      const clinicError = error as FastifyError & { code?: string; validation?: { message: string }[] }
      const body: ErrorBody = {
        error: {
          code: clinicError.code ?? 'validation_error',
          message: error.message,
          requestId: request.id,
          details: (clinicError.validation ?? []).map((issue) => ({
            message: issue.message ?? error.message,
          })),
        },
      }
      return reply.status(400).send(body)
    }

    if (error.validation) {
      const body: ErrorBody = {
        error: {
          code: 'validation_error',
          message: 'Requisição inválida.',
          requestId: request.id,
          details: error.validation.map((issue) => {
            const detail: { path?: string; message: string } = {
              message: issue.message ?? 'valor inválido',
            }
            if (issue.instancePath) detail.path = issue.instancePath
            return detail
          }),
        },
      }
      return reply.status(400).send(body)
    }

    const body: ErrorBody = {
      error: {
        code: clientErrorCodes[statusCode] ?? 'http_error',
        message: error.message,
        requestId: request.id,
      },
    }
    return reply.status(statusCode).send(body)
  })
}
