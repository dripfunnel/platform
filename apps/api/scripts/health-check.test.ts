import { describe, expect, it } from 'vitest'
import type { Config } from '#core/config'
import { checkHealth } from '#db/health'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dripfunnel_dev:dripfunnel_dev@localhost:5432/dripfunnel'
const baseConfig = { ADMIN_HOST: 'admin.dripfunnel.ai', PLATFORM_HOST: 'platform.dripfunnel.ai', HOOKS_HOST: 'hooks.dripfunnel.ai', EDGE_ZONE: 'dripfunnel.ai', GITHUB_STORE_ORG: 'dripfunnel' }
const ctx = { waitUntil: (promise: Promise<unknown>) => promise }

describe('checkHealth', () => {
  it('is healthy against a real Postgres', async () => {
    const config: Config = { ...baseConfig, HYPERDRIVE: { connectionString: DATABASE_URL } }
    expect(await checkHealth(config, ctx)).toBe('ok')
  })
})
