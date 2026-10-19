import pg from 'pg'
import type { Database, Queryable, SqlRow } from './database.js'

type Session = Queryable & { exec(text: string): Promise<void> }

function sessionFrom(client: pg.PoolClient): Session {
  return {
    async query<T extends SqlRow = SqlRow>(text: string, params: readonly unknown[] = []): Promise<T[]> {
      const result = await client.query<T>(text, [...params])
      return result.rows
    },
    async exec(text: string): Promise<void> {
      await client.query(text)
    },
  }
}

export class PgDatabase implements Database {
  private readonly pool: pg.Pool

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 10 })
  }

  async query<T extends SqlRow = SqlRow>(text: string, params: readonly unknown[] = []): Promise<T[]> {
    const result = await this.pool.query<T>(text, [...params])
    return result.rows
  }

  async exec(text: string): Promise<void> {
    await this.pool.query(text)
  }

  async transaction<T>(run: (tx: Session) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const value = await run(sessionFrom(client))
      await client.query('COMMIT')
      return value
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
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
    await this.pool.end()
  }
}
