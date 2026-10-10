import type { Order, OrderAddress, OrderEvent, OrderLine, OrderPart, OrderReturn } from '../../api/order'
import { fill, messages } from '../../messages'
import { merchantStatus, partStatus, type OrderStatus } from './orderView'

// How PortalOrders words an order's page (FIRST-RELEASE §6): its status, what's left to ship and its history. The API
// decides every figure and every action again; these only say them and shape the page.

const words = messages.orders

/** A supplier reads only its own part, so its status is that part's. */
export const orderStatus = (order: Order, supplier: boolean): OrderStatus =>
  order.state === 'cancelled' ? 'cancelled' : supplier ? partStatus(order.parts[0]?.state ?? null) : merchantStatus(order.state, order.paymentState, order.fulfilmentState)

/** Cash on delivery and a transfer reach the store by hand, so only they are marked paid (`markOrderPaid`). */
export const paidByHand = (method: string | null): boolean => method === 'cod' || method === 'bank_transfer'

export const methodText = (method: string | null): string => (method && method in words.methods ? words.methods[method as keyof typeof words.methods] : words.methods.other)

/**
 * How many of a line the caller can send now: the store ships its own lines and a to-store supplier's once handed
 * over; a supplier ships its own to the shopper, or hands them to the store (fulfilment.ts).
 */
export const leftToShip = (line: OrderLine, part: OrderPart, supplier: boolean): number => {
  if (supplier) return part.shippingMode === 'to-store' ? line.quantity - line.sentToStoreQuantity : line.quantity - line.fulfilledQuantity
  if (part.shippingMode === 'to-shopper') return 0
  return part.shippingMode === 'to-store' ? line.sentToStoreQuantity - line.fulfilledQuantity : line.quantity - line.fulfilledQuantity
}

/** Gone through and not over: never a test, a cancelled order, an unpaid card one or one refunded in full. */
export const canShipNow = (order: Order, supplier: boolean): boolean => {
  if (order.state !== 'placed') return false
  if (supplier) return true
  const goneThrough = order.paymentState !== 'pending' || paidByHand(order.paymentMethod)
  return !order.test && goneThrough && order.paymentState !== 'refunded'
}

/** Nothing has left: not shipped, not handed to the store (`cancelOrder`'s NOT_CANCELLABLE). */
export const nothingSent = (order: Order): boolean => order.parts.every((p) => p.lines.every((l) => l.fulfilledQuantity === 0 && l.sentToStoreQuantity === 0))

export const lineName = (line: OrderLine): string => (line.versionName ? fill(words.detail.line.name, { name: line.name, version: line.versionName }) : line.name)

/** The delivery address as PortalOrders writes it, on one line; the name only when it isn't the shopper's own. */
export const addressText = (address: OrderAddress, shopper: string | null): string =>
  [address.name === shopper ? null : address.name, address.line1, address.line2, address.city, [address.region, address.postalCode].filter(Boolean).join(' '), address.country].filter((l): l is string => Boolean(l)).join(', ')

const cancelWords: Record<string, string> = words.cancel.reasons

/** One line of the history: what happened, the coded reason worded, a team note as written, and who. */
export const eventText = (event: OrderEvent): string => {
  const action = event.action in words.history.actions ? words.history.actions[event.action as keyof typeof words.history.actions] : words.history.actions.other
  const detail = event.action === 'order.note_added' ? event.note : event.action === 'order.cancelled' && event.note ? (cancelWords[event.note] ?? null) : null
  const what = detail ? fill(words.history.withDetail, { action, detail }) : action
  return event.actorName ? fill(words.history.by, { what, name: event.actorName }) : what
}

const sum = (quantities: readonly { lineId: string; quantity: number }[], lineId: string) => quantities.reduce((total, l) => (l.lineId === lineId ? total + l.quantity : total), 0)

/** Shipped units no return holds and no refund outside one has taken: what can go back now (refunds.ts `free`). */
export const freeToReturn = (order: Order, line: OrderLine): number => {
  const outside = sum(order.refunds.filter((r) => r.returnId === null).flatMap((r) => r.lines), line.id)
  return Math.max(0, line.fulfilledQuantity - line.returnedQuantity - outside)
}

/** What a return holds of a line that its refunds haven't taken yet. */
export const leftInReturn = (order: Order, ret: OrderReturn, lineId: string): number =>
  Math.max(0, sum(ret.lines, lineId) - sum(order.refunds.filter((r) => r.returnId === ret.id).flatMap((r) => r.lines), lineId))

/** Paid and not over; a supplier reads no payment, so the API decides for it. */
export const canRefundNow = (order: Order, supplier: boolean): boolean => order.state === 'placed' && (supplier || order.paymentState === 'paid' || order.paymentState === 'partly_refunded')
