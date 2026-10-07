import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { secretBox, type SecretBox } from '#auth/secretBox'
import { resolveShopper } from '#auth/shopCaller'
import { resolveStoreStanding, storeHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import type { PaymentWiring } from '#engine/modules/checkout/index'
import { handlePaymentHook, paymentHookOf } from '#hooks/payments'
import { PaymentRefused, PaymentUnavailable } from '#core/payments'
import { hmacBase64, hmacHex } from '#integrations/payments/http'
import { keyedGateways } from '#integrations/payments/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #309 (SAPI 10), part 3: the providers merchants connect with their own pasted keys (THIRD-PARTY-ACCESS §3.1):
// keys checked and sealed, a key set per mode, each store's own webhook address, and a payment through Razorpay's real
// adapter against a stand-in for Razorpay's API, settled from its signed webhook.

let db: TestDatabase
let t: Tenants
let secrets: SecretBox
const stores = { india: '', other: '' }
const live = 'jaipur.shops.acme.example'
const preview = 'jaipur.preview.acme.example'
let kurta = ''
const cookies: Record<'owner' | 'staff' | 'other', string> = { owner: '', staff: '', other: '' }

// A stand-in for Razorpay's API: orders it was asked to make, and what the test says was paid on them.
const orders = new Map<string, { amount: number; currency: string; paid: boolean; key: string }>()
const cashfreeOrders = new Map<string, { amount: string; currency: string; paid: boolean }>()
const razorpayApi = async (url: string, init?: RequestInit): Promise<Response> => {
  const auth = new Headers(init?.headers).get('authorization') ?? ''
  const [keyId, keySecret] = atob(auth.replace('Basic ', '')).split(':')
  if (keySecret === 'wrong') return Response.json({ error: { code: 'BAD_REQUEST_ERROR' } }, { status: 401 })
  const path = new URL(url).pathname
  if (path === '/v1/orders' && init?.method === 'POST') {
    const body = JSON.parse(String(init.body)) as { amount: number; currency: string }
    const id = `order_T${orders.size + 1}`
    orders.set(id, { amount: body.amount, currency: body.currency, paid: false, key: keyId ?? '' })
    return Response.json({ id, status: 'created' })
  }
  if (path === '/v1/orders') return Response.json({ items: [] })
  const payments = /^\/v1\/orders\/(order_\w+)\/payments$/.exec(path)
  const order = orders.get(payments?.[1] ?? '')
  if (order) return Response.json({ items: order.paid ? [{ id: 'pay_1', status: 'captured', amount: order.amount, currency: order.currency }] : [] })
  if (url.includes('cashfree.com')) {
    // A stand-in for Cashfree's orders: made with the shopper's number, read back by their own id.
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { order_id: string; order_amount: number; order_currency: string }
      cashfreeOrders.set(body.order_id, { amount: String(init.body).match(/"order_amount":([0-9.]+)/)?.[1] ?? '0', currency: body.order_currency, paid: false })
      return Response.json({ order_id: body.order_id, payment_session_id: `session_${body.order_id}` })
    }
    const order = cashfreeOrders.get(new URL(url).pathname.split('/').pop() ?? '')
    if (!order) return Response.json({ message: 'order not found' }, { status: 404 })
    return Response.json({ order_status: order.paid ? 'PAID' : 'ACTIVE', order_amount: order.amount, order_currency: order.currency })
  }
  return Response.json({}, { status: 404 })
}
const wiring = (): PaymentWiring => ({
  gateways: keyedGateways(((url: string | URL | Request, init?: RequestInit) => razorpayApi(String(url), init)) as typeof fetch),
  stripeConnect: null,
  stripeTax: () => null,
  webhookUrl: (provider, id) => `https://hooks.acme.example/payments/${provider}/${id}`,
})

