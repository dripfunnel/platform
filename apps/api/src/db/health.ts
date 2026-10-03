import type postgres from 'postgres'
import type { Config } from '#core/config'
import { failureCode, logEvent } from '#core/log'
import { getClient } from './client'

const PING_TIMEOUT_MS = 5_000
// >= connect + statement timeouts, which run in sequence (client.ts)
const CHECK_HEALTH_TIMEOUT_MS = PING_TIMEOUT_MS * 2

export const ping = async (sql: postgres.Sql, query: () => Promise<unknown> = () => sql`select 1`): Promise<boolean> => {
  try {
    await query()
    return true
  } catch (error) {
    logEvent({ event: 'db_ping_failed', code: failureCode(error) })
    return false
  }
}

// 'missing': the environment says it has a database (HYPERDRIVE_REQUIRED) and the binding is gone.
export type DbStatus = 'ok' | 'down' | 'unconfigured' | 'missing'

interface WaitUntil {
  waitUntil: (promise: Promise<unknown>) => void
}

export const checkHealth = async (config: Pick<Config, 'HYPERDRIVE' | 'HYPERDRIVE_REQUIRED'>, ctx: WaitUntil): Promise<DbStatus> => {
  const { HYPERDRIVE } = config
  // Healthy without a binding only where none is provisioned yet (prod until #51); where the
  // environment requires one, a lost or renamed binding is red (#30).
  if (!HYPERDRIVE) return config.HYPERDRIVE_REQUIRED ? 'missing' : 'unconfigured'
  let sql: postgres.Sql | undefined
  try {
    sql = getClient(HYPERDRIVE, { max: 1, statementTimeoutMs: PING_TIMEOUT_MS, connectTimeoutMs: PING_TIMEOUT_MS })
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), CHECK_HEALTH_TIMEOUT_MS))
    return (await Promise.race([ping(sql), timeout])) ? 'ok' : 'down'
  } catch (error) {
    logEvent({ event: 'db_health_check_failed', code: failureCode(error) })
    return 'down'
  } finally {
    if (sql) ctx.waitUntil(sql.end())
  }
}
