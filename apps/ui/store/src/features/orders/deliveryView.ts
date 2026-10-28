import type { Order, OrderDelivery } from '../../api/order'
import { fill, messages } from '../../messages'

const words = messages.orders.detail.delivery

// An order's own delivery as the panel reads it (docs/api/DELIVERY.md §3): the API's state, with the code flags and a recall split out.

export type DeliveryView = 'packing' | 'searching' | 'unassigned' | 'assigned' | 'picked_up' | 'code_locked' | 'code_unconfirmed' | 'delivered' | 'failed' | 'recalled' | 'cancelled'
export type DeliveryAction = 'ready' | 'assign' | 'again' | 'cancel' | 'recall' | 'delivered' | 'notDelivered'

const recalledReason = 'recalled'

export const viewOf = (d: OrderDelivery): DeliveryView => {
  if (d.state === 'picked_up') return d.codeUnconfirmedAt ? 'code_unconfirmed' : d.codeLocked ? 'code_locked' : 'picked_up'
  if (d.state === 'failed' && d.failedReason === recalledReason) return 'recalled'
  return d.state
}

/** What the merchant can do in each state, in the order the prototype draws them (OrderDelivery). */
export const actionsOf: Record<DeliveryView, readonly DeliveryAction[]> = {
  packing: ['ready', 'cancel'],
  searching: ['cancel'],
  unassigned: ['assign', 'again', 'cancel'],
  assigned: ['cancel'],
  picked_up: ['recall'],
  code_locked: ['delivered', 'notDelivered'],
  code_unconfirmed: ['delivered', 'notDelivered'],
  delivered: [],
  failed: ['again'],
  recalled: ['again'],
  cancelled: ['again'],
}

/** Where the rider's phone is shown: only while they carry or are about to carry the parcel (DELIVERY §7). */
export const riderOpen = (view: DeliveryView): boolean => view === 'assigned' || view === 'picked_up' || view === 'code_locked' || view === 'code_unconfirmed'

export const withRider = (view: DeliveryView): boolean => view !== 'packing' && view !== 'searching' && view !== 'unassigned' && view !== 'cancelled'

export const isCashPending = (order: Order): boolean => order.paymentMethod === 'cod' && order.paymentState === 'pending'

export const reasonText = (reason: string | null): string => (reason ? ((words.reasons as Record<string, string>)[reason] ?? reason) : words.reasons.other)

export interface DeliveryStep {
  at: string
  text: string
}

const stepText = (state: OrderDelivery['state'], d: OrderDelivery, current: boolean): string => {
  const name = d.rider?.name ?? words.someone
  if (state === 'assigned') return current ? fill(words.steps.assigned, { name }) : words.steps.assignedEarlier
  if (state === 'failed') return !current ? words.steps.failedEarlier : d.failedReason === recalledReason ? words.steps.recalled : fill(words.steps.failed, { reason: reasonText(d.failedReason) })
  return words.steps[state]
}

/** The order's steps, oldest first: placed, then each delivery's moves, an earlier attempt's marked as such. */
export const stepsOf = (order: Order, d: OrderDelivery): DeliveryStep[] => [
  { at: order.placedAt, text: words.steps.placed },
  ...[...d.steps]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((s) => {
      const text = stepText(s.state, d, s.deliveryId === d.id)
      return { at: s.at, text: s.deliveryId === d.id ? text : fill(words.earlier, { step: text }) }
    }),
]
