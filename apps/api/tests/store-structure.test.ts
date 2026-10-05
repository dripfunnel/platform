import { graphql, type GraphQLSchema } from 'graphql'
import type postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import { collectionsRecomputeKind } from '#engine/modules/catalog/index'
import { collectionsRecomputeDeliverer } from '#jobs/queues/deliverers/collectionsRecompute'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #293 (SAPI 3, part 3): filters, collections and the main menu. The merchant side writes them; a
// supplier reads filters and tags its own products; automatic collections land after commit (fact 14).

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-05T09:00:00Z')
type Who = 'owner' | 'staff' | 'supplier' | 'bOwner'
const people: Record<Who, string> = { owner: '', staff: '', supplier: '', bOwner: '' }
const cookies: Record<Who, string> = { owner: '', staff: '', supplier: '', bOwner: '' }

const user = async (partnerId: string, email: string, name: string) =>
  (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${name}, 'active') returning id`)[0]?.id ?? ''

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update seller set access_level = 'vendor-catalogue' where id = ${t.sellerA1First}`
  for (const [storeId, partnerId] of [[t.storeA1, t.partnerA], [t.storeB1, t.partnerB]] as const) {
    const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${partnerId}, 'Plan', 'live') returning id`
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${plan?.id ?? ''}, ${partnerId}, 1, 'products', 100)`
    await db.sql`update store set plan_id = ${plan?.id ?? ''}, pricing_currency = 'INR' where id = ${storeId}`
    await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
      values (${storeId}, ${partnerId}, ${plan?.id ?? ''}, 1, 'active', 'month', 'INR', 0, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)})`
  }
  people.owner = await user(t.partnerA, 'owner@a.example', 'Olivia')
  people.staff = await user(t.partnerA, 'staff@a.example', 'Sam')
  people.supplier = await user(t.partnerA, 'anand@a.example', 'Anand')
  people.bOwner = await user(t.partnerB, 'owner@b.example', 'Bea')
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people.owner}, ${t.storeA1}, 'owner', 'active'), (${people.staff}, ${t.storeA1}, 'staff', 'active'), (${people.bOwner}, ${t.storeB1}, 'owner', 'active')`
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
  const storeId = who === 'bOwner' ? t.storeB1 : t.storeA1
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: storeId, ...(who === 'supplier' ? { [supplierHeader]: t.sellerA1First } : {}) }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), partnerId, now, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId, sql: db.sql, activity: activityLog, facts, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

type Facet = { id: string; name: string; shopperVisible: boolean; values: { id: string; name: string; products: number }[] }
const facets = async (who: Who) => (((await gql('{ facets(first: 50) { nodes { id name shopperVisible values { id name products } } } }', who)).data?.['facets'] as { nodes: Facet[] } | undefined)?.nodes ?? [])
const saveFacet = async (who: Who, input: Record<string, unknown>) => {
  const result = await gql('mutation F($input: FacetInput!) { saveFacet(input: $input) }', who, { input })
  return { id: result.data?.['saveFacet'] as string | undefined, code: result.code }
}

const product = async (who: Who, name: string, extra: Record<string, unknown> = {}) => {
  const result = await gql('mutation S($input: ProductInput!) { saveProduct(input: $input) { id } }', who, {
    input: { name, options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '50000' }] }], ...extra },
  })
  return { id: (result.data?.['saveProduct'] as { id: string } | undefined)?.id ?? '', code: result.code }
}

/** What the relay would do with the queued rows: each recompute the store asked for, run now. */
const drainRecompute = async () => {
  const rows = await db.sql<{ id: string; payload: unknown }[]>`select id, payload from outbox where kind = ${collectionsRecomputeKind} and delivered_at is null`
  const deliverer = collectionsRecomputeDeliverer(db.sql, () => now)
  for (const row of rows) await deliverer.deliver({ id: row.id, kind: collectionsRecomputeKind, payload: row.payload } as never, new AbortController().signal)
  await db.sql`update outbox set delivered_at = now() where kind = ${collectionsRecomputeKind} and delivered_at is null`
  return rows.length
}

const members = async (collectionId: string) =>
  ((await gql('query C($id: ID!) { collectionProducts(id: $id, first: 50) { nodes { id source } } }', 'owner', { id: collectionId })).data?.['collectionProducts'] as { nodes: { id: string; source: string }[] }).nodes