const store = async (name: string, code: string) =>
  (await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status) values (${t.partnerA}, ${name}, ${code}, 'IN', 'INR', 'active') returning id`)[0]?.id ?? ''

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  secrets = await secretBox(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))))
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'shops', '*.shops.acme.example', 'live', 'CNAME', 'x')`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'preview', '*.preview.acme.example', 'live', 'CNAME', 'x')`
  stores.india = await store('Jaipur', 'jaipur')
  stores.other = await store('Surat', 'surat')
  const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${stores.india}, 'Kurta', 'kurta', 'visible') returning id`
  kurta = (await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position, track_stock) values (${stores.india}, ${p?.id ?? ''}, 'K1', 0, true) returning id`)[0]?.id ?? ''
  await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${kurta}, ${stores.india}, 'INR', 100000)`
  await db.sql`insert into stock_level (version_id, warehouse_id, store_id, on_hand) select ${kurta}, w.id, ${stores.india}, 10 from warehouse w where w.store_id = ${stores.india} and w.is_default`
  await db.sql`insert into store_shipping (store_id, flat_enabled, flat_amount, pickup_enabled, pickup_hours, currency, area_mode, saved_at, revision)
    values (${stores.india}, true, 5000, false, null, 'INR', 'everywhere', now(), 1)`
  const person = async (storeId: string, email: string, role: string) => {
    const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, ${email}, 'P', 'active') returning id`
    await db.sql`insert into membership (user_id, store_id, role_key, status) values (${u?.id ?? ''}, ${storeId}, ${role}, 'active')`
    return withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId: t.partnerA }, new Date()))
  }
  cookies.owner = await person(stores.india, 'owner@jaipur.example', 'owner')
  cookies.staff = await person(stores.india, 'staff@jaipur.example', 'staff')
  cookies.other = await person(stores.other, 'owner@surat.example', 'owner')
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const shop = async (source: string, cart: string | null = null, host = live) => {
  const found = await resolveShopper(db.sql, new Request(`https://${host}/shop-api`, { headers: cart ? { 'x-shop-cart': cart } : {} }), host)
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = { sql: db.sql, shopper: found.shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.5', userAgent: null }, couriers: null, payments: wiring(), secrets, allowAttempt: async () => true, allowNewCart: async () => true, now: () => new Date() }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
const merchant = async (source: string, who: keyof typeof cookies, support?: 'read' | 'write') => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: who === 'other' ? stores.other : stores.india }
  const resolved = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, new Date(), activityLog, facts)
  const standing = support && resolved.kind === 'acting'
    ? { ...resolved, caller: { ...resolved.caller, context: { ...resolved.caller.context, caller: { kind: 'support' as const, supportSessionId: crypto.randomUUID(), partnerUserId: crypto.randomUUID(), access: support } } } }
    : resolved
  const contextValue: StoreContext = { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, payments: wiring(), secrets, host: 'store.acme.example', now: () => new Date() }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
const connectRazorpay = (mode: 'TEST' | 'LIVE', keys: string, who: keyof typeof cookies = 'owner') => merchant(`mutation { connectGateway(provider: "razorpay", mode: ${mode}, keys: { ${keys} }) }`, who)
const readyCart = async (contact: string, host = live) => {
  const token = ((await shop(`mutation { addToCart(versionId: "${kurta}", quantity: 1) { cartToken } }`, null, host)).data?.['addToCart'] as { cartToken: string }).cartToken
  await shop(`mutation { setCartContact(${contact}) { cart { id } } }`, token, host)
  await shop('mutation { setShippingAddress(address: { name: "Asha", line1: "12 MG Road", city: "Pune", region: "Maharashtra", postalCode: "411001", country: "IN" }) { cart { id } } }', token, host)
  await shop('mutation { setShippingOption(option: "flat") { cart { id } } }', token, host)
  await shop('mutation { checkout { id } }', token, host)
  return token
}
// What the hook's limiter answers; a test turns it off.
let hookAllowed = true
const hook = async (path: string, body: string, signature: string, gateways = wiring().gateways) => {
  const found = paymentHookOf(path)
  if (!found) return 404
  const request = new Request(`https://hooks.acme.example${path}`, { method: 'POST', body, headers: { 'x-razorpay-signature': signature } })
  return (await handlePaymentHook(request, found, { sql: db.sql, activity: activityLog, gateways, secrets, now: () => new Date() }, async () => hookAllowed)).status
}
let liveAccount = ''

