import assert from 'node:assert/strict'
import test from 'node:test'
import { dentistForAccessToken } from '../src/auth/dentist.js'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { PgDatabase } from '../src/db/pg-database.js'
import { migrate } from '../src/db/migrate.js'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  test('admin catalog skipped sem DATABASE_URL', () => {
    assert.ok(true)
  })
} else {
  test('admin overview conta clínicos e catálogo; CRUD fabricante/modelo/tamanho', async () => {
    const database = new PgDatabase(databaseUrl)
    await migrate(database)
    const adminUser = await dentistForAccessToken(database, {
      subject: 'user_admin_catalog_test',
      email: 'admin-catalog@example.com',
      name: 'Admin Catalog',
      role: 'admin',
      permissions: ['dashboard:read', 'catalogs:manage'],
    })

    const app = await buildApp({
      config: loadConfig({ APP_ENV: 'test', OPENAPI_ENABLED: 'false' }),
      database,
      authenticate: async () => adminUser,
    })

    const overview = await app.inject({
      method: 'GET',
      url: '/v1/admin/dashboard/overview',
      headers: { authorization: 'Bearer x' },
    })
    assert.equal(overview.statusCode, 200)
    const body = overview.json() as {
      patients: number
      procedures: number
      manufacturers: number
      models: number
      sizes: number
    }
    assert.ok(body.manufacturers >= 1)
    assert.ok(body.models >= 1)
    assert.ok(body.sizes >= 1)
    assert.ok(typeof body.patients === 'number')
    assert.ok(typeof body.procedures === 'number')

    const suffix = Date.now().toString(36)
    const manufacturerName = `Fabricante Teste ${suffix}`
    const created = await app.inject({
      method: 'POST',
      url: '/v1/admin/catalog/manufacturers',
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      payload: { name: manufacturerName },
    })
    assert.equal(
      created.statusCode,
      201,
      `create manufacturer: ${created.statusCode} ${created.body}`,
    )
    const manufacturer = created.json() as { id: string; name: string }
    assert.equal(manufacturer.name, manufacturerName)
    assert.ok(manufacturer.id.length > 0)

    const model = await app.inject({
      method: 'POST',
      url: `/v1/admin/catalog/manufacturers/${manufacturer.id}/models`,
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      payload: { name: `Modelo Alpha ${suffix}` },
    })
    assert.equal(model.statusCode, 201, `create model: ${model.statusCode} ${model.body}`)

    const sizeLabel = `9.9 × 9 mm ${suffix}`
    const size = await app.inject({
      method: 'POST',
      url: '/v1/admin/catalog/sizes',
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      payload: { label: sizeLabel },
    })
    assert.equal(size.statusCode, 201, `create size: ${size.statusCode} ${size.body}`)
    const sizeBody = size.json() as { id: string; label: string }
    assert.equal(sizeBody.label, sizeLabel)

    const deactivate = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/catalog/manufacturers/${manufacturer.id}`,
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      payload: { active: false },
    })
    assert.equal(deactivate.statusCode, 200)
    assert.equal((deactivate.json() as { active: boolean }).active, false)

    await app.close()
    await database.close()
  })
}
