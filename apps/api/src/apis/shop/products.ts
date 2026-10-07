import { GraphQLError } from 'graphql'
import type { Money } from '#core/money'
import type { Page } from '#core/paging'
import type { ProductRequest, ShopFacetRow, ShopProductExtrasRow, ShopProductPage, ShopProductView, ShopSort, ShopVersionView } from '#engine/modules/storefront/index'
import type { ShopContext } from './access'
import type { ShopBuilder } from './builder'
import { assetUrl, catalogOf, imageOf } from './catalog'

// Products, a product page and search (FIRST-RELEASE §19 Shop API): prices, stock and badges are the engine's; a storefront
// shows them and asserts none (PLATFORM-PROMPT §5.5).

type StoryPhoto = { assetId: string | null; alt: string | null }
type StoryItem = { title: string | null; text: string | null; photo: StoryPhoto | null }
type StoryModule = Record<string, unknown> & { id: string; kind: string }
type Block = ShopProductExtrasRow['blocks'][number]
type ModuleSource = { module: StoryModule; page: ShopProductPage }

const sorts: Record<string, ShopSort> = { NEWEST: 'newest', PRICE_LOW: 'price_low', PRICE_HIGH: 'price_high', NAME: 'name', COLLECTION: 'collection' }
const field = (m: StoryModule, key: string): unknown => (key in m ? m[key] : null)

const refused = (reason: string) => {
  const words: Record<string, string> = { INVALID_CURSOR: 'That page cursor isn’t valid.', INVALID_INPUT: 'Something here isn’t valid.' }
  return new GraphQLError(words[reason] ?? 'Something here isn’t valid.', { extensions: { code: reason } })
}

