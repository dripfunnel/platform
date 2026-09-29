import { describe, expect, it } from 'vitest'
import type { Config } from '#core/config'
import { checkHealth } from '#db/health'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dripfunnel_dev:dripfunnel_dev@localhost:5432/dripfunnel'
const baseConfig = { ADMIN_HOST: 'admin.dripfunnel.com', PLATFORM_HOST: 'platform.dripfunnel.com', HOOKS_HOST: 'hooks.dripfunnel.com' }
const ctx = { waitUntil: (promise: Promise<unknown>) => promise }

describe('checkHealth', () => {
  it('is healthy against a real Postgres', async () => {
    const config: Config = { ...baseConfig, HYPERDRIVE: { connectionString: DATABASE_URL } }
    expect(await checkHealth(config, ctx)).toBe('ok')
  })
})
