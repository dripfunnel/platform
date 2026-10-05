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

// Card #296 (SAPI 6, part 3): translations (CATALOG facts 18–22, N5–N7, N13–N16).

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-05T09:00:00Z')
type Who = 'owner' | 'supplier' | 'bOwner'
const people: Record<Who, string> = { owner: '', supplier: '', bOwner: '' }
const cookies: Record<Who, string> = { owner: '', supplier: '', bOwner: '' }

const user = async (partnerId: string, email: string, name: string) =>
  (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${name}, 'active') returning id`)[0]?.id ?? ''

const subscribe = async (storeId: string, partnerId: string) => {
  const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${partnerId}, ${`Plan ${storeId.slice(0, 6)}`}, 'live') returning id`
  for (const [key, amount] of Object.entries({ products: 50, languages: 3, currencies: 2 })) {
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
  for (const who of ['owner', 'bOwner'] as const) {
    expect((await gql('mutation L($l: [String!]!) { saveLanguages(languages: $l, main: "en-US") }', who, { l: ['en-US', 'hi-IN', 'en-IN'] })).code).toBeUndefined()
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

type Row = { entity: string; entityId: string; field: string; main: string; text: string | null; status: string }
const rowFields = 'entity entityId field main text status'
const kurtaInput = (name = 'Linen kurta') => ({
  name,
  description: 'Soft linen, made in Jaipur.',
  options: [{ name: 'Colour', values: [{ name: 'Red' }, { name: 'Blue' }] }],
  versions: [
    { choices: ['Red'], name: 'Red kurta', prices: [{ currency: 'INR', amount: '129900' }] },
    { choices: ['Blue'], prices: [{ currency: 'INR', amount: '129900' }] },
  ],
})
const create = async (who: Who, input: Record<string, unknown>) => ((await gql('mutation S($input: ProductInput!) { saveProduct(input: $input) { id } }', who, { input })).data?.['saveProduct'] as { id: string }).id
const translationOf = async (who: Who, productId: string, language: string) => {
  const result = await gql(`query T($id: ID!, $l: String!) { productTranslation(productId: $id, language: $l) { ${rowFields} } }`, who, { id: productId, l: language })
  return { rows: result.data?.['productTranslation'] as Row[] | undefined, code: result.code }
}
const translate = async (who: Who, productId: string, language: string, input: Record<string, unknown>) => {
  const result = await gql(`mutation T($id: ID!, $l: String!, $input: ProductTranslationInput!) { saveProductTranslation(productId: $id, language: $l, input: $input) { ${rowFields} } }`, who, { id: productId, l: language, input })
  return { rows: result.data?.['saveProductTranslation'] as Row[] | undefined, code: result.code }
}
const status = (rows: Row[] | undefined, entity: string, field = 'name') => rows?.filter((r) => r.entity === entity && r.field === field).map((r) => [r.main, r.text, r.status])

describe('a product’s translations', () => {
  let kurta = ''

  it('lists the translatable text beside the main language, all missing at first, the shared names once each', async () => {
    kurta = await create('owner', kurtaInput())
    const { rows } = await translationOf('owner', kurta, 'hi-IN')
    expect(rows?.map((r) => [r.entity, r.field, r.main, r.status])).toEqual([
      ['product', 'name', 'Linen kurta', 'missing'],
      ['product', 'slug', 'linen-kurta', 'missing'],
      ['product', 'description', 'Soft linen, made in Jaipur.', 'missing'],
      ['version', 'name', 'Red kurta', 'missing'],
      ['option_name', 'name', 'Colour', 'missing'],
      ['choice_name', 'name', 'Red', 'missing'],
      ['choice_name', 'name', 'Blue', 'missing'],
    ])
  })

  it('saves a translation, its web address made from the name when it has Latin letters, and its shared names', async () => {
    const versionId = (await translationOf('owner', kurta, 'hi-IN')).rows?.find((r) => r.entity === 'version')?.entityId
    const hindi = await translate('owner', kurta, 'hi-IN', { name: 'लिनन कुर्ता', description: 'मुलायम लिनन', versions: [{ id: versionId, name: 'लाल कुर्ता' }], names: [{ kind: 'choice_name', source: 'Red', text: 'लाल' }] })
    expect(status(hindi.rows, 'product')).toEqual([['Linen kurta', 'लिनन कुर्ता', 'translated']])
    // Devanagari has no Latin letters to make an address from, so the main one stays (fact 22).
    expect(status(hindi.rows, 'product', 'slug')).toEqual([['linen-kurta', null, 'missing']])
    expect(status(hindi.rows, 'version')).toEqual([['Red kurta', 'लाल कुर्ता', 'translated']])
    expect(status(hindi.rows, 'choice_name')).toEqual([['Red', 'लाल', 'translated'], ['Blue', null, 'missing']])
    const english = await translate('owner', kurta, 'en-IN', { name: 'Linen kurta, Indian cut' })
    expect(status(english.rows, 'product', 'slug')).toEqual([['linen-kurta', 'linen-kurta-indian-cut', 'translated']])
  })

  it('keeps each web address unique within its language, and only a well-formed one', async () => {
    const other = await create('owner', kurtaInput('Cotton kurta'))
    expect((await translate('owner', other, 'en-IN', { name: 'Linen kurta, Indian cut' })).code).toBe('DUPLICATE_SLUG')
    expect((await translate('owner', other, 'en-IN', { name: 'Linen kurta, Indian cut', slug: 'cotton-kurta-indian-cut' })).code).toBeUndefined()
    expect((await translate('owner', other, 'en-IN', { slug: 'Not A Slug!' })).code).toBe('INVALID_SLUG')
    // The same address is free in another language: addresses are per language.
    expect((await translate('owner', other, 'hi-IN', { name: 'Cotton', slug: 'linen-kurta-indian-cut' })).code).toBeUndefined()
    // A deleted product's translated addresses free up with it.
    const gone = await create('owner', kurtaInput('Gone kurta'))
    await translate('owner', gone, 'en-IN', { name: 'Gone kurta', slug: 'gone-kurta-in' })
    await gql('mutation D($ids: [ID!]!) { deleteProducts(ids: $ids) }', 'owner', { ids: [gone] })
    expect((await translate('owner', other, 'en-IN', { slug: 'gone-kurta-in' })).code).toBeUndefined()
  })

  it('marks a translation changed when the main text moves on, and clears back to the main text', async () => {
    const p = (await gql('query P($id: ID!) { product(id: $id) { revision versions { id choices } } }', 'owner', { id: kurta })).data?.['product'] as { revision: number; versions: { id: string; choices: string[] }[] }
    const input = kurtaInput('Linen kurta, relaxed')
    await gql('mutation S($id: ID, $revision: Int, $input: ProductInput!) { saveProduct(id: $id, revision: $revision, input: $input) { id } }', 'owner', {
      id: kurta,
      revision: p.revision,
      input: { ...input, versions: input.versions.map((v, i) => ({ ...v, id: p.versions[i]?.id })) },
    })
    expect(status((await translationOf('owner', kurta, 'hi-IN')).rows, 'product')).toEqual([['Linen kurta, relaxed', 'लिनन कुर्ता', 'changed']])
    expect(status((await translate('owner', kurta, 'hi-IN', { name: '' })).rows, 'product')).toEqual([['Linen kurta, relaxed', null, 'missing']])
  })

  it('translates into the store’s other languages only, and counts and lists what’s left', async () => {
    expect((await translationOf('owner', kurta, 'en-US')).code).toBe('NOT_A_TRANSLATION_LANGUAGE')
    expect((await translationOf('owner', kurta, 'fr-FR')).code).toBe('NOT_A_TRANSLATION_LANGUAGE')
    expect(((await gql('{ translationProgress(language: "en-IN") { products untranslated } }', 'owner')).data?.['translationProgress'] as { products: number; untranslated: number })).toEqual({ products: 2, untranslated: 0 })
    expect(((await gql('{ translationProgress(language: "hi-IN") { products untranslated } }', 'owner')).data?.['translationProgress'] as { untranslated: number }).untranslated).toBe(1)
    const untranslated = ((await gql('{ products(untranslatedIn: "hi-IN") { nodes { id } } }', 'owner')).data?.['products'] as { nodes: { id: string }[] }).nodes
    expect(untranslated.map((n) => n.id)).toEqual([kurta])
    // A removed language keeps its translations, but nothing more is written in it (N13).
    await gql('mutation L($l: [String!]!) { saveLanguages(languages: $l, main: "en-US") }', 'owner', { l: ['en-US', 'hi-IN'] })
    try {
      expect((await translate('owner', kurta, 'en-IN', { name: 'Again' })).code).toBe('NOT_A_TRANSLATION_LANGUAGE')
      expect(await db.sql`select 1 from translation where language = 'en-IN' and entity_id = ${kurta}`).not.toHaveLength(0)
    } finally {
      await gql('mutation L($l: [String!]!) { saveLanguages(languages: $l, main: "en-US") }', 'owner', { l: ['en-US', 'hi-IN', 'en-IN'] })
    }
  })
})

describe('shared names, collections and filters', () => {
  it('lists each option and choice name once with its uses, translated once for every product', async () => {
    const page = (await gql('{ sharedNames(kind: "choice_name", language: "hi-IN", first: 1) { nodes { source main uses text } pageInfo { hasNextPage endCursor } } }', 'owner')).data?.['sharedNames'] as { nodes: { source: string; uses: number; text: string | null }[]; pageInfo: { hasNextPage: boolean; endCursor: string } }
    expect(page.nodes).toEqual([{ source: 'blue', main: 'Blue', uses: 2, text: null }])
    expect(page.pageInfo.hasNextPage).toBe(true)
    const next = (await gql('query N($after: String) { sharedNames(kind: "choice_name", language: "hi-IN", first: 5, after: $after) { nodes { source text } } }', 'owner', { after: page.pageInfo.endCursor })).data?.['sharedNames'] as { nodes: { source: string; text: string | null }[] }
    expect(next.nodes).toEqual([{ source: 'red', text: 'लाल' }])
    expect((await gql('mutation S($n: [SharedNameTranslationInput!]!) { saveSharedNames(language: "hi-IN", names: $n) }', 'owner', { n: [{ kind: 'choice_name', source: 'Blue', text: 'नीला' }] })).data?.['saveSharedNames']).toBe(true)
    const cotton = ((await gql('{ products(search: "Cotton") { nodes { id } } }', 'owner')).data?.['products'] as { nodes: { id: string }[] }).nodes[0]?.id ?? ''
    expect(status((await translationOf('owner', cotton, 'hi-IN')).rows, 'choice_name')).toEqual([['Red', 'लाल', 'translated'], ['Blue', 'नीला', 'translated']])
  })

  it('translates a collection, a filter and its choices, the merchant side’s', async () => {
    const [collection] = await db.sql<{ id: string }[]>`insert into collection (store_id, name, slug, description, kind) values (${t.storeA1}, 'Summer', 'summer', 'Light things', 'manual') returning id`
    const [filter] = await db.sql<{ id: string }[]>`insert into filter (store_id, name, position) values (${t.storeA1}, 'Fabric', 0) returning id`
    const save = (entity: string, id: string, input: Record<string, unknown>, who: Who = 'owner') =>
      gql(`mutation C($e: String!, $id: ID!, $input: TranslationTextInput!) { saveCatalogueTranslation(entity: $e, id: $id, language: "en-IN", input: $input) { ${rowFields} } }`, who, { e: entity, id, input })
    const saved = (await save('collection', collection?.id ?? '', { name: 'Summer wear', description: 'Light clothes' })).data?.['saveCatalogueTranslation'] as Row[]
    expect(saved.map((r) => [r.field, r.text, r.status])).toEqual([['name', 'Summer wear', 'translated'], ['slug', 'summer-wear', 'translated'], ['description', 'Light clothes', 'translated']])
    expect(((await save('filter', filter?.id ?? '', { name: 'Material', description: 'ignored' })).data?.['saveCatalogueTranslation'] as Row[]).map((r) => [r.field, r.text])).toEqual([['name', 'Material']])
    expect((await save('collection', collection?.id ?? '', { name: 'Summer' }, 'supplier')).code).toBe('FORBIDDEN')
    expect((await save('menu', collection?.id ?? '', { name: 'x' })).code).toBe('INVALID_INPUT')
  })
})

describe('suppliers and other stores', () => {
  it('lets a supplier translate its own products only, never the shared names, and waits for approval while it’s on (N15, N16)', async () => {
    const own = await create('supplier', { name: 'Anand scarf', options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '50000' }] }] })
    expect(status((await translate('supplier', own, 'hi-IN', { name: 'आनंद दुपट्टा' })).rows, 'product')).toEqual([['Anand scarf', 'आनंद दुपट्टा', 'translated']])
    expect((await db.sql<{ seller_id: string }[]>`select seller_id from translation where entity_id = ${own} and field = 'name'`)[0]?.seller_id).toBe(t.sellerA1First)
    const merchants = ((await gql('{ products(search: "Linen") { nodes { id } } }', 'owner')).data?.['products'] as { nodes: { id: string }[] }).nodes[0]?.id ?? ''
    expect((await translate('supplier', merchants, 'hi-IN', { name: 'x' })).code).toBe('NOT_FOUND')
    expect((await translate('supplier', own, 'hi-IN', { names: [{ kind: 'choice_name', source: 'Red', text: 'x' }] })).code).toBe('SUPPLIER_FIELD')
    expect((await gql('{ sharedNames(kind: "choice_name", language: "hi-IN") { nodes { source } } }', 'supplier')).code).toBe('FORBIDDEN')
    // The merchant's translation of a supplier's product stays marked as the supplier's (E1).
    await translate('owner', own, 'en-IN', { name: 'Anand scarf, Indian' })
    expect((await db.sql<{ seller_id: string }[]>`select seller_id from translation where entity_id = ${own} and language = 'en-IN' and field = 'name'`)[0]?.seller_id).toBe(t.sellerA1First)
    await gql('mutation { setApproval(on: true) }', 'owner')
    try {
      await db.sql`update product set approval_status = 'approved' where id = ${own}`
      await translate('supplier', own, 'en-IN', { name: 'Anand scarf, Indian edition' })
      expect((await db.sql<{ approval_status: string; visibility: string }[]>`select approval_status, visibility from product where id = ${own}`)[0]).toEqual({ approval_status: 'pending', visibility: 'hidden' })
    } finally {
      await gql('mutation { setApproval(on: false) }', 'owner')
    }
  })

  it('never tells a supplier another supplier’s web address: its own get their random suffix', async () => {
    const [theirs] = await db.sql<{ id: string }[]>`insert into product (store_id, seller_id, name, slug) values (${t.storeA1}, ${t.sellerA1Second}, 'Bhatia shawl', 'bhatia-shawl-x2y3z4') returning id`
    await db.sql`insert into translation (store_id, entity, entity_id, field, language, text, source_hash) values (${t.storeA1}, 'product', ${theirs?.id ?? ''}, 'slug', 'en-IN', 'shared-shawl', md5('bhatia-shawl-x2y3z4'))`
    const own = await create('supplier', { name: 'Anand shawl', options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '50000' }] }] })
    const saved = await translate('supplier', own, 'en-IN', { name: 'Anand shawl', slug: 'shared-shawl' })
    expect(saved.code).toBeUndefined()
    const slug = saved.rows?.find((r) => r.entity === 'product' && r.field === 'slug')?.text ?? ''
    expect(slug).toMatch(/^shared-shawl-[a-z2-9]{6}$/)
    // Saving the address it has keeps it as it is.
    expect((await translate('supplier', own, 'en-IN', { slug })).rows?.find((r) => r.field === 'slug')?.text).toBe(slug)
  })

  it('refuses a shared name the catalogue doesn’t use, a list past its limit, an unoffered language in the list, and a deleted product', async () => {
    const shared = (names: Record<string, unknown>[]) => gql('mutation S($n: [SharedNameTranslationInput!]!) { saveSharedNames(language: "hi-IN", names: $n) }', 'owner', { n: names })
    expect((await shared([{ kind: 'choice_name', source: 'Nobody uses this', text: 'x' }])).code).toBe('NOT_FOUND')
    expect((await shared(Array.from({ length: 101 }, () => ({ kind: 'choice_name', source: 'Red', text: 'लाल' })))).code).toBe('INVALID_INPUT')
    expect(await db.sql`select 1 from translation where entity_id = 'nobody uses this'`).toHaveLength(0)
    for (const language of ['fr-FR', 'en-US']) {
      expect((await gql('query P($l: String) { products(untranslatedIn: $l) { nodes { id } } }', 'owner', { l: language })).code).toBe('NOT_A_TRANSLATION_LANGUAGE')
    }
    const gone = await create('owner', kurtaInput('Deleted kurta'))
    await gql('mutation D($ids: [ID!]!) { deleteProducts(ids: $ids) }', 'owner', { ids: [gone] })
    expect((await translationOf('owner', gone, 'hi-IN')).code).toBe('NOT_FOUND')
  })

  it('keeps another store out, in the API and in the database', async () => {
    const kurta = ((await gql('{ products(search: "Linen") { nodes { id } } }', 'owner')).data?.['products'] as { nodes: { id: string }[] }).nodes[0]?.id ?? ''
    expect((await translationOf('bOwner', kurta, 'hi-IN')).code).toBe('NOT_FOUND')
    expect((await translate('bOwner', kurta, 'hi-IN', { name: 'Taken' })).code).toBe('NOT_FOUND')
    expect(((await gql('{ sharedNames(kind: "choice_name", language: "hi-IN") { nodes { source } } }', 'bOwner')).data?.['sharedNames'] as { nodes: unknown[] }).nodes).toEqual([])
    const supplier: CallerContext = { caller: { kind: 'person', userId: people.supplier, sessionId: 's' }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'seller', sellerId: t.sellerA1First }, subscription: 'active' }
    await expect(withScope(db.sql, supplier, (tx) => tx`insert into translation (store_id, entity, entity_id, field, language, text, source_hash) values (${t.storeA1}, 'product', ${kurta}, 'name', 'hi-IN', 'x', md5('x'))`)).rejects.toThrow(/store's own product|row-level security/)
    await expect(withScope(db.sql, supplier, (tx) => tx`insert into translation (store_id, entity, entity_id, field, language, text, source_hash) values (${t.storeA1}, 'choice_name', 'red', 'name', 'hi-IN', 'x', md5('x'))`)).rejects.toThrow(/row-level security/)
    const merchantB: CallerContext = { caller: { kind: 'person', userId: people.bOwner, sessionId: 's' }, partnerId: t.partnerB, storeId: t.storeB1, sellerScope: { kind: 'all' }, subscription: 'active' }
    expect(await withScope(db.sql, merchantB, (tx) => tx`select 1 from translation where store_id = ${t.storeA1}`)).toHaveLength(0)
  })
})
