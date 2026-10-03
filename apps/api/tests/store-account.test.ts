import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CallerContext } from '#core/tenancy'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { insertLimitOverride, selectStoreAccount } from '#db/scoped/storeAccount'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #212: the store account fields — subscription, overrides, trial extensions, usage.

let db: TestDatabase
const now = new Date('2026-10-03T09:00:00Z')
const ids = { ns: '', bz: '', nsStore: '', bzStore: '', seller: '', sellerStore: '' }

const partner = (partnerId: string): CallerContext => ({ caller: { kind: 'partner-user', partnerUserId: 'pu' }, partnerId })
const staff: CallerContext = { caller: { kind: 'staff', staffId: 'st' } }
const inStore = (partnerId: string, storeId: string, kind: 'person' | 'shopper', sellerId?: string): CallerContext => ({
  caller: kind === 'person' ? { kind: 'person', userId: 'u', sessionId: 's' } : { kind: 'shopper', customerId: null },
  partnerId,
  storeId,
  sellerScope: sellerId ? { kind: 'seller', sellerId } : { kind: 'all' },
  subscription: 'active',
})
const as = <T>(context: CallerContext, work: (tx: ScopedSql) => Promise<T>) => withScope(db.sql, context, work)
const override = (storeId: string) => ({ storeId, key: 'products' as const, amount: 10, duration: 'always' as const, month: null, reason: 'test', by: { kind: 'partner_user' as const, label: 'x' }, at: now })

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  const one = async (q: Promise<{ id: string }[]>) => (await q)[0]?.id ?? ''
  ids.ns = await one(db.sql`select id from partner where name = 'Northstar Commerce'`)
  ids.bz = await one(db.sql`select id from partner where name = 'Bazaar Cloud'`)
  ids.nsStore = await one(db.sql`select store_id as id from store_limit_override o join store s on s.id = o.store_id where s.partner_id = ${ids.ns} limit 1`)
  ids.bzStore = await one(db.sql`select id from store where partner_id = ${ids.bz} order by name limit 1`)
  const [seller] = await db.sql<{ id: string; store_id: string }[]>`select x.id, x.store_id from seller x join store s on s.id = x.store_id where s.partner_id = ${ids.ns} limit 1`
  ids.seller = seller?.id ?? ''
  ids.sellerStore = seller?.store_id ?? ''
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('the seeded accounts', () => {
  it('gives every store on a plan a subscription to the plan’s current version', async () => {
    const missing = await db.sql`
      select s.id from store s join plan p on p.id = s.plan_id
      where not exists (select 1 from store_subscription x where x.store_id = s.id and x.plan_id = p.id and x.plan_version = p.version)
    `
    expect(missing).toEqual([])
  })

  it('has Northstar’s four stores near a product limit, two overrides and a trial extension', async () => {
    const [near] = await db.sql<{ n: number }[]>`
      select count(*)::int as n from store s
      join store_usage u on u.store_id = s.id and u.key = 'products'
      join plan p on p.id = s.plan_id
      join plan_entitlement e on e.plan_id = p.id and e.version = p.version and e.key = 'products'
      where s.partner_id = ${ids.ns} and u.used >= e.amount * 0.9
    `
    expect(near?.n).toBe(4)
    expect(await db.sql`select duration from store_limit_override o join store s on s.id = o.store_id where s.partner_id = ${ids.ns} order by duration`).toEqual([{ duration: 'always' }, { duration: 'month' }])
    expect((await db.sql`select 1 from store_trial_extension e join store s on s.id = e.store_id where s.partner_id = ${ids.ns}`).length).toBe(1)
  })
})

