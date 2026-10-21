import { z } from 'zod'
import { query } from './client'
import { moneySchema } from './orders'

// An order and what its page does to it (FIRST-RELEASE §6, PortalOrders detail; apps/api/schema/store.graphql,
// src/apis/store/orders.ts, payments.ts). A supplier reads only its own part, with no money, payment or contact.

const lineSchema = z.object({
  id: z.string(),
  productId: z.string(),
  name: z.string(),
  versionName: z.string().nullable(),
  sku: z.string().nullable(),
  quantity: z.number().int(),
  unitPrice: moneySchema,
  amount: moneySchema,
  total: moneySchema.nullable(),
  fulfilledQuantity: z.number().int(),
  returnedQuantity: z.number().int(),
  refundedQuantity: z.number().int(),
  sentToStoreQuantity: z.number().int(),
})
export type OrderLine = z.infer<typeof lineSchema>

const partSchema = z.object({
  id: z.string(),
  supplierId: z.string().nullable(),
  supplierName: z.string().nullable(),
  // store, to-store (the supplier hands its lines to the store) or to-shopper.
  shippingMode: z.string(),
  state: z.string(),
  lines: z.array(lineSchema),
})
export type OrderPart = z.infer<typeof partSchema>

const quantitiesSchema = z.array(z.object({ lineId: z.string(), quantity: z.number().int() }))

const shipmentSchema = z.object({
  id: z.string(),
  // manual, pickup, or sent_to_store (a supplier's hand-off to the store).
  kind: z.string(),
  supplierId: z.string().nullable(),
  warehouseName: z.string(),
  courierName: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  trackingUrl: z.string().nullable(),
  shippedAt: z.string(),
  lines: quantitiesSchema,
})
export type OrderShipment = z.infer<typeof shipmentSchema>

const returnSchema = z.object({
  id: z.string(),
  number: z.string(),
  // requested (on its way back), received, refunded or cancelled.
  state: z.string(),
  reason: z.string(),
  startedAt: z.string(),
  lines: quantitiesSchema,
})
export type OrderReturn = z.infer<typeof returnSchema>

const refundSchema = z.object({
  id: z.string(),
  supplierId: z.string().nullable(),
  returnId: z.string().nullable(),
  amount: moneySchema,
  lines: z.array(z.object({ lineId: z.string(), quantity: z.number().int() })),
})
export type OrderRefund = z.infer<typeof refundSchema>

const eventSchema = z.object({ id: z.string(), action: z.string(), at: z.string(), actorKind: z.string(), actorName: z.string().nullable(), note: z.string().nullable() })
export type OrderEvent = z.infer<typeof eventSchema>

const addressSchema = z.object({ name: z.string(), line1: z.string(), line2: z.string().nullable(), city: z.string(), region: z.string().nullable(), postalCode: z.string().nullable(), country: z.string(), phone: z.string().nullable() })
export type OrderAddress = z.infer<typeof addressSchema>

const orderSchema = z.object({
  id: z.string(),
  number: z.string(),
  state: z.string(),
  placedAt: z.string(),
  customerName: z.string().nullable(),
  shippingAddress: addressSchema.nullable(),
  parts: z.array(partSchema),
  history: z.array(eventSchema),
  shipments: z.array(shipmentSchema),
  returns: z.array(returnSchema),
  refunds: z.array(refundSchema),
  // The rest is the merchant side's; a supplier reads null.
  paymentState: z.string().nullable(),
  fulfilmentState: z.string().nullable(),
  paymentMethod: z.string().nullable(),
  test: z.boolean().nullable(),
  customerId: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  marketName: z.string().nullable(),
  taxInclusive: z.boolean().nullable(),
  subtotal: moneySchema.nullable(),
  discount: moneySchema.nullable(),
  shipping: moneySchema.nullable(),
  tax: moneySchema.nullable(),
  duties: moneySchema.nullable(),
  total: moneySchema.nullable(),
  refunded: moneySchema.nullable(),
  // courier, flat or pickup: a pickup is handed over, with no courier or tracking.
  shippingOption: z.string().nullable(),
  shippingMethodLabel: z.string().nullable(),
  shopperNote: z.string().nullable(),
})
export type Order = z.infer<typeof orderSchema>

const quantities = '{ lineId quantity }'
const money = '{ amount currency }'
const orderFields = `id number state placedAt customerName
  shippingAddress { name line1 line2 city region postalCode country phone }
  parts { id supplierId supplierName shippingMode state lines { id productId name versionName sku quantity unitPrice ${money} amount ${money} total ${money} fulfilledQuantity returnedQuantity refundedQuantity sentToStoreQuantity } }
  history { id action at actorKind actorName note }
  shipments { id kind supplierId warehouseName courierName trackingNumber trackingUrl shippedAt lines ${quantities} }
  returns { id number state reason startedAt lines ${quantities} }
  refunds { id supplierId returnId amount ${money} lines ${quantities} }
  paymentState fulfilmentState paymentMethod test customerId email phone marketName taxInclusive
  subtotal ${money} discount ${money} shipping ${money} tax ${money} duties ${money} total ${money} refunded ${money}
  shippingOption shippingMethodLabel shopperNote`

