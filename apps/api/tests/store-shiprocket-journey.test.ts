import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { secretBox, type SecretBox } from '#auth/secretBox'
import { resolveStoreStanding, storeHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import type { CourierDirectory } from '#core/couriers'
import { withSystemScope } from '#db/scoped/index'
import type { AssetStore } from '#engine/modules/catalog/index'
import { createShippingService } from '#engine/modules/shipping/index'
import { courierHookOf, handleCourierHook } from '#hooks/couriers'
import { storeCourierAccounts } from '#integrations/couriers/accounts'
import { courierDirectory } from '#integrations/couriers/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// #1489 end to end: one Indian store connects its own Shiprocket API user, checkout quotes through it, a label and its
// pickup are booked on it, its own tracking hook moves the parcel, and Disconnect takes it all away again. The database,
// row security, directory, adapters and hook are the real ones; only Shiprocket's HTTP answers are faked.

let db: TestDatabase
let t: Tenants
let secrets: SecretBox
let ownerCookie = ''
let main = ''
let house = ''

const login = { email: 'api-user@jaipurlooms.example', password: 'S3cret!pass', webhookToken: 'hook-token-jl' }

// Shiprocket: a login hands back a token naming who logged in, and every later call is held to it.
const calls: { path: string; bearer: string | null }[] = []
const shiprocket: typeof fetch = async (input, init) => {
  const url = new URL(String(input))
  const path = url.pathname.replace('/v1/external', '')
  const bearer = new Headers(init?.headers).get('authorization')
  if (path === '/auth/login') {
    const body = JSON.parse(String(init?.body)) as { email: string; password: string }
    return body.email === login.email && body.password === login.password ? Response.json({ token: `tok:${body.email}` }) : Response.json({ message: 'Invalid email and password combination' }, { status: 403 })
  }
  if (url.hostname.endsWith('.amazonaws.com')) return new Response('%PDF-1.4 label', { headers: { 'content-type': 'application/pdf' } })
  calls.push({ path, bearer })
  switch (path) {
    case '/courier/serviceability/':
      return Response.json({ data: { available_courier_companies: [{ courier_name: 'Delhivery Surface', rate: 85, estimated_delivery_days: 3 }] } })
    case '/settings/company/addpickup':
      return Response.json({})
    case '/orders/create/adhoc':
      return Response.json({ shipment_id: 9001 })
    case '/courier/assign/awb':
      return Response.json({ response: { data: { awb_code: 'SRAWB1001', courier_name: 'Delhivery' } } })
    case '/courier/generate/label':
      return Response.json({ label_url: 'https://label.s3.amazonaws.com/l.pdf' })
    case '/courier/generate/pickup':
      return Response.json({ response: { pickup_scheduled_date: '2026-10-13 00:00:00', pickup_token_number: 'PU-77' } })
    default:
      return new Response(null, { status: 404 })
  }
}
const couriers = (): CourierDirectory => courierDirectory(storeCourierAccounts(db.sql, secrets), shiprocket)
const files: AssetStore = { put: async () => undefined, get: async () => null }
const now = new Date()

const gql = async (source: string, variables: Record<string, unknown> = {}) => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers = { cookie: `${storeCookieName}=${ownerCookie}`, [storeHeader]: t.storeA1 }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, now, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, couriers: couriers(), secrets, files, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, errors: result.errors }
}
const connect = (email: string, password: string, webhookToken: string | null = null) =>
  gql('mutation C($e: String, $p: String, $t: String) { connectCourier(provider: "shiprocket", email: $e, password: $p, webhookToken: $t) }', { e: email, p: password, t: webhookToken })
