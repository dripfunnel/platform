import type postgres from 'postgres'
import { z } from 'zod'
import { toMajor } from '#core/money'
import type { TenantContext } from '#core/tenancy'
import { selectLibrary } from '#db/scoped/catalog'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { maxLookupCollections, maxLookupProducts, selectLookupCollections, selectLookupPhotos, selectLookupProducts, selectStoreSummary, summaryLimits, type LookupSort, type SummaryProductRow } from '#db/scoped/storeSummary'
import type { AiImage } from '#integrations/ai/index'
import type { StudioApi } from '#saas/studio/index'

// The studio AI's own store (storefront ARCHITECTURE §6.2, SAAS §9.2): a summary in every prompt, kept in the store's
// StudioSession, and read-only lookups that answer from it first and ask the database, one query each, only beyond it.

const product = z.object({ name: z.string(), slug: z.string(), price: z.string().nullable(), unitsSold: z.number().int().optional() })

export const storeSummarySchema = z.object({
  name: z.string(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  languages: z.array(z.string()),
  currency: z.string(),
  currencies: z.array(z.string()),
  pricesIncludeTax: z.boolean(),
  shipping: z.object({ free: z.enum(['never', 'always', 'over']), freeOver: z.string().nullable(), flat: z.string().nullable(), pickup: z.boolean(), courier: z.boolean() }).nullable(),
  payments: z.array(z.string()),
  brand: z.object({ tagline: z.string().nullable(), description: z.string().nullable(), voice: z.string().nullable(), colours: z.array(z.string()) }),
  products: z.number().int(),
  collectionCount: z.number().int(),
  collections: z.array(z.object({ name: z.string(), slug: z.string(), products: z.number().int(), image: z.boolean() })),
  bestSellers: z.array(product),
  topCollections: z.array(z.object({ name: z.string(), slug: z.string(), unitsSold: z.number().int() })),
  topCities: z.array(z.object({ city: z.string(), orders: z.number().int() })),
  offers: z.array(z.object({ name: z.string(), endsAt: z.string().nullable(), appliesTo: z.enum(['products', 'order', 'shipping']) })),
  newest: z.array(product),
})
export type StoreSummary = z.infer<typeof storeSummarySchema>

/** Older than this, the next change rebuilds it: the studio runs in Singapore, the database in Mumbai. */
export const summaryMaxAgeMs = 10 * 60 * 1000
/** Well inside a Durable Object value's limit; a summary past it is used once and not kept. */
const maxKeptChars = 100_000

const productOffers = new Set(['products_percentage_discount', 'line_fixed_discount', 'buy_x_get_y'])
const shippingOffers = new Set(['free_shipping', 'shipping_fixed_discount'])

const money = (amount: string | null, currency: string): string | null => (amount === null ? null : `${currency} ${toMajor({ amount: BigInt(amount), currency })}`)
const units = (n: string | null | undefined) => (n ? Math.min(Number(n), Number.MAX_SAFE_INTEGER) : 0)
const productOf = (p: SummaryProductRow, currency: string) => ({ name: p.name, slug: p.slug, price: money(p.amount, currency), ...(p.units ? { unitsSold: units(p.units) } : {}) })

/** One statement on the merchant side, in the store's scope. */
export const buildStoreSummary = async (sql: postgres.Sql, context: TenantContext, now: Date): Promise<StoreSummary> => {
  const row = await withScope(sql, context, (tx) => selectStoreSummary(tx, context.storeId, now))
  if (!row) throw new Error('store summary: no store')
  const c = row.currency
  return {
    name: row.name,
    city: row.city,
    country: row.country,
    languages: row.languages,
    currency: c,
    currencies: row.currencies,
    pricesIncludeTax: row.tax_inclusive,
    shipping: row.shipping ? { free: row.shipping.free, freeOver: money(row.shipping.free_over, row.shipping.currency), flat: money(row.shipping.flat, row.shipping.currency), pickup: row.shipping.pickup, courier: row.shipping.courier } : null,
    payments: row.payments,
    brand: { tagline: row.brand?.tagline ?? null, description: row.brand?.description ?? null, voice: row.brand?.voice ?? null, colours: (row.brand?.colours ?? []).filter((x): x is string => typeof x === 'string') },
    products: row.products,
    collectionCount: row.collection_count,
    collections: row.collections,
    bestSellers: row.best_sellers.map((p) => productOf(p, c)),
    topCollections: row.top_collections.map((t) => ({ name: t.name, slug: t.slug, unitsSold: units(t.units) })),
    topCities: row.cities,
    offers: row.offers.map((o) => ({ name: o.name, endsAt: o.ends_at ? new Date(o.ends_at).toISOString() : null, appliesTo: productOffers.has(o.operation) ? 'products' : shippingOffers.has(o.operation) ? 'shipping' : 'order' })),
    newest: row.newest.map((p) => productOf(p, c)),
  }
}

const readKept = (text: string): StoreSummary | null => {
  try {
    const parsed = storeSummarySchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** The kept summary while it is younger than 10 minutes, else a new one, kept for the next change. */
export const freshSummary = async (studio: Pick<StudioApi, 'summary' | 'keepSummary'>, storeId: string, now: Date, build: () => Promise<StoreSummary>): Promise<StoreSummary> => {
  const kept = await studio.summary(storeId)
  const read = kept && now.getTime() - kept.builtAt < summaryMaxAgeMs ? readKept(kept.text) : null
  if (read) return read
  return keepNew(studio, storeId, now, build)
}

/** A new summary, kept for the changes that follow (built when the studio opens). */
export const keepNew = async (studio: Pick<StudioApi, 'keepSummary'>, storeId: string, now: Date, build: () => Promise<StoreSummary>): Promise<StoreSummary> => {
  const summary = await build()
  const text = JSON.stringify(summary)
  if (text.length <= maxKeptChars) await studio.keepSummary(storeId, { builtAt: now.getTime(), text })
  return summary
}

export const lookupNames = ['store_photos', 'list_collections', 'find_products', 'product_photos', 'best_sellers', 'active_offers'] as const
export type LookupName = (typeof lookupNames)[number]
export type LookupAnswer = { content: string; images: AiImage[] }

/** The model's read-only questions about its own store (AI-STUDIO §4): the Worker answers each, never the model. */
export interface StoreLookups {
  run: (name: LookupName, args: Record<string, unknown>) => Promise<LookupAnswer | null>
  /** The Assets ids `store_photos` handed out, which the theme may then place (and so make visible to shoppers, #1244). */
  listed?: ReadonlySet<string>
}

/** The most of the store's own pictures `store_photos` lists. */
export const maxStorePhotos = 24

const sorts: readonly LookupSort[] = ['best-selling', 'newest', 'price-low', 'price-high', 'name']
const slugPattern = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,119}$/u
const imageTypes = new Set<string>(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
/** What a model takes as one image, as the platform stores it (nothing resizes it on the way). */
export const maxLookupImageBytes = 3_750_000

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

const countOf = (value: unknown, fallback: number, max: number) => (typeof value === 'number' && Number.isInteger(value) && value >= 1 ? Math.min(value, max) : fallback)
const answer = (value: unknown): LookupAnswer => ({ content: JSON.stringify(value), images: [] })

export const storeLookups = (deps: {
  sql: postgres.Sql
  context: TenantContext
  summary: StoreSummary
  readAsset: ((key: string) => Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string } | null>) | null
}): StoreLookups => {
  const { sql, context, summary, readAsset } = deps
  const { storeId } = context
  const listed = new Set<string>()
  const inScope = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, context, work)
  const products = async (collection: string | null, sort: LookupSort, limit: number) =>
    (await inScope((tx) => selectLookupProducts(tx, storeId, { collection, sort, limit }))).map((p) => ({
      name: p.name,
      slug: p.slug,
      price: money(p.amount, p.currency),
      description: p.description,
      photoAssetIds: p.photos,
      collections: p.collections,
      bestSellerRank: p.rank,
    }))

  const photos = async (slug: string): Promise<LookupAnswer> => {
    const rows = readAsset ? await inScope((tx) => selectLookupPhotos(tx, storeId, slug, maxLookupImageBytes)) : []
    const read = await Promise.all(rows.map(async (r) => ({ id: r.asset_id, file: readAsset ? await readAsset(r.r2_key) : null })))
    const shown = read.flatMap(({ id, file }) => (file && imageTypes.has(file.mime) && file.bytes.byteLength <= maxLookupImageBytes ? [{ id, image: { mediaType: file.mime as AiImage['mediaType'], base64: toBase64(file.bytes) } }] : []))
    return { content: shown.length ? `${shown.length} photos follow, in this order of asset ids: ${shown.map((s) => s.id).join(', ')}.` : 'That product has no photos to show.', images: shown.map((s) => s.image) }
  }

  const run = async (name: LookupName, args: Record<string, unknown>): Promise<LookupAnswer | null> => {
    switch (name) {
      case 'store_photos': {
        const own = await inScope((tx) => selectLibrary(tx, storeId, { limit: maxStorePhotos, before: null, kind: 'image', search: null }))
        for (const a of own) listed.add(a.id)
        return answer(own.map((a) => ({ assetId: a.id, name: a.name, width: a.width, height: a.height })))
      }
      case 'list_collections':
        // The summary holds every collection unless the store has more than it keeps.
        if (summary.collections.length >= summary.collectionCount) return answer(summary.collections)
        return answer((await inScope((tx) => selectLookupCollections(tx, storeId, maxLookupCollections))).map((c) => ({ name: c.name, slug: c.slug, description: c.description, products: c.products, imageAssetId: c.image_asset_id })))
      case 'find_products': {
        const raw = args['collection']
        const collection = typeof raw === 'string' && raw !== '' ? raw.toLowerCase() : null
        if (collection !== null && !slugPattern.test(collection)) return null
        return answer(await products(collection, sorts.find((s) => s === args['sort']) ?? 'newest', countOf(args['limit'], 12, maxLookupProducts)))
      }
      case 'best_sellers': {
        const limit = countOf(args['limit'], summaryLimits.bestSellers, maxLookupProducts)
        // Fewer than the summary keeps means it holds every product that sold.
        if (limit <= summary.bestSellers.length || summary.bestSellers.length < summaryLimits.bestSellers) return answer(summary.bestSellers.slice(0, limit))
        return answer((await products(null, 'best-selling', limit)).filter((p) => p.bestSellerRank !== null))
      }
      case 'active_offers':
        return answer(summary.offers)
      case 'product_photos': {
        const slug = typeof args['product'] === 'string' ? args['product'].toLowerCase() : ''
        return slugPattern.test(slug) ? photos(slug) : null
      }
    }
  }
  return { run, listed }
}
