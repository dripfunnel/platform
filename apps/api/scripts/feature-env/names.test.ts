import { describe, expect, it } from 'vitest'
import { isFeatureBranch, namesFor, slugOf } from './names'

describe('isFeatureBranch', () => {
  it('matches any branch containing "feature"', () => {
    expect(isFeatureBranch('feature/offers')).toBe(true)
    expect(isFeatureBranch('gk-feature-cart')).toBe(true)
    expect(isFeatureBranch('fix/login')).toBe(false)
    expect(isFeatureBranch('restructure-ui-admin-docs')).toBe(false)
  })
})

describe('slugOf', () => {
  it('drops a leading feature prefix and keeps DNS-safe characters', () => {
    expect(slugOf('feature/offers')).toBe('offers')
    expect(slugOf('feature-Abandoned_Carts')).toBe('abandoned-carts')
    expect(slugOf('gk/feature/cart')).toBe('gk-feature-cart')
  })

  it('falls back when nothing is left', () => {
    expect(slugOf('feature')).toBe('feature')
    expect(slugOf('feature/--')).toBe('feature')
  })

  it('shortens long names with a stable hash so they stay unique', () => {
    const a = slugOf('feature/customer-groups-and-segments')
    const b = slugOf('feature/customer-groups-and-segmentation')
    expect(a.length).toBeLessThanOrEqual(20)
    expect(a).toMatch(/^[a-z0-9-]+-[0-9a-f]{4}$/)
    expect(a).not.toBe(b)
    expect(slugOf('feature/customer-groups-and-segments')).toBe(a)
  })
})

describe('namesFor', () => {
  it('derives every resource name from the slug', () => {
    const n = namesFor('offers', 'dripfunnel.ai')
    expect(n.worker).toBe('dripfunnel-feature-offers')
    expect(n.hyperdrive).toBe('feature-offers')
    expect(n.neonBranch).toBe('feature/offers')
    expect(n.pagesProject('admin')).toBe('dripfunnel-feature-admin')
    expect(n.host('store')).toBe('offers-store.dripfunnel.ai')
    expect(n.host('hooks')).toBe('offers-hooks.dripfunnel.ai')
  })
})
