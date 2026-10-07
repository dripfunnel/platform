import { GraphQLError } from 'graphql'
import type { Page } from '#core/paging'
import { createStorefrontCatalog, type ShopCollectionRow, type ShopMenuItem, type ShopStoreRow } from '#engine/modules/storefront/index'
import { shopOf, type ShopContext } from './access'
import type { ShopBuilder } from './builder'

// The store, its menu and its collections (FIRST-RELEASE §19 Shop API; PLATFORM-PROMPT §5.5).

export const shopAssetPath = '/shop-api/assets'

export const assetUrl = (ctx: ShopContext, id: string) => `${ctx.origin}${shopAssetPath}/${id}`

export const imageOf = (ctx: ShopContext, id: string | null) => (id ? { id, url: assetUrl(ctx, id) } : null)

export const catalogOf = (ctx: ShopContext) => {
  const { sql, shopper } = shopOf(ctx)
  return createStorefrontCatalog({ sql, context: shopper.context, language: shopper.language, currency: shopper.currency, marketId: shopper.marketId, features: shopper.features, now: ctx.now })
}

export const registerCatalog = ({ builder, pageInfo, image }: ShopBuilder) => {
  const Address = builder.objectRef<ShopStoreRow['address'] & { country: string | null }>('ShopAddress').implement({
    fields: (t) => ({
      street: t.string({ nullable: true, resolve: (a) => a.street ?? null }),
      city: t.string({ nullable: true, resolve: (a) => a.city ?? null }),
      postal: t.string({ nullable: true, resolve: (a) => a.postal ?? null }),
      region: t.string({ nullable: true, resolve: (a) => a.region ?? null }),
      country: t.exposeString('country', { nullable: true }),
    }),
  })
  const Currency = builder.objectRef<ShopStoreRow['currencies'][number]>('ShopCurrency').implement({
    // convert: worked out from the pricing currency at the reference rate; manual: priced by hand (CATALOG facts 25–26).
    fields: (t) => ({ code: t.exposeString('currency'), mode: t.exposeString('mode') }),
  })
  const Market = builder.objectRef<ShopStoreRow['markets'][number]>('ShopMarket').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      parentId: t.exposeID('parent_id', { nullable: true }),
      name: t.exposeString('name'),
      primary: t.exposeBoolean('is_primary'),
      everywhereElse: t.exposeBoolean('is_fallback'),
      countries: t.exposeStringList('countries'),
      currency: t.exposeString('currency'),
      language: t.exposeString('language', { nullable: true }),
      // main: the store's address; path: the address plus /{pathPrefix}.
      webMode: t.exposeString('web_mode'),
      pathPrefix: t.exposeString('path_prefix', { nullable: true }),
    }),
  })
  const Store = builder.objectRef<ShopStoreRow>('ShopStore').implement({
    fields: (t) => ({
      name: t.exposeString('name'),
      description: t.exposeString('description', { nullable: true }),
      logo: t.field({ type: image, nullable: true, resolve: (s, _, ctx) => imageOf(ctx, s.logo_asset_id) }),
      // For collection in person and receipts.
      address: t.field({ type: Address, resolve: (s) => ({ ...s.address, country: s.country }) }),
      contactEmail: t.exposeString('contact_email', { nullable: true }),
      contactPhone: t.exposeString('contact_phone', { nullable: true }),
      timeZone: t.exposeString('time_zone', { nullable: true }),
      unitSystem: t.exposeString('unit_system'),
      pricingCurrency: t.exposeString('pricing_currency'),
      mainLanguage: t.exposeString('main_language'),
      pricesIncludeTax: t.exposeBoolean('tax_inclusive'),
      languages: t.exposeStringList('languages'),
      currencies: t.field({ type: [Currency], resolve: (s) => s.currencies }),
      markets: t.field({ type: [Market], resolve: (s) => s.markets }),
      // What this request reads in: the headers' choice when the store offers it, its defaults otherwise.
      language: t.string({ resolve: (_, __, ctx) => shopOf(ctx).shopper.language }),
      currency: t.string({ resolve: (_, __, ctx) => shopOf(ctx).shopper.currency }),
      marketId: t.id({ nullable: true, resolve: (_, __, ctx) => shopOf(ctx).shopper.marketId }),
    }),
  })
  const MenuItem = builder.objectRef<ShopMenuItem>('ShopMenuItem')
  MenuItem.implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      label: t.exposeString('label'),
      // collection, page (a path on this shop) or url (an https address).
      kind: t.exposeString('kind'),
      collectionSlug: t.exposeString('collectionSlug', { nullable: true }),
      url: t.exposeString('url', { nullable: true }),
      children: t.field({ type: [MenuItem], resolve: (i) => i.children }),
    }),
  })
  const Collection = builder.objectRef<ShopCollectionRow>('ShopCollection').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      slug: t.exposeString('slug'),
      description: t.exposeString('description'),
      image: t.field({ type: image, nullable: true, resolve: (c, _, ctx) => imageOf(ctx, c.image_asset_id) }),
      parentId: t.exposeID('parent_id', { nullable: true }),
      seoTitle: t.exposeString('seo_title', { nullable: true }),
      seoDescription: t.exposeString('seo_description', { nullable: true }),
    }),
  })
  const CollectionPage = builder.objectRef<Page<ShopCollectionRow>>('ShopCollectionPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [Collection], resolve: (p) => p.nodes }), pageInfo: t.field({ type: pageInfo, resolve: (p) => p.pageInfo }) }),
  })

  const access = { api: 'shop', scope: 'shop', permission: null } as const

  builder.queryFields((t) => ({
    store: t.field({ type: Store, nullable: true, extensions: { access }, resolve: (_, __, ctx) => catalogOf(ctx).store() }),
    menu: t.field({ type: [MenuItem], extensions: { access }, resolve: (_, __, ctx) => catalogOf(ctx).menu() }),
    collections: t.field({
      type: CollectionPage,
      args: { first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access },
      resolve: async (_, args, ctx) => {
        const page = await catalogOf(ctx).collections(args)
        if (!page.ok) throw new GraphQLError('That page cursor isn’t valid.', { extensions: { code: page.reason } })
        return page.value
      },
    }),
    collection: t.field({ type: Collection, nullable: true, args: { slug: t.arg.string({ required: true }) }, extensions: { access }, resolve: (_, args, ctx) => catalogOf(ctx).collection(args.slug) }),
  }))
}
