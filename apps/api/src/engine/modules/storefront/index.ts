import type postgres from 'postgres'
import { isUuid } from '#core/ids'
import { maxAmount, minorDigits, type Money } from '#core/money'
import { pageWindow, pageWith, type Page, type PageRequest } from '#core/paging'
import { decodeValueCursor, encodeCursor, encodeValueCursor } from '#core/cursor'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'
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
  selectShopPriceBounds,
  selectShopPricing,
  selectShopProductExtras,
  selectShopProductId,
  selectShopProductRows,
  selectShopProducts,
  selectShopSellable,
  selectShopStock,
  selectShopStore,
  selectShopTargetSlugs,
  type ShopCollectionRow,
  type ShopFacetRow,
  type ShopMenuItemRow,
  type ShopProductExtrasRow,
  type ShopProductQuery,
  type ShopSort,
  type ShopStoreRow,
} from '#db/scoped/shop'
import { missingFor, type StorePricing } from '#engine/modules/markets/index'
import { selectCartVersions } from '#db/scoped/cart'
import { textLimits } from '#engine/modules/catalog/index'
import { selectProductQuestions, selectQuestionWords } from '#db/scoped/questions'
import { shopQuestionsOf, type ShopQuestion } from './questions'
import { selectShopOffers } from '#db/scoped/promotions'
import { productView, type ShopProductView, type ShopVersionView } from './view'

export type { ShopCollectionRow, ShopFacetRow, ShopProductExtrasRow, ShopSort, ShopStoreRow } from '#db/scoped/shop'
export type { ShopKindView, ShopProductView, ShopVersionView } from './view'
export type { ShopChoice, ShopExtraPrice, ShopQuestion } from './questions'

// The catalogue a storefront shows (PLATFORM-PROMPT §5.5; FIRST-RELEASE §19 Shop API), read as the shopper: what the
// merchant has made visible, in the shopper's language, never a supplier's id, a cost or a draft.

export const maxShopPage = 50

export interface CartItem {
  product: ShopProductView
  version: ShopVersionView
  /** What tells this version apart on a cart or order line: its name, else its choices ("Size: M · Colour: Red", #1347). */
  versionLabel: string | null
  taxClassId: string | null
  soldHere: boolean
  /** Whether its product asks questions, so a line without answers is checked only then (#1368). */
  hasQuestions: boolean
  /** Its product asks shoppers to confirm their age at checkout (#1443). */
  ageRestricted: boolean
}

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
  /** In the cart currency's minor units; either end may be left open. */
  minPrice?: string | null | undefined
  maxPrice?: string | null | undefined
}

/** A product page: the product, its sections by Settings › Catalogue, and whether this market sells it here and now. */
export interface ShopProductPage {
  product: ShopProductView
  soldHere: boolean
  extras: ShopProductExtrasRow
  related: ShopProductView[]
  /** The A+ comparisons' products by id, loaded once for the whole story. */
  compared: ReadonlyMap<string, ShopProductView>
  /** What the shopper is asked before buying (#1368); empty for most products. */
  questions: ShopQuestion[]
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
  if (sort === 'best_selling') return /^\d{1,10}$/.test(value) && Number(value) <= 2147483647
  return /^-?\d{1,19}$/.test(value) && BigInt(value) <= 9223372036854775807n && BigInt(value) >= -1n
}

const maxSearch = 100
const maxFilters = 50
const minorUnits = /^\d{1,16}$/
// A collection's own order (CatCollections "Sort"); best selling is the hourly ranking (DATA-MODEL §7.3).
const collectionSort: Record<ShopCollectionRow['sort'], ShopSort> = { manual: 'collection', newest: 'newest', price_asc: 'price_low', price_desc: 'price_high', best_selling: 'best_selling' }

/** An offer on now that shoppers get without a code (#1242): what it is called, when it ends and what it applies to. */
export interface ShopOfferView {
  id: string
  name: string
  description: string | null
  endsAt: Date | null
  appliesTo: 'products' | 'order' | 'shipping'
  /** The visible products and collections a product offer names, by web address; empty for "every product" or a filter. */
  products: string[]
  collections: string[]
}

/** A version's own name, else its choices (#1347), cut to what an order line holds (migration 0068: 255 characters). */
const versionLabelOf = (name: string | null, choices: readonly string[]): string | null => {
  const label = [...(name || choices.join(' · '))]
  if (label.length === 0) return null
  return label.length > textLimits.versionName ? `${label.slice(0, textLimits.versionName - 1).join('')}…` : label.join('')
}

