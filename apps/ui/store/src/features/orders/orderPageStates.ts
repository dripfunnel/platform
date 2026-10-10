import type { Order, OrderLine, OrderPart } from '../../api/order'
import { hoursAgo, inr } from './orderStates'

// An order's states under ?state= (ui/README.md §6), for any id: loading, error, notFound, toShip, shipping,
// partlyShipped, paymentPending, shipped, cancelled, readOnly, staff, supplier, supplierToShopper.
export const orderStates = ['loading', 'error', 'notFound', 'toShip', 'shipping', 'partlyShipped', 'paymentPending', 'shipped', 'cancelled', 'readOnly', 'staff', 'supplier', 'supplierToShopper'] as const
export type OrderState = (typeof orderStates)[number]

// A build-time constant Vite folds, so a production bundle carries none of these literals.
const harness = import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'

const line = (l: Partial<OrderLine> & Pick<OrderLine, 'id' | 'name' | 'quantity'> & { each: string }): OrderLine => {
  const { each, ...rest } = l
  const amount = String(Number(each) * l.quantity)
  return {
    productId: `p-${l.id}`,
    versionName: null,
    sku: null,
    unitPrice: inr(each),
    amount: inr(amount),
    total: inr(amount),
    fulfilledQuantity: 0,
    returnedQuantity: 0,
    refundedQuantity: 0,
    sentToStoreQuantity: 0,
    ...rest,
  }
}

const ownPart = (lines: OrderLine[], state = 'to_ship'): OrderPart => ({ id: 'part-own', supplierId: null, supplierName: null, shippingMode: 'store', state, lines })
const supplierPart = (lines: OrderLine[], mode = 'to-store', state = 'to_ship'): OrderPart => ({ id: 'part-nw', supplierId: 'seller-northwind', supplierName: 'Northwind Textiles', shippingMode: mode, state, lines })

const shirt = (r: Partial<OrderLine> = {}) => line({ id: 'l1', name: 'Mara Linen Shirt', versionName: 'M / Indigo', quantity: 1, each: '249900', ...r })
const cushion = (r: Partial<OrderLine> = {}) => line({ id: 'l2', name: 'Block-print Cushion Cover', quantity: 2, each: '89900', ...r })
const dupatta = (r: Partial<OrderLine> = {}) => line({ id: 'l3', name: 'Handloom Cotton Dupatta', quantity: 1, each: '149900', ...r })

const sampleOrder: Order | null = harness
  ? {
  id: 'o1042',
  number: 'KT-1042',
  state: 'placed',
  placedAt: hoursAgo(2),
  customerName: 'Ananya Rao',
  shippingAddress: { name: 'Ananya Rao', line1: '14, 3rd Cross, Indiranagar', line2: null, city: 'Bengaluru', region: 'Karnataka', postalCode: '560038', country: 'IN', phone: '+91 98450 12345' },
  parts: [ownPart([shirt(), cushion()]), supplierPart([dupatta()])],
  history: [
    { id: 'e2', action: 'order.paid', at: hoursAgo(1.9), actorKind: 'system', actorName: null, note: null },
    { id: 'e1', action: 'order.placed', at: hoursAgo(2), actorKind: 'shopper', actorName: null, note: null },
  ],
  shipments: [],
  returns: [],
  refunds: [],
  paymentState: 'paid',
  fulfilmentState: 'unfulfilled',
  paymentMethod: 'razorpay',
  test: false,
  customerId: 'c-ananya',
  email: 'ananya.rao@example.in',
  phone: '+91 98450 12345',
  marketName: 'India',
  taxInclusive: true,
  subtotal: inr('579600'),
  discount: null,
  shipping: inr('0'),
  tax: inr('62100'),
  duties: null,
  total: inr('579600'),
  refunded: null,
  shippingOption: 'flat',
  shippingMethodLabel: 'Standard delivery',
  shopperNote: null,
}
  : null

/** The order the harness shows for a state, or null for loading, error and notFound. */
export const orderSample = (state: OrderState | null): Order | null => {
  const baseOrder = sampleOrder
  if (!baseOrder || !state || state === 'loading' || state === 'error' || state === 'notFound') return null
  switch (state) {
    case 'partlyShipped':
      return {
        ...baseOrder,
        fulfilmentState: 'partly_fulfilled',
        parts: [ownPart([shirt({ fulfilledQuantity: 1 }), cushion()], 'partly_shipped'), supplierPart([dupatta({ sentToStoreQuantity: 1 })], 'to-store', 'sent_to_store')],
        shipments: [{ id: 'f1', kind: 'manual', supplierId: null, warehouseName: 'Main location', courierName: 'Delhivery', trackingNumber: null, trackingUrl: null, shippedAt: hoursAgo(1), lines: [{ lineId: 'l1', quantity: 1 }] }],
        history: [{ id: 'e3', action: 'order.shipped', at: hoursAgo(1), actorKind: 'person', actorName: 'Farhan Ali', note: null }, ...baseOrder.history],
      }
    case 'paymentPending':
      return {
        ...baseOrder,
        paymentState: 'pending',
        paymentMethod: 'cod',
        history: [{ id: 'e1', action: 'order.placed', at: hoursAgo(2), actorKind: 'shopper', actorName: null, note: null }],
      }
    case 'shipped':
      return {
        ...baseOrder,
        fulfilmentState: 'fulfilled',
        parts: [ownPart([shirt({ fulfilledQuantity: 1 }), cushion({ fulfilledQuantity: 2 })], 'shipped'), supplierPart([dupatta({ sentToStoreQuantity: 1, fulfilledQuantity: 1 })], 'to-store', 'shipped')],
        shipments: [{ id: 'f1', kind: 'manual', supplierId: null, warehouseName: 'Main location', courierName: 'Delhivery', trackingNumber: '1490 2210 8834', trackingUrl: 'https://www.delhivery.com/track/package/149022108834', shippedAt: hoursAgo(1), lines: [{ lineId: 'l1', quantity: 1 }, { lineId: 'l2', quantity: 2 }, { lineId: 'l3', quantity: 1 }] }],
        history: [{ id: 'e3', action: 'order.shipped', at: hoursAgo(1), actorKind: 'person', actorName: 'Farhan Ali', note: null }, ...baseOrder.history],
      }
    case 'cancelled':
      return {
        ...baseOrder,
        state: 'cancelled',
        paymentState: 'refunded',
        refunded: inr('579600'),
        parts: [ownPart([shirt(), cushion()], 'cancelled'), supplierPart([dupatta()], 'to-store', 'cancelled')],
        history: [{ id: 'e3', action: 'order.cancelled', at: hoursAgo(1), actorKind: 'person', actorName: 'Farhan Ali', note: 'shopper' }, ...baseOrder.history],
      }
    case 'supplier':
    case 'supplierToShopper': {
      const toShopper = state === 'supplierToShopper'
      return {
        ...baseOrder,
        customerName: toShopper ? baseOrder.customerName : null,
        shippingAddress: toShopper ? baseOrder.shippingAddress : null,
        parts: [supplierPart([dupatta()], toShopper ? 'to-shopper' : 'to-store')],
        history: [],
        paymentState: null,
        fulfilmentState: null,
        paymentMethod: null,
        test: null,
        customerId: null,
        email: null,
        phone: null,
        marketName: null,
        taxInclusive: null,
        subtotal: null,
        shipping: null,
        tax: null,
        total: null,
        shippingOption: null,
        shippingMethodLabel: null,
      }
    }
    default:
      return baseOrder
  }
}

export const sampleWarehouses = harness ? [{ id: 'w-main', name: 'Main location', isDefault: true }] : []
