import { readFileSync } from 'node:fs'

export const appEnvironments = ['development', 'staging', 'production', 'test'] as const
export type AppEnvironment = (typeof appEnvironments)[number]

export const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const
export type LogLevel = (typeof logLevels)[number]

export type AppConfig = {
  appEnv: AppEnvironment
  host: string
  port: number
  logLevel: LogLevel
  openApiEnabled: boolean
  corsOrigins: readonly string[]
  serviceName: 'implante-flow-api'
  serviceVersion: string
  databaseUrl: string | null
  workOs: {
    issuer: string
    audience: string
    jwksUrl: string
  } | null
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

function read(source: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = source[key]
  if (value === undefined || value.trim() === '') return undefined
  return value.trim()
}

function isAppEnvironment(value: string): value is AppEnvironment {
  return appEnvironments.some((environment) => environment === value)
}

function isLogLevel(value: string): value is LogLevel {
  return logLevels.some((level) => level === value)
}

export function readServiceVersion(): string {
  const packageJsonUrl = new URL('../package.json', import.meta.url)
  const parsed: unknown = JSON.parse(readFileSync(packageJsonUrl, 'utf8'))
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('version' in parsed) ||
    typeof parsed.version !== 'string' ||
    parsed.version.length === 0
  ) {
    throw new ConfigError('package.json sem version.')
  }
  return parsed.version
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const appEnvRaw = read(source, 'APP_ENV') ?? read(source, 'NODE_ENV') ?? 'development'
  if (!isAppEnvironment(appEnvRaw)) {
    throw new ConfigError(`APP_ENV inválido. Use ${appEnvironments.join(', ')}.`)
  }

  const portRaw = read(source, 'PORT') ?? '3000'
  if (!/^\d+$/.test(portRaw)) {
    throw new ConfigError('PORT inválido. Use um inteiro entre 1 e 65535.')
  }
  const port = Number(portRaw)
  if (port < 1 || port > 65535) {
    throw new ConfigError('PORT inválido. Use um inteiro entre 1 e 65535.')
  }

  const logLevelRaw = read(source, 'LOG_LEVEL') ?? (appEnvRaw === 'test' ? 'silent' : 'info')
  if (!isLogLevel(logLevelRaw)) {
    throw new ConfigError(`LOG_LEVEL inválido. Use ${logLevels.join(', ')}.`)
  }

  const openApiRaw = read(source, 'OPENAPI_ENABLED')
  if (openApiRaw !== undefined && openApiRaw !== 'true' && openApiRaw !== 'false') {
    throw new ConfigError('OPENAPI_ENABLED inválido. Use true ou false.')
  }

  const databaseUrl = read(source, 'DATABASE_URL') ?? null
  if ((appEnvRaw === 'production' || appEnvRaw === 'staging') && databaseUrl === null) {
    throw new ConfigError('DATABASE_URL é obrigatório em staging e production.')
  }

  const workOsIssuer = read(source, 'WORKOS_ISSUER')
  const workOsAudience = read(source, 'WORKOS_AUDIENCE')
  const workOsJwksUrl = read(source, 'WORKOS_JWKS_URL')
  const workOsValues = [workOsIssuer, workOsAudience, workOsJwksUrl]
  const workOsCount = workOsValues.filter((value) => value !== undefined).length
  if (workOsCount !== 0 && workOsCount !== 3) {
    throw new ConfigError('WORKOS_ISSUER, WORKOS_AUDIENCE e WORKOS_JWKS_URL devem ser definidos juntos.')
  }
  if ((appEnvRaw === 'production' || appEnvRaw === 'staging') && workOsCount !== 3) {
    throw new ConfigError('WorkOS é obrigatório em staging e production.')
  }
  const workOs =
    workOsIssuer && workOsAudience && workOsJwksUrl
      ? { issuer: workOsIssuer, audience: workOsAudience, jwksUrl: workOsJwksUrl }
      : null

  return {
    appEnv: appEnvRaw,
    host: read(source, 'HOST') ?? '0.0.0.0',
    port,
    logLevel: logLevelRaw,
    openApiEnabled: openApiRaw === undefined ? appEnvRaw !== 'production' : openApiRaw === 'true',
    corsOrigins: (read(source, 'CORS_ORIGINS') ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    serviceName: 'implante-flow-api',
    serviceVersion: readServiceVersion(),
    databaseUrl,
    workOs,
  }
}
