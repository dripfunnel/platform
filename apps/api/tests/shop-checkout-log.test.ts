import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { resolveShopper } from '#auth/shopCaller'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #876 (SH 17): a refused checkout call is one technical log line with its operation and reason, the request and the store,
// and nothing of the cart, the shopper or the amount (LOGGING §9).

let db: TestDatabase
let t: Tenants
let storeId = ''
let mug = ''
const host = 'lines.shop.example'

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  storeId = (await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status) values (${t.partnerA}, 'Lines', 'lines', 'US', 'USD', 'active') returning id`)[0]?.id ?? ''
  const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${storeId}, 'Mug', 'mug', 'visible') returning id`
  mug = (await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position, track_stock) values (${storeId}, ${p?.id ?? ''}, 'M1', 0, true) returning id`)[0]?.id ?? ''
  await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${mug}, ${storeId}, 'USD', 2000)`
  await db.sql`insert into stock_level (version_id, warehouse_id, store_id, on_hand) select ${mug}, w.id, ${storeId}, 5 from warehouse w where w.store_id = ${storeId} and w.is_default`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

afterEach(() => vi.restoreAllMocks())

const shop = async (source: string, cart: string | null = null) => {
  const found = await resolveShopper(db.sql, new Request(`https://${host}/shop-api`, { headers: cart ? { 'x-shop-cart': cart } : {} }), host, 'shop.example')
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = { sql: db.sql, shopper: found.shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'req-876', ip: '203.0.113.5', userAgent: null }, couriers: null, now: () => new Date(), allowNewCart: async () => true }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

/** The technical lines a call wrote, parsed. */
const linesOf = async (work: () => Promise<unknown>) => {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  let raw: string[]
  try {
    await work()
  } finally {
    // Read before restoring: a restored spy forgets its calls.
    raw = spy.mock.calls.map((call) => String(call[0]))
    spy.mockRestore()
  }
  return { raw, refused: raw.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line['event'] === 'checkout_refused') }
}

describe('a refused checkout call', () => {
  it('logs its operation and reason with the request and the store, and no other field', async () => {
    const { refused } = await linesOf(() => shop('mutation { placeOrder(provider: "cod") { orderId } }'))
    expect(refused).toHaveLength(1)
    expect(Object.keys(refused[0] ?? {}).sort()).toEqual(['api', 'code', 'event', 'requestId', 'storeId'])
    expect(refused[0]).toMatchObject({ event: 'checkout_refused', api: 'shop', requestId: 'req-876', storeId })
    expect(String(refused[0]?.['code'])).toMatch(/^placeOrder:[A-Z_]+$/)
  })

  it('logs the refusals that never reach the engine too: a method name past 40 characters, and an app payment that is not valid', async () => {
    const long = await linesOf(() => shop(`mutation { placeOrder(provider: "${'x'.repeat(41)}") { orderId } }`))
    expect(long.refused.map((line) => line['code'])).toEqual(['placeOrder:METHOD_UNAVAILABLE'])
    const invalid = await linesOf(() => shop('mutation { placeOrder(provider: "cod", app: { scheme: "https" }) { orderId } }'))
    expect(invalid.refused.map((line) => line['code'])).toEqual(['placeOrder:INVALID_APP_PAYMENT'])
    const retry = await linesOf(() => shop('mutation { payOrder(orderId: "00000000-0000-4000-8000-000000000001", app: { scheme: "https" }) { providerRef } }'))
    expect(retry.refused.map((line) => line['code'])).toEqual(['payOrder:INVALID_APP_PAYMENT'])
  })

  it('holds nothing of the cart, the shopper, the amount or the address, even when the cart has all of them', async () => {
    const token = ((await shop(`mutation { addToCart(versionId: "${mug}", quantity: 2) { cartToken } }`)).data?.['addToCart'] as { cartToken: string }).cartToken
    await shop('mutation { setCartContact(email: "sam@example.com") { cart { id } } }', token)
    await shop('mutation { setShippingAddress(address: { name: "Sam Rao", line1: "1 High St", city: "New York", region: "NY", postalCode: "10001", country: "US" }) { cart { id } } }', token)
    const { raw, refused } = await linesOf(() => shop('mutation { placeOrder(provider: "nope") { orderId } }', token))
    expect(refused).toHaveLength(1)
    const written = raw.join('\n')
    for (const secret of ['sam@example.com', 'Sam Rao', '1 High St', '10001', token, '4000', mug]) expect(written).not.toContain(secret)
  })

  it('logs nothing for a call that succeeds', async () => {
    const { refused } = await linesOf(() => shop('{ paymentOptions { provider } }'))
    expect(refused).toEqual([])
  })
})
