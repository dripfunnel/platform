import { GraphQLError } from 'graphql'
import { logEvent } from '#core/log'
import type { Page } from '#core/paging'
import type { PaymentStart } from '#core/payments'
import { appPaymentInput, checkoutAudit, createCheckout, type AppPaymentInput, type CheckoutResult, type PaymentOption, type PlacedOrder, type ShopOrderRow, type ShopOrderSummaryRow } from '#engine/modules/checkout/index'
import { downloadUrl } from '#engine/modules/deliveries/index'
import { paymentModeOf, shopOf, stripeTaxOf, type ShopContext } from './access'
import type { ShopBuilder } from './builder'
import { registerDelivery, trackingOf } from './delivery'

// Paying for a cart (FIRST-RELEASE §19 Shop API `paymentOptions`, `checkout`, `order`): the ways the store takes payment,
// placing the order with one, and the shopper's own order afterwards.

const words: Record<string, string> = {
  NOT_READY: 'There’s something to finish before you pay.',
  METHOD_UNAVAILABLE: 'This shop doesn’t take that payment.',
  ALREADY_PLACED: 'This order has already been placed.',
  OUT_OF_STOCK: 'Something in your cart has just sold out. Check your cart and try again.',
  NOT_FOUND: 'Your cart has expired. Add something to start again.',
  PAYMENT_UNAVAILABLE: 'We couldn’t reach the payment provider. Try again in a minute.',
  ALREADY_PAID: 'This order is already paid.',
  PAYMENT_PENDING: 'Your earlier payment is still going through. Check back in a few minutes.',
  MODE_MISMATCH: 'This order is paid for on the shop it was placed on.',
  PAYMENT_MISMATCH: 'The shop needs to check this payment before you pay again. Contact the shop.',
  NOT_PENDING: 'This order isn’t waiting for a card payment.',
  PHONE_REQUIRED: 'Add your mobile number to pay this way.',
  CART_CHANGED: 'Your cart changed while you were paying. Check it and pay again.',
  OFFER_CHANGED: 'An offer in your cart has just ended or been used up. Check your cart and pay again.',
  SIGNED_OUT: 'Sign in first.',
  INVALID_APP_PAYMENT: 'That app payment request isn’t valid.',
  INVALID_CURSOR: 'That page cursor isn’t valid.',
}

/** One technical log line for a refused checkout call: the operation and its reason, with the request and the store, and nothing of the cart, the amount or the shopper (LOGGING §9). A payment provider's failure reaches here as its refusal's code. */
const logRefusal = (ctx: ShopContext, operation: string, code: string): void =>
  logEvent({ event: 'checkout_refused', api: 'shop', requestId: ctx.facts.requestId, storeId: ctx.shopper?.context.storeId ?? null, code: `${operation}:${code}` })

const answered = <T>(ctx: ShopContext, operation: string, result: CheckoutResult<T>): T => {
  if (result.ok) return result.value
  logRefusal(ctx, operation, result.reason)
  throw new GraphQLError(words[result.reason] ?? words['NOT_READY'] ?? '', { extensions: { code: result.reason, ...(result.problems ? { problems: result.problems } : {}) } })
}

const appPaymentOf = (ctx: ShopContext, operation: string, input: { scheme: string; stripeApiVersion?: string | null | undefined } | null | undefined): AppPaymentInput | undefined => {
  if (!input) return undefined
  const parsed = appPaymentInput.safeParse(input)
  if (!parsed.success) {
    logRefusal(ctx, operation, 'INVALID_APP_PAYMENT')
    throw new GraphQLError(words['INVALID_APP_PAYMENT'] ?? '', { extensions: { code: 'INVALID_APP_PAYMENT' } })
  }
  return parsed.data
}

