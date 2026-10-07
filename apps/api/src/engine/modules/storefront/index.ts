import type postgres from 'postgres'
import { isUuid } from '#core/ids'
import { pageWindow, pageWith, type Page, type PageRequest } from '#core/paging'
import { decodeValueCursor, encodeCursor, encodeValueCursor } from '#core/cursor'
import type { TenantContext } from '#core/tenancy'
import { withScope, type ScopedSql } from '#db/scoped/index'
import type { FeatureKey } from '#db/scoped/catalogListing'
import {
  selectShopAsset,
  selectShopBadges,
  selectShopCollection,
  selectShopCollections,
  selectShopFacets,
  selectShopListed,
  selectShopMarket,
  selectShopMenu,
  selectShopPricing,
  selectShopProductExtras,
  selectShopProductId,
  selectShopProductRows,
  selectShopProducts,
  selectShopSellable,
  selectShopStock,
  selectShopStore,
  type ShopCollectionRow,
  type ShopFacetRow,
  type ShopMenuItemRow,
  type ShopProductExtrasRow,
  type ShopProductQuery,
  type ShopSort,
  type ShopStoreRow,
} from '#db/scoped/shop'
import { missingFor, type StorePricing } from '#engine/modules/markets/index'
import { productView, type ShopProductView } from './view'

export type { ShopCollectionRow, ShopFacetRow, ShopProductExtrasRow, ShopSort, ShopStoreRow } from '#db/scoped/shop'
export type { ShopProductView, ShopVersionView } from './view'

// The catalogue a storefront shows (PLATFORM-PROMPT §5.5; FIRST-RELEASE §19 Shop API), read as the shopper: what the
// merchant has made visible, in the shopper's language, never a supplier's id, a cost or a draft.

export const maxShopPage = 50

export interface StorefrontDeps {
  sql: postgres.Sql
  context: TenantContext
  language: string
  currency: string
  marketId: string | null
  features: Readonly<Record<FeatureKey, boolean>>
  now: () => Date
}

export interface ProductRequest extends PageRequest {
  collection?: string | null | undefined
  filters?: readonly string[] | null | undefined
  search?: string | null | undefined
  sort?: ShopSort | null | undefined
}

/** A product page: the product, its sections by Settings › Catalogue, and whether this market sells it here and now. */
export interface ShopProductPage {
  product: ShopProductView
  soldHere: boolean
  extras: ShopProductExtrasRow
  related: ShopProductView[]
  /** The A+ comparisons' products by id, loaded once for the whole story. */
  compared: ReadonlyMap<string, ShopProductView>
}

const maxRelated = 10
// Products a page's comparison tables load in all, whatever the story holds (WORKFLOW §7).
const maxCompared = 20

/** A sort cursor's value as its SQL cast takes it, so a tampered one is INVALID_CURSOR, never a database error. */
const valueFits = (sort: ShopSort, value: string): boolean => {
  if (sort === 'newest') {
    // As Postgres prints a timestamptz: a real calendar date and time, and an offset.
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/.exec(value)
    if (!m) return false
    const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number]
    const date = new Date(Date.UTC(y, mo - 1, d))
    return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && h < 24 && mi < 60 && se < 60
  }
  if (sort === 'name') return value.length <= 255 && !value.includes('\u0000')
  if (sort === 'collection') return /^-?\d{1,9}$/.test(value)
  return /^-?\d{1,19}$/.test(value) && BigInt(value) <= 9223372036854775807n && BigInt(value) >= -1n
}

const maxSearch = 100
const maxFilters = 50
// A collection's own order (CatCollections "Sort"); best sellers wait for sales (SAPI 18) and list newest first.
const collectionSort: Record<ShopCollectionRow['sort'], ShopSort> = { manual: 'collection', newest: 'newest', price_asc: 'price_low', price_desc: 'price_high', best_selling: 'newest' }

export type ShopRefusal = 'INVALID_CURSOR' | 'INVALID_INPUT'
export type ShopResult<T> = { ok: true; value: T } | { ok: false; reason: ShopRefusal }

export interface ShopMenuItem {
  id: string
  label: string
  kind: ShopMenuItemRow['kind']
  /** A collection's web address in the shopper's language; a shop page's path; an https address. */
  collectionSlug: string | null
  url: string | null
  children: ShopMenuItem[]
}

