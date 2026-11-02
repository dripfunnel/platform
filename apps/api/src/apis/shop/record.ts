import type postgres from 'postgres'
import { graphql } from 'graphql'
import { resolveShopper } from '#auth/shopCaller'
import { activityLog } from '#saas/activity/index'
import { publishPictures, type CatalogueBase, type CatalogueRecorder, type PictureCopies, type ProductBatch, type RecordedAnswer } from '#saas/storefronts/index'
import type { ShopContext } from './access'
import { catalogOf } from './catalog'
import { shopSchema } from './schema'

// The catalogue snapshot's answers (storefront ARCHITECTURE §4.2): core's catalogue questions asked in-process as a
// shopper on the store's live host; each field list holds at least core's own (record.test.ts).

export const maxRecordedProducts = 1000
export const maxRecordedCollections = 200
const listingSize = 24
const maxVersionPages = 250
const productBatch = 8
const sorts = ['NEWEST', 'PRICE_LOW', 'PRICE_HIGH', 'NAME'] as const
/** The most answers one recording holds: the menu, brand and collections list, the sorts, two per collection, `all`'s two, each product. */
export const maxRecordedAnswers = 3 + sorts.length + 2 * maxRecordedCollections + 2 + maxRecordedProducts

const money = 'amount currency'
const summary = `id name slug productType inStock price { ${money} } compareAt { ${money} } maxPrice { ${money} } photo { alt image { url } } badges { label tone }`
const product = `id name slug productType giftCard { expiryMonths } download { days limit } service { duration location } description highlights inStock price { ${money} } compareAt { ${money} } maxPrice { ${money} } badges { label tone } photos { alt versionId image { url } } video { file { url } } options { id name values { id name } } versions { id name choices { optionId valueId } price { ${money} } compareAt { ${money} } inStock available } specs { name value versionId } faqs { question answer } compliance { region field value } returns warranty seoTitle seoDescription related { ${summary} }`
const collection = 'id name slug description seoTitle seoDescription image { url }'

/** What is asked; core's Product question also reads `store`, asked once here and added to each product's answer. */
export const recordedQueries = {
  Product: `query Product($slug: String!) { product(slug: $slug) { ${product} } }`,
  Store: 'query Store { store { marketId markets { id countries } } }',
  Collections: `query Collections($first: Int, $after: String) { collections(first: $first, after: $after) { nodes { ${collection} } pageInfo { endCursor hasNextPage } } }`,
  Listing: `query Listing($collection: String, $sort: ShopProductSort, $first: Int, $after: String) { products(collection: $collection, sort: $sort, first: $first, after: $after) { nodes { ${summary} } pageInfo { endCursor hasNextPage hasPreviousPage startCursor } facets { id name values { id name count } } } }`,
  Slugs: 'query Slugs($after: String) { products(sort: NEWEST, first: 50, after: $after) { nodes { slug } pageInfo { endCursor hasNextPage } } }',
  Menu: 'query Menu { menu { id label kind collectionSlug url children { id label kind collectionSlug url } } }',
  // Each under `image`, so the logo and favicon are copied to the asset host like the catalogue's pictures (storefronts/media.ts).
  Brand: 'query Brand { logo: store { image: logo { url } } favicon: store { image: favicon { url } } }',
} as const

type Operation = keyof typeof recordedQueries

/** The addresses the build can write a file at (storefront-core's `snapshotCatalogueSchema`); any other item keeps its client-rendered page. */
const plainSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const plainId = /^[A-Za-z0-9_-]{1,64}$/

type Page = { nodes?: ({ slug?: unknown } & Record<string, unknown>)[] | null; pageInfo?: { endCursor?: string | null; hasNextPage?: boolean | null } | null }
const pageOf = (data: Record<string, unknown> | null, field: string): Page | null => (data?.[field] as Page | null | undefined) ?? null
const slugsOf = (page: Page | null) => (page?.nodes ?? []).flatMap((n) => (typeof n.slug === 'string' && plainSlug.test(n.slug) ? [n.slug] : []))

/**
 * Asks as a shopper on `host`; null when that host serves no open store. `failed` counts the questions that errored, and
 * `published` gives the answers with their pictures on the asset host, when there is one.
 */
const askerOn = async (sql: postgres.Sql, host: string, shopDomain: string | null, now: () => Date, copies: PictureCopies | null) => {
  const resolved = await resolveShopper(sql, new Request(`https://${host}/shop-api`), host, shopDomain)
  if (resolved.kind !== 'found' || !resolved.shopper.available) return null
  // Relative asset addresses, as the snapshot's logo is: the page may be served on any of the store's hosts.
  const context: ShopContext = { sql, shopper: resolved.shopper, origin: '', activity: activityLog, facts: { requestId: null, ip: null, userAgent: null }, allowNewCart: async () => false, now }
  const answers: RecordedAnswer[] = []
  const errors = { failed: 0 }
  const ask = async (operation: Operation, variables: Record<string, unknown>, keep = true): Promise<Record<string, unknown> | null> => {
    const result = await graphql({ schema: shopSchema, source: recordedQueries[operation], variableValues: variables, contextValue: context })
    if (result.errors?.length) errors.failed += 1
    const data = result.errors?.length ? null : ((result.data as Record<string, unknown> | null | undefined) ?? null)
    if (data && keep) answers.push({ operation, variables, data })
    return data
  }
  const published = async (recorded: RecordedAnswer[]) => {
    if (!copies) return recorded
    const catalog = catalogOf(context)
    return publishPictures(copies, resolved.shopper.context.storeId, recorded, async (id) => {
      const row = await catalog.asset(id)
      return row && !row.rider_photo ? row : null
    })
  }
  return { ask, answers, errors, published }
}

