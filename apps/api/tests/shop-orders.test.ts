import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveShopper } from '#auth/shopCaller'
import { hashSessionId } from '#auth/session'
import { resolveStoreStanding, storeHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { releaseUnpaidTransfers } from '#engine/modules/checkout/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #309 (SAPI 10), part 1: placing an order and the ways paid later (PLATFORM-PROMPT §5.4; FIRST-RELEASE §1): the
// snapshot and number, stock held at placement and checked again under lock, "Mark as paid", and the 3-day transfer release.

let db: TestDatabase
let t: Tenants
const stores = { india: '', other: '' }
const host = 'jaipur.shops.acme.example'
let kurta = ''
const cookies: Record<'owner' | 'manager' | 'staff' | 'other', string> = { owner: '', manager: '', staff: '', other: '' }

const store = async (name: string, code: string) =>
  (await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status) values (${t.partnerA}, ${name}, ${code}, 'IN', 'INR', 'active') returning id`)[0]?.id ?? ''

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'shops', '*.shops.acme.example', 'live', 'CNAME', 'x')`
  stores.india = await store('Jaipur', 'jaipur')
  stores.other = await store('Surat', 'surat')
  await db.sql`update store set order_prefix = 'JP-', next_order_number = 1001 where id = ${stores.india}`
  const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${stores.india}, 'Kurta', 'kurta', 'visible') returning id`
  kurta = (await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position, track_stock) values (${stores.india}, ${p?.id ?? ''}, 'K1', 0, true) returning id`)[0]?.id ?? ''
  await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${kurta}, ${stores.india}, 'INR', 100000)`
  await db.sql`insert into stock_level (version_id, warehouse_id, store_id, on_hand) select ${kurta}, w.id, ${stores.india}, 3 from warehouse w where w.store_id = ${stores.india} and w.is_default`
  await db.sql`insert into store_shipping (store_id, flat_enabled, flat_amount, pickup_enabled, pickup_hours, currency, area_mode, saved_at, revision)
    values (${stores.india}, true, 5000, true, 'Mon–Sat', 'INR', 'everywhere', now(), 1)`
  const person = async (storeId: string, email: string, role: string) => {
    const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, ${email}, 'P', 'active') returning id`
    await db.sql`insert into membership (user_id, store_id, role_key, status) values (${u?.id ?? ''}, ${storeId}, ${role}, 'active')`
    return withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId: t.partnerA }, new Date()))
  }
  cookies.owner = await person(stores.india, 'owner@jaipur.example', 'owner')
  cookies.manager = await person(stores.india, 'manager@jaipur.example', 'manager')
  cookies.staff = await person(stores.india, 'staff@jaipur.example', 'staff')
  cookies.other = await person(stores.other, 'owner@surat.example', 'owner')
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const shop = async (source: string, cart: string | null = null) => {
  const found = await resolveShopper(db.sql, new Request(`https://${host}/shop-api`, { headers: cart ? { 'x-shop-cart': cart } : {} }), host)
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = { sql: db.sql, shopper: found.shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.5', userAgent: null }, couriers: null, allowAttempt: async () => true, now: () => new Date() }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
const merchant = async (source: string, who: keyof typeof cookies) => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: who === 'other' ? stores.other : stores.india }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, new Date(), activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, now: () => new Date() }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
/** A guest's cart of this many kurtas, ready to pay with the flat delivery rate. */
const readyCart = async (quantity: number) => {
  const token = ((await shop(`mutation { addToCart(versionId: "${kurta}", quantity: ${quantity}) { cartToken } }`)).data?.['addToCart'] as { cartToken: string }).cartToken
  await shop('mutation { setCartContact(email: "asha@example.com") { cart { id } } }', token)
  await shop('mutation { setShippingAddress(address: { name: "Asha", line1: "12 MG Road", city: "Pune", region: "Maharashtra", postalCode: "411001", country: "IN" }) { cart { id } } }', token)
  await shop('mutation { setShippingOption(option: "flat") { cart { id } } }', token)
  await shop('mutation { checkout { id } }', token)
  return token
}
const place = (token: string, provider: string) => shop(`mutation { placeOrder(provider: "${provider}") { orderId number total { amount } provider instructions } }`, token)
const reserved = async () => (await db.sql<{ reserved: number }[]>`select reserved from stock_level where version_id = ${kurta}`)[0]?.reserved

