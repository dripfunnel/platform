import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import { ratesRefreshDeliverer, ratesRefreshKind } from '#jobs/queues/deliverers/ratesRefresh'
import type { Effect } from '#jobs/queues/outbox-relay'
import { queueRatesRefresh } from '#jobs/queues/ratesSchedule'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #296 (SAPI 6, part 2): a product's price in each of the store's currencies and in a market, read back
// per market (CATALOG facts 25–26, O2, O10–O11, O14), and the reference rates they're converted at.

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-05T09:00:00Z')
type Who = 'owner' | 'supplier' | 'bOwner'
const people: Record<Who, string> = { owner: '', supplier: '', bOwner: '' }
const cookies: Record<Who, string> = { owner: '', supplier: '', bOwner: '' }

const effect: Effect = { id: 'e1', kind: ratesRefreshKind, idempotencyKey: 'rates:1', payload: {}, partnerId: null, storeId: null, attempt: 1 }
const user = async (partnerId: string, email: string, name: string) =>
  (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${name}, 'active') returning id`)[0]?.id ?? ''

const subscribe = async (storeId: string, partnerId: string) => {
  const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${partnerId}, ${`Plan ${storeId.slice(0, 6)}`}, 'live') returning id`
  for (const [key, amount] of Object.entries({ products: 50, languages: 3, currencies: 4 })) {
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${plan?.id ?? ''}, ${partnerId}, 1, ${key}, ${amount})`
  }
  await db.sql`update store set plan_id = ${plan?.id ?? ''}, pricing_currency = 'INR' where id = ${storeId}`
  await db.sql`delete from store_subscription where store_id = ${storeId}`
  await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
    values (${storeId}, ${partnerId}, ${plan?.id ?? ''}, 1, 'active', 'month', 'INR', 0, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)})`
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await subscribe(t.storeA1, t.partnerA)
  await subscribe(t.storeB1, t.partnerB)
  await db.sql`update seller set access_level = 'vendor-catalogue' where id = ${t.sellerA1First}`
  people.owner = await user(t.partnerA, 'owner@a.example', 'Olivia')
  people.supplier = await user(t.partnerA, 'anand@a.example', 'Anand')
  people.bOwner = await user(t.partnerB, 'owner@b.example', 'Bea')
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people.owner}, ${t.storeA1}, 'owner', 'active'), (${people.bOwner}, ${t.storeB1}, 'owner', 'active')`
  await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${people.supplier}, ${t.storeA1}, ${t.sellerA1First}, 'supplier-admin', 'active')`
  for (const who of Object.keys(cookies) as Who[]) {
    cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: who === 'bOwner' ? t.partnerB : t.partnerA }, now))
  }
  await ratesRefreshDeliverer(db.sql, { fetch: async () => ({ publishedOn: '2026-10-02', perEuro: { INR: '90', USD: '1.08' } }) }, () => now).deliver(effect, AbortSignal.timeout(1000))
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const gql = async (source: string, who: Who, variables: Record<string, unknown> = {}) => {
  const partnerId = who === 'bOwner' ? t.partnerB : t.partnerA
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: who === 'bOwner' ? t.storeB1 : t.storeA1, ...(who === 'supplier' ? { [supplierHeader]: t.sellerA1First } : {}) }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), partnerId, now, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId, sql: db.sql, activity: activityLog, facts, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, errors: result.errors }
}

type Price = { currency: string; amount: string | null; compareAtAmount: string | null; source: string | null }
type Pricing = { versionId: string; prices: Price[]; inMarket: Price | null }[] | null
const pricingOf = async (id: string, marketId?: string, who: Who = 'owner') =>
  (await gql('query P($id: ID!, $m: ID) { product(id: $id) { pricing(marketId: $m) { versionId prices { currency amount compareAtAmount source } inMarket { currency amount compareAtAmount source } } } }', who, { id, m: marketId })).data?.['product'] as { pricing: Pricing } | null
const saveProduct = async (who: Who, prices: Record<string, unknown>[], id?: string) => {
  const current = id ? ((await gql('query P($id: ID!) { product(id: $id) { revision versions { id } } }', who, { id })).data?.['product'] as { revision: number; versions: { id: string }[] }) : null
  return gql('mutation S($id: ID, $revision: Int, $input: ProductInput!) { saveProduct(id: $id, revision: $revision, input: $input) { id } }', who, {
    id,
    revision: current?.revision,
    input: { name: 'Linen kurta', options: [], versions: [{ id: current?.versions[0]?.id, choices: [], prices }] },
  })
}

