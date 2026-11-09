import { GraphQLError } from 'graphql'
import { createCartService, type AnswerInput, type CartAddress, type CartGift, type CartChange, type CartLineView, type CartRefusal, type CartResult, type CartView, type CustomisationQuote, type PricedAnswer } from '#engine/modules/cart/index'
import { findGiftCard, type GiftCardView } from '#engine/modules/giftCards/index'
import type { DeliveryOption } from '#engine/modules/shipping/index'
import { limitCodeTries, shopOf, stripeTaxOf, type ShopContext } from './access'
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
  RATE_LIMITED: 'Too many new carts from here. Wait a minute and try again.',
  TOO_MANY_CODES: 'Your cart already holds five codes. Remove one to add another.',
  GIFT_CARD_INVALID: 'That number doesn’t match a gift card. Check it and try again.',
  NOT_IN_PREVIEW: 'Gift cards can’t be used on a preview of the shop.',
  ANSWERS_INVALID: 'Check your choices: something isn’t answered or can’t be chosen now.',
  FILE_TYPE: 'That file isn’t one this question takes.',
  FILE_TOO_LARGE: 'That file is over 10 MB.',
  UNKNOWN_QUESTION: 'That question isn’t here any more.',
  TOO_MANY_UPLOADS: 'Your cart already holds 50 files.',
  UPLOAD_NOT_FOUND: 'That file isn’t in your cart.',
  UPLOAD_IN_USE: 'That file is part of an item in your cart.',
}

const answered = <T>(result: CartResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason, ...(result.problems ? { problems: result.problems } : {}), ...(result.answers ? { problems: result.answers } : {}) } })
}

/** Gift card numbers tried per store and address, so a script can't walk the space. */
const giftCardAttempt = (ctx: ShopContext) => limitCodeTries(ctx, 'gift-card', 'Too many numbers tried. Wait a minute and try again.')

export const cartOf = async (ctx: ShopContext) => {
  const { sql, shopper } = shopOf(ctx)
  const couriers = ctx.couriers ? await ctx.couriers.forPartner(shopper.context.partnerId) : null
  // A guest's new carts are counted per store and address, so a script can't fill the table.
  const { ip } = ctx.facts
  const allowNewCart = async () => ip !== null && (await ctx.allowNewCart(`cart:${shopper.context.storeId}:${ip}`))
  return createCartService({ sql, context: shopper.context, language: shopper.language, currency: shopper.currency, marketId: shopper.marketId, features: shopper.features, couriers, stripeTax: stripeTaxOf(ctx), activity: ctx.activity, facts: ctx.facts, allowNewCart, preview: shopper.preview, now: ctx.now })
}

/** A line's answers as the cart and the quote show them (FIRST-RELEASE §19 `ShopLineAnswer`). */
const answerView = (a: PricedAnswer, currency: string) => ({ ...a, amountMoney: { amount: a.amount, currency } })