describe('Connecting by keys', () => {
  it('checks the keys’ shape and mode, tries them with the provider, and refuses Staff', async () => {
    expect((await merchant('{ gateways { provider connectable } }', 'owner')).data?.['gateways']).toEqual([
      { provider: 'razorpay', connectable: true },
      { provider: 'cashfree', connectable: true },
      { provider: 'phonepe', connectable: true },
      { provider: 'cod', connectable: true },
      { provider: 'bank_transfer', connectable: true },
    ])
    expect((await connectRazorpay('LIVE', 'keyId: "rzp_test_abcdef", keySecret: "s", webhookSecret: "w"')).code).toBe('INVALID_KEYS')
    expect((await connectRazorpay('LIVE', 'keyId: "rzp_live_abcdef", keySecret: "s", webhookSecret: "w", appId: "x"')).code).toBe('INVALID_KEYS')
    expect((await connectRazorpay('LIVE', 'keyId: "rzp_live_abcdef", keySecret: "s"')).code).toBe('INVALID_KEYS')
    // Keys belong to a mode: one left out is refused, never taken as live.
    expect((await merchant('mutation { connectGateway(provider: "cashfree", keys: { appId: "app1", secretKey: "cfs" }) }', 'owner')).code).toBe('INVALID_KEYS')
    expect((await connectRazorpay('LIVE', 'keyId: "rzp_live_abcdef", keySecret: "wrong", webhookSecret: "w"')).code).toBe('KEYS_REFUSED')
    expect((await connectRazorpay('LIVE', 'keyId: "rzp_live_abcdef", keySecret: "s", webhookSecret: "w"', 'staff')).code).toBe('FORBIDDEN')
    expect(await db.sql`select 1 from payment_provider_account where provider = 'razorpay'`).toHaveLength(0)
  })

  it('seals the keys, shows the key id only, and gives each mode its own webhook address', async () => {
    expect((await connectRazorpay('LIVE', 'keyId: "rzp_live_abcdef", keySecret: "livesecret", webhookSecret: "livehook"')).data?.['connectGateway']).toBe(true)
    expect((await connectRazorpay('TEST', 'keyId: "rzp_test_abcdef", keySecret: "testsecret", webhookSecret: "testhook"')).data?.['connectGateway']).toBe(true)
    const rows = await db.sql<{ id: string; mode: string; public_key: string; credentials_enc: string }[]>`select id, mode, public_key, credentials_enc from payment_provider_account where provider = 'razorpay' order by mode`
    expect(rows.map((r) => [r.mode, r.public_key])).toEqual([['live', 'rzp_live_abcdef'], ['test', 'rzp_test_abcdef']])
    expect(rows.every((r) => r.credentials_enc.startsWith('v1.') && !r.credentials_enc.includes('secret'))).toBe(true)
    liveAccount = rows.find((r) => r.mode === 'live')?.id ?? ''
    const razor = ((await merchant('{ gateways { provider live connections { mode live webhookUrl } } }', 'owner')).data?.['gateways'] as { provider: string; connections: unknown[] }[]).find((g) => g.provider === 'razorpay')
    expect(razor?.connections).toEqual([
      { mode: 'live', live: true, webhookUrl: `https://hooks.acme.example/payments/razorpay/${liveAccount}` },
      { mode: 'test', live: true, webhookUrl: `https://hooks.acme.example/payments/razorpay/${rows.find((r) => r.mode === 'test')?.id ?? ''}` },
    ])
    // Another store's merchant sees none of it.
    // Another store's merchant sees none of it: no live flag, no connection, no webhook address.
    expect(((await merchant('{ gateways { provider live connections { mode webhookUrl } } }', 'other')).data?.['gateways'] as { live: boolean; connections: unknown[] }[]).every((g) => !g.live && g.connections.length === 0)).toBe(true)
    // A support session never pastes keys or disconnects, read or write; nothing changes.
    for (const access of ['read', 'write'] as const) {
      expect((await merchant('mutation { connectGateway(provider: "razorpay", mode: LIVE, keys: { keyId: "rzp_live_zzzzzz", keySecret: "x", webhookSecret: "y" }) }', 'owner', access)).code).toBe('SUPPORT_SESSION')
      expect((await merchant('mutation { disconnectGateway(provider: "razorpay") }', 'owner', access)).code).toBe('SUPPORT_SESSION')
    }
    expect((await db.sql<{ public_key: string; status: string }[]>`select public_key, status from payment_provider_account where store_id = ${stores.india} and provider = 'razorpay' and mode = 'live'`)[0]).toEqual({ public_key: 'rzp_live_abcdef', status: 'live' })
    expect((await db.sql<{ action: string; reason: string }[]>`select action, reason from activity_log where store_id = ${stores.india} and action = 'payment_method.turned_on' order by occurred_at`).map((r) => r.reason)).toEqual(['live', 'test'])
  })

  it('offers each storefront the key set of its own mode', async () => {
    expect((await shop('{ paymentOptions { provider mode publicKey } }')).data?.['paymentOptions']).toEqual([{ provider: 'razorpay', mode: 'live', publicKey: 'rzp_live_abcdef' }])
    expect((await shop('{ paymentOptions { provider mode publicKey } }', null, preview)).data?.['paymentOptions']).toEqual([{ provider: 'razorpay', mode: 'test', publicKey: 'rzp_test_abcdef' }])
  })
})

