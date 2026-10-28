import { inr } from './fixtures'

// The Shop API's answers for an order and its delivery, as the order and tracking screens' tests share them.

/** 10:14 in India. */
export const placedAt = '2026-10-27T04:44:00Z'

export const orderLines = [
  { name: 'Linen Shirt', versionName: 'Sand / M', quantity: 1, unitPrice: inr('149900'), lineTotal: inr('149900') },
  { name: 'Canvas Tote', versionName: null, quantity: 2, unitPrice: inr('19900'), lineTotal: inr('39800') },
]

export const orderRead = (over: Record<string, unknown> = {}, delivery: unknown = null, timeZone: string | null = 'Asia/Kolkata') => ({
  order: {
    id: 'o-1',
    number: 'ORD-1005',
    state: 'placed',
    paymentState: 'paid',
    paymentMethod: 'razorpay',
    paymentDueBy: null,
    placedAt,
    pricesIncludeTax: true,
    shippingMethod: 'Own delivery',
    subtotal: inr('189700'),
    discounts: [],
    giftCard: null,
    shipping: inr('4900'),
    tax: inr('29600'),
    total: inr('194600'),
    lines: orderLines,
    delivery,
    ...over,
  },
  store: { timeZone },
})

export const rider = { firstName: 'Asha', phone: '+91 98765 00000', photoUrl: '/shop-api/assets/rider-1', vehicleType: 'scooter', vehicleNumber: 'RJ14 0001' }

/** The delivery the API answers for a state: everything it may hold, which the app shows only where the state allows. */
export const deliveryRead = (state: string, over: Record<string, unknown> = {}) => ({
  state,
  etaAt: null,
  handoverCode: null,
  steps: [
    { state: 'packing', at: '2026-10-27T04:44:00Z' },
    { state: 'searching', at: '2026-10-27T05:01:00Z' },
  ],
  rider: null,
  position: null,
  ...over,
})

export const summary = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  number: `ORD-${id}`,
  itemCount: 2,
  placedAt,
  state: 'placed',
  paymentState: 'paid',
  paymentMethod: 'razorpay',
  total: inr('194600'),
  ...over,
})