export const registerCart = ({ builder, money: Money_ }: ShopBuilder) => {
  const AnswerChoice = builder.objectRef<PricedAnswer['choices'][number]>('ShopLineAnswerChoice').implement({
    fields: (t) => ({ choiceId: t.exposeID('choiceId'), label: t.exposeString('label'), quantity: t.exposeInt('quantity'), free: t.exposeInt('free') }),
  })
  const UploadRef = builder.objectRef<{ id: string; kind: string }>('ShopLineAnswerUpload').implement({ fields: (t) => ({ id: t.exposeID('id'), kind: t.exposeString('kind') }) })
  const LineAnswer = builder.objectRef<ReturnType<typeof answerView>>('ShopLineAnswer').implement({
    fields: (t) => ({
      questionId: t.exposeID('questionId'),
      question: t.exposeString('label'),
      // CHOICE, TEXT or UPLOAD.
      kind: t.string({ resolve: (a) => a.kind.toUpperCase() }),
      choices: t.field({ type: [AnswerChoice], resolve: (a) => a.choices }),
      text: t.exposeString('text', { nullable: true }),
      uploads: t.field({ type: [UploadRef], resolve: (a) => a.uploads.map((id) => ({ id, kind: 'file' })) }),
      // What it adds: to each item, or once to the line (`per`, ITEM or LINE; null for a list, whose choices may differ).
      amount: t.field({ type: Money_, resolve: (a) => a.amountMoney }),
      per: t.string({ nullable: true, resolve: (a) => a.per?.toUpperCase() ?? null }),
    }),
  })
  const AnswerProblem = builder.objectRef<{ questionId: string; choiceId: string | null; reason: string }>('ShopAnswerProblem').implement({
    fields: (t) => ({ questionId: t.exposeID('questionId'), choiceId: t.exposeID('choiceId', { nullable: true }), reason: t.exposeString('reason') }),
  })
  const Quote = builder.objectRef<CustomisationQuote & { currency: string }>('ShopCustomisationQuote').implement({
    fields: (t) => ({
      unitPrice: t.field({ type: Money_, nullable: true, resolve: (q) => q.unitPrice }),
      lineTotal: t.field({ type: Money_, nullable: true, resolve: (q) => q.lineTotal }),
      answers: t.field({ type: [LineAnswer], resolve: (q) => q.answers.map((a) => answerView(a, q.currency)) }),
      // What still stops Add to cart, beside each question; empty when it can go in the cart.
      problems: t.field({ type: [AnswerProblem], resolve: (q) => q.problems }),
    }),
  })
  const AnswerChoiceInput = builder.inputType('ShopAnswerChoiceInput', { fields: (t) => ({ choiceId: t.id({ required: true }), quantity: t.int() }) })
  const AnswerInputType = builder.inputType('ShopAnswerInput', {
    // One of `choices`, `text` or `uploadIds`, as the question's kind asks.
    fields: (t) => ({ questionId: t.id({ required: true }), choices: t.field({ type: [AnswerChoiceInput] }), text: t.string(), uploadIds: t.idList() }),
  })
  type RawAnswer = { questionId: string | number; choices?: readonly { choiceId: string | number; quantity?: number | null | undefined }[] | null | undefined; text?: string | null | undefined; uploadIds?: readonly (string | number)[] | null | undefined }
  const answersIn = (answers: readonly RawAnswer[] | null | undefined): AnswerInput[] | null => {
    if (!answers) return null
    if (answers.length > 10 || answers.some((a) => (a.text?.length ?? 0) > 2000 || (a.choices?.length ?? 0) > 50 || (a.uploadIds?.length ?? 0) > 5)) throw new GraphQLError(words.INVALID_INPUT, { extensions: { code: 'INVALID_INPUT' } })
    return answers.map((a) => ({ questionId: String(a.questionId), choices: a.choices?.map((c) => ({ choiceId: String(c.choiceId), quantity: c.quantity ?? null })) ?? null, text: a.text ?? null, uploadIds: a.uploadIds?.map(String) ?? null }))
  }
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
      // The shopper's map pin; null when not pinned.
      latitude: t.float({ nullable: true, resolve: (a) => a.latitude ?? null }),
      longitude: t.float({ nullable: true, resolve: (a) => a.longitude ?? null }),
    }),
  })
  const Gift = builder.objectRef<CartGift>('ShopGiftCardRecipient').implement({
    fields: (t) => ({
      recipientName: t.exposeString('recipientName'),
      recipientEmail: t.exposeString('recipientEmail'),
      message: t.exposeString('message', { nullable: true }),
      // YYYY-MM-DD; null sends it once paid.
      sendOn: t.exposeString('sendOn', { nullable: true }),
    }),
  })
  const GiftInput = builder.inputType('ShopGiftCardInput', {
    fields: (t) => ({ recipientName: t.string({ required: true }), recipientEmail: t.string({ required: true }), message: t.string(), sendOn: t.string() }),
  })
  const Line = builder.objectRef<CartLineView>('ShopCartLine').implement({
    fields: (t) => ({
      // Names the line to setCartQuantity and updateCartLineAnswers: two lines of a version differ by their answers.
      id: t.id({ resolve: (l) => l.lineId ?? l.versionId }),
      versionId: t.exposeID('versionId'),
      answers: t.field({ type: [LineAnswer], resolve: (l, _, ctx) => l.answers.map((a) => answerView(a, shopOf(ctx).shopper.currency)) }),
      // A gift card's recipient and day; null on every other line.
      gift: t.field({ type: Gift, nullable: true, resolve: (l) => l.gift }),
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
      // Before any offer; `discount` is what the offers take off it.
      lineTotal: t.field({ type: Money_, nullable: true, resolve: (l) => l.lineTotal }),
      discount: t.field({ type: Money_, nullable: true, resolve: (l) => l.discount }),
      available: t.exposeInt('available', { nullable: true }),
      // unavailable, not_sold_here, not_priced, short (more than is left) or check_answers (its answers no longer fit); null when it can be bought.
      problem: t.exposeString('problem', { nullable: true }),
    }),
  })
  const Option = builder.objectRef<DeliveryOption>('ShopDeliveryOption').implement({
    fields: (t) => ({
      // courier, flat, pickup or own_delivery: what setShippingOption takes.
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
  const Discount = builder.objectRef<CartView['discounts'][number]>('ShopCartDiscount').implement({
    fields: (t) => ({
      // The offer's name shoppers see, as the receipt will show it (OFFERS fact 13).
      name: t.exposeString('name'),
      code: t.exposeString('code', { nullable: true }),
      amount: t.field({ type: Money_, resolve: (d) => d.amount }),
    }),
  })
  const CodeType = builder.objectRef<CartView['codes'][number]>('ShopCartCode').implement({
    fields: (t) => ({
      code: t.exposeString('code'),
      // APPLIED, NOT_ELIGIBLE (not yet: the cart doesn't meet its conditions), DOESNT_COMBINE, SIGN_IN_REQUIRED (once per
      // customer or first order only, for every guest), INVALID, EXPIRED, USED_UP or ALREADY_USED.
      state: t.exposeString('state'),
    }),
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
      // False when nothing in the cart is sent (downloads, services, gift cards): checkout skips the address and delivery.
      needsShipping: t.exposeBoolean('needsShipping'),
      checkoutStep: t.exposeString('checkoutStep', { nullable: true }),
      lines: t.field({ type: [Line], resolve: (c) => c.lines }),
      subtotal: t.field({ type: Money_, resolve: (c) => c.subtotal }),
      discounts: t.field({ type: [Discount], resolve: (c) => c.discounts }),
      discount: t.field({ type: Money_, resolve: (c) => c.discount }),
      codes: t.field({ type: [CodeType], resolve: (c) => c.codes }),
      deliverable: t.exposeBoolean('deliverable', { nullable: true }),
      shippingOptions: t.field({ type: [Option], resolve: (c) => c.shippingOptions }),
      shipping: t.field({ type: Money_, nullable: true, resolve: (c) => c.shipping }),
      shippingDiscount: t.field({ type: Money_, nullable: true, resolve: (c) => c.shippingDiscount }),
      tax: t.field({ type: Tax, nullable: true, resolve: (c) => c.tax }),
      total: t.field({ type: Money_, resolve: (c) => c.total }),
      giftCard: t.field({ type: AppliedGiftCard, nullable: true, resolve: (c) => c.giftCard }),
      // The total less the gift card's part: what placeOrder takes payment for; 0 is placed with provider "gift_card".
      amountDue: t.field({ type: Money_, resolve: (c) => c.amountDue }),
      // EMPTY, LINE_PROBLEM, NO_CONTACT, NO_ADDRESS, NO_SHIPPING, SHIPPING_UNAVAILABLE, TAX_UNAVAILABLE.
      problems: t.stringList({ resolve: (c) => c.problems }),
      readyToPay: t.boolean({ resolve: (c) => c.problems.length === 0 && c.checkoutStep === 'pay' }),
    }),
  })
  const AppliedGiftCard = builder.objectRef<NonNullable<CartView['giftCard']>>('ShopAppliedGiftCard').implement({
    fields: (t) => ({
      last4: t.exposeString('last4'),
      balance: t.field({ type: Money_, resolve: (g) => g.balance }),
      // What it takes off this cart.
      applied: t.field({ type: Money_, resolve: (g) => g.applied }),
      expiresAt: t.string({ nullable: true, resolve: (g) => g.expiresAt?.toISOString() ?? null }),
    }),
  })
  const Balance = builder.objectRef<GiftCardView>('ShopGiftCardBalance').implement({
    fields: (t) => ({ balance: t.field({ type: Money_, resolve: (g) => g.balance }), expiresAt: t.string({ nullable: true, resolve: (g) => g.expiresAt?.toISOString() ?? null }) }),
  })
  const Change = builder.objectRef<CartChange>('ShopCartChange').implement({
    fields: (t) => ({
      cart: t.field({ type: Cart, resolve: (c) => c.cart }),
      // A new guest cart's token, given once: send it back as X-Shop-Cart.
      cartToken: t.exposeString('token', { nullable: true }),
    }),
  })
  const Applied = builder.objectRef<{ state: string; cart: CartView }>('ShopCodeResult').implement({
    fields: (t) => ({ state: t.exposeString('state'), cart: t.field({ type: Cart, resolve: (r) => r.cart }) }),
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
      // Both or neither: -90..90 and -180..180.
      latitude: t.float(),
      longitude: t.float(),
    }),
  })

  const read = { api: 'shop', scope: 'shop', permission: null } as const
  // LOGGING §3 records a shopper's account events and orders, never carts.
  const write = { ...read, unlogged: 'cart' } as const
  const bounded = (...values: (string | null | undefined)[]) => {
    if (values.some((v) => (v?.length ?? 0) > 300)) throw new GraphQLError(words.INVALID_INPUT, { extensions: { code: 'INVALID_INPUT' } })
  }

  builder.queryFields((t) => ({
    cart: t.field({ type: Cart, nullable: true, extensions: { access: read }, resolve: async (_, __, ctx) => (await cartOf(ctx)).cart() }),
    // The customisation modal's live total (storefront ARCHITECTURE §3.5): priced by the engine, never cached, writing nothing.
    customisationQuote: t.field({
      type: Quote,
      args: { versionId: t.arg.id({ required: true }), quantity: t.arg.int({ required: true }), answers: t.arg({ type: [AnswerInputType], required: true }) },
      extensions: { access: read },
      resolve: async (_, args, ctx) => {
        const quoted = answered(await (await cartOf(ctx)).quote(String(args.versionId), args.quantity, answersIn(args.answers) ?? []))
        return { ...quoted, currency: shopOf(ctx).shopper.currency }
      },
    }),
    // "Check what's left on a gift card" (Account › Gift cards): the one refusal for any number that opens no card here.
    giftCardBalance: t.field({
      type: Balance,
      args: { number: t.arg.string({ required: true }) },
      extensions: { access: read },
      resolve: async (_, args, ctx) => {
        if (args.number.length > 40) throw new GraphQLError(words.GIFT_CARD_INVALID, { extensions: { code: 'GIFT_CARD_INVALID' } })
        await giftCardAttempt(ctx)
        const { sql, shopper } = shopOf(ctx)
        const card = await findGiftCard(sql, shopper.context.storeId, args.number, ctx.now())
        if (!card) throw new GraphQLError(words.GIFT_CARD_INVALID, { extensions: { code: 'GIFT_CARD_INVALID' } })
        return card
      },
    }),
  }))

  builder.mutationFields((t) => ({
    addToCart: t.field({
      type: Change,
      // A gift card takes `gift` and a quantity of 1, one card a line; nothing else takes `gift`.
      // `answers`: the product's questions answered (#1368); left out is today's add, refused ANSWERS_INVALID when a required one is missing.
      args: { versionId: t.arg.id({ required: true }), quantity: t.arg.int({ required: true }), gift: t.arg({ type: GiftInput }), answers: t.arg({ type: [AnswerInputType] }) },
      extensions: { access: write },
      resolve: async (_, args, ctx) => {
        if (args.gift) bounded(args.gift.recipientName, args.gift.recipientEmail, args.gift.message, args.gift.sendOn)
        return answered(await (await cartOf(ctx)).add(String(args.versionId), args.quantity, args.gift ?? null, answersIn(args.answers)))
      },
    }),
    setCartQuantity: t.field({
      type: Change,
      // `lineId` names a customised line; without it, the version's line without answers.
      args: { versionId: t.arg.id({ required: true }), quantity: t.arg.int({ required: true }), lineId: t.arg.id() },
      extensions: { access: write },
      resolve: async (_, args, ctx) => answered(await (await cartOf(ctx)).setQuantity(String(args.versionId), args.quantity, args.lineId ? String(args.lineId) : null)),
    }),
    // Edit on a cart line: its answers replaced, checked as on add; equal answers join their line, quantities summed up to 999.
    updateCartLineAnswers: t.field({
      type: Change,
      args: { lineId: t.arg.id({ required: true }), answers: t.arg({ type: [AnswerInputType], required: true }) },
      extensions: { access: write },
      resolve: async (_, args, ctx) => answered(await (await cartOf(ctx)).setLineAnswers(String(args.lineId), answersIn(args.answers) ?? [])),
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
        bounded(...Object.values(args.address).filter((v) => typeof v === 'string'))
        return answered(await (await cartOf(ctx)).setShippingAddress(args.address))
      },
    }),
    // Null bills the delivery address.
    setBillingAddress: t.field({
      type: Change,
      args: { address: t.arg({ type: AddressInput }) },
      extensions: { access: write },
      resolve: async (_, args, ctx) => {
        bounded(...Object.values(args.address ?? {}).filter((v) => typeof v === 'string'))
        return answered(await (await cartOf(ctx)).setBillingAddress(args.address ?? null))
      },
    }),
    setShippingOption: t.field({
      type: Change,
      args: { option: t.arg.string({ required: true }) },
      extensions: { access: write },
      resolve: async (_, args, ctx) => answered(await (await cartOf(ctx)).setShippingOption(args.option)),
    }),
    // "Discount code or coupon": the code's state, and the cart priced with it; a code that can't work comes back off.
    // A gift card's number at the payment step (FIRST-RELEASE §19): rate-limited per store and address, one refusal for any
    // number that opens no card here.
    applyGiftCard: t.field({
      type: Change,
      args: { number: t.arg.string({ required: true }) },
      extensions: { access: write },
      resolve: async (_, args, ctx) => {
        bounded(args.number)
        await giftCardAttempt(ctx)
        return answered(await (await cartOf(ctx)).applyGiftCard(args.number))
      },
    }),
    removeGiftCard: t.field({ type: Change, extensions: { access: write }, resolve: async (_, __, ctx) => answered(await (await cartOf(ctx)).removeGiftCard()) }),
    applyCode: t.field({
      type: Applied,
      args: { code: t.arg.string({ required: true }) },
      extensions: { access: write },
      resolve: async (_, args, ctx) => {
        bounded(args.code)
        await limitCodeTries(ctx, 'shop-code', 'Too many codes tried. Wait a minute and try again.')
        return answered(await (await cartOf(ctx)).applyCode(args.code))
      },
    }),
    removeCode: t.field({
      type: Change,
      args: { code: t.arg.string({ required: true }) },
      extensions: { access: write },
      resolve: async (_, args, ctx) => {
        bounded(args.code)
        return answered(await (await cartOf(ctx)).removeCode(args.code))
      },
    }),
    // "Continue to payment": refused as NOT_READY with `problems` in its extensions until everything is in place.
    checkout: t.field({ type: Cart, extensions: { access: write }, resolve: async (_, __, ctx) => answered(await (await cartOf(ctx)).checkout()) }),
  }))
  return { Cart }
}
