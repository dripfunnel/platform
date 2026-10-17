// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cartOf, line, usd } from '../../test/cart'
import { Provided, shopAnswering } from '../../test/shop'
import { createShopClient } from '../platform/api/client'
import { guestShopState, storedShopState } from '../platform/api/tokens'
import { addressProblems, isPhone } from './address'
import { addressDraft, useCheckout, type CheckoutPage } from './checkout'

const us = { name: 'Maya Chen', line1: '88 Neil Ave', line2: null, city: 'Columbus', region: 'OH', postalCode: '43215', country: 'US', phone: null }
const flat = { id: 'flat', provider: null, service: null, amount: usd(0), before: null, minDays: 3, maxDays: 5, hours: null }

/** A cart the engine moves through checkout as the Shop API does (FIRST-RELEASE §19): contact, ship, pay. */
const engine = (extra: Record<string, unknown> = {}) => {
  const cart: Record<string, unknown> = { ...cartOf([line('v1', 1)]), ...extra }
  const asked = shopAnswering((a) => {
    const v = a.variables
    if (a.query.includes('setCartContact')) Object.assign(cart, { email: v['email'], phone: v['phone'] })
    else if (a.query.includes('setShippingAddress')) Object.assign(cart, { shippingAddress: { ...(v['address'] as object) }, shippingOptions: [flat], checkoutStep: 'ship' })
    else if (a.query.includes('setShippingOption')) Object.assign(cart, { shippingOption: v['option'], shipping: usd(0) })
    else if (a.query.includes('checkout {')) {
      if (!cart['email']) return { errors: [{ message: 'not ready', extensions: { code: 'NOT_READY' } }] }
      Object.assign(cart, { checkoutStep: 'pay', readyToPay: true })
      return { data: { checkout: cart } }
    } else if (a.query.includes('paymentOptions')) return { data: { paymentOptions: [{ provider: 'cod', kind: 'cod', instructions: null, mode: 'test', publicKey: null }], store: { markets: [{ id: 'm', countries: ['US', 'IN'] }] } } }
    else if (a.query.includes('placeOrder')) return { errors: [{ message: 'sold out', extensions: { code: 'OUT_OF_STOCK' } }] }
    else if (a.query.startsWith('query Cart')) return { data: { cart } }
    const key = Object.keys({ setCartContact: 1, setShippingAddress: 1, setShippingOption: 1 }).find((k) => a.query.includes(k)) ?? 'x'
    return { data: { [key]: { cart } } }
  })
  return { cart, asked }
}

let page: CheckoutPage
const Probe = () => {
  page = useCheckout()
  return null
}
const mount = (state = storedShopState) => render(<Provided client={createShopClient({ state })}><Probe /></Provided>)
const open = () => page.steps.find((s) => s.state === 'open')?.id

beforeEach(() => localStorage.setItem('df-cart', 'tok'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('useCheckout', () => {
  it('opens each step once the engine has the one before, and Change opens a finished one again', async () => {
    engine()
    mount()
    await act(async () => undefined)
    expect(page.steps.map((s) => s.id)).toEqual(['contact', 'address', 'delivery', 'payment', 'review'])
    expect(open()).toBe('contact')
    let errors = {}
    await act(async () => void (errors = await page.saveContact({ email: 'not an email', phone: '' })))
    expect(errors).toEqual({ email: 'invalid' })
    await act(async () => void (await page.saveContact({ email: 'maya@example.com', phone: '' })))
    expect(open()).toBe('address')
    expect(page.countries).toEqual(['US', 'IN'])
    await act(async () => void (errors = await page.saveAddress({ ...addressDraft(null, 'US'), name: 'Maya' })))
    expect(errors).toEqual({ line1: 'required', city: 'required', region: 'required', postalCode: 'required' })
    await act(async () => void (await page.saveAddress(addressDraft(us, 'US'))))
    expect(open()).toBe('delivery')
    await act(async () => void (await page.chooseDelivery('flat')))
    expect(open()).toBe('payment')
    expect(page.chosen).toBe('cod')
    await act(async () => void (await page.review()))
    expect(open()).toBe('review')
    act(() => page.edit('address'))
    expect(open()).toBe('address')
  })

  it('skips the address and delivery when nothing is sent', async () => {
    engine({ needsShipping: false })
    mount()
    await act(async () => undefined)
    expect(page.steps.map((s) => s.id)).toEqual(['contact', 'payment', 'review'])
  })

  it('keeps the engine’s refusal when placing, and the cart is read again', async () => {
    const { asked } = engine({ email: 'maya@example.com', shippingAddress: us, shippingOption: 'flat', shippingOptions: [flat], checkoutStep: 'pay', readyToPay: true })
    mount()
    await act(async () => undefined)
    act(() => page.choosePayment('cod'))
    await act(async () => void (await page.place()))
    expect(page.phase).toMatchObject({ kind: 'failed', orderId: null, code: 'OUT_OF_STOCK' })
    expect(asked.filter((a) => a.query.startsWith('query Cart')).length).toBe(2)
  })

  it('checks out as a guest on a preview, never sending a kept session', async () => {
    localStorage.setItem('df-session', 'sess')
    engine()
    mount(guestShopState)
    await act(async () => undefined)
    const headers = vi.mocked(globalThis.fetch).mock.calls.map((c) => new Headers((c[1] as RequestInit).headers))
    expect(headers.length).toBeGreaterThan(0)
    expect(headers.every((h) => h.get('x-shop-session') === null && h.get('x-shop-cart') === 'tok')).toBe(true)
  })
})

describe('a spaced phone', () => {
  it('is sent to the API without spaces or dashes', async () => {
    const { asked } = engine()
    mount()
    await act(async () => undefined)
    await act(async () => void (await page.saveContact({ email: 'maya@example.com', phone: ' +91 90647-79543 ' })))
    expect(asked.find((a) => a.query.includes('setCartContact'))?.variables).toEqual({ email: 'maya@example.com', phone: '+919064779543' })
    await act(async () => void (await page.saveAddress({ ...addressDraft(us, 'US'), phone: '+91 90647-79543' })))
    expect((asked.find((a) => a.query.includes('setShippingAddress'))?.variables?.['address'] as { phone: string }).phone).toBe('+919064779543')
  })
})

describe('addressProblems', () => {
  it('asks each country for its own fields and formats', () => {
    expect(addressProblems({ ...addressDraft(us, 'US'), postalCode: '4321' })).toEqual({ postalCode: 'invalid' })
    expect(addressProblems({ ...addressDraft({ ...us, country: 'IN', postalCode: '560038', region: 'Karnataka' }, 'IN') })).toEqual({})
    expect(addressProblems({ ...addressDraft({ ...us, country: 'IN', postalCode: '5600', region: '' }, 'IN') })).toEqual({ postalCode: 'invalid', region: 'required' })
    expect(addressProblems({ ...addressDraft({ ...us, country: 'FR', postalCode: null, region: null }, 'FR') })).toEqual({})
    expect(addressProblems({ ...addressDraft(us, 'US'), phone: 'call me' })).toEqual({ phone: 'invalid' })
  })
  it('takes a phone only with its country code, as the API does', () => {
    expect(isPhone('+91 90647-79543')).toBe(true)
    expect(isPhone('19064279543')).toBe(false)
    expect(addressProblems({ ...addressDraft(us, 'US'), phone: '9876543210' })).toEqual({ phone: 'invalid' })
  })
})
