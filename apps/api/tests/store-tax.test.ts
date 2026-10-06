import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import type { CallerContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { createTaxService } from '#engine/modules/tax/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #297 (SAPI 7): tax classes, zones and rates, prices including tax or not, invoice settings, and tax on an
// Indian and a US cart (CATALOG facts 37–38; SetOps Tax setup).

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-05T09:00:00Z')
type Who = 'india' | 'us' | 'supplier' | 'manager' | 'other'
const people: Record<Who, string> = { india: '', us: '', supplier: '', manager: '', other: '' }
const cookies: Record<Who, string> = { india: '', us: '', supplier: '', manager: '', other: '' }
const stores = { india: '', us: '' }
let seller = ''

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
  const [s] = await db.sql<{ id: string }[]>`insert into seller (store_id, name, access_level, status) values (${stores.india}, 'Anand Textiles', 'vendor-catalogue', 'active') returning id`
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
  const contextValue: StoreContext = { standing, partnerId, sql: db.sql, activity: activityLog, facts, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, errors: result.errors }
}

type Setup = { pricesIncludeTax: boolean; classes: { id: string; name: string; taxCode: string | null; isDefault: boolean; versions: number }[]; zones: { id: string; name: string; countries: string[]; regions: string[]; rates: { taxClassId: string; rateBps: number }[] }[] }
const setup = async (who: Who) => (await gql('{ taxSetup { pricesIncludeTax classes { id name taxCode isDefault versions } zones { id name countries regions rates { taxClassId rateBps } } } }', who)).data?.['taxSetup'] as Setup
type Quote = { currency: string; pricesIncludeTax: boolean; source: string; total: string; lines: { versionId: string; quantity: number; lineAmount: string; rateBps: number; tax: string; components: { name: string; rateBps: number; amount: string }[] }[] }
const quote = async (who: Who, lines: { versionId: string; quantity: number }[], shipTo: Record<string, unknown>) => {
  const result = await gql('query Q($l: [TaxQuoteLineInput!]!, $s: TaxShipToInput!) { taxQuote(lines: $l, shipTo: $s) { currency pricesIncludeTax source total lines { versionId quantity lineAmount rateBps tax components { name rateBps amount } } } }', who, { l: lines, s: shipTo })
  return { quote: result.data?.['taxQuote'] as Quote | undefined, code: result.code }
}
const product = async (who: Who, currency: string, amount: string, taxClassId?: string | null) => {
  const saved = await gql('mutation S($input: ProductInput!) { saveProduct(input: $input) { id } }', who, { input: { name: `Kurta ${amount}`, options: [], versions: [{ choices: [], prices: [{ currency, amount }], ...(taxClassId !== undefined ? { taxClassId } : {}) }] } })
  const id = (saved.data?.['saveProduct'] as { id: string } | undefined)?.id ?? ''
  const version = ((await gql('query P($id: ID!) { product(id: $id) { versions { id taxClassId } } }', who === 'supplier' ? 'india' : who, { id })).data?.['product'] as { versions: { id: string; taxClassId: string | null }[] } | null)?.versions[0]
  return { id, versionId: version?.id ?? '', taxClassId: version?.taxClassId ?? null, code: saved.code }
}

