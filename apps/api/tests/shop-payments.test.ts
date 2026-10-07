import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveShopper } from '#auth/shopCaller'
import { resolveStoreStanding, storeHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { PaymentRefused, PaymentUnavailable, type OAuthConnect, type PaymentGateway, type PaymentOutcome, type PaymentRequest } from '#core/payments'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { applyOutcome, releaseUnpaidOrders, settleOrder, type PaymentWiring, type SettleDeps } from '#engine/modules/checkout/index'
import { handleStripeHook } from '#hooks/stripe'
import { handleStripeConnectCallback } from '#hooks/stripeConnect'
import { signPayload, type StripeApi } from '#integrations/stripe/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #309 (SAPI 10), part 2: card payments on the merchant's connected Stripe account (THIRD-PARTY-ACCESS §3.1): Connect
// Stripe through the hooks host, a payment started before the order is placed, settled from the webhook, the shopper's
// return or the sweep, stock held when paid, test mode on preview storefronts, and Stripe Tax on US carts.

let db: TestDatabase
let t: Tenants
const stores = { us: '', other: '' }
const live = 'columbus.shops.acme.example'
const preview = 'columbus.preview.acme.example'
let mug = ''
const cookies: Record<'owner' | 'staff' | 'other', string> = { owner: '', staff: '', other: '' }
const people = { owner: '', staff: '' }

// A stand-in for Stripe that answers what the test says the payment's outcome is.
const outcomes = new Map<string, PaymentOutcome>()
const started: PaymentRequest[] = []
let unavailable = false
let refused = false
// Set to the outcome Stripe has when it refuses a cancel because the intent was paid meanwhile.
let paidBeforeCancel: PaymentOutcome | null = null
const cancelled: string[] = []
let stillProcessing = false
const stripe: PaymentGateway = {
  available: () => true,
  start: async (account, request) => {
    started.push(request)
    const ref = `pi_test${started.length}`
    outcomes.set(ref, { state: 'pending' })
    return { providerRef: ref, publicKey: account.mode === 'test' ? 'pk_test_platform' : 'pk_live_platform', accountId: account.externalAccountId, clientSecret: `${ref}_secret_x`, sessionId: null, redirectUrl: null }
  },
  outcome: async (_, ref) => {
    if (unavailable) throw new PaymentUnavailable('down')
    if (refused) throw new PaymentRefused('no connected account')
    return outcomes.get(ref) ?? { state: 'failed' }
  },
  cancel: async (_, ref) => {
    // Stripe won't cancel an intent still processing (a bank debit): refused, and it stays pending.
    if (stillProcessing) throw new PaymentRefused('payment_intent_unexpected_state')
    if (paidBeforeCancel) {
      outcomes.set(ref, paidBeforeCancel)
      throw new PaymentRefused('payment_intent_unexpected_state')
    }
    cancelled.push(ref)
  },
}
const deauthorized: string[] = []
const connect: OAuthConnect = {
  authorizeUrl: (state) => `https://connect.stripe.com/oauth/authorize?state=${state}`,
  exchange: async (code) => {
    if (code === 'used') throw new Error('invalid_grant')
    return { accountId: 'acct_columbus', livemode: false }
  },
  deauthorize: async (id) => {
    deauthorized.push(id)
  },
}
let taxAsked: { shipping?: bigint | null; accountId: string } | null = null
let taxDown = false
const wiring: PaymentWiring = {
  gateways: { stripe },
  stripeConnect: connect,
  stripeTax: () => async (request) => {
    taxAsked = request
    if (taxDown) throw new Error('Stripe answered 503')
    return { total: 260n + (request.shipping ? 60n : 0n), lines: request.lines.map((l) => ({ reference: l.reference, amount: 260n })), shipping: request.shipping ? 60n : 0n }
  },
  webhookUrl: (provider, id) => `https://hooks.acme.example/payments/${provider}/${id}`,
}
const settleDeps = (at = new Date()): SettleDeps => ({ sql: db.sql, activity: activityLog, gateways: wiring.gateways, secrets: null, now: () => at })

const store = async (name: string, code: string) =>
  (await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status) values (${t.partnerA}, ${name}, ${code}, 'US', 'USD', 'active') returning id`)[0]?.id ?? ''

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'shops', '*.shops.acme.example', 'live', 'CNAME', 'x')`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'preview', '*.preview.acme.example', 'live', 'CNAME', 'x')`
  stores.us = await store('Columbus', 'columbus')
  stores.other = await store('Dayton', 'dayton')
  await db.sql`update store set address = '{"region": "OH"}'::jsonb where id = ${stores.us}`
  const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${stores.us}, 'Mug', 'mug', 'visible') returning id`
  mug = (await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position, track_stock) values (${stores.us}, ${p?.id ?? ''}, 'M1', 0, true) returning id`)[0]?.id ?? ''
  await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${mug}, ${stores.us}, 'USD', 2000)`
  await db.sql`insert into stock_level (version_id, warehouse_id, store_id, on_hand) select ${mug}, w.id, ${stores.us}, 5 from warehouse w where w.store_id = ${stores.us} and w.is_default`
  await db.sql`insert into store_shipping (store_id, flat_enabled, flat_amount, pickup_enabled, pickup_hours, currency, area_mode, saved_at, revision)
    values (${stores.us}, true, 799, false, null, 'USD', 'everywhere', now(), 1)`
  const person = async (storeId: string, email: string, role: string) => {
    const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, ${email}, 'P', 'active') returning id`
    await db.sql`insert into membership (user_id, store_id, role_key, status) values (${u?.id ?? ''}, ${storeId}, ${role}, 'active')`
    return { id: u?.id ?? '', cookie: await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId: t.partnerA }, new Date())) }
  }
  const owner = await person(stores.us, 'owner@columbus.example', 'owner')
  const staff = await person(stores.us, 'staff@columbus.example', 'staff')
  cookies.owner = owner.cookie
  cookies.staff = staff.cookie
  people.owner = owner.id
  people.staff = staff.id
  cookies.other = (await person(stores.other, 'owner@dayton.example', 'owner')).cookie
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const shop = async (source: string, cart: string | null = null, host = live) => {
  const found = await resolveShopper(db.sql, new Request(`https://${host}/shop-api`, { headers: cart ? { 'x-shop-cart': cart } : {} }), host)
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = { sql: db.sql, shopper: found.shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.5', userAgent: null }, couriers: null, payments: wiring, secrets: null, allowAttempt: async () => true, allowNewCart: async () => true, now: () => new Date() }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
const merchant = async (source: string, who: keyof typeof cookies, support?: 'read' | 'write') => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: who === 'other' ? stores.other : stores.us }
  const resolved = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, new Date(), activityLog, facts)
  const standing = support && resolved.kind === 'acting'
    ? { ...resolved, caller: { ...resolved.caller, context: { ...resolved.caller.context, caller: { kind: 'support' as const, supportSessionId: crypto.randomUUID(), partnerUserId: crypto.randomUUID(), access: support } } } }
    : resolved
  const contextValue: StoreContext = { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, payments: wiring, host: 'store.acme.example', now: () => new Date() }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
