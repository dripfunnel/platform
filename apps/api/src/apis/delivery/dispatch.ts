import { GraphQLError } from 'graphql'
import { pageOf, pageWindow, type Page } from '#core/paging'
import type { OfferView } from '#db/scoped/dispatch'
import { createDispatch, dispatchAudit } from '#engine/modules/ownDelivery/index'
import { withDispatchCode } from '../graphql/dispatchRefusals'
import { riderOf, type DeliveryContext } from './access'
import type { DeliveryBuilder } from './builder'

const service = (ctx: DeliveryContext) => {
  const { sql, rider } = riderOf(ctx)
  return createDispatch({ sql, context: rider, activity: ctx.activity, facts: ctx.facts, now: ctx.now })
}
export const registerDispatch = (builder: DeliveryBuilder) => {
  const access = { api: 'delivery', scope: 'rider', permission: null } as const
  const Info = builder.objectRef<Page<OfferView>['pageInfo']>('OfferPageInfo').implement({ fields: (t) => ({
    startCursor: t.exposeString('startCursor', { nullable: true }), endCursor: t.exposeString('endCursor', { nullable: true }),
    hasPreviousPage: t.exposeBoolean('hasPreviousPage'), hasNextPage: t.exposeBoolean('hasNextPage'),
  }) })
  const Offer = builder.objectRef<OfferView>('DeliveryOffer').implement({ fields: (t) => ({
    id: t.exposeID('id'), deliveryId: t.exposeID('delivery_id'), warehouse: t.exposeString('warehouse_name'),
    distanceM: t.exposeFloat('distance_m'), itemCount: t.exposeInt('item_count'), area: t.exposeString('area'),
    expiresAt: t.string({ resolve: (o) => o.expires_at.toISOString() }),
    sentAt: t.string({ resolve: (o) => o.sent_at.toISOString() }),
  }) })
  const Offers = builder.objectRef<Page<OfferView>>('DeliveryOfferPage').implement({ fields: (t) => ({
    nodes: t.field({ type: [Offer], resolve: (p) => p.nodes }), pageInfo: t.field({ type: Info, resolve: (p) => p.pageInfo }),
  }) })
  builder.queryFields((t) => ({ offers: t.field({
    type: Offers, args: { first: t.arg.int(), after: t.arg.string() }, extensions: { access },
    resolve: async (_, args, ctx) => {
      const p = pageWindow({ first: args.first ?? 20, after: args.after }, 50)
      if (!p.ok) throw new GraphQLError('That page link is invalid.', { extensions: { code: p.code } })
      return pageOf(await withDispatchCode(() => service(ctx).offers(p.window)), p.window, (o) => ({ id: o.id, occurredAt: o.sent_at }))
    },
  }) }))
  builder.mutationFields((t) => ({
    setOnline: t.boolean({ args: { online: t.arg.boolean({ required: true }) }, extensions: { access: { ...access, audit: dispatchAudit.online } }, resolve: (_, a, c) => withDispatchCode(() => service(c).online(a.online)) }),
    reportPosition: t.boolean({
      args: { lat: t.arg.float({ required: true }), lng: t.arg.float({ required: true }), accuracy: t.arg.float({ required: true }), at: t.arg.string({ required: true }) },
      extensions: { access: { ...access, unlogged: 'rider_position' } }, resolve: (_, a, c) => withDispatchCode(() => service(c).report(a)),
    }),
    acceptOffer: t.boolean({ args: { id: t.arg.id({ required: true }) }, extensions: { access: { ...access, audit: dispatchAudit.accepted } }, resolve: (_, a, c) => withDispatchCode(() => service(c).answer(String(a.id), true)) }),
    declineOffer: t.boolean({ args: { id: t.arg.id({ required: true }) }, extensions: { access: { ...access, audit: dispatchAudit.declined } }, resolve: (_, a, c) => withDispatchCode(() => service(c).answer(String(a.id), false)) }),
  }))
}
