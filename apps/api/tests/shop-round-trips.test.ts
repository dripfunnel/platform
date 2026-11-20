import { graphql, type GraphQLSchema } from 'graphql'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { resolveShopper } from '#auth/shopCaller'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #1590: every statement is a round trip to the database, so each cart and checkout call is held to a ceiling
// (ARCHITECTURE.md §6), and the reads it now shares or sends together still see only their own store.

let db: TestDatabase
let t: Tenants
const stores = { jaipur: '', surat: '' }
const hostOf = { jaipur: 'jaipur.shop.example', surat: 'surat.shop.example' }
const versions: string[] = []
const ids = { theirs: '', ebook: '', hidden: '', collection: '' }

const store = async (name: string, code: string) =>
  (await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status, address) values
    (${t.partnerA}, ${name}, ${code}, 'IN', 'INR', 'active', '{"street": "12 MI Road", "city": "Jaipur", "postal": "302001", "region": "Rajasthan"}') returning id`)[0]?.id ?? ''
const product = async (storeId: string, slug: string, o: { type?: string; tracked?: boolean } = {}) => {
  const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility, product_type) values (${storeId}, ${slug}, ${slug}, 'visible', ${o.type ?? 'physical'}) returning id`
  const [v] = await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position, weight_grams, track_stock) values (${storeId}, ${p?.id ?? ''}, ${slug}, 0, 400, ${o.tracked ?? true}) returning id`
  await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${v?.id ?? ''}, ${storeId}, 'INR', 105000)`
  await db.sql`insert into stock_level (version_id, warehouse_id, store_id, on_hand) select ${v?.id ?? ''}, w.id, ${storeId}, 50 from warehouse w where w.store_id = ${storeId} and w.is_default`
  return { productId: p?.id ?? '', versionId: v?.id ?? '' }
}
const shipping = (storeId: string, flat: number) => db.sql`insert into store_shipping (store_id, flat_enabled, flat_amount, pickup_enabled, pickup_hours, currency, area_mode, saved_at, revision)
    values (${storeId}, true, ${flat}, true, 'Mon–Sat, 10–6', 'INR', 'everywhere', now(), 1)
    on conflict (store_id) do update set flat_enabled = excluded.flat_enabled, flat_amount = excluded.flat_amount, pickup_enabled = excluded.pickup_enabled, pickup_hours = excluded.pickup_hours, currency = excluded.currency, area_mode = excluded.area_mode, saved_at = excluded.saved_at, revision = excluded.revision`
