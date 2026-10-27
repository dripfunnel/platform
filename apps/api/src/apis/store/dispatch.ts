import { GraphQLError } from 'graphql'
import { storeRoleHas } from '#auth/storePermissions'
import { carryAudit, createCarry, createDispatch, dispatchAudit, readOrderDelivery, type DeliveryRiderView, type DeliveryStepView, type OrderDeliveryView } from '#engine/modules/ownDelivery/index'
import { carryPorts } from '../graphql/carryPorts'
import { withDispatchCode } from '../graphql/dispatchRefusals'
import { actingCaller, tenantCaller, type StoreContext } from './access'
import type { StoreBuilder } from './builder'

const facts = (ctx: StoreContext) => {
  const caller = tenantCaller(ctx)
  if (!ctx.sql) throw new GraphQLError('Sign in.', { extensions: { code: 'UNAUTHENTICATED' } })
  return { sql: ctx.sql, context: caller.context, activity: ctx.activity, facts: ctx.facts, now: ctx.now, secrets: ctx.secrets ?? null }
}
export const orderDeliveryType = (builder: StoreBuilder) => {
  const Rider = builder.objectRef<DeliveryRiderView>('DeliveryRider').implement({ fields: (t) => ({
    name: t.exposeString('name'), phone: t.exposeString('phone', { nullable: true }), photoAssetId: t.exposeID('photo_asset_id', { nullable: true }),
    vehicleType: t.exposeString('vehicle_type', { nullable: true }), vehicleNumber: t.exposeString('vehicle_number', { nullable: true }),
  }) })
  const Step = builder.objectRef<DeliveryStepView>('DeliveryStep').implement({ fields: (t) => ({
    deliveryId: t.exposeID('deliveryId'), state: t.exposeString('state'), at: t.string({ resolve: (s) => s.at.toISOString() }),
  }) })
  const Detail = builder.objectRef<OrderDeliveryView>('OrderDelivery').implement({ fields: (t) => ({
    id: t.exposeID('id'), state: t.exposeString('state'),
    rider: t.field({ type: Rider, nullable: true, resolve: (d) => d.rider }),
    steps: t.field({ type: [Step], resolve: (d) => d.steps }),
    failedReason: t.exposeString('failedReason', { nullable: true }), failedNote: t.exposeString('failedNote', { nullable: true }),
    cashCollectedAt: t.string({ nullable: true, description: 'When the rider said the cash was collected.', resolve: (d) => d.cashCollectedAt?.toISOString() ?? null }),
    codeUnconfirmedAt: t.string({ nullable: true, resolve: (d) => d.codeUnconfirmedAt?.toISOString() ?? null }),
    codeLocked: t.exposeBoolean('codeLocked'),
  }) })
  const read = (ctx: StoreContext, orderId: string) => {
    const deps = facts(ctx)
    return readOrderDelivery(deps.sql, deps.context, orderId)
  }
  return { type: Detail, read }
}

export const registerDispatch = (builder: StoreBuilder) => {
  const access = { api: 'store', scope: 'store', permission: 'orders.fulfil', target: 'none' } as const
  builder.mutationFields((t) => ({
    markReadyForPickup: t.boolean({ args: { orderId: t.arg.id({ required: true }) }, extensions: { access: { ...access, audit: dispatchAudit.ready } }, resolve: (_, a, c) => withDispatchCode(() => createDispatch(facts(c)).ready(String(a.orderId))) }),
    assignDelivery: t.boolean({ args: { deliveryId: t.arg.id({ required: true }), riderId: t.arg.id({ required: true }) }, extensions: { access: { ...access, audit: dispatchAudit.assigned } }, resolve: (_, a, c) => withDispatchCode(() => createDispatch(facts(c)).assign(String(a.deliveryId), String(a.riderId))) }),
    offerDeliveryAgain: t.boolean({ args: { deliveryId: t.arg.id({ required: true }) }, extensions: { access: { ...access, audit: dispatchAudit.offered } }, resolve: (_, a, c) => withDispatchCode(() => createDispatch(facts(c)).again(String(a.deliveryId))) }),
    // Only a locked or unconfirmed code; cash received marks the order paid, which also needs orders.mark_paid (DELIVERY §8).
    markDeliveryDelivered: t.boolean({
      args: { deliveryId: t.arg.id({ required: true }), reason: t.arg.string({ required: true }), cashReceived: t.arg.boolean() },
      extensions: { access: { ...access, audit: carryAudit.delivered } },
      resolve: (_, a, c) => {
        const caller = tenantCaller(c)
        const payer = c.standing.kind === 'acting' && storeRoleHas(actingCaller(c).role, 'orders.mark_paid') ? caller.actor.id : null
        return withDispatchCode(() => createCarry({ ...facts(c), ports: carryPorts }).merchantDelivered({ id: String(a.deliveryId).toLowerCase(), reason: a.reason, cashReceived: a.cashReceived ?? null }, payer))
      },
    }),
    cancelDelivery: t.boolean({ args: { deliveryId: t.arg.id({ required: true }) }, extensions: { access: { ...access, audit: dispatchAudit.cancelled } }, resolve: (_, a, c) => withDispatchCode(() => createDispatch(facts(c)).cancel(String(a.deliveryId))) }),
  }))
}
