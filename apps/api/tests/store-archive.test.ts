import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { factsOf } from '#auth/activity'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { PartnerRole } from '#auth/partnerPermissions'
import type { StaffMember, StaffRole } from '#auth/staff'
import { withScope, withSystemScope } from '#db/scoped/index'
import { selectMemberships } from '#db/scoped/storeCaller'
import { selectMyMemberships } from '#db/scoped/storeShell'
import { StripeRefused } from '#integrations/stripe/api'
import { activityLog } from '#saas/activity/index'
import { createPartnerStoreActions, createPartnerStoresService } from '#saas/partnerStores/index'
import { createStoresService } from '#saas/stores/service'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #1056: Archive a store from the admin console and the partner console (SAAS §4.2 Closed).

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-31T09:00:00Z')
const request = new Request('https://admin.example/api/', { headers: { 'cf-connecting-ip': '203.0.113.9' } })
const facts = factsOf(request)
let owner = ''

const ended: string[] = []
let stripeFails: Error | null = null
const stripe = {
  cancelNow: async (id: string) => {
    if (stripeFails) throw stripeFails
    ended.push(id)
  },
}

const staffAs = (role: StaffRole): StaffMember => ({ id: crypto.randomUUID(), email: `${role}@dripfunnel.example`, name: 'Priya Shah', role })
const admin = (role: StaffRole = 'staff-super-admin') =>
  createStoresService({ sql: db.sql, staff: staffAs(role), facts, activity: activityLog, shopDomain: 'shop.example', isAssigned: async () => true, stripe, now: () => now })

const partnerCaller = (partnerId: string, role: PartnerRole = 'partner-owner'): PartnerCaller => ({
  role,
  user: { id: crypto.randomUUID(), name: 'Maya Chen', email: 'maya@partner.example' },
  staff: null,
  partner: { id: partnerId, name: partnerId === t.partnerA ? 'Partner A' : 'Partner B', product: 'Shops', host: null, state: 'live' },
})
const partner = (partnerId: string, role: PartnerRole = 'partner-owner') => createPartnerStoreActions({ sql: db.sql, caller: partnerCaller(partnerId, role), facts, activity: activityLog, billingStripe: stripe, now: () => now })

const statusOf = async (storeId: string) => (await db.sql<{ status: string; closed_at: Date | null; closed_by_label: string | null }[]>`select status, closed_at, closed_by_label from store where id = ${storeId}`)[0]
const subOf = async (storeId: string) => (await db.sql<{ status: string; cancel_at: Date | null }[]>`select status, cancel_at from store_subscription where store_id = ${storeId}`)[0]
const suspend = (storeId: string) =>
  db.sql`update store set status = 'suspended', suspended_at = ${now}, suspended_reason = 'Chargebacks', suspended_by_label = 'Ops', suspended_previous_status = 'active' where id = ${storeId}`

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  owner = (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, 'owner@a.example', 'Olivia', 'active') returning id`)[0]?.id ?? ''
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${owner}, ${t.storeA1}, 'owner', 'active'), (${owner}, ${t.storeA2}, 'owner', 'active')`
  for (const [partnerId, storeId] of [[t.partnerA, t.storeA1], [t.partnerA, t.storeA2], [t.partnerB, t.storeB1]] as const) {
    const [p] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${partnerId}, ${`Plan ${storeId}`}, 'live') returning id`
    await db.sql`update store set plan_id = ${p?.id ?? ''}, status = 'active' where id = ${storeId}`
    await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end, stripe_subscription_id)
      values (${storeId}, ${partnerId}, ${p?.id ?? ''}, 1, 'active', 'month', 'INR', 99900, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)}, ${`sub_${storeId.slice(0, 8)}`})`
  }
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

beforeEach(() => {
  ended.length = 0
  stripeFails = null
})

