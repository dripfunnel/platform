import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #293 (SAPI 3, part 4): Settings › Catalogue, badges, size charts and a product's listing sections.
// The plan decides on the server; a supplier makes its own charts and never hears of plans (CATALOG P11, R13).

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-05T09:00:00Z')
type Who = 'owner' | 'manager' | 'supplier' | 'otherSupplier' | 'bOwner'
const people: Record<Who, string> = { owner: '', manager: '', supplier: '', otherSupplier: '', bOwner: '' }
const cookies: Record<Who, string> = { owner: '', manager: '', supplier: '', otherSupplier: '', bOwner: '' }
const plans = { full: '', bare: '' }

const user = async (partnerId: string, email: string, name: string) =>
  (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${name}, 'active') returning id`)[0]?.id ?? ''

const subscribe = async (storeId: string, partnerId: string, planId: string) => {
  await db.sql`update store set plan_id = ${planId}, pricing_currency = 'INR' where id = ${storeId}`
  await db.sql`delete from store_subscription where store_id = ${storeId}`
  await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
    values (${storeId}, ${partnerId}, ${planId}, 1, 'active', 'month', 'INR', 0, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)})`
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update seller set access_level = 'vendor-catalogue' where id in (${t.sellerA1First}, ${t.sellerA1Second})`
  const plan = async (partnerId: string, name: string, charts: boolean) => {
    const [row] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${partnerId}, ${name}, 'live') returning id`
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${row?.id ?? ''}, ${partnerId}, 1, 'products', 100)`
    if (charts) await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, enabled) values (${row?.id ?? ''}, ${partnerId}, 1, 'size_charts', true)`
    return row?.id ?? ''
  }
  plans.full = await plan(t.partnerA, 'Full', true)
  plans.bare = await plan(t.partnerA, 'Bare', false)
  await subscribe(t.storeA1, t.partnerA, plans.full)
  await subscribe(t.storeB1, t.partnerB, await plan(t.partnerB, 'B full', true))
  people.owner = await user(t.partnerA, 'owner@a.example', 'Olivia')
  people.manager = await user(t.partnerA, 'manager@a.example', 'Mo')
  people.supplier = await user(t.partnerA, 'anand@a.example', 'Anand')
  people.otherSupplier = await user(t.partnerA, 'bhatia@a.example', 'Bhatia')
  people.bOwner = await user(t.partnerB, 'owner@b.example', 'Bea')
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people.owner}, ${t.storeA1}, 'owner', 'active'), (${people.manager}, ${t.storeA1}, 'manager', 'active'), (${people.bOwner}, ${t.storeB1}, 'owner', 'active')`
  await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${people.supplier}, ${t.storeA1}, ${t.sellerA1First}, 'supplier-admin', 'active'), (${people.otherSupplier}, ${t.storeA1}, ${t.sellerA1Second}, 'supplier-admin', 'active')`
  for (const who of Object.keys(cookies) as Who[]) {
    cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: who === 'bOwner' ? t.partnerB : t.partnerA }, now))
  }
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const sellerOf: Partial<Record<Who, () => string>> = { supplier: () => t.sellerA1First, otherSupplier: () => t.sellerA1Second }

const gql = async (source: string, who: Who, variables: Record<string, unknown> = {}) => {
  const partnerId = who === 'bOwner' ? t.partnerB : t.partnerA
  const storeId = who === 'bOwner' ? t.storeB1 : t.storeA1
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const seller = sellerOf[who]?.()
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: storeId, ...(seller ? { [supplierHeader]: seller } : {}) }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), partnerId, now, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId, sql: db.sql, activity: activityLog, facts, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, errors: result.errors }
}

const settings = async (who: Who) =>
  (await gql('{ catalogueSettings { features { key enabled inPlan } badges { id label rule } } }', who)).data?.['catalogueSettings'] as { features: { key: string; enabled: boolean; inPlan: boolean | null }[]; badges: { id: string; label: string; rule: string }[] }

