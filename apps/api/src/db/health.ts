import type postgres from 'postgres'
import type { Config } from '#core/config'
import { getClient } from './client'

const PING_TIMEOUT_MS = 5_000
// connect and the query are sequential (client.ts), so worst case is connect_timeout +
// statement_timeout; this must stay >= 2 * PING_TIMEOUT_MS or it fires before either inner
// timeout can, capping the real budget at half of what getClient was told to allow.
const CHECK_HEALTH_TIMEOUT_MS = PING_TIMEOUT_MS * 2

export const ping = async (sql: postgres.Sql, query: () => Promise<unknown> = () => sql`select 1`): Promise<boolean> => {
  try {
    await query()
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

export const checkHealth = async (config: Pick<Config, 'HYPERDRIVE'>, ctx: WaitUntil): Promise<DbStatus> => {
  const { HYPERDRIVE } = config
  // 'unconfigured' maps to ok: true (index.ts) only because no Hyperdrive resource is
  // provisioned in production yet (wrangler.jsonc). Once it is, this must stop being treated
  // as healthy so a lost/renamed binding goes red instead of green forever. See #30.
  if (!HYPERDRIVE) return 'unconfigured'
  let sql: postgres.Sql | undefined
  try {
    sql = getClient(HYPERDRIVE, { max: 1, statementTimeoutMs: PING_TIMEOUT_MS, connectTimeoutMs: PING_TIMEOUT_MS })
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), CHECK_HEALTH_TIMEOUT_MS))
    return (await Promise.race([ping(sql), timeout])) ? 'ok' : 'down'
  } catch {
    console.error(JSON.stringify({ code: 'db_health_check_failed' }))
    return 'down'
  } finally {
    if (sql) ctx.waitUntil(sql.end())
  }
}
