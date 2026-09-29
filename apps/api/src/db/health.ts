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

export const checkHealth = async (config: Config): Promise<boolean> => {
  try {
    return await ping(getClient(config))
  } catch {
    return false
  }
}
