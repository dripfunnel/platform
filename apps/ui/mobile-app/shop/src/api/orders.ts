import { z } from 'zod'
import { decode } from '@dripfunnel/mobile-shared/graphql'
import type { Price } from './catalogue'
import { operation, type Operation } from './operation'

// A shopper's orders and an order's delivery on the Shop API (api/DELIVERY.md §7). Never kept for offline: they hold the
// shopper's details and, while a delivery is open, its handover code.

export type OrderSummary = { id: string; number: string; itemCount: number; placedAt: string | null; state: string | null; paymentState: string | null; paymentMethod: string | null; total: Price | null }
export type OrdersPage = { items: OrderSummary[]; next: string | null; timeZone: string | null }

export type OrderLine = { name: string; versionName: string | null; quantity: number; unitPrice: Price | null; lineTotal: Price | null }
export type DeliveryStep = { state: string; at: string | null }
export type Rider = { firstName: string; phone: string | null; photoUrl: string | null; vehicleType: string | null; vehicleNumber: string | null }
export type RiderPosition = { latitude: number; longitude: number; reportedAt: string | null }
export type Delivery = { state: string; steps: DeliveryStep[]; rider: Rider | null; position: RiderPosition | null; etaAt: string | null; handoverCode: string | null }

export type Order = {
  id: string
  number: string
  state: string | null
  paymentState: string | null
  paymentMethod: string | null
  paymentDueBy: string | null
  placedAt: string | null
  pricesIncludeTax: boolean
  shippingMethod: string | null
  lines: OrderLine[]
  subtotal: Price | null
  discounts: { name: string; amount: Price }[]
  shipping: Price | null
  tax: Price | null
  giftCard: Price | null
  total: Price | null
  delivery: Delivery | null
}
export type OrderRead = { order: Order | null; timeZone: string | null }

const text = z.string().nullable().optional()
const money = z.object({ amount: z.string(), currency: z.string() }).nullable().optional()
const priceOf = (value: z.infer<typeof money>): Price | null => value ?? null
const m = '{ amount currency }'

const ordersPageSize = 20

const summarySchema = z.object({
  id: z.string(),
  number: text,
  itemCount: z.number().int().nullable().optional(),
  placedAt: text,
  state: text,
  paymentState: text,
  paymentMethod: text,
  total: money,
})

const ordersAnswer = z.object({
  orderHistory: z.object({ nodes: z.array(summarySchema).nullable().optional(), pageInfo: z.object({ hasNextPage: z.boolean().nullable().optional(), endCursor: text }).nullable().optional() }).nullable(),
  store: z.object({ timeZone: text }).nullable().optional(),
})

/** The signed-in shopper's orders, newest first, a page at a time. */
export const orderHistoryOperation = (after: string | null): Operation<OrdersPage> =>
  operation(
    null,
    `query($first: Int, $after: String) { orderHistory(first: $first, after: $after) { nodes { id number itemCount placedAt state paymentState paymentMethod total ${m} } pageInfo { hasNextPage endCursor } } store { timeZone } }`,
    { first: ordersPageSize, ...(after ? { after } : {}) },
    (data) => {
      const { orderHistory, store } = decode(ordersAnswer, data)
      const info = orderHistory?.pageInfo
      return {
        items: (orderHistory?.nodes ?? []).map((n) => ({ id: n.id, number: n.number ?? n.id, itemCount: n.itemCount ?? 0, placedAt: n.placedAt ?? null, state: n.state ?? null, paymentState: n.paymentState ?? null, paymentMethod: n.paymentMethod ?? null, total: priceOf(n.total) })),
        next: info?.hasNextPage && info.endCursor ? info.endCursor : null,
        timeZone: store?.timeZone ?? null,
      }
    },
  )