const callback = (query: string) => handleStripeConnectCallback(new Request(`https://hooks.acme.example/stripe/connect/callback?${query}`), { sql: db.sql, connect, activity: activityLog, now: () => new Date() })

const readyCart = async (quantity: number, host = live) => {
  const token = ((await shop(`mutation { addToCart(versionId: "${mug}", quantity: ${quantity}) { cartToken } }`, null, host)).data?.['addToCart'] as { cartToken: string }).cartToken
  await shop('mutation { setCartContact(email: "sam@example.com") { cart { id } } }', token, host)
  await shop('mutation { setShippingAddress(address: { name: "Sam", line1: "1 High St", city: "New York", region: "NY", postalCode: "10001", country: "US" }) { cart { id } } }', token, host)
  await shop('mutation { setShippingOption(option: "flat") { cart { id } } }', token, host)
  await shop('mutation { checkout { id } }', token, host)
  return token
}
type Placed = { orderId: string; payment: { providerRef: string; publicKey: string; accountId: string; clientSecret: string } | null }
const placeStripe = async (token: string, host = live) => {
  const placed = await shop('mutation { placeOrder(provider: "stripe") { orderId payment { providerRef publicKey accountId clientSecret } } }', token, host)
  return { ...placed, placed: placed.data?.['placeOrder'] as Placed | undefined }
}
const totalOf = async (orderId: string) => BigInt((await db.sql<{ total: string }[]>`select total_amount::text as total from "order" where id = ${orderId}`)[0]?.total ?? '0')
const reserved = async () => (await db.sql<{ reserved: number }[]>`select reserved from stock_level where version_id = ${mug}`)[0]?.reserved
const actions = async (orderId: string) => (await db.sql<{ action: string; actor_kind: string }[]>`select action, actor_kind from activity_log where target_id = ${orderId} order by occurred_at, id`).map((r) => `${r.action}:${r.actor_kind}`)

