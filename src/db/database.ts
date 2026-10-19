export type SqlRow = Record<string, unknown>

export interface Queryable {
  query<T extends SqlRow = SqlRow>(text: string, params?: readonly unknown[]): Promise<T[]>
}

export interface Database extends Queryable {
  exec(text: string): Promise<void>
  transaction<T>(run: (tx: Queryable & { exec(text: string): Promise<void> }) => Promise<T>): Promise<T>
  withDentist<T>(dentistId: string, run: (tx: Queryable) => Promise<T>): Promise<T>
  ping(): Promise<boolean>
  close(): Promise<void>
}
