import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { hashSessionId } from '#auth/session'
import { resolveShopper } from '#auth/shopCaller'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { applyOutcome } from '#engine/modules/checkout/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #841 (DL 4): own delivery as a Shipping method, warehouses' delivery areas, and the checkout option (DELIVERY §2;
// the card's decisions of 2026-10-26).

let db: TestDatabase
let t: Tenants
const host = 'jaipur.shop.example'
const now = new Date('2026-10-26T09:00:00Z')
let store = ''
let plan = ''
let seller = ''
const warehouses = { main: '', north: '' }
const versions = { kurta: '', shawl: '', supplied: '', mug: '' }
type Who = 'owner' | 'manager' | 'supplier'
const cookies: Record<Who, string> = { owner: '', manager: '', supplier: '' }

// Jaipur: the main location, a second one about 5 km north, a shopper 0.4 km from the main one, and Delhi far outside.
const pins = { main: [26.9124, 75.7873], north: [26.96, 75.8], inside: [26.915, 75.79], delhi: [28.6139, 77.209] } as const

const version = async (name: string, o: { sellerId?: string; track?: boolean; stock?: Record<string, number> } = {}) => {
  const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, seller_id, name, slug, visibility) values (${store}, ${o.sellerId ?? null}, ${name}, ${name}, 'visible') returning id`
  const [v] = await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position, track_stock) values (${store}, ${p?.id ?? ''}, ${name}, 0, ${o.track ?? true}) returning id`
  await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${v?.id ?? ''}, ${store}, 'INR', 100000)`
  for (const [w, onHand] of Object.entries(o.stock ?? {})) await db.sql`insert into stock_level (version_id, warehouse_id, store_id, seller_id, on_hand) values (${v?.id ?? ''}, ${w}, ${store}, ${o.sellerId ?? null}, ${onHand})`
  return v?.id ?? ''
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  store = (await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status) values (${t.partnerA}, 'Jaipur', 'jaipur', 'IN', 'INR', 'active') returning id`)[0]?.id ?? ''
  plan = (await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${t.partnerA}, 'Jaipur plan', 'live') returning id`)[0]?.id ?? ''
  await db.sql`update store set plan_id = ${plan}, address = '{"street": "12 MI Road", "city": "Jaipur", "postal": "302001", "region": "Rajasthan"}' where id = ${store}`
  await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
    values (${store}, ${t.partnerA}, ${plan}, 1, 'active', 'month', 'INR', 0, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)})`
  await db.sql`insert into store_shipping (store_id, flat_enabled, flat_amount, pickup_enabled, pickup_hours, currency, area_mode, saved_at, revision)
    values (${store}, true, 4900, true, 'Mon–Sat', 'INR', 'everywhere', now(), 1)`
  await db.sql`insert into payment_provider_account (store_id, provider, mode, status) values (${store}, 'cod', 'live', 'live')`
  warehouses.main = (await db.sql<{ id: string }[]>`select id from warehouse where store_id = ${store} and is_default`)[0]?.id ?? ''
  warehouses.north = (await db.sql<{ id: string }[]>`insert into warehouse (store_id, name, latitude, longitude) values (${store}, 'North', ${pins.north[0]}, ${pins.north[1]}) returning id`)[0]?.id ?? ''
  seller = (await db.sql<{ id: string }[]>`insert into seller (store_id, name, access_level, status, shipping_mode) values (${store}, 'Anand Textiles', 'vendor-orders-fulfil', 'active', 'to-shopper') returning id`)[0]?.id ?? ''
  versions.kurta = await version('kurta', { stock: { [warehouses.main]: 1, [warehouses.north]: 5 } })
  versions.shawl = await version('shawl', { track: false })
  versions.supplied = await version('supplied', { sellerId: seller, track: false })
  versions.mug = await version('mug', { stock: { [warehouses.main]: 10, [warehouses.north]: 3 } })
  const person = async (email: string, role: string, sellerId: string | null = null) => {
    const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, ${email}, 'P', 'active') returning id`
    await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${u?.id ?? ''}, ${store}, ${sellerId}, ${role}, 'active')`
    return withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId: t.partnerA }, now))
  }
  cookies.owner = await person('owner@jaipur.example', 'owner')
  cookies.manager = await person('manager@jaipur.example', 'manager')
  cookies.supplier = await person('anand@jaipur.example', 'supplier-admin', seller)
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const merchant = async (source: string, who: Who = 'owner', variables: Record<string, unknown> = {}) => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: store, ...(who === 'supplier' ? { [supplierHeader]: seller } : {}) }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, now, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, extensions: result.errors?.[0]?.extensions }
}
const shop = async (source: string, cart: string | null = null) => {
  const found = await resolveShopper(db.sql, new Request(`https://${host}/shop-api`, { headers: cart ? { 'x-shop-cart': cart } : {} }), host, 'shop.example')
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = { sql: db.sql, shopper: found.shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.5', userAgent: null }, couriers: null, allowAttempt: async () => true, allowNewCart: async () => true, now: () => new Date() }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, extensions: result.errors?.[0]?.extensions }
}

const saveShipping = async (input: Record<string, unknown>, who: Who = 'owner') => {
  const revision = ((await merchant('{ shippingSettings { revision } }')).data?.['shippingSettings'] as { revision: number }).revision
  const i = { courierRate: false, flatRate: true, flatAmount: '4900', pickup: true, pickupHours: 'Mon–Sat', freeMode: 'never', areaMode: 'everywhere', ...input }
  return merchant('mutation S($r: Int!, $i: ShippingInput!) { saveShipping(revision: $r, input: $i) }', who, { r: revision, i })
}
const warehouseRevision = async (id: string) => (await db.sql<{ revision: number }[]>`select revision from warehouse where id = ${id}`)[0]?.revision ?? 0
const saveWarehouse = async (id: string, input: Record<string, unknown>, who: Who = 'owner') =>
  merchant('mutation W($id: ID, $r: Int, $i: WarehouseInput!) { saveWarehouse(id: $id, revision: $r, input: $i) }', who, { id, r: await warehouseRevision(id), i: { name: 'Main location', ...input } })

/** A guest's cart, delivered to this pin (or none), with these lines. */
const cartOf = async (lines: [string, number][], pin: readonly [number, number] | null) => {
  let token: string | null = null
  for (const [v, quantity] of lines) {
    const added = await shop(`mutation { addToCart(versionId: "${v}", quantity: ${quantity}) { cartToken } }`, token)
    token ??= (added.data?.['addToCart'] as { cartToken: string }).cartToken
  }
  const cart = token ?? ''
  await shop('mutation { setCartContact(email: "asha@example.com") { cart { id } } }', cart)
  await moveTo(cart, pin)
  return cart
}
const moveTo = (cart: string, pin: readonly [number, number] | null) =>
  shop(`mutation { setShippingAddress(address: { name: "Asha", line1: "1 MI Road", city: "Jaipur", region: "Rajasthan", postalCode: "302001", country: "IN"${pin ? `, latitude: ${pin[0]}, longitude: ${pin[1]}` : ''} }) { cart { id } } }`, cart)
const offered = async (cart: string) =>
  ((await shop('{ cart { shippingOptions { id amount { amount } before { amount } } } }', cart)).data?.['cart'] as { shippingOptions: { id: string; amount: { amount: string }; before: { amount: string } | null }[] }).shippingOptions.map((o) =>
    [o.id, o.amount.amount, o.before?.amount ?? null])
const ids = async (cart: string) => (await offered(cart)).map(([id]) => id)
const cartWarehouse = async (cart: string) => (await db.sql<{ w: string | null }[]>`select delivery_warehouse_id as w from "order" where access_token_hash = ${await hashSessionId(cart)}`)[0]?.w ?? null
const setPlan = (on: boolean) =>
  db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, enabled) values (${plan}, ${t.partnerA}, 1, 'own_delivery', ${on}) on conflict (plan_id, version, key) do update set enabled = excluded.enabled`

describe('turning own delivery on', () => {
  it('names each missing piece: the plan, an active rider, a pinned delivering location', async () => {
    const refused = await saveShipping({ ownDelivery: true })
    expect(refused.code).toBe('OWN_DELIVERY_NOT_READY')
    expect(refused.extensions?.['missing']).toEqual(['plan', 'rider', 'warehouse'])
    await setPlan(true)
    expect((await saveShipping({ ownDelivery: true })).extensions?.['missing']).toEqual(['rider', 'warehouse'])
    await db.sql`insert into rider (store_id, name, phone, status) values (${store}, 'Ravi', '+919876543210', 'invited')`
    expect((await saveShipping({ ownDelivery: true })).extensions?.['missing']).toEqual(['rider', 'warehouse'])
    await db.sql`update rider set status = 'active' where store_id = ${store}`
    expect((await saveShipping({ ownDelivery: true })).extensions?.['missing']).toEqual(['warehouse'])
  })

  it('makes a location deliver only with its pin, an area and a fee, in metres 1–50 km', async () => {
    expect((await saveWarehouse(warehouses.main, { ownDelivery: true, deliveryRadiusM: 10000, deliveryFeeAmount: '4000' })).code).toBe('DELIVERY_AREA_REQUIRED')
    const pinned = { latitude: pins.main[0], longitude: pins.main[1] }
    expect((await saveWarehouse(warehouses.main, { ...pinned, ownDelivery: true, deliveryFeeAmount: '4000' })).code).toBe('DELIVERY_AREA_REQUIRED')
    expect((await saveWarehouse(warehouses.main, { ...pinned, ownDelivery: true, deliveryRadiusM: 10000 })).code).toBe('INVALID_INPUT')
    expect((await saveWarehouse(warehouses.main, { ...pinned, ownDelivery: true, deliveryRadiusM: 999, deliveryFeeAmount: '4000' })).code).toBe('INVALID_INPUT')
    expect((await saveWarehouse(warehouses.main, { ...pinned, ownDelivery: true, deliveryRadiusM: 10000, riderRadiusM: 50001, deliveryFeeAmount: '4000' })).code).toBe('INVALID_INPUT')
    expect((await saveWarehouse(warehouses.main, { ...pinned, ownDelivery: true, deliveryRadiusM: 10000, deliveryFeeAmount: '4000' })).code).toBeUndefined()
    expect(await db.sql`select own_delivery, delivery_radius_m, rider_radius_m, delivery_fee_amount::text as fee, delivery_fee_currency as currency from warehouse where id = ${warehouses.main}`).toEqual([
      { own_delivery: true, delivery_radius_m: 10000, rider_radius_m: 5000, fee: '4000', currency: 'INR' },
    ])
    // A save that doesn't name them keeps them; taking the pin or the area away while it delivers is refused.
    expect((await saveWarehouse(warehouses.main, { name: 'Main' })).code).toBeUndefined()
    expect((await saveWarehouse(warehouses.main, { latitude: null, longitude: null })).code).toBe('DELIVERY_AREA_REQUIRED')
    expect((await saveWarehouse(warehouses.main, { deliveryRadiusM: null })).code).toBe('DELIVERY_AREA_REQUIRED')
    expect(await db.sql`select own_delivery, latitude from warehouse where id = ${warehouses.main}`).toEqual([{ own_delivery: true, latitude: pins.main[0] }])
    expect((await saveWarehouse(warehouses.north, { name: 'North', ownDelivery: true, deliveryRadiusM: 10000, deliveryFeeAmount: '6000' })).code).toBeUndefined()
  })

  it('turns on once every piece is there, with dispatch when ready and 5 minutes by default', async () => {
    expect((await saveShipping({ ownDelivery: true, offerMinutes: 31 })).code).toBe('INVALID_INPUT')
    expect((await saveShipping({ ownDelivery: true, dispatchWhen: 'soon' })).code).toBe('INVALID_INPUT')
    expect((await saveShipping({ ownDelivery: true }, 'manager')).code).toBe('FORBIDDEN')
    expect((await saveShipping({ ownDelivery: true })).code).toBeUndefined()
    expect((await merchant('{ shippingSettings { ownDelivery dispatchWhen offerMinutes } }')).data?.['shippingSettings']).toEqual({ ownDelivery: true, dispatchWhen: 'ready', offerMinutes: 5 })
    expect((await saveShipping({ dispatchWhen: 'placed', offerMinutes: 10 })).code).toBeUndefined()
    expect((await merchant('{ shippingSettings { ownDelivery dispatchWhen offerMinutes } }')).data?.['shippingSettings']).toEqual({ ownDelivery: true, dispatchWhen: 'placed', offerMinutes: 10 })
    const [logged] = await db.sql<{ reason: string }[]>`select reason from activity_log where store_id = ${store} and action = 'shipping.saved' and result = 'success' order by occurred_at desc limit 1`
    expect(logged?.reason).toContain('own_delivery')
  })

  it('never lets a supplier make its location deliver, nor shows it the settings', async () => {
    const made = await merchant('mutation { saveWarehouse(input: { name: "Anand Godown" }) }', 'supplier')
    const own = String(made.data?.['saveWarehouse'])
    expect((await saveWarehouse(own, { name: 'Anand Godown', ownDelivery: true, deliveryRadiusM: 10000, deliveryFeeAmount: '1000' }, 'supplier')).code).toBe('INVALID_INPUT')
    // Nor the merchant side, which never changes a supplier's location; nor the database, for either role.
    expect((await saveWarehouse(own, { name: 'Anand Godown', ownDelivery: true, deliveryRadiusM: 10000, deliveryFeeAmount: '1000' })).code).toBe('NOT_FOUND')
    await expect(db.sql`update warehouse set own_delivery = true, latitude = 1, longitude = 1, delivery_radius_m = 1000, delivery_fee_amount = 0, delivery_fee_currency = 'INR' where id = ${own}`).rejects.toThrow(/warehouse_own_delivery_ready/)
    const seen = (await merchant('{ warehouses { nodes { id ownDelivery deliveryRadiusM riderRadiusM deliveryFeeAmount deliveryFeeCurrency } } }', 'supplier')).data?.['warehouses'] as { nodes: Record<string, unknown>[] }
    expect(seen.nodes.length).toBeGreaterThan(0)
    for (const node of seen.nodes) expect(node).toMatchObject({ ownDelivery: null, deliveryRadiusM: null, riderRadiusM: null, deliveryFeeAmount: null, deliveryFeeCurrency: null })
    const owner = (await merchant('{ warehouses { nodes { id ownDelivery deliveryFeeAmount } } }')).data?.['warehouses'] as { nodes: { id: string; ownDelivery: boolean }[] }
    expect(owner.nodes.find((w) => w.id === warehouses.main)).toEqual({ id: warehouses.main, ownDelivery: true, deliveryFeeAmount: '4000' })
  })
})

describe('the options a pinned address gets', () => {
  it('offers only own delivery, at the nearest location’s fee, and pickup beside it, inside an area', async () => {
    const cart = await cartOf([[versions.kurta, 1]], pins.inside)
    expect(await offered(cart)).toEqual([['own_delivery', '4000', null], ['pickup', '0', null]])
    await shop('mutation { setShippingOption(option: "own_delivery") { cart { shippingOption } } }', cart)
    expect(await cartWarehouse(cart)).toBe(warehouses.main)
    // Choosing another option drops it; the shopper never reads it.
    await shop('mutation { setShippingOption(option: "pickup") { cart { shippingOption } } }', cart)
    expect(await cartWarehouse(cart)).toBeNull()
  })

  it('goes to the next location when the nearest lacks the stock, a product that tracks none held anywhere', async () => {
    const cart = await cartOf([[versions.kurta, 2]], pins.inside)
    expect(await offered(cart)).toEqual([['own_delivery', '6000', null], ['pickup', '0', null]])
    await shop('mutation { setShippingOption(option: "own_delivery") { cart { shippingOption } } }', cart)
    expect(await cartWarehouse(cart)).toBe(warehouses.north)
    expect(await offered(await cartOf([[versions.shawl, 3]], pins.inside))).toEqual([['own_delivery', '4000', null], ['pickup', '0', null]])
    // More than any location holds: today's options.
    expect(await ids(await cartOf([[versions.kurta, 6]], pins.inside))).toEqual(['flat', 'pickup'])
  })

  it('gives today’s options outside every area, without a pin, and with a to-shopper supplier’s line', async () => {
    expect(await ids(await cartOf([[versions.kurta, 1]], pins.delhi))).toEqual(['flat', 'pickup'])
    expect(await ids(await cartOf([[versions.kurta, 1]], null))).toEqual(['flat', 'pickup'])
    expect(await ids(await cartOf([[versions.kurta, 1], [versions.supplied, 1]], pins.inside))).toEqual(['flat', 'pickup'])
  })

  it('makes the fee free over Shipping’s threshold, keeping what it would have cost', async () => {
    await db.sql`update store_shipping set free_mode = 'over', free_threshold_amount = 50000 where store_id = ${store}`
    expect(await offered(await cartOf([[versions.kurta, 1]], pins.inside))).toEqual([['own_delivery', '0', '4000'], ['pickup', '0', null]])
    await db.sql`update store_shipping set free_mode = 'never', free_threshold_amount = null where store_id = ${store}`
  })

  it('stops offering it while no rider is active or the plan lacks it, and outside a postcode list', async () => {
    const cart = await cartOf([[versions.kurta, 1]], pins.inside)
    await db.sql`update rider set status = 'suspended' where store_id = ${store}`
    expect(await ids(cart)).toEqual(['flat', 'pickup'])
    await db.sql`update rider set status = 'active' where store_id = ${store}`
    await setPlan(false)
    expect(await ids(cart)).toEqual(['flat', 'pickup'])
    await setPlan(true)
    await db.sql`update store_shipping set area_mode = 'list' where store_id = ${store}`
    await db.sql`insert into delivery_postal_code (store_id, code) values (${store}, '110001')`
    expect(await ids(cart)).toEqual(['pickup'])
    await db.sql`update store_shipping set area_mode = 'everywhere' where store_id = ${store}`
    expect(await ids(cart)).toEqual(['own_delivery', 'pickup'])
  })

  it('never counts another store’s location, and keeps warehouses and stock from the shopper', async () => {
    await db.sql`update warehouse set own_delivery = false where store_id = ${store}`
    const [theirs] = await db.sql<{ id: string }[]>`insert into warehouse (store_id, name, latitude, longitude, own_delivery, delivery_radius_m, delivery_fee_amount, delivery_fee_currency)
      values (${t.storeB1}, 'Theirs', ${pins.inside[0]}, ${pins.inside[1]}, true, 50000, 0, 'INR') returning id`
    const cart = await cartOf([[versions.shawl, 1]], pins.inside)
    expect(await ids(cart)).toEqual(['flat', 'pickup'])
    await db.sql`update warehouse set own_delivery = true where id in (${warehouses.main}, ${warehouses.north})`
    await db.sql`delete from warehouse where id = ${theirs?.id ?? ''}`
    const guest: TenantContext = { caller: { kind: 'shopper', customerId: null, orderTokenHash: await hashSessionId(cart) }, partnerId: t.partnerA, storeId: store, sellerScope: { kind: 'all' }, subscription: 'active' }
    for (const sql of ['select id from warehouse', 'select on_hand from stock_level', 'select delivery_warehouse_id from "order"', 'select dispatch_when from store_shipping']) {
      await expect(withScope(db.sql, guest, (tx) => tx.unsafe(sql))).rejects.toThrow(/permission denied/)
    }
    await expect(withScope(db.sql, guest, (tx) => tx`update "order" set delivery_warehouse_id = null`)).rejects.toThrow(/permission denied/)
    // The function answers only in shop scope, for the acting store.
    const merchantSide: TenantContext = { caller: { kind: 'person', userId: crypto.randomUUID(), sessionId: 's' }, partnerId: t.partnerA, storeId: store, sellerScope: { kind: 'all' }, subscription: 'active' }
    const lines = [{ version_id: versions.shawl, quantity: 1 }]
    expect(await withScope(db.sql, guest, (tx) => tx`select warehouse_id from shop_delivering_warehouse(${pins.inside[0]}, ${pins.inside[1]}, ${tx.json(lines)})`)).toHaveLength(1)
    await expect(withScope(db.sql, merchantSide, (tx) => tx`select warehouse_id from shop_delivering_warehouse(${pins.inside[0]}, ${pins.inside[1]}, ${tx.json(lines)})`)).rejects.toThrow(/permission denied/)
  })
})

describe('placing an own-delivery order', () => {
  const ready = async (lines: [string, number][]) => {
    const cart = await cartOf(lines, pins.inside)
    await shop('mutation { setShippingOption(option: "own_delivery") { cart { id } } }', cart)
    await shop('mutation { checkout { id } }', cart)
    return cart
  }
  const place = (cart: string) => shop('mutation { placeOrder(provider: "cod") { orderId total { amount } } }', cart)

  it('takes the option, warehouse and fee from the rule run again, and holds the stock there', async () => {
    const placed = await place(await ready([[versions.kurta, 1]]))
    const order = (placed.data?.['placeOrder'] as { orderId: string; total: { amount: string } }).orderId
    expect(await db.sql`select shipping_option, delivery_warehouse_id, shipping_amount::text as shipping from "order" where id = ${order}`).toEqual([
      { shipping_option: 'own_delivery', delivery_warehouse_id: warehouses.main, shipping: '4000' },
    ])
    expect(await db.sql`select reserved_warehouse_id from order_line where order_id = ${order}`).toEqual([{ reserved_warehouse_id: warehouses.main }])
    expect(await db.sql`select reserved from stock_level where version_id = ${versions.kurta} and warehouse_id = ${warehouses.main}`).toEqual([{ reserved: 1 }])
    // The main location is now out of kurtas: the next order goes from the north one.
    const next = (await place(await ready([[versions.kurta, 1]]))).data?.['placeOrder'] as { orderId: string }
    expect(await db.sql`select delivery_warehouse_id, shipping_amount::text as shipping from "order" where id = ${next.orderId}`).toEqual([{ delivery_warehouse_id: warehouses.north, shipping: '6000' }])
  })

  it('refuses SHIPPING_UNAVAILABLE once the pin has moved outside every area', async () => {
    const cart = await ready([[versions.shawl, 1]])
    await db.sql`update "order" set shipping_address = shipping_address || ${db.sql.json({ latitude: pins.delhi[0], longitude: pins.delhi[1] })} where access_token_hash = ${await hashSessionId(cart)}`
    const refused = await place(cart)
    expect(refused.code).toBe('NOT_READY')
    expect(refused.extensions?.['problems']).toContain('SHIPPING_UNAVAILABLE')
  })

  it('holds a card order’s stock at its warehouse when paid', async () => {
    const [o] = await db.sql<{ id: string }[]>`
      insert into "order" (store_id, state, currency, number, placed_at, shipping_option, delivery_warehouse_id, payment_method, stock_reserved, total_amount)
      values (${store}, 'placed', 'INR', 'C-1', ${now}, 'own_delivery', ${warehouses.north}, 'stripe', false, 104000) returning id`
    const [mug] = await db.sql<{ product_id: string }[]>`select product_id from product_version where id = ${versions.mug}`
    await db.sql`insert into order_line (order_id, store_id, version_id, product_id, name, quantity, unit_amount, line_total_amount) values (${o?.id ?? ''}, ${store}, ${versions.mug}, ${mug?.product_id ?? ''}, 'Mug', 2, 50000, 100000)`
    await db.sql`insert into payment (order_id, store_id, provider, provider_ref, kind, amount, currency) values (${o?.id ?? ''}, ${store}, 'stripe', 'pi_own_delivery', 'card', 104000, 'INR')`
    expect(await applyOutcome({ sql: db.sql, activity: activityLog, now: () => now }, 'stripe', 'pi_own_delivery', { state: 'captured', amount: { amount: 104000n, currency: 'INR' } })).toBe('paid')
    // The main location has more mugs, but the order delivers from the north one.
    expect(await db.sql`select warehouse_id, reserved from stock_level where version_id = ${versions.mug} order by on_hand`).toEqual([
      { warehouse_id: warehouses.north, reserved: 2 },
      { warehouse_id: warehouses.main, reserved: 0 },
    ])
  })
})

describe('the migration and the pricing currency', () => {
  it('leaves every store as it was: own delivery off, dispatch when ready, no warehouse delivering', async () => {
    expect(await db.sql`select own_delivery_enabled, dispatch_when, offer_minutes from store_shipping where store_id <> ${store}`).toEqual(
      (await db.sql`select store_id from store_shipping where store_id <> ${store}`).map(() => ({ own_delivery_enabled: false, dispatch_when: 'ready', offer_minutes: 5 })),
    )
    expect(await db.sql`select count(*)::int as n from warehouse where store_id <> ${store} and own_delivery`).toEqual([{ n: 0 }])
  })

  it('drops a location’s fee and its own delivery when the pricing currency moves, as a market’s charge', async () => {
    await db.sql`update store set pricing_currency = 'USD' where id = ${store}`
    expect(await db.sql`select own_delivery, delivery_fee_amount, delivery_fee_currency from warehouse where id in (${warehouses.main}, ${warehouses.north})`).toEqual([
      { own_delivery: false, delivery_fee_amount: null, delivery_fee_currency: null },
      { own_delivery: false, delivery_fee_amount: null, delivery_fee_currency: null },
    ])
    await db.sql`update store set pricing_currency = 'INR' where id = ${store}`
  })
})