describe('a product’s price in each currency', () => {
  let kurta = ''

  it('converts a converted currency at the reference rate, compare-at too, and leaves a typed-only one for sale only once typed', async () => {
    expect((await gql('mutation C($c: [StoreCurrencyInput!]!) { saveCurrencies(currencies: $c) }', 'owner', { c: [{ code: 'USD', mode: 'convert', rounding: 'ends-99' }, { code: 'EUR', mode: 'manual' }] })).code).toBeUndefined()
    kurta = ((await saveProduct('owner', [{ currency: 'INR', amount: '129900', compareAtAmount: '159900' }])).data?.['saveProduct'] as { id: string }).id
    const [version] = (await pricingOf(kurta))?.pricing ?? []
    expect(version?.prices).toEqual([
      { currency: 'INR', amount: '129900', compareAtAmount: '159900', source: 'typed' },
      { currency: 'USD', amount: '1599', compareAtAmount: '1999', source: 'converted' },
      { currency: 'EUR', amount: null, compareAtAmount: null, source: null },
    ])
  })

  it('keeps a typed price as an override, whether the currency converts or not (O10)', async () => {
    await saveProduct('owner', [{ currency: 'INR', amount: '129900', compareAtAmount: '159900' }, { currency: 'USD', amount: '1499' }, { currency: 'EUR', amount: '1450' }], kurta)
    expect((await pricingOf(kurta))?.pricing?.[0]?.prices.map((p) => [p.currency, p.amount, p.source])).toEqual([['INR', '129900', 'typed'], ['USD', '1499', 'typed'], ['EUR', '1450', 'typed']])
    await gql('mutation C($c: [StoreCurrencyInput!]!) { saveCurrencies(currencies: $c) }', 'owner', { c: [{ code: 'USD', mode: 'manual' }, { code: 'EUR', mode: 'convert' }] })
    // EUR now converts, but the typed 14.50 stays; USD is typed-only, and its typed price still sells.
    expect((await pricingOf(kurta))?.pricing?.[0]?.prices.map((p) => [p.currency, p.amount, p.source])).toEqual([['INR', '129900', 'typed'], ['USD', '1499', 'typed'], ['EUR', '1450', 'typed']])
  })

  it('reads a product back per market: its currency’s price, moved by the market’s adjustment and rounded', async () => {
    const europe = (await gql('mutation S($input: MarketInput!) { saveMarket(input: $input) { id } }', 'owner', { input: { name: 'Europe', countries: ['DE', 'FR'], currency: 'EUR', language: 'en-US', priceAdjustmentBps: 1000 } })).data?.['saveMarket'] as { id: string }
    // 14.50 EUR + 10% is 15.95, rounded up to 15.99 as EUR rounds.
    expect((await pricingOf(kurta, europe.id))?.pricing?.[0]?.inMarket).toEqual({ currency: 'EUR', amount: '1599', compareAtAmount: null, source: 'typed' })
    const home = ((await gql('{ markets { nodes { id primary } } }', 'owner')).data?.['markets'] as { nodes: { id: string; primary: boolean }[] }).nodes.find((m) => m.primary)
    expect((await pricingOf(kurta, home?.id))?.pricing?.[0]?.inMarket).toEqual({ currency: 'INR', amount: '129900', compareAtAmount: '159900', source: 'typed' })
    // Another store's market prices nothing here.
    const theirs = (await gql('{ markets { nodes { id } } }', 'bOwner')).data?.['markets'] as { nodes: { id: string }[] }
    expect((await pricingOf(kurta, theirs.nodes[0]?.id))?.pricing).toBeNull()
  })

  it('shows the rates in use, and keeps the store’s other currencies the merchant’s (O14)', async () => {
    const rates = ((await gql('{ storeLocale { rates { currency perEuro publishedOn } } }', 'owner')).data?.['storeLocale'] as { rates: { currency: string; perEuro: string; publishedOn: string }[] }).rates
    expect(rates.map((r) => [r.currency, Number(r.perEuro), r.publishedOn]).sort()).toEqual([['INR', 90, '2026-10-02']])
    const own = ((await saveProduct('supplier', [{ currency: 'INR', amount: '50000' }])).data?.['saveProduct'] as { id: string }).id
    // The field's own access refuses a supplier: it reads null, as refused object fields do (decided on #14),
    // while the merchant reads the same product's prices.
    const refused = await gql('query P($id: ID!) { product(id: $id) { name pricing { versionId } } }', 'supplier', { id: own })
    expect({ data: refused.data?.['product'], errors: refused.errors }).toEqual({ data: { name: 'Linen kurta', pricing: null }, errors: undefined })
    expect((await pricingOf(own))?.pricing).toHaveLength(1)
    expect((await saveProduct('supplier', [{ currency: 'INR', amount: '50000' }, { currency: 'EUR', amount: '600' }], own)).code).toBe('SUPPLIER_FIELD')
    expect((await pricingOf(own))?.pricing?.[0]?.prices.find((p) => p.currency === 'EUR')).toMatchObject({ source: 'converted' })
    // The merchant types a USD price on the supplier's product; the supplier's next save leaves it (O10).
    await saveProduct('owner', [{ currency: 'INR', amount: '50000' }, { currency: 'USD', amount: '699' }], own)
    expect((await saveProduct('supplier', [{ currency: 'INR', amount: '55000' }], own)).code).toBeUndefined()
    expect((await pricingOf(own))?.pricing?.[0]?.prices.filter((p) => p.currency !== 'EUR').map((p) => [p.currency, p.amount, p.source])).toEqual([['INR', '55000', 'typed'], ['USD', '699', 'typed']])
  })
})

