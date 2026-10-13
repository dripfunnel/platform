// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cartOf, line, usd } from '../../test/cart'
import { later, Provided, shopAnswering, type Asked } from '../../test/shop'
import { createShopClient } from '../platform/api/client'
import { storedShopState } from '../platform/api/tokens'
import type { RenderMode } from '../platform/store/context'
import { rootOf } from '../sealed/element'
import { PaymentElement } from '../sealed/payment'
import { createI18n } from '../platform/i18n/i18n'
import { checkoutSdk, useCheckout, type CheckoutPage } from './checkout'
import { browserSdk, type Sdk } from './payments'

const { t } = createI18n('en-US')
const address = { name: 'Maya Chen', line1: '88 Neil Ave', line2: 'Apt 4', city: 'Columbus', region: 'OH', postalCode: '43215', country: 'US', phone: null }
const ready = cartOf([line('v1', 1)], { email: 'maya@example.com', shippingAddress: address, shippingOption: 'flat', shippingOptions: [{ id: 'flat', provider: null, service: null, amount: usd(0), before: null, minDays: 3, maxDays: 5, hours: null }], checkoutStep: 'pay', readyToPay: true })
const start = { providerRef: 'pi_1', publicKey: 'pk_test_1', accountId: 'acct_1', clientSecret: 'pi_1_secret', sessionId: 'session_1', redirectUrl: 'https://mercury.phonepe.com/transact/abc' }
const options = (mode: string) => [
  { provider: 'stripe', kind: 'card', instructions: null, mode, publicKey: 'pk_test_1' },
  { provider: 'razorpay', kind: 'card', instructions: null, mode, publicKey: 'rzp_test_1' },
  { provider: 'cashfree', kind: 'card', instructions: null, mode, publicKey: null },
  { provider: 'phonepe', kind: 'card', instructions: null, mode, publicKey: null },
  { provider: 'paypal', kind: 'card', instructions: null, mode, publicKey: 'client-1' },
  { provider: 'cod', kind: 'cod', instructions: null, mode, publicKey: null },
  { provider: 'bank_transfer', kind: 'bank_transfer', instructions: 'IFSC KKBK0000123', mode, publicKey: null },
]

/** A Shop API in preview mode: the cart above, each provider's start, and the order once confirmed. */
const shop = (mode = 'test', extra: (a: Asked) => unknown = () => undefined) =>
  shopAnswering((a) => {
    const own = extra(a)
    if (own) return own
    if (a.query.includes('paymentOptions')) return { data: { paymentOptions: options(mode), store: { markets: [{ id: 'm', countries: ['US'] }] } } }
    if (a.query.includes('placeOrder')) return { data: { placeOrder: { orderId: 'o-1', total: usd(2800), instructions: null, payment: ['cod', 'bank_transfer'].includes(String(a.variables['provider'])) ? null : start } } }
    if (a.query.includes('checkout {')) return { data: { checkout: ready } }
    if (a.query.includes('confirmPayment')) return { data: { confirmPayment: { id: 'o-1' } } }
    if (a.query.includes('payOrder')) return { data: { payOrder: { ...start, providerRef: 'pi_2' } } }
    return { data: { cart: ready } }
  })

/** Each provider's SDK as the test drives it: what was loaded, and how each window or field was used. */
const fakeSdk = ({ declines = 0, dismiss = false, incomplete = 0, cashfreeFails = false, goFails = false }: { declines?: number; dismiss?: boolean; incomplete?: number; cashfreeFails?: boolean; goFails?: boolean } = {}) => {
  let declined = declines
  let unfinished = incomplete
  const loaded: string[] = []
  const went: string[] = []
  const g = globalThis as Record<string, unknown>
  const sdk: Sdk = {
    script: async (url) => {
      loaded.push(new URL(url).host)
    },
    go: (url) => {
      if (goFails) throw new Error('blocked')
      went.push(url)
    },
    stripe: async (key, opts) => {
      loaded.push(`stripe:${key}:${String(opts.stripeAccount)}`)
      return {
        elements: () => ({ create: (_: string, o: { wallets: unknown }) => ({ mount: () => void loaded.push(`wallets:${JSON.stringify(o.wallets)}`), destroy: () => undefined }) }),
        confirmPayment: async () => (unfinished-- > 0 ? { error: { type: 'validation_error', message: 'Your card number is incomplete.' } } : declined-- > 0 ? { error: { type: 'card_error', message: 'Your card was declined.' } } : {}),
      } as never
    },
  }
  g['Razorpay'] = class {
    constructor(private o: { handler: () => void; order_id: string; modal: { ondismiss: () => void } }) {}
    open() {
      went.push(`razorpay:${this.o.order_id}`)
      if (dismiss) this.o.modal.ondismiss()
      else this.o.handler()
    }
    close() {}
  }
  g['Cashfree'] = () => ({ checkout: async (o: { paymentSessionId: string }) => (cashfreeFails ? { error: { message: 'session expired' } } : void went.push(`cashfree:${o.paymentSessionId}`)) })
  g['paypal'] = { Buttons: (o: { createOrder: () => string; onApprove: () => void }) => ({ render: async () => (went.push(`paypal:${o.createOrder()}`), o.onApprove()), close: async () => undefined }) }
  checkoutSdk.current = sdk
  return { loaded, went }
}

