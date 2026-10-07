import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { UNLIMITED } from '#db/scoped/planKeys'
import type { TenantContext } from '#core/tenancy'
import { withSystemScope } from '#db/scoped/index'
import { planLimitFor } from '#saas/entitlements/index'
import { selectStoreUsage } from '#db/scoped/stores'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// An Unlimited limit (planKeys.ts) is never near and never overflows when an override adds to it.
let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, new Date('2026-10-03T09:00:00Z'))
}, 60_000)
afterAll(async () => {
  await db?.drop()
})

describe('usage against an Unlimited limit', () => {
  it('stays Unlimited with a zero percent, whatever an override adds', async () => {
    const [store] = await db.sql<{ id: string; plan_id: string; version: number }[]>`
      select s.id, s.plan_id, sub.plan_version as version from store s join store_subscription sub on sub.store_id = s.id
      where exists (select 1 from store_usage u where u.store_id = s.id and u.key = 'products') limit 1`
    if (!store) throw new Error('no seeded store')
    // Versions are insert-only for the app roles; the owner may fix a fixture row.
    await db.sql`update plan_entitlement set amount = ${UNLIMITED} where plan_id = ${store.plan_id} and version = ${store.version} and key = 'products'`
    await db.sql`insert into store_limit_override (store_id, key, amount, duration, reason, created_by_kind, created_by_label) values (${store.id}, 'products', 100, 'always', 'test', 'staff', 'test')`
    await db.sql`update store_usage set used = 5000 where store_id = ${store.id} and key = 'products'`
    const rows = await withSystemScope(db.sql, (tx) => selectStoreUsage(tx, store.id, store.plan_id, new Date()))
    const products = rows.find((r) => r.key === 'products')
    expect(products?.cap).toBe(UNLIMITED)
    expect(products?.percent).toBe(0)
  })

  it('adds an override to a limit near the maximum without overflowing, and caps the sum at Unlimited', async () => {
    const [store] = await db.sql<{ id: string; plan_id: string; version: number }[]>`
      select s.id, s.plan_id, sub.plan_version as version from store s join store_subscription sub on sub.store_id = s.id
      where exists (select 1 from store_usage u where u.store_id = s.id and u.key = 'staff') limit 1`
    if (!store) throw new Error('no seeded store')
    await db.sql`update plan_entitlement set amount = ${UNLIMITED - 500} where plan_id = ${store.plan_id} and version = ${store.version} and key = 'staff'`
    await db.sql`insert into store_limit_override (store_id, key, amount, duration, reason, created_by_kind, created_by_label) values (${store.id}, 'staff', 1000, 'always', 'test', 'staff', 'test')`
    await db.sql`update store_usage set used = 3 where store_id = ${store.id} and key = 'staff'`
    const rows = await withSystemScope(db.sql, (tx) => selectStoreUsage(tx, store.id, store.plan_id, new Date()))
    const staff = rows.find((r) => r.key === 'staff')
    expect(staff?.cap).toBe(UNLIMITED)
    expect(staff?.percent).toBe(0)
  })

  it('lets a store with an Unlimited limit write past any count', async () => {
    const [store] = await db.sql<{ id: string; partner_id: string; plan_id: string; version: number }[]>`
      select s.id, s.partner_id, s.plan_id, sub.plan_version as version from store s join store_subscription sub on sub.store_id = s.id limit 1`
    if (!store) throw new Error('no seeded store')
    await db.sql`update plan_entitlement set amount = ${UNLIMITED} where plan_id = ${store.plan_id} and version = ${store.version} and key = 'products'`
    const context: TenantContext = { caller: { kind: 'person', userId: 'u', sessionId: 's' }, partnerId: store.partner_id, storeId: store.id, sellerScope: { kind: 'all' }, subscription: 'active' }
    expect(await planLimitFor(db.sql, context, { key: 'products', total: 50_000_000 }, new Date())).toBeNull()
  })
})