describe('Connect Stripe', () => {
  it('lists the US gateways, and lets only the Owner start; Stripe returns to the hooks host and the starter finishes', async () => {
    expect(((await merchant('{ gateways { provider kind live connectable } }', 'owner')).data?.['gateways'] as unknown[])).toEqual([
      { provider: 'stripe', kind: 'gateway', live: false, connectable: true },
      { provider: 'paypal', kind: 'gateway', live: false, connectable: false },
      { provider: 'bank_transfer', kind: 'other', live: false, connectable: true },
    ])
    expect((await merchant('mutation { connectStripe }', 'staff')).code).toBe('FORBIDDEN')
    const url = new URL((await merchant('mutation { connectStripe }', 'owner')).data?.['connectStripe'] as string)
    const state = url.searchParams.get('state') ?? ''
    expect(state).toMatch(/^[0-9a-f]{64}$/)
    // Nothing of the state itself is kept, only its hash.
    expect(await db.sql`select 1 from payment_connect where state_hash = ${state}`).toHaveLength(0)
    const back = await callback(`state=${state}&code=ac_good`)
    const to = new URL(back.headers.get('location') ?? '')
    expect(`${to.host}${to.pathname}`).toBe('store.acme.example/settings/payments')
    const key = to.searchParams.get('key') ?? ''
    expect(to.searchParams.get('stripe')).toBe('finish')
    // The state is spent; the key works for the person who started, in this store, once.
    expect((await callback(`state=${state}&code=ac_good`)).status).toBe(400)
    expect((await merchant(`mutation { finishStripeConnect(key: "${key}") }`, 'other')).code).toBe('EXPIRED')
    expect((await merchant(`mutation { finishStripeConnect(key: "${key}") }`, 'owner')).data?.['finishStripeConnect']).toBe(true)
    expect((await merchant(`mutation { finishStripeConnect(key: "${key}") }`, 'owner')).code).toBe('EXPIRED')
    expect(await db.sql`select provider, external_account_id, status from payment_provider_account where store_id = ${stores.us}`).toEqual([{ provider: 'stripe', external_account_id: 'acct_columbus', status: 'live' }])
    expect((await db.sql<{ action: string }[]>`select action from activity_log where store_id = ${stores.us} and action like 'payment_method.connect%' order by occurred_at`).map((r) => r.action)).toEqual([
      'payment_method.connect_started',
      'payment_method.connect_approved',
      'payment_method.connected',
    ])
  })

  it('refuses Connect Stripe to a support session and to Staff, and a key past its 10 minutes', async () => {
    expect((await merchant('mutation { connectStripe }', 'owner', 'write')).code).toBe('SUPPORT_SESSION')
    const state = new URL((await merchant('mutation { connectStripe }', 'owner')).data?.['connectStripe'] as string).searchParams.get('state') ?? ''
    const key = new URL((await callback(`state=${state}&code=ac_late`)).headers.get('location') ?? '').searchParams.get('key') ?? ''
    expect((await merchant(`mutation { finishStripeConnect(key: "${key}") }`, 'owner', 'write')).code).toBe('SUPPORT_SESSION')
    expect((await merchant(`mutation { finishStripeConnect(key: "${key}") }`, 'staff')).code).toBe('FORBIDDEN')
    expect((await merchant('mutation { disconnectGateway(provider: "stripe") }', 'staff')).code).toBe('FORBIDDEN')
    await db.sql`update payment_connect set expires_at = now() - interval '1 second' where store_id = ${stores.us}`
    expect((await merchant(`mutation { finishStripeConnect(key: "${key}") }`, 'owner')).code).toBe('EXPIRED')
    // A start not answered within its 30 minutes is refused at the callback.
    const stale = new URL((await merchant('mutation { connectStripe }', 'owner')).data?.['connectStripe'] as string).searchParams.get('state') ?? ''
    await db.sql`update payment_connect set expires_at = now() - interval '1 second' where store_id = ${stores.us}`
    expect((await callback(`state=${stale}&code=ac_x`)).status).toBe(400)
  })

  it('sends the merchant back when they cancel on Stripe or the code fails, and refuses an unknown state', async () => {
    const start = async () => new URL((await merchant('mutation { connectStripe }', 'owner')).data?.['connectStripe'] as string).searchParams.get('state') ?? ''
    expect(new URL((await callback(`state=${await start()}&error=access_denied`)).headers.get('location') ?? '').searchParams.get('stripe')).toBe('cancelled')
    expect(new URL((await callback(`state=${await start()}&code=used`)).headers.get('location') ?? '').searchParams.get('stripe')).toBe('failed')
    expect((await callback(`state=${'a'.repeat(64)}&code=x`)).status).toBe(400)
    expect((await callback('state=nope')).status).toBe(400)
    // The connected account is untouched by the attempts that failed.
    expect((await db.sql<{ status: string }[]>`select status from payment_provider_account where store_id = ${stores.us} and provider = 'stripe'`)[0]?.status).toBe('live')
  })

  it('connects one Stripe account to one store only', async () => {
    const url = new URL((await merchant('mutation { connectStripe }', 'other')).data?.['connectStripe'] as string)
    const key = new URL((await callback(`state=${url.searchParams.get('state') ?? ''}&code=ac_same`)).headers.get('location') ?? '').searchParams.get('key') ?? ''
    expect((await merchant(`mutation { finishStripeConnect(key: "${key}") }`, 'other')).code).toBe('ACCOUNT_IN_USE')
    expect(await db.sql`select 1 from payment_provider_account where store_id = ${stores.other} and provider = 'stripe'`).toHaveLength(0)
  })

  it('keeps Connect Stripe away from other stores’ tables and callers', async () => {
    const caller = (storeId: string): TenantContext => ({ caller: { kind: 'person', userId: 'u', sessionId: 's' }, partnerId: t.partnerA, storeId, sellerScope: { kind: 'all' }, subscription: 'active' })
    await expect(withScope(db.sql, caller(stores.us), (tx) => tx`select 1 from payment_connect`)).rejects.toThrow(/permission denied/)
    // A merchant reads its own account id; another store's merchant reads none of it.
    expect(await withScope(db.sql, caller(stores.other), (tx) => tx`select external_account_id from payment_provider_account`)).toHaveLength(0)
    await expect(withScope(db.sql, caller(stores.us), (tx) => tx`update payment_provider_account set external_account_id = 'acct_x'`)).rejects.toThrow(/permission denied/)
  })
})

