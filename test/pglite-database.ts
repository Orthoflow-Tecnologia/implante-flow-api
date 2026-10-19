import { PGlite } from '@electric-sql/pglite'
import type { Database, Queryable, SqlRow } from '../src/db/database.js'

type Session = Queryable & { exec(text: string): Promise<void> }

export class PgliteDatabase implements Database {
  constructor(private readonly db: PGlite) {}

  static async create(): Promise<PgliteDatabase> {
    return new PgliteDatabase(new PGlite())
  }

  async query<T extends SqlRow = SqlRow>(text: string, params: readonly unknown[] = []): Promise<T[]> {
    const result = await this.db.query<T>(text, [...params])
    return result.rows
  }

  async exec(text: string): Promise<void> {
    await this.db.exec(text)
  }

  async transaction<T>(run: (tx: Session) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) =>
      run({
        async query<TRow extends SqlRow = SqlRow>(text: string, params: readonly unknown[] = []) {
          const result = await tx.query<TRow>(text, [...params])
          return result.rows
        },
        async exec(text: string) {
          await tx.exec(text)
        },
      }),
    )
  }

  async withDentist<T>(dentistId: string, run: (tx: Queryable) => Promise<T>): Promise<T> {
    return this.transaction(async (tx) => {
      await tx.query(`SELECT set_config('app.dentist_id', $1, true)`, [dentistId])
      await tx.exec('SET LOCAL ROLE implante_app')
      return run(tx)
    })
  }

  async ping(): Promise<boolean> {
    try {
      await this.query('SELECT 1 AS ok')
      return true
    } catch {
      return false
    }
  }

  async close(): Promise<void> {
    await this.db.close()
  }
}
