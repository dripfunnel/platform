import type postgres from 'postgres'
import type { Config } from '#core/config'
import { getClient } from './client'

export const ping = async (sql: postgres.Sql): Promise<boolean> => {
  try {
    await sql`select 1`
    return true
  } catch {
    return false
  }
}

export const checkHealth = async (config: Config, ctx: ExecutionContext): Promise<boolean> => {
  const { HYPERDRIVE } = config
  if (!HYPERDRIVE) return false
  let sql: postgres.Sql | undefined
  try {
    sql = getClient(HYPERDRIVE, { max: 1 })
    return await ping(sql)
  } catch {
    return false
  } finally {
    if (sql) ctx.waitUntil(sql.end())
  }
}
