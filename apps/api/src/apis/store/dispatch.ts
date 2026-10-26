import { GraphQLError } from 'graphql'
import type { DeliveryRow } from '#db/scoped/dispatch'
import { riderSummary, selectOrderDeliveries } from '#db/scoped/dispatch'
import { withScope, withSystemScope } from '#db/scoped/index'
import { createDispatch, dispatchAudit } from '#engine/modules/ownDelivery/index'
import { tenantCaller, type StoreContext } from './access'
import type { StoreBuilder } from './builder'

const facts = (ctx: StoreContext) => {
  const caller = tenantCaller(ctx)
  if (!ctx.sql) throw new GraphQLError('Sign in.', { extensions: { code: 'UNAUTHENTICATED' } })
  return { sql: ctx.sql, context: caller.context, activity: ctx.activity, facts: ctx.facts, now: ctx.now }
}
export const orderDeliveryType = (builder: StoreBuilder) => {
  const Rider = builder.objectRef<NonNullable<Awaited<ReturnType<typeof riderSummary>>>>('DeliveryRider').implement({ fields: (t) => ({
    name: t.exposeString('name'), phone: t.exposeString('phone', { nullable: true }), photoAssetId: t.exposeID('photo_asset_id', { nullable: true }),
    vehicleType: t.exposeString('vehicle_type', { nullable: true }), vehicleNumber: t.exposeString('vehicle_number', { nullable: true }),
  }) })
  const Step = builder.objectRef<{ deliveryId: string; state: string; at: string }>('DeliveryStep').implement({ fields: (t) => ({
    deliveryId: t.exposeID('deliveryId'), state: t.exposeString('state'), at: t.exposeString('at'),
  }) })
  const Detail = builder.objectRef<DeliveryRow & { attempts: DeliveryRow[] }>('OrderDelivery').implement({ fields: (t) => ({
    id: t.exposeID('id'), state: t.exposeString('state'),
    rider: t.field({ type: Rider, nullable: true, resolve: async (d, _, ctx) => {
      const deps = facts(ctx)
      if (!d.rider_id || deps.context.sellerScope.kind === 'seller') return null
      const r = await withSystemScope(deps.sql, (tx) => riderSummary(tx, deps.context.storeId, d.rider_id ?? ''))
      return r && deps.context.caller.kind === 'support' ? { ...r, phone: null } : r
    } }),
    steps: t.field({ type: [Step], resolve: (d) => d.attempts.flatMap((a) => {
      const times = [['created', a.created_at], ['ready', a.ready_at], ['searching', a.searching_at], ['unassigned', a.unassigned_at], ['assigned', a.assigned_at], ['picked_up', a.picked_up_at], ['delivered', a.delivered_at], ['failed', a.failed_at], ['cancelled', a.cancelled_at]] as const
      return times.flatMap(([state, at]) => at ? [{ deliveryId: a.id, state, at: at.toISOString() }] : [])
    }).sort((a, b) => a.at.localeCompare(b.at)) }),
  }) })
  const read = async (ctx: StoreContext, orderId: string) => {
    const deps = facts(ctx)
    if (deps.context.sellerScope.kind === 'seller') return null
    const attempts = await withScope(deps.sql, deps.context, (tx) => selectOrderDeliveries(tx, deps.context.storeId, orderId))
    const latest = attempts[0]
    return latest ? { ...latest, attempts } : null
  }
  return { type: Detail, read }
}

export const registerDispatch = (builder: StoreBuilder) => {
  const access = { api: 'store', scope: 'store', permission: 'orders.fulfil', target: 'none' } as const
  builder.mutationFields((t) => ({
    markReadyForPickup: t.boolean({ args: { orderId: t.arg.id({ required: true }) }, extensions: { access: { ...access, audit: dispatchAudit.ready } }, resolve: (_, a, c) => createDispatch(facts(c)).ready(String(a.orderId)) }),
    assignDelivery: t.boolean({ args: { deliveryId: t.arg.id({ required: true }), riderId: t.arg.id({ required: true }) }, extensions: { access: { ...access, audit: dispatchAudit.assigned } }, resolve: (_, a, c) => createDispatch(facts(c)).assign(String(a.deliveryId), String(a.riderId)) }),
    offerDeliveryAgain: t.boolean({ args: { deliveryId: t.arg.id({ required: true }) }, extensions: { access: { ...access, audit: dispatchAudit.offered } }, resolve: (_, a, c) => createDispatch(facts(c)).again(String(a.deliveryId)) }),
    cancelDelivery: t.boolean({ args: { deliveryId: t.arg.id({ required: true }) }, extensions: { access: { ...access, audit: dispatchAudit.cancelled } }, resolve: (_, a, c) => createDispatch(facts(c)).cancel(String(a.deliveryId)) }),
  }))
}
