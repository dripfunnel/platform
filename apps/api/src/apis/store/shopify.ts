import { GraphQLError } from 'graphql'
import { createShopifyService, shopifyAudit, catalogImportAudit, type ShopProduct, type ShopifyConnectionDto, type ShopifyRefusal } from '#engine/modules/catalog/index'
import { queueSideEffect } from '#saas/outbox/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import type { StoreBuilder } from './builder'

// Products › Import › Connect Shopify (CatImport, CATALOG K7): whoever imports (`catalog.import`) connects their
// own shop, the store's or a supplier's, picks products and imports them through the same check and run.

const words: Record<ShopifyRefusal, string> = {
  NOT_AVAILABLE: 'Connecting Shopify isn’t set up here. Import Shopify’s product CSV instead.',
  INVALID_SHOP: 'Enter your shop’s address, like your-shop.myshopify.com.',
  NOT_CONNECTED: 'Connect your Shopify shop first.',
  EXPIRED: 'Your Shopify connection has expired. Connect your shop again.',
  SHOPIFY_UNAVAILABLE: 'Shopify isn’t answering right now. Try again in a minute.',
  INVALID_INPUT: 'Pick between 1 and 250 products, or all of them.',
}

const refused = (reason: ShopifyRefusal) => new GraphQLError(words[reason], { extensions: { code: reason } })
const answered = <T>(result: { ok: true; value: T } | { ok: false; reason: ShopifyRefusal }): T => {
  if (!result.ok) throw refused(result.reason)
  return result.value
}

const access = { api: 'store', scope: 'store-seller', permission: 'catalog.import', target: 'none' } as const

const service = (ctx: StoreContext) => {
  if (!ctx.sql) throw forbidden()
  const caller = actingCaller(ctx)
  return createShopifyService({
    sql: ctx.sql,
    context: caller.context,
    actor: { id: caller.person.id, label: caller.person.name || caller.person.email, partnerId: caller.person.partnerId },
    activity: ctx.activity,
    facts: ctx.facts,
    now: ctx.now,
    shop: ctx.shopify ?? null,
    secrets: ctx.secrets ?? null,
    host: ctx.host ?? '',
    queue: (tx, kind, key, payload) => queueSideEffect(tx, { kind, idempotencyKey: key, payload, partnerId: caller.person.partnerId, storeId: caller.store.id }),
  })
}

export const registerShopify = (builder: StoreBuilder) => {
  const Connection = builder.objectRef<ShopifyConnectionDto>('ShopifyConnection').implement({
    fields: (t) => ({
      available: t.exposeBoolean('available'),
      // none, pending, connected or expired
      status: t.exposeString('status'),
      shop: t.exposeString('shop', { nullable: true }),
    }),
  })
  const Product = builder.objectRef<ShopProduct>('ShopifyProduct').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      title: t.exposeString('title'),
      // ACTIVE, DRAFT, ARCHIVED or UNLISTED, as Shopify says
      status: t.exposeString('status'),
      versions: t.int({ resolve: (p) => p.variants.length }),
      imageUrl: t.string({ nullable: true, resolve: (p) => p.images[0]?.url ?? null }),
    }),
  })
  const Page = builder.objectRef<{ products: ShopProduct[]; next: string | null }>('ShopifyProductPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [Product], resolve: (p) => p.products }), next: t.exposeString('next', { nullable: true }) }),
  })

  builder.queryFields((t) => ({
    shopifyConnection: t.field({ type: Connection, extensions: { access }, resolve: (_, __, ctx) => service(ctx).connection() }),
    shopifyProducts: t.field({
      type: Page,
      args: { after: t.arg.string(), search: t.arg.string() },
      extensions: { access },
      resolve: async (_, { after, search }, ctx) => answered(await service(ctx).products(after ?? null, search?.trim().slice(0, 100) || null)),
    }),
  }))

  builder.mutationFields((t) => ({
    // The address to send the person to, on Shopify, to approve the app.
    connectShopify: t.string({
      args: { shop: t.arg.string({ required: true }) },
      extensions: { access: { ...access, audit: shopifyAudit.connectStarted } },
      resolve: async (_, { shop }, ctx) => answered(await service(ctx).connect(shop)),
    }),
    // The callback's one-time key; answers the shop connected, for the person who started it only.
    finishShopifyConnect: t.string({
      args: { key: t.arg.string({ required: true }) },
      extensions: { access: { ...access, audit: shopifyAudit.connected } },
      resolve: async (_, { key }, ctx) => answered(await service(ctx).finish(key)),
    }),
    disconnectShopify: t.boolean({ extensions: { access: { ...access, audit: shopifyAudit.disconnected } }, resolve: async (_, __, ctx) => answered(await service(ctx).disconnect()) }),
    startShopifyImport: t.id({
      args: { productIds: t.arg.idList(), all: t.arg.boolean() },
      extensions: { access: { ...access, audit: catalogImportAudit.started } },
      resolve: async (_, { productIds, all }, ctx) => {
        if ((all === true) === (productIds !== null && productIds !== undefined)) throw refused('INVALID_INPUT')
        return answered(await service(ctx).startImport(all === true ? null : (productIds ?? []).map(String)))
      },
    }),
  }))
}