describe('Paying by card', () => {
  let paid = ''

  it('offers Stripe live on the shop and in test mode on the preview, with the platform’s key for that mode', async () => {
    expect((await shop('{ paymentOptions { provider kind mode } }')).data?.['paymentOptions']).toEqual([{ provider: 'stripe', kind: 'card', mode: 'live' }])
    expect((await shop('{ paymentOptions { provider mode } }', null, preview)).data?.['paymentOptions']).toEqual([{ provider: 'stripe', mode: 'test' }])
  })

  it('taxes a US cart with Stripe Tax on the store’s account, delivery included, and says so when Stripe can’t answer', async () => {
    const token = await readyCart(1)
    const cart = (await shop('{ cart { tax { amount { amount } } total { amount } problems } }', token)).data?.['cart'] as { tax: { amount: { amount: string } }; total: { amount: string }; problems: string[] }
    expect(taxAsked).toMatchObject({ accountId: 'acct_columbus', shipping: 799n })
    expect(cart.tax.amount.amount).toBe('320')
    expect(cart.total.amount).toBe(String(2000 + 799 + 320))
    taxDown = true
    expect(((await shop('{ cart { problems } }', token)).data?.['cart'] as { problems: string[] }).problems).toEqual(['TAX_UNAVAILABLE'])
    taxDown = false
  })

  it('starts the payment on the connected account first, then places the order unpaid with no stock held', async () => {
    const token = await readyCart(2)
    const { placed } = await placeStripe(token)
    expect(placed?.payment).toEqual({ providerRef: 'pi_test1', publicKey: 'pk_live_platform', accountId: 'acct_columbus', clientSecret: 'pi_test1_secret_x' })
    paid = placed?.orderId ?? ''
    expect(started[0]).toMatchObject({ orderId: paid, amount: { amount: await totalOf(paid), currency: 'USD' }, customer: { email: 'sam@example.com' }, returnUrl: `https://${live}/checkout/complete?order=${paid}` })
    expect((await db.sql`select state, payment_state, stock_reserved from "order" where id = ${paid}`)[0]).toEqual({ state: 'placed', payment_state: 'pending', stock_reserved: false })
    expect(await db.sql`select provider_ref, state, mode from payment where order_id = ${paid}`).toEqual([{ provider_ref: 'pi_test1', state: 'pending', mode: 'live' }])
    expect(await reserved()).toBe(0)
  })

  it('settles on the shopper’s return once Stripe says paid: stock held, logged as Stripe’s, never twice', async () => {
    // Still waiting: nothing changes.
    expect(await releaseUnpaidOrders(settleDeps(), new Date())).toBe(0)
    outcomes.set('pi_test1', { state: 'captured', amount: { amount: await totalOf(paid), currency: 'USD' } })
    expect(await settleOrder(settleDeps(), stores.us, paid)).toBe('paid')
    expect(await settleOrder(settleDeps(), stores.us, paid)).toBe('already')
    expect((await db.sql`select payment_state, stock_reserved from "order" where id = ${paid}`)[0]).toEqual({ payment_state: 'paid', stock_reserved: true })
    expect(await reserved()).toBe(2)
    expect(await actions(paid)).toEqual(['order.placed:anonymous', 'order.paid:provider'])
  })

  it('confirms through the Shop API for the shopper whose order it is, and nobody else', async () => {
    const token = await readyCart(1)
    const { placed } = await placeStripe(token)
    const id = placed?.orderId ?? ''
    expect((await shop(`mutation { confirmPayment(orderId: "${id}") { paymentState } }`, token)).data?.['confirmPayment']).toEqual({ paymentState: 'pending' })
    outcomes.set(placed?.payment?.providerRef ?? '', { state: 'captured', amount: { amount: await totalOf(id), currency: 'USD' } })
    // Another guest's cart token, or none, finds no order to confirm.
    expect((await shop(`mutation { confirmPayment(orderId: "${id}") { paymentState } }`, await readyCart(1))).data?.['confirmPayment']).toBeNull()
    expect((await shop(`mutation { confirmPayment(orderId: "${id}") { paymentState } }`)).data?.['confirmPayment']).toBeNull()
    expect((await db.sql<{ payment_state: string }[]>`select payment_state from "order" where id = ${id}`)[0]?.payment_state).toBe('pending')
    expect((await shop(`mutation { confirmPayment(orderId: "${id}") { paymentState } }`, token)).data?.['confirmPayment']).toEqual({ paymentState: 'paid' })
    expect((await shop(`mutation { payOrder(orderId: "${id}") { providerRef } }`, token)).code).toBe('ALREADY_PAID')
  })

  it('holds an order whose payment came in at a different amount for the merchant, logged once', async () => {
    const token = await readyCart(1)
    const { placed } = await placeStripe(token)
    const id = placed?.orderId ?? ''
    const first = placed?.payment?.providerRef ?? ''
    outcomes.set(first, { state: 'captured', amount: { amount: 1n, currency: 'USD' } })
    expect((await shop(`mutation { confirmPayment(orderId: "${id}") { paymentState } }`, token)).data?.['confirmPayment']).toEqual({ paymentState: 'pending' })
    await shop(`mutation { confirmPayment(orderId: "${id}") { paymentState } }`, token)
    expect(await applyOutcome(settleDeps(), 'stripe', first, { state: 'captured', amount: { amount: 1n, currency: 'USD' } })).toBe('mismatch')
    expect((await actions(id)).filter((a) => a === 'payment.amount_mismatch:provider')).toHaveLength(1)
    expect((await db.sql`select o.payment_due_by, p.state from "order" o join payment p on p.order_id = o.id where o.id = ${id}`)[0]).toEqual({ payment_due_by: null, state: 'mismatch' })
    expect((await shop(`mutation { payOrder(orderId: "${id}") { providerRef } }`, token)).code).toBe('PAYMENT_MISMATCH')
  })

  it('lets a declined card try again, cancelling the attempt it replaces', async () => {
    const token = await readyCart(1)
    const { placed } = await placeStripe(token)
    const id = placed?.orderId ?? ''
    const first = placed?.payment?.providerRef ?? ''
    const again = (await shop(`mutation { payOrder(orderId: "${id}") { providerRef clientSecret } }`, token)).data?.['payOrder'] as { providerRef: string }
    expect(again.providerRef).not.toBe(first)
    // The attempt it replaces is cancelled at Stripe, so the shopper can't pay both.
    expect(cancelled).toContain(first)
    expect(await db.sql`select provider_ref, state from payment where order_id = ${id} order by created_at`).toEqual([
      { provider_ref: first, state: 'failed' },
      { provider_ref: again.providerRef, state: 'pending' },
    ])
    expect(await actions(id)).toContain('order.payment_retried:anonymous')
    expect((await shop(`mutation { payOrder(orderId: "${id}") { providerRef } }`, await readyCart(1))).code).toBe('NOT_FOUND')
  })

  it('takes a test payment on the preview without holding real stock', async () => {
    const before = await reserved()
    const token = await readyCart(1, preview)
    const { placed } = await placeStripe(token, preview)
    expect(placed?.payment?.publicKey).toBe('pk_test_platform')
    const id = placed?.orderId ?? ''
    outcomes.set(placed?.payment?.providerRef ?? '', { state: 'captured', amount: { amount: await totalOf(id), currency: 'USD' } })
    expect((await shop(`mutation { confirmPayment(orderId: "${id}") { paymentState } }`, token, preview)).data?.['confirmPayment']).toEqual({ paymentState: 'paid' })
    expect(await reserved()).toBe(before)
    expect((await db.sql<{ mode: string }[]>`select mode from payment where order_id = ${id}`)[0]?.mode).toBe('test')
  })

  it('holds stock that sold out meanwhile, since the money is taken, and says so for the merchant', async () => {
    const token = await readyCart(1)
    const { placed } = await placeStripe(token)
    const id = placed?.orderId ?? ''
    await db.sql`update stock_level set on_hand = reserved where version_id = ${mug}`
    try {
      outcomes.set(placed?.payment?.providerRef ?? '', { state: 'captured', amount: { amount: await totalOf(id), currency: 'USD' } })
      expect(await settleOrder(settleDeps(), stores.us, id)).toBe('paid')
      // Written in one transaction, so in no set order.
      expect((await actions(id)).sort()).toEqual(['order.oversold:provider', 'order.paid:provider', 'order.placed:anonymous'])
    } finally {
      await db.sql`update stock_level set on_hand = 50 where version_id = ${mug}`
    }
  })

  it('lets a card order unpaid for a day go, unless Stripe says it was paid, or can’t be asked', async () => {
    const unpaid = (await placeStripe(await readyCart(1))).placed?.orderId ?? ''
    const late = (await placeStripe(await readyCart(1))).placed
    const lateId = late?.orderId ?? ''
    outcomes.set(late?.payment?.providerRef ?? '', { state: 'captured', amount: { amount: await totalOf(lateId), currency: 'USD' } })
    const tomorrow = new Date(Date.now() + 86_400_000 + 60_000)
    unavailable = true
    expect(await releaseUnpaidOrders(settleDeps(tomorrow), tomorrow)).toBe(0)
    unavailable = false
    // Deferred an hour while Stripe was down; the mismatched order from earlier is out of the queue for a person.
    const later = new Date(tomorrow.getTime() + 2 * 3_600_000)
    expect(await releaseUnpaidOrders(settleDeps(later), later)).toBeGreaterThanOrEqual(1)
    expect((await db.sql`select state, cancel_reason from "order" where id = ${unpaid}`)[0]).toEqual({ state: 'cancelled', cancel_reason: 'unpaid' })
    expect((await db.sql`select state, payment_state from "order" where id = ${lateId}`)[0]).toEqual({ state: 'placed', payment_state: 'paid' })
    expect((await db.sql<{ actor_kind: string; reason: string }[]>`select actor_kind, reason from activity_log where action = 'order.cancelled' and target_id = ${unpaid}`)[0]).toEqual({ actor_kind: 'job', reason: 'unpaid' })
    // Paid after all, once cancelled: kept as paid for the merchant to refund.
    const ref = (await db.sql<{ provider_ref: string }[]>`select provider_ref from payment where order_id = ${unpaid}`)[0]?.provider_ref ?? ''
    outcomes.set(ref, { state: 'captured', amount: { amount: await totalOf(unpaid), currency: 'USD' } })
    expect(await settleOrder(settleDeps(), stores.us, unpaid)).toBe('paid')
    expect((await db.sql`select state, payment_state from "order" where id = ${unpaid}`)[0]).toEqual({ state: 'cancelled', payment_state: 'paid' })
    expect(await actions(unpaid)).toContain('order.paid_after_cancel:provider')
  })
})

