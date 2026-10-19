import { jwtVerify, type JWTVerifyGetKey } from 'jose'

export type AccessToken = {
  subject: string
  email: string
  name: string
}

export class InvalidAccessTokenError extends Error {
  constructor() {
    super('Credencial ausente ou inválida.')
    this.name = 'InvalidAccessTokenError'
  }
}

export function bearerToken(authorization: string | undefined): string {
  if (!authorization?.startsWith('Bearer ')) throw new InvalidAccessTokenError()
  const token = authorization.slice('Bearer '.length).trim()
  if (token.length === 0 || token.includes(' ')) throw new InvalidAccessTokenError()
  return token
}

function claim(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  return typeof value === 'string' ? value : ''
}

export function createAccessTokenVerifier(options: {
  issuer: string
  audience: string
  keys: JWTVerifyGetKey
}): (token: string) => Promise<AccessToken> {
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, options.keys, {
        issuer: options.issuer,
        audience: options.audience,
      })
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new InvalidAccessTokenError()
      }
      return {
        subject: payload.sub,
        email: claim(payload, 'email'),
        name: claim(payload, 'name'),
      }
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) throw error
      throw new InvalidAccessTokenError()
    }
  }
}
