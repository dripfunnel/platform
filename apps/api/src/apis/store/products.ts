import { GraphQLError } from 'graphql'
import type { CurrencyPrice, MarketReadiness } from '#engine/modules/markets/index'
import { approvalAudit, catalogAudit, createCatalogService, sortValueFits, sortValueOf, type ProductSort, type ProductFilter, type ProductInput, type ProductListRow, type ProductRow, type SaveResult } from '#engine/modules/catalog/index'
import { allowanceFor, planLimitFor } from '#saas/entitlements/index'
import { forbidden } from '../graphql/scope'
import { marketsService } from './markets'
import { translationService } from './translations'
import { actingCaller, type StoreContext } from './access'
import { pageInfoType, type StoreBuilder } from './builder'
import { sortedPage, sortedPageOf } from './refusals'
import { requireFeature } from './listing'
import { recomputeFor } from './structure'
import { isUuid } from '#core/ids'

// Products (FIRST-RELEASE §11, §19; CATALOG-DESIGN §3): the merchant side reads and writes the store's
// catalogue, a supplier its own products only (`store-seller`, RLS through SellerScope). Rules are the engine's.

const words: Record<Exclude<SaveResult, { ok: true }>['reason'], string> = {
  NAME_REQUIRED: 'Give the product a name.',
  INVALID_INPUT: 'Something in this product isn’t valid.',
  CATEGORY_REFUSED: 'This kind of product can’t be sold here.',
  TOO_MANY_OPTIONS: 'A product can have up to 3 kinds of choice.',
  TOO_MANY_VERSIONS: 'A product can have up to 100 versions.',
  OPTION_VALUES_REQUIRED: 'Every kind of choice needs at least one value.',
  DUPLICATE_OPTION: 'Two kinds of choice have the same name.',
  DUPLICATE_VALUE: 'A kind of choice lists the same value twice.',
  VERSION_CHOICES: 'Every version needs one value for each kind of choice.',
  DUPLICATE_VERSION: 'Two versions have the same choices.',
  VERSION_REQUIRED: 'A product needs at least one version.',
  PRICE_REQUIRED: 'Every version needs a price in the store’s currency.',
  INVALID_PRICE: 'A price isn’t valid.',
  INVALID_BARCODE: 'A barcode’s check digit doesn’t match.',
  DUPLICATE_SKU: 'You already use that product code on another product.',
  NOT_FOUND: 'That product isn’t here any more.',
  CURRENCY_REQUIRED: 'Choose the store’s currency first.',
  SUPPLIER_FIELD: 'That’s the store’s to set: whether a product shows, and its prices in other currencies.',
  NOT_SHOWABLE: 'This product is paused by your plan or waiting for approval, so it can’t be shown yet.',
  STALE_REVISION: 'Someone else saved this product. Reload to see their changes.',
  PLAN_LIMIT: 'Your plan has no room for more products.',
  TOO_MANY_PHOTOS: 'A product can have up to 20 photos.',
  INVALID_PHOTO: 'A photo isn’t valid.',
  INVALID_VIDEO: 'Use an uploaded video or an https link, not both.',
  FILE_REFUSED: 'That file isn’t here, or belongs to another product owner.',
  INVALID_FILTER: 'A filter value isn’t this store’s, or is listed twice.',
  INVALID_LISTING: 'Something in the listing sections isn’t valid.',
  LISTING_REFUSED: 'A related product, badge or size chart isn’t one this product can use.',
}

const sorts: readonly ProductSort[] = ['created', 'updated', 'name', 'price_low', 'price_high', 'stock']
const filters: readonly ProductFilter[] = ['all', 'visible', 'hidden', 'pending', 'sent_back', 'missing_info', 'low_stock']
const maxBulk = 100

const ids = (values: readonly (string | number)[]): string[] => {
  const list = [...new Set(values.map(String))]
  if (list.length === 0 || list.length > maxBulk || !list.every((id) => isUuid(id))) throw new GraphQLError(`Choose between 1 and ${maxBulk} products.`, { extensions: { code: 'INVALID_INPUT' } })
  return list
}

interface Money {
  amount: string
  currency: string
}

