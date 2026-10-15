import { courierName, merchantStatus, methodText, moneyText, paymentOf, rowStatus } from './orderView'

describe('how the list words an order', () => {
  it('gives an order one status: cancelled, refunded, shipped, partly shipped or to ship', () => {
    expect(merchantStatus('cancelled', 'refunded', 'unfulfilled')).toBe('cancelled')
    expect(merchantStatus('placed', 'refunded', 'fulfilled')).toBe('refunded')
    expect(merchantStatus('placed', 'paid', 'fulfilled')).toBe('shipped')
    expect(merchantStatus('placed', 'paid', 'partly_fulfilled')).toBe('partly')
    expect(merchantStatus('placed', 'pending', 'unfulfilled')).toBe('toShip')
    expect(rowStatus({ state: 'placed', paymentState: 'paid', fulfilmentState: 'fulfilled' })).toBe('shipped')
  })

  it('words a payment state, and nothing for one it does not know', () => {
    expect(paymentOf('partly_refunded')).toBe('partlyRefunded')
    expect(paymentOf('pending')).toBe('pending')
    expect(paymentOf('what')).toBeNull()
    expect(paymentOf(null)).toBeNull()
  })

  it('formats money from minor-unit digit strings, past what a number holds', () => {
    expect(moneyText({ amount: '249900', currency: 'INR' })).toBe('₹2,499.00')
    expect(moneyText({ amount: '12345678901234567', currency: 'USD' })).toBe('$123,456,789,012,345.67')
  })

  it('names how an order was paid, and a courier', () => {
    expect(methodText('cod')).toBe('Cash on delivery')
    expect(methodText('anything_else')).toBe('Online payment')
    expect(methodText(null)).toBe('Online payment')
    expect(courierName('shiprocket')).toBe('Shiprocket')
    expect(courierName('newcourier')).toBe('newcourier')
  })
})
