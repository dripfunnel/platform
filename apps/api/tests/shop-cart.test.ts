import { graphql, type GraphQLSchema } from 'graphql'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { resolveShopper } from '#auth/shopCaller'
import { hashSessionId } from '#auth/session'
import type { TenantContext } from '#core/tenancy'
import { deleteExpiredCarts, selectCartLineDisplays } from '#db/scoped/cart'
import { selectShopAsset } from '#db/scoped/shop'
import { defaultFeatures } from '#db/scoped/catalogListing'
import { withScope, withSystemScope } from '#db/scoped/index'
import { createCartService } from '#engine/modules/cart/index'
import { activityLog } from '#saas/activity/index'
import { productWithChoices } from './support/catalogue'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #308 (SAPI 9), part 1: a guest's cart and checkout up to payment, priced by the engine (PLATFORM-PROMPT §5.4), and
// held to the guest who has its token (DATA-MODEL §7.11).

let db: TestDatabase
let t: Tenants
const stores = { india: '', other: '' }
const ids = { kurta: '', hidden: '', theirs: '' }
const hostOf = { india: 'jaipur.shop.example', other: 'surat.shop.example' }

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
  stores.india = await store('Jaipur', 'jaipur')
  stores.other = await store('Surat', 'surat')
  ids.kurta = await version(stores.india, 'kurta', 'visible', '105000', 3)
  ids.hidden = await version(stores.india, 'hidden', 'hidden', '100', 3)
  ids.theirs = await version(stores.other, 'theirs', 'visible', '100', 3)
  await db.sql`insert into store_shipping (store_id, flat_enabled, flat_amount, pickup_enabled, pickup_hours, currency, area_mode, saved_at, revision)
    values (${stores.india}, true, 4900, true, 'Mon–Sat, 10–6', 'INR', 'everywhere', now(), 1)
    on conflict (store_id) do update set flat_enabled = excluded.flat_enabled, flat_amount = excluded.flat_amount, pickup_enabled = excluded.pickup_enabled, pickup_hours = excluded.pickup_hours, currency = excluded.currency, area_mode = excluded.area_mode, saved_at = excluded.saved_at, revision = excluded.revision`
  // Clothing at 5% GST, prices including tax (India's default, migration 0055).
  await db.sql`update product_version set tax_class_id = (select id from tax_class where store_id = ${stores.india} and name = 'Clothing') where id = ${ids.kurta}`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const gql = async (source: string, who: { host?: string; token?: string | null; sql?: postgres.Sql; language?: string } = {}, variables: Record<string, unknown> = {}) => {
  const host = who.host ?? hostOf.india
  const headers: Record<string, string> = { ...(who.token ? { 'x-shop-cart': who.token } : {}), ...(who.language ? { 'x-shop-language': who.language } : {}) }
  const found = await resolveShopper(db.sql, new Request(`https://${host}/shop-api`, { headers }), host, 'shop.example')
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = { sql: who.sql ?? db.sql, shopper: found.shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.4', userAgent: null }, couriers: null, allowNewCart: async () => allow, now: () => new Date() }
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

describe('adding to a cart', () => {
  const add = (who: { token?: string | null; sql?: postgres.Sql } = {}) =>
    gql(`mutation { addToCart(versionId: "${ids.kurta}", quantity: 1) { cartToken cart { lines { quantity } } } }`, who)

  it('starts a new cart behind a new token when the token presented opens none', async () => {
    const stale = 'e'.repeat(64)
    const change = (await add({ token: stale })).data?.['addToCart'] as { cartToken: string | null; cart: unknown }
    expect(change.cart).toEqual({ lines: [{ quantity: 1 }] })
    expect(change.cartToken).toMatch(/^[0-9a-f]{64}$/)
    expect(change.cartToken).not.toBe(stale)
  })

  it('counts every add of one item made at once, one after the other', async () => {
    const held = ((await add()).data?.['addToCart'] as { cartToken: string }).cartToken
    await Promise.all([1, 2, 3, 4].map(() => add({ token: held })))
    expect(await cart(held)).toMatchObject({ lines: [{ quantity: 5 }] })
  })

  // Every statement is a round trip to the database, which made adding slow on a live shop (#1009: 55 before, 37 now).
  it('looks the cart and its items up once, in one transaction', async () => {
    const held = ((await add()).data?.['addToCart'] as { cartToken: string }).cartToken
    let statements = 0
    const counted = postgres(db.url, { max: 1, fetch_types: false, debug: () => (statements += 1) })
    try {
      const again = await add({ token: held, sql: counted })
      expect(again.data?.['addToCart']).toEqual({ cartToken: null, cart: { lines: [{ quantity: 2 }] } })
      expect(statements).toBeLessThanOrEqual(37)
    } finally {
      await counted.end()
    }
  })

  const stale = 'd'.repeat(64)
  const carts = async () => Number((await db.sql<{ n: string }[]>`select count(*)::text as n from "order" where store_id = ${stores.india}`)[0]?.n)
  const refusal = (versionId: string, token: string | null, gift = '') =>
    gql(`mutation { addToCart(versionId: "${versionId}", quantity: 1${gift}) { cartToken } }`, { token }).then((r) => r.code)

  it('refuses an item shoppers can’t buy before the limiter counts a new cart, with no token or a stale one', async () => {
    allow = false
    try {
      expect(await refusal(ids.hidden, null)).toBe('UNAVAILABLE')
      expect(await refusal(ids.theirs, stale)).toBe('UNAVAILABLE')
      expect(await refusal(ids.kurta, null)).toBe('RATE_LIMITED')
      expect(await refusal(ids.kurta, stale)).toBe('RATE_LIMITED')
    } finally {
      allow = true
    }
  })

  it('refuses a recipient on an item that isn’t a gift card, leaving no cart behind', async () => {
    const before = await carts()
    const gift = ', gift: { recipientName: "Asha", recipientEmail: "asha@example.com" }'
    expect(await refusal(ids.kurta, null, gift)).toBe('INVALID_INPUT')
    expect(await refusal(ids.kurta, stale, gift)).toBe('INVALID_INPUT')
    expect(await carts()).toBe(before)
  })

  // A signed-in shopper's first add inserts its cart inside the transaction, so a refusal there must roll it back.
  it('rolls a signed-in shopper’s new cart back when the add is refused', async () => {
    const customerId = (await db.sql<{ id: string }[]>`insert into customer (store_id, email, name, status) values (${stores.india}, 'rollback@example.com', 'Rollback', 'active') returning id`)[0]?.id ?? ''
    const context: TenantContext = { caller: { kind: 'shopper', customerId, orderTokenHash: null }, partnerId: t.partnerA, storeId: stores.india, sellerScope: { kind: 'all' }, subscription: 'active' }
    const service = createCartService({ sql: db.sql, context, language: 'en', currency: 'INR', marketId: null, features: defaultFeatures, couriers: null, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.4', userAgent: null }, allowNewCart: async () => true, now: () => new Date() })
    const before = await carts()
    expect(await service.add(ids.hidden, 1)).toEqual({ ok: false, reason: 'UNAVAILABLE' })
    expect(await service.add(ids.kurta, 1, { recipientName: 'Asha', recipientEmail: 'asha@example.com' })).toEqual({ ok: false, reason: 'INVALID_INPUT' })
    expect(await carts()).toBe(before)
    expect((await service.add(ids.kurta, 1)).ok).toBe(true)
    expect(await carts()).toBe(before + 1)
  })
})

describe('a line’s version (#1347)', () => {
  const linesOf = async (versionIds: string[], language = 'en-US') => {
    let held: string | null = null
    for (const id of versionIds) {
      const added = await gql(`mutation { addToCart(versionId: "${id}", quantity: 1) { cartToken } }`, { token: held })
      held ??= (added.data?.['addToCart'] as { cartToken: string }).cartToken
    }
    return ((await gql('{ cart { lines { versionName } } }', { token: held, language })).data?.['cart'] as { lines: { versionName: string | null }[] }).lines.map((l) => l.versionName)
  }

  it('names a version by its choices unless it has a name of its own, and a product without options not at all', async () => {
    const shirt = await productWithChoices(db.sql, stores.india, 'Shirt', ['Size'], [{ choices: ['S'] }, { choices: ['M'] }, { choices: ['L'], name: 'Large, relaxed fit' }])
    const [kurta] = await productWithChoices(db.sql, stores.india, 'Silk kurta', ['Size', 'Colour'], [{ choices: ['M', 'Red'] }])
    expect(await linesOf([...shirt, kurta ?? '', ids.kurta])).toEqual(['Size: S', 'Size: M', 'Large, relaxed fit', 'Size: M · Colour: Red', null])
  })

  it('names the choices in the shopper’s language', async () => {
    const [scarf] = await productWithChoices(db.sql, stores.india, 'Scarf', ['Length'], [{ choices: ['Long'] }])
    await db.sql`insert into store_language (store_id, language) values (${stores.india}, 'hi-IN')`
    await db.sql`insert into translation (store_id, entity, entity_id, field, language, text, source_hash) values
      (${stores.india}, 'option_name', 'length', 'name', 'hi-IN', 'लंबाई', ${'0'.repeat(32)}), (${stores.india}, 'choice_name', 'long', 'name', 'hi-IN', 'लंबा', ${'0'.repeat(32)})`
    expect(await linesOf([scarf ?? ''], 'hi-IN')).toEqual(['लंबाई: लंबा'])
    expect(await linesOf([scarf ?? ''])).toEqual(['Length: Long'])
  })
})

describe('a line that can’t be bought any more keeps what names it (#1465)', () => {
  const seen = async (state: (productId: string, versionId: string) => Promise<unknown>) => {
    const [version] = await productWithChoices(db.sql, stores.india, `Sleepsuit ${crypto.randomUUID().slice(0, 8)}`, ['Size', 'Colour'], [{ choices: ['3-6 m', 'Blue'] }])
    const productId = (await db.sql<{ product_id: string }[]>`select product_id from product_version where id = ${version ?? ''}`)[0]?.product_id ?? ''
    const asset = (await db.sql<{ id: string }[]>`insert into asset (store_id, r2_key, kind, mime, bytes, checksum) values (${stores.india}, ${`stores/${stores.india}/assets/${crypto.randomUUID()}.png`}, 'image', 'image/png', 1, ${'0'.repeat(64)}) returning id`)[0]?.id ?? ''
    await db.sql`insert into product_photo (product_id, store_id, asset_id, position) values (${productId}, ${stores.india}, ${asset}, 0)`
    const added = await gql(`mutation { addToCart(versionId: "${version ?? ''}", quantity: 2) { cartToken } }`)
    const held = (added.data?.['addToCart'] as { cartToken: string }).cartToken
    await state(productId, version ?? '')
    const lines = ((await gql('{ cart { lines { productName productSlug versionName photoUrl unitPrice { amount } lineTotal { amount } problem } subtotal { amount } problems readyToPay } }', { token: held })).data?.['cart'] as { lines: Record<string, unknown>[]; subtotal: { amount: string }; problems: string[]; readyToPay: boolean })
    return { asset, ...lines }
  }

  const keepsItsName = (result: Awaited<ReturnType<typeof seen>>) => {
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]).toMatchObject({ productSlug: null, versionName: 'Size: 3-6 m · Colour: Blue', unitPrice: null, lineTotal: null, problem: 'unavailable' })
    expect(String(result.lines[0]?.['productName'])).toMatch(/^Sleepsuit /)
    expect(String(result.lines[0]?.['photoUrl'])).toContain(result.asset)
    expect(result.subtotal.amount).toBe('0')
    expect(result.readyToPay).toBe(false)
  }

  it('keeps the name, version and photo of a hidden product, with no price, no link and checkout blocked', async () => {
    keepsItsName(await seen((p) => db.sql`update product set visibility = 'hidden' where id = ${p}`))
  })

  it('keeps them for a deleted product', async () => {
    keepsItsName(await seen((p) => db.sql`update product set deleted_at = now() where id = ${p}`))
  })

  it('keeps them for a hidden version', async () => {
    keepsItsName(await seen((_, v) => db.sql`update product_version set visibility = 'hidden' where id = ${v}`))
  })

  it('keeps them for a removed version', async () => {
    keepsItsName(await seen((_, v) => db.sql`update product_version set deleted_at = now() where id = ${v}`))
  })

  it('shows a version’s own photo before the product’s first', async () => {
    const result = await seen(async (p, v) => {
      const own = (await db.sql<{ id: string }[]>`insert into asset (store_id, r2_key, kind, mime, bytes, checksum) values (${stores.india}, ${`stores/${stores.india}/assets/${crypto.randomUUID()}.png`}, 'image', 'image/png', 1, ${'1'.repeat(64)}) returning id`)[0]?.id ?? ''
      await db.sql`insert into product_photo (product_id, store_id, asset_id, position) values (${p}, ${stores.india}, ${own}, 1)`
      await db.sql`update product_version set photo_asset_id = ${own} where id = ${v}`
      await db.sql`update product set visibility = 'hidden' where id = ${p}`
      return own
    })
    const own = (await db.sql<{ photo_asset_id: string }[]>`select photo_asset_id from product_version where photo_asset_id is not null order by created_at desc limit 1`)[0]?.photo_asset_id ?? ''
    expect(String(result.lines[0]?.['photoUrl'])).toContain(own)
    expect(String(result.lines[0]?.['photoUrl'])).not.toContain(result.asset)
  })

  it('lets the shop read the photo file of a product it no longer shows', async () => {
    const asShopper: TenantContext = { caller: { kind: 'shopper', customerId: null, orderTokenHash: null }, partnerId: t.partnerA, storeId: stores.india, sellerScope: { kind: 'all' }, subscription: 'active' }
    const result = await seen((p) => db.sql`update product set visibility = 'hidden' where id = ${p}`)
    const loose = (await db.sql<{ id: string }[]>`insert into asset (store_id, r2_key, kind, mime, bytes, checksum) values (${stores.india}, ${`stores/${stores.india}/assets/${crypto.randomUUID()}.png`}, 'image', 'image/png', 1, ${'2'.repeat(64)}) returning id`)[0]?.id ?? ''
    expect((await withScope(db.sql, asShopper, (tx) => selectShopAsset(tx, stores.india, result.asset)))?.mime).toBe('image/png')
    expect(await withScope(db.sql, asShopper, (tx) => selectShopAsset(tx, stores.india, loose))).toBeNull()
  })

  it('never names another store’s version', async () => {
    const [mine] = await productWithChoices(db.sql, stores.india, 'Private cushion', ['Size'], [{ choices: ['M'] }])
    expect(await withSystemScope(db.sql, (tx) => selectCartLineDisplays(tx, stores.other, [mine ?? ''], 'en-US'))).toEqual([])
    expect(await withSystemScope(db.sql, (tx) => selectCartLineDisplays(tx, stores.india, [mine ?? ''], 'en-US'))).toHaveLength(1)
  })
})
