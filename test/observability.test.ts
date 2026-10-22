import assert from 'node:assert/strict'
import test from 'node:test'
import { dentistForAccessToken } from '../src/auth/dentist.js'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { PgDatabase } from '../src/db/pg-database.js'
import { migrate } from '../src/db/migrate.js'
import { recordAuditEvent } from '../src/ops/audit-events.js'
import { writeSystemLog } from '../src/ops/system-logs.js'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  test('observability skipped sem DATABASE_URL', () => {
    assert.ok(true)
  })
} else {
  test('admin lista logs e eventos de auditoria persistidos', async () => {
    const database = new PgDatabase(databaseUrl)
    await migrate(database)
    const adminUser = await dentistForAccessToken(database, {
      subject: 'user_admin_obs_test',
      email: 'admin-obs@example.com',
      name: 'Admin Obs',
      role: 'admin',
      permissions: ['audit:read', 'users:read'],
    })

    await writeSystemLog(database, {
      level: 'error',
      message: 'falha de teste observability',
      source: 'test',
      requestId: 'req-obs-1',
      context: { code: 'test_error' },
    })
    await recordAuditEvent(database, {
      actorEmail: adminUser.email,
      actorDentistId: adminUser.id,
      action: 'admin.test.seed',
      target: 'observability',
      result: 'success',
      requestId: 'req-obs-1',
    })

    const app = await buildApp({
      config: loadConfig({ APP_ENV: 'test', OPENAPI_ENABLED: 'false' }),
      database,
      authenticate: async () => adminUser,
    })

    const logs = await app.inject({
      method: 'GET',
      url: '/v1/admin/logs?level=error&q=observability',
      headers: { authorization: 'Bearer x' },
    })
    assert.equal(logs.statusCode, 200)
    const logsBody = logs.json() as {
      items: { message: string; level: string; source: string }[]
      total: number
      summary: { errors: number; total: number; windowHours: number }
    }
    assert.ok(logsBody.total >= 1)
    assert.ok(logsBody.items.some((item) => item.message.includes('observability')))
    assert.equal(logsBody.summary.windowHours, 24)
    assert.ok(logsBody.summary.total >= 1)
    assert.ok(logsBody.summary.errors >= 1)

    const audit = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit-events?action=admin.test.seed',
      headers: { authorization: 'Bearer x' },
    })
    assert.equal(audit.statusCode, 200)
    const auditBody = audit.json() as {
      items: { action: string; actorEmail: string; result: string }[]
      total: number
    }
    assert.ok(auditBody.total >= 1)
    assert.equal(auditBody.items[0]?.action, 'admin.test.seed')
    assert.equal(auditBody.items[0]?.actorEmail, adminUser.email)
    assert.equal(auditBody.items[0]?.result, 'success')

    await app.close()
    await database.close()
  })
}
