import { GraphQLError } from 'graphql'
import { checkoutAudit, createCheckout, type CheckoutResult, type PaymentOption, type PlacedOrder, type ShopOrderRow } from '#engine/modules/checkout/index'
import { shopOf, type ShopContext } from './access'
import type { ShopBuilder } from './builder'

// Paying for a cart (FIRST-RELEASE §19 Shop API `paymentOptions`, `checkout`, `order`): the ways the store takes payment,
// placing the order with one, and the shopper's own order afterwards.

const words: Record<string, string> = {
  NOT_READY: 'There’s something to finish before you pay.',
  METHOD_UNAVAILABLE: 'This shop doesn’t take that payment.',
  ALREADY_PLACED: 'This order has already been placed.',
  OUT_OF_STOCK: 'Something in your cart has just sold out. Check your cart and try again.',
  NOT_FOUND: 'Your cart has expired. Add something to start again.',
  CART_CHANGED: 'Your cart changed while you were paying. Check it and pay again.',
}

const answered = <T>(result: CheckoutResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason] ?? words['NOT_READY'] ?? '', { extensions: { code: result.reason, ...(result.problems ? { problems: result.problems } : {}) } })
}

const checkoutOf = async (ctx: ShopContext) => {
  const { sql, shopper } = shopOf(ctx)
  const couriers = ctx.couriers ? await ctx.couriers.forPartner(shopper.context.partnerId) : null
  return createCheckout({ sql, context: shopper.context, language: shopper.language, currency: shopper.currency, marketId: shopper.marketId, features: shopper.features, couriers, activity: ctx.activity, facts: ctx.facts, now: ctx.now, country: shopper.country })
}

export const registerCheckout = ({ builder, money }: ShopBuilder) => {
  const Option = builder.objectRef<PaymentOption>('ShopPaymentOption').implement({
    fields: (t) => ({
      // stripe, paypal, razorpay, cashfree, phonepe, cod or bank_transfer: what placeOrder takes.
      provider: t.exposeString('provider'),
      kind: t.exposeString('kind'),
      instructions: t.exposeString('instructions', { nullable: true }),
      // test on a preview storefront, live otherwise (decided 2026-10-05 on #284).
      mode: t.exposeString('mode'),
    }),
  })
  const Placed = builder.objectRef<PlacedOrder>('ShopPlacedOrder').implement({
    fields: (t) => ({
      orderId: t.exposeID('orderId'),
      number: t.exposeString('number'),
      total: t.field({ type: money, resolve: (p) => p.total }),
      provider: t.exposeString('provider'),
      // A transfer's bank details, to show with the order number.
      instructions: t.exposeString('instructions', { nullable: true }),
    }),
  })
  const Line = builder.objectRef<ShopOrderRow['lines'][number] & { currency: string }>('ShopOrderLine').implement({
    fields: (t) => ({
      name: t.exposeString('name'),
      versionName: t.exposeString('version_name', { nullable: true }),
      quantity: t.exposeInt('quantity'),
      unitPrice: t.field({ type: money, resolve: (l) => ({ amount: BigInt(l.unit_amount), currency: l.currency }) }),
      lineTotal: t.field({ type: money, resolve: (l) => ({ amount: BigInt(l.line_total_amount), currency: l.currency }) }),
    }),
  })
  const Order = builder.objectRef<ShopOrderRow>('ShopOrder').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      number: t.exposeString('number'),
      // placed or cancelled.
      state: t.exposeString('state'),
      paymentState: t.exposeString('payment_state'),
      paymentMethod: t.exposeString('payment_method', { nullable: true }),
      placedAt: t.string({ resolve: (o) => new Date(o.placed_at).toISOString() }),
      paymentDueBy: t.string({ nullable: true, resolve: (o) => (o.payment_due_by ? new Date(o.payment_due_by).toISOString() : null) }),
      // courier, flat or pickup: the storefront words flat delivery and collection in the shopper's language.
      shippingOption: t.exposeString('shipping_option', { nullable: true }),
      // A courier's own service name, e.g. "Delhivery Surface"; null otherwise.
      shippingMethod: t.exposeString('shipping_method_label', { nullable: true }),
      lines: t.field({ type: [Line], resolve: (o) => o.lines.map((l) => ({ ...l, currency: o.currency })) }),
      subtotal: t.field({ type: money, resolve: (o) => ({ amount: BigInt(o.subtotal_amount), currency: o.currency }) }),
      shipping: t.field({ type: money, resolve: (o) => ({ amount: BigInt(o.shipping_amount), currency: o.currency }) }),
      tax: t.field({ type: money, resolve: (o) => ({ amount: BigInt(o.tax_amount), currency: o.currency }) }),
      pricesIncludeTax: t.exposeBoolean('tax_inclusive'),
      total: t.field({ type: money, resolve: (o) => ({ amount: BigInt(o.total_amount), currency: o.currency }) }),
    }),
  })

  const access = { api: 'shop', scope: 'shop', permission: null } as const

  builder.queryFields((t) => ({
    paymentOptions: t.field({ type: [Option], extensions: { access }, resolve: async (_, __, ctx) => (await checkoutOf(ctx)).options() }),
    // The shopper's own order: its account's, or a guest's with the cart token it was placed with.
    order: t.field({ type: Order, nullable: true, args: { id: t.arg.id({ required: true }) }, extensions: { access }, resolve: async (_, args, ctx) => (await checkoutOf(ctx)).order(String(args.id)) }),
  }))
  builder.mutationFields((t) => ({
    // "Pay": a ready cart becomes an order paid this way; refused as NOT_READY with `problems` until checkout is complete.
    placeOrder: t.field({
      type: Placed,
      args: { provider: t.arg.string({ required: true }) },
      extensions: { access: { ...access, audit: checkoutAudit.placed } },
      resolve: async (_, args, ctx) => {
        if (args.provider.length > 40) throw new GraphQLError(words['METHOD_UNAVAILABLE'] ?? '', { extensions: { code: 'METHOD_UNAVAILABLE' } })
        return answered(await (await checkoutOf(ctx)).place(args.provider))
      },
    }),
  }))
}
