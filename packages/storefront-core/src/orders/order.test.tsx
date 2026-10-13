// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { orderOf } from '../../test/order'
import { Provided, shopAnswering } from '../../test/shop'
import { checkoutSdk } from '../checkout/checkout'
import { browserSdk } from '../checkout/payments'
import { PaymentElement } from '../sealed/payment'
import { createI18n } from '../platform/i18n/i18n'
import { useOrder, type OrderPage } from './order'

const { t } = createI18n('en-US')

let seen: OrderPage | null = null
const Probe = () => {
  seen = useOrder()
  return null
}
const page = () => {
  if (!seen) throw new Error('not rendered')
  return seen
}
const show = async (address: string) => {
  history.replaceState(null, '', address)
  render(
    <Provided>
      <Probe />
      <PaymentElement t={t} />
    </Provided>,
  )
  await act(async () => undefined)
}

afterEach(() => {
  cleanup()
  history.replaceState(null, '', '/')
  seen = null
  vi.unstubAllGlobals()
  checkoutSdk.current = browserSdk
  Reflect.deleteProperty(globalThis, 'Razorpay')
})

describe('useOrder', () => {
  it('reads the order the address names through confirmPayment, so a card payment still pending is asked about', async () => {
    const asked = shopAnswering(() => ({ data: { confirmPayment: orderOf() } }))
    await show('/order/o-1/')
    expect(asked).toHaveLength(1)
    expect(asked[0]?.query).toContain('confirmPayment')
    expect(asked[0]?.variables).toEqual({ orderId: 'o-1' })
    const { status, order } = page()
    expect(status).toBe('ready')
    expect(order).toMatchObject({ number: '1051', payment: 'paid', method: 'stripe', delivery: 'Standard delivery', cancelled: false, instructions: null })
    expect(order?.tax).toEqual({ amount: { amount: '400', currency: 'USD' }, includesTax: false })
    expect(document.title).toContain('Order 1051')
  })

  it('says how each order waits: a card still confirming, cash on delivery or a transfer awaited, refunded', async () => {
    shopAnswering(() => ({ data: { confirmPayment: orderOf({ paymentState: 'pending', paymentMethod: 'phonepe' }) } }))
    await show('/order/o-1/')
    expect(page().order?.payment).toBe('confirming')
    cleanup()
    vi.unstubAllGlobals()
    shopAnswering(() => ({ data: { confirmPayment: orderOf({ id: 'o-2', paymentState: 'pending', paymentMethod: 'cod' }) } }))
    await show('/order/o-2/')
    expect(page().order?.payment).toBe('awaiting')
    cleanup()
    vi.unstubAllGlobals()
    shopAnswering(() => ({ data: { confirmPayment: orderOf({ id: 'o-3', paymentState: 'refunded', state: 'cancelled' }) } }))
    await show('/order/o-3/')
    expect(page().order).toMatchObject({ payment: 'refunded', cancelled: true })
  })

  it('gives an awaited bank transfer the store’s bank details and its pay-by date', async () => {
    const asked = shopAnswering((a) =>
      a.query.includes('paymentOptions')
        ? { data: { paymentOptions: [{ provider: 'cod', instructions: null }, { provider: 'bank_transfer', instructions: 'IFSC KKBK0000123' }] } }
        : { data: { confirmPayment: orderOf({ id: 'o-4', paymentState: 'pending', paymentMethod: 'bank_transfer', paymentDueBy: '2026-10-16T06:00:00Z' }) } },
    )
    await show('/order/o-4/')
    expect(asked).toHaveLength(2)
    expect(page().order).toMatchObject({ payment: 'awaiting', instructions: 'IFSC KKBK0000123', payBy: 'Friday, October 16 at 6:00 AM UTC' })
  })

  it('is missing for an order the shopper can’t see or an address without one, and asks again after a failure', async () => {
    shopAnswering(() => ({ data: { confirmPayment: null } }))
    await show('/order/o-9/')
    expect(page().status).toBe('missing')
    cleanup()
    vi.unstubAllGlobals()
    const none = shopAnswering(() => ({ data: {} }))
    await show('/order/')
    expect(page().status).toBe('missing')
    expect(none).toHaveLength(0)
    cleanup()
    vi.unstubAllGlobals()
    let fail = true
    shopAnswering(() => (fail ? { errors: [{ message: 'down', extensions: { code: 'UNAVAILABLE' } }] } : { data: { confirmPayment: orderOf({ id: 'o-5' }) } }))
    await show('/order/o-5/')
    expect(page()).toMatchObject({ status: 'error', code: 'UNAVAILABLE' })
    fail = false
    await act(async () => page().retry())
    expect(page().status).toBe('ready')
  })

  it('offers Try paying again for a card payment that hasn’t gone through, and reads the order again once it has', async () => {
    let paid = false
    const asked = shopAnswering((a) =>
      a.query.includes('payOrder')
        ? { data: { payOrder: { providerRef: 'rzp_order_2', publicKey: 'rzp_test_1', accountId: null, clientSecret: null, sessionId: null, redirectUrl: null } } }
        : { data: { confirmPayment: orderOf({ paymentState: paid ? 'paid' : 'pending', paymentMethod: 'razorpay' }) } },
    )
    const went: string[] = []
    checkoutSdk.current = { script: async () => undefined, go: () => undefined, stripe: async () => ({}) as never }
    ;(globalThis as Record<string, unknown>)['Razorpay'] = class {
      constructor(private o: { handler: () => void; order_id: string }) {}
      open() {
        went.push(this.o.order_id)
        paid = true
        this.o.handler()
      }
      close() {}
    }
    await show('/order/o-1/')
    expect(page().order?.payment).toBe('confirming')
    expect(page().payAgain).not.toBeNull()
    await act(async () => page().payAgain?.())
    await act(async () => undefined)
    expect(asked.filter((a) => a.query.includes('payOrder')).map((a) => a.variables)).toEqual([{ orderId: 'o-1' }])
    expect(went).toEqual(['rzp_order_2'])
    expect(page().order?.payment).toBe('paid')
    expect(page().payAgain).toBeNull()
  })

  it('reads the order again when it was paid meanwhile, and offers no new attempt for cash on delivery or a transfer', async () => {
    let paid = false
    shopAnswering((a) => (a.query.includes('payOrder') ? ((paid = true), { errors: [{ message: 'paid', extensions: { code: 'ALREADY_PAID' } }] }) : { data: { confirmPayment: orderOf({ paymentState: paid ? 'paid' : 'pending', paymentMethod: 'phonepe' }) } }))
    await show('/order/o-1/')
    await act(async () => page().payAgain?.())
    await act(async () => undefined)
    expect(page().order?.payment).toBe('paid')
    cleanup()
    vi.unstubAllGlobals()
    shopAnswering(() => ({ data: { confirmPayment: orderOf({ id: 'o-2', paymentState: 'pending', paymentMethod: 'cod' }) } }))
    await show('/order/o-2/')
    expect(page().payAgain).toBeNull()
  })
})
