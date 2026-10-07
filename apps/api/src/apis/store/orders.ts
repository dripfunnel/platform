import { GraphQLError } from 'graphql'
import type { CartAddress } from '#db/scoped/cart'
import { pageOf } from '#core/paging'
import {
  createOrdersService,
  orderFilters,
  ordersAudit,
  type OrderDetailRow,
  type OrderHistoryRow,
  type OrderLineRow,
  type OrderListRow,
  type OrderPartRow,
  type OrdersRefusal,
  type OrdersResult,
} from '#engine/modules/orders/index'
import { createFulfilmentService, fulfilmentAudit, type FulfilmentRefusal, type FulfilmentResult, type FulfilmentRow } from '#engine/modules/orders/fulfilment'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { moneyType, pageInfoType, type StoreBuilder } from './builder'
import { storePage } from './refusals'

// Orders (FIRST-RELEASE §6, §19; PortalOrders): the merchant side reads every order; a supplier its own part, with no
// order total and the shopper only as its part's stored shipping mode allows (ACCESS §7.3).

const words: Record<OrdersRefusal, string> = {
  INVALID_INPUT: 'Something here isn’t valid.',
  NOT_FOUND: 'That order isn’t here.',
  READ_ONLY: 'A read-only support session can’t change this store.',
}

const shipWords: Record<FulfilmentRefusal, string> = {
  INVALID_INPUT: 'Something here isn’t valid.',
  NOT_FOUND: 'That isn’t here.',
  NOT_SHIPPABLE: 'This order can’t ship: it’s cancelled, a test, or still waiting for its card payment.',
  NOT_YOURS: 'Some of these items or that location aren’t yours to ship from.',
  TOO_MANY: 'That’s more than is left to ship.',
  NOT_ENOUGH_STOCK: 'That location hasn’t that many. Change the stock or pick another location.',
  NO_STORE_LOCATION: 'The store has no location to send these to yet.',
  READ_ONLY: 'A read-only support session can’t change this store.',
}

const shipped = <T>(result: FulfilmentResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(shipWords[result.reason], { extensions: { code: result.reason } })
}

const answered = <T>(result: OrdersResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
}

type OrderDetail = OrderDetailRow & { history: OrderHistoryRow[]; fulfilments: FulfilmentRow[] }
type Merchant = NonNullable<OrderDetailRow['merchant']>

