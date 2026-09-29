import type postgres from 'postgres'
import type { Config } from '#core/config'
import { getClient } from './client'

const PING_TIMEOUT_MS = 5_000

export const ping = async (sql: postgres.Sql): Promise<boolean> => {
  try {
    await sql`select 1`
    return true
  } catch {
    console.error(JSON.stringify({ code: 'db_ping_failed' }))
    return false
  }
}

export type DbStatus = 'ok' | 'down' | 'unconfigured'

interface WaitUntil {
  waitUntil: (promise: Promise<unknown>) => void
}

export const checkHealth = async (config: Config, ctx: WaitUntil): Promise<DbStatus> => {
  const { HYPERDRIVE } = config
  if (!HYPERDRIVE) return 'unconfigured'
  let sql: postgres.Sql | undefined
  try {
    sql = getClient(HYPERDRIVE, { max: 1, statementTimeoutMs: PING_TIMEOUT_MS })
    return (await ping(sql)) ? 'ok' : 'down'
  } catch {
    console.error(JSON.stringify({ code: 'db_health_check_failed' }))
    return 'down'
  } finally {
    if (sql) ctx.waitUntil(sql.end())
  }
}
