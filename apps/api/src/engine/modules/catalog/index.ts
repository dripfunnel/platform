import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { PageWindow } from '#core/paging'
import type { TenantContext } from '#core/tenancy'
import {
  countProducts,
  countStoreProducts,
  deleteOptions,
  fileRefused,
  deleteOptionValues,
  insertOptions,
  insertOptionValues,
  insertProduct,
  insertVersions,
  lockCatalogue,
  nameClash,
  selectPricingCurrency,
  selectProduct,
  selectProducts,
  setProductPhotos,
  setProductsVisibility,
  setProductVideo,
  setVersionChoices,
  setVersionPrices,
  skuTaken,
  softDeleteProducts,
  softDeleteVersions,
  updateOptions,
  updateOptionValues,
  updateProduct,
  updateVersions,
  type OptionWrite,
  type ProductFields,
  type ProductQuery,
  type ProductRow,
  type ValueWrite,
  type VersionFields,
} from '#db/scoped/catalog'
import { listingRefused, setProductListing, setProductSizeChart } from '#db/scoped/catalogListing'
import { knownFacetValues, setProductFilterValues } from '#db/scoped/catalogStructure'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { cleanListing, ListingInvalid, type CleanListing } from './listing'
import { cleanProduct, type CatalogRefusal, type CleanProduct, type CleanVersion, type ProductInput } from './rules'
import { isUuid } from '#core/ids'

export { maxOptions, maxPhotos, maxVersions, refusedCategories, slugFrom, type ProductInput } from './rules'
export { assetsAudit, createAssetService, type AssetStore, type UploadResult } from './assets'
export { maxCollectionProducts } from '#db/scoped/catalogStructure'
export { createSettingsService, settingsAudit, type SettingsRefusal, type SettingsResult } from './settings'
export { collectionsRecomputeKind, createStructureService, structureAudit, type StructureRefusal, type StructureResult } from './structure'
export type { ProductCounts, ProductFilter, ProductListRow, ProductRow } from '#db/scoped/catalog'

// The catalogue's writes (CATALOG-DESIGN §3; ACCESS §7): one transaction per save in the caller's scope,
// so a supplier's save reaches only its own products and a merchant's reaches the whole store.

export const catalogAudit = {
  created: 'product.created',
  updated: 'product.updated',
  duplicated: 'product.duplicated',
  deleted: 'product.deleted',
  shown: 'product.shown',
  hidden: 'product.hidden',
} as const

export type SaveRefusal =
  | { reason: CatalogRefusal | 'NOT_FOUND' | 'CURRENCY_REQUIRED' | 'SUPPLIER_FIELD' | 'FILE_REFUSED' | 'NOT_SHOWABLE' }
  | { reason: 'STALE_REVISION'; revision: number }
  | { reason: 'PLAN_LIMIT'; wanted: number }

export type SaveResult = { ok: true; id: string; slug: string; revision: number } | ({ ok: false } & SaveRefusal)

export interface CatalogDeps {
  sql: postgres.Sql
  context: TenantContext
  /** The person acting, for the activity log; a supplier's seller comes from `context`. */
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
  /** The plan's product allowance, read before the locked count (saas/entitlements `allowanceFor`). */
  productAllowance: () => Promise<number>
  /** Asks, in the same transaction, for the store's automatic collections to be recomputed after commit (fact 14). */
  recompute: (tx: ScopedSql) => Promise<unknown>
}

const fieldsOf = (clean: CleanProduct, visibility: 'visible' | 'hidden'): ProductFields => ({
  name: clean.name,
  slug: clean.slug,
  description: clean.description,
  productType: clean.productType,
  category: clean.category,
  visibility,
  warrantyText: clean.warrantyText,
  returnsText: clean.returnsText,
  seoTitle: clean.seoTitle,
  seoDescription: clean.seoDescription,
})