describe('an Indian store', () => {
  it('starts with GST’s slabs across India, prices including tax', async () => {
    const s = await setup('india')
    expect(s.pricesIncludeTax).toBe(true)
    expect(s.classes.map((c) => [c.name, c.isDefault])).toEqual([['Standard', true], ['Clothing', false], ['Essentials', false], ['Exempt', false]])
    expect(s.zones.map((z) => [z.name, z.countries, z.regions])).toEqual([['India', ['IN'], []]])
    const rate = (name: string) => s.zones[0]?.rates.find((r) => r.taxClassId === s.classes.find((c) => c.name === name)?.id)?.rateBps
    expect([rate('Standard'), rate('Clothing'), rate('Essentials'), rate('Exempt')]).toEqual([1800, 500, 500, 0])
  })

  it('computes GST on a cart: CGST and SGST within Rajasthan, IGST to another state, each version at its class', async () => {
    const clothing = (await setup('india')).classes.find((c) => c.name === 'Clothing')?.id
    const standard = await product('india', 'INR', '118000')
    const kurta = await product('india', 'INR', '105000', clothing)
    expect(kurta.taxClassId).toBe(clothing)
    const home = (await quote('india', [{ versionId: standard.versionId, quantity: 2 }, { versionId: kurta.versionId, quantity: 1 }], { country: 'IN', region: 'Rajasthan', postal: '302001' })).quote
    expect(home).toMatchObject({ currency: 'INR', pricesIncludeTax: true, source: 'rates', total: '41000' })
    expect(home?.lines.map((l) => [l.lineAmount, l.rateBps, l.tax, l.components.map((c) => [c.name, c.rateBps, c.amount])])).toEqual([
      ['236000', 1800, '36000', [['CGST', 900, '18000'], ['SGST', 900, '18000']]],
      ['105000', 500, '5000', [['CGST', 250, '2500'], ['SGST', 250, '2500']]],
    ])
    const away = (await quote('india', [{ versionId: standard.versionId, quantity: 1 }], { country: 'IN', region: 'Maharashtra' })).quote
    expect(away?.lines[0]?.components).toEqual([{ name: 'IGST', rateBps: 1800, amount: '18000' }])
  })

  it('keeps tax classes the merchant’s: a supplier’s product takes the default, and it can’t pick one', async () => {
    const clothing = (await setup('india')).classes.find((c) => c.name === 'Clothing')?.id
    expect((await product('supplier', 'INR', '50000', clothing)).code).toBe('SUPPLIER_FIELD')
    const own = await product('supplier', 'INR', '59000')
    expect(own.taxClassId).toBeNull()
    expect((await quote('india', [{ versionId: own.versionId, quantity: 1 }], { country: 'IN', region: 'Rajasthan' })).quote?.lines[0]?.rateBps).toBe(1800)
    expect((await gql('{ taxSetup { pricesIncludeTax } }', 'supplier')).code).toBe('FORBIDDEN')
    expect((await gql('mutation { setPricesIncludeTax(included: false) }', 'supplier')).code).toBe('FORBIDDEN')
  })
})