const deliverySchema = z
  .object({
    state: text,
    etaAt: text,
    handoverCode: text,
    steps: z.array(z.object({ state: text, at: text })).nullable().optional(),
    rider: z.object({ firstName: text, phone: text, photoUrl: text, vehicleType: text, vehicleNumber: text }).nullable().optional(),
    position: z.object({ latitude: z.number().nullable().optional(), longitude: z.number().nullable().optional(), reportedAt: text }).nullable().optional(),
  })
  .nullable()
  .optional()

const orderSchema = z.object({
  id: z.string(),
  number: text,
  state: text,
  paymentState: text,
  paymentMethod: text,
  paymentDueBy: text,
  placedAt: text,
  pricesIncludeTax: z.boolean().nullable().optional(),
  shippingMethod: text,
  subtotal: money,
  discounts: z.array(z.object({ name: text, amount: money })).nullable().optional(),
  giftCard: money,
  shipping: money,
  tax: money,
  total: money,
  lines: z.array(z.object({ name: text, versionName: text, quantity: z.number().int().nullable().optional(), unitPrice: money, lineTotal: money })).nullable().optional(),
  delivery: deliverySchema,
})

const orderAnswer = z.object({ order: orderSchema.nullable(), store: z.object({ timeZone: text }).nullable().optional() })

const deliveryOf = (raw: z.infer<typeof deliverySchema>): Delivery | null => {
  if (!raw?.state) return null
  const { rider, position } = raw
  return {
    state: raw.state,
    steps: (raw.steps ?? []).flatMap((s) => (s.state ? [{ state: s.state, at: s.at ?? null }] : [])),
    rider: rider?.firstName ? { firstName: rider.firstName, phone: rider.phone ?? null, photoUrl: rider.photoUrl ?? null, vehicleType: rider.vehicleType ?? null, vehicleNumber: rider.vehicleNumber ?? null } : null,
    position: position && typeof position.latitude === 'number' && typeof position.longitude === 'number' ? { latitude: position.latitude, longitude: position.longitude, reportedAt: position.reportedAt ?? null } : null,
    etaAt: raw.etaAt ?? null,
    handoverCode: raw.handoverCode ?? null,
  }
}

/** One order, with its delivery while it is an own delivery; null where the API finds none for this shopper. */
export const orderOperation = (id: string): Operation<OrderRead> =>
  operation(
    null,
    `query($id: ID!) { order(id: $id) { id number state paymentState paymentMethod paymentDueBy placedAt pricesIncludeTax shippingMethod subtotal ${m} discounts { name amount ${m} } giftCard ${m} shipping ${m} tax ${m} total ${m} lines { name versionName quantity unitPrice ${m} lineTotal ${m} } delivery { state etaAt handoverCode steps { state at } rider { firstName phone photoUrl vehicleType vehicleNumber } position { latitude longitude reportedAt } } } store { timeZone } }`,
    { id },
    (data) => {
      const { order, store } = decode(orderAnswer, data)
      if (!order) return { order: null, timeZone: store?.timeZone ?? null }
      return {
        timeZone: store?.timeZone ?? null,
        order: {
          id: order.id,
          number: order.number ?? order.id,
          state: order.state ?? null,
          paymentState: order.paymentState ?? null,
          paymentMethod: order.paymentMethod ?? null,
          paymentDueBy: order.paymentDueBy ?? null,
          placedAt: order.placedAt ?? null,
          pricesIncludeTax: order.pricesIncludeTax === true,
          shippingMethod: order.shippingMethod ?? null,
          subtotal: priceOf(order.subtotal),
          discounts: (order.discounts ?? []).flatMap((d) => (d.amount ? [{ name: d.name ?? '', amount: d.amount }] : [])),
          shipping: priceOf(order.shipping),
          tax: priceOf(order.tax),
          giftCard: priceOf(order.giftCard),
          total: priceOf(order.total),
          lines: (order.lines ?? []).map((l) => ({ name: l.name ?? '', versionName: l.versionName ?? null, quantity: l.quantity ?? 1, unitPrice: priceOf(l.unitPrice), lineTotal: priceOf(l.lineTotal) })),
          delivery: deliveryOf(order.delivery),
        },
      }
    },
  )