describe('archiving from the admin console', () => {
  it('offers Archive on a live store but refuses it until the store is Cancelled or Suspended', async () => {
    expect((await admin().get(t.storeA2))?.actions.archive).toEqual({ allowed: false, reason: 'NOT_ARCHIVABLE' })
    expect(await admin().archiveStore(t.storeA2, 'Test store')).toMatchObject({ ok: false, code: 'NOT_ARCHIVABLE' })
    expect((await statusOf(t.storeA2))?.status).toBe('active')
    expect(ended).toEqual([])
  })

  it('is a Super admin’s alone, and needs a reason', async () => {
    await suspend(t.storeA1)
    expect(await admin('staff-support').archiveStore(t.storeA1, 'x')).toMatchObject({ ok: false, code: 'SUPER_ADMIN_ONLY' })
    expect((await admin('staff-support').get(t.storeA1))?.actions.archive).toMatchObject({ allowed: false })
    expect(await admin().archiveStore(t.storeA1, '   ')).toMatchObject({ ok: false, code: 'REASON_REQUIRED' })
  })

  it('leaves a suspended store as it was when Stripe can’t end its subscription, or refuses to', async () => {
    for (const failure of [new Error('no answer'), new StripeRefused('api_key_expired')]) {
      stripeFails = failure
      expect(await admin().archiveStore(t.storeA1, 'Fraud')).toMatchObject({ ok: false, code: 'PROVIDER_UNAVAILABLE' })
      expect((await statusOf(t.storeA1))?.status).toBe('suspended')
      expect((await subOf(t.storeA1))?.status).toBe('active')
    }
  })

  it('archives a suspended store: its subscription ended now, gone for its people, the Owner told, logged with the reason', async () => {
    expect(await admin().archiveStore(t.storeA1, 'Fraud')).toMatchObject({ ok: true })
    expect(await statusOf(t.storeA1)).toEqual({ status: 'closed', closed_at: now, closed_by_label: 'Priya Shah' })
    expect(ended).toEqual([`sub_${t.storeA1.slice(0, 8)}`])
    expect(await subOf(t.storeA1)).toEqual({ status: 'cancelled', cancel_at: now })
    // Gone from the store chooser, and refused to a session already acting in it (ACCESS §4).
    const myStores = await withSystemScope(db.sql, (tx) => selectMyMemberships(tx, owner, t.partnerA, { limit: 50, after: null, before: null }))
    expect(myStores.map((m) => m.store_id)).not.toContain(t.storeA1)
    expect(await withSystemScope(db.sql, (tx) => selectMemberships(tx, owner, t.partnerA, t.storeA1))).toEqual([])
    const [email] = await db.sql<{ payload: { template: string } }[]>`select payload from outbox where kind = 'email' and store_id = ${t.storeA1} and payload->>'template' = 'store-archived'`
    expect(email).toBeTruthy()
    expect((await db.sql`select 1 from outbox where kind = 'cache.purge' and store_id = ${t.storeA1} and idempotency_key like '%store-degraded:%:closed:%'`).length).toBe(1)
    const [entry] = await db.sql<{ reason: string }[]>`select reason from activity_log where action = 'store.archived' and store_id = ${t.storeA1}`
    expect(entry?.reason).toBe('Fraud')
  })

  it('offers nothing more on an archived store, and archives it only once', async () => {
    expect((await admin().get(t.storeA1))?.actions.archive).toBeUndefined()
    expect(await admin().archiveStore(t.storeA1, 'Again')).toMatchObject({ ok: false, code: 'NOT_ARCHIVABLE' })
    expect(ended).toEqual([])
  })
})

