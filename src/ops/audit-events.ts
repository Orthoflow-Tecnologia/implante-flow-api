import type { Database, Queryable } from '../db/database.js'

export type AuditResult = 'success' | 'denied' | 'failure'

export type AuditEventInput = {
  actorEmail: string
  actorDentistId?: string | null
  action: string
  target?: string | null
  result: AuditResult
  justification?: string | null
  requestId?: string | null
}

export type AuditEventRecord = {
  id: string
  actorEmail: string
  action: string
  target: string | null
  result: AuditResult
  justification: string | null
  createdAt: string
}

export type ListAuditEventsParams = {
  page: number
  pageSize: number
  action?: string
}

export type ListAuditEventsResult = {
  items: AuditEventRecord[]
  page: number
  pageSize: number
  total: number
}

export async function recordAuditEvent(
  database: Queryable,
  input: AuditEventInput,
): Promise<void> {
  const actorEmail = input.actorEmail.trim()
  const action = input.action.trim()
  if (!actorEmail || !action) return
  await database.query(
    `INSERT INTO admin_audit_events
       (actor_email, actor_dentist_id, action, target, result, justification, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      actorEmail.slice(0, 320),
      input.actorDentistId ?? null,
      action.slice(0, 200),
      input.target?.slice(0, 500) ?? null,
      input.result,
      input.justification?.slice(0, 2000) ?? null,
      input.requestId ?? null,
    ],
  )
}

export async function recordAuditEventSafe(
  database: Queryable | null | undefined,
  input: AuditEventInput,
): Promise<void> {
  if (!database) return
  try {
    await recordAuditEvent(database, input)
  } catch {
    // Nunca derruba a requisição por falha na trilha de auditoria.
  }
}

export async function listAuditEvents(
  database: Database,
  params: ListAuditEventsParams,
): Promise<ListAuditEventsResult> {
  const page = params.page
  const pageSize = params.pageSize
  const offset = (page - 1) * pageSize
  const filters: string[] = []
  const values: unknown[] = []

  const action = params.action?.trim()
  if (action) {
    values.push(action)
    filters.push(`action = $${values.length}`)
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''
  const totalRows = await database.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM admin_audit_events ${where}`,
    values,
  )
  const total = Number.parseInt(totalRows[0]?.count ?? '0', 10)
  const limitIdx = values.length + 1
  const offsetIdx = values.length + 2
  const rows = await database.query<{
    id: string
    actor_email: string
    action: string
    target: string | null
    result: AuditResult
    justification: string | null
    created_at: Date
  }>(
    `SELECT id, actor_email, action, target, result, justification, created_at
     FROM admin_audit_events
     ${where}
     ORDER BY created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...values, pageSize, offset],
  )

  return {
    items: rows.map((row) => ({
      id: row.id,
      actorEmail: row.actor_email,
      action: row.action,
      target: row.target,
      result: row.result,
      justification: row.justification,
      createdAt: row.created_at.toISOString(),
    })),
    page,
    pageSize,
    total,
  }
}
