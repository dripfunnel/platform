import type { Order, OrderLine, OrderPart } from '../../api/order'
import { addressText, allLeft, awaitingPayment, canRefundNow, canShipNow, eventText, freeToReturn, leftInReturn, leftToShip, nothingSent, returnable, suppliersOf } from './orderDetail'

const money = (amount: string) => ({ amount, currency: 'INR' })

const line = (over: Partial<OrderLine> & Pick<OrderLine, 'id' | 'quantity'>): OrderLine => ({
  name: 'Mara Linen Shirt',
  versionName: null,
  unitPrice: money('249900'),
  amount: money('249900'),
  total: money('249900'),
  fulfilledQuantity: 0,
  returnedQuantity: 0,
  sentToStoreQuantity: 0,
  ...over,
})

const part = (lines: OrderLine[], over: Partial<OrderPart> = {}): OrderPart => ({ id: 'part-1', supplierId: null, supplierName: null, shippingMode: 'store', state: 'to_ship', lines, ...over })

const order = (over: Partial<Order> = {}): Order => ({
  id: 'o-1',
  number: 'KT-1042',
  state: 'placed',
  placedAt: '2026-10-10T09:30:00Z',
  customerName: 'Ananya Rao',
  shippingAddress: null,
  parts: [part([line({ id: 'l1', quantity: 2 })])],
  history: [],
  shipments: [],
  returns: [],
  refunds: [],
  paymentState: 'paid',
  fulfilmentState: 'unfulfilled',
  paymentMethod: 'razorpay',
  test: false,
  customerId: 'c-1',
  email: null,
  phone: null,
  marketName: null,
  taxInclusive: null,
  subtotal: null,
  discount: null,
  shipping: null,
  tax: null,
  duties: null,
  total: money('499800'),
  refunded: null,
  shippingOption: 'flat',
  shopperNote: null,
  ...over,
})

describe('what is left to ship', () => {
  it('is the store’s own lines in full, less what has gone', () => {
    expect(leftToShip(line({ id: 'l', quantity: 3, fulfilledQuantity: 1 }), part([]))).toBe(2)
  })

  it('is a to-store supplier’s lines only once handed over, and a to-shopper supplier’s none (it ships its own)', () => {
    const handed = line({ id: 'l', quantity: 3, sentToStoreQuantity: 2, fulfilledQuantity: 1 })
    expect(leftToShip(handed, part([], { shippingMode: 'to-store' }))).toBe(1)
    expect(leftToShip(line({ id: 'l', quantity: 3 }), part([], { shippingMode: 'to-store' }))).toBe(0)
    expect(leftToShip(line({ id: 'l', quantity: 3 }), part([], { shippingMode: 'to-shopper' }))).toBe(0)
  })

  it('opens the ship form with every shippable line picked in full', () => {
    const o = order({ parts: [part([line({ id: 'l1', quantity: 2 }), line({ id: 'l2', quantity: 1, fulfilledQuantity: 1 })])] })
    expect(allLeft(o)).toEqual({ l1: 2 })
  })
})

describe('whether an order can ship, be paid, cancelled or refunded', () => {
  it('ships only an order that has gone through: not a test, a cancelled one, an unpaid card one or a refunded one', () => {
    expect(canShipNow(order())).toBe(true)
    expect(canShipNow(order({ test: true }))).toBe(false)
    expect(canShipNow(order({ state: 'cancelled' }))).toBe(false)
    expect(canShipNow(order({ paymentState: 'pending', paymentMethod: 'razorpay' }))).toBe(false)
    expect(canShipNow(order({ paymentState: 'pending', paymentMethod: 'cod' }))).toBe(true)
    expect(canShipNow(order({ paymentState: 'refunded' }))).toBe(false)
  })

  it('marks paid only the cash-on-delivery and transfer orders that are still waiting', () => {
    expect(awaitingPayment(order({ paymentState: 'pending', paymentMethod: 'cod' }))).toBe(true)
    expect(awaitingPayment(order({ paymentState: 'pending', paymentMethod: 'bank_transfer' }))).toBe(true)
    expect(awaitingPayment(order({ paymentState: 'pending', paymentMethod: 'stripe' }))).toBe(false)
    expect(awaitingPayment(order({ paymentState: 'paid', paymentMethod: 'cod' }))).toBe(false)
  })

  it('cancels only what nothing has left', () => {
    expect(nothingSent(order())).toBe(true)
    expect(nothingSent(order({ parts: [part([line({ id: 'l1', quantity: 2, fulfilledQuantity: 1 })])] }))).toBe(false)
    expect(nothingSent(order({ parts: [part([line({ id: 'l1', quantity: 2, sentToStoreQuantity: 1 })], { shippingMode: 'to-store' })] }))).toBe(false)
  })

  it('refunds only a paid, placed order', () => {
    expect(canRefundNow(order())).toBe(true)
    expect(canRefundNow(order({ paymentState: 'partly_refunded' }))).toBe(true)
    expect(canRefundNow(order({ paymentState: 'pending' }))).toBe(false)
    expect(canRefundNow(order({ state: 'cancelled' }))).toBe(false)
  })
})

