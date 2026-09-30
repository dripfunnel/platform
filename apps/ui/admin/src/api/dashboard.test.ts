import { describe, expect, it } from 'vitest'
import { loadDashboard } from './dashboard'

describe('loadDashboard (fixture)', () => {
  it('counts every partner when no filter is given', async () => {
    const data = await loadDashboard(undefined)
    expect(data.partnerId).toBeNull()
    expect(data.partners).toEqual({ live: 4, awaiting: 1, draft: 2, paused: 0 })
    expect(data.stores.total).toBe(1679)
  })

  it('narrows every card to one partner', async () => {
    const data = await loadDashboard('bz')
    expect(data.partnerId).toBe('bz')
    expect(data.partners).toEqual({ live: 1, awaiting: 0, draft: 0, paused: 0 })
    expect(data.stores.total).toBe(312)
    expect(data.attention.stores.map((store) => store.name)).toEqual(['Kiko Kids'])
    expect(data.awaiting.oldest).toBeNull()
  })

  it('treats an unknown partner as no filter, and says so', async () => {
    const data = await loadDashboard('nope')
    expect(data.partnerId).toBeNull()
    expect(data.stores.total).toBe(1679)
  })

  it('returns at most five partners for new stores this week, largest first', async () => {
    const { newThisWeekByPartner } = (await loadDashboard(undefined)).stores
    expect(newThisWeekByPartner).toHaveLength(5)
    expect(newThisWeekByPartner.map((partner) => partner.count)).toEqual([38, 21, 6, 0, 0])
  })
})