const offer = async (storeId: string, name: string, action: Record<string, unknown>, code: string | null) => {
  const [p] = await db.sql<{ id: string }[]>`insert into promotion (store_id, name, trigger, enabled, combines_with)
    values (${storeId}, ${name}, ${code ? 'code' : 'automatic'}, true, ${db.sql.json({ product: false, order: false, shipping: false })}) returning id`
  const { operation, ...args } = action
  await db.sql`insert into promotion_action (promotion_id, store_id, operation, args, position) values (${p?.id ?? ''}, ${storeId}, ${String(operation)}, ${db.sql.json(args as Record<string, string>)}, 0)`
  if (code) await db.sql`insert into promotion_code (promotion_id, store_id, batch_id, code, single_use) values (${p?.id ?? ''}, ${storeId}, null, ${code}, false)`
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  stores.jaipur = await store('Jaipur', 'jaipur')
  stores.surat = await store('Surat', 'surat')
  const kurta = await product(stores.jaipur, 'kurta')
  versions.push(kurta.versionId, (await product(stores.jaipur, 'dupatta')).versionId)
  ids.ebook = (await product(stores.jaipur, 'ebook', { type: 'digital', tracked: false })).versionId
  ids.hidden = (await product(stores.jaipur, 'hidden')).versionId
  await shipping(stores.jaipur, 4900)
  await db.sql`insert into payment_provider_account (store_id, provider, mode, status) values (${stores.jaipur}, 'cod', 'live', 'live') on conflict do nothing`
  await offer(stores.jaipur, 'Ten off', { operation: 'order_percentage_discount', percent: 10 }, 'TEN')
  ids.collection = (await db.sql<{ id: string }[]>`insert into collection (store_id, name, slug, kind) values (${stores.jaipur}, 'Kurtas', 'kurtas', 'manual') returning id`)[0]?.id ?? ''
  await db.sql`insert into collection_product (collection_id, product_id, store_id, position, source) values (${ids.collection}, ${kurta.productId}, ${stores.jaipur}, 0, 'manual')`
  await offer(stores.jaipur, 'Kurtas 20% off', { operation: 'products_percentage_discount', percent: 20, cap: null, targets: { productIds: [], collectionIds: [ids.collection], filterValueIds: [] }, exclude: { giftCards: false, onSale: false } }, 'KURTAS')
  // Another store of the same partner: its offers, codes, delivery and products must never reach a Jaipur cart.
  ids.theirs = (await product(stores.surat, 'saree')).versionId
  await shipping(stores.surat, 100)
  await offer(stores.surat, 'Half off everything', { operation: 'order_percentage_discount', percent: 50 }, null)
  await offer(stores.surat, 'Surat code', { operation: 'order_percentage_discount', percent: 30 }, 'SURAT30')
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const shop = async (source: string, token: string | null, sql: postgres.Sql = db.sql, host = hostOf.jaipur) => {
  const found = await resolveShopper(db.sql, new Request(`https://${host}/shop-api`, { headers: token ? { 'x-shop-cart': token } : {} }), host, 'shop.example')
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = { sql, shopper: found.shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.6', userAgent: null }, couriers: null, allowAttempt: async () => true, allowCodeAttempt: async () => true, allowNewCart: async () => true, now: () => new Date() }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, failed: (result.errors?.length ?? 0) > 0 }
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

const address = '{ name: "Asha", line1: "12 MG Road", city: "Pune", region: "Maharashtra", postalCode: "411001", country: "IN", phone: "+919800000000" }'
const add = async (versionId: string, token: string | null, host = hostOf.jaipur) =>
  (await shop(`mutation { addToCart(versionId: "${versionId}", quantity: 1) { cartToken } }`, token, db.sql, host)).data?.['addToCart'] as { cartToken: string | null } | null
const filled = async (code = 'TEN') => {
  const token = (await add(versions[0] ?? '', null))?.cartToken ?? ''
  await add(versions[1] ?? '', token)
  await shop('mutation { setCartContact(email: "asha@example.com") { cart { id } } }', token)
  await shop(`mutation { setShippingAddress(address: ${address}) { cart { id } } }`, token)
  await shop('mutation { setShippingOption(option: "flat") { cart { id } } }', token)
  await shop(`mutation { applyCode(code: "${code}") { cart { id } } }`, token)
  return token
}

const cartFields = 'id total { amount } discount { amount } shipping { amount } tax { amount { amount } } problems codes { code state } lines { versionId quantity lineTotal { amount } } shippingOptions { id amount { amount } }'
interface Cart { id: string; total: { amount: string }; discount: { amount: string }; shipping: { amount: string } | null; codes: { code: string; state: string }[]; lines: { versionId: string; quantity: number; lineTotal: { amount: string } | null }[]; shippingOptions: { id: string; amount: { amount: string } }[]; problems: string[] }
const cartOf = async (token: string) => (await shop(`{ cart { ${cartFields} } }`, token)).data?.['cart'] as Cart

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

  it('placeOrder (cash on delivery): at most 52', async () => {
    const token = await filled()
    await shop('mutation { checkout { id } }', token)
    const { statements, answer } = await counted('mutation { placeOrder(provider: "cod") { orderId number } }', token)
    expect(answer.code).toBeUndefined()
    expect(statements).toBeLessThanOrEqual(52)
  })
})

describe('what the shared and concurrent reads price', () => {
  it('prices the code, delivery and tax from this store alone, never another store’s offers or rates', async () => {
    const cart = await cartOf(await filled())
    expect(cart.codes).toEqual([{ code: 'TEN', state: 'APPLIED' }])
    // Ten percent of the two lines, not Surat's automatic half off.
    expect(cart.discount.amount).toBe('21000')
    expect(cart.shipping?.amount).toBe('4900')
    expect(cart.shippingOptions.find((o) => o.id === 'flat')?.amount.amount).toBe('4900')
  })

  it('answers another store’s code as invalid, and refuses another store’s product', async () => {
    const token = await filled('SURAT30')
    const cart = await cartOf(token)
    expect(cart.codes).toEqual([])
    expect(cart.discount.amount).toBe('0')
    expect((await shop(`mutation { applyCode(code: "SURAT30") { state } }`, token)).data?.['applyCode']).toEqual({ state: 'INVALID' })
    expect((await shop(`mutation { addToCart(versionId: "${ids.theirs}", quantity: 1) { cartToken } }`, token)).code).toBe('UNAVAILABLE')
  })

  it('applies an offer on this store’s collection (its targets read in system scope by store)', async () => {
    const cart = await cartOf(await filled('KURTAS'))
    expect(cart.codes).toEqual([{ code: 'KURTAS', state: 'APPLIED' }])
    expect(cart.discount.amount).toBe('21000')
  })

  it('a Surat cart gets Surat’s offer and delivery, never Jaipur’s', async () => {
    const token = (await add(ids.theirs, null, hostOf.surat))?.cartToken ?? ''
    await shop(`mutation { setShippingAddress(address: ${address}) { cart { id } } }`, token, db.sql, hostOf.surat)
    const cart = (await shop(`{ cart { ${cartFields} } }`, token, db.sql, hostOf.surat)).data?.['cart'] as Cart
    expect(cart.discount.amount).toBe('52500')
    expect(cart.shippingOptions.find((o) => o.id === 'flat')?.amount.amount).toBe('100')
  })

  it('quotes delivery for the physical lines alone, beside a digital line and one shoppers can no longer buy', async () => {
    const token = await filled()
    await add(ids.ebook, token)
    await add(ids.hidden, token)
    await db.sql`update product set visibility = 'hidden' where id = (select product_id from product_version where id = ${ids.hidden})`
    try {
      const cart = await cartOf(token)
      expect(cart.lines.map((l) => [l.versionId, l.lineTotal?.amount ?? null])).toEqual([
        [versions[0], '105000'],
        [versions[1], '105000'],
        [ids.ebook, '105000'],
        [ids.hidden, null],
      ])
      expect(cart.shippingOptions.map((o) => o.id).sort()).toEqual(['flat', 'pickup'])
      expect(cart.shipping?.amount).toBe('4900')
    } finally {
      await db.sql`update product set visibility = 'visible' where id = (select product_id from product_version where id = ${ids.hidden})`
    }
  })

  it('applies two changes sent at once from two tabs, one after the other', async () => {
    const token = await filled()
    const [quantity, contact] = await Promise.all([
      shop(`mutation { setCartQuantity(versionId: "${versions[0] ?? ''}", quantity: 3) { cart { id } } }`, token),
      shop('mutation { setCartContact(email: "ravi@example.com") { cart { id } } }', token),
    ])
    expect([quantity.code, contact.code]).toEqual([undefined, undefined])
    const cart = await cartOf(token)
    expect(cart.lines.find((l) => l.versionId === versions[0])?.quantity).toBe(3)
    expect((await db.sql<{ email: string }[]>`select email from "order" where id = ${cart.id}`)[0]?.email).toBe('ravi@example.com')
  })
})

describe('placing writes the order in one transaction', () => {
  it('writes every line and adjustment of the snapshot', async () => {
    const token = await filled()
    await shop('mutation { checkout { id } }', token)
    const placed = (await shop('mutation { placeOrder(provider: "cod") { orderId total { amount } } }', token)).data?.['placeOrder'] as { orderId: string; total: { amount: string } }
    const lines = await db.sql<{ version_id: string; quantity: number; position: number }[]>`select version_id, quantity, position from order_line where order_id = ${placed.orderId} order by position`
    expect(lines).toEqual([{ version_id: versions[0], quantity: 1, position: 0 }, { version_id: versions[1], quantity: 1, position: 1 }])
    const adjustments = await db.sql<{ kind: string; amount: string }[]>`select kind, amount::text as amount from order_adjustment where order_id = ${placed.orderId} and kind <> 'tax' order by kind`
    expect(adjustments).toEqual([{ kind: 'discount', amount: '21000' }, { kind: 'shipping', amount: '4900' }])
    expect(await db.sql`select state, total_amount::text as total from "order" where id = ${placed.orderId}`).toEqual([{ state: 'placed', total: placed.total.amount }])
  })

  it('rolls everything back when one of the snapshot’s rows fails, leaving the cart as it was', async () => {
    const token = await filled()
    await shop('mutation { checkout { id } }', token)
    const cart = await cartOf(token)
    const reserved = async () => (await db.sql<{ reserved: number }[]>`select sum(reserved)::int as reserved from stock_level where version_id in (${versions[0] ?? ''}, ${versions[1] ?? ''})`)[0]?.reserved
    const before = await reserved()
    await db.sql`alter table order_adjustment add constraint rt_1590_fail check (kind <> 'shipping') not valid`
    try {
      expect((await shop('mutation { placeOrder(provider: "cod") { orderId } }', token)).failed).toBe(true)
    } finally {
      await db.sql`alter table order_adjustment drop constraint rt_1590_fail`
    }
    expect(await db.sql`select state, number from "order" where id = ${cart.id}`).toEqual([{ state: 'cart', number: null }])
    expect(await db.sql`select id from order_line where order_id = ${cart.id}`).toEqual([])
    expect(await db.sql`select id from order_adjustment where order_id = ${cart.id}`).toEqual([])
    expect(await db.sql`select id from promotion_usage where order_id = ${cart.id}`).toEqual([])
    expect(await reserved()).toBe(before)
    // The cart still places once nothing fails.
    expect((await shop('mutation { placeOrder(provider: "cod") { orderId } }', token)).data?.['placeOrder']).toEqual({ orderId: cart.id })
  })
})
