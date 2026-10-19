import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dentistForAccessToken } from '../src/auth/dentist.js'
import { buildApp } from '../src/app.js'
import type { AppConfig } from '../src/config.js'
import { migrate } from '../src/db/migrate.js'
import { PgliteDatabase } from './pglite-database.js'

const config: AppConfig = {
  appEnv: 'test',
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  openApiEnabled: false,
  corsOrigins: [],
  serviceName: 'implante-flow-api',
  serviceVersion: '0.1.0',
  databaseUrl: null,
  workOs: null,
}

test('perfil, locais e filtro de pacientes ficam no dentista dono', async () => {
  const database = await PgliteDatabase.create()
  await migrate(database)
  const ana = await dentistForAccessToken(database, { subject: 'user_ana', email: 'ana@example.com', name: '' })
  const bia = await dentistForAccessToken(database, { subject: 'user_bia', email: 'bia@example.com', name: 'Bia' })
  await database.query(`UPDATE dentists SET cro = '12345', cro_uf = 'RJ' WHERE id = $1`, [ana.id])
  const app = await buildApp({
    config,
    database,
    authenticate: async (authorization) => (authorization === 'Bearer bia' ? bia : ana),
  })

  const profile = await app.inject({
    method: 'PATCH',
    url: '/v1/profile',
    headers: { authorization: 'Bearer ana' },
    payload: { name: 'Ana Costa', phone: '21988887777' },
  })
  assert.equal(profile.statusCode, 200)
  assert.equal(profile.json<{ name: string; cro: string; workOsUserId: string }>().name, 'Ana Costa')
  assert.equal(profile.json<{ cro: string }>().cro, '12345')
  assert.equal(profile.json<{ workOsUserId: string }>().workOsUserId, 'user_ana')

  const first = await app.inject({
    method: 'POST',
    url: '/v1/locations',
    headers: { authorization: 'Bearer ana' },
    payload: { name: 'Barra', address: 'Av. das Américas' },
  })
  const second = await app.inject({
    method: 'POST',
    url: '/v1/locations',
    headers: { authorization: 'Bearer ana' },
    payload: { name: 'Centro' },
  })
  assert.equal(first.statusCode, 201)
  assert.equal(first.json<{ isDefault: boolean }>().isDefault, true)
  assert.equal(second.json<{ isDefault: boolean }>().isDefault, false)
  const barra = first.json<{ id: string }>().id
  const centro = second.json<{ id: string }>().id

  const switched = await app.inject({
    method: 'POST',
    url: `/v1/locations/${centro}/default`,
    headers: { authorization: 'Bearer ana' },
  })
  assert.equal(switched.statusCode, 200)
  const locations = await app.inject({ method: 'GET', url: '/v1/locations', headers: { authorization: 'Bearer ana' } })
  const defaults = locations.json<{ isDefault: boolean; active: boolean }[]>().filter((location) => location.active && location.isDefault)
  assert.equal(defaults.length, 1)

  const blocked = await app.inject({
    method: 'POST',
    url: `/v1/locations/${centro}/inactivate`,
    headers: { authorization: 'Bearer ana' },
    payload: {},
  })
  assert.equal(blocked.statusCode, 400)

  const patient = await app.inject({
    method: 'POST',
    url: '/v1/patients',
    headers: { authorization: 'Bearer ana' },
    payload: { name: 'Helena', birthDate: '1980-01-02' },
  })
  const other = await app.inject({
    method: 'POST',
    url: '/v1/patients',
    headers: { authorization: 'Bearer ana' },
    payload: { name: 'Sem local', birthDate: '1982-02-03' },
  })
  const patientId = patient.json<{ id: string }>().id
  const linked = await app.inject({
    method: 'PUT',
    url: `/v1/patients/${patientId}/locations`,
    headers: { authorization: 'Bearer ana' },
    payload: { locationIds: [barra, centro] },
  })
  assert.equal(linked.statusCode, 200)
  const all = await app.inject({ method: 'GET', url: '/v1/patients', headers: { authorization: 'Bearer ana' } })
  assert.equal(all.json<unknown[]>().length, 2)
  const atBarra = await app.inject({
    method: 'GET',
    url: `/v1/patients?locationId=${barra}`,
    headers: { authorization: 'Bearer ana' },
  })
  assert.equal(atBarra.json<{ id: string }[]>().length, 1)
  const none = await app.inject({
    method: 'GET',
    url: '/v1/patients?withoutLocation=true',
    headers: { authorization: 'Bearer ana' },
  })
  assert.equal(none.json<{ id: string }[]>()[0]?.id, other.json<{ id: string }>().id)

  const foreign = await app.inject({
    method: 'PUT',
    url: `/v1/patients/${patientId}/locations`,
    headers: { authorization: 'Bearer bia' },
    payload: { locationIds: [barra] },
  })
  assert.equal(foreign.statusCode, 403)

  const inactive = await app.inject({
    method: 'POST',
    url: `/v1/locations/${centro}/inactivate`,
    headers: { authorization: 'Bearer ana' },
    payload: { replacementId: barra },
  })
  assert.equal(inactive.statusCode, 200)
  const stillLinked = await database.withDentist(ana.id, (tx) =>
    tx.query('SELECT location_id FROM patient_locations WHERE patient_id = $1 AND location_id = $2', [patientId, centro]),
  )
  assert.equal(stillLinked.length, 1)

  await app.close()
  await database.close()
})
