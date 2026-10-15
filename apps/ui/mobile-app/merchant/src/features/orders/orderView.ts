import type { ApiMoney, OrderCounts, OrderFilter, OrderRow } from '../../api/orders'
import { formatMoney } from '../../format'
import { locale, tryT } from '../../messages'
import type { Tone } from '../products/productView'

// How the list says what the API sent (FIRST-RELEASE.md §6): the chips, each order's status and payment. Words and tones only;
// every figure is the API's.

export const countKey: Record<OrderFilter, keyof OrderCounts> = {
  ALL: 'all',
  TO_SHIP: 'toShip',
  PARTLY_SHIPPED: 'partlyShipped',
  SHIPPED: 'shipped',
  CANCELLED_REFUNDED: 'cancelledRefunded',
  PAYMENT_PENDING: 'paymentPending',
}

export type OrderStatus = 'toShip' | 'partly' | 'shipped' | 'refunded' | 'cancelled'

export const statusTone: Record<OrderStatus, Tone> = { toShip: 'warning', partly: 'warning', shipped: 'success', refunded: 'neutral', cancelled: 'neutral' }

export const merchantStatus = (state: string, paymentState: string | null, fulfilmentState: string | null): OrderStatus =>
  state === 'cancelled' ? 'cancelled' : paymentState === 'refunded' ? 'refunded' : fulfilmentState === 'fulfilled' ? 'shipped' : fulfilmentState === 'partly_fulfilled' ? 'partly' : 'toShip'

export const rowStatus = (row: Pick<OrderRow, 'state' | 'paymentState' | 'fulfilmentState'>): OrderStatus => merchantStatus(row.state, row.paymentState, row.fulfilmentState)

export type PaymentWord = 'pending' | 'authorised' | 'paid' | 'partlyRefunded' | 'refunded'

const payments: Record<string, PaymentWord> = { pending: 'pending', authorised: 'authorised', paid: 'paid', partly_refunded: 'partlyRefunded', refunded: 'refunded' }

export const paymentOf = (paymentState: string | null): PaymentWord | null => (paymentState !== null ? (payments[paymentState] ?? null) : null)

export const moneyText = (money: ApiMoney): string => formatMoney(money, locale)

/** A connected courier's name; one the app has no name for reads as its own id. */
export const courierName = (provider: string): string => tryT(`orders.couriers.${provider}`) ?? provider

/** How the order was paid, in words; a method the app has no name for reads as online payment. */
export const methodText = (method: string | null): string => (method !== null ? tryT(`orders.methods.${method}`) : undefined) ?? tryT('orders.methods.other') ?? ''