let page: CheckoutPage
const Probe = () => {
  page = useCheckout()
  return <PaymentElement t={t} />
}
const mount = (mode: RenderMode = 'preview') => render(<Provided mode={mode} client={createShopClient({ state: storedShopState })}><Probe /></Provided>)

const assign = vi.fn()
beforeEach(() => {
  localStorage.setItem('df-cart', 'tok')
  assign.mockReset()
  vi.stubGlobal('location', { ...location, pathname: '/checkout/', origin: 'https://k7f3q9f2xa.webpreview.store', assign })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
  checkoutSdk.current = browserSdk
  for (const k of ['Razorpay', 'Cashfree', 'paypal']) Reflect.deleteProperty(globalThis, k)
})

const payWith = async (provider: string) => {
  await act(async () => undefined)
  act(() => page.choosePayment(provider))
  await act(async () => void (await page.review()))
  // A card's place() settles only once its provider does, so it isn't awaited here.
  await act(async () => void page.place())
  await act(async () => undefined)
  await act(async () => undefined)
}

describe('a test purchase in preview mode', () => {
  it.each([
    ['stripe', ['stripe:pk_test_1:acct_1', 'wallets:{"applePay":"never","googlePay":"never"}'], []],
    ['razorpay', ['checkout.razorpay.com'], ['razorpay:pi_1']],
    ['paypal', ['www.paypal.com'], ['paypal:pi_1']],
  ])('completes with %s and lands on the order’s page', async (provider, loads, windows) => {
    const asked = shop()
    const { loaded, went } = fakeSdk()
    mount()
    await payWith(provider)
    if (provider === 'stripe') {
      expect(page.phase.kind).toBe('paying')
      await act(async () => (page.phase.kind === 'paying' ? page.phase.submit?.() : undefined))
      await act(async () => undefined)
    }
    expect(loaded).toEqual(loads)
    expect(went).toEqual(windows)
    expect(asked.filter((a) => a.query.includes('placeOrder')).map((a) => a.variables)).toEqual([{ provider }])
    expect(asked.some((a) => a.query.includes('confirmPayment'))).toBe(true)
    expect(assign).toHaveBeenCalledWith('/order/o-1/')
  })

  it.each([
    ['cashfree', 'cashfree:session_1'],
    ['phonepe', 'https://mercury.phonepe.com/transact/abc'],
  ])('hands %s the shopper, who comes back to the order’s page', async (provider, away) => {
    shop()
    const { went } = fakeSdk()
    mount()
    await payWith(provider)
    expect(went).toEqual([away])
    expect(assign).not.toHaveBeenCalled()
  })

  it.each(['cod', 'bank_transfer'])('places a %s order with no provider at all', async (provider) => {
    shop()
    const { loaded } = fakeSdk()
    mount()
    await payWith(provider)
    expect(loaded).toEqual([])
    expect(assign).toHaveBeenCalledWith('/order/o-1/')
  })

  it('says it is a test in the preview, and offers wallets only on a live shop', async () => {
    shop()
    const preview = fakeSdk()
    const shown = mount()
    await payWith('stripe')
    const sealed = (c: HTMLElement) => {
      const host = c.querySelector('[data-df-sealed="payment"]')
      return (host && rootOf(host)?.textContent) ?? ''
    }
    expect(sealed(shown.container)).toContain('Test mode. No real payment is taken on this preview.')
    expect(preview.loaded).toContain('wallets:{"applePay":"never","googlePay":"never"}')
    cleanup()
    shop('live')
    const live = fakeSdk()
    const { container } = mount('live')
    await payWith('stripe')
    expect(live.loaded).toContain('wallets:{"applePay":"auto","googlePay":"auto"}')
    expect(sealed(container)).not.toContain('Test mode')
  })

  it('asks for another attempt after a declined card, and pays with it', async () => {
    const asked = shop()
    fakeSdk({ declines: 1 })
    mount()
    await payWith('stripe')
    await act(async () => (page.phase.kind === 'paying' ? page.phase.submit?.() : undefined))
    await act(async () => undefined)
    expect(page.phase).toMatchObject({ kind: 'failed', code: 'PAYMENT_FAILED', message: 'Your card was declined.' })
    await act(async () => void page.payAgain())
    await act(async () => undefined)
    await act(async () => (page.phase.kind === 'paying' ? page.phase.submit?.() : undefined))
    await act(async () => undefined)
    expect(asked.filter((a) => a.query.includes('payOrder')).map((a) => a.variables)).toEqual([{ orderId: 'o-1' }])
    expect(assign).toHaveBeenCalledWith('/order/o-1/')
  })
})