describe('when payments go wrong', () => {
  const paidOutcome = async (id: string): Promise<{ state: 'captured'; amount: { amount: bigint; currency: string } }> => ({ state: 'captured', amount: { amount: await totalOf(id), currency: 'USD' } })

  it('records a second payment of a paid order for a refund, and calls it already paid', async () => {
    const token = await readyCart(1)
    const placed = (await placeStripe(token)).placed
    const id = placed?.orderId ?? ''
    const first = placed?.payment?.providerRef ?? ''
    const second = ((await shop(`mutation { payOrder(orderId: "${id}") { providerRef } }`, token)).data?.['payOrder'] as { providerRef: string }).providerRef
    outcomes.set(second, await paidOutcome(id))
    expect(await settleOrder(settleDeps(), stores.us, id)).toBe('paid')
    // The first attempt, cancelled locally, is paid too after all.
    expect(await applyOutcome(settleDeps(), 'stripe', first, await paidOutcome(id))).toBe('already')
    expect(await actions(id)).toContain('order.paid_twice:provider')
  })

  it('answers a retry as already paid when the attempt it would replace was paid meanwhile', async () => {
    const token = await readyCart(1)
    const placed = (await placeStripe(token)).placed
    const id = placed?.orderId ?? ''
    paidBeforeCancel = await paidOutcome(id)
    try {
      expect((await shop(`mutation { payOrder(orderId: "${id}") { providerRef } }`, token)).code).toBe('ALREADY_PAID')
      expect((await db.sql<{ payment_state: string }[]>`select payment_state from "order" where id = ${id}`)[0]?.payment_state).toBe('paid')
    } finally {
      paidBeforeCancel = null
    }
  })

  it('lets a card order go when its payment can no longer be read (Stripe disconnected), without stopping the sweep', async () => {
    const id = (await placeStripe(await readyCart(1))).placed?.orderId ?? ''
    const due = new Date(Date.now() + 3 * 86_400_000)
    refused = true
    try {
      expect(await releaseUnpaidOrders(settleDeps(due), due)).toBeGreaterThanOrEqual(1)
    } finally {
      refused = false
    }
    expect((await db.sql`select state, cancel_reason from "order" where id = ${id}`)[0]).toEqual({ state: 'cancelled', cancel_reason: 'unpaid' })
  })
})

