import assert from 'node:assert/strict'
import { test } from 'node:test'
import { migrate } from '../src/db/migrate.js'
import { PgliteDatabase } from './pglite-database.js'

async function dentist(database: PgliteDatabase, workOsUserId: string): Promise<string> {
  const rows = await database.query<{ id: string }>(
    `INSERT INTO dentists (workos_user_id, email, name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [workOsUserId, `${workOsUserId}@example.com`, workOsUserId],
  )
  const id = rows[0]?.id
  assert.ok(id)
  return id
}

test('migrations criam o prontuário e podem rodar de novo', async () => {
  const database = await PgliteDatabase.create()
  const first = await migrate(database)
  const second = await migrate(database)
  assert.deepEqual(first, ['000_role.sql', '001_clinical_schema.sql', '002_catalog_seed.sql'])
  assert.deepEqual(second, [])

  const tables = await database.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])
     ORDER BY table_name`,
    [[
      'patients',
      'procedures',
      'tooth_sites',
      'implant_pieces',
      'graft_materials',
      'visits',
      'follow_ups',
      'photos',
      'certificate_versions',
      'implant_models',
      'graft_models',
    ]],
  )
  assert.equal(tables.length, 11)
  await database.close()
})

test('um dentista não lê nem grava o prontuário de outro', async () => {
  const database = await PgliteDatabase.create()
  await migrate(database)
  const ana = await dentist(database, 'ana')
  const bia = await dentist(database, 'bia')

  await database.withDentist(ana, async (tx) => {
    await tx.query(
      `INSERT INTO patients (dentist_id, name, birth_date)
       VALUES ($1, 'Paciente da Ana', '1980-01-02')`,
      [ana],
    )
  })

  const visibleToBia = await database.withDentist(bia, (tx) =>
    tx.query('SELECT id, name FROM patients'),
  )
  const visibleToAna = await database.withDentist(ana, (tx) =>
    tx.query<{ name: string }>('SELECT name FROM patients'),
  )
  assert.deepEqual(visibleToBia, [])
  assert.deepEqual(visibleToAna.map((row) => row.name), ['Paciente da Ana'])

  await assert.rejects(
    database.withDentist(bia, (tx) =>
      tx.query(
        `INSERT INTO patients (dentist_id, name, birth_date)
         VALUES ($1, 'Paciente cruzado', '1981-03-04')`,
        [ana],
      ),
    ),
  )
  await database.close()
})

test('peça e enxerto não atravessam o prontuário de outro dentista', async () => {
  const database = await PgliteDatabase.create()
  await migrate(database)
  const ana = await dentist(database, 'ana-proc')
  const bia = await dentist(database, 'bia-proc')

  const procedureId = await database.withDentist(ana, async (tx) => {
    const patient = await tx.query<{ id: string }>(
      `INSERT INTO patients (dentist_id, name, birth_date)
       VALUES ($1, 'Paciente', '1990-05-06')
       RETURNING id`,
      [ana],
    )
    const procedure = await tx.query<{ id: string }>(
      `INSERT INTO procedures (dentist_id, patient_id, modality, subtype, surgery_date, status_label)
       VALUES ($1, $2, 'implante', 'unitario', '2026-10-01', 'planejado')
       RETURNING id`,
      [ana, patient[0]?.id],
    )
    return procedure[0]?.id
  })
  assert.ok(procedureId)

  await assert.rejects(
    database.withDentist(bia, (tx) =>
      tx.query(
        `INSERT INTO tooth_sites (dentist_id, procedure_id, fdi, role)
         VALUES ($1, $2, 11, 'pilar')`,
        [bia, procedureId],
      ),
    ),
  )
  await database.close()
})
