import type { Database, Queryable } from '../db/database.js'

export type SystemLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export type SystemLogInput = {
  level: SystemLogLevel
  message: string
  source?: string
  requestId?: string | null
  context?: Record<string, unknown>
}

export type SystemLogRecord = {
  id: string
  level: SystemLogLevel
  message: string
  source: string
  requestId: string | null
  context: Record<string, unknown>
  createdAt: string
}

export type ListSystemLogsParams = {
  page: number
  pageSize: number
  level?: SystemLogLevel
  q?: string
}

export type SystemLogsSummary = {
  windowHours: number
  total: number
  errors: number
  warnings: number
  info: number
  lastAt: string | null
}

export type ListSystemLogsResult = {
  items: SystemLogRecord[]
  page: number
  pageSize: number
  total: number
  summary: SystemLogsSummary
}

const pinoLevelToName: Record<number, SystemLogLevel> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
}

/** Nível Pino mínimo persistido no banco (40 = warn). */
export const PERSIST_MIN_PINO_LEVEL = 40

export function systemLogLevelFromPino(level: number): SystemLogLevel | null {
  return pinoLevelToName[level] ?? null
}

export async function writeSystemLog(
  database: Queryable,
  input: SystemLogInput,
): Promise<void> {
  const message = input.message.trim()
  if (!message) return
  await database.query(
    `INSERT INTO system_logs (level, message, source, request_id, context)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      input.level,
      message.slice(0, 4000),
      (input.source ?? 'api').slice(0, 120),
      input.requestId ?? null,
      JSON.stringify(sanitizeContext(input.context ?? {})),
    ],
  )
}

export async function writeSystemLogSafe(
  database: Queryable | null | undefined,
  input: SystemLogInput,
): Promise<void> {
  if (!database) return
  try {
    await writeSystemLog(database, input)
  } catch {
    // Nunca derruba o processo por falha ao persistir log.
  }
}

export async function listSystemLogs(
  database: Database,
  params: ListSystemLogsParams,
): Promise<ListSystemLogsResult> {
  const page = params.page
  const pageSize = params.pageSize
  const offset = (page - 1) * pageSize
  const filters: string[] = []
  const values: unknown[] = []

  if (params.level === 'error') {
    // Atalho do painel: "Erros" inclui fatal.
    filters.push(`level IN ('error', 'fatal')`)
  } else if (params.level) {
    values.push(params.level)
    filters.push(`level = $${values.length}`)
  }
  const search = params.q?.trim()
  if (search) {
    values.push(`%${search}%`)
    filters.push(
      `(message ILIKE $${values.length} OR COALESCE(request_id, '') ILIKE $${values.length} OR source ILIKE $${values.length})`,
    )
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''
  const totalRows = await database.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM system_logs ${where}`,
    values,
  )
  const total = Number.parseInt(totalRows[0]?.count ?? '0', 10)
  const limitIdx = values.length + 1
  const offsetIdx = values.length + 2
  const rows = await database.query<{
    id: string
    level: SystemLogLevel
    message: string
    source: string
    request_id: string | null
    context: Record<string, unknown> | null
    created_at: Date
  }>(
    `SELECT id, level, message, source, request_id, context, created_at
     FROM system_logs
     ${where}
     ORDER BY created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...values, pageSize, offset],
  )

  const summary = await summarizeSystemLogs(database, 24)

  return {
    items: rows.map((row) => ({
      id: row.id,
      level: row.level,
      message: row.message,
      source: row.source,
      requestId: row.request_id,
      context: row.context ?? {},
      createdAt: row.created_at.toISOString(),
    })),
    page,
    pageSize,
    total,
    summary,
  }
}

export async function summarizeSystemLogs(
  database: Database,
  windowHours = 24,
): Promise<SystemLogsSummary> {
  const rows = await database.query<{
    total: string
    errors: string
    warnings: string
    info: string
    last_at: Date | null
  }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE level IN ('error', 'fatal'))::text AS errors,
       COUNT(*) FILTER (WHERE level = 'warn')::text AS warnings,
       COUNT(*) FILTER (WHERE level = 'info')::text AS info,
       MAX(created_at) AS last_at
     FROM system_logs
     WHERE created_at >= now() - ($1::text || ' hours')::interval`,
    [String(windowHours)],
  )
  const row = rows[0]
  return {
    windowHours,
    total: Number.parseInt(row?.total ?? '0', 10),
    errors: Number.parseInt(row?.errors ?? '0', 10),
    warnings: Number.parseInt(row?.warnings ?? '0', 10),
    info: Number.parseInt(row?.info ?? '0', 10),
    lastAt: row?.last_at ? row.last_at.toISOString() : null,
  }
}

export function emptySystemLogsResult(
  page: number,
  pageSize: number,
): ListSystemLogsResult {
  return {
    items: [],
    page,
    pageSize,
    total: 0,
    summary: {
      windowHours: 24,
      total: 0,
      errors: 0,
      warnings: 0,
      info: 0,
      lastAt: null,
    },
  }
}

function sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(context)) {
    const lower = key.toLowerCase()
    if (
      lower.includes('authorization') ||
      lower.includes('password') ||
      lower.includes('secret') ||
      lower.includes('cookie') ||
      lower.includes('token')
    ) {
      out[key] = '[redacted]'
      continue
    }
    if (value === undefined) continue
    if (typeof value === 'string' && value.length > 500) {
      out[key] = `${value.slice(0, 500)}…`
      continue
    }
    out[key] = value
  }
  return out
}
