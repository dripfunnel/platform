import type { Order, OrderDelivery } from '../../api/order'
import { hoursAgo } from './orderStates'

// An own-delivery order in each state of its delivery, under ?state=delivery* (ui/README.md §6; designs OrderDelivery).

export const deliveryStates = [
  'deliveryWaiting',
  'deliveryPacking',
  'deliverySearching',
  'deliveryUnassigned',
  'deliveryAssigned',
  'deliveryOut',
  'deliveryLocked',
  'deliveryUnconfirmed',
  'deliveryDelivered',
  'deliveryFailed',
  'deliveryRecalled',
  'deliveryCancelled',
  'deliveryStaff',
] as const
export type DeliverySampleState = (typeof deliveryStates)[number]

const rider = { name: 'Imran Qureshi', phone: '+91 98110 22334', vehicleType: 'Bike', vehicleNumber: 'RJ14 AB 2210' }
const step = (state: OrderDelivery['state'], hours: number, deliveryId = 'd1') => ({ deliveryId, state, at: hoursAgo(hours) })

const base = (state: OrderDelivery['state'], steps: OrderDelivery['steps'], over: Partial<OrderDelivery> = {}): OrderDelivery => ({
  id: 'd1',
  state,
  failedReason: null,
  failedNote: null,
  cashCollectedAt: null,
  codeLocked: false,
  codeUnconfirmedAt: null,
  rider: null,
  steps,
  ...over,
})

const searching = [step('packing', 1.9), step('searching', 1.7)]
const accepted = [...searching, step('assigned', 1.5)]
const out = [...accepted, step('picked_up', 1.2)]

const deliveries: Record<Exclude<DeliverySampleState, 'deliveryWaiting' | 'deliveryStaff'>, OrderDelivery> = {
  deliveryPacking: base('packing', [step('packing', 1.9)]),
  deliverySearching: base('searching', searching),
  deliveryUnassigned: base('unassigned', [...searching, step('unassigned', 1.6)]),
  deliveryAssigned: base('assigned', accepted, { rider }),
  deliveryOut: base('picked_up', out, { rider }),
  deliveryLocked: base('picked_up', out, { rider, codeLocked: true }),
  deliveryUnconfirmed: base('picked_up', out, { rider, codeUnconfirmedAt: hoursAgo(0.3), cashCollectedAt: hoursAgo(0.4) }),
  deliveryDelivered: base('delivered', [...out, step('delivered', 1)], { rider }),
  deliveryFailed: base('failed', [...out, step('failed', 1)], { rider, failedReason: 'no_one_home' }),
  deliveryRecalled: base('failed', [...out, step('failed', 1)], { rider, failedReason: 'recalled' }),
  deliveryCancelled: base('cancelled', [...searching, step('cancelled', 1.6)]),
}

/** The sample order, shipped by its own riders from its own location, with the delivery of the state. */
export const deliverySample = (state: DeliverySampleState, order: Order): Order => {
  const own = order.parts.filter((p) => p.supplierId === null)
  const cod = state === 'deliveryUnconfirmed' || state === 'deliveryLocked'
  const transfer = state === 'deliveryWaiting'
  const paid = !cod && !transfer
  const placed = { ...order, parts: own, shippingOption: 'own_delivery', shippingMethodLabel: 'Own delivery', paymentMethod: cod ? 'cod' : transfer ? 'bank_transfer' : order.paymentMethod, paymentState: paid ? order.paymentState : 'pending' }
  if (state === 'deliveryWaiting' || state === 'deliveryStaff') return { ...placed, delivery: state === 'deliveryStaff' ? deliveries.deliveryUnassigned : null }
  return { ...placed, delivery: deliveries[state] }
}
