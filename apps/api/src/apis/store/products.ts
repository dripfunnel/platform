import { GraphQLError } from 'graphql'
import { pageOf } from '#core/paging'
import { catalogAudit, createCatalogService, type ProductFilter, type ProductInput, type ProductListRow, type ProductRow, type SaveResult } from '#engine/modules/catalog/index'
import { allowanceFor, planLimitFor } from '#saas/entitlements/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { pageInfoType, type StoreBuilder } from './builder'
import { storePage } from './refusals'
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
  SUPPLIER_FIELD: 'Suppliers can’t set whether a product shows.',
  STALE_REVISION: 'Someone else saved this product. Reload to see their changes.',
  PLAN_LIMIT: 'Your plan has no room for more products.',
}

const filters: readonly ProductFilter[] = ['all', 'visible', 'hidden', 'pending', 'sent_back']
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
  createdAt: string
  updatedAt: string
}

const summaryOf = (r: ProductListRow, currency: string | null): SummaryView => ({
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
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
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
      createdAt: t.exposeString('createdAt'),
      updatedAt: t.exposeString('updatedAt'),
    }),
  })
  const SummaryPage = builder.objectRef<{ nodes: SummaryView[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('ProductPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [Summary], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const Counts = builder.objectRef<{ all: number; visible: number; hidden: number; pending: number; sentBack: number }>('ProductCounts').implement({
    fields: (t) => ({ all: t.exposeInt('all'), visible: t.exposeInt('visible'), hidden: t.exposeInt('hidden'), pending: t.exposeInt('pending'), sentBack: t.exposeInt('sentBack') }),
  })

  const ValueType = builder.objectRef<{ id: string; name: string }>('ProductOptionValue').implement({ fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }) })
  const OptionType = builder.objectRef<ProductRow['options'][number]>('ProductOption').implement({
    fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name'), values: t.field({ type: [ValueType], resolve: (o) => o.values }) }),
  })
  const PriceType = builder.objectRef<{ currency: string; amount: string; compareAtAmount: string | null }>('VersionPrice').implement({
    fields: (t) => ({ currency: t.exposeString('currency'), amount: t.exposeString('amount'), compareAtAmount: t.exposeString('compareAtAmount', { nullable: true }) }),
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
      customsDescription: t.exposeString('customs_description', { nullable: true }),
      trackStock: t.exposeBoolean('track_stock', { nullable: true }),
      continueSelling: t.exposeBoolean('continue_selling', { nullable: true }),
    }),
  })
  type ProductView = ProductRow & { pricingCurrency: string | null; viewerIsSupplier: boolean }
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
      createdAt: t.string({ resolve: (p) => p.created_at.toISOString() }),
      updatedAt: t.string({ resolve: (p) => p.updated_at.toISOString() }),
    }),
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
    }),
  })
  const PatchInput = builder.inputType('ProductsPatch', { fields: (t) => ({ visible: t.boolean({ required: true }) }) })
  const Saved = builder.objectRef<{ id: string; slug: string; revision: number }>('SavedProduct').implement({
    fields: (t) => ({ id: t.exposeID('id'), slug: t.exposeString('slug'), revision: t.exposeInt('revision') }),
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
    })
  }

  /** The saved product, or the refusal as a stable code with its facts (FIRST-RELEASE §19). */
  const answered = async (ctx: StoreContext, result: SaveResult) => {
    if (result.ok) return { id: result.id, slug: result.slug, revision: result.revision }
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
      args: { filter: t.arg.string(), search: t.arg.string(), supplier: t.arg.string(), first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: read },
      resolve: async (_, args, ctx) => {
        const filter = filters.find((f) => f === (args.filter ?? 'all'))
        if (!filter) throw new GraphQLError('Choose a list to show.', { extensions: { code: 'INVALID_INPUT' } })
        const supplier = args.supplier ?? null
        if (supplier !== null && supplier !== 'own' && !isUuid(supplier)) throw new GraphQLError('Choose a supplier.', { extensions: { code: 'INVALID_INPUT' } })
        const search = args.search?.trim().slice(0, 200) || null
        const window = storePage(args)
        const { currency, rows } = await service(ctx).list({ filter, search, seller: supplier }, window)
        const page = pageOf(rows, window, (r) => ({ occurredAt: r.created_at, id: r.id }))
        return { nodes: page.nodes.map((r) => summaryOf(r, currency)), pageInfo: page.pageInfo }
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

  builder.mutationFields((t) => ({
    saveProduct: t.field({
      type: Saved,
      args: { id: t.arg.id(), revision: t.arg.int(), input: t.arg({ type: ProductInputType, required: true }) },
      extensions: { access: { ...write, audit: catalogAudit.updated } },
      resolve: async (_, args, ctx) => {
        const input: ProductInput = args.input
        if (args.id === null || args.id === undefined) return answered(ctx, await service(ctx).create(input))
        const id = String(args.id)
        if (!isUuid(id) || typeof args.revision !== 'number') throw new GraphQLError(words.INVALID_INPUT, { extensions: { code: 'INVALID_INPUT' } })
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
        return answered(ctx, await service(ctx).duplicate(id))
      },
    }),
    deleteProducts: t.int({
      args: { ids: t.arg.idList({ required: true }) },
      extensions: { access: { ...write, audit: catalogAudit.deleted } },
      resolve: (_, args, ctx) => service(ctx).remove(ids(args.ids)),
    }),
    updateProducts: t.int({
      args: { ids: t.arg.idList({ required: true }), patch: t.arg({ type: PatchInput, required: true }) },
      extensions: { access: { ...merchantWrite, audit: catalogAudit.shown } },
      resolve: (_, args, ctx) => service(ctx).setVisibility(ids(args.ids), args.patch.visible),
    }),
  }))
}