describe('a payment still going through', () => {
  it('is never cancelled by the sweep nor replaced by a retry while its provider can’t close it', async () => {
    const token = await readyCart(1)
    const id = (await placeStripe(token)).placed?.orderId ?? ''
    const later = new Date(Date.now() + 2 * 86_400_000)
    stillProcessing = true
    try {
      expect((await shop(`mutation { payOrder(orderId: "${id}") { providerRef } }`, token)).code).toBe('PAYMENT_PENDING')
      await releaseUnpaidOrders(settleDeps(later), later)
      expect((await db.sql<{ state: string; payment_due_by: Date }[]>`select state, payment_due_by from "order" where id = ${id}`)[0]).toMatchObject({ state: 'placed' })
    } finally {
      stillProcessing = false
    }
  })

  it('pays an order only in the mode it was placed in: a live order’s retry from the preview is refused', async () => {
    const token = await readyCart(1)
    const id = (await placeStripe(token)).placed?.orderId ?? ''
    expect((await shop(`mutation { payOrder(orderId: "${id}") { providerRef } }`, token, preview)).code).toBe('MODE_MISMATCH')
  })
})

describe('Stripe’s events for a connected account', () => {
  const signingSecret = 'whsec_test'
  const billing = {} as StripeApi
  const deliver = async (event: { id: string; type: string; account: string | null; object: { id: string; object: string } }) => {
    const body = JSON.stringify({ id: event.id, type: event.type, account: event.account, data: { object: event.object } })
    const at = Math.floor(Date.now() / 1000)
    const request = new Request('https://hooks.acme.example/stripe', { method: 'POST', body, headers: { 'stripe-signature': `t=${at},v1=${await signPayload(signingSecret, at, body)}` } })
    return handleStripeHook(request, { sql: db.sql, stripe: billing, signingSecret, payments: settleDeps(), now: () => new Date() })
  }

  it('settles a payment from its webhook, reading it back, and never reaches billing with a merchant’s event', async () => {
    const placed = (await placeStripe(await readyCart(1))).placed
    const id = placed?.orderId ?? ''
    const ref = placed?.payment?.providerRef ?? ''
    outcomes.set(ref, { state: 'captured', amount: { amount: await totalOf(id), currency: 'USD' } })
    expect((await deliver({ id: 'evt_1', type: 'payment_intent.succeeded', account: 'acct_columbus', object: { id: ref, object: 'payment_intent' } })).status).toBe(200)
    expect((await db.sql<{ payment_state: string }[]>`select payment_state from "order" where id = ${id}`)[0]?.payment_state).toBe('paid')
    // The same event again changes nothing; a charge event on the merchant's account is ignored, not sent to billing.
    expect((await deliver({ id: 'evt_1', type: 'payment_intent.succeeded', account: 'acct_columbus', object: { id: ref, object: 'payment_intent' } })).status).toBe(200)
    expect((await deliver({ id: 'evt_2', type: 'charge.succeeded', account: 'acct_columbus', object: { id: 'ch_1', object: 'charge' } })).status).toBe(200)
    expect((await db.sql`select 1 from activity_log where target_id = ${id} and action = 'order.paid'`).length).toBe(1)
    // An intent this store didn't start through DripFunnel is answered and left alone.
    expect((await deliver({ id: 'evt_3', type: 'payment_intent.succeeded', account: 'acct_columbus', object: { id: 'pi_elsewhere', object: 'payment_intent' } })).status).toBe(200)
    // Stripe down while reading it back: asked to send it again.
    const pending = (await placeStripe(await readyCart(1))).placed
    unavailable = true
    expect((await deliver({ id: 'evt_4', type: 'payment_intent.succeeded', account: 'acct_columbus', object: { id: pending?.payment?.providerRef ?? '', object: 'payment_intent' } })).status).toBe(503)
    unavailable = false
  })

  it('never settles one store’s payment from another store’s connected account', async () => {
    const placed = (await placeStripe(await readyCart(1))).placed
    const id = placed?.orderId ?? ''
    await db.sql`insert into payment_provider_account (store_id, provider, mode, external_account_id, status) values (${stores.other}, 'stripe', 'live', 'acct_dayton', 'live')`
    outcomes.set(placed?.payment?.providerRef ?? '', { state: 'captured', amount: { amount: await totalOf(id), currency: 'USD' } })
    expect((await deliver({ id: 'evt_x', type: 'payment_intent.succeeded', account: 'acct_dayton', object: { id: placed?.payment?.providerRef ?? '', object: 'payment_intent' } })).status).toBe(200)
    expect((await db.sql<{ payment_state: string }[]>`select payment_state from "order" where id = ${id}`)[0]?.payment_state).toBe('pending')
    await db.sql`delete from payment_provider_account where external_account_id = 'acct_dayton'`
  })

  it('answers a merchant’s kind of event from an account no store holds, never handing it to billing', async () => {
    // The billing client here is empty: reaching it would throw and answer 500.
    expect((await deliver({ id: 'evt_gone1', type: 'payment_intent.succeeded', account: 'acct_gone', object: { id: 'pi_gone', object: 'payment_intent' } })).status).toBe(200)
    expect((await deliver({ id: 'evt_gone2', type: 'account.application.deauthorized', account: 'acct_gone', object: { id: 'ca_x', object: 'application' } })).status).toBe(200)
  })

  it('turns Stripe off when the merchant removes the app on Stripe’s side', async () => {
    await merchant('mutation { connectGateway(provider: "bank_transfer", bankDetails: "Chase 0001") }', 'owner')
    expect((await deliver({ id: 'evt_5', type: 'account.application.deauthorized', account: 'acct_columbus', object: { id: 'ca_platform', object: 'application' } })).status).toBe(200)
    expect((await db.sql`select status, external_account_id from payment_provider_account where store_id = ${stores.us} and provider = 'stripe'`)[0]).toEqual({ status: 'off', external_account_id: null })
    expect((await shop('{ paymentOptions { provider } }')).data?.['paymentOptions']).toEqual([{ provider: 'bank_transfer' }])
  })
})

