import type { OrderCounts, OrderSummary } from '../../api/orders'

// The Orders list's states under ?state= (ui/README.md §6): loading, error, empty, list, noResults, readOnly, staff,
// supplier, supplierEmpty, denied.
export const orderListStates = ['loading', 'error', 'empty', 'list', 'noResults', 'readOnly', 'staff', 'supplier', 'supplierEmpty', 'denied'] as const
export type OrderListState = (typeof orderListStates)[number]


// A build-time constant Vite folds, so a production bundle carries none of these literals.
const harness = import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'

export const inr = (amount: string) => ({ amount, currency: 'INR' })
export const hoursAgo = (hours: number) => new Date(Date.UTC(2026, 9, 10, 9, 30) - hours * 3_600_000).toISOString()

const summary = (r: Partial<OrderSummary> & Pick<OrderSummary, 'id' | 'number'>): OrderSummary => ({
  placedAt: hoursAgo(2),
  state: 'placed',
  paymentState: 'paid',
  fulfilmentState: 'unfulfilled',
  paymentMethod: 'razorpay',
  total: inr('489700'),
  test: false,
  customerName: 'Ananya Rao',
  city: 'Bengaluru',
  items: 3,
  partState: null,
  shippingMode: null,
  ...r,
})

const rows: OrderSummary[] = harness
  ? [
      summary({ id: 'o1042', number: 'KT-1042' }),
      summary({ id: 'o1041', number: 'KT-1041', placedAt: hoursAgo(5), customerName: 'Rohan Mehta', city: 'Pune', items: 1, total: inr('249900'), paymentState: 'pending', paymentMethod: 'cod' }),
      summary({ id: 'o1040', number: 'KT-1040', placedAt: hoursAgo(26), customerName: 'Sara Khan', city: 'Delhi', items: 4, fulfilmentState: 'partly_fulfilled', total: inr('612000') }),
      summary({ id: 'o1039', number: 'KT-1039', placedAt: hoursAgo(50), customerName: 'Vikram Shah', city: 'Mumbai', items: 2, fulfilmentState: 'fulfilled', total: inr('179800') }),
      summary({ id: 'o1038', number: 'KT-1038', placedAt: hoursAgo(74), customerName: 'Meera Pillai', city: 'Kochi', items: 1, fulfilmentState: 'fulfilled', paymentState: 'partly_refunded', total: inr('149900') }),
      summary({ id: 'o1037', number: 'KT-1037', placedAt: hoursAgo(98), customerName: 'Kabir Singh', city: 'Jaipur', items: 2, state: 'cancelled', paymentState: 'refunded', total: inr('329800') }),
      summary({ id: 'o1036', number: 'KT-1036', placedAt: hoursAgo(120), customerName: 'Test shopper', city: 'Bengaluru', items: 1, test: true, total: inr('89900') }),
    ]
  : []

const supplierRows: OrderSummary[] = rows
  .filter((r) => r.state === 'placed' && !r.test)
  .slice(0, 3)
  .map((r, i) => ({ ...r, total: null, paymentState: null, fulfilmentState: null, paymentMethod: null, test: null, customerName: null, city: null, items: 1, partState: i === 2 ? 'sent_to_store' : 'to_ship', shippingMode: 'to-store' }))

const countsOf = (list: OrderSummary[]): OrderCounts => ({
  all: list.length,
  toShip: list.filter((r) => r.state === 'placed' && !r.test && (r.fulfilmentState === 'unfulfilled' || r.fulfilmentState === 'partly_fulfilled' || r.partState === 'to_ship')).length,
  partlyShipped: list.filter((r) => r.fulfilmentState === 'partly_fulfilled').length,
  shipped: list.filter((r) => r.fulfilmentState === 'fulfilled' || r.partState === 'sent_to_store').length,
  cancelledRefunded: list.filter((r) => r.state === 'cancelled' || r.paymentState === 'refunded').length,
  paymentPending: list.filter((r) => r.paymentState === 'pending').length,
})

export interface OrderListSample {
  rows: OrderSummary[]
  counts: OrderCounts
}

export const orderListSample = (state: OrderListState | null): OrderListSample | null => {
  if (!harness || !state || state === 'loading' || state === 'error' || state === 'denied') return null
  switch (state) {
    case 'empty':
    case 'supplierEmpty':
      return { rows: [], counts: countsOf([]) }
    case 'noResults':
      return { rows: [], counts: countsOf(rows) }
    case 'supplier':
      return { rows: supplierRows, counts: countsOf(supplierRows) }
    default:
      return { rows, counts: countsOf(rows) }
  }
}