interface SummaryView {
  id: string
  name: string
  slug: string
  visible: boolean
  approval: string | null
  productType: string
  supplier: { id: string; name: string } | null
  supplierRemoved: boolean
  versionCount: number
  buyable: boolean
  minPrice: Money | null
  maxPrice: Money | null
  photoUrl: string | null
  stock: number
  lowStock: boolean
  createdAt: string
  updatedAt: string
  /** Per market, what it still lacks to sell there; null for a supplier, which reads no market. */
  readiness: MarketReadiness[] | null
}

/** Where the portal reads a catalogue file: on its own host, through the caller's scope (assets.ts). */
export const assetUrl = (assetId: string): string => `/api/assets/${assetId}`

const summaryOf = (r: ProductListRow, currency: string | null, readiness: MarketReadiness[] | null): SummaryView => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  visible: r.visibility === 'visible',
  approval: r.approval_status,
  productType: r.product_type,
  supplier: r.seller_id ? { id: r.seller_id, name: r.seller_name ?? '' } : null,
  supplierRemoved: r.seller_status === 'removed',
  versionCount: r.versions,
  // A visible product with no visible version is not buyable (fact 8).
  buyable: r.visibility === 'visible' && r.visible_versions > 0,
  minPrice: currency && r.min_amount !== null ? { amount: r.min_amount, currency } : null,
  maxPrice: currency && r.max_amount !== null ? { amount: r.max_amount, currency } : null,
  photoUrl: r.photo_asset_id ? assetUrl(r.photo_asset_id) : null,
  stock: r.stock,
  lowStock: r.low_stock,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
  readiness,
})