export const createStorefrontCatalog = ({ sql, context, language, currency, marketId, features, now }: StorefrontDeps) => {
  const { storeId } = context
  const inScope = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, context, work)

  const store = (): Promise<ShopStoreRow | null> => inScope((tx) => selectShopStore(tx, storeId))

  const menu = async (): Promise<ShopMenuItem[]> => {
    const rows = await inScope((tx) => selectShopMenu(tx, storeId, language))
    const item = (r: ShopMenuItemRow): ShopMenuItem => ({ id: r.id, label: r.label, kind: r.kind, collectionSlug: r.collection_slug, url: r.url, children: [] })
    const top = rows.filter((r) => r.parent_id === null).map(item)
    for (const r of rows) {
      if (r.parent_id !== null) top.find((t) => t.id === r.parent_id)?.children.push(item(r))
    }
    return top
  }

  const collections = async (request: PageRequest): Promise<ShopResult<Page<ShopCollectionRow>>> => {
    const window = pageWindow(request, maxShopPage)
    if (!window.ok) return { ok: false, reason: window.code }
    const rows = await inScope((tx) => selectShopCollections(tx, storeId, language, window.window))
    return { ok: true, value: pageWith(rows, window.window, (r) => encodeCursor({ occurredAt: r.created_at, id: r.id })) }
  }

  const collection = async (slug: string): Promise<ShopCollectionRow | null> => {
    const clean = slug.trim().toLowerCase()
    if (clean === '' || clean.length > 120) return null
    return inScope((tx) => selectShopCollection(tx, storeId, language, clean))
  }

  /** A file a storefront may show (a visible product's photo, a collection's image, the logo); null for any other. */
  const asset = (id: string) => (isUuid(id) ? inScope((tx) => selectShopAsset(tx, storeId, id.toLowerCase())) : Promise.resolve(null))

  /** The prices' facts: the store's currencies and rates, the shopper's market, and whether the cart's currency can be priced. */
  const pricingIn = async (tx: ScopedSql) => {
    const row = await selectShopPricing(tx, storeId)
    const market = await selectShopMarket(tx, storeId, marketId)
    if (!row || !market) return null
    const pricing: StorePricing = { pricingCurrency: row.pricing_currency, currencies: row.currencies.map((c) => ({ currency: c.currency, mode: c.mode, rounding: c.rounding })), perEuro: new Map(row.rates.map((r) => [r.currency, r.per_euro])) }
    const rate = (c: string) => c === 'EUR' || pricing.perEuro.has(c)
    const convertible = currency === pricing.pricingCurrency || (pricing.currencies.some((c) => c.currency === currency && c.mode === 'convert') && rate(currency) && rate(pricing.pricingCurrency))
    const query: Omit<ShopProductQuery, 'collectionId' | 'filterValueIds' | 'search'> = { language, market, currency, convertible, pricingCurrency: pricing.pricingCurrency }
    return { pricing, market, query }
  }

  const viewsOf = async (tx: ScopedSql, ids: readonly string[], facts: NonNullable<Awaited<ReturnType<typeof pricingIn>>>): Promise<ShopProductView[]> => {
    if (ids.length === 0) return []
    const rows = await selectShopProductRows(tx, storeId, ids, language)
    const stock = await selectShopStock(tx, rows.flatMap((r) => r.versions.map((v) => v.id)))
    const badges = features.badges ? await selectShopBadges(tx, storeId) : null
    const byId = new Map(rows.map((r) => [r.id, productView(r, { currency, market: facts.market, pricing: facts.pricing, stock: new Map(stock.map((s) => [s.version_id, s])), badges, now: now() })]))
    return ids.flatMap((id) => byId.get(id) ?? [])
  }

  const cleanRequest = async (tx: ScopedSql, request: ProductRequest) => {
    const search = request.search?.trim() || null
    const filters = [...new Set((request.filters ?? []).map((f) => f.toLowerCase()))]
    if ((search?.length ?? 0) > maxSearch || filters.length > maxFilters || !filters.every(isUuid)) return null
    const found = request.collection ? await selectShopCollection(tx, storeId, language, request.collection.trim().toLowerCase()) : null
    return { search, filters, collection: request.collection ? found : null, missingCollection: Boolean(request.collection) && !found }
  }

  /** A page of products, at most 50, by a collection, filter choices and words; a collection lists in its own order. */
  const products = (request: ProductRequest): Promise<ShopResult<Page<ShopProductView>>> =>
    inScope(async (tx) => {
      const clean = await cleanRequest(tx, request)
      if (!clean) return { ok: false, reason: 'INVALID_INPUT' }
      const facts = await pricingIn(tx)
      if (!facts || clean.missingCollection) return { ok: true, value: { nodes: [], pageInfo: { startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: false } } }
      const sort = request.sort ?? (clean.collection ? collectionSort[clean.collection.sort] : 'newest')
      if (sort === 'collection' && !clean.collection) return { ok: false, reason: 'INVALID_INPUT' }
      const window = pageWindow({ first: request.first }, maxShopPage)
      if (!window.ok) return { ok: false, reason: window.code }
      const after = request.after ? decodeValueCursor(request.after, sort) : null
      const before = request.before ? decodeValueCursor(request.before, sort) : null
      if ((request.after && !after) || (request.before && !before) || (after && !valueFits(sort, after.value)) || (before && !valueFits(sort, before.value))) return { ok: false, reason: 'INVALID_CURSOR' }
      const sortWindow = { limit: window.window.limit, after, before }
      const query: ShopProductQuery = { ...facts.query, collectionId: clean.collection?.id ?? null, filterValueIds: clean.filters, search: clean.search }
      const rows = await selectShopProducts(tx, storeId, query, sort, sortWindow)
      const page = pageWith(rows, sortWindow, (r) => encodeValueCursor({ sort, value: r.sort_key, id: r.id }))
      return { ok: true, value: { nodes: await viewsOf(tx, page.nodes.map((r) => r.id), facts), pageInfo: page.pageInfo } }
    })

  /** Each shopper-visible filter with how many of the listing's products carry each value. */
  const facets = (request: ProductRequest): Promise<ShopFacetRow[]> =>
    inScope(async (tx) => {
      const clean = await cleanRequest(tx, request)
      const facts = await pricingIn(tx)
      if (!clean || !facts || clean.missingCollection) return []
      return selectShopFacets(tx, storeId, { ...facts.query, collectionId: clean.collection?.id ?? null, filterValueIds: [], search: clean.search })
    })

  /** By its web address in the shopper's language or the main one; null for one shoppers can't see. */
  const product = (slug: string): Promise<ShopProductPage | null> =>
    inScope(async (tx) => {
      const clean = slug.trim().toLowerCase()
      const id = clean === '' || clean.length > 120 ? null : await selectShopProductId(tx, storeId, language, clean)
      const facts = await pricingIn(tx)
      const extras = id ? await selectShopProductExtras(tx, id, language) : null
      if (!id || !facts || !extras) return null
      const [view] = await viewsOf(tx, [id], facts)
      if (!view) return null
      const sellable = await selectShopSellable(tx, storeId, { ...facts.query, collectionId: null, filterValueIds: [], search: null }, id)
      const compliance = new Set(extras.compliance.filter((c) => c.value.trim() !== '').map((c) => `${c.region}:${c.field}`))
      const ready = missingFor({ productType: view.productType, priced: view.price !== null, hasCompareAt: view.versions.some((v) => v.compareAt !== null), compliance }, facts.market.countries).length === 0
      // Sections the store has switched off are left out, so the storefront never draws them (CATALOG P1).
      const shown: ShopProductExtrasRow = {
        ...extras,
        specs: features.specs ? extras.specs : [],
        highlights: features.highlights ? extras.highlights : [],
        faqs: features.faqs ? extras.faqs : [],
        related: features.related ? extras.related : [],
        video: features.video ? extras.video : null,
        size_chart: features.sizeCharts ? extras.size_chart : null,
        story: features.aplus ? extras.story : null,
        blocks: features.aplus ? extras.blocks : [],
      }
      // Related and compared products keep the listing's rules: one the market doesn't sell or can't price here is left out.
      const listing = { ...facts.query, collectionId: null, filterValueIds: [], search: null }
      const comparedIds = ((shown.story?.modules ?? []) as { productIds?: unknown }[]).flatMap((m) => (Array.isArray(m.productIds) ? m.productIds.filter((x): x is string => typeof x === 'string').slice(0, 5) : [])).slice(0, maxCompared)
      const wanted = [...new Set([...shown.related.slice(0, maxRelated), ...comparedIds])].filter(isUuid)
      const listed = await selectShopListed(tx, storeId, listing, wanted)
      const views = new Map((await viewsOf(tx, wanted.filter((x) => listed.has(x)), facts)).map((v) => [v.id, v]))
      const related = shown.related.slice(0, maxRelated).flatMap((x) => views.get(x) ?? [])
      return { product: view, soldHere: sellable && ready, extras: shown, related, compared: views }
    })

  return { store, menu, collections, collection, asset, products, facets, product }
}
