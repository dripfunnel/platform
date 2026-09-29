import { describe, expect, it } from 'vitest'
import { staleSlugs } from './lifecycle'

const now = new Date('2026-09-29T03:00:00Z')
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

describe('staleSlugs', () => {
  it('keeps environments whose branch had a commit in the last 14 days', () => {
    expect(staleSlugs(['offers'], [{ branch: 'feature/offers', committedAt: daysAgo(3) }], now)).toEqual([])
  })

  it('removes environments idle for more than 14 days', () => {
    expect(staleSlugs(['offers'], [{ branch: 'feature/offers', committedAt: daysAgo(15) }], now)).toEqual(['offers'])
  })

  it('removes environments whose branch is gone', () => {
    expect(staleSlugs(['offers', 'carts'], [{ branch: 'feature/carts', committedAt: daysAgo(1) }], now)).toEqual(['offers'])
  })

  it('ignores branches that are not feature branches', () => {
    expect(staleSlugs(['offers'], [{ branch: 'offers', committedAt: daysAgo(1) }], now)).toEqual(['offers'])
  })
})
