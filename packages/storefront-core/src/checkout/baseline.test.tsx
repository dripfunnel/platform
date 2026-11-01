// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cartOf, line, usd } from '../../test/cart'
import { Provided, shopAnswering } from '../../test/shop'
import { createShopClient } from '../platform/api/client'
import { storedShopState } from '../platform/api/tokens'
import { BaselineCheckout } from './baseline'
import { CheckoutBoundary } from './fallback'

const flat = { id: 'flat', provider: null, service: null, amount: usd(0), before: null, minDays: 3, maxDays: 5, hours: null }

/** A Shop API that moves the cart as the engine does, in the preview's test mode. */
const engine = () => {
  const cart = cartOf([line('v1', 1)])
  return shopAnswering((a) => {
    const v = a.variables
    const change = (key: string) => ({ data: { [key]: { cart, cartToken: null } } })
    if (a.query.includes('paymentOptions')) return { data: { paymentOptions: [{ provider: 'cod', kind: 'cod', instructions: null, mode: 'test', publicKey: null }], store: { markets: [{ id: 'm', countries: ['US'] }] } } }
    if (a.query.includes('setCartContact')) return (Object.assign(cart, { email: v['email'], phone: v['phone'] }), change('setCartContact'))
    if (a.query.includes('setShippingAddress')) return (Object.assign(cart, { shippingAddress: v['address'], shippingOptions: [flat], checkoutStep: 'ship' }), change('setShippingAddress'))
    if (a.query.includes('setShippingOption')) return (Object.assign(cart, { shippingOption: v['option'], shipping: usd(0) }), change('setShippingOption'))
    if (a.query.includes('checkout {')) return (Object.assign(cart, { checkoutStep: 'pay', readyToPay: true }), { data: { checkout: cart } })
    if (a.query.includes('placeOrder')) return { data: { placeOrder: { orderId: 'o-1', total: usd(2800), instructions: null, payment: null } } }
    return { data: { cart } }
  })
}

const assign = vi.fn()
beforeEach(() => {
  localStorage.setItem('df-cart', 'tok')
  vi.stubGlobal('location', { ...location, pathname: '/checkout/', origin: 'https://k7f3q9f2xa.webpreview.store', assign })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
  assign.mockReset()
})

const settle = () => act(async () => undefined)
const show = async (children = <BaselineCheckout />) => {
  render(<Provided client={createShopClient({ state: storedShopState })}>{children}</Provided>)
  await settle()
}
const press = async (name: string | RegExp) => {
  fireEvent.click(screen.getByRole('button', { name }))
  await settle()
}
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } })

describe('the baseline checkout', () => {
  it('takes a test purchase through every step in core’s words, with the preview banner and the sealed summary and payment element', async () => {
    const asked = engine()
    await show()
    expect(screen.getByRole('heading', { level: 1, name: 'Checkout' })).toBeTruthy()
    expect(screen.getByText('Secure checkout')).toBeTruthy()
    expect(document.querySelector('[data-df-sealed="preview"]')).not.toBeNull()
    expect(document.querySelector('[data-df-sealed="summary"]')).not.toBeNull()
    type('Email', 'maya')
    await press('Continue')
    expect(screen.getByText('Check this; it doesn’t look right.')).toBeTruthy()
    type('Email', 'maya@example.com')
    await press('Continue')
    type('Full name', 'Maya Chen')
    type('Address', '88 Neil Ave')
    type('City', 'Columbus')
    type('State', 'OH')
    type('ZIP code', '43215')
    await press('Continue')
    // The store offers one delivery option, so it is applied automatically and no delivery step is shown.
    await settle()
    expect(screen.queryByRole('radio', { name: /Standard delivery/ })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Cash on delivery' }))
    await press('Continue')
    expect(document.querySelector('[data-df-sealed="payment"]')).not.toBeNull()
    await press('Place order')
    expect(asked.filter((a) => a.query.includes('placeOrder')).map((a) => a.variables)).toEqual([{ provider: 'cod' }])
    expect(assign).toHaveBeenCalledWith('/order/o-1/')
  })

  it('takes the mobile number beside a country code that starts in the store’s market, and saves it once as E.164', async () => {
    const asked = engine()
    await show()
    const code = screen.getAllByLabelText('Country code')[0] as HTMLSelectElement
    expect(code.value).toBe('US')
    type('Email', 'maya@example.com')
    type('Mobile number', '(614) 555-0100')
    await press('Continue')
    expect(asked.filter((a) => a.query.includes('setCartContact')).map((a) => a.variables)).toEqual([{ email: 'maya@example.com', phone: '+16145550100' }])
  })

  it('reopens a finished step with Change, and says when there is nothing to check out', async () => {
    engine()
    await show()
    type('Email', 'maya@example.com')
    await press('Continue')
    await press('Change Contact')
    expect((screen.getByLabelText('Email', { exact: false }) as HTMLInputElement).value).toBe('maya@example.com')
    cleanup()
    localStorage.clear()
    await show()
    expect(screen.getByRole('heading', { level: 1, name: 'There’s nothing to check out' })).toBeTruthy()
  })

  it('is what a shopper whose theme checkout throws gets instead', async () => {
    engine()
    const Broken = () => {
      throw new Error('theme checkout broke')
    }
    await show(
      <CheckoutBoundary baseline={<BaselineCheckout />}>
        <Broken />
      </CheckoutBoundary>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Checkout' })).toBeTruthy()
    expect(screen.getByText('Secure checkout')).toBeTruthy()
  })
})
