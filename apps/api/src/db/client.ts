import postgres from 'postgres'

export const getClient = (hyperdrive: { connectionString: string }, opts?: { max?: number }): postgres.Sql =>
  postgres(hyperdrive.connectionString, { max: opts?.max ?? 5, fetch_types: false })
