import { jwtVerify, type JWTVerifyGetKey } from 'jose'

export type AccessToken = {
  subject: string
  email: string
  name: string
  role?: string
  permissions: string[]
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

function permissionsClaim(payload: Record<string, unknown>): string[] {
  const value = payload.permissions
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function issuerVariants(issuer: string): string[] {
  const trimmed = issuer.endsWith('/') ? issuer.slice(0, -1) : issuer
  return [trimmed, `${trimmed}/`]
}

function audienceMatches(payload: Record<string, unknown>, expected: string): boolean {
  const audience = payload.aud
  const audiences = Array.isArray(audience) ? audience : audience === undefined ? [] : [audience]
  if (audiences.length > 0) return audiences.includes(expected)
  // Tokens de sessão do WorkOS AuthKit costumam omitir aud e carregar client_id.
  return claim(payload, 'client_id') === expected
}

export function createAccessTokenVerifier(options: {
  issuer: string
  audience: string
  keys: JWTVerifyGetKey
}): (token: string) => Promise<AccessToken> {
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, options.keys, {
        issuer: issuerVariants(options.issuer),
      })
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new InvalidAccessTokenError()
      }
      if (!audienceMatches(payload, options.audience)) {
        throw new InvalidAccessTokenError()
      }
      const role = claim(payload, 'role')
      return {
        subject: payload.sub,
        email: claim(payload, 'email'),
        name: claim(payload, 'name'),
        ...(role ? { role } : {}),
        permissions: permissionsClaim(payload),
      }
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) throw error
      throw new InvalidAccessTokenError()
    }
  }
}
