import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { CourierRejected, CourierUnavailable, type CourierDirectory, type CourierProvider, type Parcel } from '#core/couriers'
import type { CallerContext, SellerScope, TenantContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { createShippingService, type QuoteRequest } from '#engine/modules/shipping/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #305 (SAPI 23): what the shopper pays for delivery before checkout, for India and the US (SetOps Shipping;
// DATA-MODEL §7.2), and each store's settings its own.

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-07T09:00:00Z')
type Who = 'india' | 'us' | 'supplier' | 'manager' | 'other'
const people: Record<Who, string> = { india: '', us: '', supplier: '', manager: '', other: '' }
const cookies: Record<Who, string> = { india: '', us: '', supplier: '', manager: '', other: '' }
const stores = { india: '', us: '' }
let seller = ''

// What each courier answers, per test: a rate, a route it doesn't serve, a refused login or no answer.
type Answer = { rupees?: bigint; cents?: bigint } | 'unserved' | 'rejected' | 'down'
const answers: Partial<Record<CourierProvider, Answer>> = {}
const asked: { provider: CourierProvider; parcel: Parcel }[] = []
// The most couriers waiting on an answer at once, to show they're asked together, not one after another.
const inFlight = { now: 0, most: 0 }
const fakeCouriers = (accounts: ('shiprocket' | 'easypost')[]): CourierDirectory => ({
  forPartner: async () => ({
    accounts: new Set(accounts),
    gateway: {
      quote: async (provider, parcel) => {
        asked.push({ provider, parcel })
        inFlight.now += 1
        inFlight.most = Math.max(inFlight.most, inFlight.now)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight.now -= 1
        const answer = answers[provider] ?? 'unserved'
        if (answer === 'unserved') return null
        if (answer === 'rejected') throw new CourierRejected('login refused')
        if (answer === 'down') throw new CourierUnavailable('no answer')
        return answer.rupees !== undefined
          ? { amount: { amount: answer.rupees, currency: 'INR' }, service: 'Delhivery Surface', minDays: 3, maxDays: 5 }
          : { amount: { amount: answer.cents ?? 0n, currency: 'USD' }, service: 'Ground', minDays: 2, maxDays: 4 }
      },
      book: async () => null,
      pickup: async () => ({ ref: null, date: null }),
      readHook: async () => null,
    },
  }),
})
let couriers: CourierDirectory | null = fakeCouriers(['shiprocket', 'easypost'])

const user = async (partnerId: string, email: string, name: string) =>
  (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${name}, 'active') returning id`)[0]?.id ?? ''

const store = async (name: string, country: string, currency: string) => {
  const [row] = await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status) values (${t.partnerA}, ${name}, ${name.toLowerCase()}, ${country}, ${currency}, 'active') returning id`
  const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${t.partnerA}, ${`Plan ${name}`}, 'live') returning id`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${plan?.id ?? ''}, ${t.partnerA}, 1, 'products', 50)`
  await db.sql`update store set plan_id = ${plan?.id ?? ''} where id = ${row?.id ?? ''}`
  await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
    values (${row?.id ?? ''}, ${t.partnerA}, ${plan?.id ?? ''}, 1, 'active', 'month', ${currency}, 0, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)})`
  return row?.id ?? ''
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  stores.india = await store('Jaipur', 'IN', 'INR')
  stores.us = await store('Columbus', 'US', 'USD')
  await db.sql`update store set address = '{"street": "12 MI Road", "city": "Jaipur", "postal": "302001", "region": "Rajasthan"}' where id = ${stores.india}`
  const [s] = await db.sql<{ id: string }[]>`insert into seller (store_id, name, access_level, status) values (${stores.india}, 'Anand Textiles', 'vendor-orders-fulfil', 'active') returning id`
  seller = s?.id ?? ''
  people.india = await user(t.partnerA, 'owner@jaipur.example', 'Olivia')
  people.us = await user(t.partnerA, 'owner@columbus.example', 'Uma')
  people.supplier = await user(t.partnerA, 'anand@jaipur.example', 'Anand')
  people.manager = await user(t.partnerA, 'manager@jaipur.example', 'Mo')
  people.other = await user(t.partnerB, 'owner@b.example', 'Bea')
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people.india}, ${stores.india}, 'owner', 'active'), (${people.us}, ${stores.us}, 'owner', 'active'), (${people.manager}, ${stores.india}, 'manager', 'active'), (${people.other}, ${t.storeB1}, 'owner', 'active')`
  await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${people.supplier}, ${stores.india}, ${seller}, 'supplier-admin', 'active')`
  for (const who of Object.keys(cookies) as Who[]) {
    cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: who === 'other' ? t.partnerB : t.partnerA }, now))
  }
  await db.sql`insert into exchange_rate (currency, per_euro, source, published_on, fetched_at) values ('INR', '90', 'ecb', '2026-10-06', ${now}), ('USD', '1.08', 'ecb', '2026-10-06', ${now})`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const storeOf = (who: Who) => (who === 'us' ? stores.us : who === 'other' ? t.storeB1 : stores.india)
const gql = async (source: string, who: Who, variables: Record<string, unknown> = {}) => {
  const partnerId = who === 'other' ? t.partnerB : t.partnerA
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: storeOf(who), ...(who === 'supplier' ? { [supplierHeader]: seller } : {}) }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), partnerId, now, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId, sql: db.sql, activity: activityLog, facts, couriers, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, errors: result.errors }
}

type Settings = {
  revision: number; savedAt: string | null; currency: string; courierRate: boolean; flatRate: boolean; flatAmount: string | null; pickup: boolean; pickupHours: string | null
  pickupAddress: string | null; freeMode: string; freeThresholdAmount: string | null; areaMode: string; areaFileName: string | null; areaCount: number; areaSample: string[]; labelSizes: string[]
  couriers: { provider: string; status: string; offered: boolean; pickupMode: string; labelSize: string; trackingEmails: boolean; lastTestResult: string | null }[]
}
const settings = async (who: Who) =>
  (await gql('{ shippingSettings { revision savedAt currency courierRate flatRate flatAmount pickup pickupHours pickupAddress freeMode freeThresholdAmount areaMode areaFileName areaCount areaSample labelSizes couriers { provider status offered pickupMode labelSize trackingEmails lastTestResult } } }', who)).data?.['shippingSettings'] as Settings
const save = async (who: Who, input: Record<string, unknown>, revision?: number) =>
  gql('mutation S($r: Int!, $i: ShippingInput!) { saveShipping(revision: $r, input: $i) }', who, { r: revision ?? (await settings(who)).revision, i: { courierRate: false, flatRate: false, pickup: false, freeMode: 'never', areaMode: 'everywhere', ...input } })
const courier = (who: Who, mutation: 'connectCourier' | 'useCourierForPricing' | 'disconnectCourier', provider: string) => gql(`mutation { ${mutation}(provider: "${provider}") }`, who)

const callerOf = (storeId: string, partnerId = t.partnerA, sellerScope: SellerScope = { kind: 'all' }): TenantContext => ({
  caller: { kind: 'person', userId: people.india, sessionId: 's' },
  partnerId,
  storeId,
  sellerScope,
  subscription: 'active',
})
const versionOf = async (storeId: string, grams: number | null) => {
  const slug = `kurta-${crypto.randomUUID().slice(0, 8)}`
  const [product] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug) values (${storeId}, 'Kurta', ${slug}) returning id`
  const [version] = await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, weight_grams, position) values (${storeId}, ${product?.id ?? ''}, ${slug}, ${grams}, 0) returning id`
  return version?.id ?? ''
}
const quote = async (storeId: string, request: Partial<QuoteRequest> & Pick<QuoteRequest, 'lines'>, partnerId = t.partnerA) => {
  const partner = couriers ? await couriers.forPartner(partnerId) : null
  const service = createShippingService({ sql: db.sql, context: callerOf(storeId, partnerId), actor: { id: people.india, partnerId }, activity: activityLog, facts: { requestId: 'q', ip: null, userAgent: null }, now: () => now, couriers: partner })
  return service.quote({ shipTo: { country: 'IN', region: 'Maharashtra', postal: '400001' }, subtotal: { amount: 50000n, currency: 'INR' }, marketId: null, ...request })
}
const options = async (...args: Parameters<typeof quote>) => {
  const result = await quote(...args)
  if (!result.ok) return result.reason
  return { deliverable: result.value.deliverable, options: result.value.options.map((o) => [o.id, o.amount.amount, o.amount.currency, o.before?.amount ?? null]) }
}

describe('an Indian store', () => {
  it('starts with nothing saved: Shiprocket is offered on the partner’s account, not connected, and a cart gets no option yet', async () => {
    const s = await settings('india')
    expect(s).toMatchObject({ revision: 0, savedAt: null, currency: 'INR', freeMode: 'never', areaMode: 'everywhere', pickupAddress: '12 MI Road, Jaipur', labelSizes: ['a6', 'a4'] })
    expect(s.couriers).toEqual([{ provider: 'shiprocket', status: 'off', offered: true, pickupMode: 'scheduled', labelSize: 'a6', trackingEmails: true, lastTestResult: null }])
    const v = await versionOf(stores.india, 400)
    expect(await options(stores.india, { lines: [{ versionId: v, quantity: 1 }] })).toEqual({ deliverable: false, options: [] })
  })

  it('refuses a save offering nothing, and the courier’s rate with no courier pricing orders', async () => {
    expect((await save('india', {})).code).toBe('NO_METHOD')
    expect((await save('india', { courierRate: true })).code).toBe('NO_COURIER')
    expect((await save('india', { flatRate: true, flatAmount: '-5' })).code).toBe('INVALID_INPUT')
  })

  it('offers a flat rate and collection in person at once, free over ₹999 from the threshold itself', async () => {
    const saved = await save('india', { flatRate: true, flatAmount: '4900', pickup: true, pickupHours: 'Mon–Sat, 10 am – 6 pm', freeMode: 'over', freeThresholdAmount: '99900' })
    expect(saved.data?.['saveShipping']).toBe(1)
    expect(await settings('india')).toMatchObject({ revision: 1, savedAt: now.toISOString(), flatRate: true, flatAmount: '4900', pickup: true, pickupHours: 'Mon–Sat, 10 am – 6 pm', freeThresholdAmount: '99900' })
    const v = await versionOf(stores.india, 400)
    expect(await options(stores.india, { lines: [{ versionId: v, quantity: 1 }], subtotal: { amount: 99899n, currency: 'INR' } })).toEqual({ deliverable: true, options: [['flat', 4900n, 'INR', null], ['pickup', 0n, 'INR', null]] })
    expect(await options(stores.india, { lines: [{ versionId: v, quantity: 1 }], subtotal: { amount: 99900n, currency: 'INR' } })).toEqual({ deliverable: true, options: [['flat', 0n, 'INR', 4900n], ['pickup', 0n, 'INR', null]] })
  })

  it('refuses a save made on a revision someone saved since', async () => {
    expect((await save('india', { flatRate: true, flatAmount: '5900' }, 0)).code).toBe('STALE')
    expect((await settings('india')).flatAmount).toBe('4900')
  })

  it('connects Shiprocket on the partner’s account to price orders, and quotes the cart’s weight from the store’s postcode', async () => {
    expect((await courier('india', 'connectCourier', 'shiprocket')).data?.['connectCourier']).toBe('pricing')
    expect((await courier('india', 'connectCourier', 'usps')).code).toBe('INVALID_INPUT')
    expect((await save('india', { courierRate: true, flatAmount: '4900', pickup: true, pickupHours: 'Mon–Sat' })).code).toBeUndefined()
    answers.shiprocket = { rupees: 8500n }
    asked.length = 0
    const light = await versionOf(stores.india, 400)
    const unweighed = await versionOf(stores.india, null)
    expect(await options(stores.india, { lines: [{ versionId: light, quantity: 2 }, { versionId: unweighed, quantity: 1 }] })).toEqual({ deliverable: true, options: [['courier', 8500n, 'INR', null], ['pickup', 0n, 'INR', null]] })
    // A version with no weight counts as 500 g (decided on #305).
    expect(asked.map((a) => [a.provider, a.parcel.from.postal, a.parcel.to.postal, a.parcel.weightGrams])).toEqual([['shiprocket', '302001', '400001', 1300]])
  })

  it('falls back to the flat rate when the courier has no answer or serves no such route', async () => {
    const v = await versionOf(stores.india, 400)
    answers.shiprocket = 'down'
    expect((await options(stores.india, { lines: [{ versionId: v, quantity: 1 }] })) as { options: unknown[] }).toMatchObject({ options: [['flat', 4900n, 'INR', null], ['pickup', 0n, 'INR', null]] })
    answers.shiprocket = 'unserved'
    expect(((await options(stores.india, { lines: [{ versionId: v, quantity: 1 }] })) as { options: unknown[] }).options.map((o) => (o as unknown[])[0])).toEqual(['flat', 'pickup'])
  })

  it('delivers only to the postcodes uploaded, telling an address outside them it can only collect', async () => {
    expect((await gql('mutation { replaceDeliveryArea(fileName: "pins.csv", codes: ["400001", "12AB"]) }', 'india')).code).toBe('INVALID_INPUT')
    expect((await save('india', { flatRate: true, flatAmount: '4900', pickup: true, pickupHours: 'Mon–Sat', areaMode: 'list' })).code).toBe('NO_AREA_LIST')
    expect((await gql('mutation { replaceDeliveryArea(fileName: "pins.csv", codes: ["400 001", "400002", "400001"]) }', 'india')).data?.['replaceDeliveryArea']).toBe(2)
    expect((await save('india', { flatRate: true, flatAmount: '4900', pickup: true, pickupHours: 'Mon–Sat', areaMode: 'list' })).code).toBeUndefined()
    expect(await settings('india')).toMatchObject({ areaMode: 'list', areaFileName: 'pins.csv', areaCount: 2, areaSample: ['400001', '400002'] })
    const v = await versionOf(stores.india, 400)
    expect(await options(stores.india, { lines: [{ versionId: v, quantity: 1 }] })).toMatchObject({ deliverable: true })
    expect(await options(stores.india, { lines: [{ versionId: v, quantity: 1 }], shipTo: { country: 'IN', region: null, postal: '110001' } })).toEqual({ deliverable: false, options: [['pickup', 0n, 'INR', null]] })
    expect(await options(stores.india, { lines: [{ versionId: v, quantity: 1 }], shipTo: { country: 'US', region: 'OH', postal: '43215' }, subtotal: { amount: 2000n, currency: 'USD' } })).toEqual({ deliverable: false, options: [['pickup', 0n, 'USD', null]] })
    await save('india', { flatRate: true, flatAmount: '4900', pickup: true, pickupHours: 'Mon–Sat' })
  })

  it('charges a market’s own delivery charge in its currency, and converts the store’s flat rate for any other', async () => {
    const markets = (await gql('{ markets { nodes { id name countries currency language revision } } }', 'india')).data?.['markets'] as { nodes: { id: string; name: string; countries: string[]; currency: string; language: string; revision: number }[] }
    const home = markets.nodes[0]
    expect(home).toBeDefined()
    const saved = await gql('mutation M($id: ID, $r: Int, $i: MarketInput!) { saveMarket(id: $id, revision: $r, input: $i) { deliveryAmount } }', 'india', {
      id: home?.id, r: home?.revision, i: { name: home?.name, countries: home?.countries, currency: home?.currency, language: home?.language, deliveryAmount: '2900' },
    })
    expect(saved.data?.['saveMarket']).toEqual({ deliveryAmount: '2900' })
    const v = await versionOf(stores.india, 400)
    expect(((await options(stores.india, { lines: [{ versionId: v, quantity: 1 }], marketId: home?.id ?? null })) as { options: unknown[] }).options[0]).toEqual(['flat', 2900n, 'INR', null])
    // ₹49 at 90 rupees and 1.08 dollars to the euro.
    expect(((await options(stores.india, { lines: [{ versionId: v, quantity: 1 }], subtotal: { amount: 2000n, currency: 'USD' } })) as { options: unknown[] }).options[0]).toEqual(['flat', 59n, 'USD', null])
  })

  it('keeps shipping the Owner’s: a Manager and a supplier are refused, and a read refuses nothing to them only by permission', async () => {
    expect((await gql('{ shippingSettings { revision } }', 'manager')).code).toBe('FORBIDDEN')
    expect((await gql('{ shippingSettings { revision } }', 'supplier')).code).toBe('FORBIDDEN')
    expect((await save('supplier', { flatRate: true, flatAmount: '1' }, 2)).code).toBe('FORBIDDEN')
    expect((await courier('manager', 'disconnectCourier', 'shiprocket')).code).toBe('FORBIDDEN')
  })

  it('records every write in the store’s activity log', async () => {
    const actions = (await db.sql<{ action: string }[]>`select action from activity_log where store_id = ${stores.india} and action like any (array['shipping.%', 'courier.%']) order by occurred_at, action`).map((r) => r.action)
    expect(new Set(actions)).toEqual(new Set(['shipping.saved', 'courier.connected', 'shipping.area_replaced']))
  })
})

describe('a US store', () => {
  it('offers USPS, UPS and FedEx through EasyPost, labels 4 × 6 in or letter', async () => {
    const s = await settings('us')
    expect(s.labelSizes).toEqual(['4x6', 'letter'])
    expect(s.couriers.map((c) => [c.provider, c.status, c.offered, c.labelSize])).toEqual([['usps', 'off', true, '4x6'], ['ups', 'off', true, '4x6'], ['fedex', 'off', true, '4x6']])
  })

  it('needs the store’s postcode before couriers can quote', async () => {
    expect((await courier('us', 'connectCourier', 'usps')).data?.['connectCourier']).toBe('pricing')
    expect((await save('us', { courierRate: true })).code).toBe('NO_ADDRESS')
    expect((await gql('mutation { testCouriers { provider } }', 'us')).code).toBe('NO_ADDRESS')
    await db.sql`update store set address = '{"street": "1 High St", "city": "Columbus", "postal": "43215", "region": "OH"}' where id = ${stores.us}`
  })

  it('keeps one courier pricing: a new one waits on standby, takes over when asked, and hands back when disconnected', async () => {
    expect((await courier('us', 'connectCourier', 'ups')).data?.['connectCourier']).toBe('standby')
    expect((await courier('us', 'useCourierForPricing', 'ups')).code).toBeUndefined()
    expect((await settings('us')).couriers.map((c) => [c.provider, c.status])).toEqual([['usps', 'standby'], ['ups', 'pricing'], ['fedex', 'off']])
    expect((await courier('us', 'disconnectCourier', 'ups')).data?.['disconnectCourier']).toBe('usps')
    expect((await settings('us')).couriers.map((c) => [c.provider, c.status])).toEqual([['usps', 'pricing'], ['ups', 'off'], ['fedex', 'off']])
    expect((await courier('us', 'useCourierForPricing', 'fedex')).code).toBe('NOT_CONNECTED')
    expect((await gql('mutation { saveCourierOptions(provider: "usps", input: { pickupMode: "on_request", labelSize: "a6", trackingEmails: false }) }', 'us')).code).toBe('INVALID_INPUT')
    expect((await gql('mutation { saveCourierOptions(provider: "usps", input: { pickupMode: "on_request", labelSize: "letter", trackingEmails: false }) }', 'us')).code).toBeUndefined()
    expect((await settings('us')).couriers[0]).toMatchObject({ pickupMode: 'on_request', labelSize: 'letter', trackingEmails: false })
  })

  it('quotes the pricing courier, then the next connected one, in dollars', async () => {
    await courier('us', 'connectCourier', 'fedex')
    expect((await save('us', { courierRate: true })).code).toBeUndefined()
    const v = await versionOf(stores.us, 900)
    const us = { shipTo: { country: 'US', region: 'CA', postal: '94103-1234' }, subtotal: { amount: 4500n, currency: 'USD' } }
    answers.usps = { cents: 685n }
    answers.fedex = { cents: 1205n }
    asked.length = 0
    expect(await options(stores.us, { lines: [{ versionId: v, quantity: 1 }], ...us })).toEqual({ deliverable: true, options: [['courier', 685n, 'USD', null]] })
    // Every connected courier is asked at once; the pricing one's rate wins when it has one.
    expect(asked.map((a) => [a.provider, a.parcel.to.postal])).toEqual([['usps', '94103'], ['fedex', '94103']])
    expect(inFlight.most).toBe(2)
    answers.usps = 'rejected'
    expect(await options(stores.us, { lines: [{ versionId: v, quantity: 1 }], ...us })).toEqual({ deliverable: true, options: [['courier', 1205n, 'USD', null]] })
    // No courier and no flat amount: nothing to offer, which checkout tells the shopper.
    answers.fedex = 'down'
    expect(await options(stores.us, { lines: [{ versionId: v, quantity: 1 }], ...us })).toEqual({ deliverable: true, options: [] })
  })

  it('tests every connected courier with a parcel to its own postcode, showing a refused login as failed', async () => {
    answers.usps = 'rejected'
    answers.fedex = { cents: 900n }
    inFlight.most = 0
    const tested = (await gql('mutation { testCouriers { provider result } }', 'us')).data?.['testCouriers']
    expect(inFlight.most).toBe(2)
    expect(tested).toEqual([{ provider: 'usps', result: 'rejected' }, { provider: 'fedex', result: 'ok' }])
    expect((await settings('us')).couriers.map((c) => [c.provider, c.status, c.lastTestResult])).toEqual([['usps', 'failed', 'rejected'], ['ups', 'off', null], ['fedex', 'standby', 'ok']])
  })

  it('switches the courier’s rate off when its last courier goes, so checkout never offers a rate nothing quotes', async () => {
    const before = (await settings('us')).revision
    expect((await courier('us', 'disconnectCourier', 'fedex')).data?.['disconnectCourier']).toBeNull()
    expect((await settings('us')).courierRate).toBe(true)
    expect((await courier('us', 'disconnectCourier', 'usps')).data?.['disconnectCourier']).toBeNull()
    expect(await settings('us')).toMatchObject({ courierRate: false, revision: before + 1 })
    const reasons = await db.sql<{ reason: string | null }[]>`select reason from activity_log where store_id = ${stores.us} and action = 'courier.disconnected' order by occurred_at desc limit 1`
    expect(reasons[0]?.reason).toBe('courier rate off')
    await courier('us', 'connectCourier', 'usps')
    await courier('us', 'connectCourier', 'fedex')
  })

  it('can’t connect a courier its partner has no account for (#275 stores them)', async () => {
    couriers = fakeCouriers(['shiprocket'])
    expect((await settings('us')).couriers.every((c) => !c.offered)).toBe(true)
    expect((await courier('us', 'connectCourier', 'ups')).code).toBe('COURIER_NOT_OFFERED')
    couriers = null
    expect((await courier('us', 'connectCourier', 'ups')).code).toBe('COURIER_NOT_OFFERED')
    couriers = fakeCouriers(['shiprocket', 'easypost'])
  })
})

describe('isolation', () => {
  it('shows a store only its own shipping, couriers and postcodes, even by count', async () => {
    const counts = (context: CallerContext) =>
      withScope(db.sql, context, async (tx) => (await tx<{ n: number }[]>`select (select count(*) from store_shipping) + (select count(*) from store_courier) + (select count(*) from delivery_postal_code) as n`)[0]?.n)
    expect(Number(await counts(callerOf(stores.india)))).toBeGreaterThan(0)
    expect(Number(await counts(callerOf(t.storeB1, t.partnerB)))).toBe(0)
    // A supplier's role holds no grant on them at all (ACCESS §5.2: no shipping configuration for a vendor).
    await expect(counts(callerOf(stores.india, t.partnerA, { kind: 'seller', sellerId: seller }))).rejects.toThrow(/permission denied/)
    await db.sql`update store set pricing_currency = 'EUR', country = 'DE' where id = ${t.storeB1}`
    expect((await gql('{ shippingSettings { revision areaCount couriers { status } } }', 'other')).data?.['shippingSettings']).toEqual({ revision: 0, areaCount: 0, couriers: [] })
  })

  it('never lets another store write this store’s rows, nor a read-only support session write its own', async () => {
    await withScope(db.sql, callerOf(t.storeB1, t.partnerB), (tx) => tx`update store_shipping set flat_amount = 1 where store_id = ${stores.india}`)
    expect((await db.sql<{ flat_amount: string }[]>`select flat_amount::text from store_shipping where store_id = ${stores.india}`)[0]?.flat_amount).toBe('4900')
    const support: CallerContext = { caller: { kind: 'support', supportSessionId: 'ss', partnerUserId: 'pu', access: 'read' }, partnerId: t.partnerA, storeId: stores.india, sellerScope: { kind: 'all' }, subscription: 'active' }
    await expect(withScope(db.sql, support, (tx) => tx`update store_shipping set flat_amount = 1 where store_id = ${stores.india}`)).rejects.toThrow(/row-level security/)
    await expect(withScope(db.sql, support, (tx) => tx`delete from delivery_postal_code where store_id = ${stores.india}`)).resolves.toHaveLength(0)
    expect(Number((await db.sql<{ n: string }[]>`select count(*)::text as n from delivery_postal_code where store_id = ${stores.india}`)[0]?.n)).toBe(2)
  })

  it('checks a postcode against the list without reading it, and only for the acting store', async () => {
    const listed = (storeId: string, code: string) => withScope(db.sql, callerOf(storeId), async (tx) => (await tx<{ l: boolean }[]>`select store_delivers_to(${code}) as l`)[0]?.l)
    expect([await listed(stores.india, '400001'), await listed(stores.india, '110001'), await listed(stores.us, '400001')]).toEqual([true, false, false])
    await expect(withScope(db.sql, callerOf(stores.india, t.partnerA, { kind: 'seller', sellerId: seller }), (tx) => tx`select store_delivers_to('400001')`)).rejects.toThrow(/permission denied/)
  })

  it('prices only the store’s own versions and markets: another store’s are not found', async () => {
    const theirs = await versionOf(stores.us, 400)
    expect(await options(stores.india, { lines: [{ versionId: theirs, quantity: 1 }] })).toBe('NOT_FOUND')
    const usMarket = (await db.sql<{ id: string }[]>`select id from market where store_id = ${stores.us} limit 1`)[0]?.id ?? null
    const mine = await versionOf(stores.india, 400)
    expect(await options(stores.india, { lines: [{ versionId: mine, quantity: 1 }], marketId: usMarket })).toBe('NOT_FOUND')
  })
})

describe('a market’s delivery charge when its currency changes', () => {
  const homeOf = async () =>
    (await db.sql<{ id: string; currency: string; delivery_amount: string | null }[]>`select id, currency::text as currency, delivery_amount::text as delivery_amount from market where store_id = ${stores.india} and is_primary`)[0]

  it('drops the charge of a market whose currency the store stops selling in', async () => {
    const [plan] = await db.sql<{ plan_id: string }[]>`select plan_id from store where id = ${stores.india}`
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${plan?.plan_id ?? ''}, ${t.partnerA}, 1, 'currencies', 3) on conflict do nothing`
    expect((await gql('mutation { saveCurrencies(currencies: [{ code: "USD", mode: "convert", rounding: "none" }]) }', 'india')).code).toBeUndefined()
    const language = (await db.sql<{ l: string }[]>`select main_language as l from store where id = ${stores.india}`)[0]?.l
    const saved = await gql('mutation M($i: MarketInput!) { saveMarket(input: $i) { id deliveryAmount currency } }', 'india', { i: { name: 'USA', countries: ['US'], currency: 'USD', language, deliveryAmount: '500' } })
    const usa = saved.data?.['saveMarket'] as { id: string; deliveryAmount: string; currency: string }
    expect(usa).toMatchObject({ deliveryAmount: '500', currency: 'USD' })
    expect((await gql('mutation { saveCurrencies(currencies: []) }', 'india')).code).toBeUndefined()
    const moved = (await db.sql<{ currency: string; delivery_amount: string | null }[]>`select currency::text as currency, delivery_amount::text as delivery_amount from market where id = ${usa.id}`)[0]
    expect(moved).toEqual({ currency: 'INR', delivery_amount: null })
  })

  it('drops the charge of a market that follows the pricing currency to another', async () => {
    expect((await homeOf())?.delivery_amount).toBe('2900')
    await db.sql`update store set pricing_currency = 'USD' where id = ${stores.india}`
    expect(await homeOf()).toMatchObject({ currency: 'USD', delivery_amount: null })
    await db.sql`update store set pricing_currency = 'INR' where id = ${stores.india}`
  })
})