const chart = { name: "Men's shirts", unit: 'cm', measurements: ['Chest', 'Length'], rows: [{ size: 'M', values: ['96–101', '72'] }, { size: 'L', values: ['102–107', '74'] }] }
const saveChart = async (who: Who, input = chart, id?: string, revision?: number) => {
  const result = await gql('mutation C($id: ID, $revision: Int, $input: SizeChartInput!) { saveSizeChart(id: $id, revision: $revision, input: $input) { id revision } }', who, { id, revision, input })
  return { saved: result.data?.['saveSizeChart'] as { id: string; revision: number } | undefined, code: result.code, errors: result.errors }
}

const save = `mutation Save($id: ID, $revision: Int, $input: ProductInput!) { saveProduct(id: $id, revision: $revision, input: $input) { id revision } }`
const product = async (who: Who, name: string, extra: Record<string, unknown> = {}) => {
  const result = await gql(save, who, { input: { name, options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '100' }] }], ...extra } })
  return { id: (result.data?.['saveProduct'] as { id: string } | undefined)?.id ?? '', code: result.code }
}
const listingOf = async (who: Who, id: string) =>
  ((await gql('query P($id: ID!) { product(id: $id) { sizeChartId listing { specs { name value versionId } highlights faqs { question } relatedIds badgeIds ageRestricted hazardous compliance { region field value } marketRule { mode countries } } } }', who, { id })).data?.['product'] ?? null) as {
    sizeChartId: string | null
    listing: { specs: { name: string; value: string }[]; highlights: string[]; faqs: { question: string }[]; relatedIds: string[]; badgeIds: string[]; ageRestricted: boolean; hazardous: boolean; compliance: unknown[]; marketRule: { mode: string; countries: string[] } | null }
  } | null

