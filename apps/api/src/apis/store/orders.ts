import { GraphQLError } from 'graphql'
import type { CartAddress } from '#db/scoped/cart'
import { pageOf } from '#core/paging'
import {
  createFulfilmentService,
  createOrdersService,
  cancelReasons,
  createOrderExportService,
  createRefundService,
  fulfilmentAudit,
  orderFilters,
  orderExportAudit,
  ordersAudit,
  refundAudit,
  refundReasons,
  returnReasons,
  type LedgerRow,
  type OrderDetail,
  type OrderExportDto,
  type OrderDetailRow,
  type OrderHistoryRow,
  type OrderLineRow,
  type OrderListRow,
  type OrderPartRow,
  type SaleRow,
  type FulfilmentRefusal,
  type FulfilmentResult,
  type FulfilmentRow,
  type OrdersRefusal,
  type OrdersResult,
  type RefundRefusal,
  type RefundResult,
  type RefundRow,
  type ReturnRow,
} from '#engine/modules/orders/index'
import { storeRoleHas } from '#auth/storePermissions'
import { catalogExportKind } from '#engine/modules/catalog/index'
import { queueSideEffect } from '#saas/outbox/index'
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

const refundWords: Record<RefundRefusal, string> = {
  INVALID_INPUT: 'Something here isn’t valid.',
  NOT_FOUND: 'That isn’t here.',
  NOT_YOURS: 'A supplier refunds its own items. To refund them yourself, override.',
  TOO_MANY: 'That’s more than can go back.',
  NOT_PAID: 'Nothing has been paid on this order to give back.',
  NOT_RECEIVED: 'Mark the return as received first.',
  NOT_REQUESTED: 'This return isn’t on its way back any more.',
  NO_LOCATION: 'There’s no location for these to come back to yet.',
  PROVIDER_UNAVAILABLE: 'The payment provider didn’t answer. Nothing was refunded; try again.',
  PROVIDER_REFUSED: 'The payment provider refused the refund. Nothing was refunded.',
  NOT_CANCELLABLE: 'Only an order nothing has been sent from can be cancelled. Start a return instead.',
  PAYMENT_PENDING: 'The shopper’s card payment is still going through. Try again in a few minutes.',
  READ_ONLY: 'A read-only support session can’t change this store.',
}

const refunded = <T>(result: RefundResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(refundWords[result.reason], { extensions: { code: result.reason } })
}

const answered = <T>(result: OrdersResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
}

type Merchant = NonNullable<OrderDetailRow['merchant']>

