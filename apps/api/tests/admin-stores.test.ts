import { graphql, isObjectType, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminSchema, type AdminContext } from '#apis/admin/schema'
import { factsOf } from '#auth/activity'
import { isAssigned } from '#auth/assignment'
import type { StaffMember, StaffRole } from '#auth/staff'
import type { DnsLookup } from '#integrations/dns/doh'
import { customDomainRecheckDeliverer } from '#jobs/queues/deliverers/customDomainRecheck'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createStoresService, storeAudit } from '#saas/stores/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #34 through the real schema: declarations, the policy, the service and the database.

let db: TestDatabase
const now = new Date('2026-10-02T12:00:00Z')
const staffByRole = new Map<StaffRole, StaffMember>()

const request = new Request('https://admin.dripfunnel.com/api', { headers: { 'cf-ray': 'ray-test', 'cf-connecting-ip': '203.0.113.5', 'user-agent': 'test' } })

const contextFor = (staff: StaffMember | null): AdminContext => {
  const assigned = (staffId: string, target: Parameters<typeof isAssigned>[2]) => isAssigned(db.sql, staffId, target)
  return {
    staff,
    isAssigned: assigned,
    staffActivity: null,
    partners: null,
    stores: staff ? createStoresService({ sql: db.sql, staff, facts: factsOf(request), activity: activityLog, isAssigned: assigned, now: () => now }) : null,
    provisioning: null,
    dashboard: null,
  }
}

