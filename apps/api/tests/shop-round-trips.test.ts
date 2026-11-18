import { graphql, type GraphQLSchema } from 'graphql'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { resolveShopper } from '#auth/shopCaller'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #1590: every statement is a round trip to the database, so each cart and checkout call is held to a ceiling
// (ARCHITECTURE.md §6). The cart: two lines, an address, flat delivery, a code; cash on delivery is on.

let db: TestDatabase
let t: Tenants
let store = ''
const host = 'jaipur.shop.example'
const versions: string[] = []

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  store = (await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status, address) values
    (${t.partnerA}, 'Jaipur', 'jaipur', 'IN', 'INR', 'active', '{"street": "12 MI Road", "city": "Jaipur", "postal": "302001", "region": "Rajasthan"}') returning id`)[0]?.id ?? ''
  for (const slug of ['kurta', 'dupatta']) {
    const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${store}, ${slug}, ${slug}, 'visible') returning id`
    const [v] = await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position, weight_grams, track_stock) values (${store}, ${p?.id ?? ''}, ${slug}, 0, 400, true) returning id`
    await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${v?.id ?? ''}, ${store}, 'INR', 105000)`
    await db.sql`insert into stock_level (version_id, warehouse_id, store_id, on_hand) select ${v?.id ?? ''}, w.id, ${store}, 50 from warehouse w where w.store_id = ${store} and w.is_default`
    versions.push(v?.id ?? '')
  }
  await db.sql`insert into store_shipping (store_id, flat_enabled, flat_amount, pickup_enabled, pickup_hours, currency, area_mode, saved_at, revision)
    values (${store}, true, 4900, true, 'Mon–Sat, 10–6', 'INR', 'everywhere', now(), 1)
    on conflict (store_id) do update set flat_enabled = excluded.flat_enabled, flat_amount = excluded.flat_amount, pickup_enabled = excluded.pickup_enabled, pickup_hours = excluded.pickup_hours, currency = excluded.currency, area_mode = excluded.area_mode, saved_at = excluded.saved_at, revision = excluded.revision`
  await db.sql`insert into payment_provider_account (store_id, provider, mode, status) values (${store}, 'cod', 'live', 'live') on conflict do nothing`
  const [offer] = await db.sql<{ id: string }[]>`insert into promotion (store_id, name, trigger, enabled, combines_with)
    values (${store}, 'Ten off', 'code', true, ${db.sql.json({ product: false, order: false, shipping: false })}) returning id`
  await db.sql`insert into promotion_action (promotion_id, store_id, operation, args, position) values (${offer?.id ?? ''}, ${store}, 'order_percentage_discount', ${db.sql.json({ percent: 10 })}, 0)`
  await db.sql`insert into promotion_code (promotion_id, store_id, batch_id, code, single_use) values (${offer?.id ?? ''}, ${store}, null, 'TEN', false)`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const shop = async (source: string, token: string | null, sql: postgres.Sql = db.sql) => {
  const found = await resolveShopper(db.sql, new Request(`https://${host}/shop-api`, { headers: token ? { 'x-shop-cart': token } : {} }), host, 'shop.example')
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = { sql, shopper: found.shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.6', userAgent: null }, couriers: null, allowAttempt: async () => true, allowCodeAttempt: async () => true, allowNewCart: async () => true, now: () => new Date() }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

/** The statements one call makes, and its answer. */
const counted = async (source: string, token: string) => {
  let statements = 0
  const sql = postgres(db.url, { max: 1, fetch_types: false, debug: () => (statements += 1) })
  try {
    const answer = await shop(source, token, sql)
    return { statements, answer }
  } finally {
    await sql.end()
  }
}

const address = '{ name: "Asha", line1: "12 MG Road", city: "Pune", region: "Maharashtra", postalCode: "411001", country: "IN" }'
const filled = async () => {
  const token = ((await shop(`mutation { addToCart(versionId: "${versions[0] ?? ''}", quantity: 1) { cartToken } }`, null)).data?.['addToCart'] as { cartToken: string }).cartToken
  await shop(`mutation { addToCart(versionId: "${versions[1] ?? ''}", quantity: 1) { cartToken } }`, token)
  await shop('mutation { setCartContact(email: "asha@example.com") { cart { id } } }', token)
  await shop(`mutation { setShippingAddress(address: ${address}) { cart { id } } }`, token)
  await shop('mutation { setShippingOption(option: "flat") { cart { id } } }', token)
  await shop('mutation { applyCode(code: "TEN") { cart { id } } }', token)
  return token
}

const cartFields = 'id total { amount } discount { amount } shipping { amount } tax { amount { amount } } problems'
// Before #1590: cart 31, paymentOptions 4, setCartContact 35, setShippingAddress 39, setShippingOption 39, setCartQuantity 36.
const calls: [string, (token: string) => string, number][] = [
  ['cart', () => `{ cart { ${cartFields} } }`, 22],
  ['paymentOptions', () => '{ paymentOptions { provider } }', 4],
  ['setCartContact', () => `mutation { setCartContact(email: "asha@example.com") { cart { ${cartFields} } } }`, 25],
  ['setShippingAddress', () => `mutation { setShippingAddress(address: ${address}) { cart { ${cartFields} } } }`, 29],
  ['setShippingOption', () => `mutation { setShippingOption(option: "flat") { cart { ${cartFields} } } }`, 29],
  ['setCartQuantity', () => `mutation { setCartQuantity(versionId: "${versions[0] ?? ''}", quantity: 2) { cart { ${cartFields} } } }`, 26],
]

describe('the statements each cart and checkout call makes', () => {
  for (const [name, source, ceiling] of calls) {
    it(`${name}: at most ${ceiling}`, async () => {
      const token = await filled()
      const { statements, answer } = await counted(source(token), token)
      expect(answer.code).toBeUndefined()
      expect(statements).toBeLessThanOrEqual(ceiling)
    })
  }

  it('the cart is priced with its code', async () => {
    const token = await filled()
    expect(((await shop(`{ cart { ${cartFields} } }`, token)).data?.['cart'] as { discount: { amount: string } }).discount.amount).not.toBe('0')
  })

  // Before #1590: 65.
  it('placeOrder (cash on delivery): at most 52', async () => {
    const token = await filled()
    await shop('mutation { checkout { id } }', token)
    const { statements, answer } = await counted('mutation { placeOrder(provider: "cod") { orderId number } }', token)
    expect(answer.code).toBeUndefined()
    expect(statements).toBeLessThanOrEqual(52)
  })
})