describe('a US store', () => {
  it('starts with Stripe Tax’s codes and no rates of its own, prices adding tax, so a cart is taxed nothing until it has some', async () => {
    const s = await setup('us')
    expect(s.pricesIncludeTax).toBe(false)
    expect(s.classes.map((c) => [c.name, c.taxCode, c.isDefault])).toEqual([['General goods', 'txcd_99999999', true], ['Not taxed', 'txcd_00000000', false]])
    const mug = await product('us', 'USD', '2000')
    expect((await quote('us', [{ versionId: mug.versionId, quantity: 1 }], { country: 'US', region: 'OH' })).quote).toMatchObject({ source: 'rates', total: '0' })
  })

  it('charges its own state rates without Stripe (decided on #337), the state’s beating a country-wide one', async () => {
    const general = (await setup('us')).classes.find((c) => c.isDefault)?.id
    const ohio = await gql('mutation Z($input: TaxZoneInput!) { saveTaxZone(input: $input) }', 'us', { input: { name: 'Ohio', countries: ['US'], regions: ['OH'], rates: [{ taxClassId: general, rateBps: 575 }] } })
    expect(ohio.code).toBeUndefined()
    await gql('mutation Z($input: TaxZoneInput!) { saveTaxZone(input: $input) }', 'us', { input: { name: 'Elsewhere in the US', countries: ['US'], rates: [{ taxClassId: general, rateBps: 100 }] } })
    const mug = await product('us', 'USD', '2000')
    expect((await quote('us', [{ versionId: mug.versionId, quantity: 1 }], { country: 'US', region: 'oh' })).quote).toMatchObject({ total: '115', lines: [{ rateBps: 575, tax: '115', components: [{ name: 'Tax', rateBps: 575, amount: '115' }] }] })
    expect((await quote('us', [{ versionId: mug.versionId, quantity: 1 }], { country: 'US', region: 'CA' })).quote?.total).toBe('20')
    // Bounded before anything could reach Stripe.
    expect((await quote('us', [{ versionId: mug.versionId, quantity: 1 }], { country: 'US', region: 'O'.repeat(101) })).code).toBe('INVALID_INPUT')
    expect((await quote('us', [{ versionId: mug.versionId, quantity: 1 }], { country: 'US', region: 'OH', postal: '4'.repeat(21) })).code).toBe('INVALID_INPUT')
  })

  it('asks Stripe Tax on the store’s connected account once it has one', async () => {
    const mug = await product('us', 'USD', '2000')
    let asked: unknown = null
    const owner: CallerContext = { caller: { kind: 'person', userId: people.us, sessionId: 's' }, partnerId: t.partnerA, storeId: stores.us, sellerScope: { kind: 'all' }, subscription: 'active' }
    const service = createTaxService({
      sql: db.sql,
      context: owner,
      actor: { id: people.us, partnerId: t.partnerA },
      activity: activityLog,
      facts: { requestId: 'r', ip: null, userAgent: null },
      now: () => now,
      stripe: {
        accountId: async () => 'acct_columbus',
        calculate: async (request) => {
          asked = request
          return { total: 160n, lines: [{ reference: mug.versionId, amount: 160n }] }
        },
      },
    })
    const result = await service.quote([{ versionId: mug.versionId, quantity: 1 }], { country: 'US', region: 'NY', postal: '10001' })
    expect(result).toMatchObject({ ok: true, value: { source: 'stripe', total: 160n, lines: [{ rateBps: null, amount: 160n, components: [{ name: 'Tax', rateBps: null, amount: 160n }] }] } })
    expect(asked).toMatchObject({ accountId: 'acct_columbus', currency: 'USD', inclusive: false, shipTo: { country: 'US', region: 'NY', postal: '10001' }, lines: [{ reference: mug.versionId, amount: 2000n, taxCode: 'txcd_99999999' }] })
    // An Indian address never goes to Stripe.
    expect((await service.quote([{ versionId: mug.versionId, quantity: 1 }], { country: 'IN', region: null, postal: null })).ok && asked).toMatchObject({ shipTo: { country: 'US' } })
    // One line per version, as a cart holds them.
    expect(await service.quote([{ versionId: mug.versionId, quantity: 1 }, { versionId: mug.versionId, quantity: 2 }], { country: 'US', region: 'NY', postal: null })).toEqual({ ok: false, reason: 'INVALID_INPUT' })
    // Stripe down or refusing is a tax the cart can't know yet.
    const down = createTaxService({
      sql: db.sql,
      context: owner,
      actor: { id: people.us, partnerId: t.partnerA },
      activity: activityLog,
      facts: { requestId: 'r', ip: null, userAgent: null },
      now: () => now,
      stripe: { accountId: async () => 'acct_columbus', calculate: async () => Promise.reject(new Error('Stripe answered 503')) },
    })
    expect(await down.quote([{ versionId: mug.versionId, quantity: 1 }], { country: 'US', region: 'NY', postal: null })).toEqual({ ok: false, reason: 'TAX_UNAVAILABLE' })
    // An answer missing a line is a tax not known, never a line taxed nothing.
    const bowl = await product('us', 'USD', '3000')
    const partial = createTaxService({
      sql: db.sql,
      context: owner,
      actor: { id: people.us, partnerId: t.partnerA },
      activity: activityLog,
      facts: { requestId: 'r', ip: null, userAgent: null },
      now: () => now,
      stripe: { accountId: async () => 'acct_columbus', calculate: async () => ({ total: 400n, lines: [{ reference: mug.versionId, amount: 160n }] }) },
    })
    expect(await partial.quote([{ versionId: mug.versionId, quantity: 1 }, { versionId: bowl.versionId, quantity: 1 }], { country: 'US', region: 'NY', postal: null })).toEqual({ ok: false, reason: 'TAX_UNAVAILABLE' })
  })

  it('refuses a zone that would answer for the same place and category as another', async () => {
    const general = (await setup('us')).classes.find((c) => c.isDefault)?.id
    const zone = (name: string, regions: string[]) => gql('mutation Z($input: TaxZoneInput!) { saveTaxZone(input: $input) }', 'us', { input: { name, countries: ['US'], regions, rates: [{ taxClassId: general, rateBps: 600 }] } })
    // Ohio and the rest of the US are already set (above); another rate for Ohio, or for the whole US, would be a coin toss.
    expect((await zone('Ohio again', ['oh', 'PA'])).code).toBe('ZONE_OVERLAP')
    expect((await zone('All of the US', [])).code).toBe('ZONE_OVERLAP')
    expect((await zone('Pennsylvania', ['PA'])).code).toBeUndefined()
    // Saving a zone over itself is never a clash.
    const ohio = (await setup('us')).zones.find((z) => z.name === 'Ohio')
    expect((await gql('mutation Z($id: ID, $input: TaxZoneInput!) { saveTaxZone(id: $id, input: $input) }', 'us', { id: ohio?.id, input: { name: 'Ohio', countries: ['US'], regions: ['OH'], rates: [{ taxClassId: general, rateBps: 575 }] } })).code).toBeUndefined()
  })

  it('lets only someone with tax.configure change tax setup: a Manager reads it but can’t write', async () => {
    expect((await setup('manager')).classes.length).toBeGreaterThan(0)
    expect((await gql('mutation { setPricesIncludeTax(included: false) }', 'manager')).code).toBe('FORBIDDEN')
  })
})

