import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { resolveShopper } from '#auth/shopCaller'
import { hashSessionId } from '#auth/session'
import type { TenantContext } from '#core/tenancy'
import { deleteExpiredCarts } from '#db/scoped/cart'
import { withScope, withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #308 (SAPI 9), part 1: a guest's cart and checkout up to payment, priced by the engine (PLATFORM-PROMPT §5.4), and
// held to the guest who has its token (DATA-MODEL §7.11).

let db: TestDatabase
let t: Tenants
const stores = { india: '', other: '' }
const ids = { kurta: '', hidden: '', theirs: '' }
const hostOf = { india: 'jaipur.shops.acme.example', other: 'surat.shops.acme.example' }

const store = async (name: string, code: string) => {
  const [row] = await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status, address) values
    (${t.partnerA}, ${name}, ${code}, 'IN', 'INR', 'active', '{"street": "12 MI Road", "city": "Jaipur", "postal": "302001", "region": "Rajasthan"}') returning id`
  return row?.id ?? ''
}
const version = async (storeId: string, slug: string, visibility: 'visible' | 'hidden', price: string, onHand: number) => {
  const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${storeId}, ${slug}, ${slug}, ${visibility}) returning id`
  const [v] = await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position, weight_grams, track_stock) values (${storeId}, ${p?.id ?? ''}, ${slug}, 0, 400, true) returning id`
  await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${v?.id ?? ''}, ${storeId}, 'INR', ${price})`
  await db.sql`insert into stock_level (version_id, warehouse_id, store_id, on_hand) select ${v?.id ?? ''}, w.id, ${storeId}, ${onHand} from warehouse w where w.store_id = ${storeId} and w.is_default`
  return v?.id ?? ''
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'shops', '*.shops.acme.example', 'live', 'CNAME', 'x')`
  stores.india = await store('Jaipur', 'jaipur')
  stores.other = await store('Surat', 'surat')
  ids.kurta = await version(stores.india, 'kurta', 'visible', '105000', 3)
  ids.hidden = await version(stores.india, 'hidden', 'hidden', '100', 3)
  ids.theirs = await version(stores.other, 'theirs', 'visible', '100', 3)
  await db.sql`insert into store_shipping (store_id, flat_enabled, flat_amount, pickup_enabled, pickup_hours, currency, area_mode, saved_at, revision)
    values (${stores.india}, true, 4900, true, 'Mon–Sat, 10–6', 'INR', 'everywhere', now(), 1)`
  // Clothing at 5% GST, prices including tax (India's default, migration 0055).
  await db.sql`update product_version set tax_class_id = (select id from tax_class where store_id = ${stores.india} and name = 'Clothing') where id = ${ids.kurta}`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const gql = async (source: string, who: { host?: string; token?: string | null } = {}, variables: Record<string, unknown> = {}) => {
  const host = who.host ?? hostOf.india
  const headers: Record<string, string> = who.token ? { 'x-shop-cart': who.token } : {}
  const found = await resolveShopper(db.sql, new Request(`https://${host}/shop-api`, { headers }), host)
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = { sql: db.sql, shopper: found.shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.4', userAgent: null }, couriers: null, allowNewCart: async () => allow, now: () => new Date() }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, problems: result.errors?.[0]?.extensions['problems'] as string[] | undefined }
}
const cartFields = 'lines { versionId quantity unitPrice { amount } lineTotal { amount } problem } subtotal { amount } shippingOptions { id amount { amount } } shippingOption shipping { amount } tax { amount { amount } pricesIncludeTax } total { amount } problems checkoutStep readyToPay'
const cart = async (token: string | null, host?: string) => (await gql(`{ cart { ${cartFields} } }`, { token, ...(host ? { host } : {}) })).data?.['cart'] as Record<string, unknown> | null
const mutate = (token: string | null, field: string, args = '') => gql(`mutation { ${field}${args} { cart { ${cartFields} } } }`, { token })

let token = ''
// What the new-cart limiter answers, or null for no limiter bound; a test turns it off.
let allow = true

