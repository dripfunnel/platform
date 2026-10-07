import { GraphQLError } from 'graphql'
import { createCartService, type CartAddress, type CartChange, type CartLineView, type CartRefusal, type CartResult, type CartView } from '#engine/modules/cart/index'
import type { DeliveryOption } from '#engine/modules/shipping/index'
import { shopOf, type ShopContext } from './access'
import type { ShopBuilder } from './builder'
import { assetUrl } from './catalog'

// The cart and checkout up to payment (FIRST-RELEASE §19 Shop API; PLATFORM-PROMPT §5.4): the storefront sends what the
// shopper chose; every price, tax and delivery charge it gets back is the engine's.

const words: Record<CartRefusal, string> = {
  INVALID_INPUT: 'Something here isn’t valid.',
  UNAVAILABLE: 'That isn’t available any more.',
  TOO_MANY_LINES: 'Your cart is full. Remove something to add this.',
  NO_CART: 'Your cart has expired. Add something to start again.',
  NOT_READY: 'There’s something to finish before you pay.',
}

const answered = <T>(result: CartResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason, ...(result.problems ? { problems: result.problems } : {}) } })
}

export const cartOf = async (ctx: ShopContext) => {
  const { sql, shopper } = shopOf(ctx)
  const couriers = ctx.couriers ? await ctx.couriers.forPartner(shopper.context.partnerId) : null
  return createCartService({ sql, context: shopper.context, language: shopper.language, currency: shopper.currency, marketId: shopper.marketId, features: shopper.features, couriers, activity: ctx.activity, facts: ctx.facts, now: ctx.now })
}

