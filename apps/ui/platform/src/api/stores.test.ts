import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStoreInput, storePageSize } from './stores'
import { createStoresServer, sampleStores } from './storesSample'

const server = () => createStoresServer(sampleStores)

describe('the stores fixture, as the Platform API would answer', () => {
  it('pages by cursor with the API cap and no total', () => {
    const first = server().list({}, {}, 'partner-owner')
    expect(first.items).toHaveLength(storePageSize)
    expect(first.pageInfo.hasNextPage).toBe(true)
    expect(Object.keys(first)).not.toContain('total')
    const after = first.pageInfo.endCursor ?? ''
    const next = server().list({}, { after }, 'partner-owner')
    expect(next.items[0]?.id).not.toBe(first.items[0]?.id)
    expect(new Set([...first.items, ...next.items].map((row) => row.id)).size).toBe(storePageSize * 2)
    const back = server().list({}, { before: next.pageInfo.startCursor ?? '' }, 'partner-owner')
    expect(back.items.map((row) => row.id)).toEqual(first.items.map((row) => row.id))
  })

  it('sorts newest first and filters by status, plan, created, storefront, near a limit and text', () => {
    const all = server().list({}, {}, 'partner-owner').items
    expect(all.map((row) => row.createdAt)).toEqual([...all.map((row) => row.createdAt)].sort().reverse())
    const trials = server().list({ status: 'trial' }, {}, 'partner-owner').items
    expect(trials.length).toBeGreaterThan(0)
    expect(trials.every((row) => row.state.kind === 'trial')).toBe(true)
    expect(server().list({ plan: 'pro' }, {}, 'partner-owner').items.every((row) => row.plan.id === 'pro')).toBe(true)
    expect(server().list({ created: 'month' }, {}, 'partner-owner').items.every((row) => row.createdAt >= '2026-09-01')).toBe(true)
    expect(server().list({ storefront: 'own' }, {}, 'partner-owner').items.map((row) => row.name)).toEqual(['Copperline Audio'])
    const near = server().list({ near: 'yes' }, {}, 'partner-owner').items
    expect(near.length).toBeGreaterThan(0)
    expect(near.every((row) => row.near !== null && row.near.percent >= 80)).toBe(true)
    expect(server().list({ q: 'chloe@mapleandpine' }, {}, 'partner-owner').items.map((row) => row.name)).toEqual(['Maple & Pine'])
  })

  it('words each status as the screen shows it, from the fixture clock', () => {
    const byId = new Map(server().list({ q: 'st-' }, {}, 'partner-owner').items.map((row) => [row.id, row]))
    const rows = server()
    const find = (id: string) => rows.list({ q: id.replace('st-', '').replace('-', ' ') }, {}, 'partner-owner').items.find((row) => row.id === id) ?? byId.get(id)
    expect(find('st-tidewater')?.state).toEqual({ kind: 'pastdue', daysPastDue: 9 })
    expect(find('st-harbor')?.state).toMatchObject({ kind: 'trial', daysLeft: 2 })
    expect(find('st-redline')?.state).toEqual({ kind: 'suspended', reason: 'Chargebacks on 3 orders ($2,840).' })
    expect(find('st-summit')?.state).toEqual({ kind: 'cancelled', since: '2026-09-02T00:00:00Z' })
    expect(find('st-oakline')?.near).toEqual({ percent: 100, limit: 'staff' })
    expect(find('st-juniper')?.salesLastMonth).toEqual({ amount: 1842000, currency: 'USD' })
    expect(find('st-maple')?.salesLastMonth?.currency).toBe('CAD')
  })

  it('lets only Owners and Admins create a store, and says who can', () => {
    expect(server().list({}, {}, 'partner-owner').actions.create).toEqual({ allowed: true })
    expect(server().list({}, {}, 'partner-admin').actions.create).toEqual({ allowed: true })
    for (const role of ['partner-support', 'partner-finance', 'partner-read-only'] as const) {
      expect(server().list({}, {}, role).actions.create).toEqual({ allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' })
    }
    expect(server().form('partner-owner', 'draft').permission).toEqual({ allowed: false, reason: 'PARTNER_NOT_LIVE' })
  })

  it('searches name, code, domain and owner email, eight at most', () => {
    const s = server()
    expect(s.search('juniper').map((match) => match.name)).toContain('Juniper & Co.')
    expect(s.search('baysidepets.com').map((match) => match.id)).toEqual(['st-bayside'])
    expect(s.search('ethan@').map((match) => match.id)).toEqual(['st-bayside'])
    expect(s.search('co').length).toBeLessThanOrEqual(8)
    expect(s.search('  ')).toEqual([])
  })
})

describe('creating a store', () => {
  beforeEach(() => vi.useFakeTimers({ now: Date.parse('2026-10-02T10:00:00Z') }))
  afterEach(() => vi.useRealTimers())

  const input = createStoreInput.parse({ name: 'Cascade Coffee', ownerName: 'Rin Ota', ownerEmail: 'rin@cascade.coffee', country: 'Canada', planId: 'growth', trialDays: 14 })

  it('refuses the roles that may not, and the partner that is not live', () => {
    expect(server().create(input, 'partner-finance', 'live')).toEqual({ ok: false, reason: 'OWNERS_AND_ADMINS_ONLY' })
    expect(server().create(input, 'partner-owner', 'awaiting')).toEqual({ ok: false, reason: 'PARTNER_NOT_LIVE' })
  })

  it('adds the store on trial, newest first, and walks the signup steps to done', () => {
    const s = createStoresServer(sampleStores, () => Date.now())
    const result = s.create(input, 'partner-admin', 'live')
    if (!result.ok) throw new Error(result.reason)
    const row = s.list({}, {}, 'partner-admin').items[0]
    expect(row).toMatchObject({ id: result.storeId, name: 'Cascade Coffee', storefront: 'building', state: { kind: 'trial', daysLeft: 14 }, createdAt: '2026-09-29T00:00:00Z' })
    expect(row?.domain.host).toBe('cascade-coffee.shops.northstar.com')
    expect(s.progress(result.storeId).steps.map((step) => step.state)).toEqual(['running', 'waiting', 'waiting', 'waiting', 'waiting'])
    vi.advanceTimersByTime(1900)
    expect(s.progress(result.storeId).steps.map((step) => step.state)).toEqual(['done', 'done', 'running', 'waiting', 'waiting'])
    vi.advanceTimersByTime(2000)
    const finished = s.progress(result.storeId)
    expect(finished.done).toBe(true)
    expect(finished.steps.every((step) => step.state === 'done')).toBe(true)
    expect(s.list({ q: 'cascade' }, {}, 'partner-admin').items[0]?.storefront).toBe('live')
  })

  it('rejects input the form would never send', () => {
    expect(createStoreInput.safeParse({ ...input, ownerEmail: 'not-an-email' }).success).toBe(false)
    expect(createStoreInput.safeParse({ ...input, trialDays: 3.5 }).success).toBe(false)
    expect(() => server().create({ ...input, trialDays: 21 }, 'partner-owner', 'live')).toThrow()
  })
})