const run = async <T = Record<string, unknown>>(source: string, staff: StaffMember | null, variables: Record<string, unknown> = {}): Promise<{ data: T | null; code: string | undefined }> => {
  const result = await graphql({ schema: adminSchema as GraphQLSchema, source, variableValues: variables, contextValue: contextFor(staff) })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

const as = (role: StaffRole): StaffMember => {
  const s = staffByRole.get(role)
  if (!s) throw new Error(`no seeded staff with role ${role}`)
  return s
}

const storeIdOf = async (name: string): Promise<string> => {
  const [row] = await db.sql<{ id: string }[]>`select id from store where name = ${name}`
  if (!row) throw new Error(`store ${name} missing`)
  return row.id
}

const entriesFor = (storeId: string, action: string) =>
  db.sql<{ actor_label: string; reason: string | null; visibility: string; changes: unknown }[]>`
    select actor_label, reason, visibility, changes from activity_log where store_id = ${storeId} and action = ${action} order by occurred_at
  `

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  const rows = await db.sql<{ id: string; email: string; name: string; role_key: StaffRole }[]>`select id, email, name, role_key from staff_user order by created_at`
  for (const r of rows) if (!staffByRole.has(r.role_key)) staffByRole.set(r.role_key, { id: r.id, email: r.email, name: r.name, role: r.role_key })
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

const outcome = `ok code status emergency trialEndsAt noteId`

describe('declarations (§5.2, §12)', () => {
  it('every store mutation declares the action the service records', () => {
    const recorded = new Set<string>(Object.values(storeAudit))
    const mutations = adminSchema.getMutationType()?.getFields() ?? {}
    for (const name of ['suspendStore', 'restoreStore', 'extendTrial', 'resendStoreOwnerInvite', 'addStoreNote', 'recheckStoreDomain']) {
      const audit = mutations[name]?.extensions.access?.audit
      expect([name, audit !== undefined && recorded.has(audit)]).toEqual([name, true])
    }
  })

  it('no catalogue, order or customer field is reachable from Store', () => {
    // §5.2: staff reach those only by impersonating. Walk every type reachable from Store.
    const forbidden = /product|order|customer|catalog|cart|refund|payment|card/i
    const seen = new Set<string>()
    const walk = (name: string) => {
      if (seen.has(name)) return
      seen.add(name)
      const type = adminSchema.getType(name)
      if (!type || !isObjectType(type)) return
      for (const [fieldName, field] of Object.entries(type.getFields())) {
        expect([`${name}.${fieldName}`, forbidden.test(fieldName)]).toEqual([`${name}.${fieldName}`, false])
        const inner = String(field.type).replaceAll(/[[\]!]/g, '')
        walk(inner)
      }
    }
    walk('Store')
    expect(seen.size).toBeGreaterThan(5)
  })
})

describe('stores(filter, after, before) (§5.1)', () => {
  const list = `query($filter: StoreFilter, $after: String, $first: Int) { stores(filter: $filter, after: $after, first: $first) {
    items { id name code partner { name } owner { name email } plan { name } state { kind daysLeft daysPastDue reason previous } storefront domain { host custom status } setup { state step steps attempts } }
    pageInfo { hasNextPage endCursor } partners { name } } }`
  interface Page {
    stores: { items: Record<string, unknown>[]; pageInfo: { hasNextPage: boolean; endCursor: string | null }; partners: { name: string }[] }
  }
  const items = async (staff: StaffMember, filter: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => {
    const r = await run<Page>(list, staff, { filter, ...extra })
    if (r.code) throw new Error(r.code)
    return r.data?.stores ?? { items: [], pageInfo: { hasNextPage: false, endCursor: null }, partners: [] }
  }

  it('serves the columns with the API-stated facts, capped at 25, newest first, by cursor', async () => {
    const page = await items(as('staff-super-admin'), {}, { first: 500 })
    expect(page.items).toHaveLength(25)
    expect(page.pageInfo.hasNextPage).toBe(true)
    const next = await items(as('staff-super-admin'), {}, { first: 25, after: page.pageInfo.endCursor })
    expect(new Set([...page.items, ...next.items].map((i) => i['id'])).size).toBe(50)
    const all = await items(as('staff-super-admin'), { q: 'Kiko' })
    expect(all.items[0]).toMatchObject({
      name: 'Kiko Kids',
      partner: { name: 'Bazaar Cloud' },
      owner: { name: 'Fatima Al Nuaimi' },
      plan: { name: 'Growth UAE' },
      state: { kind: 'past_due', daysPastDue: 9 },
      storefront: 'live',
      domain: { host: 'kikokids.example', custom: true, status: 'live' },
      setup: { state: 'done' },
    })
    const redline = (await items(as('staff-super-admin'), { q: 'Redline' })).items[0]
    expect(redline?.['state']).toMatchObject({ kind: 'suspended', reason: 'Chargeback', previous: 'active' })
    const fjord = (await items(as('staff-super-admin'), { q: 'Fjord' })).items[0]
    expect(fjord).toMatchObject({ storefront: 'building', setup: { state: 'stuck', step: 'firstBuild', attempts: 2 } })
    expect((fjord?.['setup'] as { steps: string[] }).steps).toHaveLength(8)
    const tidewater = (await items(as('staff-super-admin'), { q: 'Tidewater' })).items[0]
    expect(tidewater).toMatchObject({ storefront: 'own', domain: { custom: false } })
    expect((tidewater?.['setup'] as { steps: string[] }).steps).toHaveLength(3)
  })

  it('filters by partner, status, storefront, setup state, created window and search, all in SQL', async () => {
    const sa = as('staff-super-admin')
    const [bz] = await db.sql<{ id: string }[]>`select id from partner where name = 'Bazaar Cloud'`
    expect((await items(sa, { partner: bz?.id })).items.every((i) => (i['partner'] as { name: string }).name === 'Bazaar Cloud')).toBe(true)
    expect((await items(sa, { status: 'suspended' })).items.map((i) => i['name'])).toEqual(['Redline Moto Parts'])
    expect((await items(sa, { storefront: 'own' })).items.map((i) => i['name']).sort()).toEqual(['Atelier Nove', 'Tidewater Surf'])
    expect((await items(sa, { setup: 'failed' })).items.map((i) => i['name'])).toEqual(['Peak Supply Co.'])
    expect((await items(sa, { setup: 'stuck' })).items.map((i) => i['name'])).toEqual(['Fjord Outdoor'])
    expect((await items(sa, { created: '7d' })).items.map((i) => i['name']).sort()).toEqual(['Fjord Outdoor', 'Grünwerk', 'Peak Supply Co.', 'Saffron Street', 'Tidewater Surf'])
    expect((await items(sa, { q: 'jenna@' })).items.map((i) => i['name'])).toEqual(['Harbor Coffee Co.'])
    expect((await run(list, sa, { filter: { status: 'bogus' } })).code).toBe('INVALID_INPUT')
  })

  it('a Partner manager sees only their assigned partners stores, and the partner filter offers only those', async () => {
    const page = await items(as('staff-partner-manager'), {}, { first: 25 })
    expect(page.items.length).toBeGreaterThan(0)
    expect(page.items.every((i) => ['Kaufladen Digital', 'Nordlicht Media', 'Tallis Studio'].includes((i['partner'] as { name: string }).name))).toBe(true)
    expect(page.partners.map((p) => p.name).sort()).toEqual(['Kaufladen Digital', 'Nordlicht Media', 'Tallis Studio'])
    expect((await run(list, null)).code).toBe('UNAUTHENTICATED')
  })
})

describe('store(id) (§5.2, §5.3)', () => {
  const detail = `query($id: ID!) { store(id: $id) {
    name country history { action by note } counts { owners managers staff suppliers } site { version lastBuildAt previewHost liveHost }
    provisioning { error details } records { kind host record expected found status } users { name role supplier status impersonate { allowed reason } }
    supportAccess notes { by text } job { id actions { retry { allowed reason } undo { allowed reason } } }
    actions { suspend { allowed reason } restore { allowed reason } extendTrial { allowed reason } resendInvite { allowed reason } addNote { allowed reason } } } }`
  interface Detail {
    store: Record<string, unknown> & { actions: Record<string, { allowed: boolean; reason: string | null } | null>; job: { id: string; actions: Record<string, { allowed: boolean; reason: string | null } | null> } | null }
  }

  it('serves the eight tabs from real rows', async () => {
    const id = await storeIdOf('Mehta Textiles')
    const { data } = await run<Detail>(detail, as('staff-super-admin'), { id })
    const s = data?.store
    expect(s).toMatchObject({ name: 'Mehta Textiles', country: 'IN', supportAccess: true, counts: { owners: 1, managers: 1, staff: 2, suppliers: 3 } })
    expect((s?.['history'] as { action: string }[]).map((h) => h.action)).toEqual(['store.trial_started', 'store.activated'])
    expect(s?.['site']).toMatchObject({ version: 'v48', previewHost: 'mehta-textiles.preview.bazaarcloud.example', liveHost: 'mehtatextiles.example' })
    // A custom domain still waiting is shown with its status, and the live link is the default address.
    const maple = (await run<Detail>(detail, as('staff-super-admin'), { id: await storeIdOf('Maple & Pine Home') })).data?.store
    expect(maple?.['site']).toMatchObject({ liveHost: 'maple-pine.shops.northstar.example' })
    expect((await run<{ store: { domain: { host: string; custom: boolean; status: string } } }>(`query($id: ID!) { store(id: $id) { domain { host custom status } } }`, as('staff-super-admin'), { id: await storeIdOf('Maple & Pine Home') })).data?.store.domain).toEqual({ host: 'shop.mapleandpine.example', custom: true, status: 'waiting' })
    expect((await run<Detail>(detail, as('staff-super-admin'), { id: 'not-an-id' })).data?.store).toBeNull()
    expect((s?.['records'] as { kind: string; record: string | null }[]).map((r) => [r.kind, r.record])).toEqual([['custom', 'CNAME'], ['ownership', 'TXT']])
    const users = s?.['users'] as { name: string; role: string; supplier: string | null; impersonate: { allowed: boolean; reason: string | null } }[]
    expect(users.find((u) => u.name === 'Lakshmi Iyer')).toMatchObject({ role: 'supplier-admin', supplier: 'Kaveri Weaves', impersonate: { allowed: true } })
    expect(users.find((u) => u.name === 'Aisha Khan')?.impersonate).toEqual({ allowed: false, reason: 'TARGET_NOT_ACTIVE' })
    expect(s?.['job']).toBeNull()

    const kiko = await storeIdOf('Kiko Kids')
    const notes = (await run<Detail>(detail, as('staff-super-admin'), { id: kiko })).data?.store['notes'] as { by: string }[]
    expect(notes[0]?.by).toBe('Priya Shah')
    const peak = await storeIdOf('Peak Supply Co.')
    const peakStore = (await run<Detail>(detail, as('staff-super-admin'), { id: peak })).data?.store
    expect(peakStore?.['provisioning']).toMatchObject({ error: 'GitHub didn’t respond while creating the storefront.' })
    expect((peakStore?.['provisioning'] as { details: string }).details).toContain('502')
    expect(peakStore?.job?.actions).toEqual({ retry: { allowed: true, reason: null }, undo: { allowed: true, reason: null } })
    // The raw detail is for the roles that open Provisioning; Read-only reads null.
    expect(((await run<Detail>(detail, as('staff-read-only'), { id: peak })).data?.store['provisioning'] as { details: string | null }).details).toBeNull()
  })

  it('the permission block depends on the role and the record', async () => {
    const mehta = await storeIdOf('Mehta Textiles')
    const redline = await storeIdOf('Redline Moto Parts')
    const harbor = await storeIdOf('Harbor Coffee Co.')
    const sa = (await run<Detail>(detail, as('staff-super-admin'), { id: mehta })).data?.store.actions
    expect(sa?.['suspend']).toEqual({ allowed: true, reason: null })
    expect(sa?.['restore']).toBeNull()
    expect(sa?.['extendTrial']).toBeNull()
    expect(sa?.['resendInvite']).toBeNull()
    await db.sql`insert into invitation (store_id, email, role_key, expires_at, invited_by_label) values (${mehta}, 'new-owner@mehtatextiles.example', 'owner', now() + interval '7 days', 'Signup')`
    expect((await run<Detail>(detail, as('staff-support'), { id: mehta })).data?.store.actions['resendInvite']).toEqual({ allowed: true, reason: null })
    await db.sql`delete from invitation where store_id = ${mehta}`
    const engineer = (await run<Detail>(detail, as('staff-engineer'), { id: mehta })).data?.store.actions
    expect(engineer?.['suspend']).toEqual({ allowed: true, reason: 'EMERGENCY' })
    expect(engineer?.['addNote']).toEqual({ allowed: true, reason: null })
    const support = (await run<Detail>(detail, as('staff-support'), { id: redline })).data?.store.actions
    expect(support?.['suspend']).toBeNull()
    expect(support?.['restore']).toEqual({ allowed: false, reason: 'SUPER_ADMIN_ONLY' })
    const readOnly = (await run<Detail>(detail, as('staff-read-only'), { id: harbor })).data?.store.actions
    expect(readOnly?.['extendTrial']).toEqual({ allowed: false, reason: 'SUPER_ADMIN_ONLY' })
    expect(readOnly?.['addNote']).toEqual({ allowed: false, reason: 'NOTERS_ONLY' })
    // Impersonation on a closed partner's store is refused for the record, not the role.
    const harbourBooks = await storeIdOf('Harbour Books')
    await db.sql`update partner set state = 'closed' where name = 'Old Harbour Co'`
    const users = (await run<Detail>(detail, as('staff-support'), { id: harbourBooks })).data?.store['users'] as { impersonate: { reason: string | null } }[]
    expect(users[0]?.impersonate.reason).toBe('PARTNER_CLOSED')
    await db.sql`update partner set state = 'offboarding' where name = 'Old Harbour Co'`
  })

  it('a Partner manager reaches only their assigned partners stores', async () => {
    expect((await run(detail, as('staff-partner-manager'), { id: await storeIdOf('Mehta Textiles') })).code).toBe('FORBIDDEN')
    expect((await run(detail, as('staff-partner-manager'), { id: await storeIdOf('Grünwerk') })).code).toBeUndefined()
  })
})

describe('suspend and restore (§5.3, SAAS.md §4.2)', () => {
  const suspend = `mutation($id: ID!, $reason: String!) { suspendStore(id: $id, reason: $reason) { ${outcome} } }`
  const restore = `mutation($id: ID!, $reason: String!) { restoreStore(id: $id, reason: $reason) { ${outcome} } }`
  type Out = Record<string, { ok: boolean; code: string | null; status: string | null; emergency: boolean | null }>

  it('both need a reason; suspend is Super admin and Engineer on call, restore Super admin only', async () => {
    const kiko = await storeIdOf('Kiko Kids')
    expect((await run<Out>(suspend, as('staff-super-admin'), { id: kiko, reason: '  ' })).data?.['suspendStore']).toMatchObject({ ok: false, code: 'REASON_REQUIRED' })
    expect((await run(suspend, as('staff-support'), { id: kiko, reason: 'x' })).code).toBe('FORBIDDEN')
    expect((await run(suspend, as('staff-partner-manager'), { id: kiko, reason: 'x' })).code).toBe('FORBIDDEN')
    expect((await run(restore, as('staff-engineer'), { id: kiko, reason: 'x' })).code).toBe('FORBIDDEN')
  })

  it('suspend stores the merchant-visible reason and who, pauses the storefront and tells the Owner through the outbox with no DripFunnel route; restore returns to the previous status', async () => {
    const kiko = await storeIdOf('Kiko Kids')
    const before = await db.sql`select 1 from outbox where store_id = ${kiko}`
    const result = (await run<Out>(suspend, as('staff-engineer'), { id: kiko, reason: 'Fraud review' })).data?.['suspendStore']
    expect(result).toMatchObject({ ok: true, status: 'suspended', emergency: true })
    const [row] = await db.sql<{ status: string; suspended_reason: string; suspended_by_label: string; suspended_previous_status: string }[]>`select status, suspended_reason, suspended_by_label, suspended_previous_status from store where id = ${kiko}`
    expect(row).toEqual({ status: 'suspended', suspended_reason: 'Fraud review', suspended_by_label: 'Sam Iyer', suspended_previous_status: 'past_due' })
    const entries = await entriesFor(kiko, storeAudit.suspendStore)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ reason: 'Fraud review', visibility: 'partner', changes: [{ field: 'status', before: 'past_due', after: 'suspended', redacted: false }] })
    // The review flag is DripFunnel's own note.
    expect((await entriesFor(kiko, storeAudit.emergencyFlagged))[0]?.visibility).toBe('staff')
    const effects = await db.sql<{ kind: string; payload: Record<string, unknown> }[]>`select kind, payload from outbox where store_id = ${kiko} order by created_at`
    expect(effects.length - before.length).toBe(2)
    expect(effects.map((e) => e.kind).sort()).toEqual(['cache.purge', 'email'])
    for (const e of effects) {
      expect(JSON.stringify(e.payload).toLowerCase()).not.toContain('dripfunnel')
    }
    expect(effects.find((e) => e.kind === 'email')?.payload).toMatchObject({ template: 'store-suspended', contact: 'partner-support' })

    expect((await run<Out>(suspend, as('staff-super-admin'), { id: kiko, reason: 'Again' })).data?.['suspendStore']).toMatchObject({ ok: false, code: 'INVALID_STATE' })
    expect((await run<Out>(restore, as('staff-super-admin'), { id: kiko, reason: 'Resolved' })).data?.['restoreStore']).toMatchObject({ ok: true, status: 'past_due' })
    expect((await db.sql<{ kind: string }[]>`select kind from outbox where store_id = ${kiko} order by created_at`).map((e) => e.kind)).toEqual(['email', 'cache.purge', 'email', 'cache.purge'])
    expect((await db.sql<{ status: string; suspended_at: Date | null }[]>`select status, suspended_at from store where id = ${kiko}`)[0]).toEqual({ status: 'past_due', suspended_at: null })
    expect((await run<Out>(restore, as('staff-super-admin'), { id: kiko, reason: 'Again' })).data?.['restoreStore']).toMatchObject({ ok: false, code: 'INVALID_STATE' })
    expect(await entriesFor(kiko, storeAudit.restoreStore)).toHaveLength(1)
  })
})