export const registerOrders = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)
  const Money = moneyType(builder)
  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    return createOrdersService({ sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts, now: ctx.now })
  }
  const shipping = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    return createFulfilmentService({ sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts, now: ctx.now })
  }
  const money = (amount: string | null, currency: string) => (amount === null ? null : { amount, currency })

  const Filter = builder.enumType('OrderFilter', { values: orderFilters.map((f) => f.toUpperCase()) as Uppercase<(typeof orderFilters)[number]>[] })
  const filterOf = (value: string | null | undefined) => (value ? (value.toLowerCase() as (typeof orderFilters)[number]) : 'all')

  const Address = builder.objectRef<CartAddress>('OrderAddress').implement({
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

  // A row of the list: a supplier's has no total, payment or test flag, and the shopper only for a to-shopper part.
  const Summary = builder.objectRef<OrderListRow>('OrderSummary').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      number: t.exposeString('number'),
      placedAt: t.string({ resolve: (o) => o.placed_at.toISOString() }),
      state: t.exposeString('state'),
      paymentState: t.exposeString('payment_state', { nullable: true }),
      fulfilmentState: t.exposeString('fulfilment_state', { nullable: true }),
      paymentMethod: t.exposeString('payment_method', { nullable: true }),
      total: t.field({ type: Money, nullable: true, resolve: (o) => money(o.total_amount, o.currency) }),
      // Placed on a preview storefront in the payment providers' test mode: never stock, never to ship.
      test: t.exposeBoolean('test', { nullable: true }),
      customerName: t.exposeString('customer_name', { nullable: true }),
      city: t.exposeString('city', { nullable: true }),
      items: t.exposeInt('items'),
      partState: t.exposeString('part_state', { nullable: true }),
      shippingMode: t.exposeString('shipping_mode', { nullable: true }),
    }),
  })
  const SummaryPage = builder.objectRef<{ nodes: OrderListRow[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('OrderPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [Summary], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const Counts = builder.objectRef<Record<(typeof orderFilters)[number], number>>('OrderCounts').implement({
    fields: (t) => ({
      all: t.exposeInt('all'),
      toShip: t.exposeInt('to_ship'),
      partlyShipped: t.exposeInt('partly_shipped'),
      shipped: t.exposeInt('shipped'),
      cancelledRefunded: t.exposeInt('cancelled_refunded'),
      paymentPending: t.exposeInt('payment_pending'),
    }),
  })

  const Line = builder.objectRef<OrderLineRow & { currency: string }>('OrderLine').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      versionId: t.exposeID('version_id'),
      productId: t.exposeID('product_id'),
      name: t.exposeString('name'),
      versionName: t.exposeString('version_name', { nullable: true }),
      sku: t.exposeString('sku', { nullable: true }),
      quantity: t.exposeInt('quantity'),
      unitPrice: t.field({ type: Money, resolve: (l) => ({ amount: l.unit_amount, currency: l.currency }) }),
      // The price times the quantity: a supplier's figure, before the order's discount and tax (DATA-MODEL §7.11).
      amount: t.field({ type: Money, resolve: (l) => ({ amount: l.line_amount, currency: l.currency }) }),
      discount: t.field({ type: Money, nullable: true, resolve: (l) => money(l.discount_amount, l.currency) }),
      tax: t.field({ type: Money, nullable: true, resolve: (l) => money(l.tax_amount, l.currency) }),
      total: t.field({ type: Money, nullable: true, resolve: (l) => money(l.line_total_amount, l.currency) }),
      fulfilledQuantity: t.exposeInt('fulfilled_quantity'),
      returnedQuantity: t.exposeInt('returned_quantity'),
      refundedQuantity: t.exposeInt('refunded_quantity'),
      sentToStoreQuantity: t.exposeInt('sent_quantity'),
    }),
  })
  const Shipment = builder.objectRef<FulfilmentRow>('OrderShipment').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      // manual, pickup, sent_to_store (a supplier's hand-off), or booked through a courier (#311).
      kind: t.exposeString('kind'),
      supplierId: t.exposeID('seller_id', { nullable: true }),
      warehouseId: t.exposeID('warehouse_id'),
      warehouseName: t.exposeString('warehouse_name'),
      courierName: t.exposeString('courier_name', { nullable: true }),
      trackingNumber: t.exposeString('tracking_number', { nullable: true }),
      trackingUrl: t.exposeString('tracking_url', { nullable: true }),
      shippedAt: t.string({ resolve: (f) => new Date(f.shipped_at).toISOString() }),
      lines: t.field({ type: [ShipmentLine], resolve: (f) => f.lines }),
    }),
  })
  // "You pack these" or "{Supplier} packs these": one part an owner, with the mode it was placed under.
  const Part = builder.objectRef<OrderPartRow & { currency: string }>('OrderPart').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      supplierId: t.exposeID('seller_id', { nullable: true }),
      supplierName: t.exposeString('seller_name', { nullable: true }),
      shippingMode: t.exposeString('shipping_mode'),
      state: t.exposeString('state'),
      lines: t.field({ type: [Line], resolve: (p) => p.lines.map((l) => ({ ...l, currency: p.currency })) }),
    }),
  })
  const ShipmentLine = builder.objectRef<FulfilmentRow['lines'][number]>('OrderShipmentLine').implement({
    fields: (t) => ({ lineId: t.exposeID('line_id'), quantity: t.exposeInt('quantity') }),
  })
  const Event = builder.objectRef<OrderHistoryRow>('OrderEvent').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      action: t.exposeString('action'),
      at: t.string({ resolve: (e) => e.occurred_at.toISOString() }),
      actorKind: t.exposeString('actor_kind'),
      actorName: t.exposeString('actor_label', { nullable: true }),
      // A team note's text, or the action's coded reason; never on a supplier's entries.
      note: t.exposeString('reason', { nullable: true }),
    }),
  })
  const Adjustment = builder.objectRef<Merchant['adjustments'][number] & { currency: string }>('OrderAdjustment').implement({
    fields: (t) => ({
      kind: t.exposeString('kind'),
      label: t.exposeString('label', { nullable: true }),
      amount: t.field({ type: Money, resolve: (a) => ({ amount: a.amount, currency: a.currency }) }),
    }),
  })
  const Payment = builder.objectRef<Merchant['payments'][number] & { currency: string }>('OrderPayment').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      provider: t.exposeString('provider'),
      kind: t.exposeString('kind'),
      state: t.exposeString('state'),
      mode: t.exposeString('mode'),
      amount: t.field({ type: Money, resolve: (p) => ({ amount: p.amount, currency: p.currency }) }),
      capturedAt: t.string({ nullable: true, resolve: (p) => (p.captured_at ? new Date(p.captured_at).toISOString() : null) }),
    }),
  })
  const at = (value: Date | string | null) => (value ? new Date(value).toISOString() : null)
  const Order = builder.objectRef<OrderDetail>('Order').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      number: t.exposeString('number'),
      state: t.exposeString('state'),
      placedAt: t.string({ resolve: (o) => o.placed_at.toISOString() }),
      customerName: t.exposeString('customer_name', { nullable: true }),
      shippingAddress: t.field({ type: Address, nullable: true, resolve: (o) => o.shipping_address }),
      parts: t.field({ type: [Part], resolve: (o) => o.parts.map((p) => ({ ...p, currency: o.currency })) }),
      history: t.field({ type: [Event], resolve: (o) => o.history }),
      shipments: t.field({ type: [Shipment], resolve: (o) => o.fulfilments }),
      paymentState: t.string({ nullable: true, resolve: (o) => o.merchant?.payment_state ?? null }),
      fulfilmentState: t.string({ nullable: true, resolve: (o) => o.merchant?.fulfilment_state ?? null }),
      paymentMethod: t.string({ nullable: true, resolve: (o) => o.merchant?.payment_method ?? null }),
      test: t.boolean({ nullable: true, resolve: (o) => o.merchant?.test ?? null }),
      customerId: t.id({ nullable: true, resolve: (o) => o.merchant?.customer_id ?? null }),
      email: t.string({ nullable: true, resolve: (o) => o.merchant?.email ?? null }),
      phone: t.string({ nullable: true, resolve: (o) => o.merchant?.phone ?? null }),
      billingAddress: t.field({ type: Address, nullable: true, resolve: (o) => o.merchant?.billing_address ?? null }),
      marketId: t.id({ nullable: true, resolve: (o) => o.merchant?.market_id ?? null }),
      marketName: t.string({ nullable: true, resolve: (o) => o.merchant?.market_name ?? null }),
      taxInclusive: t.boolean({ nullable: true, resolve: (o) => o.merchant?.tax_inclusive ?? null }),
      subtotal: t.field({ type: Money, nullable: true, resolve: (o) => money(o.merchant?.subtotal_amount ?? null, o.currency) }),
      discount: t.field({ type: Money, nullable: true, resolve: (o) => money(o.merchant?.discount_amount ?? null, o.currency) }),
      shipping: t.field({ type: Money, nullable: true, resolve: (o) => money(o.merchant?.shipping_amount ?? null, o.currency) }),
      tax: t.field({ type: Money, nullable: true, resolve: (o) => money(o.merchant?.tax_amount ?? null, o.currency) }),
      duties: t.field({ type: Money, nullable: true, resolve: (o) => money(o.merchant?.duties_amount ?? null, o.currency) }),
      total: t.field({ type: Money, nullable: true, resolve: (o) => money(o.merchant?.total_amount ?? null, o.currency) }),
      refunded: t.field({ type: Money, nullable: true, resolve: (o) => money(o.merchant?.refunded_amount ?? null, o.currency) }),
      shippingOption: t.string({ nullable: true, resolve: (o) => o.merchant?.shipping_option ?? null }),
      shippingMethodLabel: t.string({ nullable: true, resolve: (o) => o.merchant?.shipping_method_label ?? null }),
      shopperNote: t.string({ nullable: true, resolve: (o) => o.merchant?.shopper_note ?? null }),
      paidAt: t.string({ nullable: true, resolve: (o) => at(o.merchant?.paid_at ?? null) }),
      paymentDueBy: t.string({ nullable: true, resolve: (o) => at(o.merchant?.payment_due_by ?? null) }),
      cancelledAt: t.string({ nullable: true, resolve: (o) => at(o.merchant?.cancelled_at ?? null) }),
      cancelReason: t.string({ nullable: true, resolve: (o) => o.merchant?.cancel_reason ?? null }),
      adjustments: t.field({ type: [Adjustment], resolve: (o) => (o.merchant?.adjustments ?? []).map((a) => ({ ...a, currency: o.currency })) }),
      payments: t.field({ type: [Payment], resolve: (o) => (o.merchant?.payments ?? []).map((p) => ({ ...p, currency: o.currency })) }),
    }),
  })

  const read = { api: 'store', scope: 'store-seller', permission: 'orders.read', target: 'none' } as const

  builder.queryFields((t) => ({
    orders: t.field({
      type: SummaryPage,
      args: { filter: t.arg({ type: Filter }), search: t.arg.string(), first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: read },
      resolve: async (_, args, ctx) => {
        const window = storePage(args)
        return pageOf(await service(ctx).list(filterOf(args.filter), args.search ?? null, window), window, (o) => ({ occurredAt: o.placed_at, id: o.id }))
      },
    }),
    // The chips' counts (FIRST-RELEASE §19: counts come from their own query); a supplier's are its own parts'.
    orderCounts: t.field({ type: Counts, extensions: { access: read }, resolve: (_, __, ctx) => service(ctx).counts() }),
    order: t.field({
      type: Order,
      nullable: true,
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: read },
      resolve: (_, args, ctx) => service(ctx).detail(String(args.id).toLowerCase()),
    }),
  }))

  const ShipLine = builder.inputType('ShipLineInput', { fields: (t) => ({ lineId: t.id({ required: true }), quantity: t.int({ required: true }) }) })
  // The merchant side's `orders.write` includes fulfilment and its seats hold `orders.fulfil` with it (ACCESS §5.1); a supplier's tier
  // grants it for its own part, which a past-due store's suppliers keep doing (#337).
  const fulfil = { api: 'store', scope: 'store-seller', permission: 'orders.fulfil', target: 'none' } as const

  builder.mutationFields((t) => ({
    // Per line and quantity, from one of the caller's locations; partial is normal. Answers the shipments made, one a part.
    shipItems: t.idList({
      args: {
        orderId: t.arg.id({ required: true }),
        warehouseId: t.arg.id({ required: true }),
        lines: t.arg({ type: [ShipLine], required: true }),
        courierName: t.arg.string(),
        trackingNumber: t.arg.string(),
        trackingUrl: t.arg.string(),
      },
      extensions: { access: { ...fulfil, audit: fulfilmentAudit.shipped } },
      resolve: async (_, args, ctx) =>
        shipped(
          await shipping(ctx).ship({
            orderId: String(args.orderId).toLowerCase(),
            warehouseId: String(args.warehouseId).toLowerCase(),
            lines: args.lines.map((l) => ({ lineId: String(l.lineId), quantity: l.quantity })),
            courierName: args.courierName ?? null,
            trackingNumber: args.trackingNumber ?? null,
            trackingUrl: args.trackingUrl ?? null,
          }),
        ),
    }),
    addTracking: t.boolean({
      args: { shipmentId: t.arg.id({ required: true }), courierName: t.arg.string(), trackingNumber: t.arg.string({ required: true }), trackingUrl: t.arg.string() },
      extensions: { access: { ...fulfil, audit: fulfilmentAudit.trackingAdded } },
      resolve: async (_, args, ctx) =>
        shipped(await shipping(ctx).addTracking(String(args.shipmentId).toLowerCase(), { courierName: args.courierName ?? null, trackingNumber: args.trackingNumber, trackingUrl: args.trackingUrl ?? null })),
    }),
    addOrderNote: t.boolean({
      args: { orderId: t.arg.id({ required: true }), note: t.arg.string({ required: true }) },
      extensions: { access: { api: 'store', scope: 'store', permission: 'orders.write', target: 'none', audit: ordersAudit.noteAdded } },
      resolve: async (_, args, ctx) => answered(await service(ctx).addNote(String(args.orderId).toLowerCase(), args.note)),
    }),
  }))
}