export const registerOrders = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)
  const Money = moneyType(builder)
  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    return createOrdersService({ sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts, now: ctx.now })
  }
  const refunds = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    return createRefundService({ sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts, gateways: ctx.payments?.gateways ?? {}, secrets: ctx.secrets ?? null, now: ctx.now })
  }
  // The merchant side's `exports` (Staff included, ACCESS §5.1), a supplier's `exports.orders` (the two order tiers).
  const exportsOf = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    if (!storeRoleHas(caller.role, caller.seller ? 'exports.orders' : 'exports')) throw forbidden()
    return createOrderExportService({
      sql: ctx.sql,
      context: caller.context,
      actor: { id: caller.person.id, label: caller.person.name || caller.person.email, partnerId: caller.person.partnerId },
      activity: ctx.activity,
      facts: ctx.facts,
      now: ctx.now,
      queue: (tx, payload) => queueSideEffect(tx, { kind: catalogExportKind, idempotencyKey: payload.jobId, payload, partnerId: payload.partnerId, storeId: payload.storeId }),
    })
  }
  const shipping = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    return createFulfilmentService({ sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts, now: ctx.now })
  }
  const money = (amount: string | null, currency: string) => (amount === null ? null : { amount, currency })

  const Filter = builder.enumType('OrderFilter', { values: orderFilters.map((f) => f.toUpperCase()) as Uppercase<(typeof orderFilters)[number]>[] })
  const filterOf = (value: string | null | undefined) => (value ? (value.toLowerCase() as (typeof orderFilters)[number]) : 'all')

  const at = (value: Date | string | null) => (value ? new Date(value).toISOString() : null)
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
      // manual, pickup, or sent_to_store (a supplier's hand-off to the store).
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
  const ReturnLine = builder.objectRef<ReturnRow['lines'][number]>('OrderReturnLine').implement({
    fields: (t) => ({ lineId: t.exposeID('line_id'), quantity: t.exposeInt('quantity'), warehouseId: t.exposeID('warehouse_id') }),
  })
  const Return = builder.objectRef<ReturnRow>('OrderReturn').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      number: t.exposeString('number'),
      // requested (on its way back), received, refunded, cancelled.
      state: t.exposeString('state'),
      reason: t.exposeString('reason'),
      // The store's own words; never a supplier's to read.
      note: t.exposeString('note', { nullable: true }),
      receivedAt: t.string({ nullable: true, resolve: (r) => at(r.received_at) }),
      cancelledAt: t.string({ nullable: true, resolve: (r) => at(r.cancelled_at) }),
      startedAt: t.string({ resolve: (r) => new Date(r.created_at).toISOString() }),
      lines: t.field({ type: [ReturnLine], resolve: (r) => r.lines }),
    }),
  })
  const RefundLine = builder.objectRef<RefundRow['lines'][number] & { currency: string }>('OrderRefundLine').implement({
    fields: (t) => ({ lineId: t.exposeID('line_id'), quantity: t.exposeInt('quantity'), amount: t.field({ type: Money, resolve: (l) => ({ amount: l.amount, currency: l.currency }) }) }),
  })
  const Refund = builder.objectRef<RefundRow>('OrderRefund').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      // Whose lines: null the store's own; with `override`, a supplier's the store refunded itself.
      supplierId: t.exposeID('seller_id', { nullable: true }),
      override: t.exposeBoolean('override'),
      returnId: t.exposeID('return_id', { nullable: true }),
      amount: t.field({ type: Money, resolve: (r) => ({ amount: r.amount, currency: r.currency }) }),
      reason: t.exposeString('reason'),
      note: t.exposeString('note', { nullable: true }),
      restock: t.exposeBoolean('restock'),
      // pending, done or failed at the provider; null to a supplier.
      paymentState: t.exposeString('payment_state', { nullable: true }),
      at: t.string({ resolve: (r) => new Date(r.created_at).toISOString() }),
      lines: t.field({ type: [RefundLine], resolve: (r) => r.lines.map((l) => ({ ...l, currency: r.currency })) }),
    }),
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
      returns: t.field({ type: [Return], resolve: (o) => o.returns }),
      refunds: t.field({ type: [Refund], resolve: (o) => o.refunds }),
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

  const Sale = builder.objectRef<SaleRow>('SupplierSale').implement({
    fields: (t) => ({
      lineId: t.exposeID('id'),
      orderNumber: t.exposeString('number'),
      placedAt: t.string({ resolve: (s) => s.placed_at.toISOString() }),
      orderState: t.exposeString('state'),
      name: t.exposeString('name'),
      versionName: t.exposeString('version_name', { nullable: true }),
      sku: t.exposeString('sku', { nullable: true }),
      quantity: t.exposeInt('quantity'),
      refundedQuantity: t.exposeInt('refunded_quantity'),
      // The price sold at times the quantity, before the order's discount and tax (DATA-MODEL §7.11).
      amount: t.field({ type: Money, resolve: (s) => ({ amount: s.line_amount, currency: s.currency }) }),
    }),
  })
  const SalePage = builder.objectRef<{ nodes: SaleRow[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('SupplierSalePage').implement({
    fields: (t) => ({ nodes: t.field({ type: [Sale], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const OrderExport = builder.objectRef<OrderExportDto>('OrderExport').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      // queued, done, failed or expired
      state: t.exposeString('state'),
      rows: t.exposeInt('rows', { nullable: true }),
      truncated: t.exposeBoolean('truncated'),
      csv: t.exposeString('csv', { nullable: true }),
      requestedAt: t.string({ resolve: (e) => e.requestedAt.toISOString() }),
      expiresAt: t.string({ nullable: true, resolve: (e) => e.expiresAt?.toISOString() ?? null }),
    }),
  })

  const LedgerEntry = builder.objectRef<LedgerRow>('SupplierLedgerEntry').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      supplierId: t.exposeID('seller_id'),
      supplierName: t.exposeString('seller_name', { nullable: true }),
      // Positive: the supplier owes the store, for lines the store refunded for it (refund_override).
      amount: t.field({ type: Money, resolve: (e) => ({ amount: e.amount, currency: e.currency }) }),
      kind: t.exposeString('kind'),
      refundId: t.exposeID('refund_id', { nullable: true }),
      orderNumber: t.exposeString('order_number', { nullable: true }),
      at: t.string({ resolve: (e) => new Date(e.created_at).toISOString() }),
    }),
  })
  const Ledger = builder.objectRef<{ page: { nodes: LedgerRow[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }; balance: { amount: string; currency: string }[] }>('SupplierLedger').implement({
    fields: (t) => ({
      entries: t.field({ type: [LedgerEntry], resolve: (l) => l.page.nodes }),
      pageInfo: t.field({ type: PageInfo, resolve: (l) => l.page.pageInfo }),
      // Settled outside DripFunnel (PLATFORM-PROMPT §5.4): one figure a currency.
      balance: t.field({ type: [Money], resolve: (l) => l.balance }),
    }),
  })

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
    // A supplier's own ledger whatever it names; the merchant side names the supplier (ACCESS §7.3).
    supplierLedger: t.field({
      type: Ledger,
      nullable: true,
      args: { supplierId: t.arg.id(), first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: { api: 'store', scope: 'store-seller', permission: 'orders.refund', target: 'none' } },
      resolve: (_, args, ctx) => refunds(ctx).ledger(args.supplierId ? String(args.supplierId).toLowerCase() : null, storePage(args)),
    }),
    mySales: t.field({
      type: SalePage,
      args: { first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: { api: 'store', scope: 'store-seller', permission: 'sales.read', target: 'none' } },
      resolve: async (_, args, ctx) => {
        const window = storePage(args)
        return pageOf(await service(ctx).sales(window), window, (s) => ({ occurredAt: s.placed_at, id: s.id }))
      },
    }),
    orderExport: t.field({ type: OrderExport, nullable: true, args: { id: t.arg.id({ required: true }) }, extensions: { access: read }, resolve: (_, { id }, ctx) => exportsOf(ctx).read(String(id)) }),
    orderExports: t.field({ type: [OrderExport], extensions: { access: read }, resolve: (_, __, ctx) => exportsOf(ctx).recent() }),
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
  // Owner and Manager, and the vendor-orders-fulfil tier on its own lines (ACCESS §5.1, §5.2).
  const refundsAccess = { api: 'store', scope: 'store-seller', permission: 'orders.refund', target: 'none' } as const
  const ReturnReason = builder.enumType('ReturnReason', { values: returnReasons })
  const RefundReason = builder.enumType('RefundReason', { values: refundReasons })
  const CancelReason = builder.enumType('OrderCancelReason', { values: cancelReasons })
  const RefundLineInput = builder.inputType('RefundLineInput', {
    fields: (t) => ({ lineId: t.id({ required: true }), quantity: t.int({ required: true }), amount: t.string() }),
  })

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
    // The store's (orders.refund): shipped lines on their way back, to each owner's location by its part's mode.
    startReturn: t.id({
      args: { orderId: t.arg.id({ required: true }), lines: t.arg({ type: [ShipLine], required: true }), reason: t.arg({ type: ReturnReason, required: true }), note: t.arg.string() },
      extensions: { access: { ...refundsAccess, scope: 'store', audit: refundAudit.returnStarted } },
      resolve: async (_, args, ctx) =>
        refunded(await refunds(ctx).startReturn({ orderId: String(args.orderId).toLowerCase(), lines: args.lines.map((l) => ({ lineId: String(l.lineId), quantity: l.quantity })), reason: args.reason, note: args.note ?? null })),
    }),
    receiveReturn: t.boolean({
      args: { returnId: t.arg.id({ required: true }) },
      extensions: { access: { ...refundsAccess, scope: 'store', audit: refundAudit.returnReceived } },
      resolve: async (_, args, ctx) => refunded(await refunds(ctx).receiveReturn(String(args.returnId).toLowerCase())),
    }),
    cancelReturn: t.boolean({
      args: { returnId: t.arg.id({ required: true }) },
      extensions: { access: { ...refundsAccess, scope: 'store', audit: refundAudit.returnCancelled } },
      resolve: async (_, args, ctx) => refunded(await refunds(ctx).cancelReturn(String(args.returnId).toLowerCase())),
    }),
    // Per line, one refund an owner; the money goes back on the payment it came in on. Answers the refunds made.
    refund: t.idList({
      args: {
        orderId: t.arg.id({ required: true }),
        returnId: t.arg.id(),
        lines: t.arg({ type: [RefundLineInput], required: true }),
        extra: t.arg.string(),
        reason: t.arg({ type: RefundReason, required: true }),
        note: t.arg.string(),
        restock: t.arg.boolean(),
        override: t.arg.boolean(),
      },
      extensions: { access: { ...refundsAccess, audit: refundAudit.issued } },
      resolve: async (_, args, ctx) =>
        refunded(
          await refunds(ctx).refund({
            orderId: String(args.orderId).toLowerCase(),
            returnId: args.returnId ? String(args.returnId).toLowerCase() : null,
            lines: args.lines.map((l) => ({ lineId: String(l.lineId), quantity: l.quantity, amount: l.amount ?? null })),
            extra: args.extra ?? null,
            reason: args.reason,
            note: args.note ?? null,
            restock: args.restock ?? false,
            override: args.override ?? false,
          }),
        ),
    }),
    // An order nothing has left from (orders.write, ACCESS §5.1): its stock released and everything paid given back.
    cancelOrder: t.boolean({
      args: { orderId: t.arg.id({ required: true }), reason: t.arg({ type: CancelReason, required: true }) },
      extensions: { access: { api: 'store', scope: 'store', permission: 'orders.write', target: 'none', audit: refundAudit.cancelled } },
      resolve: async (_, args, ctx) => refunded(await refunds(ctx).cancel(String(args.orderId).toLowerCase(), args.reason)),
    }),
    // A job: the file is read back with orderExport(id). An export is a read, so a read-only store allows it.
    exportOrders: t.id({
      args: { filter: t.arg({ type: Filter }), search: t.arg.string() },
      extensions: { access: { ...read, whileReadOnly: true, audit: orderExportAudit } },
      resolve: async (_, args, ctx) => {
        // A read-only support session reads the store's screens, never takes its data away (ACCESS §8).
        const { caller } = actingCaller(ctx).context
        if (caller.kind === 'support' && caller.access === 'read') throw forbidden()
        const result = await exportsOf(ctx).request({ filter: filterOf(args.filter), search: args.search ?? null })
        if (!result.ok) throw new GraphQLError('That filter doesn’t work.', { extensions: { code: result.reason } })
        return result.jobId
      },
    }),
    addOrderNote: t.boolean({
      args: { orderId: t.arg.id({ required: true }), note: t.arg.string({ required: true }) },
      extensions: { access: { api: 'store', scope: 'store', permission: 'orders.write', target: 'none', audit: ordersAudit.noteAdded } },
      resolve: async (_, args, ctx) => answered(await service(ctx).addNote(String(args.orderId).toLowerCase(), args.note)),
    }),
  }))
}
