import type { StoreHome, StoreLocaleFacts } from '../../api/home'

// Home's states under ?state= (ui/README.md §6): loading, error, owner, manager, staff, newStore, newManager, newStaff,
// allClear, readOnly, denied. Each seat's sample is what the API answers that seat (§5: null where it may not see).
export const homeStates = ['loading', 'error', 'owner', 'manager', 'staff', 'newStore', 'newManager', 'newStaff', 'allClear', 'readOnly', 'denied'] as const
export type HomeState = (typeof homeStates)[number]

// A build-time constant Vite folds, so a production bundle carries none of these literals.
const harness = import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'

const inr = (amount: string) => ({ amount, currency: 'INR' })

const busy: StoreHome | null = harness
  ? {
      timeZone: 'Asia/Kolkata',
      hasOrders: true,
      toShip: 3,
      partlyShipped: 1,
      oldestToShipAt: '2026-10-08T05:10:00.000Z',
      paymentsToCollect: { count: 1, firstOrderId: 'o1040' },
      awaitingApproval: 2,
      lowStock: { count: 4, names: ['Banarasi silk saree', 'Kantha throw', 'Block-print kurta'] },
      rejectedCouriers: ['Delhivery'],
      ordersToday: 4,
      ordersYesterday: 6,
      sales: [{ yesterday: inr('2184000'), dayBefore: inr('1950000'), averageWeek: inr('412500') }],
      returningCustomers: 12,
      latestOrders: [
        { id: 'o1042', number: 'KT-1042', placedAt: '2026-10-10T07:30:00.000Z', state: 'placed', paymentState: 'paid', fulfilmentState: 'unfulfilled', customerName: 'Ananya Rao', items: 3, total: inr('579600'), test: false },
        { id: 'o1041', number: 'KT-1041', placedAt: '2026-10-10T05:02:00.000Z', state: 'placed', paymentState: 'pending', fulfilmentState: 'partly_fulfilled', customerName: 'Rohan Mehta', items: 2, total: inr('249900'), test: false },
        { id: 'o1040', number: 'KT-1040', placedAt: '2026-10-09T13:45:00.000Z', state: 'placed', paymentState: 'pending', fulfilmentState: 'unfulfilled', customerName: 'Sara Khan', items: 1, total: inr('189900'), test: false },
        { id: 'o1039', number: 'KT-1039', placedAt: '2026-10-09T08:15:00.000Z', state: 'placed', paymentState: 'paid', fulfilmentState: 'fulfilled', customerName: 'Vikram Shah', items: 4, total: inr('912000'), test: false },
        { id: 'o1038', number: 'KT-1038', placedAt: '2026-10-08T11:20:00.000Z', state: 'placed', paymentState: 'refunded', fulfilmentState: 'fulfilled', customerName: null, items: 1, total: inr('99900'), test: false },
      ],
      setup: null,
    }
  : null

const fresh: StoreHome | null = busy && {
  ...busy,
  hasOrders: false,
  toShip: 0,
  partlyShipped: 0,
  oldestToShipAt: null,
  paymentsToCollect: { count: 0, firstOrderId: null },
  awaitingApproval: 0,
  lowStock: { count: 0, names: [] },
  rejectedCouriers: [],
  ordersToday: 0,
  ordersYesterday: 0,
  sales: [],
  returningCustomers: 0,
  latestOrders: [],
  setup: { products: true, collections: false, payments: false, shipping: false },
}

/** What `home` withholds from a Manager (approval, couriers) and Staff (money, payments, returning customers). */
const asManager = (home: StoreHome): StoreHome => ({ ...home, awaitingApproval: null, rejectedCouriers: null, setup: home.setup && { ...home.setup, payments: null, shipping: null } })
const asStaff = (home: StoreHome): StoreHome => ({
  ...asManager(home),
  paymentsToCollect: null,
  sales: null,
  returningCustomers: null,
  latestOrders: home.latestOrders.map((o) => ({ ...o, total: null })),
  setup: home.setup && { products: null, collections: null, payments: null, shipping: null },
})

export interface HomeSample {
  home: StoreHome
  locale: StoreLocaleFacts | null
}

const indiaLocale: StoreLocaleFacts = { country: 'IN', currency: 'INR', language: 'en' }

export const homeSample = (state: HomeState | null): HomeSample | null => {
  if (!harness || !busy || !fresh || !state || state === 'loading' || state === 'error' || state === 'denied') return null
  switch (state) {
    case 'manager':
      return { home: asManager(busy), locale: null }
    case 'staff':
      return { home: asStaff(busy), locale: null }
    case 'newStore':
      return { home: fresh, locale: indiaLocale }
    case 'newManager':
      return { home: asManager(fresh), locale: null }
    case 'newStaff':
      return { home: asStaff(fresh), locale: null }
    case 'allClear':
      return { home: { ...busy, toShip: 0, partlyShipped: 0, oldestToShipAt: null, paymentsToCollect: { count: 0, firstOrderId: null }, awaitingApproval: 0, lowStock: { count: 0, names: [] }, rejectedCouriers: [] }, locale: null }
    default:
      return { home: busy, locale: null }
  }
}