export const registerProducts = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)

  const MoneyType = builder.objectRef<Money>('Money').implement({
    // Minor units as a string: GraphQL's Int is 32-bit and a price may pass it (DATA-MODEL §7.1).
    fields: (t) => ({ amount: t.exposeString('amount'), currency: t.exposeString('currency') }),
  })
  const SupplierRef = builder.objectRef<{ id: string; name: string }>('ProductSupplier').implement({
    fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }),
  })

  const Readiness = builder.objectRef<MarketReadiness>('MarketReadiness').implement({
    fields: (t) => ({
      marketId: t.exposeID('marketId'),
      marketName: t.exposeString('marketName'),
      ready: t.boolean({ resolve: (r) => r.missing.length === 0 }),
      // price | fibre | origin | care | compare (India's MRP): what it still needs there (CATALOG T2, fact 45).
      missing: t.stringList({ resolve: (r) => r.missing }),
    }),
  })
  const merchantRead = { api: 'store', scope: 'store', permission: 'catalog.read', target: 'none' } as const

  const Summary = builder.objectRef<SummaryView>('ProductSummary').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      slug: t.exposeString('slug'),
      visible: t.exposeBoolean('visible'),
      approval: t.exposeString('approval', { nullable: true }),
      productType: t.exposeString('productType'),
      supplier: t.field({ type: SupplierRef, nullable: true, resolve: (p) => p.supplier }),
      supplierRemoved: t.exposeBoolean('supplierRemoved'),
      versionCount: t.exposeInt('versionCount'),
      buyable: t.exposeBoolean('buyable'),
      minPrice: t.field({ type: MoneyType, nullable: true, resolve: (p) => p.minPrice }),
      maxPrice: t.field({ type: MoneyType, nullable: true, resolve: (p) => p.maxPrice }),
      photoUrl: t.exposeString('photoUrl', { nullable: true }),
      // On hand in the caller's locations: a supplier never sees another owner's count (ACCESS §7.4).
      stock: t.exposeInt('stock'),
      // The Low stock chip's own test, by each location's threshold: the list never decides it again.
      lowStock: t.exposeBoolean('lowStock'),
      createdAt: t.exposeString('createdAt'),
      updatedAt: t.exposeString('updatedAt'),
      readiness: t.field({ type: [Readiness], nullable: true, extensions: { access: merchantRead }, resolve: (p) => p.readiness }),
    }),
  })
  const SummaryPage = builder.objectRef<{ nodes: SummaryView[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('ProductPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [Summary], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const Counts = builder.objectRef<{ all: number; visible: number; hidden: number; pending: number; sentBack: number; missingInfo: number; lowStock: number; fromSuppliers: number; outOfStock: number }>('ProductCounts').implement({
    fields: (t) => ({
      all: t.exposeInt('all'),
      visible: t.exposeInt('visible'),
      hidden: t.exposeInt('hidden'),
      pending: t.exposeInt('pending'),
      sentBack: t.exposeInt('sentBack'),
      missingInfo: t.exposeInt('missingInfo'),
      lowStock: t.exposeInt('lowStock'),
      fromSuppliers: t.exposeInt('fromSuppliers'),
      outOfStock: t.exposeInt('outOfStock'),
    }),
  })

  const ValueType = builder.objectRef<{ id: string; name: string }>('ProductOptionValue').implement({ fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }) })
  const OptionType = builder.objectRef<ProductRow['options'][number]>('ProductOption').implement({
    fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name'), values: t.field({ type: [ValueType], resolve: (o) => o.values }) }),
  })
  const PriceType = builder.objectRef<{ currency: string; amount: string; compareAtAmount: string | null }>('VersionPrice').implement({
    fields: (t) => ({ currency: t.exposeString('currency'), amount: t.exposeString('amount'), compareAtAmount: t.exposeString('compareAtAmount', { nullable: true }) }),
  })
  const PhotoType = builder.objectRef<ProductRow['photos'][number]>('ProductPhoto').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      assetId: t.exposeID('asset_id'),
      url: t.string({ resolve: (p) => assetUrl(p.asset_id) }),
      versionId: t.exposeID('version_id', { nullable: true }),
      alt: t.exposeString('alt', { nullable: true }),
      width: t.exposeInt('width', { nullable: true }),
      height: t.exposeInt('height', { nullable: true }),
    }),
  })
  const VideoType = builder.objectRef<NonNullable<ProductRow['video']>>('ProductVideo').implement({
    fields: (t) => ({
      assetId: t.exposeID('asset_id', { nullable: true }),
      url: t.string({ resolve: (v) => v.url ?? (v.asset_id ? assetUrl(v.asset_id) : '') }),
      uploaded: t.boolean({ resolve: (v) => v.asset_id !== null }),
    }),
  })
  const FilterValueRef = builder.objectRef<ProductRow['filter_values'][number]>('ProductFilterValue').implement({
    fields: (t) => ({ valueId: t.exposeID('value_id'), versionId: t.exposeID('version_id', { nullable: true }) }),
  })
  const Spec = builder.objectRef<ProductRow['specs'][number]>('ProductSpec').implement({
    fields: (t) => ({ name: t.exposeString('name'), value: t.exposeString('value'), versionId: t.exposeID('version_id', { nullable: true }), filterValueId: t.exposeID('filter_value_id', { nullable: true }) }),
  })
  const Faq = builder.objectRef<{ question: string; answer: string }>('ProductFaq').implement({ fields: (t) => ({ question: t.exposeString('question'), answer: t.exposeString('answer') }) })
  const Compliance = builder.objectRef<{ region: string; field: string; value: string }>('ProductCompliance').implement({
    fields: (t) => ({ region: t.exposeString('region'), field: t.exposeString('field'), value: t.exposeString('value') }),
  })
  const MarketRule = builder.objectRef<{ mode: string; countries: string[] }>('ProductMarketRule').implement({ fields: (t) => ({ mode: t.exposeString('mode'), countries: t.exposeStringList('countries') }) })
  const RelatedProduct = builder.objectRef<{ id: string; name: string }>('RelatedProduct').implement({ fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }) })
  const ListingType = builder.objectRef<ProductRow>('ProductListing').implement({
    fields: (t) => ({
      specs: t.field({ type: [Spec], resolve: (p) => p.specs }),
      highlights: t.stringList({ resolve: (p) => p.highlights }),
      faqs: t.field({ type: [Faq], resolve: (p) => p.faqs }),
      relatedIds: t.stringList({ resolve: (p) => p.related }),
      related: t.field({ type: [RelatedProduct], resolve: (p) => p.related_names }),
      badgeIds: t.stringList({ resolve: (p) => p.badge_ids }),
      ageRestricted: t.boolean({ resolve: (p) => p.flags.ageRestricted }),
      hazardous: t.boolean({ resolve: (p) => p.flags.hazardous }),
      compliance: t.field({ type: [Compliance], resolve: (p) => p.compliance }),
      marketRule: t.field({ type: MarketRule, nullable: true, resolve: (p) => p.market_rule }),
    }),
  })
  type VersionView = ProductRow['versions'][number] & { choiceNames: string[] }
  const VersionType = builder.objectRef<VersionView>('ProductVersion').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      // A value name per option, in the options' order: what saveProduct takes back.
      choices: t.exposeStringList('choiceNames'),
      sku: t.exposeString('sku', { nullable: true }),
      barcode: t.exposeString('barcode', { nullable: true }),
      name: t.exposeString('name', { nullable: true }),
      visible: t.boolean({ resolve: (v) => v.visibility === 'visible' }),
      prices: t.field({ type: [PriceType], resolve: (v) => v.prices.map((p) => ({ currency: p.currency, amount: p.amount, compareAtAmount: p.compare_at_amount })) }),
      cost: t.field({ type: MoneyType, nullable: true, resolve: (v) => (v.cost_amount !== null && v.cost_currency !== null ? { amount: v.cost_amount, currency: v.cost_currency } : null) }),
      weightGrams: t.exposeInt('weight_grams', { nullable: true }),
      lengthMm: t.exposeInt('length_mm', { nullable: true }),
      widthMm: t.exposeInt('width_mm', { nullable: true }),
      heightMm: t.exposeInt('height_mm', { nullable: true }),
      hsCode: t.exposeString('hs_code', { nullable: true }),
      // Null: the store's default class (CATALOG fact 38).
      taxClassId: t.exposeID('tax_class_id', { nullable: true }),
      customsDescription: t.exposeString('customs_description', { nullable: true }),
      trackStock: t.exposeBoolean('track_stock', { nullable: true }),
      continueSelling: t.exposeBoolean('continue_selling', { nullable: true }),
    }),
  })
  type ProductView = ProductRow & { pricingCurrency: string | null; viewerIsSupplier: boolean }
  const CurrencyPriceType = builder.objectRef<CurrencyPrice>('CurrencyPrice').implement({
    fields: (t) => ({
      currency: t.exposeString('currency'),
      // Minor units as a string; null when it isn't for sale in this currency yet (CATALOG O2).
      amount: t.string({ nullable: true, resolve: (p) => (p.amount === null ? null : p.amount.toString()) }),
      compareAtAmount: t.string({ nullable: true, resolve: (p) => (p.compareAt === null ? null : p.compareAt.toString()) }),
      // typed (the merchant's, kept as an override) | converted (from the pricing price at the reference rate) | null.
      source: t.exposeString('source', { nullable: true }),
    }),
  })
  const VersionPricingType = builder.objectRef<{ versionId: string; prices: CurrencyPrice[]; inMarket: CurrencyPrice | null }>('VersionPricing').implement({
    fields: (t) => ({
      versionId: t.exposeID('versionId'),
      prices: t.field({ type: [CurrencyPriceType], resolve: (v) => v.prices }),
      inMarket: t.field({ type: CurrencyPriceType, nullable: true, resolve: (v) => v.inMarket }),
    }),
  })

  const ProductType = builder.objectRef<ProductView>('Product').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      slug: t.exposeString('slug'),
      description: t.exposeString('description'),
      productType: t.exposeString('product_type'),
      category: t.exposeString('category', { nullable: true }),
      visible: t.boolean({ resolve: (p) => p.visibility === 'visible' }),
      approval: t.exposeString('approval_status', { nullable: true }),
      sentBackReason: t.exposeString('sent_back_reason', { nullable: true }),
      readiness: t.field({
        type: [Readiness],
        nullable: true,
        extensions: { access: merchantRead },
        resolve: async (p, _, ctx) => (await marketsService(ctx).readiness([p.id])).get(p.id) ?? [],
      }),
      // Prices in the store's other currencies and in a market are the merchant's (CATALOG O14): a supplier reads null.
      pricing: t.field({
        type: [VersionPricingType],
        nullable: true,
        args: { marketId: t.arg.id() },
        extensions: { access: { api: 'store', scope: 'store', permission: 'catalog.read', target: 'none' } },
        resolve: (p, args, ctx) => marketsService(ctx).pricing(p.versions, args.marketId ? String(args.marketId) : null),
      }),
      warrantyText: t.exposeString('warranty_text', { nullable: true }),
      returnsText: t.exposeString('returns_text', { nullable: true }),
      seoTitle: t.exposeString('seo_title', { nullable: true }),
      seoDescription: t.exposeString('seo_description', { nullable: true }),
      revision: t.exposeInt('revision'),
      pricingCurrency: t.exposeString('pricingCurrency', { nullable: true }),
      supplier: t.field({ type: SupplierRef, nullable: true, resolve: (p) => (p.seller_id ? { id: p.seller_id, name: p.seller_name ?? '' } : null) }),
      // "This is {Supplier}'s product. They will see your changes." / "Your store owner can also edit this product." (§11)
      shared: t.boolean({ resolve: (p) => p.viewerIsSupplier || p.seller_id !== null }),
      options: t.field({ type: [OptionType], resolve: (p) => p.options }),
      versions: t.field({
        type: [VersionType],
        resolve: (p) => p.versions.map((v) => ({ ...v, choiceNames: p.options.map((o) => o.values.find((value) => value.id === v.choices[o.id])?.name ?? '') })),
      }),
      photos: t.field({ type: [PhotoType], resolve: (p) => p.photos }),
      filterValues: t.field({ type: [FilterValueRef], resolve: (p) => p.filter_values }),
      listing: t.field({ type: ListingType, resolve: (p) => p }),
      sizeChartId: t.exposeID('size_chart_id', { nullable: true }),
      video: t.field({ type: VideoType, nullable: true, resolve: (p) => p.video }),
      createdAt: t.string({ resolve: (p) => p.created_at.toISOString() }),
      updatedAt: t.string({ resolve: (p) => p.updated_at.toISOString() }),
    }),
  })

  const PhotoInput = builder.inputType('ProductPhotoInput', {
    // `version` is the photo's version by its place in `versions`, so a new version can have one.
    fields: (t) => ({ assetId: t.string({ required: true }), alt: t.string(), version: t.int() }),
  })
  const VideoInput = builder.inputType('ProductVideoInput', { fields: (t) => ({ assetId: t.string(), url: t.string() }) })
  const SpecInput = builder.inputType('ProductSpecInput', {
    // "Shoppers can filter by this" points at the filter value it mirrors (fact 30); `version` as for photos.
    fields: (t) => ({ name: t.string({ required: true }), value: t.string({ required: true }), version: t.int(), filterValueId: t.string() }),
  })
  const FaqInput = builder.inputType('ProductFaqInput', { fields: (t) => ({ question: t.string({ required: true }), answer: t.string({ required: true }) }) })
  const ComplianceInput = builder.inputType('ProductComplianceInput', { fields: (t) => ({ region: t.string({ required: true }), field: t.string({ required: true }), value: t.string({ required: true }) }) })
  const MarketRuleInput = builder.inputType('ProductMarketRuleInput', { fields: (t) => ({ mode: t.string({ required: true }), countries: t.stringList({ required: true }) }) })
  const ListingInputType = builder.inputType('ProductListingInput', {
    // Each section left out stays as the product has it (CATALOG S9); `marketRule: null` removes the rule.
    fields: (t) => ({
      specs: t.field({ type: [SpecInput] }),
      highlights: t.stringList(),
      faqs: t.field({ type: [FaqInput] }),
      relatedIds: t.stringList(),
      badgeIds: t.stringList(),
      ageRestricted: t.boolean(),
      hazardous: t.boolean(),
      compliance: t.field({ type: [ComplianceInput] }),
      marketRule: t.field({ type: MarketRuleInput }),
    }),
  })
  const FilterValueInput = builder.inputType('ProductFilterValueInput', {
    // On the product, or one version by its place in `versions` (fact 13).
    fields: (t) => ({ valueId: t.string({ required: true }), version: t.int() }),
  })

  const PriceInput = builder.inputType('VersionPriceInput', {
    fields: (t) => ({ currency: t.string({ required: true }), amount: t.string({ required: true }), compareAtAmount: t.string() }),
  })
  const MoneyInput = builder.inputType('MoneyInput', { fields: (t) => ({ currency: t.string({ required: true }), amount: t.string({ required: true }) }) })
  const VersionInput = builder.inputType('ProductVersionInput', {
    fields: (t) => ({
      id: t.id(),
      choices: t.stringList({ required: true }),
      sku: t.string(),
      barcode: t.string(),
      name: t.string(),
      visible: t.boolean(),
      prices: t.field({ type: [PriceInput], required: true }),
      cost: t.field({ type: MoneyInput }),
      weightGrams: t.int(),
      lengthMm: t.int(),
      widthMm: t.int(),
      heightMm: t.int(),
      hsCode: t.string(),
      taxClassId: t.id(),
      customsDescription: t.string(),
      trackStock: t.boolean(),
      continueSelling: t.boolean(),
    }),
  })
  const ValueInput = builder.inputType('ProductOptionValueInput', { fields: (t) => ({ id: t.id(), name: t.string({ required: true }) }) })
  const OptionInput = builder.inputType('ProductOptionInput', {
    fields: (t) => ({ id: t.id(), name: t.string({ required: true }), values: t.field({ type: [ValueInput], required: true }) }),
  })
  const ProductInputType = builder.inputType('ProductInput', {
    fields: (t) => ({
      name: t.string({ required: true }),
      description: t.string(),
      slug: t.string(),
      productType: t.string(),
      category: t.string(),
      // The merchant side's only (ACCESS §7.2): a supplier sending it is refused SUPPLIER_FIELD.
      visible: t.boolean(),
      warrantyText: t.string(),
      returnsText: t.string(),
      seoTitle: t.string(),
      seoDescription: t.string(),
      options: t.field({ type: [OptionInput], required: true }),
      versions: t.field({ type: [VersionInput], required: true }),
      photos: t.field({ type: [PhotoInput] }),
      video: t.field({ type: VideoInput }),
      filterValues: t.field({ type: [FilterValueInput] }),
      listing: t.field({ type: ListingInputType }),
      sizeChartId: t.string(),
    }),
  })
  const PatchInput = builder.inputType('ProductsPatch', { fields: (t) => ({ visible: t.boolean({ required: true }) }) })
  const Saved = builder.objectRef<{ id: string; slug: string; revision: number; approval: string | null; reviewed: string[] }>('SavedProduct').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      slug: t.exposeString('slug'),
      revision: t.exposeInt('revision'),
      // approved | pending | sent_back, or null outside approval; `reviewed` names the change that needs it (CATALOG E3).
      approval: t.exposeString('approval', { nullable: true }),
      reviewed: t.exposeStringList('reviewed'),
    }),
  })

  const read = { api: 'store', scope: 'store-seller', permission: 'catalog.read', target: 'none' } as const
  const write = { api: 'store', scope: 'store-seller', permission: 'catalog.write', target: 'none' } as const
  const merchantWrite = { api: 'store', scope: 'store', permission: 'catalog.write', target: 'none' } as const

  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const sql = ctx.sql
    const caller = actingCaller(ctx)
    return createCatalogService({
      sql,
      context: caller.context,
      actor: { id: caller.person.id, partnerId: caller.person.partnerId },
      activity: ctx.activity,
      facts: ctx.facts,
      now: ctx.now,
      productAllowance: () => allowanceFor(sql, caller.context, 'products', ctx.now()),
      recompute: recomputeFor(caller),
    })
  }

  /** The saved product, or the refusal as a stable code with its facts (FIRST-RELEASE §19). */
  const answered = async (ctx: StoreContext, result: SaveResult) => {
    if (result.ok) return { id: result.id, slug: result.slug, revision: result.revision, approval: result.approval, reviewed: result.reviewed }
    // A supplier never reads the store's plan (§2 "masked"): it hears the store is full, not which plan or upgrade.
    if (result.reason === 'PLAN_LIMIT' && actingCaller(ctx).seller !== null) throw new GraphQLError('This store can’t take more products right now. Ask the store.', { extensions: { code: 'PLAN_LIMIT' } })
    if (result.reason === 'PLAN_LIMIT' && ctx.sql) {
      const limit = await planLimitFor(ctx.sql, actingCaller(ctx).context, { key: 'products', total: result.wanted }, ctx.now())
      throw new GraphQLError(words.PLAN_LIMIT, { extensions: { code: 'PLAN_LIMIT', key: 'products', limit: limit?.limit ?? 0, unlockedBy: limit?.unlockedBy ?? null } })
    }
    const facts = result.reason === 'STALE_REVISION' ? { revision: result.revision } : {}
    throw new GraphQLError(words[result.reason], { extensions: { code: result.reason, ...facts } })
  }

  builder.queryFields((t) => ({
    products: t.field({
      type: SummaryPage,
      // sort: created (the default) | updated | name | price_low | price_high | stock (CatList's sorts).
      args: { filter: t.arg.string(), search: t.arg.string(), supplier: t.arg.string(), untranslatedIn: t.arg.string(), sort: t.arg.string(), first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: read },
      resolve: async (_, args, ctx) => {
        const filter = filters.find((f) => f === (args.filter ?? 'all'))
        if (!filter) throw new GraphQLError('Choose a list to show.', { extensions: { code: 'INVALID_INPUT' } })
        const supplier = args.supplier ?? null
        if (supplier !== null && supplier !== 'own' && !isUuid(supplier)) throw new GraphQLError('Choose a supplier.', { extensions: { code: 'INVALID_INPUT' } })
        const search = args.search?.trim().slice(0, 200) || null
        const sort = sorts.find((x) => x === (args.sort ?? 'created'))
        if (!sort) throw new GraphQLError('Choose how to sort.', { extensions: { code: 'INVALID_INPUT' } })
        const byTime = sort === 'created' || sort === 'updated'
        const window = sortedPage(args, sort, byTime, (value) => sortValueFits(sort, value))
        const untranslatedIn = args.untranslatedIn?.trim() || null
        // The same languages translationProgress counts, so the list and the count can't disagree.
        if (untranslatedIn) {
          const checked = await translationService(ctx).checkLanguage(untranslatedIn)
          if (!checked.ok) throw new GraphQLError('Choose one of your store’s other languages.', { extensions: { code: checked.reason } })
        }
        const { currency, rows } = await service(ctx).list({ filter, search, seller: supplier, untranslatedIn }, window, sort)
        const page = sortedPageOf(rows, window, sort, byTime, (r) => ({ value: sortValueOf(r, sort), id: r.id }))
        // The page's readiness in one go, the merchant side's alone (a supplier reads no market).
        const readiness = actingCaller(ctx).seller === null ? await marketsService(ctx).readiness(page.nodes.map((r) => r.id)) : null
        return { nodes: page.nodes.map((r) => summaryOf(r, currency, readiness ? (readiness.get(r.id) ?? []) : null)), pageInfo: page.pageInfo }
      },
    }),
    productCounts: t.field({ type: Counts, extensions: { access: read }, resolve: (_, __, ctx) => service(ctx).counts() }),
    product: t.field({
      type: ProductType,
      nullable: true,
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: read },
      resolve: async (_, args, ctx) => {
        const id = String(args.id)
        if (!isUuid(id)) return null
        const { currency, product } = await service(ctx).get(id)
        return product ? { ...product, pricingCurrency: currency, viewerIsSupplier: actingCaller(ctx).seller !== null } : null
      },
    }),
  }))

  // Putting FAQs, related products, badges or a video on a product is a plan feature; saving it empty never is.
  const requireSections = async (ctx: StoreContext, input: ProductInput): Promise<void> => {
    const caller = actingCaller(ctx)
    const listing = input.listing
    if ((listing?.faqs?.length ?? 0) > 0 || (listing?.relatedIds?.length ?? 0) > 0) await requireFeature(ctx, caller, 'faqs_related')
    if ((listing?.badgeIds?.length ?? 0) > 0) await requireFeature(ctx, caller, 'badges')
    if (input.video && (input.video.assetId || input.video.url)) await requireFeature(ctx, caller, 'product_video')
  }
  builder.mutationFields((t) => ({
    // A Stock-only supplier's new product, waiting for the merchant's approval (decided on #337).
    proposeProduct: t.field({
      type: Saved,
      args: { input: t.arg({ type: ProductInputType, required: true }) },
      extensions: { access: { api: 'store', scope: 'store-seller', permission: 'catalog.propose', target: 'none', audit: approvalAudit.proposed } },
      resolve: async (_, args, ctx) => {
        if (args.input.sizeChartId) await requireFeature(ctx, actingCaller(ctx), 'size_charts')
        await requireSections(ctx, args.input)
        return answered(ctx, await service(ctx).propose(args.input))
      },
    }),
    saveProduct: t.field({
      type: Saved,
      args: { id: t.arg.id(), revision: t.arg.int(), input: t.arg({ type: ProductInputType, required: true }) },
      extensions: { access: { ...write, audit: catalogAudit.updated } },
      resolve: async (_, args, ctx) => {
        const input: ProductInput = args.input
        const chart = input.sizeChartId?.toLowerCase() ?? null
        await requireSections(ctx, input)
        // Assigning a size chart is a plan feature (SAAS §6.1); keeping the one it has or removing it never is.
        if (args.id === null || args.id === undefined) {
          if (chart) await requireFeature(ctx, actingCaller(ctx), 'size_charts')
          return answered(ctx, await service(ctx).create(input))
        }
        const id = String(args.id)
        if (!isUuid(id) || typeof args.revision !== 'number') throw new GraphQLError(words.INVALID_INPUT, { extensions: { code: 'INVALID_INPUT' } })
        if (chart && (await service(ctx).get(id)).product?.size_chart_id !== chart) await requireFeature(ctx, actingCaller(ctx), 'size_charts')
        return answered(ctx, await service(ctx).update(id, args.revision, input))
      },
    }),
    duplicateProduct: t.field({
      type: Saved,
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...write, audit: catalogAudit.duplicated } },
      resolve: async (_, args, ctx) => {
        const id = String(args.id)
        if (!isUuid(id)) throw new GraphQLError(words.NOT_FOUND, { extensions: { code: 'NOT_FOUND' } })
        // A copy is a new assignment: on a plan without size charts it is made without the chart.
        const keepSizeChart = ctx.sql ? (await planLimitFor(ctx.sql, actingCaller(ctx).context, { key: 'size_charts' }, ctx.now())) === null : false
        return answered(ctx, await service(ctx).duplicate(id, { keepSizeChart }))
      },
    }),
    deleteProducts: t.int({
      args: { ids: t.arg.idList({ required: true }) },
      extensions: { access: { ...write, audit: catalogAudit.deleted } },
      resolve: (_, args, ctx) => service(ctx).remove(ids(args.ids)),
    }),
    // Answers how many products changed.
    setProductsTaxClass: t.int({
      args: { ids: t.arg.idList({ required: true }), taxClassId: t.arg.id() },
      extensions: { access: { ...merchantWrite, audit: catalogAudit.taxClassChanged } },
      resolve: async (_, args, ctx) => {
        const changed = await service(ctx).setTaxClass(ids(args.ids), args.taxClassId ? String(args.taxClassId) : null)
        if (changed === 'NOT_FOUND') throw new GraphQLError('That tax category is no longer here.', { extensions: { code: 'NOT_FOUND' } })
        return changed
      },
    }),
    updateProducts: t.int({
      args: { ids: t.arg.idList({ required: true }), patch: t.arg({ type: PatchInput, required: true }) },
      extensions: { access: { ...merchantWrite, audit: catalogAudit.shown } },
      resolve: (_, args, ctx) => service(ctx).setVisibility(ids(args.ids), args.patch.visible),
    }),
  }))
}
