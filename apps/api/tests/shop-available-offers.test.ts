import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { resolveShopper } from '#auth/shopCaller'
import { hashSessionId, newSessionId } from '#auth/session'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants } from './support/fixtures'

// Card #1698: the cart lists the shared codes this cart qualifies for now (OFFERS-DESIGN fact 17), so a shopper can apply one
// without knowing it. "Who is it for?" is the merchant's control: the list is what the engine would apply to this shopper.

let db: TestDatabase
const host = 'jaipur.shop.example'
let store = ''
let other = ''
let kurta = ''
let session: string | null = null
let limiter: { allow: boolean; keys: string[] } = { allow: true, keys: [] }

const shop = async (source: string, cart: string | null = null) => {
  const headers: Record<string, string> = { ...(cart ? { 'x-shop-cart': cart } : {}), ...(session ? { 'x-shop-session': session } : {}) }
  const found = await resolveShopper(db.sql, new Request(`https://${host}/shop-api`, { headers }), host, 'shop.example')
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = {
    sql: db.sql, shopper: found.shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.5', userAgent: null }, couriers: null,
    allowAttempt: async () => true, allowNewCart: async () => true, allowCodeAttempt: async (key: string) => (limiter.keys.push(key), limiter.allow), now: () => new Date(),
  }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

type Listed = { name: string; code: string; saves: { amount: string } }
const listed = async (token: string) => ((await shop('{ cart { availableOffers { name code saves { amount } } } }', token)).data?.['cart'] as { availableOffers: Listed[] }).availableOffers
const names = async (token: string) => (await listed(token)).map((o) => o.name)
const add = async (quantity: number, token: string | null = null) => {
  const r = await shop(`mutation { addToCart(versionId: "${kurta}", quantity: ${quantity}) { cartToken } }`, token)
  return token ?? (r.data?.['addToCart'] as { cartToken: string }).cartToken
}
const percent = (n: number) => ({ operation: 'order_percentage_discount', percent: n })

const offer = async (o: { storeId?: string; name: string; code: string; action?: Record<string, unknown>; conditions?: Record<string, unknown>[]; singleUse?: boolean; enabled?: boolean; endsAt?: Date; replaced?: boolean; expiresAt?: Date; combines?: Record<string, boolean> }) => {
  const storeId = o.storeId ?? store
  const [p] = await db.sql<{ id: string }[]>`
    insert into promotion (store_id, name, trigger, enabled, ends_at, combines_with)
    values (${storeId}, ${o.name}, 'code', ${o.enabled ?? true}, ${o.endsAt ?? null}, ${db.sql.json(o.combines ?? { product: true, order: true, shipping: true })}) returning id`
  const id = p?.id ?? ''
  const { operation, ...args } = o.action ?? percent(10)
  await db.sql`insert into promotion_action (promotion_id, store_id, operation, args, position) values (${id}, ${storeId}, ${String(operation)}, ${db.sql.json(args as Record<string, string>)}, 0)`
  for (const [position, c] of (o.conditions ?? []).entries()) {
    const { operation: op, ...cargs } = c
    await db.sql`insert into promotion_condition (promotion_id, store_id, operation, args, position) values (${id}, ${storeId}, ${String(op)}, ${db.sql.json(cargs as Record<string, string>)}, ${position})`
  }
  const batch = o.singleUse ? ((await db.sql<{ id: string }[]>`insert into promotion_code_batch (promotion_id, store_id, prefix, length, count) values (${id}, ${storeId}, '', 8, 1) returning id`)[0]?.id ?? null) : null
  await db.sql`insert into promotion_code (promotion_id, store_id, batch_id, code, single_use, expires_at, replaced_at)
    values (${id}, ${storeId}, ${batch}, ${o.code}, ${o.singleUse ?? false}, ${o.expiresAt ?? null}, ${o.replaced ? new Date() : null})`
  return id
}
const clear = async () => db.sql`update promotion set enabled = false where store_id in (${store}, ${other})`

const signIn = async (email: string) => {
  const [c] = await db.sql<{ id: string }[]>`insert into customer (store_id, email, status, email_verified_at) values (${store}, ${email}, 'active', now()) returning id`
  const token = newSessionId()
  await db.sql`insert into customer_session (id_hash, store_id, customer_id, created_at, last_seen_at, expires_at) values (${await hashSessionId(token)}, ${store}, ${c?.id ?? ''}, now(), now(), now() + interval '1 day')`
  session = token
  return c?.id ?? ''
}

beforeAll(async () => {
  db = await createTestDatabase()
  const t = await seedTenants(db.sql)
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  const make = async (name: string, code: string) =>
    (await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status) values (${t.partnerA}, ${name}, ${code}, 'IN', 'INR', 'active') returning id`)[0]?.id ?? ''
  store = await make('Jaipur', 'jaipur')
  other = await make('Surat', 'surat')
  const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${store}, 'Kurta', 'kurta', 'visible') returning id`
  const [v] = await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position, track_stock) values (${store}, ${p?.id ?? ''}, 'Kurta', 0, true) returning id`
  kurta = v?.id ?? ''
  await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${kurta}, ${store}, 'INR', 100000)`
  await db.sql`insert into stock_level (version_id, warehouse_id, store_id, on_hand) select ${kurta}, w.id, ${store}, 100 from warehouse w where w.store_id = ${store} and w.is_default`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const apart = { product: false, order: false, shipping: false }

describe('the offers a cart can use now (card #1698)', () => {
  it('lists a code the cart qualifies for, with what it takes off this cart, and nothing else', async () => {
    await offer({ name: 'Summer 20% off', code: 'SUMMER20', action: percent(20) })
    await offer({ name: 'Big order', code: 'BIG500', action: { operation: 'order_fixed_discount', amounts: { INR: '50000' } }, conditions: [{ operation: 'minimum_order_amount', amounts: { INR: '200000' } }] })
    await offer({ name: 'Paused', code: 'PAUSED10', enabled: false })
    await offer({ name: 'Over', code: 'OVER10', endsAt: new Date('2026-01-01') })
    await offer({ name: 'Replaced', code: 'OLD10', replaced: true })
    await offer({ name: 'Code lapsed', code: 'LAPSED10', expiresAt: new Date('2026-01-01') })
    await offer({ name: 'Handed out', code: 'ONEOFF10', singleUse: true })
    const token = await add(1)
    expect(await listed(token)).toEqual([{ name: 'Summer 20% off', code: 'SUMMER20', saves: { amount: '20000' } }])
    await add(1, token)
    expect(await listed(token)).toEqual([
      { name: 'Summer 20% off', code: 'SUMMER20', saves: { amount: '40000' } },
      { name: 'Big order', code: 'BIG500', saves: { amount: '50000' } },
    ].sort((a, b) => Number(b.saves.amount) - Number(a.saves.amount)))
  })

  it('stops listing a code once it is on the cart', async () => {
    const token = await add(1)
    await shop('mutation { applyCode(code: "SUMMER20") { state } }', token)
    expect(await names(token)).toEqual([])
  })

  it('lists a once-per-customer or first-order code only to a signed-in shopper it fits', async () => {
    await clear()
    await offer({ name: 'Welcome', code: 'WELCOME', conditions: [{ operation: 'first_order' }] })
    const guest = await add(1)
    expect(await names(guest)).toEqual([])
    await signIn('asha@example.com')
    try {
      expect(await names(await add(1))).toEqual(['Welcome'])
      await db.sql`insert into "order" (store_id, state, payment_state, currency, number, placed_at, subtotal_amount, shipping_amount, total_amount, payment_method, email, customer_id)
        select ${store}, 'placed', 'paid', 'INR', 'J-1', now(), 100000, 0, 100000, 'cod', 'asha@example.com', c.id from customer c where c.store_id = ${store} and c.email = 'asha@example.com'`
      expect(await names(await add(1))).toEqual([])
    } finally {
      session = null
    }
  })

  it('lists a customer-group or named-customer code only to the customers it is for', async () => {
    await clear()
    const [g] = await db.sql<{ id: string }[]>`insert into customer_group (store_id, name) values (${store}, 'VIP') returning id`
    const customerId = await signIn('vip@example.com')
    session = null
    await db.sql`insert into customer_group_member (store_id, group_id, customer_id) values (${store}, ${g?.id ?? ''}, ${customerId})`
    await offer({ name: 'VIP only', code: 'VIP15', conditions: [{ operation: 'customer_group', groupIds: [g?.id ?? ''] }] })
    await offer({ name: 'Named', code: 'NAMED5', conditions: [{ operation: 'specific_customers', customerIds: [customerId] }] })
    expect(await names(await add(1))).toEqual([])
    const stranger = await signIn('other@example.com')
    try {
      expect(await names(await add(1))).toEqual([])
    } finally {
      session = null
    }
    const member = newSessionId()
    await db.sql`insert into customer_session (id_hash, store_id, customer_id, created_at, last_seen_at, expires_at) values (${await hashSessionId(member)}, ${store}, ${customerId}, now(), now(), now() + interval '1 day')`
    session = member
    try {
      expect((await names(await add(1))).sort()).toEqual(['Named', 'VIP only'])
    } finally {
      session = null
    }
    expect(stranger).not.toBe(customerId)
  })

  it('never lists another store’s code, and lists at most five', async () => {
    await clear()
    await offer({ storeId: other, name: 'Surat 50%', code: 'SURAT50', action: percent(50) })
    for (const n of [1, 2, 3, 4, 5, 6, 7]) await offer({ name: `Offer ${n}`, code: `OFFER${n}`, action: percent(n) })
    const listing = await listed(await add(1))
    expect(listing).toHaveLength(5)
    expect(listing.map((o) => o.code)).toEqual(['OFFER7', 'OFFER6', 'OFFER5', 'OFFER4', 'OFFER3'])
  })

  it('never lists a cart reminder’s code', async () => {
    await clear()
    const [o] = await db.sql<{ id: string }[]>`
      insert into "order" (store_id, state, payment_state, currency, number, placed_at, subtotal_amount, shipping_amount, total_amount, payment_method, email)
      values (${store}, 'placed', 'paid', 'INR', 'J-R1', now(), 100000, 0, 100000, 'cod', 'asha@example.com') returning id`
    await offer({ name: 'Reminder 10%', code: 'REMIND10' })
    await db.sql`update promotion_code set order_id = ${o?.id ?? ''} where code = 'REMIND10' and store_id = ${store}`
    await offer({ name: 'Plain 5%', code: 'PLAIN5', action: percent(5) })
    expect(await names(await add(1))).toEqual(['Plain 5%'])
  })

  it('lists a code that doesn’t combine with a held one only when it beats it, and then for the difference', async () => {
    await clear()
    await offer({ name: 'Held 10%', code: 'HELD10', combines: apart })
    await offer({ name: 'Smaller 5%', code: 'SMALL5', action: percent(5), combines: apart })
    await offer({ name: 'Bigger 30%', code: 'BIG30', action: percent(30), combines: apart })
    const token = await add(1)
    await shop('mutation { applyCode(code: "HELD10") { state } }', token)
    expect(await listed(token)).toEqual([{ name: 'Bigger 30%', code: 'BIG30', saves: { amount: '20000' } }])
  })

  it('looks only at the store’s 50 newest shared codes', async () => {
    await clear()
    await offer({ name: 'Oldest and best', code: 'OLDEST90', action: percent(90) })
    for (let n = 1; n <= 50; n++) await offer({ name: `Filler ${n}`, code: `FILL${String(n).padStart(2, '0')}`, action: percent(1) })
    const codes = (await listed(await add(1))).map((o) => o.code)
    expect(codes).toHaveLength(5)
    expect(codes).not.toContain('OLDEST90')
  }, 60_000)

  it('is asked on a limiter bucket of its own, and answers an empty list, not an error, once that is spent', async () => {
    await clear()
    await offer({ name: 'Limited 20% off', code: 'LIMIT20', action: percent(20) })
    const token = await add(1)
    limiter = { allow: true, keys: [] }
    expect(await names(token)).toEqual(['Limited 20% off'])
    expect(limiter.keys).toEqual([`shop-offers:${store}:203.0.113.5`])
    limiter = { allow: false, keys: [] }
    expect(await names(token)).toEqual([])
    limiter = { allow: true, keys: [] }
  })

  it('answers an empty list when the shopper has no cart lines to price', async () => {
    const token = await add(1)
    await shop(`mutation { setCartQuantity(versionId: "${kurta}", quantity: 0) { cart { id } } }`, token)
    expect(await listed(token)).toEqual([])
  })
})