export const registerProducts = ({ builder, pageInfo, image }: ShopBuilder) => {
  const MoneyType = builder.objectRef<Money>('ShopMoney').implement({
    // Minor units as a string (GraphQL's Int is 32-bit), in `currency` (AGENTS.md "Money").
    fields: (t) => ({ amount: t.string({ resolve: (m) => m.amount.toString() }), currency: t.exposeString('currency') }),
  })
  const Photo = builder.objectRef<{ assetId: string; alt: string | null; versionId: string | null }>('ShopPhoto').implement({
    fields: (t) => ({
      image: t.field({ type: image, resolve: (p, _, ctx) => ({ id: p.assetId, url: assetUrl(ctx, p.assetId) }) }),
      alt: t.exposeString('alt', { nullable: true }),
      versionId: t.exposeID('versionId', { nullable: true }),
    }),
  })
  const Badge = builder.objectRef<{ label: string; tone: string }>('ShopBadge').implement({ fields: (t) => ({ label: t.exposeString('label'), tone: t.exposeString('tone') }) })
  const Choice = builder.objectRef<ShopVersionView['choices'][number]>('ShopVersionChoice').implement({ fields: (t) => ({ optionId: t.exposeID('optionId'), valueId: t.exposeID('valueId') }) })
  const Version = builder.objectRef<ShopVersionView>('ShopVersion').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name', { nullable: true }),
      sku: t.exposeString('sku', { nullable: true }),
      choices: t.field({ type: [Choice], resolve: (v) => v.choices }),
      // Null: not for sale in this currency yet (CATALOG O2).
      price: t.field({ type: MoneyType, nullable: true, resolve: (v) => v.price }),
      compareAt: t.field({ type: MoneyType, nullable: true, resolve: (v) => v.compareAt }),
      // What's left; null when the store doesn't count it. Checked again at payment (SAPI 10).
      available: t.exposeInt('available', { nullable: true }),
      inStock: t.exposeBoolean('inStock'),
      weightGrams: t.exposeInt('weightGrams', { nullable: true }),
    }),
  })
  const Summary = builder.objectRef<ShopProductView>('ShopProductSummary').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      slug: t.exposeString('slug'),
      productType: t.exposeString('productType'),
      price: t.field({ type: MoneyType, nullable: true, resolve: (p) => p.price }),
      compareAt: t.field({ type: MoneyType, nullable: true, resolve: (p) => p.compareAt }),
      maxPrice: t.field({ type: MoneyType, nullable: true, resolve: (p) => p.maxPrice }),
      inStock: t.exposeBoolean('inStock'),
      photo: t.field({ type: Photo, nullable: true, resolve: (p) => p.photos.find((ph) => ph.versionId === null) ?? p.photos[0] ?? null }),
      badges: t.field({ type: [Badge], resolve: (p) => p.badges }),
    }),
  })
  const FacetValue = builder.objectRef<ShopFacetRow['values'][number]>('ShopFacetValue').implement({
    fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name'), count: t.exposeInt('count') }),
  })
  const Facet = builder.objectRef<ShopFacetRow>('ShopFacet').implement({
    fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name'), values: t.field({ type: [FacetValue], resolve: (f) => f.values }) }),
  })
  const ProductPage = builder.objectRef<Page<ShopProductView> & { request: ProductRequest }>('ShopProductPage').implement({
    fields: (t) => ({
      nodes: t.field({ type: [Summary], resolve: (p) => p.nodes }),
      pageInfo: t.field({ type: pageInfo, resolve: (p) => p.pageInfo }),
      // Counted before the filter choices narrow the list, so every value can be chosen (CATALOG H).
      facets: t.field({ type: [Facet], resolve: (p, _, ctx) => catalogOf(ctx).facets(p.request) }),
    }),
  })
  const OptionValue = builder.objectRef<{ id: string; name: string }>('ShopOptionValue').implement({ fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }) })
  const Option = builder.objectRef<ShopProductExtrasRow['options'][number]>('ShopOption').implement({
    fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name'), values: t.field({ type: [OptionValue], resolve: (o) => o.values }) }),
  })
  const Spec = builder.objectRef<ShopProductExtrasRow['specs'][number]>('ShopSpec').implement({
    fields: (t) => ({ name: t.exposeString('name'), value: t.exposeString('value'), versionId: t.exposeID('version_id', { nullable: true }) }),
  })
  const Faq = builder.objectRef<ShopProductExtrasRow['faqs'][number]>('ShopFaq').implement({ fields: (t) => ({ question: t.exposeString('question'), answer: t.exposeString('answer') }) })
  const Compliance = builder.objectRef<ShopProductExtrasRow['compliance'][number]>('ShopCompliance').implement({
    fields: (t) => ({ region: t.exposeString('region'), field: t.exposeString('field'), value: t.exposeString('value') }),
  })
  const FilterTag = builder.objectRef<ShopProductExtrasRow['filters'][number]>('ShopFilterTag').implement({ fields: (t) => ({ filter: t.exposeString('filter'), value: t.exposeString('value') }) })
  const Video = builder.objectRef<{ asset_id: string | null; url: string | null }>('ShopVideo').implement({
    fields: (t) => ({ file: t.field({ type: image, nullable: true, resolve: (v, _, ctx) => imageOf(ctx, v.asset_id) }), url: t.exposeString('url', { nullable: true }) }),
  })
  const Flags = builder.objectRef<{ age_restricted: boolean; hazardous: boolean }>('ShopFlags').implement({
    fields: (t) => ({ ageRestricted: t.exposeBoolean('age_restricted'), hazardous: t.exposeBoolean('hazardous') }),
  })
  type Chart = NonNullable<ShopProductExtrasRow['size_chart']>
  const ChartRow = builder.objectRef<Chart['rows'][number]>('ShopSizeChartRow').implement({ fields: (t) => ({ size: t.exposeString('size'), values: t.exposeStringList('values') }) })
  const ChartNote = builder.objectRef<Chart['how_to_measure'][number]>('ShopSizeChartNote').implement({ fields: (t) => ({ measurement: t.exposeString('measurement'), text: t.exposeString('text') }) })
  const SizeChart = builder.objectRef<Chart>('ShopSizeChart').implement({
    fields: (t) => ({
      name: t.exposeString('name'),
      unit: t.exposeString('unit'),
      systems: t.exposeStringList('systems'),
      measurements: t.exposeStringList('measurements'),
      rows: t.field({ type: [ChartRow], resolve: (c) => c.rows }),
      howToMeasure: t.field({ type: [ChartNote], resolve: (c) => c.how_to_measure }),
      fitNotes: t.exposeString('fit_notes', { nullable: true }),
      modelInfo: t.exposeString('model_info', { nullable: true }),
    }),
  })
  const StoryPhotoType = builder.objectRef<StoryPhoto>('ShopStoryPhoto').implement({
    fields: (t) => ({ image: t.field({ type: image, nullable: true, resolve: (p, _, ctx) => imageOf(ctx, p.assetId) }), alt: t.exposeString('alt', { nullable: true }) }),
  })
  const StoryItemType = builder.objectRef<StoryItem>('ShopStoryItem').implement({
    fields: (t) => ({ title: t.exposeString('title', { nullable: true }), text: t.exposeString('text', { nullable: true }), photo: t.field({ type: StoryPhotoType, nullable: true, resolve: (i) => i.photo }) }),
  })
  const BlockType = builder.objectRef<Block>('ShopStoryBlock').implement({
    fields: (t) => ({
      title: t.string({ resolve: (b) => b.content.title }),
      body: t.string({ resolve: (b) => b.content.body }),
      photo: t.field({ type: StoryPhotoType, nullable: true, resolve: (b) => b.content.photo }),
    }),
  })
  // One shape for every kind, as the Store API's: a field the kind doesn't have is null (CatAPlus).
  const ModuleType = builder.objectRef<ModuleSource>('ShopStoryModule').implement({
    fields: (t) => ({
      id: t.string({ resolve: (s) => s.module.id }),
      kind: t.string({ resolve: (s) => s.module.kind }),
      title: t.string({ nullable: true, resolve: (s) => field(s.module, 'title') as string | null }),
      body: t.string({ nullable: true, resolve: (s) => field(s.module, 'body') as string | null }),
      side: t.string({ nullable: true, resolve: (s) => field(s.module, 'side') as string | null }),
      photo: t.field({ type: StoryPhotoType, nullable: true, resolve: (s) => field(s.module, 'photo') as StoryPhoto | null }),
      items: t.field({ type: [StoryItemType], nullable: true, resolve: (s) => field(s.module, 'items') as StoryItem[] | null }),
      photos: t.field({ type: [StoryPhotoType], nullable: true, resolve: (s) => field(s.module, 'photos') as StoryPhoto[] | null }),
      // A compared product shoppers can't see, or this market doesn't sell, is left out; all loaded with the page.
      products: t.field({
        type: [Summary],
        nullable: true,
        resolve: (s) => {
          const ids = field(s.module, 'productIds') as string[] | null
          return ids ? ids.slice(0, 5).flatMap((id) => s.page.compared.get(id) ?? []) : null
        },
      }),
      block: t.field({ type: BlockType, nullable: true, resolve: (s) => s.page.extras.blocks.find((b) => b.id === field(s.module, 'blockId')) ?? null }),
      video: t.field({ type: Video, nullable: true, resolve: (s) => { const v = field(s.module, 'video') as { assetId: string | null; url: string | null } | null; return v ? { asset_id: v.assetId, url: v.url } : null } }),
    }),
  })
  const Product = builder.objectRef<ShopProductPage>('ShopProduct').implement({
    fields: (t) => ({
      id: t.string({ resolve: (p) => p.product.id }),
      name: t.string({ resolve: (p) => p.product.name }),
      slug: t.string({ resolve: (p) => p.product.slug }),
      description: t.string({ resolve: (p) => p.product.description }),
      productType: t.string({ resolve: (p) => p.product.productType }),
      seoTitle: t.string({ nullable: true, resolve: (p) => p.product.seoTitle }),
      seoDescription: t.string({ nullable: true, resolve: (p) => p.product.seoDescription }),
      price: t.field({ type: MoneyType, nullable: true, resolve: (p) => p.product.price }),
      compareAt: t.field({ type: MoneyType, nullable: true, resolve: (p) => p.product.compareAt }),
      maxPrice: t.field({ type: MoneyType, nullable: true, resolve: (p) => p.product.maxPrice }),
      inStock: t.boolean({ resolve: (p) => p.product.inStock }),
      // Whether the shopper's market sells it now: allowed there, priced in the cart's currency, its legal details given (CATALOG T2).
      soldHere: t.boolean({ resolve: (p) => p.soldHere }),
      photos: t.field({ type: [Photo], resolve: (p) => p.product.photos }),
      badges: t.field({ type: [Badge], resolve: (p) => p.product.badges }),
      options: t.field({ type: [Option], resolve: (p) => p.extras.options }),
      versions: t.field({ type: [Version], resolve: (p) => p.product.versions }),
      specs: t.field({ type: [Spec], resolve: (p) => p.extras.specs }),
      highlights: t.stringList({ resolve: (p) => p.extras.highlights }),
      faqs: t.field({ type: [Faq], resolve: (p) => p.extras.faqs }),
      related: t.field({ type: [Summary], resolve: (p) => p.related }),
      video: t.field({ type: Video, nullable: true, resolve: (p) => p.extras.video }),
      flags: t.field({ type: Flags, nullable: true, resolve: (p) => p.extras.flags }),
      compliance: t.field({ type: [Compliance], resolve: (p) => p.extras.compliance }),
      filters: t.field({ type: [FilterTag], resolve: (p) => p.extras.filters }),
      sizeChart: t.field({ type: SizeChart, nullable: true, resolve: (p) => p.extras.size_chart }),
      warranty: t.string({ nullable: true, resolve: (p) => p.product.warranty }),
      returns: t.string({ nullable: true, resolve: (p) => p.product.returns }),
      storyTemplate: t.string({ nullable: true, resolve: (p) => p.extras.story?.template ?? null }),
      story: t.field({ type: [ModuleType], resolve: (p) => ((p.extras.story?.modules ?? []) as StoryModule[]).map((module) => ({ module, page: p })) }),
    }),
  })
  const SortType = builder.enumType('ShopProductSort', { values: Object.keys(sorts) })

  const access = { api: 'shop', scope: 'shop', permission: null } as const
  const listed = async (ctx: ShopContext, request: ProductRequest) => {
    const page = await catalogOf(ctx).products(request)
    if (!page.ok) throw refused(page.reason)
    return { ...page.value, request }
  }

  builder.queryFields((t) => ({
    products: t.field({
      type: ProductPage,
      args: { first: t.arg.int(), after: t.arg.string(), before: t.arg.string(), collection: t.arg.string(), filters: t.arg.idList(), search: t.arg.string(), sort: t.arg({ type: SortType }) },
      extensions: { access },
      resolve: (_, args, ctx) =>
        listed(ctx, { first: args.first, after: args.after, before: args.before, collection: args.collection, filters: args.filters?.map(String), search: args.search, sort: args.sort ? sorts[args.sort] : null }),
    }),
    // The storefront's search box: products matching the words, in the shopper's language or the main one.
    search: t.field({
      type: ProductPage,
      args: { query: t.arg.string({ required: true }), first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access },
      resolve: (_, args, ctx) => listed(ctx, { first: args.first, after: args.after, before: args.before, search: args.query }),
    }),
    product: t.field({ type: Product, nullable: true, args: { slug: t.arg.string({ required: true }) }, extensions: { access }, resolve: (_, args, ctx) => catalogOf(ctx).product(args.slug) }),
  }))
}