const maxShopOffers = 20
const maxOfferTargets = 50
const productOffers = new Set(['products_percentage_discount', 'line_fixed_discount', 'buy_x_get_y'])
const shippingOffers = new Set(['free_shipping', 'shipping_fixed_discount'])
const idsIn = (value: unknown): string[] => (Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string' && isUuid(x)).slice(0, maxOfferTargets) : [])

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
    const perEuroOf = (c: string) => (c === 'EUR' ? '1' : (pricing.perEuro.get(c) ?? null))
    const [pricingRate, currencyRate] = [perEuroOf(pricing.pricingCurrency), perEuroOf(currency)]
    const perEuro = currency === pricing.pricingCurrency ? { pricing: '1', currency: '1' } : convertible && pricingRate && currencyRate ? { pricing: pricingRate, currency: currencyRate } : null
    const rules = {
      rounding: pricing.currencies.find((c) => c.currency === currency)?.rounding ?? 'none',
      digits: minorDigits(currency),
      pricingDigits: minorDigits(pricing.pricingCurrency),
      adjustmentBps: market.currency === currency ? market.price_adjustment_bps : 0,
    }
    const query: Omit<ShopProductQuery, 'collectionId' | 'filterValueIds' | 'search'> = { language, market, currency, convertible, pricingCurrency: pricing.pricingCurrency, perEuro, rules }
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
    const price = { min: request.minPrice ?? null, max: request.maxPrice ?? null }
    if ([price.min, price.max].some((end) => end !== null && (!minorUnits.test(end) || BigInt(end) > maxAmount))) return null
    if (price.min !== null && price.max !== null && BigInt(price.min) > BigInt(price.max)) return null
    const found = request.collection ? await selectShopCollection(tx, storeId, language, request.collection.trim().toLowerCase()) : null
    return { search, filters, price, collection: request.collection ? found : null, missingCollection: Boolean(request.collection) && !found }
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
      const rows = await selectShopProducts(tx, storeId, query, sort, sortWindow, clean.price)
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

  /** The listing's lowest and highest price, before filter choices and a price range, for a price slider's ends. */
  const priceBounds = (request: ProductRequest): Promise<{ min: Money; max: Money } | null> =>
    inScope(async (tx) => {
      const clean = await cleanRequest(tx, request)
      const facts = await pricingIn(tx)
      if (!clean || !facts || clean.missingCollection) return null
      const bounds = await selectShopPriceBounds(tx, storeId, { ...facts.query, collectionId: clean.collection?.id ?? null, filterValueIds: [], search: clean.search })
      return bounds ? { min: { amount: BigInt(bounds.min), currency }, max: { amount: BigInt(bounds.max), currency } } : null
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
      const asked = (await questionsIn(tx, [id])).get(id) ?? []
      return { product: view, soldHere: sellable && ready, extras: shown, related, compared: views, questions: asked }
    })

  /**
   * A cart's versions as the shopper would buy them now: each with its product, its price here and stock, and whether the
   * market sells it. A version shoppers can't see is missing from the answer.
   */
  const cartItemsIn = async (tx: ScopedSql, versionIds: readonly string[]): Promise<Map<string, CartItem>> => {
    const facts = await pricingIn(tx)
    const versions = await selectCartVersions(tx, storeId, versionIds, language)
    if (!facts || versions.length === 0) return new Map()
    const productIds = [...new Set(versions.map((v) => v.product_id))]
    const listed = await selectShopListed(tx, storeId, { ...facts.query, collectionId: null, filterValueIds: [], search: null }, productIds)
    const views = new Map((await viewsOf(tx, productIds, facts)).map((p) => [p.id, p]))
    return new Map(
      versions.flatMap((v) => {
        const product = views.get(v.product_id)
        const version = product?.versions.find((x) => x.id === v.id)
        return product && version ? [[v.id, { product, version, versionLabel: versionLabelOf(version.name, v.choices), taxClassId: v.tax_class_id, soldHere: listed.has(product.id), hasQuestions: v.has_questions, ageRestricted: v.age_restricted }] as const] : []
      }),
    )
  }
  const cartItems = (versionIds: readonly string[]): Promise<Map<string, CartItem>> => inScope((tx) => cartItemsIn(tx, versionIds))

  /** These products' questions as the shopper sees them: translated, priced in the cart's currency and market (#1368). */
  const questionsIn = async (tx: ScopedSql, productIds: readonly string[]): Promise<Map<string, ShopQuestion[]>> => {
    if (productIds.length === 0) return new Map()
    const rows = await selectProductQuestions(tx, productIds)
    const facts = rows.size === 0 ? null : await pricingIn(tx)
    if (!facts) return new Map()
    const ids = [...rows.values()].flat().flatMap((q) => [q.id, ...q.choices.map((c) => c.id)])
    const words = await selectQuestionWords(tx, storeId, ids, language)
    return new Map([...rows].map(([productId, qs]) => [productId, shopQuestionsOf(qs, words, { currency, market: facts.market, pricing: facts.pricing })]))
  }
  const questions = (productIds: readonly string[]) => inScope((tx) => questionsIn(tx, productIds))

  /** These products in this order, as a listing would show them here: one a shopper can't see or buy here is left out. */
  const productsByIds = (ids: readonly string[]): Promise<ShopProductView[]> =>
    inScope(async (tx) => {
      const facts = await pricingIn(tx)
      if (!facts || ids.length === 0) return []
      const listed = await selectShopListed(tx, storeId, { ...facts.query, collectionId: null, filterValueIds: [], search: null }, ids)
      return viewsOf(tx, ids.filter((id) => listed.has(id)), facts)
    })

  /** The store's automatic offers on now, never a code (OFFERS-DESIGN fact 6); read as a cart's are, in system scope. */
  const offers = async (): Promise<ShopOfferView[]> => {
    const rows = await withSystemScope(sql, (tx) => selectShopOffers(tx, storeId, now(), maxShopOffers))
    const productIds = [...new Set(rows.flatMap((r) => idsIn(r.targets?.productIds)))]
    const collectionIds = [...new Set(rows.flatMap((r) => idsIn(r.targets?.collectionIds)))]
    const found = productIds.length + collectionIds.length === 0 ? [] : await inScope((tx) => selectShopTargetSlugs(tx, storeId, language, productIds, collectionIds))
    const slugOf = new Map(found.map((t) => [`${t.kind}:${t.id}`, t.slug]))
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      endsAt: r.ends_at,
      appliesTo: productOffers.has(r.operation) ? 'products' : shippingOffers.has(r.operation) ? 'shipping' : 'order',
      products: idsIn(r.targets?.productIds).flatMap((id) => slugOf.get(`product:${id}`) ?? []),
      collections: idsIn(r.targets?.collectionIds).flatMap((id) => slugOf.get(`collection:${id}`) ?? []),
    }))
  }

  return { store, menu, collections, collection, asset, products, facets, priceBounds, product, cartItems, cartItemsIn, productsByIds, offers, questions, questionsIn }
}
