import type { Database } from '../db/database.js'
import type { AccessToken } from './access-token.js'

export type AuthenticatedDentist = {
  id: string
  workOsUserId: string
}

export async function dentistForAccessToken(
  database: Database,
  access: AccessToken,
): Promise<AuthenticatedDentist> {
  const rows = await database.query<{ id: string }>('SELECT upsert_dentist($1, $2, $3) AS id', [
    access.subject,
    access.email,
    access.name,
  ])
  const id = rows[0]?.id
  if (!id) throw new Error('Não foi possível mapear o dentista.')
  return { id, workOsUserId: access.subject }
}