describe('the conversion example in Settings', () => {
  it('converts 100 of the pricing currency as a price is converted, under each rounding, in minor units', async () => {
    await gql('mutation C($c: [StoreCurrencyInput!]!) { saveCurrencies(currencies: $c) }', 'owner', { c: [{ code: 'USD', mode: 'convert', rounding: 'ends-99' }] })
    const examples = ((await gql('{ storeLocale { examples { currency from { amount currency } none { amount } nearest { amount } ends99 { amount } } } }', 'owner')).data?.['storeLocale'] as { examples: unknown[] }).examples
    // ₹100 at 90 to the euro and 1.08 dollars to the euro is $1.20 exactly; to the nearest whole $1, up to .99 $1.99.
    expect(examples).toEqual([
      { currency: 'EUR', from: { amount: '10000', currency: 'INR' }, none: { amount: '111' }, nearest: { amount: '100' }, ends99: { amount: '199' } },
      { currency: 'USD', from: { amount: '10000', currency: 'INR' }, none: { amount: '120' }, nearest: { amount: '100' }, ends99: { amount: '199' } },
    ])
  })
})

describe('the reference rates', () => {
  it('replaces a rate with a newer day’s and ignores an older one', async () => {
    const deliver = (publishedOn: string, perEuro: Record<string, string>) =>
      ratesRefreshDeliverer(db.sql, { fetch: async () => ({ publishedOn, perEuro }) }, () => now).deliver(effect, AbortSignal.timeout(1000))
    await deliver('2026-10-03', { USD: '1.09', EUR: '1' })
    await deliver('2026-10-01', { USD: '1.01' })
    expect(await db.sql`select currency::text as currency, per_euro::text as rate, published_on::text as day from exchange_rate order by currency`).toEqual([
      { currency: 'INR', rate: '90.000000000000', day: '2026-10-02' },
      { currency: 'USD', rate: '1.090000000000', day: '2026-10-03' },
    ])
    await expect(ratesRefreshDeliverer(db.sql, { fetch: async () => Promise.reject(new Error('down')) }).deliver(effect, AbortSignal.timeout(1000))).rejects.toThrow('down')
  })

  it('is written by the rates job alone: no store’s or supplier’s request changes a rate', async () => {
    const { withScope } = await import('#db/scoped/index')
    const merchant = { caller: { kind: 'person' as const, userId: people.owner, sessionId: 's' }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' as const }, subscription: 'active' as const }
    const supplier = { ...merchant, caller: { kind: 'person' as const, userId: people.supplier, sessionId: 's' }, sellerScope: { kind: 'seller' as const, sellerId: t.sellerA1First } }
    for (const who of [merchant, supplier]) {
      await expect(withScope(db.sql, who, (tx) => tx`update exchange_rate set per_euro = 1 where currency = 'USD'`)).rejects.toThrow(/permission denied/i)
      await expect(withScope(db.sql, who, (tx) => tx`insert into exchange_rate (currency, per_euro, source, published_on, fetched_at) values ('GBP', 1, 'ecb', current_date, now())`)).rejects.toThrow(/permission denied/i)
    }
    expect((await withScope(db.sql, merchant, (tx) => tx<{ currency: string }[]>`select currency::text as currency from exchange_rate order by currency`)).map((r) => r.currency)).toEqual(['INR', 'USD'])
  })

  it('asks once per six-hour window however often the cron runs', async () => {
    await queueRatesRefresh(db.sql, now)
    await queueRatesRefresh(db.sql, new Date(now.getTime() + 60_000))
    await queueRatesRefresh(db.sql, new Date(now.getTime() + 6 * 60 * 60 * 1000))
    expect(await db.sql`select 1 from outbox where kind = 'rates.refresh'`).toHaveLength(2)
  })
})