describe('a guest’s cart', () => {
  it('starts on the first add, handing out a token once; without it there is no cart', async () => {
    expect(await cart(null)).toBeNull()
    const added = await gql(`mutation { addToCart(versionId: "${ids.kurta}", quantity: 2) { cartToken cart { lines { quantity } subtotal { amount } } } }`)
    const change = added.data?.['addToCart'] as { cartToken: string; cart: unknown }
    expect(change.cart).toEqual({ lines: [{ quantity: 2 }], subtotal: { amount: '210000' } })
    expect(change.cartToken).toMatch(/^[0-9a-f]{64}$/)
    token = change.cartToken
    expect(await cart(null)).toBeNull()
    expect((await gql(`mutation { addToCart(versionId: "${ids.kurta}", quantity: 1) { cartToken } }`, { token })).data?.['addToCart']).toEqual({ cartToken: null })
    expect(((await cart(token))?.['lines'] as { quantity: number }[])[0]?.quantity).toBe(3)
  })

  it('adds only what shoppers can see, of this store', async () => {
    expect((await gql(`mutation { addToCart(versionId: "${ids.hidden}", quantity: 1) { cartToken } }`, { token })).code).toBe('UNAVAILABLE')
    expect((await gql(`mutation { addToCart(versionId: "${ids.theirs}", quantity: 1) { cartToken } }`, { token })).code).toBe('UNAVAILABLE')
    expect((await gql(`mutation { addToCart(versionId: "${ids.kurta}", quantity: 1000) { cartToken } }`, { token })).code).toBe('INVALID_INPUT')
  })

  it('says a line wants more than is left, and refuses payment until everything is in place', async () => {
    await mutate(token, 'setCartQuantity', `(versionId: "${ids.kurta}", quantity: 5)`)
    expect(((await cart(token))?.['lines'] as { problem: string }[])[0]?.problem).toBe('short')
    const refused = await gql('mutation { checkout { id } }', { token })
    expect([refused.code, refused.problems]).toEqual(['NOT_READY', ['LINE_PROBLEM', 'NO_CONTACT', 'NO_ADDRESS', 'NO_SHIPPING', 'TAX_UNAVAILABLE']])
    await mutate(token, 'setCartQuantity', `(versionId: "${ids.kurta}", quantity: 2)`)
  })

  it('reaches payment with a contact, an address and a delivery option, the engine pricing delivery and GST', async () => {
    expect((await mutate(token, 'setCartContact', '(email: "not-an-email")')).code).toBe('INVALID_INPUT')
    await mutate(token, 'setCartContact', '(email: "Asha@Example.com", phone: "+919845022113")')
    const addressed = await gql(`mutation { setShippingAddress(address: { name: "Asha Rao", line1: "12 MG Road", city: "Pune", region: "Maharashtra", postalCode: "411001", country: "IN" }) { cart { ${cartFields} } } }`, { token })
    const shipped = (addressed.data?.['setShippingAddress'] as { cart: Record<string, unknown> }).cart
    expect(shipped['shippingOptions']).toEqual([{ id: 'flat', amount: { amount: '4900' } }, { id: 'pickup', amount: { amount: '0' } }])
    // 5% GST inside ₹2,100, across states (IGST): 10,000 paise.
    expect(shipped['tax']).toEqual({ amount: { amount: '10000' }, pricesIncludeTax: true })
    await mutate(token, 'setShippingOption', '(option: "flat")')
    const paid = await gql(`mutation { checkout { ${cartFields} } }`, { token })
    expect(paid.data?.['checkout']).toMatchObject({ subtotal: { amount: '210000' }, shipping: { amount: '4900' }, total: { amount: '214900' }, problems: [], checkoutStep: 'pay', readyToPay: true })
  })

  it('goes back to delivery when the contact changes after reaching payment', async () => {
    expect(await cart(token)).toMatchObject({ checkoutStep: 'pay' })
    await mutate(token, 'setCartContact', '(email: "asha.rao@example.com", phone: "+919845022113")')
    expect(await cart(token)).toMatchObject({ checkoutStep: 'ship', readyToPay: false })
    expect((await gql(`mutation { checkout { readyToPay } }`, { token })).data?.['checkout']).toEqual({ readyToPay: true })
  })

  it('quotes no delivery before an address when the store has no country, never inventing one', async () => {
    await db.sql`update store set country = null where id = ${stores.other}`
    try {
      const added = await gql(`mutation { addToCart(versionId: "${ids.theirs}", quantity: 1) { cartToken cart { shippingOptions { id } } } }`, { host: hostOf.other })
      expect((added.data?.['addToCart'] as { cart: { shippingOptions: unknown[] } }).cart.shippingOptions).toEqual([])
    } finally {
      await db.sql`update store set country = 'IN' where id = ${stores.other}`
      await db.sql`delete from cart_line where store_id = ${stores.other}`
      await db.sql`delete from "order" where store_id = ${stores.other} and state = 'cart'`
    }
  })

  it('charges no tax where the store has no rate (a US address on an Indian store), never refusing the cart for it', async () => {
    await gql(`mutation { setShippingAddress(address: { name: "Sam Lee", line1: "1 High St", city: "Columbus", region: "OH", postalCode: "43215", country: "US" }) { cart { id } } }`, { token })
    expect(await cart(token)).toMatchObject({ tax: { amount: { amount: '0' } } })
    expect(((await cart(token))?.['problems'] as string[]).includes('TAX_UNAVAILABLE')).toBe(false)
    await gql(`mutation { setShippingAddress(address: { name: "Asha Rao", line1: "12 MG Road", city: "Pune", region: "Maharashtra", postalCode: "411001", country: "IN" }) { cart { id } } }`, { token })
    await mutate(token, 'setShippingOption', '(option: "flat")')
    await gql('mutation { checkout { id } }', { token })
  })

  it('goes back a step when it changes after reaching payment, and collection in person needs no address', async () => {
    await mutate(token, 'setCartQuantity', `(versionId: "${ids.kurta}", quantity: 1)`)
    expect(await cart(token)).toMatchObject({ checkoutStep: 'ship', readyToPay: false })
    await mutate(token, 'setShippingOption', '(option: "pickup")')
    const paid = await gql(`mutation { checkout { ${cartFields} } }`, { token })
    expect(paid.data?.['checkout']).toMatchObject({ shipping: { amount: '0' }, total: { amount: '105000' }, readyToPay: true })
  })
})