describe('extend trial, resend the Owner invitation, notes, re-check (§5.3)', () => {
  const extend = `mutation($id: ID!, $at: String!) { extendTrial(id: $id, trialEndsAt: $at) { ${outcome} } }`
  const resend = `mutation($id: ID!) { resendStoreOwnerInvite(id: $id) { ${outcome} } }`
  const note = `mutation($id: ID!, $text: String!) { addStoreNote(id: $id, text: $text) { ${outcome} } }`
  const recheck = `mutation($id: ID!) { recheckStoreDomain(id: $id) { ${outcome} } }`
  type Out = Record<string, { ok: boolean; code: string | null; trialEndsAt: string | null; noteId: string | null }>

  it('extend trial: Super admin, on trial only, to a later date', async () => {
    const harbor = await storeIdOf('Harbor Coffee Co.')
    const later = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString()
    expect((await run(extend, as('staff-engineer'), { id: harbor, at: later })).code).toBe('FORBIDDEN')
    expect((await run<Out>(extend, as('staff-super-admin'), { id: await storeIdOf('Mehta Textiles'), at: later })).data?.['extendTrial']).toMatchObject({ ok: false, code: 'NOT_ON_TRIAL' })
    expect((await run<Out>(extend, as('staff-super-admin'), { id: harbor, at: 'tomorrow' })).data?.['extendTrial']).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect((await run<Out>(extend, as('staff-super-admin'), { id: harbor, at: new Date(now.getTime() - 1000).toISOString() })).data?.['extendTrial']).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect((await run<Out>(extend, as('staff-super-admin'), { id: harbor, at: later })).data?.['extendTrial']).toMatchObject({ ok: true, trialEndsAt: later })
    expect((await entriesFor(harbor, storeAudit.extendTrial))[0]?.visibility).toBe('partner')
  })

  it('resend: a fresh invitation replaces the open one, through the outbox; refused once accepted', async () => {
    const mehta = await storeIdOf('Mehta Textiles')
    expect((await run<Out>(resend, as('staff-support'), { id: mehta })).data?.['resendStoreOwnerInvite']).toMatchObject({ ok: false, code: 'NO_PENDING_INVITATION' })
    const fjord = await storeIdOf('Fjord Outdoor')
    await db.sql`insert into invitation (store_id, email, role_key, expires_at, invited_by_label) values (${fjord}, 'ingrid@fjordoutdoor.example', 'owner', now() + interval '7 days', 'Signup')`
    expect((await run(resend, as('staff-engineer'), { id: fjord })).code).toBe('FORBIDDEN')
    expect((await run<Out>(resend, as('staff-support'), { id: fjord })).data?.['resendStoreOwnerInvite']).toMatchObject({ ok: true })
    const rows = await db.sql<{ revoked_at: Date | null }[]>`select revoked_at from invitation where store_id = ${fjord} order by created_at`
    expect(rows).toHaveLength(2)
    expect(rows[0]?.revoked_at).not.toBeNull()
    expect(rows[1]?.revoked_at).toBeNull()
    const [email] = await db.sql<{ payload: { template: string; to: string } }[]>`select payload from outbox where store_id = ${fjord} and kind = 'email'`
    expect(email?.payload).toMatchObject({ template: 'store-owner-invitation', to: 'ingrid@fjordoutdoor.example' })
    expect(JSON.stringify(email?.payload)).not.toContain('token')
  })

  it('notes are staff only, bounded, and logged without their text', async () => {
    const mehta = await storeIdOf('Mehta Textiles')
    expect((await run(note, as('staff-read-only'), { id: mehta, text: 'hi' })).code).toBe('FORBIDDEN')
    expect((await run<Out>(note, as('staff-partner-manager'), { id: await storeIdOf('Grünwerk'), text: 'x'.repeat(2001) })).data?.['addStoreNote']).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    const added = (await run<Out>(note, as('staff-support'), { id: mehta, text: 'Owner asked about a second warehouse.' })).data?.['addStoreNote']
    expect(added).toMatchObject({ ok: true })
    const [entry] = await entriesFor(mehta, storeAudit.addStoreNote)
    expect(entry).toMatchObject({ visibility: 'staff', reason: null })
    expect(JSON.stringify(entry)).not.toContain('warehouse')
    expect((await db.sql<{ n: string }[]>`select count(*)::text as n from store_note where store_id = ${mehta}`)[0]?.n).toBe('1')
  })

  it('re-check queues the lookup; the deliverer reads both records after commit and only then changes the row', async () => {
    const maple = await storeIdOf('Maple & Pine Home')
    expect((await run(recheck, as('staff-support'), { id: maple })).code).toBe('FORBIDDEN')
    expect((await run<Out>(recheck, as('staff-super-admin'), { id: await storeIdOf('Harbor Coffee Co.') })).data?.['recheckStoreDomain']).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    const looked: string[] = []
    const lookup: DnsLookup = {
      resolve: async (host, type) => {
        looked.push(`${type} ${host}`)
        return type === 'CNAME' ? ['shops.edge.dripfunnel.example'] : ['df-verify=maple-pine']
      },
    }
    expect((await run<Out>(recheck, as('staff-super-admin'), { id: maple })).data?.['recheckStoreDomain']).toMatchObject({ ok: true })
    expect(looked).toEqual([])
    expect((await db.sql<{ status: string }[]>`select status from custom_domain where store_id = ${maple}`)[0]?.status).toBe('waiting')
    const counts = await relayDue(db.sql, { 'custom_domain.recheck': customDomainRecheckDeliverer(db.sql, lookup, () => now) }, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })
    expect(counts.delivered).toBe(1)
    expect(looked.sort()).toEqual(['CNAME shop.mapleandpine.example', 'TXT _df-verify.shop.mapleandpine.example'])
    expect((await db.sql<{ status: string; found_cname: string; ownership_found: string }[]>`select status, found_cname, ownership_found from custom_domain where store_id = ${maple}`)[0]).toEqual({
      status: 'live',
      found_cname: 'shops.edge.dripfunnel.example',
      ownership_found: 'df-verify=maple-pine',
    })
    const [changed] = await db.sql<{ partner_id: string | null; visibility: string }[]>`select partner_id, visibility from activity_log where store_id = ${maple} and action = 'store.domain_status_changed'`
    expect(changed?.visibility).toBe('partner')
    expect(changed?.partner_id).not.toBeNull()
  })

  it('a stored host that is an address is refused before any lookup', async () => {
    const maple = await storeIdOf('Maple & Pine Home')
    await db.sql`update custom_domain set host = '169.254.169.254' where store_id = ${maple}`
    expect((await run<Out>(recheck, as('staff-super-admin'), { id: maple })).data?.['recheckStoreDomain']).toMatchObject({ ok: false, code: 'INVALID_HOSTNAME' })
    await db.sql`update custom_domain set host = 'shop.mapleandpine.example' where store_id = ${maple}`
  })
})

