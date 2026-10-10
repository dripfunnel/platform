import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveShopper } from '#auth/shopCaller'
import { resolveStoreStanding, storeHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import { claimUse } from '#db/scoped/promotions'
import { hashSessionId, newSessionId } from '#auth/session'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #320 (SAPI 14), part 4: offers in the cart and at placement (OFFERS-DESIGN §3 facts 4–8, 13–16; FIRST-RELEASE §19
// Shop API `applyCode`): priced by the engine on every read, each use counted when the order is placed, under concurrency,
// and given back by a cancellation before fulfilment.

let db: TestDatabase
let t: Tenants
const host = 'jaipur.shops.acme.example'
let store = ''
let other = ''
let kurta = ''
let scarf = ''
let owner = ''
let attempts: { allow: boolean; keys: string[] } = { allow: true, keys: [] }
/** The signed-in shopper's session the next calls present (X-Shop-Session); null for a guest. */
let session: string | null = null

const shop = async (source: string, cart: string | null = null, o: { noLimiter?: boolean; on?: string } = {}) => {
  const on = o.on ?? host
  const headers: Record<string, string> = { ...(cart ? { 'x-shop-cart': cart } : {}), ...(session ? { 'x-shop-session': session } : {}) }
  const found = await resolveShopper(db.sql, new Request(`https://${on}/shop-api`, { headers }), on)
  if (found.kind !== 'found') throw new Error('no store')
  const allowCodeAttempt = async (key: string) => {
    attempts.keys.push(key)
    return attempts.allow
  }
  const contextValue: ShopContext = {
    sql: db.sql, shopper: found.shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.5', userAgent: null }, couriers: null,
    allowAttempt: async () => true, allowNewCart: async () => true, ...(o.noLimiter ? {} : { allowCodeAttempt }), now: () => new Date(),
  }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
const merchant = async (source: string) => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers = { cookie: `${storeCookieName}=${owner}`, [storeHeader]: store }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, new Date(), activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, now: () => new Date() }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

/** An offer as the editor saves it (migration 0076), on unless told otherwise. */
const offer = async (o: { storeId?: string; name: string; action: Record<string, unknown>; conditions?: Record<string, unknown>[]; code?: string; singleUse?: boolean; combines?: Record<string, boolean>; limit?: number; perCustomer?: number; enabled?: boolean; endsAt?: Date }) => {
  const storeId = o.storeId ?? store
  const [p] = await db.sql<{ id: string }[]>`
    insert into promotion (store_id, name, trigger, enabled, ends_at, total_uses_limit, per_customer_limit, combines_with)
    values (${storeId}, ${o.name}, ${o.code ? 'code' : 'automatic'}, ${o.enabled ?? true}, ${o.endsAt ?? null}, ${o.limit ?? null}, ${o.perCustomer ?? null},
      ${db.sql.json(o.combines ?? { product: false, order: false, shipping: false })}) returning id`
  const id = p?.id ?? ''
  const { operation, ...args } = o.action
  await db.sql`insert into promotion_action (promotion_id, store_id, operation, args, position) values (${id}, ${storeId}, ${String(operation)}, ${db.sql.json(args as Record<string, string>)}, 0)`
  for (const [position, c] of (o.conditions ?? []).entries()) {
    const { operation: op, ...cargs } = c
    await db.sql`insert into promotion_condition (promotion_id, store_id, operation, args, position) values (${id}, ${storeId}, ${String(op)}, ${db.sql.json(cargs as Record<string, string>)}, ${position})`
  }
  if (o.code) {
    const batch = o.singleUse ? (await db.sql<{ id: string }[]>`insert into promotion_code_batch (promotion_id, store_id, prefix, length, count) values (${id}, ${storeId}, '', 8, 1) returning id`)[0]?.id ?? null : null
    await db.sql`insert into promotion_code (promotion_id, store_id, batch_id, code, single_use) values (${id}, ${storeId}, ${batch}, ${o.code}, ${o.singleUse ?? false})`
  }
  return id
}
const off = async () => db.sql`update promotion set enabled = false where store_id = ${store}`
/** Signs a shopper in on this store with their proven email (as a code by email does, ACCESS §2.1), for the calls that follow. */
const signIn = async (email: string, proven = true) => {
  // A guest who bought before has a row already (#312): signing in by the emailed code proves it theirs.
  await db.sql`update customer set status = 'active', email_verified_at = ${proven ? new Date() : null} where store_id = ${store} and email = ${email}`
  const [c] = await db.sql<{ id: string }[]>`
    insert into customer (store_id, email, status, email_verified_at) values (${store}, ${email}, 'active', ${proven ? new Date() : null})
    on conflict do nothing returning id`
  const id = c?.id ?? (await db.sql<{ id: string }[]>`select id from customer where store_id = ${store} and email = ${email}`)[0]?.id ?? ''
  const token = newSessionId()
  await db.sql`insert into customer_session (id_hash, store_id, customer_id, created_at, last_seen_at, expires_at) values (${await hashSessionId(token)}, ${store}, ${id}, now(), now(), now() + interval '1 day')`
  session = token
}

type Cart = { subtotal: { amount: string }; discount: { amount: string }; shipping: { amount: string } | null; shippingDiscount: { amount: string } | null; total: { amount: string }; discounts: { name: string; code: string | null; amount: { amount: string } }[]; codes: { code: string; state: string }[]; lines: { discount: { amount: string } | null; lineTotal: { amount: string } }[] }
const cartFields = 'subtotal { amount } discount { amount } shipping { amount } shippingDiscount { amount } total { amount } discounts { name code amount { amount } } codes { code state } lines { discount { amount } lineTotal { amount } }'
const cartOf = async (token: string) => (await shop(`{ cart { ${cartFields} } }`, token)).data?.['cart'] as Cart
const add = async (versionId: string, quantity: number, token: string | null = null) => {
  const r = await shop(`mutation { addToCart(versionId: "${versionId}", quantity: ${quantity}) { cartToken } }`, token)
  return token ?? ((r.data?.['addToCart'] as { cartToken: string }).cartToken)
}
const apply = async (token: string, code: string) => {
  const r = await shop(`mutation { applyCode(code: "${code}") { state cart { ${cartFields} } } }`, token)
  const answer = r.data?.['applyCode'] as { state: string; cart: Cart } | null | undefined
  return { state: answer?.state ?? '', cart: answer?.cart ?? ({ codes: [], discounts: [], discount: { amount: '' } } as unknown as Cart), code: r.code }
}
/** A guest's cart of kurtas, delivered at the flat rate and ready to pay. */
const ready = async (quantity: number, o: { email?: string | null; phone?: string; code?: string } = {}) => {
  const token = await add(kurta, quantity)
  if (o.code) await apply(token, o.code)
  const contact = [o.email === null ? '' : `email: "${o.email ?? 'asha@example.com'}"`, o.phone ? `phone: "${o.phone}"` : ''].filter(Boolean).join(', ')
  await shop(`mutation { setCartContact(${contact}) { cart { id } } }`, token)
  await shop('mutation { setShippingAddress(address: { name: "Asha", line1: "12 MG Road", city: "Pune", region: "Maharashtra", postalCode: "411001", country: "IN" }) { cart { id } } }', token)
  await shop('mutation { setShippingOption(option: "flat") { cart { id } } }', token)
  await shop('mutation { checkout { id } }', token)
  return token
}
const place = (token: string) => shop('mutation { placeOrder(provider: "cod") { orderId number total { amount } } }', token)

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'shops', '*.shops.acme.example', 'live', 'CNAME', 'x'),
    (${t.partnerA}, 'preview', '*.preview.acme.example', 'live', 'CNAME', 'x')`
  const make = async (name: string, code: string) =>
    (await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status) values (${t.partnerA}, ${name}, ${code}, 'IN', 'INR', 'active') returning id`)[0]?.id ?? ''
  store = await make('Jaipur', 'jaipur')
  other = await make('Surat', 'surat')
  const product = async (name: string, price: number) => {
    const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${store}, ${name}, ${name.toLowerCase()}, 'visible') returning id`
    const [v] = await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position, track_stock) values (${store}, ${p?.id ?? ''}, ${name}, 0, true) returning id`
    await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${v?.id ?? ''}, ${store}, 'INR', ${price})`
    await db.sql`insert into stock_level (version_id, warehouse_id, store_id, on_hand) select ${v?.id ?? ''}, w.id, ${store}, 100 from warehouse w where w.store_id = ${store} and w.is_default`
    return { product: p?.id ?? '', version: v?.id ?? '' }
  }
  kurta = (await product('Kurta', 100000)).version
  const s = await product('Scarf', 20000)
  scarf = s.version
  await db.sql`insert into store_shipping (store_id, flat_enabled, flat_amount, pickup_enabled, pickup_hours, currency, area_mode, saved_at, revision)
    values (${store}, true, 5000, true, 'Mon–Sat', 'INR', 'everywhere', now(), 1)`
  await db.sql`insert into payment_provider_account (store_id, provider, status) values (${store}, 'cod', 'live')`
  const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, 'owner@jaipur.example', 'Owner', 'active') returning id`
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${u?.id ?? ''}, ${store}, 'owner', 'active')`
  owner = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId: t.partnerA }, new Date()))
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('offers in the cart (OFFERS fact 16)', () => {
  it('applies an automatic offer on every read, spread over the lines, the total the engine’s', async () => {
    await off()
    await offer({ name: '10% off everything', action: { operation: 'order_percentage_discount', percent: 10 } })
    const token = await add(kurta, 1)
    await add(scarf, 2, token)
    const cart = await cartOf(token)
    expect([cart.subtotal.amount, cart.discount.amount, cart.total.amount]).toEqual(['140000', '14000', '126000'])
    expect(cart.discounts).toEqual([{ name: '10% off everything', code: null, amount: { amount: '14000' } }])
    expect(cart.lines.map((l) => l.discount?.amount)).toEqual(['10000', '4000'])
  })

  it('stops applying once the merchant turns it off, the next time the cart is priced', async () => {
    const token = await add(kurta, 1)
    expect((await cartOf(token)).discount.amount).toBe('10000')
    await off()
    expect((await cartOf(token)).discount.amount).toBe('0')
  })

  it('takes delivery off once one is chosen, and only over its minimum', async () => {
    await off()
    await offer({ name: 'Free delivery over ₹1,500', action: { operation: 'free_shipping' }, conditions: [{ operation: 'minimum_order_amount', amounts: { INR: '150000' } }] })
    const small = await ready(1)
    expect([(await cartOf(small)).shippingDiscount?.amount, (await cartOf(small)).total.amount]).toEqual(['0', '105000'])
    const big = await ready(2)
    const cart = await cartOf(big)
    expect([cart.shipping?.amount, cart.shippingDiscount?.amount, cart.total.amount]).toEqual(['5000', '5000', '200000'])
  })
})

describe('codes (OFFERS fact 6, O3)', () => {
  it('matches a code whatever its case and says what each one does', async () => {
    await off()
    await offer({ name: 'Summer 20% off', code: 'SUMMER20', action: { operation: 'order_percentage_discount', percent: 20 } })
    await offer({ name: 'Over', code: 'OVER10', endsAt: new Date('2026-01-01'), action: { operation: 'order_percentage_discount', percent: 10 } })
    await offer({ name: 'Gone', code: 'GONE10', limit: 1, action: { operation: 'order_percentage_discount', percent: 10 } })
    await db.sql`update promotion set uses_count = 1 where name = 'Gone'`
    await offer({ name: 'Paused', code: 'PAUSED10', enabled: false, action: { operation: 'order_percentage_discount', percent: 10 } })
    await offer({ storeId: other, name: 'Theirs', code: 'THEIRS10', action: { operation: 'order_percentage_discount', percent: 10 } })
    const token = await add(kurta, 1)
    const applied = await apply(token, ' summer20 ')
    expect([applied.state, applied.cart.discount.amount, applied.cart.codes]).toEqual(['APPLIED', '20000', [{ code: 'SUMMER20', state: 'APPLIED' }]])
    for (const [code, state] of [['OVER10', 'EXPIRED'], ['GONE10', 'USED_UP'], ['PAUSED10', 'INVALID'], ['THEIRS10', 'INVALID'], ['NOSUCH10', 'INVALID'], ['no such', 'INVALID']]) {
      const r = await apply(token, code ?? '')
      // A code that can't work comes straight back off the cart.
      expect({ code, state: r.state, held: r.cart.codes.map((c) => c.code) }).toEqual({ code, state, held: ['SUMMER20'] })
    }
    const removed = (await shop(`mutation { removeCode(code: "summer20") { cart { codes { code } discount { amount } } } }`, token)).data?.['removeCode'] as { cart: { codes: unknown[]; discount: { amount: string } } }
    expect(removed.cart).toEqual({ codes: [], discount: { amount: '0' } })
  })

  it('keeps a code whose conditions the cart doesn’t meet yet, and applies it once it does', async () => {
    await offer({ name: 'Big order', code: 'BIG500', action: { operation: 'order_fixed_discount', amounts: { INR: '50000' } }, conditions: [{ operation: 'minimum_order_amount', amounts: { INR: '200000' } }] })
    const token = await add(kurta, 1)
    expect((await apply(token, 'BIG500')).state).toBe('NOT_ELIGIBLE')
    await add(kurta, 1, token)
    expect((await cartOf(token)).codes).toEqual([{ code: 'BIG500', state: 'APPLIED' }])
  })

  it('takes the bigger of two offers that don’t combine, and says so for the code', async () => {
    await off()
    await offer({ name: 'Automatic 5%', action: { operation: 'order_percentage_discount', percent: 5 } })
    await db.sql`update promotion set enabled = true where name = 'Summer 20% off'`
    const token = await add(kurta, 1)
    expect((await apply(token, 'SUMMER20')).cart.discounts.map((d) => d.name)).toEqual(['Summer 20% off'])
    await db.sql`update promotion set enabled = true, combines_with = '{"product": false, "order": false, "shipping": false}' where name = 'Big order'`
    await add(kurta, 1, token)
    // ₹500 off ₹2,000 beats 20% of it; the code that lost says it doesn't combine.
    const cart = (await apply(token, 'BIG500')).cart
    expect(cart.discounts.map((d) => d.name)).toEqual(['Big order'])
    expect(cart.codes).toEqual([{ code: 'SUMMER20', state: 'DOESNT_COMBINE' }, { code: 'BIG500', state: 'APPLIED' }])
  })

  it('is rate-limited per store and address, and refuses every code where no limiter is bound', async () => {
    const token = await add(kurta, 1)
    attempts = { allow: true, keys: [] }
    await apply(token, 'SUMMER20')
    expect(attempts.keys).toEqual([`shop-code:${store}:203.0.113.5`])
    attempts = { allow: false, keys: [] }
    expect((await apply(token, 'SUMMER20')).code).toBe('RATE_LIMITED')
    attempts = { allow: true, keys: [] }
    expect((await shop('mutation { applyCode(code: "SUMMER20") { state } }', token, { noLimiter: true })).code).toBe('RATE_LIMITED')
  })
})

describe('placing an order with an offer (OFFERS fact 8, 13)', () => {
  let order = ''
  let token = ''
  let placeOffer = ''
  it('snapshots the discount on its lines and as a line naming the offer, and counts the use', async () => {
    await off()
    const id = await offer({ name: 'Summer 20% off', code: 'PLACE20', action: { operation: 'order_percentage_discount', percent: 20 } })
    placeOffer = id
    token = await ready(1, { code: 'PLACE20' })
    const placed = (await place(token)).data?.['placeOrder'] as { orderId: string; total: { amount: string } }
    order = placed.orderId
    expect(placed.total.amount).toBe('85000')
    expect(await db.sql`select discount_amount::text as d, subtotal_amount::text as s, total_amount::text as t from "order" where id = ${order}`).toEqual([{ d: '20000', s: '100000', t: '85000' }])
    expect(await db.sql`select unit_amount::text as u, discount_amount::text as d, line_total_amount::text as l from order_line where order_id = ${order}`).toEqual([{ u: '100000', d: '20000', l: '80000' }])
    expect(await db.sql`select label, amount::text as amount, promotion_id from order_adjustment where order_id = ${order} and kind = 'discount'`).toEqual([{ label: 'Summer 20% off', amount: '20000', promotion_id: id }])
    expect(await db.sql`select uses_count from promotion where id = ${id}`).toEqual([{ uses_count: 1 }])
    expect(await db.sql`select customer_email, discount_amount::text as d from promotion_usage where order_id = ${order}`).toEqual([{ customer_email: 'asha@example.com', d: '20000' }])
    const seen = (await shop(`{ order(id: "${order}") { discount { amount } discounts { name amount { amount } } total { amount } } }`, token)).data?.['order']
    expect(seen).toEqual({ discount: { amount: '20000' }, discounts: [{ name: 'Summer 20% off', amount: { amount: '20000' } }], total: { amount: '85000' } })
  })

  it('asks every guest to sign in for a once-per-customer offer, whatever email they type, and never refuses their order for it', async () => {
    await db.sql`update promotion set per_customer_limit = 1 where id = ${placeOffer}`
    // Asha used it as a guest; typing her email, a stranger's or only a number all answer the same.
    for (const contact of ['email: "ASHA@example.com"', 'email: "stranger@example.com"', 'phone: "+919800000009"']) {
      const cart = await add(kurta, 1)
      await shop(`mutation { setCartContact(${contact}) { cart { id } } }`, cart)
      expect({ contact, state: (await apply(cart, 'PLACE20')).state }).toEqual({ contact, state: 'SIGN_IN_REQUIRED' })
    }
    // A returning guest is never stranded: the code stays on, says why, and the order goes through without it, twice.
    for (let time = 0; time < 2; time += 1) {
      const again = await ready(1, { email: 'asha@example.com', code: 'PLACE20' })
      const cart = await cartOf(again)
      expect([cart.codes, cart.discount.amount]).toEqual([[{ code: 'PLACE20', state: 'SIGN_IN_REQUIRED' }], '0'])
      expect((await place(again)).data?.['placeOrder']).toMatchObject({ total: { amount: '105000' } })
    }
    expect(await db.sql`select uses_count from promotion where id = ${placeOffer}`).toEqual([{ uses_count: 1 }])
  })

  it('counts a signed-in shopper’s uses by account and proven email, and gives a use back when the order is cancelled', async () => {
    await signIn('asha@example.com')
    try {
      // Her guest order with this email counts, now that the email is proven hers.
      const before = await add(kurta, 1)
      expect((await apply(before, 'PLACE20')).state).toBe('ALREADY_USED')
      expect((await merchant(`mutation { cancelOrder(orderId: "${order}", reason: shopper) }`)).data?.['cancelOrder']).toBe(true)
      expect(await db.sql`select uses_count from promotion where id = ${placeOffer}`).toEqual([{ uses_count: 0 }])
      expect(await db.sql`select 1 from promotion_usage where order_id = ${order}`).toHaveLength(0)
      expect((await apply(before, 'PLACE20')).state).toBe('APPLIED')
      await shop('mutation { setCartContact(email: "asha@example.com") { cart { id } } }', before)
      await shop('mutation { setShippingAddress(address: { name: "Asha", line1: "12 MG Road", city: "Pune", region: "Maharashtra", postalCode: "411001", country: "IN" }) { cart { id } } }', before)
      await shop('mutation { setShippingOption(option: "flat") { cart { id } } }', before)
      await shop('mutation { checkout { id } }', before)
      expect((await place(before)).data?.['placeOrder']).toMatchObject({ total: { amount: '85000' } })
      expect(await db.sql`select uses_count from promotion where id = ${placeOffer}`).toEqual([{ uses_count: 1 }])
      const third = await add(kurta, 1)
      expect((await apply(third, 'PLACE20')).state).toBe('ALREADY_USED')
    } finally {
      session = null
    }
  })

  it('never lets an account inherit a guest’s history through an email it hasn’t proven', async () => {
    await off()
    await db.sql`update promotion set enabled = true where id = ${placeOffer}`
    const first = await offer({ name: 'First only', code: 'FIRSTONLY', action: { operation: 'order_percentage_discount', percent: 5 }, conditions: [{ operation: 'first_order' }], combines: { product: true, order: true, shipping: true } })
    await db.sql`update promotion set combines_with = '{"product": true, "order": true, "shipping": true}' where id = ${placeOffer}`
    const [o] = await db.sql<{ id: string }[]>`
      insert into "order" (store_id, state, payment_state, currency, number, placed_at, subtotal_amount, shipping_amount, total_amount, payment_method, email)
      values (${store}, 'placed', 'paid', 'INR', 'J-RAVI', now(), 100000, 0, 100000, 'cod', 'ravi@example.com') returning id`
    await db.sql`insert into promotion_usage (promotion_id, store_id, order_id, customer_email, discount_amount, currency) values (${placeOffer}, ${store}, ${o?.id ?? ''}, 'ravi@example.com', 20000, 'INR')`
    await signIn('ravi@example.com', false)
    try {
      // Signed in with an email nobody proved: Ravi's guest use and order don't count against this account, and say nothing.
      const cart = await add(kurta, 1)
      expect((await apply(cart, 'PLACE20')).state).toBe('APPLIED')
      expect((await apply(cart, 'FIRSTONLY')).cart.codes).toEqual([{ code: 'PLACE20', state: 'APPLIED' }, { code: 'FIRSTONLY', state: 'APPLIED' }])
      // Proven, they are his.
      await db.sql`update customer set email_verified_at = now() where store_id = ${store} and email = 'ravi@example.com'`
      expect((await cartOf(cart)).codes).toEqual([{ code: 'PLACE20', state: 'ALREADY_USED' }, { code: 'FIRSTONLY', state: 'NOT_ELIGIBLE' }])
    } finally {
      session = null
    }
    expect(first).not.toBe(placeOffer)
  })

  it('asks a guest to sign in for a first-order offer even inside an any-of', async () => {
    await off()
    await offer({ name: 'New or VIP', code: 'NEWORVIP', action: { operation: 'order_percentage_discount', percent: 5 }, conditions: [{ operation: 'any_of', conditions: [{ operation: 'first_order' }, { operation: 'customer_group', groupIds: [crypto.randomUUID()] }] }] })
    const cart = await add(kurta, 1)
    expect((await apply(cart, 'NEWORVIP')).state).toBe('SIGN_IN_REQUIRED')
  })

  it('takes a single-use code once, and gives it back with a cancelled order', async () => {
    await off()
    const id = await offer({ name: 'Insta 15%', code: 'INSTA-ONE', singleUse: true, action: { operation: 'order_percentage_discount', percent: 15 } })
    const first = await ready(1, { code: 'INSTA-ONE' })
    const placed = (await place(first)).data?.['placeOrder'] as { orderId: string }
    expect(await db.sql`select used_at is not null as used from promotion_code where promotion_id = ${id}`).toEqual([{ used: true }])
    const second = await add(kurta, 1)
    expect((await apply(second, 'insta-one')).state).toBe('USED_UP')
    await merchant(`mutation { cancelOrder(orderId: "${placed.orderId}", reason: store) }`)
    expect(await db.sql`select used_at from promotion_code where promotion_id = ${id}`).toEqual([{ used_at: null }])
    expect((await apply(second, 'INSTA-ONE')).state).toBe('APPLIED')
  })
})

describe('the last use, raced (OFFERS fact 8; PLATFORM-PROMPT §5.9)', () => {
  it('lets one order take it while another holds it uncommitted, and refuses the second once the first commits', async () => {
    await off()
    const id = await offer({ name: 'Last one', code: 'LAST1', limit: 1, action: { operation: 'order_percentage_discount', percent: 10 } })
    const token = await ready(1, { code: 'LAST1' })
    expect((await cartOf(token)).discounts.map((d) => d.name)).toEqual(['Last one'])
    // Another shopper's placement has taken the last use and not yet committed.
    let release = () => {}
    let ready_ = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const held = new Promise<void>((resolve) => (ready_ = resolve))
    const firstOrder = withSystemScope(db.sql, async (tx) => {
      expect(await claimUse(tx, store, id, new Date())).toBe(true)
      ready_()
      await gate
    })
    await held
    const second = place(token)
    await new Promise((resolve) => setTimeout(resolve, 300))
    release()
    await firstOrder
    expect((await second).code).toBe('OFFER_CHANGED')
    expect(await db.sql`select uses_count from promotion where id = ${id}`).toEqual([{ uses_count: 1 }])
    // Seen again, the cart no longer has it, so the shopper pays the price it shows.
    const again = await cartOf(token)
    expect([again.codes, again.discount.amount]).toEqual([[{ code: 'LAST1', state: 'USED_UP' }], '0'])
  })
})

describe('each store’s own offers (ACCESS §11)', () => {
  it('never prices one store’s cart with another store’s automatic offer or code', async () => {
    await off()
    await offer({ storeId: other, name: 'Surat half price', action: { operation: 'order_percentage_discount', percent: 50 } })
    const token = await add(kurta, 1)
    expect((await cartOf(token)).discount.amount).toBe('0')
    const theirs = await apply(token, 'THEIRS10')
    expect([theirs.state, theirs.cart.codes]).toEqual(['INVALID', []])
  })

  it('reads whether a shopper has ordered before, and their uses, in this store only', async () => {
    await off()
    const welcome = await offer({ name: 'Welcome', code: 'WELCOME', perCustomer: 1, conditions: [{ operation: 'first_order' }], action: { operation: 'order_percentage_discount', percent: 10 } })
    const theirs = await offer({ storeId: other, name: 'Their welcome', code: 'WELCOME', perCustomer: 1, action: { operation: 'order_percentage_discount', percent: 10 } })
    const [o] = await db.sql<{ id: string }[]>`
      insert into "order" (store_id, state, payment_state, currency, number, placed_at, subtotal_amount, shipping_amount, total_amount, payment_method, email)
      values (${other}, 'placed', 'paid', 'INR', 'S-1', now(), 100000, 0, 100000, 'cod', 'meera@example.com') returning id`
    await db.sql`insert into promotion_usage (promotion_id, store_id, order_id, customer_email, discount_amount, currency) values (${theirs}, ${other}, ${o?.id ?? ''}, 'meera@example.com', 10000, 'INR')`
    // A guest typing Meera's email is asked to sign in, as anyone is.
    const guest = await add(kurta, 1)
    await shop('mutation { setCartContact(email: "meera@example.com") { cart { id } } }', guest)
    expect((await apply(guest, 'WELCOME')).state).toBe('SIGN_IN_REQUIRED')
    // Signed in, she ordered and used their code in Surat: a first order here all the same.
    await signIn('meera@example.com')
    try {
      const token = await ready(1, { email: 'meera@example.com', code: 'WELCOME' })
      expect((await cartOf(token)).discounts.map((d) => d.name)).toEqual(['Welcome'])
      expect((await place(token)).code).toBeUndefined()
      // Her second here is not.
      const second = await add(kurta, 1)
      expect((await apply(second, 'WELCOME')).state).toBe('ALREADY_USED')
    } finally {
      session = null
    }
    expect(welcome).not.toBe(theirs)
  })

  it('takes an automatic offer’s old code as no code at all, while the offer itself still applies (fact 6)', async () => {
    await off()
    const auto = await offer({ name: 'Auto 5%', action: { operation: 'order_percentage_discount', percent: 5 } })
    await db.sql`insert into promotion_code (promotion_id, store_id, code) values (${auto}, ${store}, 'WASACODE')`
    const token = await add(kurta, 1)
    const r = await apply(token, 'WASACODE')
    expect([r.state, r.cart.codes, r.cart.discounts]).toEqual(['INVALID', [], [{ name: 'Auto 5%', code: null, amount: { amount: '5000' } }]])
  })
})

describe('the codes a cart holds', () => {
  it('holds five at most, and keeps both of two codes applied at once from two tabs', async () => {
    await off()
    for (const code of ['TABA', 'TABB', 'C3', 'C4', 'C5', 'C6'].map((c) => `${c}-CODE`)) {
      await offer({ name: code, code, action: { operation: 'order_fixed_discount', amounts: { INR: '100' } }, conditions: [{ operation: 'minimum_quantity', minimum: 50 }] })
    }
    const token = await add(kurta, 1)
    const [a, b] = await Promise.all([apply(token, 'TABA-CODE'), apply(token, 'TABB-CODE')])
    expect([a.state, b.state]).toEqual(['NOT_ELIGIBLE', 'NOT_ELIGIBLE'])
    expect((await cartOf(token)).codes.map((c) => c.code).sort()).toEqual(['TABA-CODE', 'TABB-CODE'])
    for (const code of ['C3-CODE', 'C4-CODE', 'C5-CODE']) expect((await apply(token, code)).state).toBe('NOT_ELIGIBLE')
    expect((await apply(token, 'C6-CODE')).code).toBe('TOO_MANY_CODES')
  })
})

describe('the preview storefront (storefront PREVIEW)', () => {
  it('prices offers as the live shop does, and its test order takes no use', async () => {
    await off()
    const id = await offer({ name: 'Preview 10%', code: 'TRYME', limit: 1, singleUse: true, action: { operation: 'order_percentage_discount', percent: 10 } })
    const preview = 'jaipur.preview.acme.example'
    const p = (source: string, token: string | null = null) => shop(source, token, { on: preview })
    const token = ((await p(`mutation { addToCart(versionId: "${kurta}", quantity: 1) { cartToken } }`)).data?.['addToCart'] as { cartToken: string }).cartToken
    expect(((await p('mutation { applyCode(code: "TRYME") { state } }', token)).data?.['applyCode'] as { state: string }).state).toBe('APPLIED')
    await p('mutation { setCartContact(email: "asha@example.com") { cart { id } } }', token)
    await p('mutation { setShippingAddress(address: { name: "Asha", line1: "12 MG Road", city: "Pune", region: "Maharashtra", postalCode: "411001", country: "IN" }) { cart { id } } }', token)
    await p('mutation { setShippingOption(option: "flat") { cart { id } } }', token)
    await p('mutation { checkout { id } }', token)
    const placed = (await p('mutation { placeOrder(provider: "cod") { orderId total { amount } } }', token)).data?.['placeOrder'] as { orderId: string; total: { amount: string } }
    expect(placed.total.amount).toBe('95000')
    expect(await db.sql`select uses_count from promotion where id = ${id}`).toEqual([{ uses_count: 0 }])
    expect(await db.sql`select used_at from promotion_code where promotion_id = ${id}`).toEqual([{ used_at: null }])
    expect(await db.sql`select 1 from promotion_usage where order_id = ${placed.orderId}`).toHaveLength(0)
    expect(await db.sql`select label from order_adjustment where order_id = ${placed.orderId} and kind = 'discount'`).toEqual([{ label: 'Preview 10%' }])
  })
})

