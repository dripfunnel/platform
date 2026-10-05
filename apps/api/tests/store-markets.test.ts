import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import type { CallerContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #296 (SAPI 6, part 1): the store's languages, currencies and markets (CATALOG N, O; SetStore, SetMarkets).

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-05T09:00:00Z')
type Who = 'owner' | 'manager' | 'supplier' | 'bOwner'
const people: Record<Who, string> = { owner: '', manager: '', supplier: '', bOwner: '' }
const cookies: Record<Who, string> = { owner: '', manager: '', supplier: '', bOwner: '' }

const user = async (partnerId: string, email: string, name: string) =>
  (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${name}, 'active') returning id`)[0]?.id ?? ''

const subscribe = async (storeId: string, partnerId: string, limits: { languages: number; currencies: number }) => {
  const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${partnerId}, ${`Plan ${storeId.slice(0, 6)}`}, 'live') returning id`
  for (const [key, amount] of Object.entries({ products: 50, ...limits })) {
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${plan?.id ?? ''}, ${partnerId}, 1, ${key}, ${amount})`
  }
  await db.sql`update store set plan_id = ${plan?.id ?? ''}, pricing_currency = 'INR', country = 'IN' where id = ${storeId}`
  await db.sql`delete from store_subscription where store_id = ${storeId}`
  await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
    values (${storeId}, ${partnerId}, ${plan?.id ?? ''}, 1, 'active', 'month', 'INR', 0, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)})`
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await subscribe(t.storeA1, t.partnerA, { languages: 2, currencies: 3 })
  await subscribe(t.storeB1, t.partnerB, { languages: 2, currencies: 3 })
  people.owner = await user(t.partnerA, 'owner@a.example', 'Olivia')
  people.manager = await user(t.partnerA, 'manager@a.example', 'Mo')
  people.supplier = await user(t.partnerA, 'anand@a.example', 'Anand')
  people.bOwner = await user(t.partnerB, 'owner@b.example', 'Bea')
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people.owner}, ${t.storeA1}, 'owner', 'active'), (${people.manager}, ${t.storeA1}, 'manager', 'active'), (${people.bOwner}, ${t.storeB1}, 'owner', 'active')`
  await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${people.supplier}, ${t.storeA1}, ${t.sellerA1First}, 'supplier-admin', 'active')`
  for (const who of Object.keys(cookies) as Who[]) {
    cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: who === 'bOwner' ? t.partnerB : t.partnerA }, now))
  }
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

type Locale = { mainLanguage: string; pricingCurrency: string; languages: { code: string; status: string }[]; currencies: { code: string; mode: string; rounding: string; status: string }[] }
const locale = async (who: Who = 'owner') => (await gql('{ storeLocale { mainLanguage pricingCurrency languages { code status } currencies { code mode rounding status } } }', who)).data?.['storeLocale'] as Locale
type MarketOut = { id: string; parentId: string | null; name: string; primary: boolean; everywhereElse: boolean; countries: string[]; currency: string; language: string; active: boolean; revision: number; excludedProductIds: string[] }
const marketFields = 'id parentId name primary everywhereElse countries currency language active revision excludedProductIds'
const markets = async (who: Who = 'owner') => ((await gql(`{ markets(first: 50) { nodes { ${marketFields} } } }`, who)).data?.['markets'] as { nodes: MarketOut[] }).nodes
const save = async (input: Record<string, unknown>, id?: string, revision?: number, who: Who = 'owner') => {
  const result = await gql(`mutation S($id: ID, $revision: Int, $input: MarketInput!) { saveMarket(id: $id, revision: $revision, input: $input) { ${marketFields} } }`, who, { id, revision, input })
  return { market: result.data?.['saveMarket'] as MarketOut | undefined, code: result.code, errors: result.errors }
}
const saveLanguages = (languages: string[], main: string, who: Who = 'owner') => gql('mutation L($l: [String!]!, $m: String!) { saveLanguages(languages: $l, main: $m) }', who, { l: languages, m: main })
const saveCurrencies = (currencies: Record<string, unknown>[], who: Who = 'owner') => gql('mutation C($c: [StoreCurrencyInput!]!) { saveCurrencies(currencies: $c) }', who, { c: currencies })

