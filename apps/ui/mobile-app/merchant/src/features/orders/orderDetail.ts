import type { Order, OrderAddress, OrderEvent, OrderLine, OrderPart, OrderReturn } from '../../api/order'
import { t, tryT } from '../../messages'

// How an order's screen words and shapes what the API sent: what is left to ship, what can go back, the history. The API decides every
// figure and every action again; these only say them and decide which controls to offer.

/** Cash on delivery and a transfer reach the store by hand, so only they are marked paid (`markOrderPaid`). */
export const paidByHand = (method: string | null): boolean => method === 'cod' || method === 'bank_transfer'

/** What the store can send of a line now: its own, and a to-store supplier's once handed over (fulfilment.ts); a to-shopper supplier ships its own. */
export const leftToShip = (line: OrderLine, part: OrderPart): number => {
  if (part.shippingMode === 'to-shopper') return 0
  return part.shippingMode === 'to-store' ? line.sentToStoreQuantity - line.fulfilledQuantity : line.quantity - line.fulfilledQuantity
}

/** Every line the store can send now, picked in full, as the prototype opens the form. */
export const allLeft = (order: Order): Record<string, number> =>
  Object.fromEntries(order.parts.flatMap((part) => part.lines.map((line) => [line.id, leftToShip(line, part)] as const).filter(([, left]) => left > 0)))

/** Gone through and not over: never a test, a cancelled order, an unpaid card one or one refunded in full. */
export const canShipNow = (order: Order): boolean => {
  if (order.state !== 'placed') return false
  const goneThrough = order.paymentState !== 'pending' || paidByHand(order.paymentMethod)
  return order.test !== true && goneThrough && order.paymentState !== 'refunded'
}

/** Waiting for money the store gets by hand. */
export const awaitingPayment = (order: Order): boolean => order.state === 'placed' && order.paymentState === 'pending' && paidByHand(order.paymentMethod)

/** Nothing has left: not shipped, not handed to the store (`cancelOrder`'s NOT_CANCELLABLE). */
export const nothingSent = (order: Order): boolean => order.parts.every((part) => part.lines.every((line) => line.fulfilledQuantity === 0 && line.sentToStoreQuantity === 0))

export const lineName = (line: Pick<OrderLine, 'name' | 'versionName'>): string => (line.versionName ? t('orders.detail.line.name', { name: line.name, version: line.versionName }) : line.name)

/** The delivery address on one line; the name only when it isn't the shopper's own. */
export const addressText = (address: OrderAddress, shopper: string | null): string =>
  [address.name === shopper ? null : address.name, address.line1, address.line2, address.city, [address.region, address.postalCode].filter(Boolean).join(' '), address.country].filter((part): part is string => Boolean(part)).join(', ')

const sum = (quantities: readonly { lineId: string; quantity: number }[], lineId: string) => quantities.reduce((total, line) => (line.lineId === lineId ? total + line.quantity : total), 0)

/** Shipped units no return holds and no refund outside one has taken: what can go back now (refunds.ts `free`). */
export const freeToReturn = (order: Order, line: OrderLine): number =>
  Math.max(0, line.fulfilledQuantity - line.returnedQuantity - sum(order.refunds.filter((refund) => refund.returnId === null).flatMap((refund) => refund.lines), line.id))

/** What a return holds of a line that its refunds haven't taken yet. */
export const leftInReturn = (order: Order, ret: OrderReturn, lineId: string): number =>
  Math.max(0, sum(ret.lines, lineId) - sum(order.refunds.filter((refund) => refund.returnId === ret.id).flatMap((refund) => refund.lines), lineId))

/** Paid and not over. */
export const canRefundNow = (order: Order): boolean => order.state === 'placed' && (order.paymentState === 'paid' || order.paymentState === 'partly_refunded')

/** Some shipped unit is free to come back. */
export const returnable = (order: Order): boolean => order.state === 'placed' && order.parts.some((part) => part.lines.some((line) => freeToReturn(order, line) > 0))

/** One line of the history: what happened, the coded reason worded, a team note as written, and who. */
export const eventText = (event: OrderEvent): string => {
  const action = tryT(`orders.history.actions.${event.action}`) ?? t('orders.history.actions.other')
  const reason = event.action === 'order.cancelled' && event.note ? tryT(`orders.cancel.reasons.${event.note}`) : undefined
  const detail = event.action === 'order.note_added' ? event.note : (reason ?? null)
  const what = detail ? t('orders.history.withDetail', { action, detail }) : action
  return event.actorName ? t('orders.history.by', { what, name: event.actorName }) : what
}

/** The suppliers whose lines are among those picked, for the override words. */
export const suppliersOf = (order: Order, lineIds: readonly string[]): string[] => [
  ...new Set(order.parts.filter((part) => part.supplierId !== null && part.lines.some((line) => lineIds.includes(line.id))).map((part) => part.supplierName ?? '')),
]
