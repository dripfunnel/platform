import { GraphQLError } from 'graphql'
import { createShippingService, shippingAudit, type CourierView, type ShippingRefusal, type ShippingResult, type ShippingSettings } from '#engine/modules/shipping/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import type { StoreBuilder } from './builder'

// Settings › Shipping (SetOps): what the shopper pays, when it's free, where the store delivers, and its couriers on
// the partner's own accounts; the Owner's (`shipping.configure`). Carts price delivery through the same service (SAPI 9).

const words: Record<ShippingRefusal, string> = {
  INVALID_INPUT: 'Something here isn’t valid.',
  STALE: 'Someone else saved shipping since you opened it. Reload to see their changes.',
  NO_METHOD: 'Choose at least one way for shoppers to get their order.',
  NO_COURIER: 'Connect a courier below first.',
  NO_ADDRESS: 'Add your store’s address and postcode in Store info first: couriers quote from it.',
  NO_AREA_LIST: 'Upload your postcode list, or choose “Everywhere”.',
  TOO_MANY: 'That list is longer than a store can have. Keep it to 50,000 codes.',
  COURIER_NOT_OFFERED: 'This courier isn’t set up on your platform yet. Ask your platform’s support to connect it.',
  NOT_CONNECTED: 'Connect this courier first.',
  NOT_FOUND: 'That is no longer here.',
}

const answered = <T>(result: ShippingResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
}

