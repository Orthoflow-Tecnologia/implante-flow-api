import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { InvalidAccessTokenError } from './access-token.js'
import type { AuthenticatedDentist } from './dentist.js'

export type Authenticate = (authorization: string | undefined) => Promise<AuthenticatedDentist>

const unauthorizedBody = (requestId: string) => ({
  error: {
    code: 'unauthorized',
    message: 'Credencial ausente ou inválida.',
    requestId,
  },
})

const adminPermissions = new Set([
  'users:read',
  'users:write',
  'integrations:manage',
  'catalogs:manage',
  'settings:manage',
  'audit:read',
  'dashboard:read',
])

function isAdminActor(dentist: NonNullable<FastifyRequest['dentist']>): boolean {
  if (dentist.role === 'admin') return true
  return dentist.permissions.some((permission) => adminPermissions.has(permission))
}

export function forbidUnlessSelf(
  request: FastifyRequest,
  reply: FastifyReply,
  dentistId: string,
): boolean {
  if (request.dentist?.id === dentistId) return true
  void reply.status(403).send({
    error: {
      code: 'forbidden',
      message: 'Acesso negado.',
      requestId: request.id,
    },
  })
  return false
}

export function forbidUnlessAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  permission?: string,
): boolean {
  const dentist = request.dentist
  if (!dentist || !isAdminActor(dentist)) {
    void reply.status(403).send({
      error: {
        code: 'forbidden',
        message: 'Acesso administrativo negado.',
        requestId: request.id,
      },
    })
    return false
  }
  if (
    permission &&
    dentist.role !== 'admin' &&
    !dentist.permissions.includes(permission)
  ) {
    void reply.status(403).send({
      error: {
        code: 'forbidden',
        message: 'Permissão insuficiente para esta operação.',
        requestId: request.id,
      },
    })
    return false
  }
  return true
}

function isPublicPath(url: string): boolean {
  const path = url.split('?')[0] ?? url
  return path === '/health' || path === '/ready' || path === '/docs' || path.startsWith('/docs/')
}

export function registerAuth(app: FastifyInstance, authenticate: Authenticate | undefined): void {
  app.decorateRequest('dentist', null)
  app.addHook('onRequest', async (request, reply) => {
    if (isPublicPath(request.url)) return
    if (!authenticate) {
      return reply.status(401).send(unauthorizedBody(request.id))
    }
    try {
      request.dentist = await authenticate(request.headers.authorization)
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) {
        return reply.status(401).send(unauthorizedBody(request.id))
      }
      throw error
    }
  })
}
