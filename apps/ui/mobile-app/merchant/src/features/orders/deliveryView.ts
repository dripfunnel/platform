import type { Order, OrderDelivery } from '../../api/order'
import { t, tryT } from '../../messages'

// An order's own delivery as its panel reads it (docs/api/DELIVERY.md §3): the API's state, with the code flags and a recall split out.

export type DeliveryView = 'packing' | 'searching' | 'unassigned' | 'assigned' | 'picked_up' | 'code_locked' | 'code_unconfirmed' | 'delivered' | 'failed' | 'recalled' | 'cancelled'
export type DeliveryAction = 'ready' | 'assign' | 'again' | 'cancel' | 'recall' | 'delivered' | 'notDelivered'

const recalledReason = 'recalled'

export const viewOf = (delivery: OrderDelivery): DeliveryView => {
  if (delivery.state === 'picked_up') return delivery.codeUnconfirmedAt ? 'code_unconfirmed' : delivery.codeLocked ? 'code_locked' : 'picked_up'
  if (delivery.state === 'failed' && delivery.failedReason === recalledReason) return 'recalled'
  return delivery.state
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

export const primaryActions: readonly DeliveryAction[] = ['ready', 'assign', 'again', 'delivered']

/** Where the rider's phone is shown: only while they carry or are about to carry the parcel (DELIVERY.md §7). */
export const riderOpen = (view: DeliveryView): boolean => view === 'assigned' || view === 'picked_up' || view === 'code_locked' || view === 'code_unconfirmed'

export const withRider = (view: DeliveryView): boolean => view !== 'packing' && view !== 'searching' && view !== 'unassigned' && view !== 'cancelled'

export const isCashPending = (order: Pick<Order, 'paymentMethod' | 'paymentState'>): boolean => order.paymentMethod === 'cod' && order.paymentState === 'pending'

export const reasonText = (reason: string | null): string => tryT(`orders.detail.delivery.reasons.${reason ?? 'other'}`) ?? t('orders.detail.delivery.reasons.other')

/** The link that opens the phone's dialler; the number is the rider's, shown only while they carry the parcel. */
export const telUrl = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, '')}`

export type DeliveryStep = { at: string; text: string }

const stepText = (state: OrderDelivery['state'], delivery: OrderDelivery, current: boolean): string => {
  const name = delivery.rider?.name ?? t('orders.detail.delivery.someone')
  if (state === 'assigned') return current ? t('orders.detail.delivery.steps.assigned', { name }) : t('orders.detail.delivery.steps.assignedEarlier')
  if (state === 'failed') {
    if (!current) return t('orders.detail.delivery.steps.failedEarlier')
    return delivery.failedReason === recalledReason ? t('orders.detail.delivery.steps.recalled') : t('orders.detail.delivery.steps.failed', { reason: reasonText(delivery.failedReason) })
  }
  return t(`orders.detail.delivery.steps.${state}`)
}

/** The order's steps, oldest first: placed, then each delivery's moves, an earlier attempt's marked as such. */
export const stepsOf = (order: Pick<Order, 'placedAt'>, delivery: OrderDelivery): DeliveryStep[] => [
  { at: order.placedAt, text: t('orders.detail.delivery.steps.placed') },
  ...[...delivery.steps]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((step) => {
      const text = stepText(step.state, delivery, step.deliveryId === delivery.id)
      return { at: step.at, text: step.deliveryId === delivery.id ? text : t('orders.detail.delivery.earlier', { step: text }) }
    }),
]
