import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveShopper } from '#auth/shopCaller'
import { hashSessionId } from '#auth/session'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { createCheckout, releaseUnpaidTransfers } from '#engine/modules/checkout/index'
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
const merchant = async (source: string, who: keyof typeof cookies, as: { support?: 'read' } = {}) => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: who === 'other' ? stores.other : stores.india }
  const resolved = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, new Date(), activityLog, facts)
  // Acting through a read-only support session (ACCESS §8), as store-catalog-import.test.ts does.
  const standing = as.support && resolved.kind === 'acting'
    ? { ...resolved, caller: { ...resolved.caller, context: { ...resolved.caller.context, caller: { kind: 'support' as const, supportSessionId: crypto.randomUUID(), partnerUserId: crypto.randomUUID(), access: as.support } } } }
    : resolved
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

describe('holding stock and placing safely', () => {
  const versions = { scarf: '', shawl: '' }
  const product = async (slug: string, stock: Record<string, number>) => {
    const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${stores.india}, ${slug}, ${slug}, 'visible') returning id`
    const [v] = await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position, track_stock) values (${stores.india}, ${p?.id ?? ''}, ${slug}, 0, true) returning id`
    await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${v?.id ?? ''}, ${stores.india}, 'INR', 10000)`
    for (const [warehouse, onHand] of Object.entries(stock)) await db.sql`insert into stock_level (version_id, warehouse_id, store_id, on_hand) values (${v?.id ?? ''}, ${warehouse}, ${stores.india}, ${onHand})`
    return v?.id ?? ''
  }
  const cartOf = async (lines: [string, number][]) => {
    let token: string | null = null
    for (const [version, quantity] of lines) {
      const added = await shop(`mutation { addToCart(versionId: "${version}", quantity: ${quantity}) { cartToken } }`, token)
      token ??= (added.data?.['addToCart'] as { cartToken: string }).cartToken
    }
    const ready = token ?? ''
    await shop('mutation { setCartContact(email: "ravi@example.com") { cart { id } } }', ready)
    await shop('mutation { setShippingAddress(address: { name: "Ravi", line1: "1 Park St", city: "Pune", region: "Maharashtra", postalCode: "411001", country: "IN" }) { cart { id } } }', ready)
    await shop('mutation { setShippingOption(option: "flat") { cart { id } } }', ready)
    await shop('mutation { checkout { id } }', ready)
    return ready
  }
  const heldAt = async (version: string) => (await db.sql<{ warehouse_id: string; reserved: number }[]>`select warehouse_id, reserved from stock_level where version_id = ${version} order by warehouse_id`)

  beforeAll(async () => {
    const [main] = await db.sql<{ id: string }[]>`select id from warehouse where store_id = ${stores.india} and is_default`
    const [second] = await db.sql<{ id: string }[]>`insert into warehouse (store_id, name) values (${stores.india}, 'Second') returning id`
    versions.scarf = await product('scarf', { [main?.id ?? '']: 3, [second?.id ?? '']: 2 })
    versions.shawl = await product('shawl', { [main?.id ?? '']: 50 })
  })

  it('holds a line at one location that has enough, never more than a location holds', async () => {
    // 5 left across two locations, but no one location has 4.
    expect((await place(await cartOf([[versions.scarf, 4]]), 'cod')).code).toBe('OUT_OF_STOCK')
    expect((await place(await cartOf([[versions.scarf, 3]]), 'cod')).code).toBeUndefined()
    const levels = await heldAt(versions.scarf)
    expect(levels.map((l) => l.reserved).sort()).toEqual([0, 3])
  })

  it('places orders holding the same versions in opposite order side by side, without a deadlock', async () => {
    const carts = await Promise.all([cartOf([[versions.shawl, 1], [versions.scarf, 1]]), cartOf([[versions.scarf, 1], [versions.shawl, 1]]), cartOf([[versions.shawl, 1], [versions.scarf, 1]])])
    const results = await Promise.all(carts.map((c) => place(c, 'cod')))
    // Each is placed or told the last one has gone; none fails.
    expect(results.every((r) => r.code === undefined || r.code === 'OUT_OF_STOCK')).toBe(true)
    expect(results.filter((r) => r.code === undefined).length).toBeGreaterThan(0)
  })

  it('refuses a cart changed after it was priced, in another tab', async () => {
    const token = await cartOf([[versions.shawl, 1]])
    const found = await resolveShopper(db.sql, new Request(`https://${host}/shop-api`, { headers: { 'x-shop-cart': token } }), host)
    if (found.kind !== 'found') throw new Error('no store')
    // Every transaction after the first (the cart priced) sees the cart change, as another tab's would.
    let begins = 0
    const racing = new Proxy(db.sql, {
      get: (target, key, receiver) => {
        if (key !== 'begin') return Reflect.get(target, key, receiver) as unknown
        return async (...args: Parameters<typeof target.begin>) => {
          begins += 1
          if (begins > 1) await db.sql`update "order" set revision = revision + 1 where access_token_hash is not null and state = 'cart' and id in (select order_id from cart_line where version_id = ${versions.shawl})`
          return target.begin(...args)
        }
      },
    })
    const { shopper } = found
    const checkout = createCheckout({ sql: racing, context: shopper.context, language: shopper.language, currency: shopper.currency, marketId: shopper.marketId, features: shopper.features, couriers: null, activity: activityLog, facts: { requestId: 'r', ip: null, userAgent: null }, now: () => new Date(), country: shopper.country })
    expect(await checkout.place('cod')).toMatchObject({ ok: false, reason: 'CART_CHANGED' })
    expect((await shop('{ cart { id } }', token)).data?.['cart']).not.toBeNull()
  })

  it('refuses Mark as paid to a read-only support session and to a supplier', async () => {
    const placed = (await place(await cartOf([[versions.shawl, 1]]), 'cod')).data?.['placeOrder'] as { orderId: string }
    const asSupport = await merchant(`mutation { markOrderPaid(orderId: "${placed.orderId}") }`, 'owner', { support: 'read' })
    expect(asSupport.code).toBe('READ_ONLY')
    const [seller] = await db.sql<{ id: string }[]>`insert into seller (store_id, name, access_level, status) values (${stores.india}, 'Anand', 'vendor-orders-fulfil', 'active') returning id`
    const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, 'anand@jaipur.example', 'Anand', 'active') returning id`
    await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${u?.id ?? ''}, ${stores.india}, ${seller?.id ?? ''}, 'supplier-admin', 'active')`
    const cookie = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId: t.partnerA }, new Date()))
    const facts = { requestId: 'r', ip: null, userAgent: null }
    const headers = { cookie: `${storeCookieName}=${cookie}`, [storeHeader]: stores.india, [supplierHeader]: seller?.id ?? '' }
    const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, new Date(), activityLog, facts)
    const supplier = await graphql({ schema: storeSchema as GraphQLSchema, source: `mutation { markOrderPaid(orderId: "${placed.orderId}") }`, contextValue: { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, now: () => new Date() } satisfies StoreContext })
    expect(supplier.errors?.[0]?.extensions['code']).toBe('FORBIDDEN')
    expect((await db.sql<{ payment_state: string }[]>`select payment_state from "order" where id = ${placed.orderId}`)[0]?.payment_state).toBe('pending')
  })

  it('never lets the merchant side delete a card provider’s account, nor read-only support any', async () => {
    const [row] = await db.sql<{ id: string }[]>`insert into payment_provider_account (store_id, provider, mode, status) values (${stores.india}, 'razorpay', 'live', 'live') returning id`
    const owner: TenantContext = { caller: { kind: 'person', userId: 'u', sessionId: 's' }, partnerId: t.partnerA, storeId: stores.india, sellerScope: { kind: 'all' }, subscription: 'active' }
    expect((await withScope(db.sql, owner, (tx) => tx`delete from payment_provider_account where id = ${row?.id ?? ''}`)).count).toBe(0)
    const support: TenantContext = { ...owner, caller: { kind: 'support', supportSessionId: 'ss', partnerUserId: 'pu', access: 'read' } }
    expect((await withScope(db.sql, support, (tx) => tx`delete from payment_provider_account where store_id = ${stores.india}`)).count).toBe(0)
    expect(await db.sql`select 1 from payment_provider_account where id = ${row?.id ?? ''}`).toHaveLength(1)
  })
})
