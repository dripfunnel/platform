import { createRiderDevices, pushDeviceAudit, pushPlatforms, type ConfirmDevice } from '#engine/modules/ownDelivery/index'
import { queuePush } from '#saas/push/index'
import { answered } from './account'
import { riderOf, type DeliveryContext } from './access'
import type { DeliveryBuilder } from './builder'

// A rider's phones for push (DELIVERY §4, §6). The token is never answered back or logged.

const confirm: ConfirmDevice = async (tx, r) => {
  await queuePush(tx, { partnerId: r.partnerId, storeId: r.storeId, idempotencyKey: r.key, payload: { subject: { kind: 'rider', id: r.riderId }, message: 'rider.notifications_on' } })
}

const devicesOf = (ctx: DeliveryContext) => {
  const { sql, rider } = riderOf(ctx)
  return createRiderDevices({ sql, context: rider, activity: ctx.activity, facts: ctx.facts, confirm, now: ctx.now })
}

export const registerDevices = (builder: DeliveryBuilder) => {
  const PushPlatform = builder.enumType('PushPlatform', { values: pushPlatforms })
  const signedIn = { api: 'delivery', scope: 'rider', permission: null } as const

  builder.mutationFields((t) => ({
    // Again on every launch is fine: only a phone new to this rider is logged and gets the confirmation push.
    registerPushDevice: t.boolean({
      args: { token: t.arg.string({ required: true }), platform: t.arg({ type: PushPlatform, required: true }) },
      extensions: { access: { ...signedIn, audit: pushDeviceAudit.registered } },
      resolve: async (_, args, ctx) => answered<true>(await devicesOf(ctx).register({ token: args.token, platform: args.platform })),
    }),
    unregisterPushDevice: t.boolean({
      args: { token: t.arg.string({ required: true }) },
      extensions: { access: { ...signedIn, audit: pushDeviceAudit.removed } },
      resolve: async (_, args, ctx) => answered<true>(await devicesOf(ctx).unregister(args.token)),
    }),
  }))
}
