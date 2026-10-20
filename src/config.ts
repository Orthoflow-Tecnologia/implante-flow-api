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
  s3: {
    bucket: string
    region: string
    endpoint?: string
    publicEndpoint?: string
    accessKeyId?: string
    secretAccessKey?: string
  } | null
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
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
  const s3Bucket = read(source, 'S3_BUCKET')
  const s3Endpoint = read(source, 'S3_ENDPOINT')
  const s3PublicEndpoint = read(source, 'S3_PUBLIC_ENDPOINT')
  const s3AccessKeyId = read(source, 'S3_ACCESS_KEY_ID')
  const s3SecretAccessKey = read(source, 'S3_SECRET_ACCESS_KEY')
  const localS3Count = [s3Endpoint, s3AccessKeyId, s3SecretAccessKey].filter((value) => value !== undefined).length
  if (localS3Count !== 0 && localS3Count !== 3) {
    throw new ConfigError('S3_ENDPOINT, S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY devem ser definidos juntos.')
  }
  if (localS3Count === 3 && s3Bucket === undefined) {
    throw new ConfigError('S3_BUCKET é obrigatório quando o endpoint local está definido.')
  }
  if (s3Endpoint !== undefined && !isHttpUrl(s3Endpoint)) {
    throw new ConfigError('S3_ENDPOINT inválido. Use uma URL http ou https.')
  }
  if (s3PublicEndpoint !== undefined) {
    if (localS3Count !== 3) {
      throw new ConfigError('S3_PUBLIC_ENDPOINT exige o endpoint local completo.')
    }
    if (!isHttpUrl(s3PublicEndpoint)) {
      throw new ConfigError('S3_PUBLIC_ENDPOINT inválido. Use uma URL http ou https.')
    }
  }
  const s3 = s3Bucket
    ? {
        bucket: s3Bucket,
        region: read(source, 'S3_REGION') ?? 'sa-east-1',
        ...(s3Endpoint && s3AccessKeyId && s3SecretAccessKey
          ? {
              endpoint: s3Endpoint,
              accessKeyId: s3AccessKeyId,
              secretAccessKey: s3SecretAccessKey,
              ...(s3PublicEndpoint ? { publicEndpoint: s3PublicEndpoint } : {}),
            }
          : {}),
      }
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
    s3,
  }
}