describe('archiving from the partner console', () => {
  it('lets the partner’s Owner archive its own cancelled store, and no one else’s', async () => {
    await db.sql`update store set status = 'cancelled', cancelled_at = ${now} where id = ${t.storeB1}`
    expect(await partner(t.partnerA).archiveStore(t.storeB1, 'Not ours')).toEqual({ ok: false, reason: 'NOT_FOUND' })
    expect(await partner(t.partnerB, 'partner-support').archiveStore(t.storeB1, 'Support')).toEqual({ ok: false, reason: 'OWNERS_AND_ADMINS_ONLY' })
    expect(ended).toEqual([])
    expect(await partner(t.partnerB).archiveStore(t.storeB1, 'Merchant left')).toEqual({ ok: true })
    expect((await statusOf(t.storeB1))?.closed_by_label).toBe('Partner B')
    expect(ended).toEqual([`sub_${t.storeB1.slice(0, 8)}`])
  })

  it('shows Archive off with the reason on a live store, and refuses it there', async () => {
    const page = await createPartnerStoresService({ sql: db.sql, caller: partnerCaller(t.partnerA), facts, activity: activityLog, shopDomain: 'shop.example', now: () => now }).store(t.storeA2)
    expect(page?.actions.archive).toEqual({ allowed: false, reason: 'CANCEL_OR_SUSPEND_FIRST' })
    // Archived by staff: when, never the staff member's name.
    const archivedByStaff = await createPartnerStoresService({ sql: db.sql, caller: partnerCaller(t.partnerA), facts, activity: activityLog, shopDomain: 'shop.example', now: () => now }).store(t.storeA1)
    expect(archivedByStaff?.state).toEqual({ kind: 'closed', since: now })
    expect(await partner(t.partnerA).archiveStore(t.storeA2, 'x')).toEqual({ ok: false, reason: 'CANCEL_OR_SUSPEND_FIRST' })
  })

  it('leaves a suspended store as it was when Stripe can’t end its subscription, or refuses to', async () => {
    await suspend(t.storeA2)
    for (const failure of [new Error('no answer'), new StripeRefused('api_key_expired')]) {
      stripeFails = failure
      expect(await partner(t.partnerA).archiveStore(t.storeA2, 'Merchant left')).toEqual({ ok: false, reason: 'PROVIDER_UNAVAILABLE' })
      expect((await statusOf(t.storeA2))?.status).toBe('suspended')
      expect((await subOf(t.storeA2))?.status).toBe('active')
    }
  })

  it('archives a suspended store, through Cancelled to Closed', async () => {
    expect(await partner(t.partnerA).archiveStore(t.storeA2, 'Merchant left')).toEqual({ ok: true })
    expect(await statusOf(t.storeA2)).toEqual({ status: 'closed', closed_at: now, closed_by_label: 'Partner A' })
    expect(await subOf(t.storeA2)).toEqual({ status: 'cancelled', cancel_at: now })
    expect(ended).toEqual([`sub_${t.storeA2.slice(0, 8)}`])
  })
})

describe('partner_end_subscription, as the partner itself', () => {
  const asPartner = (partnerId: string, query: string) => withScope(db.sql, { caller: { kind: 'partner-user', partnerUserId: 'pu' }, partnerId }, (tx) => tx.unsafe(query))
  const end = (partnerId: string, storeId: string) => asPartner(partnerId, `select partner_end_subscription('${storeId}', now())`)
  const live = (storeId: string) => db.sql`update store_subscription set status = 'active', cancel_at = null where store_id = ${storeId}`

  it('ends only its own store’s subscription, only once Closed, and never lets it write the status itself', async () => {
    await live(t.storeB1)
    await end(t.partnerA, t.storeB1)
    expect((await subOf(t.storeB1))?.status).toBe('active')

    await db.sql`update store set status = 'cancelled' where id = ${t.storeA2}`
    await live(t.storeA2)
    await end(t.partnerA, t.storeA2)
    expect((await subOf(t.storeA2))?.status).toBe('active')

    await expect(asPartner(t.partnerA, `update store_subscription set status = 'cancelled' where store_id = '${t.storeA2}'`)).rejects.toThrow(/permission denied/i)

    await db.sql`update store set status = 'closed' where id = ${t.storeA2}`
    await end(t.partnerA, t.storeA2)
    expect((await subOf(t.storeA2))?.status).toBe('cancelled')
  })
})