describe('Settings › Payment setup', () => {
  it('lists India’s providers, and turns on cash on delivery and a transfer with its bank details', async () => {
    expect(((await merchant('{ paymentSetup { provider live connectable } }', 'owner')).data?.['paymentSetup'] as { provider: string }[]).map((m) => m.provider)).toEqual(['razorpay', 'cashfree', 'phonepe', 'cod', 'bank_transfer'])
    expect((await merchant('mutation { turnOnPaymentMethod(provider: "bank_transfer") }', 'owner')).code).toBe('METHOD_UNAVAILABLE')
    expect((await merchant('mutation { turnOnPaymentMethod(provider: "stripe") }', 'owner')).code).toBe('METHOD_UNAVAILABLE')
    expect((await merchant('mutation { turnOnPaymentMethod(provider: "cod") }', 'manager')).code).toBe('FORBIDDEN')
    expect((await merchant('mutation { turnOnPaymentMethod(provider: "cod") }', 'owner')).data?.['turnOnPaymentMethod']).toBe(true)
    expect((await merchant('mutation { turnOnPaymentMethod(provider: "bank_transfer", bankDetails: "HDFC 50100 IFSC HDFC0001") }', 'owner')).data?.['turnOnPaymentMethod']).toBe(true)
    expect((await shop('{ paymentOptions { provider kind instructions } }')).data?.['paymentOptions']).toEqual([
      { provider: 'cod', kind: 'cod', instructions: null },
      { provider: 'bank_transfer', kind: 'bank_transfer', instructions: 'HDFC 50100 IFSC HDFC0001' },
    ])
  })
})

let order = ''
let orderToken = ''

describe('placing an order', () => {
  it('refuses a cart that isn’t ready, and a way the store doesn’t take', async () => {
    const token = ((await shop(`mutation { addToCart(versionId: "${kurta}", quantity: 1) { cartToken } }`)).data?.['addToCart'] as { cartToken: string }).cartToken
    expect((await place(token, 'cod')).code).toBe('NOT_READY')
    const ready = await readyCart(1)
    expect((await place(ready, 'razorpay')).code).toBe('METHOD_UNAVAILABLE')
  })

  it('places a cash-on-delivery order: numbered, snapshotted at today’s price, its stock held at once', async () => {
    orderToken = await readyCart(2)
    const placed = (await place(orderToken, 'cod')).data?.['placeOrder'] as { orderId: string; number: string; total: { amount: string }; provider: string }
    expect(placed).toMatchObject({ number: 'JP-1001', total: { amount: '205000' }, provider: 'cod' })
    order = placed.orderId
    expect(await reserved()).toBe(2)
    await db.sql`update version_price set amount = 999999 where version_id = ${kurta}`
    const seen = (await shop(`{ order(id: "${order}") { number state paymentState lines { quantity unitPrice { amount } } shipping { amount } total { amount } } }`, orderToken)).data?.['order']
    expect(seen).toEqual({ number: 'JP-1001', state: 'placed', paymentState: 'pending', lines: [{ quantity: 2, unitPrice: { amount: '100000' } }], shipping: { amount: '5000' }, total: { amount: '205000' } })
    await db.sql`update version_price set amount = 100000 where version_id = ${kurta}`
    expect((await place(orderToken, 'cod')).code).toBe('NOT_FOUND')
  })

  it('checks stock again under lock: the last one goes to one order only', async () => {
    const first = await readyCart(1)
    const second = await readyCart(1)
    const results = await Promise.all([place(first, 'bank_transfer'), place(second, 'bank_transfer')])
    expect(results.map((r) => r.code ?? 'placed').sort()).toEqual(['OUT_OF_STOCK', 'placed'])
    expect(await reserved()).toBe(3)
  })
})

