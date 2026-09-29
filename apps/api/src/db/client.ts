import postgres from 'postgres'

export const getClient = (
  hyperdrive: { connectionString: string },
  opts?: { max?: number; statementTimeoutMs?: number; connectTimeoutMs?: number },
): postgres.Sql =>
  postgres(hyperdrive.connectionString, {
    max: opts?.max ?? 5,
    fetch_types: false,
    ...(opts?.statementTimeoutMs ? { connection: { statement_timeout: opts.statementTimeoutMs } } : {}),
    ...(opts?.connectTimeoutMs ? { connect_timeout: Math.ceil(opts.connectTimeoutMs / 1000) } : {}),
  })
