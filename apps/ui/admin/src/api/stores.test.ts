import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubApi } from '../testing/apiStub'
import { loadStore, loadStores, runStoreAction } from './stores'

const permission = (allowed: boolean, reason: string | null = null) => ({ allowed, reason, failingChecks: null })

const row = {
  id: 's1',
  name: 'Kiko Kids',
  code: 'kiko-kids',
  partner: { id: 'p1', name: 'Bazaar Cloud' },
  owner: { name: null, email: null },
  plan: { name: null },
  state: { kind: 'past_due', trialEndsAt: null, daysLeft: null, daysPastDue: 9, reason: null, by: null, previous: null, since: null },
  storefront: 'live',
  domain: { host: 'kikokids.example', custom: true, status: 'verifying' },
  setup: { state: 'done', step: null, steps: [], attempts: 0 },
  createdAt: '2025-11-02T00:00:00.000Z',
}

const store = {
  ...row,
  country: 'AE',
  history: [{ at: '2026-09-23T00:00:00.000Z', action: 'store.past_due', by: null, note: '3 failed payments' }],
  counts: { owners: 1, managers: 1, staff: 3, suppliers: 0 },
  site: { version: 'v21', lastBuildAt: null, lastPublishAt: null, previewHost: null },
  provisioning: { error: null },
  records: [{ kind: 'custom', host: 'kikokids.example', record: 'CNAME', expected: 'shops.edge', found: null, status: 'waiting' }],
  users: [
    { id: 'u1', name: 'Fatima', email: 'fatima@kikokids.example', role: 'owner', supplier: null, status: 'active', lastSignInAt: null, impersonate: permission(true) },
    { id: 'u2', name: 'Omar', email: 'omar@kikokids.example', role: 'supplier-admin', supplier: 'Weaves', status: 'invited', lastSignInAt: null, impersonate: permission(false, 'TARGET_NOT_ACTIVE') },
  ],
  supportAccess: true,
  notes: [],
  job: null,
  actions: { suspend: permission(true), restore: null, extendTrial: null, resendInvite: permission(false, 'INVITERS_ONLY'), addNote: permission(true) },
}

afterEach(() => void vi.unstubAllGlobals())

describe('loadStores', () => {
  it('sends the console status vocabulary to the API in its own, and reads the row back', async () => {
    const stub = stubApi({ data: { stores: { items: [row], pageInfo: { startCursor: 'a', endCursor: 'b', hasPreviousPage: false, hasNextPage: true }, partners: [] } } })
    const page = await loadStores({ status: 'pastdue', created: '7d' }, { after: 'x' })
    expect(stub.calls[0]?.variables).toEqual({ filter: { status: 'past_due', created: '7d' }, after: 'x', before: undefined })
    expect(page.items[0]?.state).toEqual({ kind: 'pastdue', daysPastDue: 9 })
    expect(page.items[0]?.domain.status).toBe('verifying')
    expect(page.pageInfo.hasNextPage).toBe(true)
  })
})

describe('loadStore', () => {
  it('maps the API roles and permissions onto the screen shapes', async () => {
    stubApi({ data: { store } })
    const loaded = await loadStore('s1')
    expect(loaded?.users.map((u) => u.role)).toEqual(['owner', 'supplierAdmin'])
    expect(loaded?.impersonate).toEqual({ u1: { allowed: true }, u2: { allowed: false, reason: 'TARGET_NOT_ACTIVE' } })
    expect(loaded?.actions).toEqual({ suspend: { allowed: true }, resendInvite: { allowed: false, reason: 'INVITERS_ONLY' }, addNote: { allowed: true } })
    expect(loaded?.history[0]?.action).toBe('store.past_due')
  })

  it('reads the Engineer on call emergency suspend as such', async () => {
    stubApi({ data: { store: { ...store, actions: { ...store.actions, suspend: permission(true, 'EMERGENCY') } } } })
    expect((await loadStore('s1'))?.actions.suspend).toEqual({ allowed: true, emergency: true })
  })

  it('is null for a store that does not exist', async () => {
    stubApi({ data: { store: null } })
    expect(await loadStore('nope')).toBeNull()
  })

  it('refuses a permission code the API never declared', async () => {
    stubApi({ data: { store: { ...store, actions: { ...store.actions, suspend: permission(false, 'MYSTERY') } } } })
    await expect(loadStore('s1')).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })
})

describe('runStoreAction', () => {
  it('sends the trial end as a UTC day and throws the API code when refused', async () => {
    const ok = stubApi({ data: { extendTrial: { ok: true, code: null } } })
    await runStoreAction('s1', 'extendTrial', null, '2026-10-20')
    expect(ok.calls[0]?.variables).toEqual({ id: 's1', trialEndsAt: '2026-10-20T00:00:00.000Z' })
    stubApi({ data: { suspendStore: { ok: false, code: 'REASON_REQUIRED' } } })
    await expect(runStoreAction('s1', 'suspend', '', null)).rejects.toMatchObject({ code: 'REASON_REQUIRED' })
  })
})