describe('in the studio frame', () => {
  it('shows the placeholder, loads no payment SDK and places nothing', async () => {
    const asked = shop()
    const { loaded } = fakeSdk()
    const { container } = mount('studio')
    await payWith('stripe')
    const host = container.querySelector('[data-df-sealed="payment"]')
    expect(host && rootOf(host)?.textContent).toBe('Checkout works in Open preview')
    expect(loaded).toEqual([])
    expect(asked.some((a) => a.query.includes('placeOrder'))).toBe(false)
  })
})

describe('one order per cart', () => {
  const placed = (asked: Asked[]) => asked.filter((a) => a.query.includes('placeOrder')).length
  const sealedText = (c: HTMLElement) => {
    const host = c.querySelector('[data-df-sealed="payment"]')
    return (host && rootOf(host)?.textContent) ?? ''
  }

  it('places nothing more while a card is being paid or its payment confirmed', async () => {
    const held = later<unknown>()
    const asked = shop('test', (a) => (a.query.includes('confirmPayment') ? held.promise : undefined))
    fakeSdk()
    mount()
    await payWith('stripe')
    expect(page.phase.kind).toBe('paying')
    await act(async () => void page.place())
    expect(placed(asked)).toBe(1)
    await act(async () => (page.phase.kind === 'paying' ? page.phase.submit?.() : undefined))
    await act(async () => undefined)
    expect(page.phase.kind).toBe('confirming')
    await act(async () => void page.place())
    expect(placed(asked)).toBe(1)
    held.settle({ data: { confirmPayment: { id: 'o-1' } } })
    await act(async () => undefined)
  })

  it('after a closed payment window, says so, and only another attempt goes on', async () => {
    const asked = shop()
    fakeSdk({ dismiss: true })
    const { container } = mount()
    await payWith('razorpay')
    expect(page.phase).toMatchObject({ kind: 'failed', orderId: 'o-1', code: 'PAYMENT_CANCELLED' })
    expect(sealedText(container)).toContain('The payment was closed before it finished.')
    await act(async () => void page.place())
    expect(placed(asked)).toBe(1)
  })

  it('says an order the engine refused wasn’t placed, not that a payment failed', async () => {
    shop('test', (a) => (a.query.includes('placeOrder') ? { errors: [{ message: 'sold out', extensions: { code: 'OUT_OF_STOCK' } }] } : undefined))
    fakeSdk()
    const { container } = mount()
    await payWith('cod')
    expect(page.phase).toMatchObject({ kind: 'failed', orderId: null, code: 'OUT_OF_STOCK' })
    expect(sealedText(container)).toContain('Your order wasn’t placed and nothing was charged.')
    expect(sealedText(container)).not.toContain('payment didn’t go through')
  })

  it('keeps Stripe’s field open for a number to correct, saying what, then pays', async () => {
    shop()
    fakeSdk({ incomplete: 1 })
    const { container } = mount()
    await payWith('stripe')
    await act(async () => (page.phase.kind === 'paying' ? page.phase.submit?.() : undefined))
    await act(async () => undefined)
    expect(page.phase).toMatchObject({ kind: 'paying', note: 'Your card number is incomplete.' })
    expect(sealedText(container)).toContain('Your card number is incomplete.')
    await act(async () => (page.phase.kind === 'paying' ? page.phase.submit?.() : undefined))
    await act(async () => undefined)
    expect(assign).toHaveBeenCalledWith('/order/o-1/')
  })

  it('says so when Cashfree or PhonePe can’t take the shopper away, and offers another attempt', async () => {
    for (const [provider, opts] of [['cashfree', { cashfreeFails: true }], ['phonepe', { goFails: true }]] as const) {
      shop()
      fakeSdk(opts)
      mount()
      await payWith(provider)
      expect(page.phase).toMatchObject({ kind: 'failed', orderId: 'o-1', code: 'PAYMENT_FAILED' })
      cleanup()
    }
  })

  it('tells a shopper leaving for Cashfree where they are going', async () => {
    shop()
    fakeSdk()
    const { container } = mount()
    await payWith('cashfree')
    expect(page.phase).toMatchObject({ kind: 'leaving', orderId: 'o-1' })
    expect(sealedText(container)).toContain('Taking you to the payment page…')
  })

  it('refuses to open Razorpay without its key', async () => {
    shop('test', (a) => (a.query.includes('placeOrder') ? { data: { placeOrder: { orderId: 'o-1', total: usd(2800), instructions: null, payment: { ...start, publicKey: null } } } } : undefined))
    const { went } = fakeSdk()
    mount()
    await payWith('razorpay')
    expect(went).toEqual([])
    expect(page.phase).toMatchObject({ kind: 'failed', orderId: 'o-1', code: 'PAYMENT_UNAVAILABLE' })
  })
})