describe('a store’s languages and currencies', () => {
  it('starts with its country’s English and a primary Home market in its country and pricing currency', async () => {
    // The fixture's store was made with no country, so its Home market names none yet.
    expect(await locale()).toMatchObject({ mainLanguage: 'en-US', pricingCurrency: 'INR', languages: [{ code: 'en-US', status: 'active' }], currencies: [] })
    expect(await markets()).toEqual([expect.objectContaining({ name: 'Home', primary: true, countries: [], currency: 'INR', language: 'en-US', active: true })])
    // A store made in India speaks Indian English (CATALOG N18).
    const [made] = await db.sql<{ id: string; main_language: string }[]>`insert into store (partner_id, name, code, country, pricing_currency) values (${t.partnerA}, 'Mumbai', 'mumbai', 'IN', 'INR') returning id, main_language`
    expect(made?.main_language).toBe('en-IN')
    expect(await db.sql`select name, countries, currency::text as currency from market where store_id = ${made?.id ?? ''}`).toEqual([{ name: 'Home', countries: ['IN'], currency: 'INR' }])
  })

  it('offers the launch languages only, within the plan, keeping a removed one’s text and letting the main one change', async () => {
    expect((await saveLanguages(['en-US', 'fr-FR'], 'en-US')).code).toBe('INVALID_LANGUAGE')
    expect((await saveLanguages(['en-US'], 'hi-IN')).code).toBe('MAIN_LANGUAGE_REQUIRED')
    expect((await saveLanguages(['en-US', 'hi-IN', 'en-IN'], 'en-US')).errors?.[0]?.extensions).toMatchObject({ code: 'PLAN_LIMIT', key: 'languages' })
    expect((await saveLanguages(['en-US', 'hi-IN'], 'en-US')).data?.['saveLanguages']).toBe(true)
    expect((await locale()).languages).toEqual([{ code: 'en-US', status: 'active' }, { code: 'hi-IN', status: 'active' }])
    expect((await saveLanguages(['hi-IN', 'en-US'], 'hi-IN')).data?.['saveLanguages']).toBe(true)
    expect((await locale()).mainLanguage).toBe('hi-IN')
    expect(await db.sql`select 1 from activity_log where action = 'store.main_language_changed' and store_id = ${t.storeA1}`).toHaveLength(1)
    expect((await saveLanguages(['en-US'], 'en-US')).data?.['saveLanguages']).toBe(true)
    expect((await locale()).languages).toEqual([{ code: 'en-US', status: 'active' }, { code: 'hi-IN', status: 'removed' }])
  })

  it('adds converted and typed currencies within the plan, never the pricing one, and keeps a removed one', async () => {
    expect((await saveCurrencies([{ code: 'INR', mode: 'convert' }])).code).toBe('INVALID_CURRENCY')
    expect((await saveCurrencies([{ code: 'XYZ', mode: 'convert' }])).code).toBe('INVALID_CURRENCY')
    expect((await saveCurrencies([{ code: 'USD', mode: 'sometimes' }])).code).toBe('INVALID_INPUT')
    expect((await saveCurrencies([{ code: 'USD', mode: 'convert' }, { code: 'EUR', mode: 'manual' }, { code: 'GBP', mode: 'convert' }])).errors?.[0]?.extensions).toMatchObject({ code: 'PLAN_LIMIT', key: 'currencies' })
    expect((await saveCurrencies([{ code: 'usd', mode: 'convert', rounding: 'nearest' }, { code: 'EUR', mode: 'manual' }])).data?.['saveCurrencies']).toBe(true)
    expect((await locale()).currencies).toEqual([
      { code: 'USD', mode: 'convert', rounding: 'nearest', status: 'active' },
      { code: 'EUR', mode: 'manual', rounding: 'ends-99', status: 'active' },
    ])
  })
})

