import { describe, expect, it } from 'vitest'
import { namesFor } from './names'
import { featureConfig, readBaseConfig } from './wrangler-config'

describe('featureConfig', () => {
  const base = readBaseConfig()
  const config = featureConfig(base, namesFor('offers', 'dripfunnel.ai'), 'dripfunnel.ai', 'hd-123')

  it('keeps the base config and renames the Worker', () => {
    expect(config.main).toBe(base.main)
    expect(config.name).toBe('dripfunnel-feature-offers')
    expect(config.workers_dev).toBe(false)
  })

  it('points the router at the feature hostnames', () => {
    expect(config.vars).toMatchObject({
      ADMIN_HOST: 'offers-admin.dripfunnel.ai',
      PLATFORM_HOST: 'offers-platform.dripfunnel.ai',
      HOOKS_HOST: 'offers-hooks.dripfunnel.ai',
      HYPERDRIVE_REQUIRED: '1',
    })
  })

  it('routes /api on each SPA host and the whole hooks host to the Worker', () => {
    expect(config.routes).toEqual([
      { pattern: 'offers-admin.dripfunnel.ai/api/*', zone_name: 'dripfunnel.ai' },
      { pattern: 'offers-platform.dripfunnel.ai/api/*', zone_name: 'dripfunnel.ai' },
      { pattern: 'offers-store.dripfunnel.ai/api/*', zone_name: 'dripfunnel.ai' },
      { pattern: 'offers-hooks.dripfunnel.ai', custom_domain: true },
    ])
  })

  it("binds the environment's own database", () => {
    expect(config.hyperdrive).toEqual([{ binding: 'HYPERDRIVE', id: 'hd-123' }])
  })
})