const courierView = async () => (((await gql('{ shippingSettings { revision courierRate couriers { provider status offered accountEmail lastTestResult } } }')).data?.['shippingSettings']) as { revision: number; courierRate: boolean; couriers: { provider: string; status: string; offered: boolean; accountEmail: string | null; lastTestResult: string | null }[] })
const accounts = () => db.sql<{ email: string; credentials_sealed: string }[]>`select email, credentials_sealed from courier_account where store_id = ${t.storeA1}`
const hook = async (storeId: string, token: string, awb: string, status: string) => {
  const path = `/couriers/shiprocket/${storeId}`
  const found = courierHookOf(path)
  if (!found) return 404
  const body = JSON.stringify({ awb, current_status: status, current_timestamp: '2026-10-12 11:00:00' })
  const request = new Request(`https://hooks.example${path}`, { method: 'POST', body, headers: { 'x-api-key': token } })
  return (await handleCourierHook(request, found, { sql: db.sql, activity: activityLog, couriers: couriers() }, async () => true)).status
}
const quote = async () => {
  const directory = couriers()
  const context = { caller: { kind: 'shopper' as const, customerId: null }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' as const }, subscription: 'active' as const }
  const service = createShippingService({ sql: db.sql, context, actor: { id: 'shopper', partnerId: t.partnerA }, activity: activityLog, facts: { requestId: 'q', ip: null, userAgent: null }, now: () => now, couriers: await directory.forStore(t.storeA1) })
  const result = await service.quote({ lines: [{ versionId: house, quantity: 1 }], shipTo: { country: 'IN', region: 'Maharashtra', postal: '400001' }, subtotal: { amount: 50000n, currency: 'INR' }, marketId: null })
  return result.ok ? result.value.options.map((o) => [o.id, o.amount.amount]) : result.reason
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  secrets = await secretBox(btoa('k'.repeat(32)))
  await db.sql`update store set country = 'IN', pricing_currency = 'INR', address = ${db.sql.json({ street: '4 Johari Bazaar', city: 'Jaipur', postal: '302003', region: 'Rajasthan' })} where id = ${t.storeA1}`
  main = (await db.sql<{ id: string }[]>`select id from warehouse where store_id = ${t.storeA1} and seller_id is null and is_default`)[0]?.id ?? ''
  const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${t.storeA1}, 'house', 'house', 'visible') returning id`
  house = (await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position, track_stock, weight_grams) values (${t.storeA1}, ${p?.id ?? ''}, 'house', 0, false, 400) returning id`)[0]?.id ?? ''
  const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, 'owner@jaipurlooms.example', 'Olivia', 'active') returning id`
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${u?.id ?? ''}, ${t.storeA1}, 'owner', 'active')`
  ownerCookie = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId: t.partnerA }, now))
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('a store connects its own Shiprocket, and uses it from checkout to tracking', () => {
  let fulfilmentId = ''

  it('starts with Shiprocket offered to connect and no login', async () => {
    expect((await courierView()).couriers).toEqual([{ provider: 'shiprocket', status: 'off', offered: true, accountEmail: null, lastTestResult: null }])
    expect(await accounts()).toEqual([])
  })

  it('refuses a login Shiprocket does not accept, saving nothing', async () => {
    const refused = await connect(login.email, 'not-the-password')
    expect(refused.code).toBe('LOGIN_REFUSED')
    expect(await accounts()).toEqual([])
    expect((await courierView()).couriers[0]).toMatchObject({ status: 'off', accountEmail: null })
  })

  it('connects with the right login: pricing, its email shown, the password sealed and never returned', async () => {
    expect((await connect(login.email, login.password, login.webhookToken)).data?.['connectCourier']).toBe('pricing')
    expect((await courierView()).couriers[0]).toEqual({ provider: 'shiprocket', status: 'pricing', offered: true, accountEmail: login.email, lastTestResult: 'ok' })
    const [row] = await accounts()
    expect(row?.credentials_sealed).toMatch(/^v1\./)
    expect(JSON.stringify(row)).not.toContain(login.password)
    expect(JSON.stringify(await courierView())).not.toContain(login.password)
  })

  it('prices checkout through the store’s own login once the courier rate is on', async () => {
    const view = await courierView()
    const saved = await gql('mutation S($r: Int!) { saveShipping(revision: $r, input: { courierRate: true, flatRate: true, flatAmount: "4900", pickup: false, freeMode: "never", areaMode: "everywhere" }) }', { r: view.revision })
    expect(saved.code).toBeUndefined()
    calls.length = 0
    // The courier's rate through the store's login, beside the flat rate the store also offers.
    expect(await quote()).toEqual([['courier', 8500n], ['flat', 4900n]])
    expect(calls.map((c) => c.bearer)).toEqual([`Bearer tok:${login.email}`])
  })

  it('books a label and its pickup on the store’s own login, and tests the courier from the store’s postcode', async () => {
    const [o] = await db.sql<{ id: string }[]>`
      insert into "order" (store_id, state, payment_state, currency, number, placed_at, total_amount, payment_method, shipping_option, email, phone, shipping_address)
      values (${t.storeA1}, 'placed', 'paid', 'INR', 'JL-1', now(), 1000, 'stripe', 'courier', 'priya@example.com', '+919800000001',
        ${db.sql.json({ name: 'Priya Shah', line1: '1 MG Road', line2: null, city: 'Pune', region: 'Maharashtra', postalCode: '411001', country: 'IN', phone: '+919800000001' })}) returning id`
    const orderId = o?.id ?? ''
    await db.sql`insert into order_line (order_id, store_id, version_id, product_id, name, quantity, unit_amount, line_total_amount, position)
      select ${orderId}, ${t.storeA1}, v.id, v.product_id, 'Kurta', 1, 49900, 49900, 0 from product_version v where v.id = ${house}`
    await db.sql`insert into order_part (order_id, store_id, seller_id, shipping_mode) values (${orderId}, ${t.storeA1}, null, 'store')`
    await db.sql`insert into payment (order_id, store_id, provider, kind, state, amount, currency, mode) values (${orderId}, ${t.storeA1}, 'stripe', 'card', 'captured', 1000, 'INR', 'live')`
    const line = (await db.sql<{ id: string }[]>`select id from order_line where order_id = ${orderId}`)[0]?.id ?? ''
    calls.length = 0
    const booked = await gql(`mutation { bookLabel(orderId: "${orderId}", warehouseId: "${main}", courier: "shiprocket", lines: [{ lineId: "${line}", quantity: 1 }]) }`)
    expect(booked.errors?.map((e) => e.message)).toBeUndefined()
    fulfilmentId = String(booked.data?.['bookLabel'])
    expect(calls.map((c) => c.path)).toEqual(['/settings/company/addpickup', '/orders/create/adhoc', '/courier/assign/awb', '/courier/generate/label', '/courier/generate/pickup'])
    expect(new Set(calls.map((c) => c.bearer))).toEqual(new Set([`Bearer tok:${login.email}`]))
    const [f] = await db.sql<{ tracking_number: string; courier_provider: string; provider_ref: string }[]>`select tracking_number, courier_provider, provider_ref from fulfilment where id = ${fulfilmentId}`
    expect(f).toEqual({ tracking_number: 'SRAWB1001', courier_provider: 'shiprocket', provider_ref: '9001' })

    calls.length = 0
    const tested = await gql('mutation { testCouriers { provider result } }')
    expect(tested.data?.['testCouriers']).toEqual([{ provider: 'shiprocket', result: 'ok' }])
    expect(calls.map((c) => c.bearer)).toEqual([`Bearer tok:${login.email}`])
  })

  it('moves the parcel on with the store’s own tracking token, and refuses any other store’s or a wrong one', async () => {
    expect(await hook(t.storeA1, 'wrong-token', 'SRAWB1001', 'DELIVERED')).toBe(400)
    expect(await hook(t.storeA2, login.webhookToken, 'SRAWB1001', 'DELIVERED')).toBe(400)
    expect(await hook(t.storeA1, login.webhookToken, 'SRAWB1001', 'DELIVERED')).toBe(200)
    const [f] = await db.sql<{ tracking_status: string | null }[]>`select tracking_status from fulfilment where id = ${fulfilmentId}`
    expect(f?.tracking_status).toBe('delivered')
  })

  it('disconnects: the login goes, checkout falls back to the flat rate, and nothing can book or track through it', async () => {
    const gone = await gql('mutation { disconnectCourier(provider: "shiprocket") }')
    expect(gone.errors).toBeUndefined()
    expect(await accounts()).toEqual([])
    expect((await courierView()).couriers[0]).toMatchObject({ status: 'off', accountEmail: null })
    calls.length = 0
    expect(await quote()).toEqual([['flat', 4900n]])
    expect(calls).toEqual([])
    expect(await hook(t.storeA1, login.webhookToken, 'SRAWB1001', 'DELIVERED')).toBe(400)
    const again = await gql(`mutation { bookLabel(orderId: "${crypto.randomUUID()}", warehouseId: "${main}", courier: "shiprocket", lines: []) }`)
    expect(again.code).toBeDefined()
  })

  it('records connect, test and disconnect in the activity log, never the login', async () => {
    const entries = await db.sql<{ action: string }[]>`select action from activity_log where store_id = ${t.storeA1} and action like 'courier.%' order by occurred_at`
    expect(new Set(entries.map((e) => e.action))).toEqual(new Set(['courier.connected', 'courier.tested', 'courier.disconnected']))
    const all = JSON.stringify(await db.sql`select * from activity_log where store_id = ${t.storeA1}`)
    for (const secret of [login.password, login.webhookToken]) expect(all).not.toContain(secret)
  })
})