describe('markets', () => {
  let europe = ''
  let germany = ''

  it('sells a currency into countries no other market has, with sub-markets inside their parent', async () => {
    const made = await save({ name: 'Europe', countries: ['DE', 'FR', 'NL'], currency: 'EUR', language: 'en-US', priceAdjustmentBps: 1000 })
    expect(made.market).toMatchObject({ name: 'Europe', primary: false, countries: ['DE', 'FR', 'NL'], currency: 'EUR', revision: 1 })
    europe = made.market?.id ?? ''
    expect((await save({ name: 'France again', countries: ['FR'], currency: 'EUR', language: 'en-US' })).code).toBe('COUNTRY_TAKEN')
    const sub = await save({ name: 'Germany', parentId: europe, countries: ['DE'], currency: 'EUR', language: 'en-US', webMode: 'path', pathPrefix: 'de' })
    expect(sub.market).toMatchObject({ parentId: europe, countries: ['DE'] })
    germany = sub.market?.id ?? ''
    expect((await save({ name: 'Italy', parentId: europe, countries: ['IT'], currency: 'EUR', language: 'en-US' })).code).toBe('NOT_PARENTS_COUNTRIES')
    expect((await save({ name: 'Also Germany', parentId: europe, countries: ['DE'], currency: 'EUR', language: 'en-US' })).code).toBe('COUNTRY_TAKEN')
    expect((await save({ name: 'Deep', parentId: germany, countries: ['DE'], currency: 'EUR', language: 'en-US' })).code).toBe('BAD_PARENT')
    expect((await save({ name: 'Netherlands', parentId: europe, countries: ['NL'], currency: 'EUR', language: 'en-US', webMode: 'path', pathPrefix: 'de' })).code).toBe('DUPLICATE_PATH')
    expect((await save({ name: 'europe', countries: ['ES'], currency: 'EUR', language: 'en-US' })).code).toBe('DUPLICATE_NAME')
  })

  it('keeps a parent’s sub-markets within it: no shrinking under them, and no going under another while it has them', async () => {
    const nordics = (await save({ name: 'Nordics', countries: ['SE', 'NO', 'DK'], currency: 'INR', language: 'en-US' })).market
    const sweden = (await save({ name: 'Sweden', parentId: nordics?.id, countries: ['SE'], currency: 'INR', language: 'en-US' })).market
    expect((await save({ name: 'Nordics', countries: ['NO', 'DK'], currency: 'INR', language: 'en-US' }, nordics?.id, nordics?.revision)).code).toBe('NOT_PARENTS_COUNTRIES')
    expect((await save({ name: 'Nordics', parentId: europe, countries: ['SE', 'NO', 'DK'], currency: 'INR', language: 'en-US' }, nordics?.id, nordics?.revision)).code).toBe('BAD_PARENT')
    expect((await gql('mutation E($id: ID) { setEverywhereElse(marketId: $id) }', 'owner', { id: nordics?.id })).data?.['setEverywhereElse']).toBe(true)
    const fallback = (await markets()).find((m) => m.id === nordics?.id)
    expect((await save({ name: 'Nordics', parentId: europe, countries: ['SE', 'NO', 'DK'], currency: 'INR', language: 'en-US' }, fallback?.id, fallback?.revision)).code).toBe('BAD_PARENT')
    await gql('mutation E($id: ID) { setEverywhereElse(marketId: $id) }', 'owner', { id: null })
    await gql('mutation D($id: ID!) { deleteMarket(id: $id) }', 'owner', { id: sweden?.id })
    await gql('mutation D($id: ID!) { deleteMarket(id: $id) }', 'owner', { id: nordics?.id })
  })

  it('refuses what the store doesn’t offer and what isn’t valid', async () => {
    expect((await save({ name: 'Gulf', countries: ['AE'], currency: 'AED', language: 'en-US' })).code).toBe('NOT_OFFERED')
    expect((await save({ name: 'Hindi', countries: ['NP'], currency: 'INR', language: 'hi-IN' })).code).toBe('NOT_OFFERED')
    expect((await save({ name: 'Nowhere', countries: ['XX'], currency: 'INR', language: 'en-US' })).code).toBe('INVALID_COUNTRY')
    expect((await save({ name: 'Empty', countries: [], currency: 'INR', language: 'en-US' })).code).toBe('COUNTRIES_REQUIRED')
    expect((await save({ name: 'Flat', countries: ['CH'], currency: 'INR', language: 'en-US', dutiesMode: 'flat' })).code).toBe('INVALID_INPUT')
    expect((await save({ name: 'Far', countries: ['CH'], currency: 'INR', language: 'en-US', priceAdjustmentBps: 200000 })).code).toBe('INVALID_INPUT')
  })

  it('saves at the revision read, keeps the primary market selling, and excludes only the store’s products', async () => {
    const [mine] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug) values (${t.storeA1}, 'Kurta', 'kurta') returning id`
    const [theirs] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug) values (${t.storeB1}, 'Other', 'other') returning id`
    const base = { name: 'Europe', countries: ['DE', 'FR', 'NL'], currency: 'EUR', language: 'en-US', products: 'some' }
    expect((await save({ ...base, excludedProductIds: [theirs?.id] }, europe, 1)).code).toBe('NOT_FOUND')
    const saved = await save({ ...base, excludedProductIds: [mine?.id] }, europe, 1)
    expect(saved.market).toMatchObject({ excludedProductIds: [mine?.id], revision: 2 })
    expect((await save(base, europe, 1)).code).toBe('STALE_REVISION')
    const home = (await markets()).find((m) => m.primary)
    expect((await save({ name: 'Home', countries: ['US'], currency: 'INR', language: 'en-US', active: false }, home?.id, home?.revision)).code).toBe('PRIMARY_MARKET')
    expect((await gql('mutation D($id: ID!) { deleteMarket(id: $id) }', 'owner', { id: home?.id })).code).toBe('PRIMARY_MARKET')
  })

  it('picks a top-level market for everywhere else, or none', async () => {
    expect((await gql('mutation E($id: ID) { setEverywhereElse(marketId: $id) }', 'owner', { id: germany })).code).toBe('NOT_FOUND')
    expect((await gql('mutation E($id: ID) { setEverywhereElse(marketId: $id) }', 'owner', { id: europe })).data?.['setEverywhereElse']).toBe(true)
    expect((await markets()).filter((m) => m.everywhereElse).map((m) => m.id)).toEqual([europe])
    expect((await gql('mutation E($id: ID) { setEverywhereElse(marketId: $id) }', 'owner', { id: null })).data?.['setEverywhereElse']).toBe(true)
    expect((await markets()).some((m) => m.everywhereElse)).toBe(false)
    // Each entry names the real market: the one that took it, then the one that stopped.
    expect(await db.sql`select target_id, reason from activity_log where action = 'market.fallback_changed' and target_id = ${europe} order by occurred_at, id`).toEqual([
      { target_id: europe, reason: 'on' },
      { target_id: europe, reason: 'off' },
    ])
  })

  it('moves markets off a currency or language no longer offered, and deleting a market lifts its sub-markets', async () => {
    const before = (await markets()).find((m) => m.id === europe)
    await save({ name: 'Europe', countries: ['DE', 'FR', 'NL'], currency: 'EUR', language: 'en-US', dutiesMode: 'flat', dutiesRateBps: 500, dutiesThresholdAmount: '15000' }, europe, before?.revision)
    expect((await saveCurrencies([{ code: 'USD', mode: 'convert' }])).data?.['saveCurrencies']).toBe(true)
    // Its duty-free threshold was euros: in the new currency it needs setting again.
    expect((await db.sql<{ duties_threshold_amount: string | null }[]>`select duties_threshold_amount::text from market where id = ${europe}`)[0]?.duties_threshold_amount).toBeNull()
    expect((await locale()).currencies.find((c) => c.code === 'EUR')?.status).toBe('removed')
    expect(new Set((await markets()).filter((m) => m.id === europe || m.id === germany).map((m) => m.currency))).toEqual(new Set(['INR']))
    expect((await gql('mutation D($id: ID!) { deleteMarket(id: $id) }', 'owner', { id: europe })).data?.['deleteMarket']).toBe(true)
    expect((await markets()).find((m) => m.id === germany)).toMatchObject({ parentId: null })
    expect((await markets()).some((m) => m.id === europe)).toBe(false)
  })

  it('follows the pricing currency when it changes', async () => {
    await db.sql`update store set pricing_currency = 'USD' where id = ${t.storeB1}`
    try {
      expect((await markets('bOwner')).find((m) => m.primary)?.currency).toBe('USD')
    } finally {
      await db.sql`update store set pricing_currency = 'INR' where id = ${t.storeB1}`
    }
  })
})

