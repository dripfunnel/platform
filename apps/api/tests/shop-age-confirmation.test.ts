import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { resolveShopper } from '#auth/shopCaller'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #1443: a cart holding a product that asks shoppers to confirm their age is ordered only with the confirmation, checked on
// the server (CATALOG-DESIGN §3 fact 43); a cart without one is untouched.

let db: TestDatabase
let t: Tenants
const host = 'kesari.shop.example'
const v = { plain: '', adults: '' }
let storeId = ''

const product = async (slug: string, ageRestricted: boolean) => {
  const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility, product_type) values (${storeId}, ${slug}, ${slug}, 'visible', 'service') returning id`
  await db.sql`update product set service_duration = '2 hours' where id = ${p?.id ?? ''}`
  if (ageRestricted) await db.sql`insert into product_flag (product_id, store_id, age_restricted, hazardous) values (${p?.id ?? ''}, ${storeId}, true, false)`
  const id = (await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, position, track_stock) values (${storeId}, ${p?.id ?? ''}, 0, false) returning id`)[0]?.id ?? ''
  await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${id}, ${storeId}, 'INR', 90000)`
  return id
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  storeId = (await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status, time_zone) values (${t.partnerA}, 'Kesari', 'kesari', 'IN', 'INR', 'active', 'Asia/Kolkata') returning id`)[0]?.id ?? ''
  v.plain = await product('plain-pack', false)
  v.adults = await product('adults-pack', true)
  await db.sql`insert into payment_provider_account (store_id, provider, status, bank_details) values (${storeId}, 'bank_transfer', 'live', 'HDFC 1')`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const shop = async (source: string, cart: string | null = null) => {
  const found = await resolveShopper(db.sql, new Request(`https://${host}/shop-api`, { headers: cart ? { 'x-shop-cart': cart } : {} }), host, 'shop.example')
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = { sql: db.sql, shopper: found.shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.5', userAgent: null }, couriers: null, allowAttempt: async () => true, allowNewCart: async () => true, now: () => new Date() }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

/** A guest's cart of these versions, ready to pay by bank transfer. */
const readyCart = async (versions: string[]) => {
  let token: string | null = null
  for (const id of versions) {
    const result = await shop(`mutation { addToCart(versionId: "${id}", quantity: 1) { cartToken } }`, token)
    token = (result.data?.['addToCart'] as { cartToken: string | null } | undefined)?.cartToken ?? token
  }
  await shop('mutation { setCartContact(email: "asha@example.com") { cart { id } } }', token)
  await shop('mutation { checkout { readyToPay } }', token)
  return token ?? ''
}
const place = (token: string, args = '') => shop(`mutation { placeOrder(provider: "bank_transfer"${args}) { orderId } }`, token)
const confirmedAt = async (orderId: string) => (await db.sql<{ age_confirmed_at: Date | null }[]>`select age_confirmed_at from "order" where id = ${orderId}`)[0]?.age_confirmed_at ?? null

describe('an order with an age-restricted product', () => {
  it('says the cart needs the confirmation, and a cart without such a product does not', async () => {
    const adults = await readyCart([v.adults])
    const plain = await readyCart([v.plain])
    expect((await shop('{ cart { needsAgeConfirmation } }', adults)).data?.['cart']).toEqual({ needsAgeConfirmation: true })
    expect((await shop('{ cart { needsAgeConfirmation } }', plain)).data?.['cart']).toEqual({ needsAgeConfirmation: false })
  })

  it('is refused without the confirmation, and with it explicitly false, leaving the cart to order', async () => {
    const token = await readyCart([v.adults])
    expect((await place(token)).code).toBe('AGE_CONFIRMATION_REQUIRED')
    expect((await place(token, ', ageConfirmed: false')).code).toBe('AGE_CONFIRMATION_REQUIRED')
    expect(await db.sql`select 1 from "order" where store_id = ${storeId} and state = 'placed' and age_confirmed_at is not null`).toHaveLength(0)
  })

  it('is refused when the restricted product is only one of several', async () => {
    expect((await place(await readyCart([v.plain, v.adults]))).code).toBe('AGE_CONFIRMATION_REQUIRED')
  })

  it('is placed with the confirmation, which the order records', async () => {
    const token = await readyCart([v.adults])
    const result = await place(token, ', ageConfirmed: true')
    expect(result.code).toBeUndefined()
    expect(await confirmedAt((result.data?.['placeOrder'] as { orderId: string }).orderId)).toBeInstanceOf(Date)
  })
})

describe('an order without one', () => {
  it('is placed as before, with or without the argument, recording no confirmation', async () => {
    const first = await place(await readyCart([v.plain]))
    expect(first.code).toBeUndefined()
    expect(await confirmedAt((first.data?.['placeOrder'] as { orderId: string }).orderId)).toBeNull()
    const second = await place(await readyCart([v.plain]), ', ageConfirmed: true')
    expect(second.code).toBeUndefined()
    expect(await confirmedAt((second.data?.['placeOrder'] as { orderId: string }).orderId)).toBeNull()
  })
})