describe('Settings › Catalogue', () => {
  it('starts from the prototype’s set, saves the Owner’s switches, and refuses a Manager', async () => {
    const first = await settings('owner')
    expect(Object.fromEntries(first.features.map((f) => [f.key, f.enabled]))).toMatchObject({ sizeCharts: true, specs: true, faqs: false, related: false, video: false })
    const saved = await gql('mutation S($features: [CatalogueFeatureInput!]!) { saveCatalogueSettings(features: $features) { key enabled } }', 'owner', { features: [{ key: 'faqs', enabled: true }, { key: 'video', enabled: true }] })
    expect((saved.data?.['saveCatalogueSettings'] as { key: string; enabled: boolean }[]).filter((f) => f.enabled).map((f) => f.key)).toEqual(expect.arrayContaining(['faqs', 'video']))
    expect((await gql('mutation S($features: [CatalogueFeatureInput!]!) { saveCatalogueSettings(features: $features) { key } }', 'manager', { features: [{ key: 'faqs', enabled: false }] })).code).toBe('FORBIDDEN')
    expect((await gql('mutation S($features: [CatalogueFeatureInput!]!) { saveCatalogueSettings(features: $features) { key } }', 'owner', { features: [{ key: 'teleport', enabled: true }] })).code).toBe('INVALID_INPUT')
  })

  it('tells a supplier which sections are there, never the plan', async () => {
    const theirs = await settings('supplier')
    expect(theirs.features.every((f) => f.inPlan === null)).toBe(true)
    expect(theirs.features.find((f) => f.key === 'faqs')?.enabled).toBe(true)
    expect((await gql('mutation S($features: [CatalogueFeatureInput!]!) { saveCatalogueSettings(features: $features) { key } }', 'supplier', { features: [] })).code).toBe('FORBIDDEN')
  })

  it('switches on a plan feature only when the plan has it, naming the plan that does', async () => {
    await subscribe(t.storeA1, t.partnerA, plans.bare)
    try {
      const sizes = (await settings('owner')).features.find((f) => f.key === 'sizeCharts')
      expect(sizes?.inPlan).toBe(false)
      const refused = await gql('mutation S($features: [CatalogueFeatureInput!]!) { saveCatalogueSettings(features: $features) { key } }', 'owner', { features: [{ key: 'sizeCharts', enabled: true }] })
      expect(refused.errors?.[0]?.extensions).toMatchObject({ code: 'PLAN_LIMIT', key: 'size_charts', unlockedBy: { id: plans.full } })
      expect((await saveChart('owner')).code).toBe('PLAN_LIMIT')
      expect((await saveChart('supplier')).errors?.[0]?.extensions).toEqual({ code: 'FEATURE_UNAVAILABLE' })
      expect((await settings('supplier')).features.find((f) => f.key === 'sizeCharts')?.enabled).toBe(false)
    } finally {
      await subscribe(t.storeA1, t.partnerA, plans.full)
    }
  })

  it('takes a badge off the products it was picked on once it shows by a rule instead', async () => {
    const badge = (await gql('mutation B($input: BadgeInput!) { saveBadge(input: $input) }', 'owner', { input: { label: 'Gift pick', tone: 'ok', rule: 'manual' } })).data?.['saveBadge'] as string
    const picked = await product('owner', 'Gift box', { listing: { badgeIds: [badge] } })
    expect((await listingOf('owner', picked.id))?.listing.badgeIds).toEqual([badge])
    expect((await gql('mutation B($id: ID, $input: BadgeInput!) { saveBadge(id: $id, input: $input) }', 'owner', { id: badge, input: { label: 'Gift pick', tone: 'ok', rule: 'new_30_days' } })).code).toBeUndefined()
    expect((await listingOf('owner', picked.id))?.listing.badgeIds).toEqual([])
    // The product saves and copies again, holding no badge the trigger refuses.
    const base = { name: 'Gift box', options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '100' }] }] }
    expect((await gql(save, 'owner', { id: picked.id, revision: 1, input: { ...base, listing: { badgeIds: [] } } })).code).toBeUndefined()
    expect((await gql('mutation C($id: ID!) { duplicateProduct(id: $id) { id } }', 'owner', { id: picked.id })).code).toBeUndefined()
  })

  it('keeps badges to 18 characters, unique labels and one rule each', async () => {
    const made = await gql('mutation B($input: BadgeInput!) { saveBadge(input: $input) }', 'owner', { input: { label: 'Handmade', tone: 'peach', rule: 'manual' } })
    expect(made.data?.['saveBadge']).toBeTruthy()
    expect((await gql('mutation B($input: BadgeInput!) { saveBadge(input: $input) }', 'owner', { input: { label: 'handmade', tone: 'ok', rule: 'manual' } })).code).toBe('DUPLICATE_LABEL')
    expect((await gql('mutation B($input: BadgeInput!) { saveBadge(input: $input) }', 'owner', { input: { label: 'Far too long for a badge', tone: 'ok', rule: 'manual' } })).code).toBe('INVALID_INPUT')
    expect((await settings('supplier')).badges.map((b) => b.label)).toContain('Handmade')
    expect((await settings('bOwner')).badges).toEqual([])
  })

  it('holds the badge limit when two are made at the same moment', async () => {
    const [{ n } = { n: 0 }] = await db.sql<{ n: number }[]>`select count(*)::int as n from badge where store_id = ${t.storeB1}`
    await db.sql`insert into badge (store_id, label, tone, rule) select ${t.storeB1}, 'B' || g, 'ok', 'manual' from generate_series(1, ${19 - n}) g`
    // Another save holds the store's lock and has made the 20th, not yet committed.
    let commit = () => {}
    const held = new Promise<void>((resolve) => (commit = resolve))
    const other = db.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`badge:${t.storeB1}`}))`
      await tx`insert into badge (store_id, label, tone, rule) values (${t.storeB1}, 'B20', 'ok', 'manual')`
      await held
    })
    await new Promise((r) => setTimeout(r, 100))
    const mine = gql('mutation B($input: BadgeInput!) { saveBadge(input: $input) }', 'bOwner', { input: { label: 'B21', tone: 'ok', rule: 'manual' } })
    await new Promise((r) => setTimeout(r, 200))
    commit()
    await other
    expect((await mine).code).toBe('TOO_MANY_BADGES')
    await db.sql`delete from badge where store_id = ${t.storeB1}`
  })
})

describe('size charts', () => {
  it('are the merchant’s or a supplier’s own, each seen only by its owner and the merchant', async () => {
    const mine = await saveChart('owner')
    const theirs = await saveChart('supplier', { ...chart, name: 'Kurtas' })
    const other = await saveChart('otherSupplier', { ...chart, name: 'Shawls' })
    const names = async (who: Who) => (((await gql('{ sizeCharts(first: 50) { nodes { name supplierId } } }', who)).data?.['sizeCharts'] as { nodes: { name: string }[] } | undefined)?.nodes ?? []).map((c) => c.name).sort()
    expect(await names('owner')).toEqual(["Kurtas", "Men's shirts", 'Shawls'])
    expect(await names('supplier')).toEqual(['Kurtas'])
    expect(await names('bOwner')).toEqual([])
    expect((await gql('query C($id: ID!) { sizeChart(id: $id) { name } }', 'supplier', { id: mine.saved?.id })).data?.['sizeChart']).toBeNull()
    expect((await saveChart('supplier', { ...chart, name: 'Taken' }, other.saved?.id, 1)).code).toBe('NOT_FOUND')
    expect((await saveChart('owner', { ...chart, name: 'Renamed' }, mine.saved?.id, 1)).saved?.revision).toBe(2)
    expect((await saveChart('owner', { ...chart, name: 'Again' }, mine.saved?.id, 1)).code).toBe('STALE_REVISION')
    expect((await saveChart('owner', { ...chart, rows: [{ size: 'M', values: ['1'] }] })).code).toBe('INVALID_INPUT')
    expect(theirs.saved?.id).toBeTruthy()
  })

  it('stop at 200 for each owner, a supplier’s count saying nothing of the merchant’s', async () => {
    await db.sql`insert into size_chart (store_id, seller_id, name, unit) select ${t.storeA1}, ${t.sellerA1Second}, 'Cap ' || n, 'cm' from generate_series(1, 200) as n`
    expect((await saveChart('otherSupplier', { ...chart, name: 'One too many' })).code).toBe('TOO_MANY_SIZE_CHARTS')
    // The merchant and another supplier have their own 200, untouched by this one's.
    expect((await saveChart('supplier', { ...chart, name: 'Still room' })).code).toBeUndefined()
    expect((await saveChart('owner', { ...chart, name: 'Owner room' })).code).toBeUndefined()
    await db.sql`update size_chart set deleted_at = now() where store_id = ${t.storeA1} and seller_id = ${t.sellerA1Second} and name like 'Cap %'`
  })

  it('page charts made in the same instant one at a time, every one once', async () => {
    const made = (await db.sql<{ id: string }[]>`insert into size_chart (store_id, name, unit) select ${t.storeB1}, 'Instant ' || g, 'cm' from generate_series(1, 3) g returning id`).map((r) => r.id)
    const seen: string[] = []
    let after: string | undefined
    for (let page = 0; page < 10; page += 1) {
      const answer = (await gql('query L($after: String) { sizeCharts(first: 1, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } } }', 'bOwner', { after })).data?.['sizeCharts'] as { nodes: { id: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
      seen.push(...answer.nodes.map((n) => n.id))
      if (!answer.pageInfo.hasNextPage) break
      after = answer.pageInfo.endCursor ?? undefined
    }
    expect(made.every((id) => seen.filter((s) => s === id).length === 1)).toBe(true)
    await db.sql`update size_chart set deleted_at = now() where store_id = ${t.storeB1} and name like 'Instant %'`
  })

  it('hold the limit when two charts are made at the same moment', async () => {
    const [{ n } = { n: 0 }] = await db.sql<{ n: number }[]>`select count(*)::int as n from size_chart where store_id = ${t.storeA1} and seller_id = ${t.sellerA1Second} and deleted_at is null`
    await db.sql`insert into size_chart (store_id, seller_id, name, unit) select ${t.storeA1}, ${t.sellerA1Second}, 'Race ' || g, 'cm' from generate_series(1, ${199 - n}) as g`
    // Another save holds the owner's lock and has made the 200th chart, not yet committed.
    let commit = () => {}
    const held = new Promise<void>((resolve) => (commit = resolve))
    const other = db.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`size_chart:${t.storeA1}:${t.sellerA1Second}`}))`
      await tx`insert into size_chart (store_id, seller_id, name, unit) values (${t.storeA1}, ${t.sellerA1Second}, 'Race 200', 'cm')`
      await held
    })
    await new Promise((r) => setTimeout(r, 100))
    const mine = saveChart('otherSupplier', { ...chart, name: 'One more' })
    await new Promise((r) => setTimeout(r, 200))
    commit()
    await other
    expect((await mine).code).toBe('TOO_MANY_SIZE_CHARTS')
    await db.sql`update size_chart set deleted_at = now() where store_id = ${t.storeA1} and seller_id = ${t.sellerA1Second}`
  })

  it('come a page at a time, newest edit first', async () => {
    const page = (await gql('{ sizeCharts(first: 2) { nodes { name } pageInfo { hasNextPage endCursor } } }', 'owner')).data?.['sizeCharts'] as { nodes: { name: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string } }
    expect(page.nodes).toHaveLength(2)
    expect(page.pageInfo.hasNextPage).toBe(true)
    const next = (await gql('query S($after: String) { sizeCharts(first: 50, after: $after) { nodes { name } } }', 'owner', { after: page.pageInfo.endCursor })).data?.['sizeCharts'] as { nodes: { name: string }[] }
    expect(next.nodes.some((n) => page.nodes.some((p) => p.name === n.name))).toBe(false)
  })

  it('go only on a product of the same owner, and a delete says how many products lose it', async () => {
    const mine = (await saveChart('owner', { ...chart, name: 'Owner chart' })).saved?.id
    const theirs = (await saveChart('supplier', { ...chart, name: 'Supplier chart' })).saved?.id
    const merchantProduct = await product('owner', 'Merchant shirt', { sizeChartId: mine })
    expect(merchantProduct.code).toBeUndefined()
    expect((await listingOf('owner', merchantProduct.id))?.sizeChartId).toBe(mine)
    expect((await product('owner', 'Wrong chart', { sizeChartId: theirs })).code).toBe('LISTING_REFUSED')
    expect((await product('supplier', 'Supplier with merchant chart', { sizeChartId: mine })).code).toBe('LISTING_REFUSED')
    expect((await product('supplier', 'Supplier kurta', { sizeChartId: theirs })).code).toBeUndefined()
    // A trashed product loses the chart too, but the answer counts the live ones the editor showed.
    const trashed = await product('owner', 'Trashed shirt', { sizeChartId: mine })
    await gql('mutation D($ids: [ID!]!) { deleteProducts(ids: $ids) }', 'owner', { ids: [trashed.id] })
    const shown = ((await gql('query C($id: ID!) { sizeChart(id: $id) { products } }', 'owner', { id: mine })).data?.['sizeChart'] as { products: number }).products
    expect(shown).toBe(1)
    expect((await gql('mutation D($id: ID!) { deleteSizeChart(id: $id) }', 'owner', { id: mine })).data?.['deleteSizeChart']).toBe(shown)
    const [linked] = await db.sql<{ n: number }[]>`select count(*)::int as n from product where size_chart_id = ${mine ?? ''}`
    expect(linked?.n).toBe(0)
    expect((await listingOf('owner', merchantProduct.id))?.sizeChartId).toBeNull()
    expect((await gql('mutation D($id: ID!) { deleteSizeChart(id: $id) }', 'supplier', { id: mine })).code).toBe('NOT_FOUND')
  })
})

