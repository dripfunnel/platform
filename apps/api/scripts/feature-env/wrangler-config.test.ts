import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { namesFor } from './names'
import { featureConfig, readBaseConfig } from './wrangler-config'

describe('featureConfig', () => {
  const base = readBaseConfig()
  const config = featureConfig(base, namesFor('offers', 'actuateminds.com'), 'actuateminds.com', 'hd-123')

  it('keeps the base config and renames the Worker', () => {
    expect(config.main).toBe(base.main)
    expect(config.name).toBe('dripfunnel-feature-offers')
    expect(config.workers_dev).toBe(false)
  })

  it('points the router at the feature hostnames', () => {
    expect(config.vars).toMatchObject({
      ADMIN_HOST: 'offers-admin.actuateminds.com',
      PLATFORM_HOST: 'offers-platform.actuateminds.com',
      HOOKS_HOST: 'offers-hooks.actuateminds.com',
      HYPERDRIVE_REQUIRED: '1',
    })
  })

  it('routes /api on each SPA host and the whole hooks host to the Worker', () => {
    expect(config.routes).toEqual([
      { pattern: 'offers-admin.actuateminds.com/api/*', zone_name: 'actuateminds.com' },
      { pattern: 'offers-platform.actuateminds.com/api/*', zone_name: 'actuateminds.com' },
      { pattern: 'offers-store.actuateminds.com/api/*', zone_name: 'actuateminds.com' },
      { pattern: 'offers-hooks.actuateminds.com', custom_domain: true },
    ])
  })

  it("binds the environment's own database", () => {
    expect(config.hyperdrive).toEqual([{ binding: 'HYPERDRIVE', id: 'hd-123' }])
  })
})

describe('env.prod', () => {
  const envs = z.object({ env: z.object({ dev: z.record(z.string(), z.unknown()), prod: z.record(z.string(), z.unknown()) }) }).parse(readBaseConfig()).env

  // Every binding of a kind, by its name, in the order the config lists them: a producer and a consumer count once.
  const bindingNames = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value.flatMap((item) => {
        const { binding, name } = (item ?? {}) as Record<string, unknown>
        return typeof binding === 'string' ? [binding] : typeof name === 'string' ? [name] : []
      })
    }
    return value && typeof value === 'object' ? Object.values(value).flatMap(bindingNames) : []
  }

  // Per-environment by nature: the Worker's own name, and routes (the hosts differ).
  const differs = ['name', 'routes']

  it('has every binding kind and name that env.dev has', () => {
    for (const kind of Object.keys(envs.dev).filter((key) => !differs.includes(key))) {
      expect(envs.prod, `env.prod lacks ${kind}`).toHaveProperty(kind)
      expect(bindingNames(envs.prod[kind]).sort(), kind).toEqual(bindingNames(envs.dev[kind]).sort())
    }
  })
})