const checkoutOf = async (ctx: ShopContext) => {
  const { sql, shopper } = shopOf(ctx)
  const couriers = ctx.couriers ? await ctx.couriers.forPartner(shopper.context.partnerId) : null
  return createCheckout({
    sql,
    context: shopper.context,
    language: shopper.language,
    currency: shopper.currency,
    marketId: shopper.marketId,
    features: shopper.features,
    couriers,
    stripeTax: stripeTaxOf(ctx),
    activity: ctx.activity,
    facts: ctx.facts,
    now: ctx.now,
    country: shopper.country,
    mode: paymentModeOf(shopper),
    gateways: ctx.payments?.gateways ?? {},
    secrets: ctx.secrets ?? null,
    // Cashfree and PhonePe send the shopper back to the storefront's order page, which asks confirmPayment (#313).
    returnUrl: (orderId) => `${ctx.origin}/order/${orderId}/`,
  })
}

export const registerCheckout = (shop: ShopBuilder) => {
  const { builder, money, pageInfo } = shop
  const { Delivery } = registerDelivery(shop)
  const Option = builder.objectRef<PaymentOption>('ShopPaymentOption').implement({
    fields: (t) => ({
      // stripe, paypal, razorpay, cashfree, phonepe, cod or bank_transfer: what placeOrder takes.
      provider: t.exposeString('provider'),
      kind: t.exposeString('kind'),
      instructions: t.exposeString('instructions', { nullable: true }),
      // test on a preview storefront, live otherwise (decided 2026-10-05 on #284).
      mode: t.exposeString('mode'),
      // The provider's publishable key or client id, where its own button or field needs one.
      publicKey: t.exposeString('publicKey', { nullable: true }),
    }),
  })
  // Only what the storefront needs to take this payment: a client secret is the PaymentIntent's own, never a key.
  const Start = builder.objectRef<PaymentStart>('ShopPaymentStart').implement({
    fields: (t) => ({
      providerRef: t.exposeString('providerRef'),
      publicKey: t.exposeString('publicKey', { nullable: true }),
      accountId: t.exposeString('accountId', { nullable: true }),
      clientSecret: t.exposeString('clientSecret', { nullable: true }),
      sessionId: t.exposeString('sessionId', { nullable: true }),
      // PhonePe's page, or PayPal's approval page for the app.
      redirectUrl: t.exposeString('redirectUrl', { nullable: true }),
      // For the app's Stripe sheet, a signed-in shopper's only: their Customer and the ephemeral key's secret, which lasts an hour.
      customerId: t.exposeString('customerId', { nullable: true }),
      ephemeralKeySecret: t.exposeString('ephemeralKeySecret', { nullable: true }),
      // For the app's Razorpay, Cashfree and PhonePe sheets: what is due now, the storefront's mode (the SDK's environment),
      // and for PhonePe its own order id and the order token (publicKey is then the merchant id).
      amount: t.field({ type: money, nullable: true, resolve: (p) => p.amount ?? null }),
      mode: t.string({ nullable: true, resolve: (p) => p.mode ?? null }),
      providerOrderId: t.exposeString('providerOrderId', { nullable: true }),
      token: t.exposeString('token', { nullable: true }),
    }),
  })
  // What the shop app sends to pay with a provider's own sheet; web calls leave it out and nothing changes.
  const AppPayment = builder.inputType('ShopAppPaymentInput', {
    fields: (t) => ({ scheme: t.string({ required: true }), stripeApiVersion: t.string() }),
  })
  const Placed = builder.objectRef<PlacedOrder>('ShopPlacedOrder').implement({
    fields: (t) => ({
      orderId: t.exposeID('orderId'),
      number: t.exposeString('number'),
      total: t.field({ type: money, resolve: (p) => p.total }),
      provider: t.exposeString('provider'),
      // A transfer's bank details, to show with the order number.
      instructions: t.exposeString('instructions', { nullable: true }),
      // A card provider's payment to take now; null for the ways paid later.
      payment: t.field({ type: Start, nullable: true, resolve: (p) => p.payment }),
    }),
  })
  const OrderGift = builder.objectRef<NonNullable<ShopOrderRow['lines'][number]['gift']>>('ShopOrderGift').implement({
    fields: (t) => ({ recipientName: t.exposeString('recipientName'), recipientEmail: t.exposeString('recipientEmail'), sendOn: t.exposeString('sendOn', { nullable: true }) }),
  })
  type Download = ShopOrderRow['downloads'][number] & { url: string | null }
  const DownloadType = builder.objectRef<Download>('ShopOrderDownload').implement({
    fields: (t) => ({
      name: t.exposeString('name'),
      // Signed for this shop; null where links can't be signed here.
      url: t.exposeString('url', { nullable: true }),
      usesLeft: t.exposeInt('uses_left'),
      expiresAt: t.string({ resolve: (d) => new Date(d.expires_at).toISOString() }),
    }),
  })
  const Key = builder.objectRef<ShopOrderRow['keys'][number]>('ShopOrderLicenceKey').implement({ fields: (t) => ({ name: t.exposeString('name'), key: t.exposeString('key') }) })
  const Line = builder.objectRef<ShopOrderRow['lines'][number] & { currency: string }>('ShopOrderLine').implement({
    fields: (t) => ({
      name: t.exposeString('name'),
      gift: t.field({ type: OrderGift, nullable: true, resolve: (l) => l.gift }),
      versionName: t.exposeString('version_name', { nullable: true }),
      quantity: t.exposeInt('quantity'),
      unitPrice: t.field({ type: money, resolve: (l) => ({ amount: BigInt(l.unit_amount), currency: l.currency }) }),
      lineTotal: t.field({ type: money, resolve: (l) => ({ amount: BigInt(l.line_total_amount), currency: l.currency }) }),
    }),
  })
  const Discount = builder.objectRef<ShopOrderRow['discounts'][number] & { currency: string }>('ShopOrderDiscount').implement({
    fields: (t) => ({ name: t.exposeString('label', { nullable: true }), amount: t.field({ type: money, resolve: (d) => ({ amount: BigInt(d.amount), currency: d.currency }) }) }),
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
      // What the offers took off, delivery's included; `discounts` names each as the shopper saw it.
      discount: t.field({ type: money, resolve: (o) => ({ amount: BigInt(o.discount_amount), currency: o.currency }) }),
      discounts: t.field({ type: [Discount], resolve: (o) => o.discounts.map((d) => ({ ...d, currency: o.currency })) }),
      shipping: t.field({ type: money, resolve: (o) => ({ amount: BigInt(o.shipping_amount), currency: o.currency }) }),
      tax: t.field({ type: money, resolve: (o) => ({ amount: BigInt(o.tax_amount), currency: o.currency }) }),
      pricesIncludeTax: t.exposeBoolean('tax_inclusive'),
      total: t.field({ type: money, resolve: (o) => ({ amount: BigInt(o.total_amount), currency: o.currency }) }),
      // What a gift card paid of the total; the rest is the order's payment.
      giftCard: t.field({ type: money, resolve: (o) => ({ amount: BigInt(o.gift_card_amount), currency: o.currency }) }),
      // A paid order's downloads and the keys it took (CATALOG T14); none before payment.
      downloads: t.field({
        type: [DownloadType],
        resolve: async (o, _, ctx) => {
          const signer = ctx.downloadLinks ?? null
          const host = new URL(ctx.origin).host
          const storeId = ctx.shopper?.context.storeId ?? ''
          return Promise.all(o.downloads.map(async (d) => ({ ...d, url: signer ? await downloadUrl(signer, host, storeId, d.id) : null })))
        },
      }),
      licenceKeys: t.field({ type: [Key], resolve: (o) => o.keys }),
      // An own-delivery order's delivery, for its own customer or a guest with its token (DELIVERY §7); null for any other order.
      delivery: t.field({ type: Delivery, nullable: true, resolve: (o, _, ctx) => trackingOf(ctx).read(o.id) }),
    }),
  })
  // A row of the account's order history: only what the list shows, never an order's lines, downloads or keys.
  const Summary = builder.objectRef<ShopOrderSummaryRow>('ShopOrderSummary').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      number: t.exposeString('number'),
      state: t.exposeString('state'),
      paymentState: t.exposeString('payment_state'),
      paymentMethod: t.exposeString('payment_method', { nullable: true }),
      placedAt: t.string({ resolve: (o) => new Date(o.placed_at).toISOString() }),
      pricesIncludeTax: t.exposeBoolean('tax_inclusive'),
      itemCount: t.exposeInt('item_count'),
      total: t.field({ type: money, resolve: (o) => ({ amount: BigInt(o.total_amount), currency: o.currency }) }),
    }),
  })
  const SummaryPage = builder.objectRef<Page<ShopOrderSummaryRow>>('ShopOrderSummaryPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [Summary], resolve: (p) => p.nodes }), pageInfo: t.field({ type: pageInfo, resolve: (p) => p.pageInfo }) }),
  })

  const access = { api: 'shop', scope: 'shop', permission: null } as const

  builder.queryFields((t) => ({
    paymentOptions: t.field({ type: [Option], extensions: { access }, resolve: async (_, __, ctx) => (await checkoutOf(ctx)).options() }),
    // The shopper's own order: its account's, or a guest's with the cart token it was placed with.
    order: t.field({ type: Order, nullable: true, args: { id: t.arg.id({ required: true }) }, extensions: { access }, resolve: async (_, args, ctx) => (await checkoutOf(ctx)).order(String(args.id)) }),
    // The signed-in shopper's own orders, newest first, at most 50 a page; guest orders are never listed.
    orderHistory: t.field({
      type: SummaryPage,
      args: { first: t.arg.int(), after: t.arg.string() },
      extensions: { access },
      resolve: async (_, args, ctx) => {
        const page = await (await checkoutOf(ctx)).orderHistory(args)
        if (!page.ok) {
          logRefusal(ctx, 'orderHistory', page.reason)
          throw new GraphQLError(words[page.reason] ?? '', { extensions: { code: page.reason } })
        }
        return page.value
      },
    }),
  }))
  builder.mutationFields((t) => ({
    // "Pay": a ready cart becomes an order paid this way; refused as NOT_READY with `problems` until checkout is complete.
    placeOrder: t.field({
      type: Placed,
      args: { provider: t.arg.string({ required: true }), app: t.arg({ type: AppPayment }) },
      extensions: { access: { ...access, audit: checkoutAudit.placed } },
      resolve: async (_, args, ctx) => {
        if (args.provider.length > 40) {
          logRefusal(ctx, 'placeOrder', 'METHOD_UNAVAILABLE')
          throw new GraphQLError(words['METHOD_UNAVAILABLE'] ?? '', { extensions: { code: 'METHOD_UNAVAILABLE' } })
        }
        return answered(ctx, 'placeOrder', await (await checkoutOf(ctx)).place(args.provider, appPaymentOf(ctx, 'placeOrder', args.app)))
      },
    }),
    // Back from paying: the card payment read back from its provider, and the order as it is now.
    confirmPayment: t.field({
      type: Order,
      nullable: true,
      args: { orderId: t.arg.id({ required: true }) },
      extensions: { access: { ...access, unlogged: 'payment_return' } },
      resolve: async (_, args, ctx) => (await checkoutOf(ctx)).confirm(String(args.orderId)),
    }),
    // "Try again" after a declined card: a new attempt for the same order.
    payOrder: t.field({
      type: Start,
      args: { orderId: t.arg.id({ required: true }), app: t.arg({ type: AppPayment }) },
      extensions: { access: { ...access, audit: checkoutAudit.retried } },
      resolve: async (_, args, ctx) => answered(ctx, 'payOrder', await (await checkoutOf(ctx)).pay(String(args.orderId), appPaymentOf(ctx, 'payOrder', args.app))),
    }),
  }))
}
