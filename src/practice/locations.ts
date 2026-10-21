import type { Database } from '../db/database.js'
import { ClinicValidationError, clientUuid, isValidPhone, normalizePhone } from '../clinic/rules.js'

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

function splitCro(value: string): { cro: string; croUf: string } {
  const trimmed = value.trim()
  const spaced = /^([A-Za-z]{2})\s+(\d[\d.\-]*)$/.exec(trimmed)
  if (spaced?.[1] && spaced[2]) {
    return { cro: spaced[2].replace(/\D/g, ''), croUf: spaced[1].toUpperCase() }
  }
  // Compatível com o formato antigo número/UF.
  const slash = /^(.+?)\/([A-Za-z]{2})$/.exec(trimmed)
  if (slash?.[1] && slash[2]) {
    return { cro: slash[1].replace(/\D/g, '') || slash[1].trim(), croUf: slash[2].toUpperCase() }
  }
  return { cro: trimmed, croUf: '' }
}

function profileFrom(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row['id'],
    name: row['name'],
    email: row['email'],
    phone: row['phone'],
    cro: row['cro'],
    croUf: row['cro_uf'],
    workOsUserId: row['workos_user_id'],
    reminderEnabled: row['reminder_enabled'],
    reminderDaysBefore: row['reminder_days_before'],
    emailChannel: row['email_channel'],
    pushChannel: row['push_channel'],
  }
}

const profileColumns = `id, name, email, phone, cro, cro_uf, reminder_enabled, reminder_days_before, email_channel, push_channel, workos_user_id`

export async function getProfile(database: Database, dentistId: string): Promise<Record<string, unknown> | null> {
  const rows = await database.withDentist(dentistId, (tx) =>
    tx.query<Record<string, unknown>>(`SELECT ${profileColumns} FROM dentists WHERE id = $1`, [dentistId]),
  )
  const row = rows[0]
  if (!row) return null
  return profileFrom(row)
}

export async function updateProfile(
  database: Database,
  dentistId: string,
  input: {
    name?: unknown
    phone?: unknown
    cro?: unknown
    reminderEnabled?: unknown
    reminderDaysBefore?: unknown
    emailChannel?: unknown
    pushChannel?: unknown
  },
): Promise<Record<string, unknown> | null> {
  const name = typeof input.name === 'string' ? input.name.trim() : undefined
  const phone = typeof input.phone === 'string' ? normalizePhone(input.phone) : undefined
  const cro = typeof input.cro === 'string' ? splitCro(input.cro) : undefined
  const reminderEnabled = typeof input.reminderEnabled === 'boolean' ? input.reminderEnabled : undefined
  const emailChannel = typeof input.emailChannel === 'boolean' ? input.emailChannel : undefined
  const pushChannel = typeof input.pushChannel === 'boolean' ? input.pushChannel : undefined
  const reminderDaysBefore =
    input.reminderDaysBefore === undefined ? undefined : Number(input.reminderDaysBefore)
  if (name !== undefined && name.length === 0) throw new ClinicValidationError('Informe o nome.')
  if (phone !== undefined && phone !== '' && !isValidPhone(phone)) throw new ClinicValidationError('Telefone inválido.')
  if (
    reminderDaysBefore !== undefined &&
    (!Number.isInteger(reminderDaysBefore) || reminderDaysBefore < 1)
  ) {
    throw new ClinicValidationError('Antecedência do lembrete inválida.')
  }
  return database.withDentist(dentistId, async (tx) => {
    const rows = await tx.query<Record<string, unknown>>(
      `UPDATE dentists
       SET name = COALESCE($2, name),
           phone = COALESCE($3, phone),
           cro = CASE WHEN $4::boolean THEN $5 ELSE cro END,
           cro_uf = CASE WHEN $4::boolean THEN $6 ELSE cro_uf END,
           reminder_enabled = COALESCE($7, reminder_enabled),
           reminder_days_before = COALESCE($8, reminder_days_before),
           email_channel = COALESCE($9, email_channel),
           push_channel = COALESCE($10, push_channel)
       WHERE id = $1
       RETURNING ${profileColumns}`,
      [
        dentistId,
        name ?? null,
        phone ?? null,
        cro !== undefined,
        cro?.cro ?? '',
        cro?.croUf ?? '',
        reminderEnabled ?? null,
        reminderDaysBefore ?? null,
        emailChannel ?? null,
        pushChannel ?? null,
      ],
    )
    const row = rows[0]
    if (!row) return null
    return profileFrom(row)
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
  input: { id?: unknown; name?: unknown; address?: unknown },
): Promise<CareLocation> {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const address = typeof input.address === 'string' ? input.address.trim() : ''
  if (name.length === 0) throw new ClinicValidationError('Informe o nome do local.')
  const id = clientUuid(input.id)
  const rows = await database.withDentist(dentistId, async (tx) => {
    await tx.query('SELECT id FROM care_locations FOR UPDATE')
    const active = await tx.query('SELECT id FROM care_locations WHERE active')
    return tx.query<LocationRow>(
      `INSERT INTO care_locations (id, dentist_id, name, address, active, is_default)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, true, $5)
       RETURNING id, name, address, active, is_default`,
      [id, dentistId, name, address, active.length === 0],
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

export async function reactivateLocation(
  database: Database,
  dentistId: string,
  locationId: string,
): Promise<CareLocation | null> {
  return database.withDentist(dentistId, async (tx) => {
    await tx.query('SELECT id FROM care_locations FOR UPDATE')
    const current = await tx.query<LocationRow>(
      'SELECT id, name, address, active, is_default FROM care_locations WHERE id = $1',
      [locationId],
    )
    if (!current[0]) return null
    const defaults = await tx.query('SELECT id FROM care_locations WHERE active AND is_default AND id <> $1', [
      locationId,
    ])
    const rows = await tx.query<LocationRow>(
      `UPDATE care_locations
       SET active = true, is_default = $2
       WHERE id = $1
       RETURNING id, name, address, active, is_default`,
      [locationId, defaults.length === 0],
    )
    return rows[0] ? toLocation(rows[0]) : null
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