describe('mark as paid, and the unpaid transfer', () => {
  it('lets the Owner or a Manager mark a cash-on-delivery order paid, once, never Staff or another store', async () => {
    expect((await merchant(`mutation { markOrderPaid(orderId: "${order}") }`, 'staff')).code).toBe('FORBIDDEN')
    expect((await merchant(`mutation { markOrderPaid(orderId: "${order}") }`, 'other')).code).toBe('NOT_FOUND')
    expect((await merchant(`mutation { markOrderPaid(orderId: "${order}") }`, 'manager')).data?.['markOrderPaid']).toBe(true)
    expect((await merchant(`mutation { markOrderPaid(orderId: "${order}") }`, 'owner')).code).toBe('NOT_PENDING')
    expect((await shop(`{ order(id: "${order}") { paymentState } }`, orderToken)).data?.['order']).toEqual({ paymentState: 'paid' })
  })

  it('cancels a transfer unpaid after 3 days and gives its stock back, as the system', async () => {
    const transfer = (await db.sql<{ id: string }[]>`select id from "order" where store_id = ${stores.india} and payment_method = 'bank_transfer'`)[0]?.id ?? ''
    expect(await releaseUnpaidTransfers(db.sql, activityLog, new Date())).toBe(0)
    expect(await releaseUnpaidTransfers(db.sql, activityLog, new Date(Date.now() + 3 * 86_400_000 + 60_000))).toBe(1)
    expect((await db.sql<{ state: string; cancel_reason: string }[]>`select state, cancel_reason from "order" where id = ${transfer}`)[0]).toEqual({ state: 'cancelled', cancel_reason: 'unpaid_transfer' })
    expect(await reserved()).toBe(2)
    expect((await db.sql<{ actor_kind: string }[]>`select actor_kind from activity_log where action = 'order.cancelled' and target_id = ${transfer}`)[0]?.actor_kind).toBe('job')
  })
})

describe('isolation', () => {
  const guest = async (presented: string | null): Promise<TenantContext> => ({
    caller: { kind: 'shopper', customerId: null, orderTokenHash: presented ? await hashSessionId(presented) : null },
    partnerId: t.partnerA,
    storeId: stores.india,
    sellerScope: { kind: 'all' },
    subscription: 'active',
  })

  it('shows an order only to the guest who placed it, and lets no shopper write its money or state', async () => {
    expect((await shop(`{ order(id: "${order}") { number } }`)).data?.['order']).toBeNull()
    expect(await withScope(db.sql, await guest('e'.repeat(64)), (tx) => tx`select id from order_line`)).toHaveLength(0)
    await expect(withScope(db.sql, await guest(orderToken), (tx) => tx`update "order" set total_amount = 1`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, await guest(orderToken), (tx) => tx`insert into payment (order_id, store_id, provider, kind, amount, currency) values (${order}, ${stores.india}, 'cod', 'cod', 1, 'INR')`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, await guest(orderToken), (tx) => tx`select credentials_enc from payment_provider_account`)).rejects.toThrow(/permission denied/)
  })

  it('lets a merchant read only its own store’s orders, and a supplier none', async () => {
    const merchantOf = (storeId: string, seller?: string): TenantContext => ({ caller: { kind: 'person', userId: 'u', sessionId: 's' }, partnerId: t.partnerA, storeId, sellerScope: seller ? { kind: 'seller', sellerId: seller } : { kind: 'all' }, subscription: 'active' })
    expect(await withScope(db.sql, merchantOf(stores.india), (tx) => tx`select id from order_line`)).not.toHaveLength(0)
    expect(await withScope(db.sql, merchantOf(stores.other), (tx) => tx`select id from order_line`)).toHaveLength(0)
    await expect(withScope(db.sql, merchantOf(stores.india, t.sellerA1First), (tx) => tx`select id from order_line`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, merchantOf(stores.india), (tx) => tx`insert into payment_provider_account (store_id, provider) values (${stores.india}, 'stripe')`)).rejects.toThrow(/row-level security/)
  })
})