/** One order, or null when it isn't there or isn't the caller's to see. */
export const loadOrder = async (id: string): Promise<Order | null> =>
  (await query(`query O($id: ID!) { order(id: $id) { ${orderFields} } }`, z.object({ order: orderSchema.nullable() }), { id })).order

export interface ShipInput {
  orderId: string
  warehouseId: string
  lines: { lineId: string; quantity: number }[]
  courierName: string | null
  trackingNumber: string | null
  trackingUrl: string | null
}

export const shipItems = async (input: ShipInput): Promise<void> => {
  await query(
    'mutation S($o: ID!, $w: ID!, $l: [ShipLineInput!]!, $c: String, $t: String, $u: String) { shipItems(orderId: $o, warehouseId: $w, lines: $l, courierName: $c, trackingNumber: $t, trackingUrl: $u) }',
    z.object({ shipItems: z.array(z.string()) }),
    { o: input.orderId, w: input.warehouseId, l: input.lines, c: input.courierName, t: input.trackingNumber, u: input.trackingUrl },
  )
}

export const addTracking = async (shipmentId: string, courierName: string | null, trackingNumber: string, trackingUrl: string | null): Promise<void> => {
  await query('mutation T($s: ID!, $c: String, $t: String!, $u: String) { addTracking(shipmentId: $s, courierName: $c, trackingNumber: $t, trackingUrl: $u) }', z.object({ addTracking: z.boolean() }), {
    s: shipmentId,
    c: courierName,
    t: trackingNumber,
    u: trackingUrl,
  })
}

export const markOrderPaid = async (orderId: string): Promise<void> => {
  await query('mutation P($o: ID!) { markOrderPaid(orderId: $o) }', z.object({ markOrderPaid: z.boolean() }), { o: orderId })
}

export const cancelReasons = ['out_of_stock', 'shopper', 'store'] as const
export type CancelReason = (typeof cancelReasons)[number]

export const cancelOrder = async (orderId: string, reason: CancelReason): Promise<void> => {
  await query('mutation C($o: ID!, $r: OrderCancelReason!) { cancelOrder(orderId: $o, reason: $r) }', z.object({ cancelOrder: z.boolean() }), { o: orderId, r: reason })
}

export const addOrderNote = async (orderId: string, note: string): Promise<void> => {
  await query('mutation N($o: ID!, $n: String!) { addOrderNote(orderId: $o, note: $n) }', z.object({ addOrderNote: z.boolean() }), { o: orderId, n: note })
}

export const returnReasons = ['doesnt_fit', 'changed_mind', 'damaged', 'wrong_item', 'not_as_described'] as const
export type ReturnReason = (typeof returnReasons)[number]

/** Shipped units on their way back, each to its owner's location by its part's mode; answers the return's id. */
export const startReturn = async (orderId: string, lines: { lineId: string; quantity: number }[], reason: ReturnReason): Promise<string> =>
  (await query('mutation R($o: ID!, $l: [ShipLineInput!]!, $r: ReturnReason!) { startReturn(orderId: $o, lines: $l, reason: $r) }', z.object({ startReturn: z.string() }), { o: orderId, l: lines, r: reason })).startReturn

export const receiveReturn = async (returnId: string): Promise<void> => {
  await query('mutation R($r: ID!) { receiveReturn(returnId: $r) }', z.object({ receiveReturn: z.boolean() }), { r: returnId })
}

export const cancelReturn = async (returnId: string): Promise<void> => {
  await query('mutation C($r: ID!) { cancelReturn(returnId: $r) }', z.object({ cancelReturn: z.boolean() }), { r: returnId })
}

export const refundReasons = ['returned', 'goodwill', 'other'] as const
export type RefundReason = (typeof refundReasons)[number]

export interface RefundInput {
  orderId: string
  returnId: string | null
  /** Picked units, each at the share the shopper paid for it, which the API works out. */
  lines: { lineId: string; quantity: number }[]
  /** Money with no units: the store's own goodwill, in minor units. */
  extra: string | null
  reason: RefundReason
  restock: boolean
  /** The store refunding a supplier's lines itself, recorded on that supplier's ledger. */
  override: boolean
}

/** One refund an owner, on the payment the money came in on; answers the refunds made. */
export const refund = async (input: RefundInput): Promise<string[]> =>
  (
    await query(
      'mutation F($o: ID!, $ret: ID, $l: [RefundLineInput!]!, $x: String, $r: RefundReason!, $s: Boolean, $v: Boolean) { refund(orderId: $o, returnId: $ret, lines: $l, extra: $x, reason: $r, restock: $s, override: $v) }',
      z.object({ refund: z.array(z.string()) }),
      { o: input.orderId, ret: input.returnId, l: input.lines, x: input.extra, r: input.reason, s: input.restock, v: input.override },
    )
  ).refund
