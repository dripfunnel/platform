import { z } from 'zod'
import { typedQuery, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { moneySchema } from './orders'
import { loadPlaces } from './settingsWarehouse'

// One order and what its screen does to it (FIRST-RELEASE.md §6, PortalOrders detail; apps/api src/apis/store/orders.ts, payments.ts). Every
// figure is the API's; the app works none out. A supplier's own part is read by api/supplier.ts (#506), which asks for no money.

const lineSchema = z.object({
  id: z.string(),
  name: z.string(),
  versionName: z.string().nullable(),
  quantity: z.number().int(),
  unitPrice: moneySchema,
  amount: moneySchema,
  total: moneySchema.nullable(),
  fulfilledQuantity: z.number().int(),
  returnedQuantity: z.number().int(),
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

export const shipmentSchema = z.object({
  id: z.string(),
  // manual, booked (a label bought here), pickup (handed to the shopper) or sent_to_store (a supplier's hand-off).
  kind: z.string(),
  supplierId: z.string().nullable(),
  warehouseName: z.string(),
  courierName: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  trackingUrl: z.string().nullable(),
  shippedAt: z.string(),
  pickupRequestedAt: z.string().nullable(),
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

const refundSchema = z.object({ id: z.string(), returnId: z.string().nullable(), amount: moneySchema, lines: quantitiesSchema })
export type OrderRefund = z.infer<typeof refundSchema>

export const eventSchema = z.object({ id: z.string(), action: z.string(), at: z.string(), actorName: z.string().nullable(), note: z.string().nullable() })
export type OrderEvent = z.infer<typeof eventSchema>

export const addressSchema = z.object({ name: z.string(), line1: z.string(), line2: z.string().nullable(), city: z.string(), region: z.string().nullable(), postalCode: z.string().nullable(), country: z.string() })
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
  shopperNote: z.string().nullable(),
})
export type Order = z.infer<typeof orderSchema>

const quantities = '{ lineId quantity }'
const money = '{ amount currency }'
const orderFields = `id number state placedAt customerName
  shippingAddress { name line1 line2 city region postalCode country }
  parts { id supplierId supplierName shippingMode state lines { id name versionName quantity unitPrice ${money} amount ${money} total ${money} fulfilledQuantity returnedQuantity sentToStoreQuantity } }
  history { id action at actorName note }
  shipments { id kind supplierId warehouseName courierName trackingNumber trackingUrl shippedAt pickupRequestedAt lines ${quantities} }
  returns { id number state reason startedAt lines ${quantities} }
  refunds { id returnId amount ${money} lines ${quantities} }
  paymentState fulfilmentState paymentMethod test customerId email phone marketName taxInclusive
  subtotal ${money} discount ${money} shipping ${money} tax ${money} duties ${money} total ${money} refunded ${money}
  shippingOption shopperNote`

/** The order, or null when it isn't there or isn't the caller's to see: the two look the same (ACCESS.md §11). */
export const loadOrder = async (client: ApiClient, id: string): Promise<Order | null> =>
  (await typedQuery(client)(`query Order($id: ID!) { order(id: $id) { ${orderFields} } }`, z.object({ order: orderSchema.nullable() }), { id })).order

export type ShipFrom = { id: string; name: string; isDefault: boolean }

/** The store's own locations, the ones it ships from (its suppliers' are theirs). */
export const loadShipFrom = async (client: ApiClient): Promise<ShipFrom[]> =>
  (await loadPlaces(client)).filter((place) => place.supplierId === null).map(({ id, name, isDefault }) => ({ id, name, isDefault }))

const courierSchema = z.object({ provider: z.string(), status: z.string() })

/** The couriers the store has connected and can book a label with (the Owner's `shippingSettings`, `shipping.configure`). */
export const loadCouriers = async (client: ApiClient): Promise<string[]> =>
  (await typedQuery(client)('{ shippingSettings { couriers { provider status } } }', z.object({ shippingSettings: z.object({ couriers: z.array(courierSchema) }) })))
    .shippingSettings.couriers.filter((courier) => courier.status === 'pricing' || courier.status === 'standby')
    .map((courier) => courier.provider)

export type LineQuantity = { lineId: string; quantity: number }

export type ShipInput = { orderId: string; warehouseId: string; lines: LineQuantity[]; courierName: string | null; trackingNumber: string | null; trackingUrl: string | null }

export const shipItems = async (client: ApiClient, input: ShipInput): Promise<void> => {
  await typedQuery(client)(
    'mutation Ship($o: ID!, $w: ID!, $l: [ShipLineInput!]!, $c: String, $t: String, $u: String) { shipItems(orderId: $o, warehouseId: $w, lines: $l, courierName: $c, trackingNumber: $t, trackingUrl: $u) }',
    z.object({ shipItems: z.array(z.string()) }),
    { o: input.orderId, w: input.warehouseId, l: input.lines, c: input.courierName, t: input.trackingNumber, u: input.trackingUrl },
  )
}

/** One seller's lines as one parcel, its label bought through the connected courier (#311); answers the shipment's id. */
export const bookLabel = async (client: ApiClient, input: { orderId: string; warehouseId: string; lines: LineQuantity[]; courier: string }): Promise<string> =>
  (
    await typedQuery(client)(
      'mutation BookLabel($o: ID!, $w: ID!, $l: [ShipLineInput!]!, $c: String!) { bookLabel(orderId: $o, warehouseId: $w, lines: $l, courier: $c) }',
      z.object({ bookLabel: z.string() }),
      { o: input.orderId, w: input.warehouseId, l: input.lines, c: input.courier },
    )
  ).bookLabel

export const requestPickup = async (client: ApiClient, shipmentId: string): Promise<void> => {
  await typedQuery(client)('mutation Pickup($s: ID!) { requestPickup(shipmentId: $s) }', z.object({ requestPickup: z.boolean() }), { s: shipmentId })
}

export const addTracking = async (client: ApiClient, shipmentId: string, courierName: string | null, trackingNumber: string, trackingUrl: string | null): Promise<void> => {
  await typedQuery(client)('mutation Track($s: ID!, $c: String, $t: String!, $u: String) { addTracking(shipmentId: $s, courierName: $c, trackingNumber: $t, trackingUrl: $u) }', z.object({ addTracking: z.boolean() }), {
    s: shipmentId,
    c: courierName,
    t: trackingNumber,
    u: trackingUrl,
  })
}

/** Only for a cash-on-delivery or bank-transfer order waiting for its money (`orders.mark_paid`). */
export const markOrderPaid = async (client: ApiClient, orderId: string): Promise<void> => {
  await typedQuery(client)('mutation MarkPaid($o: ID!) { markOrderPaid(orderId: $o) }', z.object({ markOrderPaid: z.boolean() }), { o: orderId })
}

export const cancelReasons = ['out_of_stock', 'shopper', 'store'] as const
export type CancelReason = (typeof cancelReasons)[number]

export const cancelOrder = async (client: ApiClient, orderId: string, reason: CancelReason): Promise<void> => {
  await typedQuery(client)('mutation Cancel($o: ID!, $r: OrderCancelReason!) { cancelOrder(orderId: $o, reason: $r) }', z.object({ cancelOrder: z.boolean() }), { o: orderId, r: reason })
}

export const returnReasons = ['doesnt_fit', 'changed_mind', 'damaged', 'wrong_item', 'not_as_described'] as const
export type ReturnReason = (typeof returnReasons)[number]

/** Shipped units on their way back, each to its owner's location by its part's mode; answers the return's id. */
export const startReturn = async (client: ApiClient, orderId: string, lines: LineQuantity[], reason: ReturnReason): Promise<string> =>
  (await typedQuery(client)('mutation StartReturn($o: ID!, $l: [ShipLineInput!]!, $r: ReturnReason!) { startReturn(orderId: $o, lines: $l, reason: $r) }', z.object({ startReturn: z.string() }), { o: orderId, l: lines, r: reason })).startReturn

export const receiveReturn = async (client: ApiClient, returnId: string): Promise<void> => {
  await typedQuery(client)('mutation ReceiveReturn($r: ID!) { receiveReturn(returnId: $r) }', z.object({ receiveReturn: z.boolean() }), { r: returnId })
}

export const cancelReturn = async (client: ApiClient, returnId: string): Promise<void> => {
  await typedQuery(client)('mutation CancelReturn($r: ID!) { cancelReturn(returnId: $r) }', z.object({ cancelReturn: z.boolean() }), { r: returnId })
}

export const refundReasons = ['returned', 'goodwill', 'other'] as const
export type RefundReason = (typeof refundReasons)[number]

export type RefundInput = {
  orderId: string
  returnId: string | null
  /** Picked units, each at the share the shopper paid for it, which the API works out. */
  lines: LineQuantity[]
  /** Money with no units: the store's own goodwill, in minor units. */
  extra: string | null
  reason: RefundReason
  restock: boolean
  /** The store refunding a supplier's lines itself, recorded against that supplier. */
  override: boolean
}

/** Answers the ids of the refunds it made, on the payment each came in on. */
export const refund = async (client: ApiClient, input: RefundInput): Promise<string[]> =>
  (
    await typedQuery(client)(
      'mutation Refund($o: ID!, $ret: ID, $l: [RefundLineInput!]!, $x: String, $r: RefundReason!, $s: Boolean, $v: Boolean) { refund(orderId: $o, returnId: $ret, lines: $l, extra: $x, reason: $r, restock: $s, override: $v) }',
      z.object({ refund: z.array(z.string()) }),
      { o: input.orderId, ret: input.returnId, l: input.lines, x: input.extra, r: input.reason, s: input.restock, v: input.override },
    )
  ).refund