describe('who reads and writes the account', () => {
  it('lets a partner read its own stores’ account, and nothing of another partner’s', async () => {
    expect((await as(partner(ids.ns), (tx) => selectStoreAccount(tx, ids.nsStore))).overrides.length).toBe(1)
    const theirs = await as(partner(ids.ns), (tx) => selectStoreAccount(tx, ids.bzStore))
    expect(theirs).toEqual({ subscription: null, overrides: [], trialExtensions: [], usage: [] })
  })

  it('lets the merchant read its own store’s, and never a supplier or a storefront', async () => {
    const own = await as(inStore(ids.ns, ids.nsStore, 'person'), (tx) => selectStoreAccount(tx, ids.nsStore))
    expect(own.subscription?.store_id).toBe(ids.nsStore)
    expect(own.usage.length).toBeGreaterThan(0)
    expect(ids.seller).not.toBe('')
    expect(await as(inStore(ids.ns, ids.sellerStore, 'person', ids.seller), (tx) => tx`select store_id from store_subscription`)).toEqual([])
    expect(await as(inStore(ids.ns, ids.nsStore, 'shopper'), (tx) => tx`select store_id from store_usage`)).toEqual([])
  })

  it('lets a partner add an override on its own store only, and never write usage', async () => {
    await expect(as(partner(ids.ns), (tx) => insertLimitOverride(tx, override(ids.nsStore)))).resolves.toBeUndefined()
    await expect(as(partner(ids.ns), (tx) => insertLimitOverride(tx, override(ids.bzStore)))).rejects.toThrow(/row-level security/i)
    await expect(as(partner(ids.ns), (tx) => tx`update store_usage set used = 0`)).rejects.toThrow(/permission denied/i)
  })

  it('lets staff read every store’s account', async () => {
    const [row] = await as(staff, (tx) => tx<{ n: number }[]>`select count(distinct store_id)::int as n from store_subscription`)
    const [all] = await db.sql<{ n: number }[]>`select count(*)::int as n from store_subscription`
    expect(row?.n).toBe(all?.n)
  })
})

describe('what the database holds a writer to', () => {
  it('lets no partner write a subscription, rewrite an override or set a billing status while DripFunnel bills', async () => {
    await expect(as(partner(ids.ns), (tx) => tx`update store_subscription set amount = 0 where store_id = ${ids.nsStore}`)).rejects.toThrow(/permission denied/i)
    await expect(as(partner(ids.ns), (tx) => tx`update store_limit_override set reason = 'rewritten' where store_id = ${ids.nsStore}`)).rejects.toThrow(/permission denied/i)
    await expect(as(partner(ids.ns), (tx) => tx`update store set billing_status = 'active' where id = ${ids.nsStore}`)).rejects.toThrow(/billing status is set only when the partner bills/)
    await db.sql`update partner set billing_mode = 'own' where id = ${ids.ns}`
    try {
      await expect(as(partner(ids.ns), (tx) => tx`update store set billing_status = 'past_due' where id = ${ids.nsStore} returning id`)).resolves.toHaveLength(1)
    } finally {
      await db.sql`update store set billing_status = null where id = ${ids.nsStore}`
      await db.sql`update partner set billing_mode = 'dripfunnel' where id = ${ids.ns}`
    }
  })

  it('refuses a subscription to another partner’s plan', async () => {
    const [theirs] = await db.sql<{ id: string; version: number }[]>`select id, version from plan where partner_id = ${ids.bz} limit 1`
    await expect(db.sql`update store_subscription set plan_id = ${theirs?.id ?? ''}, plan_version = ${theirs?.version ?? 1} where store_id = ${ids.nsStore}`).rejects.toThrow(/foreign key/i)
  })
})

describe('the shapes the tables hold', () => {
  it('ties a month override to its month, and a subscription to a version that exists', async () => {
    await expect(db.sql`insert into store_limit_override (store_id, key, amount, duration, reason, created_by_kind, created_by_label) values (${ids.nsStore}, 'products', 1, 'month', 'x', 'staff', 'x')`).rejects.toThrow(
      /store_limit_override_month/,
    )
    await expect(db.sql`update store_subscription set plan_version = 99 where store_id = ${ids.nsStore}`).rejects.toThrow(/foreign key/i)
  })
})
