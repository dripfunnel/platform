import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { resolveShopper } from '#auth/shopCaller'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #323 (SAPI 22), part 1: a download, a service and a gift card on the storefront (CATALOG-DESIGN T14): what each
// page says, a key pool's keys counted as its stock, no address or delivery for a cart with nothing to send, and no tax
// on a gift card (CatEditor).

let db: TestDatabase
let t: Tenants
const host = 'kesari.shops.acme.example'
let store = ''
const v = { pack: '', keys: '', lesson: '', card: '', kurta: '' }

const product = async (slug: string, type: string, extra: { amount?: number; track?: boolean; kind?: Record<string, unknown> } = {}) => {
  const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility, product_type) values (${store}, ${slug}, ${slug}, 'visible', ${type}) returning id`
  if (extra.kind) await db.sql`update product set ${db.sql(extra.kind)} where id = ${p?.id ?? ''}`
  const id = (await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, position, track_stock) values (${store}, ${p?.id ?? ''}, 0, ${extra.track ?? false}) returning id`)[0]?.id ?? ''
  await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${id}, ${store}, 'INR', ${extra.amount ?? 90000})`
  return { productId: p?.id ?? '', versionId: id }
}

let keysProduct = ''

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'shops', '*.shops.acme.example', 'live', 'CNAME', 'x')`
  store = (await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status) values (${t.partnerA}, 'Kesari', 'kesari', 'IN', 'INR', 'active') returning id`)[0]?.id ?? ''
  v.pack = (await product('pattern-pack', 'digital', { kind: { download_mode: 'file', download_limit: 3, download_days: 7 } })).versionId
  const keys = await product('font-licence', 'digital', { kind: { download_mode: 'keys' } })
  v.keys = keys.versionId
  keysProduct = keys.productId
  await db.sql`insert into licence_key (store_id, product_id, key) values (${store}, ${keysProduct}, 'K-1'), (${store}, ${keysProduct}, 'K-2')`
  v.lesson = (await product('block-printing-class', 'service', { kind: { service_duration: '2 hours', service_location: 'Our Jaipur studio' } })).versionId
  v.card = (await product('gift-card', 'gift_card', { amount: 100000, kind: { gift_card_expiry_months: 12 } })).versionId
  v.kurta = (await product('kurta', 'physical', { amount: 105000, track: true })).versionId
  await db.sql`insert into stock_level (version_id, warehouse_id, store_id, on_hand) select ${v.kurta}, w.id, ${store}, 5 from warehouse w where w.store_id = ${store} and w.is_default`
  await db.sql`insert into store_shipping (store_id, flat_enabled, flat_amount, pickup_enabled, currency, area_mode, saved_at, revision) values (${store}, true, 5000, false, 'INR', 'everywhere', now(), 1)`
  await db.sql`insert into payment_provider_account (store_id, provider, status) values (${store}, 'cod', 'live')`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const shop = async (source: string, cart: string | null = null) => {
  const found = await resolveShopper(db.sql, new Request(`https://${host}/shop-api`, { headers: cart ? { 'x-shop-cart': cart } : {} }), host)
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = { sql: db.sql, shopper: found.shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.5', userAgent: null }, couriers: null, allowAttempt: async () => true, allowNewCart: async () => true, now: () => new Date() }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
const add = async (versionId: string, quantity: number, cart: string | null = null) => {
  // A gift card goes to someone (part 2).
  const gift = versionId === v.card ? ', gift: { recipientName: "Meera", recipientEmail: "meera@example.com" }' : ''
  const result = await shop(`mutation { addToCart(versionId: "${versionId}", quantity: ${quantity}${gift}) { cartToken cart { needsShipping } } }`, cart)
  const change = result.data?.['addToCart'] as { cartToken: string | null; cart: { needsShipping: boolean } } | undefined
  return { token: change?.cartToken ?? cart ?? '', needsShipping: change?.cart.needsShipping, code: result.code }
}
const cart = async (token: string) =>
  (await shop('{ cart { needsShipping shippingOption shipping { amount } tax { amount { amount } } total { amount } problems lines { problem available } } }', token)).data?.['cart'] as {
    needsShipping: boolean
    shippingOption: string | null
    shipping: { amount: string } | null
    tax: { amount: { amount: string } } | null
    total: { amount: string }
    problems: string[]
    lines: { problem: string | null; available: number | null }[]
  }

describe('the product page', () => {
  it('says how a download’s link works, a service’s length and place, and when a gift card expires', async () => {
    const page = async (slug: string) => (await shop(`{ product(slug: "${slug}") { productType inStock download { limit days } service { duration location } giftCard { expiryMonths } } }`)).data?.['product']
    expect(await page('pattern-pack')).toEqual({ productType: 'digital', inStock: true, download: { limit: 3, days: 7 }, service: null, giftCard: null })
    expect(await page('block-printing-class')).toEqual({ productType: 'service', inStock: true, download: null, service: { duration: '2 hours', location: 'Our Jaipur studio' }, giftCard: null })
    expect(await page('gift-card')).toEqual({ productType: 'gift_card', inStock: true, download: null, service: null, giftCard: { expiryMonths: 12 } })
    expect(await page('kurta')).toMatchObject({ productType: 'physical', download: null, service: null, giftCard: null })
  })

  it('counts a key pool’s keys as its stock: sold out with none left, and never more in a cart than are left', async () => {
    const versions = async () => ((await shop('{ product(slug: "font-licence") { inStock versions { available inStock } } }')).data?.['product'] as { inStock: boolean; versions: { available: number }[] })
    expect(await versions()).toEqual({ inStock: true, versions: [{ available: 2, inStock: true }] })
    const { token } = await add(v.keys, 3)
    expect((await cart(token)).lines).toEqual([{ problem: 'short', available: 2 }])
    await db.sql`delete from licence_key where product_id = ${keysProduct}`
    expect(await versions()).toEqual({ inStock: false, versions: [{ available: 0, inStock: false }] })
    await db.sql`insert into licence_key (store_id, product_id, key) values (${store}, ${keysProduct}, 'K-1'), (${store}, ${keysProduct}, 'K-2')`
  })
})

describe('a cart with nothing to send', () => {
  it('asks no address or delivery, and is placed with no shipping', async () => {
    const { token, needsShipping } = await add(v.pack, 1)
    expect(needsShipping).toBe(false)
    await add(v.lesson, 2, token)
    await shop('mutation { setCartContact(email: "meera@example.com") { cart { id } } }', token)
    const before = await cart(token)
    expect(before).toMatchObject({ needsShipping: false, shippingOption: null, shipping: null, problems: [] })
    expect((await shop('mutation { checkout { readyToPay } }', token)).data?.['checkout']).toEqual({ readyToPay: true })
    const placed = (await shop('mutation { placeOrder(provider: "cod") { orderId total { amount } } }', token)).data?.['placeOrder'] as { orderId: string; total: { amount: string } }
    expect(placed.total.amount).toBe(String(90000 * 3))
    expect(await db.sql`select shipping_option, shipping_amount::int as shipping from "order" where id = ${placed.orderId}`).toEqual([{ shipping_option: null, shipping: 0 }])
    expect(await db.sql`select kind from order_adjustment where order_id = ${placed.orderId} and kind = 'shipping'`).toEqual([])
  })

  it('asks for both again once a physical item joins it, and forgets a delivery choice when it leaves', async () => {
    const { token } = await add(v.pack, 1)
    expect((await add(v.kurta, 1, token)).needsShipping).toBe(true)
    await shop('mutation { setCartContact(email: "meera@example.com") { cart { id } } }', token)
    expect((await cart(token)).problems).toEqual(['NO_ADDRESS', 'NO_SHIPPING', 'TAX_UNAVAILABLE'])
    await shop('mutation { setShippingAddress(address: { name: "Meera", line1: "4 MI Road", city: "Jaipur", region: "Rajasthan", postalCode: "302001", country: "IN" }) { cart { id } } }', token)
    await shop('mutation { setShippingOption(option: "flat") { cart { id } } }', token)
    expect(await cart(token)).toMatchObject({ needsShipping: true, shippingOption: 'flat', shipping: { amount: '5000' }, problems: [] })
    await shop(`mutation { setCartQuantity(versionId: "${v.kurta}", quantity: 0) { cart { id } } }`, token)
    expect(await cart(token)).toMatchObject({ needsShipping: false, shippingOption: null, shipping: null, problems: [] })
  })
})

describe('a gift card', () => {
  it('carries no tax of its own: what a cart owes in tax is the kurta’s alone (CatEditor)', async () => {
    const taxOf = async (...versions: string[]) => {
      let token: string | null = null
      for (const id of versions) token = (await add(id, 1, token)).token
      await shop('mutation { setShippingAddress(address: { name: "Meera", line1: "4 MI Road", city: "Jaipur", region: "Rajasthan", postalCode: "302001", country: "IN" }) { cart { id } } }', token)
      return (await cart(token ?? '')).tax?.amount.amount
    }
    const kurta = await taxOf(v.kurta)
    expect(Number(kurta)).toBeGreaterThan(0)
    expect(await taxOf(v.card)).toBe('0')
    expect(await taxOf(v.kurta, v.card)).toBe(kurta)
  })
})
