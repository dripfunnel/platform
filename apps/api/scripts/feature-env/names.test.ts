import { describe, expect, it } from 'vitest'
import { isFeatureBranch, namesFor, slugOf } from './names'

describe('isFeatureBranch', () => {
  it('matches only <issue>/feature/<short-name> branches', () => {
    expect(isFeatureBranch('12/feature/offers')).toBe(true)
    expect(isFeatureBranch('13/task/feature-flags')).toBe(false)
    expect(isFeatureBranch('14/bug/login-loop')).toBe(false)
    expect(isFeatureBranch('feature/offers')).toBe(false)
  })
})

describe('slugOf', () => {
  it('is the issue number and the short name', () => {
    expect(slugOf('12/feature/offers')).toBe('12-offers')
    expect(slugOf('7/feature/abandoned-carts')).toBe('7-abandoned-carts')
  })

  it('shortens long names with a stable hash so they stay unique', () => {
    const a = slugOf('123/feature/customer-groups-and-segments')
    const b = slugOf('123/feature/customer-groups-and-segmentation')
    expect(a.length).toBeLessThanOrEqual(20)
    expect(a).toMatch(/^123-[a-z0-9-]+-[0-9a-f]{4}$/)
    expect(a).not.toBe(b)
    expect(slugOf('123/feature/customer-groups-and-segments')).toBe(a)
  })

  it('refuses branches outside the naming rules', () => {
    expect(() => slugOf('feature/offers')).toThrow()
  })
})

describe('namesFor', () => {
  it('derives every resource name from the slug', () => {
    const n = namesFor('12-offers', 'dripfunnel.ai')
    expect(n.worker).toBe('dripfunnel-feature-12-offers')
    expect(n.hyperdrive).toBe('feature-12-offers')
    expect(n.neonBranch).toBe('feature/12-offers')
    expect(n.pagesProject('admin')).toBe('dripfunnel-feature-admin')
    expect(n.host('store')).toBe('12-offers-store.dripfunnel.ai')
    expect(n.host('hooks')).toBe('12-offers-hooks.dripfunnel.ai')
  })
})