describe('a product’s listing sections', () => {
  it('saves each section given and keeps the ones left out', async () => {
    const related = await product('owner', 'Related scarf')
    const badge = (await gql('mutation B($input: BadgeInput!) { saveBadge(input: $input) }', 'owner', { input: { label: 'Staff pick', tone: 'ok', rule: 'manual' } })).data?.['saveBadge'] as string
    const listing = {
      specs: [{ name: 'Material', value: 'Cotton' }],
      highlights: ['Soft', 'Breathable'],
      faqs: [{ question: 'Does it shrink?', answer: 'No.' }],
      relatedIds: [related.id],
      badgeIds: [badge],
      ageRestricted: false,
      hazardous: false,
      compliance: [{ region: 'IN', field: 'country_of_origin', value: 'India' }],
      marketRule: { mode: 'only', countries: ['IN', 'US'] },
    }
    const made = await product('owner', 'Listed shirt', { listing })
    expect(made.code).toBeUndefined()
    expect((await listingOf('owner', made.id))?.listing).toMatchObject({ specs: [{ name: 'Material', value: 'Cotton' }], highlights: ['Soft', 'Breathable'], relatedIds: [related.id], badgeIds: [badge], marketRule: { mode: 'only', countries: ['IN', 'US'] } })
    const updated = await gql(save, 'owner', { id: made.id, revision: 1, input: { name: 'Listed shirt', options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '100' }] }], listing: { highlights: ['Soft only'], marketRule: null } } })
    expect(updated.code).toBeUndefined()
    expect((await listingOf('owner', made.id))?.listing).toMatchObject({ specs: [{ name: 'Material' }], highlights: ['Soft only'], marketRule: null, relatedIds: [related.id] })
  })

  it('keeps the flag left out, and drops a trashed related product so a copy and a re-save still work', async () => {
    const related = await product('owner', 'Soon trashed')
    const made = await product('owner', 'Flagged lamp', { listing: { relatedIds: [related.id], ageRestricted: true, hazardous: true } })
    const base = { name: 'Flagged lamp', options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '100' }] }] }
    expect((await gql(save, 'owner', { id: made.id, revision: 1, input: { ...base, listing: { ageRestricted: false } } })).code).toBeUndefined()
    expect((await listingOf('owner', made.id))?.listing).toMatchObject({ ageRestricted: false, hazardous: true })

    await gql('mutation D($ids: [ID!]!) { deleteProducts(ids: $ids) }', 'owner', { ids: [related.id] })
    const shown = await listingOf('owner', made.id)
    expect(shown?.listing.relatedIds).toEqual([])
    const copy = await gql('mutation C($id: ID!) { duplicateProduct(id: $id) { id } }', 'owner', { id: made.id })
    expect(copy.code).toBeUndefined()
    // The form sends back what it read, which no longer names the trashed product.
    expect((await gql(save, 'owner', { id: made.id, revision: 2, input: { ...base, listing: { relatedIds: shown?.listing.relatedIds } } })).code).toBeUndefined()
  })

  it('has the indexes the sections and the chart counts read by', async () => {
    const names = (await db.sql<{ indexname: string }[]>`select indexname from pg_indexes where indexname = any(${'{product_size_chart_idx,product_spec_product_idx,product_highlight_product_idx,product_faq_product_idx,product_badge_badge_idx,product_related_target_idx,product_spec_filter_value_idx}'}::text[])`).map((r) => r.indexname)
    expect(names.sort()).toEqual(['product_badge_badge_idx', 'product_faq_product_idx', 'product_highlight_product_idx', 'product_related_target_idx', 'product_size_chart_idx', 'product_spec_filter_value_idx', 'product_spec_product_idx'])
  })

  it('refuses a specification mirroring a filter value this store doesn’t have', async () => {
    const foreign = (await gql('mutation F($input: FacetInput!) { saveFacet(input: $input) }', 'bOwner', { input: { name: 'B fabric', values: [{ name: 'Wool' }] } })).data?.['saveFacet'] as string
    const wool = ((await gql('{ facets(first: 50) { nodes { id values { id } } } }', 'bOwner')).data?.['facets'] as { nodes: { id: string; values: { id: string }[] }[] }).nodes.find((f) => f.id === foreign)?.values[0]?.id
    for (const filterValueId of ['00000000-0000-4000-8000-0000000000ff', wool]) {
      expect((await product('owner', 'Odd spec', { listing: { specs: [{ name: 'Fabric', value: 'Wool', filterValueId }] } })).code).toBe('INVALID_LISTING')
    }
  })

  it('keeps a specification when the filter value it mirrors is removed, without the link', async () => {
    const facet = (await gql('mutation F($input: FacetInput!) { saveFacet(input: $input) }', 'owner', { input: { name: 'Fabric', values: [{ name: 'Cotton' }, { name: 'Silk' }] } })).data?.['saveFacet'] as string
    const values = ((await gql('{ facets(first: 50) { nodes { id values { id name } } } }', 'owner')).data?.['facets'] as { nodes: { id: string; values: { id: string; name: string }[] }[] }).nodes.find((f) => f.id === facet)?.values ?? []
    const cotton = values.find((v) => v.name === 'Cotton')
    const made = await product('owner', 'Mirrored spec', { listing: { specs: [{ name: 'Fabric', value: 'Cotton', filterValueId: cotton?.id }] } })
    const silk = values.find((v) => v.name === 'Silk')
    expect((await gql('mutation F($input: FacetInput!) { saveFacet(input: $input) }', 'owner', { input: { id: facet, name: 'Fabric', values: [{ id: silk?.id, name: 'Silk' }] } })).code).toBeUndefined()
    const spec = ((await gql('query P($id: ID!) { product(id: $id) { listing { specs { name value filterValueId } } } }', 'owner', { id: made.id })).data?.['product'] as { listing: { specs: unknown[] } }).listing.specs
    expect(spec).toEqual([{ name: 'Fabric', value: 'Cotton', filterValueId: null }])
  })

  it('relates only this store’s products, a supplier only its own, and picks only manual badges', async () => {
    const theirProduct = await product('bOwner', 'B product')
    expect((await product('owner', 'Cross relate', { listing: { relatedIds: [theirProduct.id] } })).code).toBe('LISTING_REFUSED')
    const merchant = await product('owner', 'Merchant only')
    expect((await product('supplier', 'Supplier relates', { listing: { relatedIds: [merchant.id] } })).code).toBe('LISTING_REFUSED')
    const own = await product('supplier', 'Supplier own')
    // Nor can the merchant put another owner's product on the supplier's, where the supplier would see its id.
    const otherOwners = await product('otherSupplier', 'Other supplier own')
    for (const related of [merchant.id, otherOwners.id]) {
      expect((await gql(save, 'owner', { id: own.id, revision: 1, input: { name: 'Supplier own', options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '100' }] }], listing: { relatedIds: [related] } } })).code).toBe('LISTING_REFUSED')
    }
    // The merchant's own product may relate a supplier's: that row is the merchant's, never the supplier's to read.
    expect((await gql(save, 'owner', { id: merchant.id, revision: 1, input: { name: 'Merchant only', options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '100' }] }], listing: { relatedIds: [own.id] } } })).code).toBeUndefined()
    expect((await product('supplier', 'Supplier relates own', { listing: { relatedIds: [own.id] } })).code).toBeUndefined()
    const auto = (await gql('mutation B($input: BadgeInput!) { saveBadge(input: $input) }', 'owner', { input: { label: 'New in', tone: 'ok', rule: 'new_30_days' } })).data?.['saveBadge'] as string
    expect((await product('owner', 'Auto badge', { listing: { badgeIds: [auto] } })).code).toBe('LISTING_REFUSED')
    expect((await product('owner', 'Bad country', { listing: { marketRule: { mode: 'only', countries: ['ZZ'] } } })).code).toBe('INVALID_LISTING')
    expect((await product('owner', 'Bad chart id', { sizeChartId: '-'.repeat(36) })).code).toBe('INVALID_LISTING')
    const self = await product('owner', 'Self related')
    expect((await gql(save, 'owner', { id: self.id, revision: 1, input: { name: 'Self related', options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '100' }] }], listing: { relatedIds: [self.id] } } })).code).toBe('LISTING_REFUSED')
    expect(await listingOf('supplier', merchant.id)).toBeNull()
  })

  it('needs the plan for a size chart, but never for removing one', async () => {
    const mine = (await saveChart('owner', { ...chart, name: 'Plan chart' })).saved?.id
    const other = (await saveChart('owner', { ...chart, name: 'Other plan chart' })).saved?.id
    const made = await product('owner', 'Plan shirt', { sizeChartId: mine })
    await subscribe(t.storeA1, t.partnerA, plans.bare)
    try {
      expect((await gql(save, 'owner', { id: made.id, revision: 1, input: { name: 'Plan shirt', options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '100' }] }], sizeChartId: other } })).code).toBe('PLAN_LIMIT')
      // The chart it already has keeps saving with every other change; only assigning one needs the plan.
      expect((await gql(save, 'owner', { id: made.id, revision: 1, input: { name: 'Plan shirt renamed', options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '100' }] }], sizeChartId: mine } })).code).toBeUndefined()
      const copy = (await gql('mutation C($id: ID!) { duplicateProduct(id: $id) { id } }', 'owner', { id: made.id })).data?.['duplicateProduct'] as { id: string }
      expect((await listingOf('owner', copy.id))?.sizeChartId).toBeNull()
      expect((await gql(save, 'owner', { id: made.id, revision: 2, input: { name: 'Plan shirt', options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '100' }] }], sizeChartId: null } })).code).toBeUndefined()
    } finally {
      await subscribe(t.storeA1, t.partnerA, plans.full)
    }
  })
})