describe('isolation (DATA-MODEL §7.11)', () => {
  const guest = async (storeId: string, presented: string | null): Promise<TenantContext> => ({
    caller: { kind: 'shopper', customerId: null, orderTokenHash: presented ? await hashSessionId(presented) : null },
    partnerId: t.partnerA,
    storeId,
    sellerScope: { kind: 'all' },
    subscription: 'active',
  })

  it('shows a cart only to the guest with its token, in its own store', async () => {
    expect(await cart('0'.repeat(64))).toBeNull()
    expect(await cart(token, hostOf.other)).toBeNull()
    const seen = async (context: TenantContext) => withScope(db.sql, context, async (tx) => (await tx<{ n: number }[]>`select (select count(*) from "order")::int + (select count(*) from cart_line)::int as n`)[0]?.n)
    expect(await seen(await guest(stores.india, token))).toBe(2)
    expect(await seen(await guest(stores.india, null))).toBe(0)
    expect(await seen(await guest(stores.other, token))).toBe(0)
  })

  it('never lets another guest write it, nor any shopper write a state or a cart without its token', async () => {
    const other = await guest(stores.india, 'f'.repeat(64))
    expect((await withScope(db.sql, other, (tx) => tx`update "order" set email = 'x@example.com' where store_id = ${stores.india}`)).count).toBe(0)
    await expect(withScope(db.sql, await guest(stores.india, token), (tx) => tx`update "order" set state = 'placed'`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, await guest(stores.india, token), (tx) => tx`update "order" set payment_state = 'paid'`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, await guest(stores.india, null), (tx) => tx`insert into "order" (store_id, currency) values (${stores.india}, 'INR')`)).rejects.toThrow(/row-level security/)
    await expect(withScope(db.sql, await guest(stores.india, null), (tx) => tx`select access_token_hash from "order"`)).rejects.toThrow(/permission denied/)
    // A currency or market the store doesn't offer is refused; its own pricing currency is taken.
    await expect(withScope(db.sql, await guest(stores.india, token), (tx) => tx`update "order" set currency = 'JPY'`)).rejects.toThrow(/row-level security/)
    await expect(withScope(db.sql, await guest(stores.india, token), (tx) => tx`update "order" set market_id = ${crypto.randomUUID()}`)).rejects.toThrow(/row-level security/)
    expect((await withScope(db.sql, await guest(stores.india, token), (tx) => tx`update "order" set currency = 'INR'`)).count).toBe(1)
  })

  it('shows a shopper its own store’s tax facts only, in shop scope only (migration 0066)', async () => {
    const rows = (context: TenantContext) =>
      withScope(db.sql, context, async (tx) => (await tx<{ n: number }[]>`select (select count(*) from tax_class)::int + (select count(*) from tax_zone)::int + (select count(*) from tax_rate)::int as n`)[0]?.n)
    const india = await rows(await guest(stores.india, null))
    expect(india).toBeGreaterThan(0)
    const own = (await db.sql<{ n: number }[]>`select (select count(*) from tax_class where store_id = ${stores.india} and deleted_at is null)::int + (select count(*) from tax_zone where store_id = ${stores.india})::int + (select count(*) from tax_rate where store_id = ${stores.india})::int as n`)[0]?.n
    expect(india).toBe(own)
    const versions = await withScope(db.sql, await guest(stores.other, null), (tx) => tx<{ tax_class_id: string | null }[]>`select tax_class_id from product_version where id = ${ids.kurta}`)
    expect(versions).toEqual([])
    const outOfScope = await db.sql.begin(async (tx) => {
      await tx.unsafe('set local role app_shop')
      await tx`select set_config('app.scope', 'store', true), set_config('app.store_id', ${stores.india}, true), set_config('app.seller_id', '', true)`
      return tx`select id from tax_class`
    })
    expect(outOfScope).toHaveLength(0)
    await expect(withScope(db.sql, await guest(stores.india, null), (tx) => tx`update tax_rate set rate_bps = 0`)).rejects.toThrow(/permission denied/)
  })

  it('never lets another guest add, change or take out the lines of a cart it doesn’t hold', async () => {
    const other = await guest(stores.india, 'f'.repeat(64))
    const order = (await db.sql<{ id: string }[]>`select id from "order" where store_id = ${stores.india} limit 1`)[0]?.id ?? ''
    await expect(withScope(db.sql, other, (tx) => tx`insert into cart_line (order_id, store_id, version_id, quantity) values (${order}, ${stores.india}, ${ids.kurta}, 5)`)).rejects.toThrow(/row-level security/)
    expect((await withScope(db.sql, other, (tx) => tx`update cart_line set quantity = 9`)).count).toBe(0)
    expect((await withScope(db.sql, other, (tx) => tx`delete from cart_line`)).count).toBe(0)
  })

  it('lets the merchant read its own store’s carts and never another’s, and a supplier none', async () => {
    const merchant = (storeId: string, seller?: string): TenantContext => ({ caller: { kind: 'person', userId: 'u', sessionId: 's' }, partnerId: t.partnerA, storeId, sellerScope: seller ? { kind: 'seller', sellerId: seller } : { kind: 'all' }, subscription: 'active' })
    expect((await withScope(db.sql, merchant(stores.india), (tx) => tx`select id from "order"`)).length).toBe(1)
    expect((await withScope(db.sql, merchant(stores.other), (tx) => tx`select id from "order"`)).length).toBe(0)
    await expect(withScope(db.sql, merchant(stores.india, t.sellerA1First), (tx) => tx`select id from "order"`)).rejects.toThrow(/permission denied/)
  })
})

describe('limits and expiry', () => {
  it('refuses a new guest cart once the limiter says no, but never an existing cart’s change', async () => {
    allow = false
    expect((await gql(`mutation { addToCart(versionId: "${ids.kurta}", quantity: 1) { cartToken } }`)).code).toBe('RATE_LIMITED')
    expect((await gql(`mutation { setCartQuantity(versionId: "${ids.kurta}", quantity: 1) { cart { id } } }`, { token })).code).toBeUndefined()
    allow = true
  })

  it('deletes carts past their expiry, lines with them, and never a placed order', async () => {
    const before = Number((await db.sql<{ n: string }[]>`select count(*)::text as n from "order" where store_id = ${stores.india}`)[0]?.n)
    const added = await gql(`mutation { addToCart(versionId: "${ids.kurta}", quantity: 1) { cartToken } }`)
    expect(added.code).toBeUndefined()
    const removed = await withSystemScope(db.sql, (tx) => deleteExpiredCarts(tx, new Date(Date.now() + 31 * 86_400_000), 500))
    expect(removed).toBe(before + 1)
    expect(Number((await db.sql<{ n: string }[]>`select count(*)::text as n from cart_line`)[0]?.n)).toBe(0)
  })
})