describe('what can come back', () => {
  const shipped = order({ parts: [part([line({ id: 'l1', quantity: 3, fulfilledQuantity: 3, returnedQuantity: 1 })])] })
  const first = shipped.parts[0]?.lines[0] as OrderLine

  it('is the shipped units that no return holds and no refund outside a return has taken', () => {
    expect(freeToReturn(shipped, first)).toBe(2)
    const refunded = { ...shipped, refunds: [{ id: 'r', returnId: null, amount: money('1'), lines: [{ lineId: 'l1', quantity: 1 }] }] }
    expect(freeToReturn(refunded, first)).toBe(1)
    expect(returnable(order())).toBe(false)
    expect(returnable(shipped)).toBe(true)
  })

  it('is, for a return, what it holds that its own refunds have not taken', () => {
    const withReturn = {
      ...shipped,
      returns: [{ id: 'ret-1', number: 'R-1', state: 'received', reason: 'damaged', startedAt: '2026-10-10T10:00:00Z', lines: [{ lineId: 'l1', quantity: 2 }] }],
      refunds: [{ id: 'f1', returnId: 'ret-1', amount: money('1'), lines: [{ lineId: 'l1', quantity: 1 }] }],
    }
    expect(leftInReturn(withReturn, withReturn.returns[0] as never, 'l1')).toBe(1)
  })

  it('names the suppliers whose lines were picked, once each', () => {
    const mixed = order({ parts: [part([line({ id: 'l1', quantity: 1 })]), part([line({ id: 'l2', quantity: 1 }), line({ id: 'l3', quantity: 1 })], { id: 'p2', supplierId: 's1', supplierName: 'Northwind Textiles' })] })
    expect(suppliersOf(mixed, ['l1', 'l2', 'l3'])).toEqual(['Northwind Textiles'])
    expect(suppliersOf(mixed, ['l1'])).toEqual([])
  })
})

describe('the history and the address', () => {
  const event = (action: string, note: string | null = null, actorName: string | null = null) => ({ id: 'e', action, at: '2026-10-10T10:00:00Z', actorName, note })

  it('words an event, its coded cancel reason, a note as written, and who did it', () => {
    expect(eventText(event('order.placed'))).toBe('Order placed')
    expect(eventText(event('order.cancelled', 'shopper', 'Farhan Ali'))).toBe('Cancelled · Shopper asked · Farhan Ali')
    expect(eventText(event('order.note_added', 'Gift wrap'))).toBe('Note · Gift wrap')
    expect(eventText(event('return.received'))).toBe('Return received')
    expect(eventText(event('something.new'))).toBe('Updated')
  })

  it('writes an address on one line, the name only when it is not the shopper’s', () => {
    const address = { name: 'Ananya Rao', line1: '14 3rd Cross', line2: null, city: 'Bengaluru', region: 'Karnataka', postalCode: '560038', country: 'IN' }
    expect(addressText(address, 'Ananya Rao')).toBe('14 3rd Cross, Bengaluru, Karnataka 560038, IN')
    expect(addressText(address, 'Someone Else')).toBe('Ananya Rao, 14 3rd Cross, Bengaluru, Karnataka 560038, IN')
  })
})
