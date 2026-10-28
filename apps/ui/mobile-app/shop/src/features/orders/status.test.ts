import { t } from '../../messages'
import { orderStatus, paymentOf } from './status'

const placed = { state: 'placed', paymentState: 'paid', paymentMethod: 'razorpay' }

describe('how an order’s payment stands', () => {
  it('is paid for a paid or authorised payment, refunded for a refunded one', () => {
    expect(paymentOf({ paymentState: 'paid', paymentMethod: 'stripe' })).toBe('paid')
    expect(paymentOf({ paymentState: 'authorised', paymentMethod: 'stripe' })).toBe('paid')
    expect(paymentOf({ paymentState: 'refunded', paymentMethod: 'stripe' })).toBe('refunded')
    expect(paymentOf({ paymentState: 'partly_refunded', paymentMethod: 'stripe' })).toBe('refunded')
  })

  it('is awaited for cash on delivery or a transfer not yet in, and being confirmed for a card', () => {
    expect(paymentOf({ paymentState: 'pending', paymentMethod: 'cod' })).toBe('awaiting')
    expect(paymentOf({ paymentState: 'pending', paymentMethod: 'bank_transfer' })).toBe('awaiting')
    expect(paymentOf({ paymentState: 'pending', paymentMethod: 'razorpay' })).toBe('confirming')
    expect(paymentOf({ paymentState: 'pending', paymentMethod: null })).toBe('confirming')
  })
})

describe('the pill an order wears', () => {
  it('says cancelled before anything else', () => {
    expect(orderStatus({ ...placed, state: 'cancelled' }, 'picked_up')).toEqual({ label: t('orders.status.cancelled'), tone: 'danger' })
  })

  it('follows the delivery while it has one, and its end: delivered is good, not delivered is bad', () => {
    expect(orderStatus(placed, 'packing').label).toBe(t('tracking.state.packing'))
    expect(orderStatus(placed, 'unassigned').label).toBe(t('tracking.state.searching'))
    expect(orderStatus(placed, 'picked_up')).toEqual({ label: t('tracking.state.picked_up'), tone: 'info' })
    expect(orderStatus(placed, 'delivered')).toEqual({ label: t('tracking.state.delivered'), tone: 'success' })
    expect(orderStatus(placed, 'failed')).toEqual({ label: t('tracking.state.failed'), tone: 'danger' })
  })

  it('falls back to the payment for an order with no delivery, or a delivery state it has no words for', () => {
    expect(orderStatus(placed)).toEqual({ label: t('orders.status.paid'), tone: 'success' })
    expect(orderStatus(placed, 'teleporting').label).toBe(t('orders.status.paid'))
    expect(orderStatus({ state: 'placed', paymentState: 'refunded', paymentMethod: 'stripe' }).label).toBe(t('orders.status.refunded'))
    expect(orderStatus({ state: 'placed', paymentState: 'pending', paymentMethod: 'stripe' }).label).toBe(t('orders.status.confirming'))
    expect(orderStatus({ state: 'placed', paymentState: 'pending', paymentMethod: 'cod' }).label).toBe(t('orders.status.payOnDelivery'))
    expect(orderStatus({ state: 'placed', paymentState: 'pending', paymentMethod: 'bank_transfer' }).label).toBe(t('orders.status.bankWaiting'))
  })
})
