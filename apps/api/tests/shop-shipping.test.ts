import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CourierDirectory } from '#core/couriers'
import type { TenantContext } from '#core/tenancy'
import { withScope } from '#db/scoped/index'
import { createShippingService } from '#engine/modules/shipping/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// SAPI 23's quote as a shopper's cart will run it: app_shop reads what the shopper pays and the couriers
// that price it, asks store_delivers_to() about a postcode, and never reads the list or a courier's settings.

let db: TestDatabase
let t: Tenants
let kurta = ''
let theirs = ''

const couriers: CourierDirectory = {
  forPartner: async () => ({
    accounts: new Set(['shiprocket'] as const),
    gateway: { quote: async () => ({ amount: { amount: 8500n, currency: 'INR' }, service: 'Surface', minDays: 3, maxDays: 5 }) },
  }),
}

const version = async (storeId: string) => {
  const slug = `k-${crypto.randomUUID().slice(0, 8)}`
  const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${storeId}, 'Kurta', ${slug}, 'visible') returning id`
  const [v] = await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position, weight_grams) values (${storeId}, ${p?.id ?? ''}, ${slug}, 0, 400) returning id`
  return v?.id ?? ''
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set pricing_currency = 'INR', country = 'IN', address = '{"postal": "302001", "city": "Jaipur"}' where id in (${t.storeA1}, ${t.storeB1})`
  await db.sql`insert into store_shipping (store_id, courier_enabled, flat_enabled, flat_amount, pickup_enabled, pickup_hours, currency, area_mode, saved_at, revision)
    values (${t.storeA1}, true, false, 4900, true, 'Mon–Sat', 'INR', 'list', now(), 1)`
  await db.sql`insert into delivery_postal_code (store_id, code) values (${t.storeA1}, '400001')`
  await db.sql`insert into store_courier (store_id, provider, role, label_size) values (${t.storeA1}, 'shiprocket', 'pricing', 'a6')`
  kurta = await version(t.storeA1)
  theirs = await version(t.storeB1)
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const shopper = (storeId: string, partnerId: string): TenantContext => ({ caller: { kind: 'shopper', customerId: null }, partnerId, storeId, sellerScope: { kind: 'all' }, subscription: 'active' })
const quote = async (context: TenantContext, versionId: string, postal: string) => {
  const service = createShippingService({ sql: db.sql, context, actor: { id: 'shopper', partnerId: context.partnerId }, activity: activityLog, facts: { requestId: 'q', ip: null, userAgent: null }, now: () => new Date(), couriers: await couriers.forPartner(context.partnerId) })
  const result = await service.quote({ lines: [{ versionId, quantity: 1 }], shipTo: { country: 'IN', region: null, postal }, subtotal: { amount: 50000n, currency: 'INR' }, marketId: null })
  return result.ok ? { deliverable: result.value.deliverable, options: result.value.options.map((o) => [o.id, o.amount.amount]) } : result.reason
}

describe('a shopper’s delivery quote', () => {
  it('prices the courier and collection inside the list, and only collection outside it', async () => {
    expect(await quote(shopper(t.storeA1, t.partnerA), kurta, '400001')).toEqual({ deliverable: true, options: [['courier', 8500n], ['pickup', 0n]] })
    expect(await quote(shopper(t.storeA1, t.partnerA), kurta, '110001')).toEqual({ deliverable: false, options: [['pickup', 0n]] })
  })

  it('never prices another store’s product, and another store’s shopper reads none of this one’s settings', async () => {
    expect(await quote(shopper(t.storeA1, t.partnerA), theirs, '400001')).toBe('NOT_FOUND')
    expect(await quote(shopper(t.storeB1, t.partnerB), theirs, '400001')).toEqual({ deliverable: false, options: [] })
  })

  it('never reads the postcode list, a courier’s settings or the shipping row’s bookkeeping', async () => {
    for (const sql of ['select code from delivery_postal_code', 'select pickup_mode from store_courier', 'select area_file_name from store_shipping', 'select revision from store_shipping']) {
      await expect(withScope(db.sql, shopper(t.storeA1, t.partnerA), (tx) => tx.unsafe(sql))).rejects.toThrow(/permission denied/)
    }
    await expect(withScope(db.sql, shopper(t.storeA1, t.partnerA), (tx) => tx`update store_shipping set flat_amount = 1`)).rejects.toThrow(/permission denied/)
  })
})
