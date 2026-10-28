import { t } from '../../messages'

// How an order stands, in the words the website uses (storefront-core's order page): the API serves the states, the clients word them.

type Stands = { state: string | null; paymentState: string | null; paymentMethod: string | null }

export type Payment = 'paid' | 'refunded' | 'awaiting' | 'confirming'

const later = new Set(['cod', 'bank_transfer'])

/** A payment the API reports as paid (or authorised) is paid; one not yet in, for a way paid later, is awaited; for a card, being confirmed. */
export const paymentOf = ({ paymentState, paymentMethod }: Pick<Stands, 'paymentState' | 'paymentMethod'>): Payment =>
  paymentState === 'paid' || paymentState === 'authorised' ? 'paid' : paymentState === 'refunded' || paymentState === 'partly_refunded' ? 'refunded' : paymentMethod && later.has(paymentMethod) ? 'awaiting' : 'confirming'

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'
export type Status = { label: string; tone: Tone }

const deliveryStatus = (state: string): Status | null => {
  switch (state) {
    case 'packing':
      return { label: t('tracking.state.packing'), tone: 'info' }
    case 'searching':
    case 'unassigned':
      return { label: t('tracking.state.searching'), tone: 'info' }
    case 'assigned':
      return { label: t('tracking.state.assigned'), tone: 'info' }
    case 'picked_up':
      return { label: t('tracking.state.picked_up'), tone: 'info' }
    case 'delivered':
      return { label: t('tracking.state.delivered'), tone: 'success' }
    case 'failed':
      return { label: t('tracking.state.failed'), tone: 'danger' }
    default:
      return null
  }
}

/** The pill an order wears: cancelled first, then where its delivery is (when it has one), then its payment. */
export const orderStatus = (order: Stands, deliveryState: string | null = null): Status => {
  if (order.state === 'cancelled') return { label: t('orders.status.cancelled'), tone: 'danger' }
  const delivery = deliveryState ? deliveryStatus(deliveryState) : null
  if (delivery) return delivery
  const payment = paymentOf(order)
  if (payment === 'paid') return { label: t('orders.status.paid'), tone: 'success' }
  if (payment === 'refunded') return { label: t('orders.status.refunded'), tone: 'neutral' }
  if (payment === 'confirming') return { label: t('orders.status.confirming'), tone: 'warning' }
  return order.paymentMethod === 'cod' ? { label: t('orders.status.payOnDelivery'), tone: 'neutral' } : { label: t('orders.status.bankWaiting'), tone: 'warning' }
}
