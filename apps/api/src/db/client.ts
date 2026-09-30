import postgres from 'postgres'

export const getClient = (
  hyperdrive: { connectionString: string },
  opts?: { max?: number; statementTimeoutMs?: number; connectTimeoutMs?: number },
): postgres.Sql =>
  postgres(hyperdrive.connectionString, {
    max: opts?.max ?? 5,
    fetch_types: false,
    // Sent via the standard `options` startup field (`-c statement_timeout=…`), not a raw
    // `statement_timeout` startup param: Neon's connection proxy only forwards well-known
    // startup fields to the backend, and silently drops unrecognized custom ones.
    ...(opts?.statementTimeoutMs ? { connection: { options: `-c statement_timeout=${opts.statementTimeoutMs}` } } : {}),
    ...(opts?.connectTimeoutMs ? { connect_timeout: Math.ceil(opts.connectTimeoutMs / 1000) } : {}),
  })
