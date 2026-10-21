import type { StoreState } from '../../api/shell'
import { seatOf, type Seat } from '../../nav'
import { bannersFor, trialDaysLeft } from './bannerSpecs'

const now = new Date('2026-10-13T09:00:00Z')
const owner = seatOf({ role: 'owner', tier: null }) as Seat
const staff = seatOf({ role: 'staff', tier: null }) as Seat
const supplier = seatOf({ role: 'supplier-member', tier: 'vendor-orders-fulfil' }) as Seat

const state = (change: Partial<StoreState> = {}): StoreState => ({ readOnly: false, status: 'active', trialEndsAt: null, pastDueSince: null, provisioning: null, support: null, ...change })
const support = (change: Partial<NonNullable<StoreState['support']>> = {}): NonNullable<StoreState['support']> => ({ partnerName: 'Northstar', agentFirstName: 'Asha', endsAt: '2026-10-13T09:25:00Z', sessionId: 'session-1', access: 'read', writeRequest: null, ...change })
const run = (change: Partial<Parameters<typeof bannersFor>[0]> = {}) => bannersFor({ seat: owner, state: state(), support: null, online: true, scenario: 'real', now, ...change })
const keys = (banners: ReturnType<typeof bannersFor>) => banners.map((banner) => banner.key)

describe('the shell banners (FIRST-RELEASE.md §3.3)', () => {
  it('shows none for a healthy store', () => {
    expect(run()).toEqual([])
  })

  it('says the store is being built, and that it is view-only when a payment failed', () => {
    expect(keys(run({ state: state({ provisioning: { state: 'running', step: 'database' } }) }))).toEqual(['provisioning'])
    expect(keys(run({ state: state({ status: 'past_due' }) }))).toEqual(['pastDue'])
  })

  it('counts a trial in whole days, today included, and warns on the last', () => {
    expect(trialDaysLeft('2026-10-16T09:00:00Z', now)).toBe(3)
    expect(trialDaysLeft('2026-10-13T20:00:00Z', now)).toBe(1)
    expect(trialDaysLeft(null, now)).toBeNull()
    expect(run({ state: state({ status: 'trial', trialEndsAt: '2026-10-16T09:00:00Z' }) })[0]?.title).toBe('Free trial · 3 days left.')
    expect(keys(run({ state: state({ status: 'trial', trialEndsAt: '2026-10-14T05:00:00Z' }) }))).toEqual(['trialEnding'])
  })

  it('shows trial banners to the Owner only, and a supplier none of the plan ones', () => {
    const trial = state({ status: 'trial', trialEndsAt: '2026-10-16T09:00:00Z' })
    expect(run({ seat: staff, state: trial })).toEqual([])
    expect(run({ seat: supplier, state: trial })).toEqual([])
  })

  it('names who to contact for a suspended store, or says to ask the provider', () => {
    expect(run({ state: state({ status: 'suspended' }), support: 'help@partner.example' })[0]?.body).toContain('Contact help@partner.example to find out why.')
    expect(run({ state: state({ status: 'suspended' }) })[0]?.body).toContain('Contact your store’s provider')
    expect(keys(run({ state: state({ status: 'cancelled' }) }))).toEqual(['cancelled'])
  })

  it('says who from support is viewing the store, read-only, and for how long', () => {
    const [banner] = run({ state: state({ support: support() }) })
    expect(banner?.title).toBe('Northstar support (Asha) is viewing your store.')
    expect(banner?.body).toBe('Read-only. Ends in 25 min.')
    expect(banner?.ask).toBeUndefined()
  })

  it('says changes are allowed once the session is elevated', () => {
    expect(run({ state: state({ support: support({ access: 'write', writeRequest: { state: 'allowed', note: null } }) }) })[0]?.body).toBe('Changes allowed. Ends in 25 min.')
  })

  it('carries the request to make changes, with its note, only while it is waiting for an answer', () => {
    const asking = support({ writeRequest: { state: 'pending', note: 'Ticket #4821' } })
    expect(run({ state: state({ support: asking }) })[0]?.ask).toEqual({ sessionId: 'session-1', agent: 'Asha', partner: 'Northstar', note: 'Ticket #4821' })
    for (const answered of ['allowed', 'denied']) {
      expect(run({ state: state({ support: support({ writeRequest: { state: answered, note: null } }) }) })[0]?.ask).toBeUndefined()
    }
    expect(run({ state: state({ support: support({ sessionId: null, writeRequest: { state: 'pending', note: null } }) }) })[0]?.ask).toBeUndefined()
  })

  it('shows the offline banner with the card’s words, last', () => {
    const banners = run({ online: false, state: state({ status: 'past_due' }) })
    expect(keys(banners)).toEqual(['pastDue', 'offline'])
    expect(banners[1]).toMatchObject({ tone: 'offline', title: 'You’re offline.', body: 'Changes need a connection.' })
  })

  it('carries no button: a banner is only words, except support’s request', () => {
    for (const scenario of ['trial', 'trialEnds', 'trialEnded', 'bandwidth', 'whiteLabel', 'pastDue', 'provisioning', 'support', 'offline'] as const) {
      expect(Object.keys(run({ scenario })[0] ?? {}).sort()).toEqual(['body', 'key', 'title', 'tone'])
    }
  })

  it('draws exactly the banner the Scenario menu picks, or none', () => {
    expect(keys(run({ scenario: 'bandwidth', state: state({ status: 'past_due' }) }))).toEqual(['bandwidth'])
    expect(run({ scenario: 'none', state: state({ status: 'past_due' }) })).toEqual([])
  })
})
