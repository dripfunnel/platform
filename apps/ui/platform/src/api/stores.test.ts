import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore, loadChangePlanOptions, loadCreateStoreForm, loadStore, loadStores, loadStoresExport, runStoreAction, setStoreBillingStatus, startStoresExport } from './stores'

// The stores rules are the Platform API's (apps/api tests/platform-stores, platform-create-store,
// platform-store-actions); these check the client reads each answer the way the screens expect.
const answer = vi.fn<(body: { query: string; variables?: Record<string, unknown> }) => unknown>()
beforeEach(() => {
  answer.mockReset()
  vi.stubGlobal('fetch', (_: string, init: RequestInit) => Promise.resolve(new Response(JSON.stringify(answer(JSON.parse(String(init.body)) as { query: string })))))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const permission = (allowed: boolean, reason: string | null = null) => ({ allowed, reason })
const state = (kind: string, extra: object = {}) => ({ kind, trialEndsAt: null, daysLeft: null, daysPastDue: null, reason: null, since: null, ...extra })
const row = { id: 's1', name: 'Juniper & Co.', code: 'juniper-co', owner: { name: 'Anjali Nair', email: 'anjali@x.example' }, plan: { id: 'p1', name: 'Pro' }, near: { percent: 84, limit: 'ai_prompts' }, state: state('pastdue', { daysPastDue: 9 }), storefront: 'live', domain: null, createdAt: '2025-12-01T00:00:00.000Z', billingStatus: 'past_due' }
const pageInfo = { startCursor: null, endCursor: 'c1', hasPreviousPage: false, hasNextPage: true }

describe('loadStores', () => {
  it('sends only the declared filter, reads the API’s keys as the console’s, and the three permissions', async () => {
    answer.mockReturnValue({ data: { stores: { items: [row], pageInfo, plans: [], billingMode: 'own', createPermission: permission(false, 'PARTNER_PAUSED'), exportPermission: permission(true), billingStatusPermission: permission(false, 'BILLING_ROLES_ONLY') } } })
    const page = await loadStores({ status: 'pastdue', ...({ state: 'empty', billing: 'own' } as object) }, { after: 'c0' })
    expect(answer.mock.calls[0]?.[0].variables).toEqual({ filter: { status: 'pastdue' }, after: 'c0' })
    expect(page.items[0]).toMatchObject({ near: { percent: 84, limit: 'ai' }, state: { kind: 'pastdue', daysPastDue: 9 }, billingStatus: 'pastdue', domain: null, salesLastMonth: null })
    expect(page.actions).toEqual({ create: { allowed: false, reason: 'PARTNER_PAUSED' }, export: { allowed: true }, billingStatus: { allowed: false, reason: 'BILLING_ROLES_ONLY' } })
    expect(page.pageInfo.hasNextPage).toBe(true)
  })

  it('keeps a store with no trial end or owner on record, and refuses a refusal it was never promised', async () => {
    answer.mockReturnValueOnce({ data: { stores: { items: [{ ...row, owner: { name: null, email: null }, state: state('trial') }], pageInfo, plans: [], billingMode: 'dripfunnel', createPermission: permission(true), exportPermission: permission(true), billingStatusPermission: null } } })
    expect((await loadStores({}, {})).items[0]).toMatchObject({ owner: { name: '', email: '' }, state: { kind: 'trial', trialEndsAt: null, daysLeft: null } })
    answer.mockReturnValueOnce({ data: { stores: { items: [], pageInfo, plans: [], billingMode: 'dripfunnel', createPermission: permission(false, 'SOMETHING_NEW'), exportPermission: permission(true), billingStatusPermission: null } } })
    await expect(loadStores({}, {})).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })
})

const storeDetail = {
    row: { ...row, state: state('trial', { trialEndsAt: '2026-10-10T00:00:00.000Z', daysLeft: 2 }), domain: null },
    country: 'US',
    price: { amount: 9900, currency: 'USD' },
    people: { count: 9, suppliers: 3 },
    contacts: [],
    usage: [{ limit: 'publish_now', used: 48, cap: 160, percent: 30, monthly: true }],
    overrides: [{ id: 'o1', limit: 'publish_now', amount: 10, duration: 'month', reason: 'Diwali', by: 'Diego', at: '2026-09-02T12:00:00.000Z' }],
    billing: { interval: 'month', nextChargeAt: '2026-10-10T00:00:00.000Z', cardLast4: null, mode: 'dripfunnel', partnerName: 'Northstar Commerce' },
    site: { previewHost: 'juniper-co.preview.northstar.example', liveHost: 'juniper-co.shops.northstar.example', lastPublishAt: null },
    records: [],
    setup: { state: 'stuck', error: null },
    trialExtensions: [],
    trialOffers: [{ days: 3, endsAt: '2026-10-13T00:00:00.000Z' }],
    support: { allowed: true, people: [{ id: 'u1', name: 'Ana', email: 'ana@x.example', role: 'supplier-admin', supplier: 'Loomcraft', status: 'active', lastSignInAt: null }] },
    activity: [{ id: 'a1', at: '2026-03-01T12:00:00.000Z', who: 'Diego', action: 'store.plan_changed', result: 'success' }],
    actions: { changePlan: permission(true), extendTrial: permission(false, 'FINANCE_TRIAL_ONLY'), addOverride: null, resendInvite: null, restore: null, suspend: permission(true), retryStep: permission(true) },
}

describe('loadStore', () => {
  const detail = storeDetail

  it('assembles the page from the store and its signup steps, keeping only the actions the store offers', async () => {
    answer.mockImplementation(({ query }) =>
      query.includes('provisioning(') ? { data: { provisioning: { done: false, elapsedSeconds: 600, steps: [{ key: 'account', state: 'done' }, { key: 'store', state: 'running' }] } } } : { data: { store: detail } },
    )
    const store = await loadStore('s1')
    expect(store?.domain).toEqual({ host: 'juniper-co.shops.northstar.example', custom: false, status: 'live' })
    expect(store?.billing).toMatchObject({ cycle: 'monthly', next: { kind: 'firstCharge', at: '2026-10-10T00:00:00.000Z' }, payment: 'noCard' })
    expect(store?.setup.steps).toEqual([{ key: 'account', state: 'done', detail: null }, { key: 'store', state: 'slow', detail: null }])
    expect(store?.overrides[0]).toMatchObject({ limit: 'publish', amount: 10 })
    expect(store?.support.people[0]).toMatchObject({ role: 'supplier-admin', supplier: 'Loomcraft' })
    expect(Object.keys(store?.actions ?? {})).toEqual(['changePlan', 'extendTrial', 'suspend', 'retryStep'])
  })

  it('reads a store that isn’t the partner’s as null', async () => {
    answer.mockReturnValue({ data: { store: null } })
    expect(await loadStore('elsewhere')).toBeNull()
  })
})

describe('the store actions', () => {
  it('sends each action as its mutation, the limit in the API’s key, and reads a refusal by code', async () => {
    answer.mockReturnValueOnce({ data: { addLimitOverride: { ok: true, reason: null } } })
    expect(await runStoreAction('s1', { action: 'addOverride', limit: 'ai', amount: 50, duration: 'month', reason: 'Launch' })).toEqual({ ok: true })
    expect(answer.mock.calls[0]?.[0]).toMatchObject({ variables: { id: 's1', limit: 'ai_prompts', amount: 50, duration: 'month', reason: 'Launch' } })
    answer.mockReturnValueOnce({ data: { changeStorePlan: { ok: false, reason: 'NO_BILLING_DATE' } } })
    expect(await runStoreAction('s1', { action: 'changePlan', planId: 'p2', when: 'next', reason: 'Upgrade' })).toEqual({ ok: false, reason: 'NO_BILLING_DATE' })
  })

  it('reads the plan options with each proration as Money', async () => {
    answer.mockReturnValue({ data: { changePlanOptions: { ok: true, reason: null, nextBillingAt: null, plans: [{ id: 'p2', name: 'Growth', amount: 4900, currency: 'USD', proration: { kind: 'credit', amount: 1700, currency: 'USD' } }] } } })
    expect(await loadChangePlanOptions('s1')).toEqual({ plans: [{ id: 'p2', name: 'Growth', price: { amount: 4900, currency: 'USD' } }], nextBillingAt: null, proration: { p2: { kind: 'credit', amount: { amount: 1700, currency: 'USD' } } } })
  })

  it('sets the billing status in the API’s word for past due', async () => {
    answer.mockReturnValue({ data: { setStoreBillingStatus: { ok: false, reason: 'NOT_SELF_BILLING' } } })
    expect(await setStoreBillingStatus('s1', 'pastdue')).toEqual({ ok: false, reason: 'NOT_SELF_BILLING' })
    expect(answer.mock.calls[0]?.[0].variables).toEqual({ id: 's1', status: 'past_due' })
  })
})

describe('creating a store', () => {
  it('reads the form with each plan’s prices by currency and its own trial', async () => {
    answer.mockReturnValue({ data: { createStoreForm: { permission: permission(true), countries: [{ code: 'US', name: 'United States', currency: 'USD' }], plans: [{ id: 'p1', name: 'Starter', prices: [{ amount: 2900, currency: 'USD' }], trialDays: 14 }], trials: [0, 7, 14, 30], billingMode: 'dripfunnel' } } })
    expect((await loadCreateStoreForm()).plans[0]).toEqual({ id: 'p1', name: 'Starter', trialDays: 14, price: { USD: { amount: 2900, currency: 'USD' } } })
  })

  it('creates, and reads a refusal by its code', async () => {
    answer.mockReturnValueOnce({ data: { createStore: { ok: true, storeId: 's9', reason: null, field: null } } })
    expect(await createStore({ name: 'Nimbus', ownerName: 'Ann', ownerEmail: 'ann@x.example', country: 'US', planId: 'p1', trialDays: 14 })).toEqual({ ok: true, storeId: 's9' })
    answer.mockReturnValueOnce({ data: { createStore: { ok: false, storeId: null, reason: 'STORE_LIMIT_REACHED', field: null } } })
    expect(await createStore({ name: 'Nimbus', ownerName: 'Ann', ownerEmail: 'ann@x.example', country: 'US', planId: 'p1', trialDays: 14 })).toEqual({ ok: false, reason: 'STORE_LIMIT_REACHED' })
  })
})

describe('Extend trial’s choices', () => {
  it('are the API’s, dated as it will grant them, never worked out on this clock', async () => {
    const offers = [3, 7, 14].map((days) => ({ days, endsAt: `2026-10-${10 + days}T00:00:00.000Z` }))
    answer.mockImplementation(({ query }) => (query.includes('provisioning(') ? { data: { provisioning: null } } : { data: { store: { ...storeDetail, trialOffers: offers } } }))
    expect((await loadStore('s1'))?.trialExtensions).toEqual(offers)
  })
})

describe('the store page’s signup steps', () => {
  it('are empty without a signup job, and any other failure is the page’s to show', async () => {
    answer.mockImplementation(({ query }) => (query.includes('provisioning(') ? { data: { provisioning: null } } : { data: { store: storeDetail } }))
    expect(await loadStore('s1')).not.toBeNull()
    answer.mockImplementation(({ query }) => (query.includes('provisioning(') ? { errors: [{ message: 'no', extensions: { code: 'FORBIDDEN' } }] } : { data: { store: storeDetail } }))
    await expect(loadStore('s1')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('the store accounts export', () => {
  it('starts, maps the API’s job states, and makes one link per ready job, revoked when it expires', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-04T10:00:00Z') })
    const revoked: string[] = []
    vi.stubGlobal('URL', Object.assign(Object.create(URL) as typeof URL, { createObjectURL: () => 'blob:stores', revokeObjectURL: (url: string) => revoked.push(url) }))
    answer.mockReturnValueOnce({ data: { exportStores: { ok: true, jobId: 'x1', reason: null } } })
    expect(await startStoresExport({ status: 'trial' })).toMatchObject({ id: 'x1', state: 'preparing' })
    answer.mockReturnValueOnce({ data: { storesExport: { id: 'x1', state: 'queued', rows: null, truncated: false, csv: null, expiresAt: null } } })
    expect((await loadStoresExport('x1'))?.state).toBe('preparing')
    answer.mockReturnValueOnce({ data: { storesExport: { id: 'x1', state: 'done', rows: 86, truncated: false, csv: 'a,b', expiresAt: '2026-10-04T11:00:00.000Z' } } })
    expect(await loadStoresExport('x1')).toMatchObject({ state: 'ready', entries: 86, url: 'blob:stores' })
    vi.advanceTimersByTime(60 * 60_000)
    expect(revoked).toEqual(['blob:stores'])
    answer.mockReturnValueOnce({ data: { storesExport: { id: 'x1', state: 'too_large', rows: null, truncated: false, csv: null, expiresAt: null } } })
    expect((await loadStoresExport('x1'))?.state).toBe('tooLarge')
  })

  it('says when the API capped the export, and drops the link once the job has expired', async () => {
    const revoked: string[] = []
    vi.stubGlobal('URL', Object.assign(Object.create(URL) as typeof URL, { createObjectURL: () => 'blob:capped', revokeObjectURL: (url: string) => revoked.push(url) }))
    answer.mockReturnValueOnce({ data: { storesExport: { id: 'x2', state: 'done', rows: 5000, truncated: true, csv: 'a,b', expiresAt: null } } })
    expect(await loadStoresExport('x2')).toMatchObject({ state: 'ready', entries: 5000, truncated: true, url: 'blob:capped' })
    answer.mockReturnValueOnce({ data: { storesExport: { id: 'x2', state: 'expired', rows: 5000, truncated: true, csv: null, expiresAt: null } } })
    expect(await loadStoresExport('x2')).toMatchObject({ state: 'expired', url: null })
    expect(revoked).toEqual(['blob:capped'])
  })
})