describe('Tax setup', () => {
  it('switches whether prices include tax, and keeps the classes in order', async () => {
    expect((await gql('mutation { setPricesIncludeTax(included: false) }', 'india')).data?.['setPricesIncludeTax']).toBe(true)
    expect((await setup('india')).pricesIncludeTax).toBe(false)
    await gql('mutation { setPricesIncludeTax(included: true) }', 'india')
    const saveClass = (input: Record<string, unknown>, id?: string) => gql('mutation C($id: ID, $input: TaxClassInput!) { saveTaxClass(id: $id, input: $input) }', 'india', { id, input })
    expect((await saveClass({ name: 'standard' })).code).toBe('DUPLICATE_NAME')
    expect((await saveClass({ name: 'Books', taxCode: 'books' })).code).toBe('INVALID_INPUT')
    const books = (await saveClass({ name: 'Books' })).data?.['saveTaxClass'] as string
    const s = await setup('india')
    const standard = s.classes.find((c) => c.name === 'Standard')
    const clothing = s.classes.find((c) => c.name === 'Clothing')
    const del = (id: string | undefined) => gql('mutation D($id: ID!) { deleteTaxClass(id: $id) }', 'india', { id })
    expect((await del(standard?.id)).code).toBe('DEFAULT_CLASS')
    expect((await del(clothing?.id)).code).toBe('CLASS_IN_USE')
    // Making Books the default leaves products with no class of their own taxed as they were.
    const before = await product('india', 'INR', '11800')
    expect((await saveClass({ name: 'Books', isDefault: true }, books)).code).toBeUndefined()
    expect((await quote('india', [{ versionId: before.versionId, quantity: 1 }], { country: 'IN', region: 'Rajasthan' })).quote?.lines[0]?.rateBps).toBe(1800)
    expect((await del(standard?.id)).code).toBe('CLASS_IN_USE')
  })

  it('never deletes a class a product save is putting a version on: the delete waits, then finds it in use', async () => {
    const books = (await gql('mutation C($input: TaxClassInput!) { saveTaxClass(input: $input) }', 'india', { input: { name: 'Books race' } })).data?.['saveTaxClass'] as string
    const { versionId } = await product('india', 'INR', '30000')
    let deleting: Promise<{ code: string | undefined }> | null = null
    // The save's side: the class held as validation holds it, a version put on it before commit.
    await db.sql.begin(async (tx) => {
      await tx`select id from tax_class where id = ${books} for share`
      deleting = gql('mutation D($id: ID!) { deleteTaxClass(id: $id) }', 'india', { id: books })
      await new Promise((resolve) => setTimeout(resolve, 200))
      await tx`update product_version set tax_class_id = ${books} where id = ${versionId}`
    })
    expect((await (deleting as unknown as Promise<{ code: string | undefined }>)).code).toBe('CLASS_IN_USE')
    expect((await db.sql<{ deleted_at: Date | null }[]>`select deleted_at from tax_class where id = ${books}`)[0]?.deleted_at).toBeNull()
  })

  it('holds each store to 50 classes and 100 zones', async () => {
    const count = (await setup('us')).classes.length
    const saveClass = (name: string) => gql('mutation C($input: TaxClassInput!) { saveTaxClass(input: $input) }', 'us', { input: { name } })
    for (let i = count; i < 50; i++) expect((await saveClass(`Class ${i}`)).code).toBeUndefined()
    expect((await saveClass('One too many')).code).toBe('TOO_MANY')
  })

  it('saves invoice settings', async () => {
    expect((await gql('mutation I($input: InvoiceSettingsInput!) { saveInvoiceSettings(input: $input) }', 'india', { input: { taxPerLine: false, emailWithDispatch: true, footer: 'Thank you' } })).code).toBeUndefined()
    expect((await gql('{ invoiceSettings { taxPerLine emailWithDispatch footer } }', 'india')).data?.['invoiceSettings']).toEqual({ taxPerLine: false, emailWithDispatch: true, footer: 'Thank you' })
    expect((await gql('mutation I($input: InvoiceSettingsInput!) { saveInvoiceSettings(input: $input) }', 'manager', { input: { taxPerLine: true, emailWithDispatch: true } })).code).toBe('FORBIDDEN')
  })

  it('sets a category’s rate in the home zone there is, keeping the others, refusing an overlap and another store’s category', async () => {
    const home = (who: Who, taxClassId: string | undefined, rateBps: number) => gql('mutation H($c: ID!, $r: Int!, $h: String!) { setHomeTaxRate(taxClassId: $c, rateBps: $r, homeZoneName: $h) }', who, { c: taxClassId, r: rateBps, h: 'India' })
    const before = (await setup('india')).zones.find((z) => z.countries.length === 1 && z.countries[0] === 'IN' && z.regions.length === 0)
    const [a, b] = before?.rates ?? []
    // Two people change different categories at the same moment: both keep theirs, the zone's other rates untouched.
    const [first, second] = await Promise.all([home('india', a?.taxClassId, 123), home('india', b?.taxClassId, 456)])
    expect([first.code, second.code]).toEqual([undefined, undefined])
    const after = (await setup('india')).zones.find((z) => z.id === before?.id)
    expect(after?.rates.find((r) => r.taxClassId === a?.taxClassId)?.rateBps).toBe(123)
    expect(after?.rates.find((r) => r.taxClassId === b?.taxClassId)?.rateBps).toBe(456)
    expect(after?.rates).toHaveLength(before?.rates.length ?? 0)
    expect(await db.sql`select actor_id, target_id from activity_log where action = 'tax_rate.set' and target_id = ${before?.id ?? ''} order by occurred_at desc limit 1`).toEqual([{ actor_id: people.india, target_id: before?.id }])
    // A category another zone already answers for in India: the home zone taking it would answer for the same place and category.
    const k = (await gql('mutation C($input: TaxClassInput!) { saveTaxClass(input: $input) }', 'india', { input: { name: 'Overlap test' } })).data?.['saveTaxClass'] as string
    await gql('mutation Z($input: TaxZoneInput!) { saveTaxZone(input: $input) }', 'india', { input: { name: 'India and UAE', countries: ['AE', 'IN'], rates: [{ taxClassId: k, rateBps: 500 }] } })
    expect((await home('india', k, 700)).code).toBe('ZONE_OVERLAP')
    // Another store's category isn't there; a rate is a percentage.
    expect((await home('other', a?.taxClassId, 100)).code).toBe('NOT_FOUND')
    expect((await home('india', a?.taxClassId, 10_001)).code).toBe('INVALID_INPUT')
  })

  it('adds a category with its rate at home in one go, and leaves nothing behind when refused', async () => {
    const add = (name: string, rateBps: number) => gql('mutation A($n: String!, $r: Int!, $h: String!) { addTaxCategory(name: $n, rateBps: $r, homeZoneName: $h) }', 'india', { n: name, r: rateBps, h: 'India' })
    const made = (await add('Stationery', 500)).data?.['addTaxCategory'] as string
    const after = await setup('india')
    expect(after.classes.some((c) => c.id === made && c.name === 'Stationery')).toBe(true)
    expect(after.zones.find((z) => z.countries[0] === 'IN' && z.regions.length === 0)?.rates.find((r) => r.taxClassId === made)?.rateBps).toBe(500)
    // Refused as a rate out of range, and as a name taken: no category is left either time.
    expect((await add('Comics', 10_001)).code).toBe('INVALID_INPUT')
    expect((await add('Stationery', 500)).code).toBe('DUPLICATE_NAME')
    expect((await setup('india')).classes.filter((c) => c.name === 'Comics' || c.name === 'Stationery')).toHaveLength(1)
  })

  it('makes the home zone with a rate where there’s none, on the server, and rolls a category back when its rate is refused', async () => {
    const add = (who: Who, name: string, rateBps: number) => gql('mutation A($n: String!, $r: Int!, $h: String!) { addTaxCategory(name: $n, rateBps: $r, homeZoneName: $h) }', who, { n: name, r: rateBps, h: 'United States' })
    const home = (who: Who, taxClassId: string | undefined, rateBps: number) => gql('mutation H($c: ID!, $r: Int!, $h: String!) { setHomeTaxRate(taxClassId: $c, rateBps: $r, homeZoneName: $h) }', who, { c: taxClassId, r: rateBps, h: 'United States' })
    expect((await add('manager', 'Nope', 100)).code).toBe('FORBIDDEN')
    expect((await home('manager', (await setup('india')).classes[0]?.id, 100)).code).toBe('FORBIDDEN')
    // With the US store's country-wide zone gone, the first home rate makes one, named as given.
    await db.sql`delete from tax_zone where store_id = ${stores.us} and regions = '[]'::jsonb and countries = '["US"]'::jsonb`
    const [usClass, otherClass] = (await setup('us')).classes.map((c) => c.id)
    // A zone shared with Canada isn't home: changing a rate at home never moves Canada's.
    const shared = (await db.sql<{ id: string }[]>`insert into tax_zone (store_id, name, countries) values (${stores.us}, 'North America', '["CA","US"]'::jsonb) returning id`)[0]?.id ?? ''
    await db.sql`insert into tax_rate (store_id, tax_zone_id, tax_class_id, rate_bps) values (${stores.us}, ${shared}, ${otherClass ?? ''}, 500)`
    expect((await home('us', usClass, 625)).code).toBeUndefined()
    expect((await setup('us')).zones.find((z) => z.id === shared)?.rates).toEqual([expect.objectContaining({ taxClassId: otherClass, rateBps: 500 })])
    await db.sql`delete from tax_zone where id = ${shared}`
    const made = (await setup('us')).zones.find((z) => z.countries.length === 1 && z.countries[0] === 'US' && z.regions.length === 0)
    expect(made?.name).toBe('United States')
    expect(made?.rates.find((r) => r.taxClassId === usClass)?.rateBps).toBe(625)
    // Room for classes (an earlier test filled the US store to 50), so the next refusals come after the class is made.
    await db.sql`update tax_class set deleted_at = now() where store_id = ${stores.us} and name like 'Class %'`
    // Two at once, with room for a class, on a store with no home zone: the lock lets the first make it and the second find it, so there's one.
    await db.sql`delete from tax_zone where id = ${made?.id ?? ''}`
    const raced = await Promise.all([home('us', usClass, 100), add('us', 'Raced', 200)])
    expect(raced.map((r) => r.code)).toEqual([undefined, undefined])
    const homes = (await setup('us')).zones.filter((z) => z.countries.length === 1 && z.countries[0] === 'US' && z.regions.length === 0)
    expect(homes).toHaveLength(1)
    expect(homes[0]?.rates).toHaveLength(2)
    await db.sql`delete from tax_zone where id = ${homes[0]?.id ?? ''}`
    const classesBefore = (await setup('us')).classes.length
    expect(classesBefore).toBeLessThan(50)
    // At the zone limit with no home zone, a new category's rate can't be placed: the category itself is undone too.
    await db.sql`delete from tax_rate where tax_zone_id = ${made?.id ?? ''}`
    await db.sql`delete from tax_zone where id = ${made?.id ?? ''}`
    const room = 100 - (await setup('us')).zones.length
    await db.sql`insert into tax_zone (store_id, name, countries) select ${stores.us}, 'Filler ' || n, '["CA"]'::jsonb from generate_series(1, ${room}) n`
    try {
      expect((await add('us', 'Rolled back', 500)).code).toBe('TOO_MANY')
      expect((await setup('us')).classes).toHaveLength(classesBefore)
    } finally {
      await db.sql`delete from tax_zone where store_id = ${stores.us} and name like 'Filler %'`
    }
    // A store with no country has no home to put a rate in.
    await db.sql`update store set country = null where id = ${stores.us}`
    try {
      const nowhere = await add('us', 'Nowhere', 500)
      expect(nowhere.code).toBe('NO_COUNTRY')
      expect(nowhere.errors?.[0]?.message).toContain('Store info')
      expect((await setup('us')).classes).toHaveLength(classesBefore)
    } finally {
      await db.sql`update store set country = 'US' where id = ${stores.us}`
    }
  })

  it('keeps each store to its own classes, rates and versions', async () => {
    const theirs = (await setup('india')).classes[0]?.id
    expect((await gql('mutation Z($input: TaxZoneInput!) { saveTaxZone(input: $input) }', 'us', { input: { name: 'Borrowed', countries: ['US'], rates: [{ taxClassId: theirs, rateBps: 500 }] } })).code).toBe('NOT_FOUND')
    expect((await gql('mutation C($id: ID, $input: TaxClassInput!) { saveTaxClass(id: $id, input: $input) }', 'us', { id: theirs, input: { name: 'Taken' } })).code).toBe('NOT_FOUND')
    const india = await product('india', 'INR', '10000')
    expect((await quote('us', [{ versionId: india.versionId, quantity: 1 }], { country: 'US', region: 'OH' })).code).toBe('NOT_FOUND')
    expect((await quote('other', [{ versionId: india.versionId, quantity: 1 }], { country: 'IN', region: 'Rajasthan' })).code).toBe('NOT_FOUND')
    expect((await product('us', 'USD', '1000', theirs)).code).toBe('INVALID_INPUT')
    expect((await setup('other')).classes.some((c) => c.id === theirs)).toBe(false)
    const supplier: CallerContext = { caller: { kind: 'person', userId: people.supplier, sessionId: 's' }, partnerId: t.partnerA, storeId: stores.india, sellerScope: { kind: 'seller', sellerId: seller }, subscription: 'active' }
    for (const table of ['tax_zone', 'tax_rate', 'invoice_settings']) {
      await expect(withScope(db.sql, supplier, (tx) => tx.unsafe(`select 1 from ${table}`))).rejects.toThrow(/permission denied/i)
    }
    // A supplier reads its store's category names to see what its products are filed under (ACCESS §7.11), never Stripe's codes.
    const names = await withScope(db.sql, supplier, (tx) => tx<{ store_id: string }[]>`select store_id, name from tax_class`)
    expect(names.length).toBeGreaterThan(0)
    expect(names.every((c) => c.store_id === stores.india)).toBe(true)
    await expect(withScope(db.sql, supplier, (tx) => tx`select tax_code from tax_class`)).rejects.toThrow(/permission denied/i)
  })
})