/** The store's market, which core's product question also reads (products/product.ts `legalNotices`). */
const storeOn = async (ask: NonNullable<Awaited<ReturnType<typeof askerOn>>>['ask']) => (await ask('Store', {}, false))?.['store'] ?? null

/** Everything but the products' own answers: the menu, the listings, the collections, and the products to record. */
const recordBase = async (sql: postgres.Sql, host: string, shopDomain: string | null, now: () => Date, copies: PictureCopies | null): Promise<CatalogueBase | null> => {
  const asker = await askerOn(sql, host, shopDomain, now, copies)
  if (!asker) return null
  const { ask, answers, errors, published } = asker
  await ask('Menu', {})
  await ask('Brand', {})
  const store = await storeOn(ask)
  for (const sort of sorts) await ask('Listing', { sort, first: listingSize })

  // The list's first page is core's `useCollections` answer; each node is that collection's own answer.
  const nodes = new Map<string, Record<string, unknown>>()
  for (let after: string | null = null; nodes.size < maxRecordedCollections; ) {
    const page: Page | null = pageOf(await ask('Collections', after ? { first: 50, after } : { first: 50 }, after === null), 'collections')
    for (const node of page?.nodes ?? []) if (typeof node.slug === 'string' && plainSlug.test(node.slug)) nodes.set(node.slug, node)
    after = page?.pageInfo?.hasNextPage ? (page.pageInfo.endCursor ?? null) : null
    if (!after) break
  }
  const kept = [...nodes.keys()].slice(0, maxRecordedCollections)
  for (const slug of kept) {
    answers.push({ operation: 'Collection', variables: { slug }, data: { collection: nodes.get(slug) } })
    await ask('Listing', { collection: slug, sort: 'COLLECTION', first: listingSize })
  }
  // `/collections/all/` lists every product unless the store has a collection there (collections/collections.ts).
  if (!kept.includes('all')) {
    answers.push({ operation: 'Collection', variables: { slug: 'all' }, data: { collection: null } })
    await ask('Listing', { first: listingSize })
  }

  const slugs: string[] = []
  for (let after: string | null = null; slugs.length < maxRecordedProducts; ) {
    const page: Page | null = pageOf(await ask('Slugs', after ? { after } : {}, false), 'products')
    slugs.push(...slugsOf(page))
    after = page?.pageInfo?.hasNextPage ? (page.pageInfo.endCursor ?? null) : null
    if (!after) break
  }
  return { answers: await published(answers), collections: kept.map((slug) => ({ slug })), slugs: slugs.slice(0, maxRecordedProducts), store, failed: errors.failed }
}

/** Each product's own answer, with the store's market added, and its versions' addresses. */
const recordProducts = async (sql: postgres.Sql, host: string, shopDomain: string | null, now: () => Date, copies: PictureCopies | null, slugs: readonly string[], store: unknown): Promise<ProductBatch> => {
  const asker = await askerOn(sql, host, shopDomain, now, copies)
  if (!asker) return { answers: [], products: [], failed: 0 }
  const { ask, answers, errors, published } = asker
  const found: ({ slug: string; versions: string[]; answer: RecordedAnswer } | null)[] = []
  // A few at a time over the one connection's pool; each answer goes in at its product's place, so the order holds.
  for (let i = 0; i < slugs.length; i += productBatch) {
    found.push(
      ...(await Promise.all(
        slugs.slice(i, i + productBatch).map(async (slug) => {
          const data = await ask('Product', { slug }, false)
          if (!data?.['product']) return null
          const versions = ((data['product'] as { versions?: { id?: unknown }[] | null }).versions ?? []).flatMap((v) => (typeof v.id === 'string' && plainId.test(v.id) ? [v.id] : []))
          // A version has its own address only when the product has more than one (products/product.ts `choose`).
          return { slug, versions: versions.length > 1 ? versions.slice(0, maxVersionPages) : [], answer: { operation: 'Product', variables: { slug }, data: { ...data, store } } }
        }),
      )),
    )
  }
  const kept = found.filter((p) => p !== null)
  answers.push(...kept.map((p) => p.answer))
  return { answers: await published(answers), products: kept.map(({ slug, versions }) => ({ slug, versions })), failed: errors.failed }
}

/** The publish workflow's recorder (saas/storefronts/catalogue.ts), asking this Shop API as `host`'s shoppers do. */
export const shopCatalogueRecorder = (sql: postgres.Sql, shopDomain: string | null, now: () => Date, copies: PictureCopies | null = null): CatalogueRecorder => ({
  base: (host) => recordBase(sql, host, shopDomain, now, copies),
  store: async (host) => {
    const asker = await askerOn(sql, host, shopDomain, now, null)
    return asker ? storeOn(asker.ask) : null
  },
  products: (host, slugs, store) => recordProducts(sql, host, shopDomain, now, copies, slugs, store),
})
