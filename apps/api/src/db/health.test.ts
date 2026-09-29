import type postgres from 'postgres'
import { describe, expect, it, vi } from 'vitest'
import type { Config } from '#core/config'
import { checkHealth, ping } from './health'

const baseConfig = { ADMIN_HOST: 'admin.dripfunnel.com', PLATFORM_HOST: 'platform.dripfunnel.com', HOOKS_HOST: 'hooks.dripfunnel.com' }
const ctx = { waitUntil: (promise: Promise<unknown>) => promise } as unknown as ExecutionContext

describe('ping', () => {
  it('is healthy when the query succeeds', async () => {
    const sql = vi.fn().mockResolvedValue([{ '?column?': 1 }]) as unknown as postgres.Sql
    expect(await ping(sql)).toBe(true)
  })

  it('is unhealthy when the query fails', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('connection refused')) as unknown as postgres.Sql
    expect(await ping(sql)).toBe(false)
  })
})

describe('checkHealth', () => {
  it('is unconfigured when no HYPERDRIVE binding is set', async () => {
    const config: Config = { ...baseConfig }
    expect(await checkHealth(config, ctx)).toBe('unconfigured')
  })
})