/** Runs `insert` in a transaction holding `key`'s lock, starts `attempt` while it's held, then commits: the attempt must wait and see it. */
const racedBy = async <T>(key: string, insert: (tx: postgres.TransactionSql) => Promise<unknown>, attempt: () => Promise<T>): Promise<T> => {
  let commit = () => {}
  const held = new Promise<void>((resolve) => (commit = resolve))
  const other = db.sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${key}))`
    await insert(tx)
    await held
  })
  await new Promise((r) => setTimeout(r, 100))
  const result = attempt()
  await new Promise((r) => setTimeout(r, 200))
  commit()
  await other
  return result
}

describe('filters', () => {
  let fabric = ''

  it('are the merchant’s to write, and a supplier and Staff read them', async () => {
    const saved = await saveFacet('owner', { name: 'Fabric', values: [{ name: 'Cotton' }, { name: 'Linen' }, { name: 'linen ' }] })
    expect(saved.code).toBe('DUPLICATE_VALUE')
    fabric = (await saveFacet('owner', { name: 'Fabric', values: [{ name: 'Cotton' }, { name: 'Linen' }] })).id ?? ''
    expect((await facets('owner')).map((f) => [f.name, f.values.map((v) => v.name)])).toEqual([['Fabric', ['Cotton', 'Linen']]])
    expect((await facets('supplier')).map((f) => f.name)).toEqual(['Fabric'])
    expect((await facets('staff')).map((f) => f.name)).toEqual(['Fabric'])
    expect((await saveFacet('supplier', { name: 'Theirs', values: [] })).code).toBe('FORBIDDEN')
    expect((await saveFacet('staff', { name: 'Staff', values: [] })).code).toBe('FORBIDDEN')
    expect((await saveFacet('owner', { name: 'fabric', values: [] })).code).toBe('DUPLICATE_NAME')
    for (const position of [-1, 10_001]) expect((await saveFacet('owner', { name: `At ${position}`, position, values: [] })).code).toBe('INVALID_INPUT')
    expect(await facets('bOwner')).toEqual([])
  })

  it('stops at 200 filters, so every one the store has can be listed', async () => {
    await db.sql`insert into filter (store_id, name, position) select ${t.storeB1}, 'Bulk ' || n, n from generate_series(1, 200) as n`
    expect((await saveFacet('bOwner', { name: 'One too many', values: [] })).code).toBe('TOO_MANY_FILTERS')
    // A page at a time, in their order: 200 filters are four pages of 50, every one reached.
    const seen: string[] = []
    let after: string | undefined
    for (let page = 0; page < 5; page += 1) {
      const answer = (await gql('query F($after: String) { facets(first: 50, after: $after) { nodes { name } pageInfo { hasNextPage endCursor } } }', 'bOwner', { after })).data?.['facets'] as { nodes: { name: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string } }
      seen.push(...answer.nodes.map((n) => n.name))
      if (!answer.pageInfo.hasNextPage) break
      after = answer.pageInfo.endCursor
    }
    expect(seen).toHaveLength(200)
    expect(new Set(seen).size).toBe(200)
    expect(seen.slice(0, 2)).toEqual(['Bulk 1', 'Bulk 2'])
    await db.sql`delete from filter where store_id = ${t.storeB1} and name like 'Bulk %'`
  })

  it('holds the filter limit when two are made at the same moment', async () => {
    await db.sql`insert into filter (store_id, name, position) select ${t.storeB1}, 'Race ' || n, n from generate_series(1, 199) as n`
    const second = await racedBy(`filter:${t.storeB1}`, (tx) => tx`insert into filter (store_id, name, position) values (${t.storeB1}, 'Race 200', 200)`, () => saveFacet('bOwner', { name: 'Racing', values: [] }))
    expect(second.code).toBe('TOO_MANY_FILTERS')
    await db.sql`delete from filter where store_id = ${t.storeB1} and name like 'Race %'`
  })

  it('tag products and versions, each side counting only what it can see', async () => {
    const [cotton, linen] = (await facets('owner'))[0]?.values ?? []
    const mine = await product('owner', 'Cotton shirt', { filterValues: [{ valueId: cotton?.id }] })
    expect(mine.code).toBeUndefined()
    const theirs = await product('supplier', 'Linen kurta', { filterValues: [{ valueId: linen?.id }, { valueId: cotton?.id, version: 0 }] })
    expect(theirs.code).toBeUndefined()
    const counted = (list: Facet[]) => Object.fromEntries((list[0]?.values ?? []).map((v) => [v.name, v.products]))
    expect(counted(await facets('owner'))).toEqual({ Cotton: 2, Linen: 1 })
    expect(counted(await facets('supplier'))).toEqual({ Cotton: 1, Linen: 1 })
    const shown = (await gql('query P($id: ID!) { product(id: $id) { filterValues { valueId versionId } } }', 'supplier', { id: theirs.id })).data?.['product'] as { filterValues: { valueId: string; versionId: string | null }[] }
    expect(shown.filterValues).toHaveLength(2)
    const [bFacet] = await Promise.all([saveFacet('bOwner', { name: 'B only', values: [{ name: 'X' }] })])
    const bValue = (await facets('bOwner')).find((f) => f.id === bFacet.id)?.values[0]?.id
    expect((await product('owner', 'Wrong tag', { filterValues: [{ valueId: bValue }] })).code).toBe('INVALID_FILTER')
  })

  it('drops a collection rule whose filter value is removed', async () => {
    const facet = (await saveFacet('owner', { name: 'Season', values: [{ name: 'Summer' }, { name: 'Winter' }] })).id ?? ''
    const [summer, winter] = (await facets('owner')).find((f) => f.id === facet)?.values ?? []
    const made = (await gql('mutation C($input: CollectionInput!) { saveCollection(input: $input) { id } }', 'owner', { input: { name: 'Seasonal', kind: 'automatic', match: 'any', rules: [{ kind: 'filter_value', valueId: summer?.id }, { kind: 'filter_value', valueId: winter?.id }] } })).data?.['saveCollection'] as { id: string }
    expect((await saveFacet('owner', { id: facet, name: 'Season', values: [{ id: winter?.id, name: 'Winter' }] })).code).toBeUndefined()
    const rules = (await gql('query C($id: ID!) { collection(id: $id) { rules { valueId } } }', 'owner', { id: made.id })).data?.['collection'] as { rules: { valueId: string }[] }
    expect(rules.rules).toEqual([{ valueId: winter?.id }])
    expect((await gql('mutation D($id: ID!) { deleteFacet(id: $id) }', 'owner', { id: facet })).data?.['deleteFacet']).toBe(true)
    expect(((await gql('query C($id: ID!) { collection(id: $id) { rules { valueId } } }', 'owner', { id: made.id })).data?.['collection'] as { rules: unknown[] }).rules).toEqual([])
  })

  it('merges look-alike values into one, keeping every tag and rule', async () => {
    const facet = (await saveFacet('owner', { name: 'Colour', values: [{ name: 'Navy' }, { name: 'Navy blue' }] })).id ?? ''
    const [navy, navyBlue] = (await facets('owner')).find((f) => f.id === facet)?.values ?? []
    const tagged = await product('owner', 'Navy tee', { filterValues: [{ valueId: navyBlue?.id }] })
    const rule = await gql('mutation C($input: CollectionInput!) { saveCollection(input: $input) { id } }', 'owner', { input: { name: 'Navy things', kind: 'automatic', rules: [{ kind: 'filter_value', valueId: navyBlue?.id }] } })
    const collectionId = (rule.data?.['saveCollection'] as { id: string }).id
    expect((await gql('mutation M($into: ID!, $from: [ID!]!) { mergeFacetValues(into: $into, from: $from) }', 'owner', { into: navy?.id, from: [navyBlue?.id] })).data?.['mergeFacetValues']).toBe(1)
    expect((await facets('owner')).find((f) => f.id === facet)?.values.map((v) => [v.name, v.products])).toEqual([['Navy', 1]])
    const rules = (await gql('query C($id: ID!) { collection(id: $id) { rules { valueId } } }', 'owner', { id: collectionId })).data?.['collection'] as { rules: { valueId: string }[] }
    expect(rules.rules).toEqual([{ valueId: navy?.id }])
    await drainRecompute()
    expect((await members(collectionId)).map((m) => m.id)).toEqual([tagged.id])
    expect((await gql('mutation M($into: ID!, $from: [ID!]!) { mergeFacetValues(into: $into, from: $from) }', 'owner', { into: navy?.id, from: [fabric] })).code).toBe('NOT_FOUND')
  })
})

describe('collections', () => {
  const save = async (input: Record<string, unknown>, id?: string, revision?: number) => {
    const result = await gql('mutation C($id: ID, $revision: Int, $input: CollectionInput!) { saveCollection(id: $id, revision: $revision, input: $input) { id slug revision } }', 'owner', { input, id, revision })
    return { saved: result.data?.['saveCollection'] as { id: string; slug: string; revision: number } | undefined, code: result.code }
  }

  it('keeps a hand-picked collection in the order given, refusing another store’s product', async () => {
    const a = await product('owner', 'Picked A')
    const b = await product('owner', 'Picked B')
    const { saved } = await save({ name: 'Staff picks', kind: 'manual', productIds: [b.id, a.id] })
    expect((await members(saved?.id ?? '')).map((m) => [m.id, m.source])).toEqual([[b.id, 'manual'], [a.id, 'manual']])
    const other = await product('bOwner', 'B product')
    expect((await save({ name: 'Cross', kind: 'manual', productIds: [other.id] })).code).toBe('INVALID_INPUT')
  })

  it('fills an automatic collection after commit, by any or all of its rules, and inside its parent when asked', async () => {
    const linen = await product('owner', 'Linen towel')
    const cheapLinen = await product('owner', 'Linen napkin', { versions: [{ choices: [], prices: [{ currency: 'INR', amount: '9900' }] }] })
    await product('owner', 'Silk scarf')
    const any = await save({ name: 'Linen or scarves', kind: 'automatic', match: 'any', rules: [{ kind: 'name_contains', text: 'linen' }, { kind: 'name_contains', text: 'scarf' }] })
    const all = await save({ name: 'Cheap linen', kind: 'automatic', match: 'all', rules: [{ kind: 'name_contains', text: 'linen' }, { kind: 'price_range', currency: 'INR', min: '0', max: '10000' }] })
    const child = await save({ name: 'Linen inside', kind: 'automatic', parentId: all.saved?.id, inheritParent: true, rules: [{ kind: 'name_contains', text: 'linen' }] })
    expect((await gql('query C($id: ID!) { collection(id: $id) { computedAt } }', 'owner', { id: all.saved?.id })).data?.['collection']).toEqual({ computedAt: null })
    expect(await drainRecompute()).toBeGreaterThan(0)
    expect((await members(any.saved?.id ?? '')).length).toBeGreaterThanOrEqual(3)
    expect((await members(all.saved?.id ?? '')).map((m) => m.id)).toEqual([cheapLinen.id])
    expect((await members(child.saved?.id ?? '')).map((m) => m.id)).toEqual([cheapLinen.id])
    // A product deleted leaves the collections it was in at the next recompute.
    await gql('mutation D($ids: [ID!]!) { deleteProducts(ids: $ids) }', 'owner', { ids: [cheapLinen.id] })
    await drainRecompute()
    expect(await members(all.saved?.id ?? '')).toEqual([])
    expect((await members(any.saved?.id ?? '')).some((m) => m.id === linen.id)).toBe(true)
  })

  it('forgets a removed version’s tags, so its facet and the rules on it stop counting the product', async () => {
    const finish = await saveFacet('owner', { name: 'Finish', values: [{ name: 'Matte' }] })
    const matte = (await facets('owner')).find((f) => f.id === finish.id)?.values[0]
    const options = [{ name: 'Size', values: [{ name: 'S' }, { name: 'M' }] }]
    const versions = [{ choices: ['S'], prices: [{ currency: 'INR', amount: '50000' }] }, { choices: ['M'], prices: [{ currency: 'INR', amount: '50000' }] }]
    const made = await product('owner', 'Matte mug', { options, versions, filterValues: [{ valueId: matte?.id, version: 1 }] })
    const rule = await save({ name: 'Matte things', kind: 'automatic', rules: [{ kind: 'filter_value', valueId: matte?.id }] })
    await drainRecompute()
    expect((await members(rule.saved?.id ?? '')).map((m) => m.id)).toEqual([made.id])

    const read = (await gql('query P($id: ID!) { product(id: $id) { revision versions { id } } }', 'owner', { id: made.id })).data?.['product'] as { revision: number; versions: { id: string }[] }
    const kept = await gql('mutation S($id: ID, $revision: Int, $input: ProductInput!) { saveProduct(id: $id, revision: $revision, input: $input) { id } }', 'owner', {
      id: made.id,
      revision: read.revision,
      input: { name: 'Matte mug', options: [{ name: 'Size', values: [{ name: 'S' }] }], versions: [{ id: read.versions[0]?.id, choices: ['S'], prices: [{ currency: 'INR', amount: '50000' }] }] },
    })
    expect(kept.code).toBeUndefined()
    expect((await facets('owner')).find((f) => f.id === finish.id)?.values[0]?.products).toBe(0)
    expect(((await gql('query P($id: ID!) { product(id: $id) { filterValues { valueId } } }', 'owner', { id: made.id })).data?.['product'] as { filterValues: unknown[] }).filterValues).toEqual([])
    await drainRecompute()
    expect(await members(rule.saved?.id ?? '')).toEqual([])
  })

  it('pages a collection’s products in its own order', async () => {
    const ids = [(await product('owner', 'Page one')).id, (await product('owner', 'Page two')).id, (await product('owner', 'Page three')).id]
    const { saved } = await save({ name: 'Paged', kind: 'manual', productIds: [ids[2], ids[0], ids[1]] })
    const page = async (after?: string) =>
      (await gql('query C($id: ID!, $after: String) { collectionProducts(id: $id, first: 2, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } } }', 'owner', { id: saved?.id, after })).data?.['collectionProducts'] as { nodes: { id: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string } }
    const first = await page()
    expect(first.nodes.map((n) => n.id)).toEqual([ids[2], ids[0]])
    expect(first.pageInfo.hasNextPage).toBe(true)
    const second = await page(first.pageInfo.endCursor)
    expect(second.nodes.map((n) => n.id)).toEqual([ids[1]])
    expect(second.pageInfo.hasNextPage).toBe(false)
    expect((await gql('query C($id: ID!) { collectionProducts(id: $id) { nodes { id } } }', 'bOwner', { id: saved?.id })).data?.['collectionProducts']).toEqual({ nodes: [] })
  })

  it('keeps a live address through a rename, and changes it only when asked', async () => {
    const { saved } = await save({ name: 'Summer edit', kind: 'manual' })
    expect((await save({ name: 'Summer edit 2026', kind: 'manual' }, saved?.id, 1)).saved?.slug).toBe('summer-edit')
    expect((await save({ name: 'Summer edit 2026', kind: 'manual', slug: 'summer-2026' }, saved?.id, 2)).saved?.slug).toBe('summer-2026')
  })

  it('keeps the newest 1,000 when the rules match more, and says how many matched', async () => {
    await db.sql`
      insert into product (store_id, name, slug, created_at)
      select ${t.storeB1}, 'Many ' || n, 'many-' || n, ${now}::timestamptz - make_interval(secs => n) from generate_series(1, 1001) as n
    `
    const made = (await gql('mutation C($input: CollectionInput!) { saveCollection(input: $input) { id } }', 'bOwner', { input: { name: 'Many', kind: 'automatic', rules: [{ kind: 'name_contains', text: 'many ' }] } })).data?.['saveCollection'] as { id: string }
    await drainRecompute()
    const shown = (await gql('query C($id: ID!) { collection(id: $id) { ruleMatches truncated } }', 'bOwner', { id: made.id })).data?.['collection']
    expect(shown).toEqual({ ruleMatches: 1001, truncated: true })
    const [oldest] = await db.sql<{ n: number }[]>`select count(*)::int as n from collection_product cp join product p on p.id = cp.product_id where cp.collection_id = ${made.id} and p.slug = 'many-1001'`
    expect(oldest?.n).toBe(0)
    const [held] = await db.sql<{ n: number }[]>`select count(*)::int as n from collection_product where collection_id = ${made.id}`
    expect(held?.n).toBe(1000)
    await gql('mutation D($id: ID!) { deleteCollection(id: $id) }', 'bOwner', { id: made.id })
  })

  it('stops at 500 collections a store, which bounds every recompute', async () => {
    await db.sql`insert into collection (store_id, name, slug, kind) select ${t.storeB1}, 'Cap ' || n, 'cap-' || n, 'manual' from generate_series(1, 500) as n`
    const refused = await gql('mutation C($input: CollectionInput!) { saveCollection(input: $input) { id } }', 'bOwner', { input: { name: 'One more', kind: 'manual' } })
    expect(refused.code).toBe('TOO_MANY_COLLECTIONS')
    await db.sql`update collection set deleted_at = now() where store_id = ${t.storeB1} and slug like 'cap-%'`
  })

  it('pages collections made in the same instant one at a time, every one once', async () => {
    const made = (await db.sql<{ id: string }[]>`insert into collection (store_id, name, slug, kind) select ${t.storeB1}, 'Instant ' || g, 'instant-' || g, 'manual' from generate_series(1, 3) g returning id`).map((r) => r.id)
    const seen: string[] = []
    let after: string | undefined
    for (let page = 0; page < 10; page += 1) {
      const answer = (await gql('query L($after: String) { collections(first: 1, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } } }', 'bOwner', { after })).data?.['collections'] as { nodes: { id: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
      seen.push(...answer.nodes.map((n) => n.id))
      if (!answer.pageInfo.hasNextPage) break
      after = answer.pageInfo.endCursor ?? undefined
    }
    expect(made.every((id) => seen.filter((s) => s === id).length === 1)).toBe(true)
    await db.sql`update collection set deleted_at = now() where store_id = ${t.storeB1} and slug like 'instant-%'`
  })

  it('holds the collection limit when two are made at the same moment', async () => {
    await db.sql`insert into collection (store_id, name, slug, kind) select ${t.storeB1}, 'Race ' || n, 'race-' || n, 'manual' from generate_series(1, 499) as n`
    const second = await racedBy(
      `collection:${t.storeB1}`,
      (tx) => tx`insert into collection (store_id, name, slug, kind) values (${t.storeB1}, 'Race 500', 'race-500', 'manual')`,
      () => gql('mutation C($input: CollectionInput!) { saveCollection(input: $input) { id } }', 'bOwner', { input: { name: 'Racing', kind: 'manual' } }),
    )
    expect(second.code).toBe('TOO_MANY_COLLECTIONS')
    await db.sql`update collection set deleted_at = now() where store_id = ${t.storeB1} and slug like 'race-%'`
  })

  it('shows an edited automatic collection as updating until its recompute lands', async () => {
    const { saved } = await save({ name: 'Edited later', kind: 'automatic', rules: [{ kind: 'name_contains', text: 'zzz' }] })
    await drainRecompute()
    const computed = (await gql('query C($id: ID!) { collection(id: $id) { computedAt ruleMatches } }', 'owner', { id: saved?.id })).data?.['collection'] as { computedAt: string | null; ruleMatches: number | null }
    expect(computed.computedAt).not.toBeNull()
    await save({ name: 'Edited later', kind: 'automatic', rules: [{ kind: 'name_contains', text: 'yyy' }] }, saved?.id, 1)
    expect((await gql('query C($id: ID!) { collection(id: $id) { computedAt ruleMatches } }', 'owner', { id: saved?.id })).data?.['collection']).toEqual({ computedAt: null, ruleMatches: null })
  })

  it('recomputes once for a burst of changes: only the newest queued run does the work', async () => {
    await drainRecompute()
    for (const name of ['Burst one', 'Burst two', 'Burst three']) await product('owner', name)
    const queued = await db.sql<{ id: string; payload: unknown }[]>`select id, payload from outbox where kind = ${collectionsRecomputeKind} and delivered_at is null order by created_at`
    expect(queued.length).toBeGreaterThanOrEqual(3)
    // The relay's clock: a newer row counts only once it is due, which the database stamped with its own now().
    const deliverer = collectionsRecomputeDeliverer(db.sql, () => new Date(Date.now() + 1000))
    await db.sql`update collection set computed_at = null where store_id = ${t.storeA1} and kind = 'automatic'`
    const first = queued[0]
    await deliverer.deliver({ id: first?.id, kind: collectionsRecomputeKind, payload: first?.payload } as never, new AbortController().signal)
    const [untouched] = await db.sql<{ n: number }[]>`select count(*)::int as n from collection where store_id = ${t.storeA1} and kind = 'automatic' and computed_at is not null`
    expect(untouched?.n).toBe(0)
    const last = queued[queued.length - 1]
    await deliverer.deliver({ id: last?.id, kind: collectionsRecomputeKind, payload: last?.payload } as never, new AbortController().signal)
    const [done] = await db.sql<{ n: number }[]>`select count(*)::int as n from collection where store_id = ${t.storeA1} and kind = 'automatic' and computed_at is null and deleted_at is null`
    expect(done?.n).toBe(0)
    await db.sql`update outbox set delivered_at = now() where kind = ${collectionsRecomputeKind} and delivered_at is null`
  })

  it('does the work itself when the newer run is backing off after a failure', async () => {
    const rule = await save({ name: 'Backoff things', kind: 'automatic', rules: [{ kind: 'name_contains', text: 'backoff' }] })
    expect(rule.saved?.id).toBeTruthy()
    await drainRecompute()
    for (const name of ['Backoff one', 'Backoff two']) await product('owner', name)
    const queued = await db.sql<{ id: string; payload: unknown }[]>`select id, payload from outbox where kind = ${collectionsRecomputeKind} and delivered_at is null order by created_at`
    const [older, newer] = [queued[0], queued[queued.length - 1]]
    await db.sql`update outbox set attempts = 1, next_attempt_at = now() + interval '10 minutes' where id = ${newer?.id ?? ''}`
    await db.sql`update collection set computed_at = null where store_id = ${t.storeA1} and kind = 'automatic'`
    const deliverer = collectionsRecomputeDeliverer(db.sql, () => new Date(Date.now() + 1000))
    await deliverer.deliver({ id: older?.id, kind: collectionsRecomputeKind, payload: older?.payload } as never, new AbortController().signal)
    expect((await db.sql<{ computed_at: Date | null }[]>`select computed_at from collection where id = ${rule.saved?.id ?? ''}`)[0]?.computed_at).not.toBeNull()
    expect((await members(rule.saved?.id ?? '')).length).toBe(2)
    await db.sql`update outbox set delivered_at = now() where kind = ${collectionsRecomputeKind} and delivered_at is null`
  })

  it('takes as its picture only a photo of this store', async () => {
    let n = 0
    const file = async (storeId: string, kind: 'image' | 'video') => {
      n += 1
      const key = `stores/${storeId}/assets/00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}.${kind === 'image' ? 'png' : 'mp4'}`
      return (await db.sql<{ id: string }[]>`insert into asset (store_id, r2_key, kind, mime, bytes, checksum) values (${storeId}, ${key}, ${kind}, ${kind === 'image' ? 'image/png' : 'video/mp4'}, 1, ${'0'.repeat(64)}) returning id`)[0]?.id ?? ''
    }
    const mine = await file(t.storeA1, 'image')
    expect((await save({ name: 'Pictured', kind: 'manual', imageAssetId: mine })).code).toBeUndefined()
    for (const imageAssetId of [await file(t.storeB1, 'image'), await file(t.storeA1, 'video'), '00000000-0000-4000-8000-0000000000ee']) {
      expect((await save({ name: 'Wrong picture', kind: 'manual', imageAssetId })).code).toBe('INVALID_INPUT')
    }
  })

  it('refuses a parent that is itself or inside it, a stale save, and a rule naming another store’s product', async () => {
    const top = await save({ name: 'Top', kind: 'manual' })
    const inner = await save({ name: 'Inner', kind: 'manual', parentId: top.saved?.id })
    expect((await save({ name: 'Top', kind: 'manual', parentId: inner.saved?.id }, top.saved?.id, 1)).code).toBe('INVALID_PARENT')
    expect((await save({ name: 'Top', kind: 'manual', parentId: top.saved?.id }, top.saved?.id, 1)).code).toBe('INVALID_PARENT')
    expect((await save({ name: 'Top renamed', kind: 'manual' }, top.saved?.id, 1)).saved?.revision).toBe(2)
    expect((await save({ name: 'Top again', kind: 'manual' }, top.saved?.id, 1)).code).toBe('STALE_REVISION')
    const other = await product('bOwner', 'B rule product')
    expect((await save({ name: 'Bad rule', kind: 'automatic', rules: [{ kind: 'product', productId: other.id }] })).code).toBe('INVALID_RULE')
    // Deleting a parent moves its child to the top level.
    expect((await gql('mutation D($id: ID!) { deleteCollection(id: $id) }', 'owner', { id: top.saved?.id })).data?.['deleteCollection']).toBe(true)
    expect((await gql('query C($id: ID!) { collection(id: $id) { parentId } }', 'owner', { id: inner.saved?.id })).data?.['collection']).toEqual({ parentId: null })
  })

  it('refreshes a child limited to a hand-picked parent when the parent’s products change', async () => {
    const a = await product('owner', 'Parent pick A')
    const b = await product('owner', 'Parent pick B')
    const parent = await save({ name: 'Hand parent', kind: 'manual', productIds: [a.id, b.id] })
    const child = await save({ name: 'Picks inside', kind: 'automatic', parentId: parent.saved?.id, inheritParent: true, rules: [{ kind: 'name_contains', text: 'parent pick' }] })
    await drainRecompute()
    expect((await members(child.saved?.id ?? '')).map((m) => m.id).sort()).toEqual([a.id, b.id].sort())
    await save({ name: 'Hand parent', kind: 'manual', productIds: [a.id] }, parent.saved?.id, 1)
    expect(await drainRecompute()).toBeGreaterThan(0)
    expect((await members(child.saved?.id ?? '')).map((m) => m.id)).toEqual([a.id])
  })

  it('are refused to a supplier and invisible to another store', async () => {
    const { saved } = await save({ name: 'Private', kind: 'manual' })
    expect((await gql('{ collections { nodes { id } } }', 'supplier')).code).toBe('FORBIDDEN')
    expect((await gql('query C($id: ID!) { collection(id: $id) { id } }', 'supplier', { id: saved?.id })).code).toBe('FORBIDDEN')
    expect((await gql('query C($id: ID!) { collection(id: $id) { id } }', 'bOwner', { id: saved?.id })).data?.['collection']).toBeNull()
    expect(((await gql('{ collections { nodes { id } } }', 'bOwner')).data?.['collections'] as { nodes: unknown[] }).nodes).toEqual([])
    expect((await gql('mutation D($id: ID!) { deleteCollection(id: $id) }', 'bOwner', { id: saved?.id })).code).toBe('NOT_FOUND')
  })
})

describe('the main menu', () => {
  it('takes a page link only as a path on this shop, never one that leads to another site', async () => {
    const page = async (url: string) => (await gql('mutation M($items: [MenuItemInput!]!) { saveMenu(revision: 0, items: $items) }', 'bOwner', { items: [{ label: 'Page', kind: 'page', url }] })).code
    for (const url of ['//evil.example', '//evil.example/path', 'https://evil.example', 'about']) expect({ [url]: await page(url) }).toEqual({ [url]: 'INVALID_LINK' })
    expect(await page('/pages/about-us')).toBeUndefined()
    // The database refuses it too, whatever writes the row.
    const [menu] = await db.sql<{ id: string }[]>`select id from menu where store_id = ${t.storeB1}`
    await expect(db.sql`insert into menu_item (menu_id, store_id, label, kind, url, position) values (${menu?.id ?? ''}, ${t.storeB1}, 'X', 'page', '//evil.example', 9)`).rejects.toThrow(/check constraint/)
    await db.sql`delete from menu_item where store_id = ${t.storeB1}`
    await db.sql`delete from menu where store_id = ${t.storeB1}`
  })

  it('ends two saves at one revision, or two first saves, with one saved and one stale', async () => {
    const menu = (rev: number, label: string) => gql('mutation M($rev: Int, $items: [MenuItemInput!]!) { saveMenu(revision: $rev, items: $items) }', 'bOwner', { rev, items: [{ label, kind: 'url', url: 'https://example.com/' + label }] })
    const firsts = await Promise.all([menu(0, 'a'), menu(0, 'b')])
    expect(firsts.map((r) => r.code ?? 'saved').sort()).toEqual(['STALE_REVISION', 'saved'])
    const again = await Promise.all([menu(1, 'c'), menu(1, 'd')])
    expect(again.map((r) => r.code ?? 'saved').sort()).toEqual(['STALE_REVISION', 'saved'])
    expect((await gql('{ menu { revision } }', 'bOwner')).data?.['menu']).toEqual({ revision: 2 })
    await db.sql`delete from menu_item where store_id = ${t.storeB1}`
    await db.sql`delete from menu where store_id = ${t.storeB1}`
  })

  it('saves one level of items at the revision read, linking only this store’s collections', async () => {
    const picks = (await gql('mutation C($input: CollectionInput!) { saveCollection(input: $input) { id } }', 'owner', { input: { name: 'Menu picks', kind: 'manual' } })).data?.['saveCollection'] as { id: string }
    const items = [{ label: 'Shop', kind: 'collection', collectionId: picks.id, children: [{ label: 'Returns', kind: 'page', url: '/policies/refund' }] }, { label: 'Blog', kind: 'url', url: 'https://blog.example.com' }]
    expect((await gql('mutation M($items: [MenuItemInput!]!) { saveMenu(revision: 0, items: $items) }', 'owner', { items })).data?.['saveMenu']).toBe(1)
    const menu = (await gql('{ menu { revision items { label kind parentId } } }', 'owner')).data?.['menu'] as { revision: number; items: { label: string; parentId: string | null }[] }
    expect(menu.items.map((i) => [i.label, i.parentId === null])).toEqual([['Shop', true], ['Blog', true], ['Returns', false]])
    expect((await gql('mutation M($items: [MenuItemInput!]!) { saveMenu(revision: 0, items: $items) }', 'owner', { items })).code).toBe('STALE_REVISION')
    const bCollection = (await gql('mutation C($input: CollectionInput!) { saveCollection(input: $input) { id } }', 'bOwner', { input: { name: 'B', kind: 'manual' } })).data?.['saveCollection'] as { id: string }
    expect((await gql('mutation M($items: [MenuItemInput!]!) { saveMenu(revision: 1, items: $items) }', 'owner', { items: [{ label: 'Theirs', kind: 'collection', collectionId: bCollection.id }] })).code).toBe('INVALID_LINK')
    expect((await gql('{ menu { revision } }', 'supplier')).code).toBe('FORBIDDEN')
    // Deleting a linked collection takes its link out, keeps what sat under it, and moves the revision on.
    expect((await gql('mutation D($id: ID!) { deleteCollection(id: $id) }', 'owner', { id: picks.id })).data?.['deleteCollection']).toBe(true)
    const after = (await gql('{ menu { revision items { label kind parentId } } }', 'owner')).data?.['menu'] as { revision: number; items: { label: string; parentId: string | null }[] }
    expect(after.items.map((i) => [i.label, i.parentId === null]).sort()).toEqual([['Blog', true], ['Returns', true]])
    expect(after.revision).toBe(2)
    expect((await gql('{ menu { revision } }', 'bOwner')).data?.['menu']).toBeNull()
  })
})
