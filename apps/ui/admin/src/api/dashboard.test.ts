import { describe, expect, it } from 'vitest'
import { attentionListMax, countSample, loadDashboard, type SampleAttention, type SamplePartner } from './dashboard'

const partner = (id: string, extra: Partial<SamplePartner> = {}): SamplePartner => ({
  id,
  name: id,
  state: 'live',
  stores: 0,
  newThisWeek: 0,
  signups: [0, 0, 0],
  medianSecondsToReady: null,
  ...extra,
})

const pastDue = (id: string): SampleAttention => ({
  id,
  name: id,
  partnerId: 'p',
  partnerName: 'p',
  reason: { kind: 'pastDue', daysPastDue: 3 },
})

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

  it('names the partner that submitted earliest as the one waiting longest, whatever the order', () => {
    const data = countSample(
      {
        partners: [
          partner('late', { state: 'awaiting', submittedAt: '2026-09-27T08:00:00Z', waitingSeconds: 60 }),
          partner('early', { state: 'awaiting', submittedAt: '2026-09-20T08:00:00Z', waitingSeconds: 600 }),
        ],
        attention: [],
      },
      undefined,
    )
    expect(data.awaiting.count).toBe(2)
    expect(data.awaiting.oldest?.id).toBe('early')
  })

  it('caps the stores needing attention and still reports how many there are', () => {
    const data = countSample(
      { partners: [partner('p')], attention: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(pastDue) },
      undefined,
    )
    expect(data.attention.stores).toHaveLength(attentionListMax)
    expect(data.attention.total).toBe(7)
    expect(data.attention.pastDue).toBe(7)
  })

  it('returns at most five partners for new stores this week, largest first', async () => {
    const { newThisWeekByPartner } = (await loadDashboard(undefined)).stores
    expect(newThisWeekByPartner).toHaveLength(5)
    expect(newThisWeekByPartner.map((partner) => partner.count)).toEqual([38, 21, 6, 0, 0])
  })
})