describe('who reaches the settings', () => {
  it('lets the merchant side read them and only the Owner write, keeps suppliers out, and keeps each store to its own', async () => {
    expect((await locale('manager')).pricingCurrency).toBe('INR')
    expect((await saveLanguages(['en-US'], 'en-US', 'manager')).code).toBe('FORBIDDEN')
    expect((await save({ name: 'Manager market', countries: ['JP'], currency: 'INR', language: 'en-US' }, undefined, undefined, 'manager')).code).toBe('FORBIDDEN')
    expect((await gql('{ storeLocale { mainLanguage } }', 'supplier')).code).toBe('FORBIDDEN')
    expect((await gql('{ markets { nodes { id } } }', 'supplier')).code).toBe('FORBIDDEN')
    const ours = await markets()
    expect((await markets('bOwner')).some((m) => ours.some((o) => o.id === m.id))).toBe(false)
    const id = ours.find((m) => !m.primary)?.id
    expect((await gql('query M($id: ID!) { market(id: $id) { id } }', 'bOwner', { id })).data?.['market']).toBeNull()
    expect((await gql('mutation D($id: ID!) { deleteMarket(id: $id) }', 'bOwner', { id })).code).toBe('NOT_FOUND')
    expect((await save({ name: 'Taken', countries: ['JP'], currency: 'INR', language: 'en-US' }, id, 1, 'bOwner')).code).toBe('NOT_FOUND')
    expect((await gql('mutation E($id: ID) { setEverywhereElse(marketId: $id) }', 'bOwner', { id })).code).toBe('NOT_FOUND')
  })

  it('holds the tables to the merchant side in the database too', async () => {
    const supplier: CallerContext = { caller: { kind: 'person', userId: people.supplier, sessionId: 's' }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'seller', sellerId: t.sellerA1First }, subscription: 'active' }
    for (const table of ['market', 'store_currency', 'market_excluded_product']) {
      await expect(withScope(db.sql, supplier, (tx) => tx.unsafe(`select 1 from ${table}`))).rejects.toThrow(/permission denied/i)
    }
    // It reads its store's languages, to translate its own products into (#296 part 3), and writes none.
    expect(new Set((await withScope(db.sql, supplier, (tx) => tx<{ store_id: string }[]>`select store_id from store_language`)).map((r) => r.store_id))).toEqual(new Set([t.storeA1]))
    await expect(withScope(db.sql, supplier, (tx) => tx`update store_language set position = 9`)).rejects.toThrow(/permission denied/i)
    const merchant: CallerContext = { ...supplier, caller: { kind: 'person', userId: people.owner, sessionId: 's' }, sellerScope: { kind: 'all' } }
    await expect(withScope(db.sql, merchant, (tx) => tx`select set_store_main_language('fr-FR')`)).rejects.toThrow(/one of the store's languages/)
    expect(await withScope(db.sql, merchant, async (tx) => (await tx`update market set name = 'Hijack' where store_id = ${t.storeB1}`).count)).toBe(0)
  })
})
