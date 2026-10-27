import { GraphQLError } from 'graphql'
import { createShopDevices, createTracking, pushPlatforms, shopDeviceAudit, type ShopDevicesResult, type TrackingView } from '#engine/modules/ownDelivery/index'
import { shopOf, type ShopContext } from './access'
import type { ShopBuilder } from './builder'
import { assetUrl } from './catalog'

// Following an own delivery (DELIVERY §7) and the phones its pushes reach (§6), for the order's own customer or a guest with its token.

const words: Record<string, string> = {
  SIGNED_OUT: 'Sign in first.',
  INVALID_INPUT: 'Something here isn’t valid.',
  NOT_FOUND: 'That order isn’t here.',
}

const answered = (result: ShopDevicesResult): true => {
  if (result.ok) return true
  throw new GraphQLError(words[result.reason] ?? '', { extensions: { code: result.reason } })
}

export const trackingOf = (ctx: ShopContext) => {
  const { sql, shopper } = shopOf(ctx)
  return createTracking({ sql, context: shopper.context, secrets: ctx.secrets ?? null, estimates: ctx.estimates === true, now: ctx.now })
}

const devicesOf = (ctx: ShopContext) => {
  const { sql, shopper } = shopOf(ctx)
  return createShopDevices({ sql, context: shopper.context, activity: ctx.activity, facts: ctx.facts, now: ctx.now })
}

const iso = (at: Date): string => at.toISOString()

/** The `delivery` an order answers, and the mutations that register a phone for its pushes. */
export const registerDelivery = ({ builder }: ShopBuilder) => {
  const Step = builder.objectRef<TrackingView['steps'][number]>('ShopDeliveryStep').implement({
    // packing, searching, unassigned, assigned, picked_up, delivered, failed or cancelled: the clients word them.
    fields: (t) => ({ state: t.exposeString('state'), at: t.string({ resolve: (s) => iso(s.at) }) }),
  })
  const Rider = builder.objectRef<NonNullable<TrackingView['rider']>>('ShopDeliveryRider').implement({
    fields: (t) => ({
      firstName: t.exposeString('firstName'),
      phone: t.exposeString('phone', { nullable: true }),
      photoUrl: t.string({ nullable: true, resolve: (r, _, ctx) => (r.photoAssetId ? assetUrl(ctx, r.photoAssetId) : null) }),
      vehicleType: t.exposeString('vehicleType', { nullable: true }),
      vehicleNumber: t.exposeString('vehicleNumber', { nullable: true }),
    }),
  })
  const Position = builder.objectRef<NonNullable<TrackingView['position']>>('ShopDeliveryPosition').implement({
    fields: (t) => ({ latitude: t.exposeFloat('latitude'), longitude: t.exposeFloat('longitude'), reportedAt: t.string({ resolve: (p) => iso(p.reportedAt) }) }),
  })
  const Delivery = builder.objectRef<TrackingView>('ShopDelivery').implement({
    fields: (t) => ({
      state: t.exposeString('state'),
      steps: t.field({ type: [Step], resolve: (d) => d.steps }),
      // Only while assigned or picked up; gone once the delivery ends.
      rider: t.field({ type: Rider, nullable: true, resolve: (d) => d.rider }),
      // Only while picked up, and the arrival estimate only where one can be made.
      position: t.field({ type: Position, nullable: true, resolve: (d) => d.position }),
      etaAt: t.string({ nullable: true, resolve: (d) => (d.etaAt ? iso(d.etaAt) : null) }),
      // Only to the order's own reader, while assigned or picked up; never in a push or an email (DELIVERY §3).
      handoverCode: t.exposeString('handoverCode', { nullable: true }),
    }),
  })

  const PushPlatform = builder.enumType('ShopPushPlatform', { values: pushPlatforms })
  const access = { api: 'shop', scope: 'shop', permission: null } as const

  builder.mutationFields((t) => ({
    // A guest names the order, and must hold its token; a signed-in customer's phone is theirs for every order. Again on every launch is fine.
    registerPushDevice: t.boolean({
      args: { token: t.arg.string({ required: true }), platform: t.arg({ type: PushPlatform, required: true }), orderId: t.arg.id() },
      extensions: { access: { ...access, audit: shopDeviceAudit.registered } },
      resolve: async (_, args, ctx) => answered(await devicesOf(ctx).register({ token: args.token, platform: args.platform, orderId: args.orderId == null ? null : String(args.orderId) })),
    }),
    unregisterPushDevice: t.boolean({
      args: { token: t.arg.string({ required: true }), orderId: t.arg.id() },
      extensions: { access: { ...access, audit: shopDeviceAudit.removed } },
      resolve: async (_, args, ctx) => answered(await devicesOf(ctx).unregister({ token: args.token, orderId: args.orderId == null ? null : String(args.orderId) })),
    }),
  }))

  return { Delivery }
}
