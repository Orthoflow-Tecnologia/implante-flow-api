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