export const registerShipping = (builder: StoreBuilder) => {
  const service = async (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    const couriers = ctx.couriers ? await ctx.couriers.forPartner(caller.person.partnerId) : null
    return createShippingService({ sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts, now: ctx.now, couriers })
  }

  const Courier = builder.objectRef<CourierView>('ShippingCourier').implement({
    fields: (t) => ({
      // shiprocket, usps, ups or fedex.
      provider: t.exposeString('provider'),
      // pricing, standby, failed (its login was refused) or off.
      status: t.exposeString('status'),
      offered: t.exposeBoolean('offered'),
      // scheduled (every working day) or on_request.
      pickupMode: t.exposeString('pickupMode'),
      labelSize: t.exposeString('labelSize'),
      trackingEmails: t.exposeBoolean('trackingEmails'),
      lastTestedAt: t.string({ nullable: true, resolve: (c) => (c.lastTestedAt ? new Date(c.lastTestedAt).toISOString() : null) }),
      lastTestResult: t.exposeString('lastTestResult', { nullable: true }),
    }),
  })
  const Settings = builder.objectRef<ShippingSettings>('ShippingSettings').implement({
    fields: (t) => ({
      revision: t.exposeInt('revision'),
      savedAt: t.string({ nullable: true, resolve: (s) => s.savedAt?.toISOString() ?? null }),
      // The amounts' currency: the pricing currency when they were saved.
      currency: t.exposeString('currency'),
      courierRate: t.exposeBoolean('courierRate'),
      flatRate: t.exposeBoolean('flatRate'),
      flatAmount: t.exposeString('flatAmount', { nullable: true }),
      pickup: t.exposeBoolean('pickup'),
      pickupHours: t.exposeString('pickupHours', { nullable: true }),
      pickupAddress: t.exposeString('pickupAddress', { nullable: true }),
      // never, always or over.
      freeMode: t.exposeString('freeMode'),
      freeThresholdAmount: t.exposeString('freeThresholdAmount', { nullable: true }),
      // everywhere or list.
      areaMode: t.exposeString('areaMode'),
      areaFileName: t.exposeString('areaFileName', { nullable: true }),
      areaCount: t.exposeInt('areaCount'),
      areaSample: t.exposeStringList('areaSample'),
      labelSizes: t.field({ type: ['String'], resolve: (s) => [...s.labelSizes] }),
      couriers: t.field({ type: [Courier], resolve: (s) => s.couriers }),
    }),
  })
  const TestResult = builder.objectRef<{ provider: string; result: string; ms: number }>('CourierTestResult').implement({
    fields: (t) => ({
      provider: t.exposeString('provider'),
      // ok, rejected, unavailable or unserved.
      result: t.exposeString('result'),
      ms: t.exposeInt('ms'),
    }),
  })
  const Input = builder.inputType('ShippingInput', {
    fields: (t) => ({
      courierRate: t.boolean({ required: true }),
      flatRate: t.boolean({ required: true }),
      flatAmount: t.string(),
      pickup: t.boolean({ required: true }),
      pickupHours: t.string(),
      freeMode: t.string({ required: true }),
      freeThresholdAmount: t.string(),
      areaMode: t.string({ required: true }),
    }),
  })
  const OptionsInput = builder.inputType('CourierOptionsInput', {
    fields: (t) => ({ pickupMode: t.string({ required: true }), labelSize: t.string({ required: true }), trackingEmails: t.boolean({ required: true }) }),
  })

  const access = { api: 'store', scope: 'store', permission: 'shipping.configure', target: 'none' } as const
  const bounded = (...values: string[]) => {
    if (values.some((v) => v.length > 200)) throw new GraphQLError(words.INVALID_INPUT, { extensions: { code: 'INVALID_INPUT' } })
  }

  builder.queryFields((t) => ({
    shippingSettings: t.field({ type: Settings, extensions: { access }, resolve: async (_, __, ctx) => (await service(ctx)).settings() }),
  }))

  builder.mutationFields((t) => ({
    saveShipping: t.int({
      args: { revision: t.arg.int({ required: true }), input: t.arg({ type: Input, required: true }) },
      extensions: { access: { ...access, audit: shippingAudit.saved } },
      resolve: async (_, args, ctx) => {
        bounded(args.input.flatAmount ?? '', args.input.pickupHours ?? '', args.input.freeThresholdAmount ?? '', args.input.freeMode, args.input.areaMode)
        return answered(await (await service(ctx)).save(args.revision, args.input))
      },
    }),
    // "Upload list": the codes read from the merchant's file, replacing the list; answers how many were kept.
    replaceDeliveryArea: t.int({
      args: { fileName: t.arg.string({ required: true }), codes: t.arg.stringList({ required: true }) },
      extensions: { access: { ...access, audit: shippingAudit.areaReplaced } },
      resolve: async (_, args, ctx) => {
        if (args.codes.length > 50_000 || args.codes.some((c) => c.length > 20)) throw new GraphQLError(words.TOO_MANY, { extensions: { code: 'TOO_MANY' } })
        bounded(args.fileName)
        return answered(await (await service(ctx)).replaceArea(args.fileName, args.codes))
      },
    }),
    // Answers the courier's role: pricing when no other courier prices orders, otherwise standby.
    connectCourier: t.string({
      args: { provider: t.arg.string({ required: true }) },
      extensions: { access: { ...access, audit: shippingAudit.courierConnected } },
      resolve: async (_, args, ctx) => {
        bounded(args.provider)
        return answered(await (await service(ctx)).connect(args.provider))
      },
    }),
    useCourierForPricing: t.boolean({
      args: { provider: t.arg.string({ required: true }) },
      extensions: { access: { ...access, audit: shippingAudit.courierPricing } },
      resolve: async (_, args, ctx) => {
        bounded(args.provider)
        return answered(await (await service(ctx)).usePricing(args.provider))
      },
    }),
    // Answers the courier that prices orders now, if one took over.
    disconnectCourier: t.string({
      nullable: true,
      args: { provider: t.arg.string({ required: true }) },
      extensions: { access: { ...access, audit: shippingAudit.courierDisconnected } },
      resolve: async (_, args, ctx) => {
        bounded(args.provider)
        return answered(await (await service(ctx)).disconnect(args.provider))
      },
    }),
    saveCourierOptions: t.boolean({
      args: { provider: t.arg.string({ required: true }), input: t.arg({ type: OptionsInput, required: true }) },
      extensions: { access: { ...access, audit: shippingAudit.courierOptions } },
      resolve: async (_, args, ctx) => {
        bounded(args.provider, args.input.pickupMode, args.input.labelSize)
        return answered(await (await service(ctx)).saveOptions(args.provider, args.input))
      },
    }),
    testCouriers: t.field({
      type: [TestResult],
      extensions: { access: { ...access, audit: shippingAudit.couriersTested } },
      resolve: async (_, __, ctx) => answered(await (await service(ctx)).test()),
    }),
  }))
}