export const registerCart = ({ builder, money: Money_ }: ShopBuilder) => {
  const Address = builder.objectRef<CartAddress>('ShopAddressLines').implement({
    fields: (t) => ({
      name: t.exposeString('name'),
      line1: t.exposeString('line1'),
      line2: t.exposeString('line2', { nullable: true }),
      city: t.exposeString('city'),
      region: t.exposeString('region', { nullable: true }),
      postalCode: t.exposeString('postalCode', { nullable: true }),
      country: t.exposeString('country'),
      phone: t.exposeString('phone', { nullable: true }),
    }),
  })
  const Line = builder.objectRef<CartLineView>('ShopCartLine').implement({
    fields: (t) => ({
      versionId: t.exposeID('versionId'),
      quantity: t.exposeInt('quantity'),
      productName: t.string({ nullable: true, resolve: (l) => l.item?.product.name ?? null }),
      productSlug: t.string({ nullable: true, resolve: (l) => l.item?.product.slug ?? null }),
      versionName: t.string({ nullable: true, resolve: (l) => l.item?.version.name ?? null }),
      photoUrl: t.string({
        nullable: true,
        resolve: (l, _, ctx) => {
          const photo = l.item?.product.photos.find((p) => p.versionId === l.versionId) ?? l.item?.product.photos[0]
          return photo ? assetUrl(ctx, photo.assetId) : null
        },
      }),
      unitPrice: t.field({ type: Money_, nullable: true, resolve: (l) => l.unitPrice }),
      lineTotal: t.field({ type: Money_, nullable: true, resolve: (l) => l.lineTotal }),
      available: t.exposeInt('available', { nullable: true }),
      // unavailable, not_sold_here, not_priced or short (more than is left); null when it can be bought.
      problem: t.exposeString('problem', { nullable: true }),
    }),
  })
  const Option = builder.objectRef<DeliveryOption>('ShopDeliveryOption').implement({
    fields: (t) => ({
      // courier, flat or pickup: what setShippingOption takes.
      id: t.exposeString('id'),
      provider: t.exposeString('provider', { nullable: true }),
      service: t.exposeString('service', { nullable: true }),
      amount: t.field({ type: Money_, resolve: (o) => o.amount }),
      // What it would have cost, when delivery is free.
      before: t.field({ type: Money_, nullable: true, resolve: (o) => o.before }),
      minDays: t.exposeInt('minDays', { nullable: true }),
      maxDays: t.exposeInt('maxDays', { nullable: true }),
      hours: t.exposeString('hours', { nullable: true }),
    }),
  })
  const Tax = builder.objectRef<NonNullable<CartView['tax']>>('ShopCartTax').implement({
    fields: (t) => ({ amount: t.field({ type: Money_, resolve: (x) => x.amount }), pricesIncludeTax: t.exposeBoolean('inclusive') }),
  })
  const Cart = builder.objectRef<CartView>('ShopCart').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      currency: t.exposeString('currency'),
      email: t.exposeString('email', { nullable: true }),
      phone: t.exposeString('phone', { nullable: true }),
      note: t.exposeString('note', { nullable: true }),
      shippingAddress: t.field({ type: Address, nullable: true, resolve: (c) => c.shippingAddress }),
      billingAddress: t.field({ type: Address, nullable: true, resolve: (c) => c.billingAddress }),
      shippingOption: t.exposeString('shippingOption', { nullable: true }),
      checkoutStep: t.exposeString('checkoutStep', { nullable: true }),
      lines: t.field({ type: [Line], resolve: (c) => c.lines }),
      subtotal: t.field({ type: Money_, resolve: (c) => c.subtotal }),
      deliverable: t.exposeBoolean('deliverable', { nullable: true }),
      shippingOptions: t.field({ type: [Option], resolve: (c) => c.shippingOptions }),
      shipping: t.field({ type: Money_, nullable: true, resolve: (c) => c.shipping }),
      tax: t.field({ type: Tax, nullable: true, resolve: (c) => c.tax }),
      total: t.field({ type: Money_, resolve: (c) => c.total }),
      // EMPTY, LINE_PROBLEM, NO_CONTACT, NO_ADDRESS, NO_SHIPPING, SHIPPING_UNAVAILABLE, TAX_UNAVAILABLE.
      problems: t.stringList({ resolve: (c) => c.problems }),
      readyToPay: t.boolean({ resolve: (c) => c.problems.length === 0 && c.checkoutStep === 'pay' }),
    }),
  })
  const Change = builder.objectRef<CartChange>('ShopCartChange').implement({
    fields: (t) => ({
      cart: t.field({ type: Cart, resolve: (c) => c.cart }),
      // A new guest cart's token, given once: send it back as X-Shop-Cart.
      cartToken: t.exposeString('token', { nullable: true }),
    }),
  })
  const AddressInput = builder.inputType('ShopAddressInput', {
    fields: (t) => ({
      name: t.string({ required: true }),
      line1: t.string({ required: true }),
      line2: t.string(),
      city: t.string({ required: true }),
      region: t.string(),
      postalCode: t.string(),
      country: t.string({ required: true }),
      phone: t.string(),
    }),
  })

  const read = { api: 'shop', scope: 'shop', permission: null } as const
  // LOGGING §3 records a shopper's account events and orders, never carts.
  const write = { ...read, unlogged: 'LOGGING §3: carts are not recorded' } as const
  const bounded = (...values: (string | null | undefined)[]) => {
    if (values.some((v) => (v?.length ?? 0) > 300)) throw new GraphQLError(words.INVALID_INPUT, { extensions: { code: 'INVALID_INPUT' } })
  }

  builder.queryFields((t) => ({
    cart: t.field({ type: Cart, nullable: true, extensions: { access: read }, resolve: async (_, __, ctx) => (await cartOf(ctx)).cart() }),
  }))

  builder.mutationFields((t) => ({
    addToCart: t.field({
      type: Change,
      args: { versionId: t.arg.id({ required: true }), quantity: t.arg.int({ required: true }) },
      extensions: { access: write },
      resolve: async (_, args, ctx) => answered(await (await cartOf(ctx)).add(String(args.versionId), args.quantity)),
    }),
    setCartQuantity: t.field({
      type: Change,
      args: { versionId: t.arg.id({ required: true }), quantity: t.arg.int({ required: true }) },
      extensions: { access: write },
      resolve: async (_, args, ctx) => answered(await (await cartOf(ctx)).setQuantity(String(args.versionId), args.quantity)),
    }),
    setCartContact: t.field({
      type: Change,
      args: { email: t.arg.string(), phone: t.arg.string(), note: t.arg.string() },
      extensions: { access: write },
      resolve: async (_, args, ctx) => {
        if ((args.note?.length ?? 0) > 1000) throw new GraphQLError(words.INVALID_INPUT, { extensions: { code: 'INVALID_INPUT' } })
        bounded(args.email, args.phone)
        return answered(await (await cartOf(ctx)).setContact(args))
      },
    }),
    setShippingAddress: t.field({
      type: Change,
      args: { address: t.arg({ type: AddressInput, required: true }) },
      extensions: { access: write },
      resolve: async (_, args, ctx) => {
        bounded(...Object.values(args.address))
        return answered(await (await cartOf(ctx)).setShippingAddress(args.address))
      },
    }),
    // Null bills the delivery address.
    setBillingAddress: t.field({
      type: Change,
      args: { address: t.arg({ type: AddressInput }) },
      extensions: { access: write },
      resolve: async (_, args, ctx) => {
        bounded(...Object.values(args.address ?? {}))
        return answered(await (await cartOf(ctx)).setBillingAddress(args.address ?? null))
      },
    }),
    setShippingOption: t.field({
      type: Change,
      args: { option: t.arg.string({ required: true }) },
      extensions: { access: write },
      resolve: async (_, args, ctx) => answered(await (await cartOf(ctx)).setShippingOption(args.option)),
    }),
    // "Continue to payment": refused as NOT_READY with `problems` in its extensions until everything is in place.
    checkout: t.field({ type: Cart, extensions: { access: write }, resolve: async (_, __, ctx) => answered(await (await cartOf(ctx)).checkout()) }),
  }))
}