const versionFieldsOf = (v: CleanVersion, position: number): VersionFields => ({
  sku: v.sku,
  barcode: v.barcode,
  name: v.name,
  visibility: v.visible ? 'visible' : 'hidden',
  hsCode: v.hsCode,
  customsDescription: v.customsDescription,
  weightGrams: v.weightGrams,
  lengthMm: v.lengthMm,
  widthMm: v.widthMm,
  heightMm: v.heightMm,
  cost: v.cost,
  trackStock: v.trackStock,
  continueSelling: v.continueSelling,
  position,
})

// A supplier's address carries its own random ending, so a clash with a product it can't see shows nothing
// (ACCESS §7.1): the store-wide uniqueness the storefront needs is never a signal about others.
const supplierSlug = (base: string): string => `${base.slice(0, 112)}-${[...crypto.getRandomValues(new Uint8Array(6))].map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('')}`


/** A product as the engine writes it: its own fields, then the listing sections and chart it was given. */
type Cleaned = CleanProduct & { listing: CleanListing | null; sizeChartId: string | null | undefined }

class Refused extends Error {
  constructor(readonly refusal: SaveRefusal) {
    super(refusal.reason)
  }
}

export const createCatalogService = ({ sql, context, actor, activity, facts, now, productAllowance, recompute }: CatalogDeps) => {
  const { storeId } = context
  const sellerId = context.sellerScope.kind === 'seller' ? context.sellerScope.sellerId : null
  const inScope = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, context, work)

  const entry = (action: string, target: { id: string; label: string }): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    sellerId,
    target: { type: 'product', ...target },
    reason: null,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  /** Options, values, versions, their choices and prices, matched by id to what the product has, a few statements in all. */
  const writeChildren = async (tx: ScopedSql, productId: string, clean: Cleaned, existing: ProductRow | null) => {
    const at = now()
    const known = (ids: readonly string[], id: string | null) => {
      if (id !== null && !ids.includes(id)) throw new Refused({ reason: 'INVALID_INPUT' })
      return id
    }
    const options = clean.options.map((o, position) => {
      const before = existing?.options.find((e) => e.id === known(existing.options.map((x) => x.id), o.id)) ?? null
      const id = before?.id ?? crypto.randomUUID()
      const values = o.values.map((v, valuePosition) => {
        const kept = before ? known(before.values.map((x) => x.id), v.id) : null
        return { id: kept ?? crypto.randomUUID(), optionId: id, name: v.name, position: valuePosition, kept: kept !== null }
      })
      return { id, name: o.name, position, kept: before !== null, values }
    })
    const keptOptionIds = new Set(options.filter((o) => o.kept).map((o) => o.id))
    const keptValueIds = new Set(options.flatMap((o) => o.values.filter((v) => v.kept).map((v) => v.id)))
    // Removed options and values go first, so a name reused in the same save never meets its old row.
    if (existing) {
      await deleteOptions(tx, existing.options.filter((o) => !keptOptionIds.has(o.id)).map((o) => o.id))
      await deleteOptionValues(tx, existing.options.filter((o) => keptOptionIds.has(o.id)).flatMap((o) => o.values.filter((v) => !keptValueIds.has(v.id)).map((v) => v.id)))
    }
    const write = (o: OptionWrite) => ({ id: o.id, name: o.name, position: o.position })
    const value = (v: ValueWrite) => ({ id: v.id, optionId: v.optionId, name: v.name, position: v.position })
    await updateOptions(tx, options.filter((o) => o.kept).map(write))
    await insertOptions(tx, storeId, productId, options.filter((o) => !o.kept).map(write))
    const values = options.flatMap((o) => o.values)
    await updateOptionValues(tx, values.filter((v) => v.kept).map(value))
    await insertOptionValues(tx, storeId, values.filter((v) => !v.kept).map(value))

    const before = existing?.versions.map((v) => v.id) ?? []
    const versions = clean.versions.map((v, position) => {
      const kept = known(before, v.id)
      return { id: kept ?? crypto.randomUUID(), kept: kept !== null, fields: versionFieldsOf(v, position), clean: v }
    })
    await updateVersions(tx, versions.filter((v) => v.kept).map((v) => ({ id: v.id, ...v.fields })), at)
    await insertVersions(tx, storeId, productId, versions.filter((v) => !v.kept).map((v) => ({ id: v.id, ...v.fields })))
    const ids = versions.map((v) => v.id)
    const choices = versions.flatMap((v) =>
      v.clean.choices.map((choice, i) => {
        const option = options[i]
        const chosen = option?.values.find((x) => x.name.toLowerCase() === choice.toLowerCase())
        return { versionId: v.id, optionId: option?.id ?? '', valueId: chosen?.id ?? '' }
      }),
    )
    await setVersionChoices(tx, storeId, ids, choices)
    await setVersionPrices(tx, storeId, ids, versions.flatMap((v) => v.clean.prices.map((p) => ({ versionId: v.id, ...p }))))
    await softDeleteVersions(tx, before.filter((id) => !ids.includes(id)), at)
    if (clean.photos !== null) {
      await setProductPhotos(tx, storeId, productId, clean.photos.map((p) => ({ assetId: p.assetId, alt: p.alt, versionId: p.version === null ? null : (ids[p.version] ?? null) })))
    }
    if (clean.video !== undefined) await setProductVideo(tx, storeId, productId, clean.video)
    if (clean.filterValues !== null) {
      const known = await knownFacetValues(tx, storeId, clean.filterValues.map((f) => f.valueId))
      if (!clean.filterValues.every((f) => known.has(f.valueId))) throw new Refused({ reason: 'INVALID_FILTER' })
      await setProductFilterValues(tx, storeId, productId, clean.filterValues.map((f) => ({ valueId: f.valueId, versionId: f.version === null ? null : (ids[f.version] ?? null) })))
    }
    if (clean.listing) {
      const { specs, ...rest } = clean.listing
      // A specification mirrors a filter value of this store only, as a tag does.
      const mirrored = (specs ?? []).flatMap((spec) => (spec.filterValueId ? [spec.filterValueId] : []))
      if (mirrored.length > 0) {
        const known = await knownFacetValues(tx, storeId, mirrored)
        if (!mirrored.every((id) => known.has(id))) throw new Refused({ reason: 'INVALID_LISTING' })
      }
      await setProductListing(tx, storeId, productId, { ...rest, ...(specs ? { specs: specs.map(({ version, ...spec }) => ({ ...spec, versionId: version === null ? null : (ids[version] ?? null) })) } : {}) })
    }
    if (clean.sizeChartId !== undefined) await setProductSizeChart(tx, storeId, productId, clean.sizeChartId)
    await recompute(tx)
  }

  const run = async (work: (tx: ScopedSql) => Promise<SaveResult>): Promise<SaveResult> => {
    try {
      return await inScope(work)
    } catch (error) {
      if (error instanceof Refused) return { ok: false, ...error.refusal }
      if (skuTaken(error)) return { ok: false, reason: 'DUPLICATE_SKU' }
      if (fileRefused(error)) return { ok: false, reason: 'FILE_REFUSED' }
      // product_related_check is the table's own check that a product never relates to itself.
      if (listingRefused(error) || (typeof error === 'object' && error !== null && 'constraint_name' in error && error.constraint_name === 'product_related_check')) return { ok: false, reason: 'LISTING_REFUSED' }
      const clash = nameClash(error)
      if (clash) return { ok: false, reason: clash }
      throw error
    }
  }

  const clean = async (tx: ScopedSql, input: ProductInput): Promise<Cleaned> => {
    const currency = await selectPricingCurrency(tx)
    if (!currency) throw new Refused({ reason: 'CURRENCY_REQUIRED' })
    const result = cleanProduct(input, currency)
    if (typeof result === 'string') throw new Refused({ reason: result })
    // Vendor input can't carry visibility (ACCESS §7.2): refused, not quietly dropped.
    if (sellerId !== null && result.visible !== null) throw new Refused({ reason: 'SUPPLIER_FIELD' })
    const sizeChartId = input.sizeChartId === undefined ? undefined : input.sizeChartId === null ? null : input.sizeChartId.toLowerCase()
    if (sizeChartId && !isUuid(sizeChartId)) throw new Refused({ reason: 'INVALID_LISTING' })
    try {
      const listing = input.listing ? cleanListing(input.listing, result.versions.length, 'marketRule' in input.listing) : null
      return { ...result, listing, sizeChartId }
    } catch (error) {
      if (error instanceof ListingInvalid) throw new Refused({ reason: 'INVALID_LISTING' })
      throw error
    }
  }

  const create = async (input: ProductInput): Promise<SaveResult> => {
    const allowance = await productAllowance()
    return run(async (tx) => {
      const product = await clean(tx, input)
      await lockCatalogue(tx, storeId)
      const wanted = (await countStoreProducts(tx)) + 1
      if (wanted > allowance) throw new Refused({ reason: 'PLAN_LIMIT', wanted })
      // A supplier's product is created visible while the store doesn't require approval (ACCESS §7.2 "Off").
      const visibility = sellerId !== null || product.visible !== false ? 'visible' : 'hidden'
      const made = await insertProduct(tx, { storeId, sellerId, createdBy: actor.id, fields: { ...fieldsOf(product, visibility), slug: sellerId !== null ? supplierSlug(product.slug) : product.slug } })
      await writeChildren(tx, made.id, product, null)
      await activity.record(tx, entry(catalogAudit.created, { id: made.id, label: product.name }))
      return { ok: true, id: made.id, slug: made.slug, revision: 1 }
    })
  }

  const update = (id: string, revision: number, input: ProductInput): Promise<SaveResult> =>
    run(async (tx) => {
      const existing = await selectProduct(tx, storeId, id)
      if (!existing) throw new Refused({ reason: 'NOT_FOUND' })
      if (existing.revision !== revision) throw new Refused({ reason: 'STALE_REVISION', revision: existing.revision })
      const product = await clean(tx, input)
      const visibility = product.visible === null ? existing.visibility : product.visible ? 'visible' : 'hidden'
      const held = existing.hidden_by === 'plan' || existing.approval_status === 'pending' || existing.approval_status === 'sent_back'
      if (visibility === 'visible' && existing.visibility !== 'visible' && held) throw new Refused({ reason: 'NOT_SHOWABLE' })
      // A live address changes only when asked for: a rename alone would break every link to it.
      const slug = !product.slugGiven || product.slug === existing.slug ? existing.slug : sellerId !== null ? supplierSlug(product.slug) : product.slug
      const done = await updateProduct(tx, { storeId, id, revision, fields: { ...fieldsOf(product, visibility), slug }, visibilityChange: sellerId === null && visibility !== existing.visibility }, now())
      if (!done) throw new Refused({ reason: 'STALE_REVISION', revision: existing.revision })
      await writeChildren(tx, id, product, existing)
      await activity.record(tx, entry(catalogAudit.updated, { id, label: product.name }))
      return { ok: true, id, slug: done.slug, revision: revision + 1 }
    })

  /** A hidden copy, stock not copied (decided on #337); SKUs and barcodes stay with the original, being unique. */
  const duplicate = async (id: string, options: { keepSizeChart: boolean }): Promise<SaveResult> => {
    const allowance = await productAllowance()
    return run(async (tx) => {
      const source = await selectProduct(tx, storeId, id)
      if (!source) throw new Refused({ reason: 'NOT_FOUND' })
      await lockCatalogue(tx, storeId)
      const wanted = (await countStoreProducts(tx)) + 1
      if (wanted > allowance) throw new Refused({ reason: 'PLAN_LIMIT', wanted })
      const copy: Cleaned = {
        name: source.name,
        description: source.description,
        slug: sellerId !== null ? supplierSlug(source.slug.replace(/-[a-z2-9]{6}$/, '')) : source.slug,
        slugGiven: true,
        productType: source.product_type,
        category: source.category,
        visible: false,
        warrantyText: source.warranty_text,
        returnsText: source.returns_text,
        seoTitle: source.seo_title,
        seoDescription: source.seo_description,
        options: source.options.map((o) => ({ id: null, name: o.name, values: o.values.map((v) => ({ id: null, name: v.name })) })),
        versions: source.versions.map((v) => ({
          id: null,
          choices: source.options.map((o) => o.values.find((value) => value.id === v.choices[o.id])?.name ?? ''),
          sku: null,
          barcode: null,
          name: v.name,
          visible: v.visibility === 'visible',
          prices: v.prices.map((p) => ({ currency: p.currency, amount: p.amount, compareAt: p.compare_at_amount })),
          cost: v.cost_amount !== null && v.cost_currency !== null ? { amount: v.cost_amount, currency: v.cost_currency } : null,
          weightGrams: v.weight_grams,
          lengthMm: v.length_mm,
          widthMm: v.width_mm,
          heightMm: v.height_mm,
          hsCode: v.hs_code,
          customsDescription: v.customs_description,
          trackStock: v.track_stock,
          continueSelling: v.continue_selling,
        })),
        // The same files, on the copy's own photos; the copy's versions are in the source's order.
        photos: source.photos.map((p) => ({ assetId: p.asset_id, alt: p.alt, version: p.version_id === null ? null : source.versions.findIndex((v) => v.id === p.version_id) })).map((p) => ({ ...p, version: p.version === -1 ? null : p.version })),
        video: source.video ? { assetId: source.video.asset_id, url: source.video.url } : null,
        filterValues: source.filter_values.map((f) => ({ valueId: f.value_id, version: f.version_id === null ? null : source.versions.findIndex((v) => v.id === f.version_id) })).filter((f) => f.version !== -1),
        // The copy keeps the listing it was made from, and the chart, which is the same owner's.
        listing: {
          specs: source.specs.map((p) => ({ name: p.name, value: p.value, filterValueId: p.filter_value_id, version: p.version_id === null ? null : Math.max(-1, source.versions.findIndex((v) => v.id === p.version_id)) })).filter((p) => p.version !== -1),
          highlights: source.highlights,
          faqs: source.faqs,
          related: source.related,
          badgeIds: source.badge_ids,
          flags: source.flags,
          compliance: source.compliance,
          marketRule: source.market_rule,
        },
        sizeChartId: options.keepSizeChart ? source.size_chart_id : null,
      }
      // A supplier's copy stays the supplier's and is created as its products are (ACCESS §7.2).
      const made = await insertProduct(tx, { storeId, sellerId: source.seller_id, createdBy: actor.id, fields: fieldsOf(copy, sellerId !== null ? 'visible' : 'hidden') })
      await writeChildren(tx, made.id, copy, null)
      await activity.record(tx, entry(catalogAudit.duplicated, { id: made.id, label: source.name }))
      return { ok: true, id: made.id, slug: made.slug, revision: 1 }
    })
  }

  const remove = (ids: readonly string[]) =>
    inScope(async (tx) => {
      const gone = await softDeleteProducts(tx, storeId, ids, now())
      await activity.recordAll(tx, gone.map((g) => entry(catalogAudit.deleted, { id: g.id, label: g.name })))
      if (gone.length > 0) await recompute(tx)
      return gone.length
    })

  /** The merchant side's bulk show and hide (CatList); a supplier never reaches it. */
  const setVisibility = (ids: readonly string[], visible: boolean) =>
    inScope(async (tx) => {
      if (sellerId !== null) throw new Error('catalogue: a supplier never sets visibility')
      const changed = await setProductsVisibility(tx, storeId, ids, visible ? 'visible' : 'hidden', now())
      await activity.recordAll(tx, changed.map((c) => entry(visible ? catalogAudit.shown : catalogAudit.hidden, { id: c.id, label: c.name })))
      return changed.length
    })

  const list = (query: Omit<ProductQuery, 'currency'>, window: PageWindow) =>
    inScope(async (tx) => {
      const currency = await selectPricingCurrency(tx)
      // A supplier's filter is its own scope; the supplier filter is the merchant's.
      return { currency, rows: await selectProducts(tx, storeId, { ...query, seller: sellerId !== null ? null : query.seller, currency }, window) }
    })

  const counts = () => inScope((tx) => countProducts(tx, storeId))

  const get = (id: string) =>
    inScope(async (tx) => ({ currency: await selectPricingCurrency(tx), product: await selectProduct(tx, storeId, id) }))

  return { list, counts, get, create, update, duplicate, remove, setVisibility }
}
