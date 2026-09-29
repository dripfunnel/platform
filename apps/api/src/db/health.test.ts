import { afterAll, describe, expect, it } from 'vitest'
import type { Config } from '#core/config'
import { getClient } from './client'
import { checkHealth, ping } from './health'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dripfunnel_dev:dripfunnel_dev@localhost:5432/dripfunnel'
const baseConfig = { ADMIN_HOST: 'admin.dripfunnel.com', PLATFORM_HOST: 'platform.dripfunnel.com', HOOKS_HOST: 'hooks.dripfunnel.com' }
const ctx = { waitUntil: (promise: Promise<unknown>) => promise } as unknown as ExecutionContext

describe('ping', () => {
  it('is healthy against a real Postgres', async () => {
    const sql = getClient({ connectionString: DATABASE_URL }, { max: 1 })
    try {
      expect(await ping(sql)).toBe(true)
    } finally {
      await sql.end()
    }
  })

  it('is unhealthy when the connection is refused', async () => {
    const sql = getClient({ connectionString: 'postgres://dripfunnel_dev:dripfunnel_dev@localhost:1/dripfunnel' }, { max: 1 })
    try {
      expect(await ping(sql)).toBe(false)
    } finally {
      await sql.end()
    }
  })

  it('is unhealthy when the query breaches statement_timeout', async () => {
    const sql = getClient({ connectionString: DATABASE_URL }, { max: 1, statementTimeoutMs: 50 })
    try {
      expect(await ping(sql, () => sql`select pg_sleep(1)`)).toBe(false)
    } finally {
      await sql.end()
    }
  })
})

describe('checkHealth', () => {
  it('is unconfigured when no HYPERDRIVE binding is set', async () => {
    const config: Config = { ...baseConfig }
    expect(await checkHealth(config, ctx)).toBe('unconfigured')
  })
})