describe('Paying through Razorpay', () => {
  it('makes a Razorpay order with the store’s live keys, and settles from the store’s own signed webhook', async () => {
    const token = await readyCart('phone: "+919845022113"')
    const placed = (await shop('mutation { placeOrder(provider: "razorpay") { orderId payment { providerRef publicKey } } }', token)).data?.['placeOrder'] as { orderId: string; payment: { providerRef: string; publicKey: string } }
    expect(placed.payment.publicKey).toBe('rzp_live_abcdef')
    const made = orders.get(placed.payment.providerRef)
    const total = Number((await db.sql<{ total: string }[]>`select total_amount::text as total from "order" where id = ${placed.orderId}`)[0]?.total)
    expect(made).toEqual({ amount: total, currency: 'INR', paid: false, key: 'rzp_live_abcdef' })
    const body = JSON.stringify({ event: 'order.paid', payload: { order: { entity: { id: placed.payment.providerRef } } } })
    const path = `/payments/razorpay/${liveAccount}`
    // Signed with another secret: refused. An unknown account answers the same, so addresses can't be probed.
    expect(await hook(path, body, await hmacHex('testhook', body))).toBe(400)
    expect(await hook(`/payments/razorpay/${crypto.randomUUID()}`, body, await hmacHex('livehook', body))).toBe(400)
    expect(await hook('/payments/razorpay/not-an-id', body, '')).toBe(404)
    // Another store's own account, correctly signed with its own secret, can't settle this store's payment.
    expect((await merchant('mutation { connectGateway(provider: "razorpay", mode: LIVE, keys: { keyId: "rzp_live_surat01", keySecret: "s2", webhookSecret: "surathook" }) }', 'other')).data?.['connectGateway']).toBe(true)
    const otherAccount = (await db.sql<{ id: string }[]>`select id from payment_provider_account where store_id = ${stores.other} and provider = 'razorpay'`)[0]?.id ?? ''
    orders.set(placed.payment.providerRef, { ...(made ?? { amount: 0, currency: 'INR', key: '' }), paid: true })
    expect(await hook(`/payments/razorpay/${otherAccount}`, body, await hmacHex('surathook', body))).toBe(200)
    expect((await db.sql<{ payment_state: string }[]>`select payment_state from "order" where id = ${placed.orderId}`)[0]?.payment_state).toBe('pending')
    orders.set(placed.payment.providerRef, { ...(made ?? { amount: 0, currency: 'INR', key: '' }), paid: false })
    // Limited per account before anything is opened.
    hookAllowed = false
    expect(await hook(path, body, await hmacHex('livehook', body))).toBe(429)
    hookAllowed = true
    // A provider refusing its own check answers 400; a provider that can't be reached, 503 so it sends again.
    const failing = (error: Error) => ({ razorpay: { ...wiring().gateways.razorpay, available: () => true, start: async () => Promise.reject(error), outcome: async () => Promise.reject(error), webhook: async () => Promise.reject(error), refund: async () => Promise.reject(error) } })
    expect(await hook(path, body, '', failing(new PaymentRefused('400')))).toBe(400)
    expect(await hook(path, body, '', failing(new PaymentUnavailable('down')))).toBe(503)
    // Not paid yet: answered, nothing changes.
    expect(await hook(path, body, await hmacHex('livehook', body))).toBe(200)
    expect((await db.sql<{ payment_state: string }[]>`select payment_state from "order" where id = ${placed.orderId}`)[0]?.payment_state).toBe('pending')
    orders.set(placed.payment.providerRef, { ...(made ?? { amount: 0, currency: 'INR', key: '' }), paid: true })
    expect(await hook(path, body, await hmacHex('livehook', body))).toBe(200)
    expect((await db.sql`select payment_state, stock_reserved from "order" where id = ${placed.orderId}`)[0]).toEqual({ payment_state: 'paid', stock_reserved: true })
    expect((await db.sql<{ actor_id: string }[]>`select actor_id from activity_log where action = 'order.paid' and target_id = ${placed.orderId}`)[0]?.actor_id).toBe('razorpay')
  })

  it('answers 405 to anything but a POST and 413 to a body past 256 KB, unread', async () => {
    const path = `/payments/razorpay/${liveAccount}`
    const found = paymentHookOf(path)
    if (!found) throw new Error('no hook')
    const deps = { sql: db.sql, activity: activityLog, gateways: wiring().gateways, secrets, now: () => new Date() }
    expect((await handlePaymentHook(new Request(`https://hooks.acme.example${path}`), found, deps, async () => true)).status).toBe(405)
    expect((await handlePaymentHook(new Request(`https://hooks.acme.example${path}`, { method: 'POST', body: 'x'.repeat(300 * 1024) }), found, deps, async () => true)).status).toBe(413)
  })

  it('holds a Razorpay payment of a different amount for the merchant, from its webhook', async () => {
    const token = await readyCart('phone: "+919845022113"')
    const placed = (await shop('mutation { placeOrder(provider: "razorpay") { orderId payment { providerRef } } }', token)).data?.['placeOrder'] as { orderId: string; payment: { providerRef: string } }
    const made = orders.get(placed.payment.providerRef)
    orders.set(placed.payment.providerRef, { ...(made ?? { amount: 0, currency: 'INR', key: '' }), amount: 1, paid: true })
    const body = JSON.stringify({ event: 'order.paid', payload: { order: { entity: { id: placed.payment.providerRef } } } })
    expect(await hook(`/payments/razorpay/${liveAccount}`, body, await hmacHex('livehook', body))).toBe(200)
    expect((await db.sql`select o.payment_state, p.state from "order" o join payment p on p.order_id = o.id where o.id = ${placed.orderId}`)[0]).toEqual({ payment_state: 'pending', state: 'mismatch' })
  })

  it('takes a Cashfree payment end to end: the order made with the shopper’s number, settled from its signed webhook', async () => {
    await merchant('mutation { connectGateway(provider: "cashfree", mode: LIVE, keys: { appId: "app1", secretKey: "cfs" }) }', 'owner')
    const token = await readyCart('phone: "+919845022113"')
    const placed = (await shop('mutation { placeOrder(provider: "cashfree") { orderId payment { providerRef sessionId } } }', token)).data?.['placeOrder'] as { orderId: string; payment: { providerRef: string; sessionId: string } }
    expect(placed.payment.sessionId).toBe(`session_${placed.payment.providerRef}`)
    const [account] = await db.sql<{ id: string }[]>`select id from payment_provider_account where store_id = ${stores.india} and provider = 'cashfree' and mode = 'live'`
    const order = cashfreeOrders.get(placed.payment.providerRef)
    if (order) order.paid = true
    const body = JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: placed.payment.providerRef } } })
    const timestamp = String(Date.now())
    const path = `/payments/cashfree/${account?.id ?? ''}`
    const found = paymentHookOf(path)
    if (!found) throw new Error('no hook')
    const signed = (secret: string) => hmacBase64(secret, timestamp + body)
    const post = async (signature: string) =>
      (await handlePaymentHook(new Request(`https://hooks.acme.example${path}`, { method: 'POST', body, headers: { 'x-webhook-timestamp': timestamp, 'x-webhook-signature': signature } }), found, { sql: db.sql, activity: activityLog, gateways: wiring().gateways, secrets, now: () => new Date() }, async () => true)).status
    expect(await post(await signed('not-the-secret'))).toBe(400)
    expect((await db.sql<{ payment_state: string }[]>`select payment_state from "order" where id = ${placed.orderId}`)[0]?.payment_state).toBe('pending')
    expect(await post(await signed('cfs'))).toBe(200)
    expect((await db.sql<{ payment_state: string }[]>`select payment_state from "order" where id = ${placed.orderId}`)[0]?.payment_state).toBe('paid')
  })

  it('lets a Cashfree order try again with the number it was placed with', async () => {
    const token = await readyCart('phone: "+919845022113"')
    const placed = (await shop('mutation { placeOrder(provider: "cashfree") { orderId payment { providerRef } } }', token)).data?.['placeOrder'] as { orderId: string; payment: { providerRef: string } }
    const again = await shop(`mutation { payOrder(orderId: "${placed.orderId}") { providerRef sessionId } }`, token)
    expect(again.code).toBeUndefined()
    expect((again.data?.['payOrder'] as { providerRef: string }).providerRef).not.toBe(placed.payment.providerRef)
  })

  it('asks for a mobile number before Cashfree, which needs one', async () => {
    expect((await merchant('mutation { connectGateway(provider: "cashfree", mode: LIVE, keys: { appId: "app1", secretKey: "cfs" }) }', 'owner')).data?.['connectGateway']).toBe(true)
    const token = await readyCart('email: "asha@example.com"')
    expect((await shop('mutation { placeOrder(provider: "cashfree") { orderId } }', token)).code).toBe('PHONE_REQUIRED')
    // Nothing was placed: the cart is still there to add a number to.
    expect((await shop('{ cart { id } }', token)).data?.['cart']).not.toBeNull()
  })

  it('forgets the keys on Disconnect, so the old address no longer settles anything', async () => {
    expect((await merchant('mutation { disconnectGateway(provider: "razorpay") }', 'owner')).data?.['disconnectGateway']).toBe(true)
    expect(await db.sql`select mode, status, credentials_enc, public_key from payment_provider_account where store_id = ${stores.india} and provider = 'razorpay' order by mode`).toEqual([
      { mode: 'live', status: 'off', credentials_enc: null, public_key: null },
      { mode: 'test', status: 'off', credentials_enc: null, public_key: null },
    ])
    const body = JSON.stringify({ event: 'order.paid', payload: { order: { entity: { id: 'order_T1' } } } })
    expect(await hook(`/payments/razorpay/${liveAccount}`, body, await hmacHex('livehook', body))).toBe(400)
  })

  it('shows a provider with test keys only as not live, and a disconnected one with no connections', async () => {
    const razor = async () => ((await merchant('{ gateways { provider live connections { mode live } } }', 'owner')).data?.['gateways'] as { provider: string; live: boolean; connections: unknown[] }[]).find((g) => g.provider === 'razorpay')
    expect(await razor()).toEqual({ provider: 'razorpay', live: false, connections: [] })
    expect((await merchant('mutation { connectGateway(provider: "razorpay", mode: TEST, keys: { keyId: "rzp_test_abcdef", keySecret: "testsecret", webhookSecret: "testhook" }) }', 'owner')).data?.['connectGateway']).toBe(true)
    expect(await razor()).toEqual({ provider: 'razorpay', live: false, connections: [{ mode: 'test', live: true }] })
  })
})