describe('a refused mutation leaves no entry', () => {
  it('suspending a cancelled store', async () => {
    const brightside = await storeIdOf('Brightside Pets')
    const before = await db.sql<{ n: string }[]>`select count(*)::text as n from activity_log where store_id = ${brightside}`
    const r = await run<Record<string, { ok: boolean; code: string | null }>>(`mutation($id: ID!, $reason: String!) { suspendStore(id: $id, reason: $reason) { ok code } }`, as('staff-super-admin'), { id: brightside, reason: 'x' })
    expect(r.data?.['suspendStore']).toMatchObject({ ok: false, code: 'INVALID_STATE' })
    const after = await db.sql<{ n: string }[]>`select count(*)::text as n from activity_log where store_id = ${brightside}`
    expect(after[0]?.n).toBe(before[0]?.n)
  })
})

describe('the service enforces the assignment itself (ACCESS.md §5.4)', () => {
  it('answers an unassigned Partner manager with null or NOT_FOUND without a resolver in front', async () => {
    // Harbor Coffee belongs to Northstar, which is not Priya's; she reaches the service directly, as a job or script would.
    const harbor = await storeIdOf('Harbor Coffee Co.')
    const service = createStoresService({
      sql: db.sql,
      staff: as('staff-partner-manager'),
      facts: factsOf(request),
      activity: activityLog,
      isAssigned: (staffId, target) => isAssigned(db.sql, staffId, target),
      now: () => now,
    })
    expect(await service.get(harbor)).toBeNull()
    expect(await service.addStoreNote(harbor, 'not mine')).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    // The rest a Partner manager may not do at all, so the role refuses before the store is looked at.
    expect(await service.recheckStoreDomain(harbor)).toMatchObject({ ok: false, code: 'STAFF_ROLE_NOT_ALLOWED' })
    expect(await service.suspendStore(harbor, 'x')).toMatchObject({ ok: false, code: 'SUSPENDERS_ONLY' })
    expect(await service.extendTrial(harbor, '2026-12-01T00:00:00.000Z')).toMatchObject({ ok: false, code: 'SUPER_ADMIN_ONLY' })
    expect(await service.resendStoreOwnerInvite(harbor)).toMatchObject({ ok: false, code: 'INVITERS_ONLY' })
  })
})
