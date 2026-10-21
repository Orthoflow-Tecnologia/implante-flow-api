import assert from 'node:assert/strict'
import test from 'node:test'
import { dentistForAccessToken } from '../src/auth/dentist.js'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { PgDatabase } from '../src/db/pg-database.js'
import { migrate } from '../src/db/migrate.js'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  test('admin routes skipped sem DATABASE_URL', () => {
    assert.ok(true)
  })
} else {
  test('admin responde 403 para dentista sem permissão e 200 para admin', async () => {
    const database = new PgDatabase(databaseUrl)
    await migrate(database)
    const member = await dentistForAccessToken(database, {
      subject: 'user_member_admin_test',
      email: 'member-admin@example.com',
      name: 'Member',
      permissions: [],
    })
    const adminUser = await dentistForAccessToken(database, {
      subject: 'user_admin_admin_test',
      email: 'admin-admin@example.com',
      name: 'Admin',
      role: 'admin',
      permissions: ['dashboard:read', 'users:read'],
    })

    const denied = await buildApp({
      config: loadConfig({ APP_ENV: 'test', OPENAPI_ENABLED: 'false' }),
      database,
      authenticate: async () => member,
    })
    const forbidden = await denied.inject({
      method: 'GET',
      url: '/v1/admin/dashboard/overview',
      headers: { authorization: 'Bearer x' },
    })
    assert.equal(forbidden.statusCode, 403)
    await denied.close()

    const allowed = await buildApp({
      config: loadConfig({ APP_ENV: 'test', OPENAPI_ENABLED: 'false' }),
      database,
      authenticate: async () => adminUser,
    })
    const ok = await allowed.inject({
      method: 'GET',
      url: '/v1/admin/dashboard/overview',
      headers: { authorization: 'Bearer x' },
    })
    assert.equal(ok.statusCode, 200)
    const body = ok.json() as { activeUsers: number }
    assert.ok(body.activeUsers >= 1)
    await allowed.close()
    await database.close()
  })
}
