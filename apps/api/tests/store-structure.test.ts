import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import { collectionsRecomputeDeliverer, collectionsRecomputeKind } from '#jobs/queues/deliverers/collectionsRecompute'
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