describe('Disconnecting', () => {
  it('never turns off the only live way to pay, and disconnecting Stripe ends its access', async () => {
    // Reconnected, then the transfer turned off first: Stripe is the only one left.
    await db.sql`update payment_provider_account set status = 'live', external_account_id = 'acct_columbus' where store_id = ${stores.us} and provider = 'stripe'`
    expect((await merchant('mutation { disconnectGateway(provider: "bank_transfer") }', 'owner')).data?.['disconnectGateway']).toBe(true)
    expect((await merchant('mutation { disconnectGateway(provider: "stripe") }', 'owner')).code).toBe('LAST_METHOD')
    expect((await merchant('mutation { disconnectGateway(provider: "stripe") }', 'staff')).code).toBe('FORBIDDEN')
    // A support session never changes how the store is paid, even with write access.
    expect((await merchant('mutation { disconnectGateway(provider: "stripe") }', 'owner', 'write')).code).toBe('SUPPORT_SESSION')
    expect((await merchant('mutation { disconnectGateway(provider: "stripe") }', 'other')).code).toBe('NOT_FOUND')
    await merchant('mutation { connectGateway(provider: "bank_transfer", bankDetails: "Chase 0001") }', 'owner')
    expect((await merchant('mutation { disconnectGateway(provider: "stripe") }', 'owner')).data?.['disconnectGateway']).toBe(true)
    expect(deauthorized).toEqual(['acct_columbus'])
    expect((await db.sql`select status, external_account_id from payment_provider_account where store_id = ${stores.us} and provider = 'stripe'`)[0]).toEqual({ status: 'off', external_account_id: null })
    expect((await merchant('{ gateways { provider live } }', 'owner')).data?.['gateways']).toEqual([
      { provider: 'stripe', live: false },
      { provider: 'paypal', live: false },
      { provider: 'bank_transfer', live: true },
    ])
  })
})
