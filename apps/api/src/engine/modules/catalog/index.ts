import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { PageWindow } from '#core/paging'
import type { TenantContext } from '#core/tenancy'
import {
  countProducts,
  countStoreProducts,
  deleteOptions,
  deleteOptionValues,
  insertOption,
  insertOptionValue,
  insertProduct,
  insertVersion,
  lockCatalogue,
  selectPricingCurrency,
  selectProduct,
  selectProducts,
  setProductsVisibility,
  setVersionChoices,
  setVersionPrices,
  skuTakenInStore,
  softDeleteProducts,
  softDeleteVersions,
  updateOption,
  updateOptionValue,
  updateProduct,
  updateVersion,
  type ProductFields,
  type ProductQuery,
  type ProductRow,
  type VersionFields,
} from '#db/scoped/catalog'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { cleanProduct, type CatalogRefusal, type CleanProduct, type CleanVersion, type ProductInput } from './rules'

export { maxOptions, maxVersions, refusedCategories, slugFrom, type ProductInput } from './rules'
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
  | { reason: CatalogRefusal | 'NOT_FOUND' | 'CURRENCY_REQUIRED' | 'SUPPLIER_FIELD' }
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

class Refused extends Error {
  constructor(readonly refusal: SaveRefusal) {
    super(refusal.reason)
  }
}

export const createCatalogService = ({ sql, context, actor, activity, facts, now, productAllowance }: CatalogDeps) => {
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

  /** Options, values, versions, their choices and prices, matched by id to what the product has. */
  const writeChildren = async (tx: ScopedSql, productId: string, clean: CleanProduct, existing: ProductRow | null) => {
    const at = now()
    const known = (ids: readonly string[], id: string | null) => {
      if (id !== null && !ids.includes(id)) throw new Refused({ reason: 'INVALID_INPUT' })
      return id
    }
    // Removed options and values go first, so a name reused in the same save never meets its old row.
    const optionIdsIn = clean.options.map((o) => known(existing?.options.map((e) => e.id) ?? [], o.id))
    if (existing) await deleteOptions(tx, existing.options.filter((o) => !optionIdsIn.includes(o.id)).map((o) => o.id))
    const valueIds: Map<string, string>[] = []
    const optionIds: string[] = []
    for (const [position, option] of clean.options.entries()) {
      const before = existing?.options.find((o) => o.id === optionIdsIn[position])
      if (before) {
        const valueIdsIn = option.values.map((v) => known(before.values.map((e) => e.id), v.id))
        await deleteOptionValues(tx, before.values.filter((v) => !valueIdsIn.includes(v.id)).map((v) => v.id))
      }
      const optionId = before ? before.id : await insertOption(tx, storeId, productId, option.name, position)
      if (before) await updateOption(tx, optionId, option.name, position)
      optionIds.push(optionId)
      const byName = new Map<string, string>()
      for (const [valuePosition, value] of option.values.entries()) {
        const valueBefore = before?.values.find((v) => v.id === value.id)
        const valueId = valueBefore ? valueBefore.id : await insertOptionValue(tx, storeId, optionId, value.name, valuePosition)
        if (valueBefore) await updateOptionValue(tx, valueId, value.name, valuePosition)
        byName.set(value.name.toLowerCase(), valueId)
      }
      valueIds.push(byName)
    }

    const keptVersions = new Set<string>()
    const versionIds = existing?.versions.map((v) => v.id) ?? []
    for (const [position, version] of clean.versions.entries()) {
      const id = known(versionIds, version.id)
      const fields = versionFieldsOf(version, position)
      const versionId = id ?? (await insertVersion(tx, storeId, productId, fields))
      if (id) await updateVersion(tx, id, fields, at)
      keptVersions.add(versionId)
      const choices = version.choices.map((choice, i) => ({ optionId: optionIds[i] ?? '', valueId: valueIds[i]?.get(choice.toLowerCase()) ?? '' }))
      await setVersionChoices(tx, storeId, versionId, choices)
      await setVersionPrices(tx, storeId, versionId, version.prices)
    }
    await softDeleteVersions(tx, versionIds.filter((id) => !keptVersions.has(id)), at)
  }

  const run = async (work: (tx: ScopedSql) => Promise<SaveResult>): Promise<SaveResult> => {
    try {
      return await inScope(work)
    } catch (error) {
      if (error instanceof Refused) return { ok: false, ...error.refusal }
      if (skuTakenInStore(error)) return { ok: false, reason: 'DUPLICATE_SKU' }
      throw error
    }
  }

  const clean = async (tx: ScopedSql, input: ProductInput): Promise<CleanProduct> => {
    const currency = await selectPricingCurrency(tx)
    if (!currency) throw new Refused({ reason: 'CURRENCY_REQUIRED' })
    const result = cleanProduct(input, currency)
    if (typeof result === 'string') throw new Refused({ reason: result })
    // Vendor input can't carry visibility (ACCESS §7.2): refused, not quietly dropped.
    if (sellerId !== null && result.visible !== null) throw new Refused({ reason: 'SUPPLIER_FIELD' })
    return result
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
      const made = await insertProduct(tx, { storeId, sellerId, createdBy: actor.id, fields: fieldsOf(product, visibility) })
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
      const done = await updateProduct(tx, { storeId, id, revision, fields: fieldsOf(product, visibility), visibilityChange: sellerId === null && visibility !== existing.visibility }, now())
      if (!done) throw new Refused({ reason: 'STALE_REVISION', revision: existing.revision })
      await writeChildren(tx, id, product, existing)
      await activity.record(tx, entry(catalogAudit.updated, { id, label: product.name }))
      return { ok: true, id, slug: done.slug, revision: revision + 1 }
    })

  /** A hidden copy, stock not copied (decided on #337); SKUs and barcodes stay with the original, being unique. */
  const duplicate = async (id: string): Promise<SaveResult> => {
    const allowance = await productAllowance()
    return run(async (tx) => {
      const source = await selectProduct(tx, storeId, id)
      if (!source) throw new Refused({ reason: 'NOT_FOUND' })
      await lockCatalogue(tx, storeId)
      const wanted = (await countStoreProducts(tx)) + 1
      if (wanted > allowance) throw new Refused({ reason: 'PLAN_LIMIT', wanted })
      const copy: CleanProduct = {
        name: source.name,
        description: source.description,
        slug: source.slug,
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
      for (const g of gone) await activity.record(tx, entry(catalogAudit.deleted, { id: g.id, label: g.name }))
      return gone.length
    })

  /** The merchant side's bulk show and hide (CatList); a supplier never reaches it. */
  const setVisibility = (ids: readonly string[], visible: boolean) =>
    inScope(async (tx) => {
      if (sellerId !== null) throw new Error('catalogue: a supplier never sets visibility')
      const changed = await setProductsVisibility(tx, storeId, ids, visible ? 'visible' : 'hidden', now())
      for (const c of changed) await activity.record(tx, entry(visible ? catalogAudit.shown : catalogAudit.hidden, { id: c.id, label: c.name }))
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
