import type { Database } from '../db/database.js'
import { ClinicValidationError, isValidPhone, normalizePhone } from '../clinic/rules.js'

export type CareLocation = {
  id: string
  name: string
  address: string
  active: boolean
  isDefault: boolean
}

type LocationRow = {
  id: string
  name: string
  address: string
  active: boolean
  is_default: boolean
}

function toLocation(row: LocationRow): CareLocation {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    active: row.active,
    isDefault: row.is_default,
  }
}

export async function getProfile(database: Database, dentistId: string): Promise<Record<string, unknown> | null> {
  const rows = await database.withDentist(dentistId, (tx) =>
    tx.query<Record<string, unknown>>(
      `SELECT id, name, email, phone, cro, cro_uf, workos_user_id FROM dentists WHERE id = $1`,
      [dentistId],
    ),
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: row['id'],
    name: row['name'],
    email: row['email'],
    phone: row['phone'],
    cro: row['cro'],
    croUf: row['cro_uf'],
  }
}

export async function updateProfile(
  database: Database,
  dentistId: string,
  input: { name?: unknown; phone?: unknown },
): Promise<Record<string, unknown> | null> {
  const name = typeof input.name === 'string' ? input.name.trim() : undefined
  const phone = typeof input.phone === 'string' ? normalizePhone(input.phone) : undefined
  if (name !== undefined && name.length === 0) throw new ClinicValidationError('Informe o nome.')
  if (phone !== undefined && phone !== '' && !isValidPhone(phone)) throw new ClinicValidationError('Telefone inválido.')
  return database.withDentist(dentistId, async (tx) => {
    const rows = await tx.query<Record<string, unknown>>(
      `UPDATE dentists
       SET name = COALESCE($2, name),
           phone = COALESCE($3, phone)
       WHERE id = $1
       RETURNING id, name, email, phone, cro, cro_uf, workos_user_id`,
      [dentistId, name ?? null, phone ?? null],
    )
    const row = rows[0]
    if (!row) return null
    return {
      id: row['id'],
      name: row['name'],
      email: row['email'],
      phone: row['phone'],
      cro: row['cro'],
      croUf: row['cro_uf'],
      workOsUserId: row['workos_user_id'],
    }
  })
}

export async function listLocations(database: Database, dentistId: string): Promise<CareLocation[]> {
  const rows = await database.withDentist(dentistId, (tx) =>
    tx.query<LocationRow>('SELECT id, name, address, active, is_default FROM care_locations ORDER BY name, id'),
  )
  return rows.map(toLocation)
}

export async function createLocation(
  database: Database,
  dentistId: string,
  input: { name?: unknown; address?: unknown },
): Promise<CareLocation> {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const address = typeof input.address === 'string' ? input.address.trim() : ''
  if (name.length === 0) throw new ClinicValidationError('Informe o nome do local.')
  const rows = await database.withDentist(dentistId, async (tx) => {
    await tx.query('SELECT id FROM care_locations FOR UPDATE')
    const active = await tx.query('SELECT id FROM care_locations WHERE active')
    return tx.query<LocationRow>(
      `INSERT INTO care_locations (dentist_id, name, address, active, is_default)
       VALUES ($1, $2, $3, true, $4)
       RETURNING id, name, address, active, is_default`,
      [dentistId, name, address, active.length === 0],
    )
  })
  const row = rows[0]
  if (!row) throw new ClinicValidationError('Não foi possível gravar o local.')
  return toLocation(row)
}

export async function updateLocation(
  database: Database,
  dentistId: string,
  locationId: string,
  input: { name?: unknown; address?: unknown },
): Promise<CareLocation | null> {
  const name = typeof input.name === 'string' ? input.name.trim() : undefined
  const address = typeof input.address === 'string' ? input.address.trim() : undefined
  if (name !== undefined && name.length === 0) throw new ClinicValidationError('Informe o nome do local.')
  const rows = await database.withDentist(dentistId, (tx) =>
    tx.query<LocationRow>(
      `UPDATE care_locations
       SET name = COALESCE($2, name), address = COALESCE($3, address)
       WHERE id = $1
       RETURNING id, name, address, active, is_default`,
      [locationId, name ?? null, address ?? null],
    ),
  )
  return rows[0] ? toLocation(rows[0]) : null
}

export async function setDefaultLocation(
  database: Database,
  dentistId: string,
  locationId: string,
): Promise<CareLocation | null> {
  return database.withDentist(dentistId, async (tx) => {
    await tx.query('SELECT id FROM care_locations FOR UPDATE')
    const target = await tx.query<{ active: boolean }>('SELECT active FROM care_locations WHERE id = $1', [locationId])
    if (!target[0]) return null
    if (!target[0].active) throw new ClinicValidationError('Local inativo não pode ser o padrão.')
    await tx.query('UPDATE care_locations SET is_default = false WHERE is_default')
    const rows = await tx.query<LocationRow>(
      `UPDATE care_locations SET is_default = true WHERE id = $1
       RETURNING id, name, address, active, is_default`,
      [locationId],
    )
    return rows[0] ? toLocation(rows[0]) : null
  })
}

export async function inactivateLocation(
  database: Database,
  dentistId: string,
  locationId: string,
  replacementId: string | undefined,
): Promise<CareLocation | null> {
  return database.withDentist(dentistId, async (tx) => {
    await tx.query('SELECT id FROM care_locations FOR UPDATE')
    const rows = await tx.query<LocationRow>('SELECT id, name, address, active, is_default FROM care_locations')
    const target = rows.find((row) => row.id === locationId)
    if (!target) return null
    const others = rows.filter((row) => row.id !== locationId && row.active)
    if (target.active && target.is_default && others.length > 0 && !replacementId) {
      throw new ClinicValidationError('Escolha outro local padrão antes de inativar este.')
    }
    if (replacementId) {
      const replacement = others.find((row) => row.id === replacementId)
      if (!replacement) throw new ClinicValidationError('O local substituto precisa estar ativo.')
      await tx.query('UPDATE care_locations SET is_default = false WHERE id = $1', [locationId])
      await tx.query('UPDATE care_locations SET is_default = true WHERE id = $1', [replacementId])
    }
    const updated = await tx.query<LocationRow>(
      `UPDATE care_locations SET active = false, is_default = false WHERE id = $1
       RETURNING id, name, address, active, is_default`,
      [locationId],
    )
    return updated[0] ? toLocation(updated[0]) : null
  })
}

export async function replacePatientLocations(
  database: Database,
  dentistId: string,
  patientId: string,
  locationIds: string[],
): Promise<string[] | null> {
  const unique = [...new Set(locationIds)]
  return database.withDentist(dentistId, async (tx) => {
    const patient = await tx.query('SELECT id FROM patients WHERE id = $1 FOR UPDATE', [patientId])
    if (!patient[0]) return null
    if (unique.length > 0) {
      const found = await tx.query<{ id: string }>(
        'SELECT id FROM care_locations WHERE id = ANY($1::uuid[]) AND active',
        [unique],
      )
      if (found.length !== unique.length) throw new ClinicValidationError('Local de atendimento inválido.')
    }
    await tx.query('DELETE FROM patient_locations WHERE patient_id = $1', [patientId])
    for (const locationId of unique) {
      await tx.query(
        `INSERT INTO patient_locations (dentist_id, patient_id, location_id) VALUES ($1, $2, $3)`,
        [dentistId, patientId, locationId],
      )
    }
    return unique
  })
}
