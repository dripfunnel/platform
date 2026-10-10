import { formatMoney } from '@dripfunnel/shared/format'
import type { ExportJobWords, StatusIconName, StatusTone } from '@dripfunnel/shared/ui'
import type { ApiMoney, OrderCounts, OrderFilter, OrderSummary } from '../../api/orders'
import { fill, formatCount, formatTime, locale, messages, plural } from '../../messages'

// How PortalOrders words the list (FIRST-RELEASE §6): who may do what, the chips, each order's status and payment. The
// API decides every figure and every action again; these only say them and shape the page.

export interface OrdersAccess {
  supplier: boolean
  /** Totals and payment: every merchant seat's, Staff included (ACCESS §5.1 `orders.read`); a supplier reads none. */
  money: boolean
  canShip: boolean
  canMarkPaid: boolean
  canCancel: boolean
  canNote: boolean
  canRefund: boolean
  canExport: boolean
  readOnly: boolean
}

export const ordersAccessOf = (acting: { permissions: readonly string[]; seller: unknown }, readOnly: boolean): OrdersAccess => {
  const has = (p: string) => acting.permissions.includes(p)
  const supplier = acting.seller !== null
  return {
    supplier,
    money: !supplier,
    canShip: has('orders.fulfil'),
    canMarkPaid: !supplier && has('orders.mark_paid'),
    canCancel: !supplier && has('orders.write'),
    canNote: !supplier && has('orders.write'),
    canRefund: has('orders.refund'),
    canExport: has(supplier ? 'exports.orders' : 'exports'),
    readOnly,
  }
}

/** The chips each side has: a supplier's are its part's, with no money to filter by. */
export const chipsFor = (supplier: boolean): readonly OrderFilter[] =>
  supplier ? ['ALL', 'TO_SHIP', 'PARTLY_SHIPPED', 'SHIPPED'] : ['ALL', 'TO_SHIP', 'PARTLY_SHIPPED', 'SHIPPED', 'CANCELLED_REFUNDED', 'PAYMENT_PENDING']

export const countKey: Record<OrderFilter, keyof OrderCounts> = {
  ALL: 'all',
  TO_SHIP: 'toShip',
  PARTLY_SHIPPED: 'partlyShipped',
  SHIPPED: 'shipped',
  CANCELLED_REFUNDED: 'cancelledRefunded',
  PAYMENT_PENDING: 'paymentPending',
}

export type OrderStatus = 'toShip' | 'partly' | 'shipped' | 'refunded' | 'cancelled'

export const statusPill: Record<OrderStatus, { tone: StatusTone; icon: StatusIconName }> = {
  toShip: { tone: 'warning', icon: 'hour' },
  partly: { tone: 'info', icon: 'clock' },
  shipped: { tone: 'success', icon: 'ok' },
  refunded: { tone: 'neutral', icon: 'cross' },
  cancelled: { tone: 'neutral', icon: 'ban' },
}

export const partStatus = (state: string | null): OrderStatus =>
  state === 'cancelled' ? 'cancelled' : state === 'partly_shipped' ? 'partly' : state === 'sent_to_store' || state === 'shipped' || state === 'delivered' ? 'shipped' : 'toShip'

export const merchantStatus = (state: string, paymentState: string | null, fulfilmentState: string | null): OrderStatus =>
  state === 'cancelled' ? 'cancelled' : paymentState === 'refunded' ? 'refunded' : fulfilmentState === 'fulfilled' ? 'shipped' : fulfilmentState === 'partly_fulfilled' ? 'partly' : 'toShip'

export const rowStatus = (row: OrderSummary, supplier: boolean): OrderStatus =>
  row.state === 'cancelled' ? 'cancelled' : supplier ? partStatus(row.partState) : merchantStatus(row.state, row.paymentState, row.fulfilmentState)

export type PaymentWord = 'pending' | 'authorised' | 'paid' | 'partlyRefunded' | 'refunded'

export const paymentOf = (paymentState: string | null): PaymentWord | null =>
  paymentState === 'pending' ? 'pending' : paymentState === 'authorised' ? 'authorised' : paymentState === 'paid' ? 'paid' : paymentState === 'partly_refunded' ? 'partlyRefunded' : paymentState === 'refunded' ? 'refunded' : null

export const moneyText = (money: ApiMoney): string => formatMoney({ amount: Number(money.amount), currency: money.currency }, locale)

/** "Oct 10, 1:00 PM" in the store's zone; the screen names the zone once (`zoneName`) rather than on every row. */
export const timeText = (iso: string, timeZone: string): string => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso))

export const zoneName = (timeZone: string): string => new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'longGeneric' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? timeZone

const exportWords = messages.orders.export

/** An orders export's progress in words: the store's list, or a supplier's own lines from To ship or Your sales. */
export const orderExportWords: ExportJobWords = {
  preparing: exportWords.preparing,
  ready: (count, truncated) => (truncated ? fill(exportWords.truncated, { count: formatCount(count) }) : fill(plural(exportWords.ready, count), { count: formatCount(count) })),
  download: exportWords.download,
  file: (date) => fill(exportWords.file, { date }),
  expires: (time) => fill(exportWords.expires, { time: formatTime(time) }),
  expired: exportWords.expired,
  tooLarge: exportWords.tooLarge,
  failed: exportWords.failed,
}
