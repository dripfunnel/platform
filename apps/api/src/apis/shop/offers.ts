import type { ShopOfferView } from '#engine/modules/storefront/index'
import type { ShopBuilder } from './builder'
import { catalogOf } from './catalog'

// The store's offers for a storefront's banners (#1242; core's useOffers): automatic ones on now, never a code.

export const registerOffers = ({ builder }: ShopBuilder) => {
  const Scope = builder.enumType('ShopOfferScope', { values: ['PRODUCTS', 'ORDER', 'SHIPPING'] as const })
  const Offer = builder.objectRef<ShopOfferView>('ShopOffer').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      description: t.exposeString('description', { nullable: true }),
      // Null: it runs until the merchant ends it.
      endsAt: t.string({ nullable: true, resolve: (o) => o.endsAt?.toISOString() ?? null }),
      appliesTo: t.field({ type: Scope, resolve: (o) => (o.appliesTo === 'products' ? 'PRODUCTS' : o.appliesTo === 'shipping' ? 'SHIPPING' : 'ORDER') }),
      products: t.exposeStringList('products'),
      collections: t.exposeStringList('collections'),
    }),
  })

  builder.queryFields((t) => ({
    // At most 20, those ending soonest first.
    offers: t.field({ type: [Offer], extensions: { access: { api: 'shop', scope: 'shop', permission: null } }, resolve: (_, __, ctx) => catalogOf(ctx).offers() }),
  }))
}
