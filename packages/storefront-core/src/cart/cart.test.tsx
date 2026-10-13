// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cartOf, line, usd } from '../../test/cart'
import { later, Provided, shopAnswering, type Asked } from '../../test/shop'
import { createShopClient } from '../platform/api/client'
import { storedShopState } from '../platform/api/tokens'
import { useCart, type CartPage } from './cart'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
})
beforeEach(() => history.replaceState(null, '', '/'))

let page: CartPage
const Probe = () => {
  page = useCart()
  return <p data-testid="count">{page.status === 'ready' ? `${page.count} ${page.cart?.lines.map((l) => `${l.versionId}×${l.quantity}${l.pending ? '…' : ''}`).join(',') ?? ''}` : page.status}</p>
}
const mount = () => render(<Provided client={createShopClient({ state: storedShopState })}><Probe /></Provided>)
const count = () => screen.getByTestId('count').textContent

describe('useCart', () => {
  it('asks nothing without a token and shows an empty cart; a first add keeps the cart token the engine hands out', async () => {
    const asked = shopAnswering(({ query }) => (query.includes('addToCart') ? { data: { addToCart: { cartToken: 'tok-1', cart: cartOf([line('v1', 1)]) } } } : { data: { cart: null } }))
    mount()
    await act(async () => undefined)
    expect(count()).toBe('0 ')
    expect(asked).toEqual([])
    await act(async () => void (await page.add('v1')))
    expect(count()).toBe('1 v1×1')
    expect(localStorage.getItem('df-cart')).toBe('tok-1')
  })

  it('sends the kept token, shows a change at once and takes the engine’s answer for it', async () => {
    localStorage.setItem('df-cart', 'tok-1')
    const held = later<unknown>()
    const headers: (string | null)[] = []
    const asked: Asked[] = shopAnswering((a) => (a.query.includes('setCartQuantity') ? held.promise : { data: { cart: cartOf([line('v1', 1), line('v2', 2)]) } }))
    const fetch = vi.mocked(globalThis.fetch)
    mount()
    await act(async () => undefined)
    expect(count()).toBe('3 v1×1,v2×2')
    void act(() => void page.setQuantity('v1', 3))
    await act(async () => undefined)
    expect(count()).toBe('5 v1×3…,v2×2')
    held.settle({ data: { setCartQuantity: { cartToken: null, cart: cartOf([line('v1', 3), line('v2', 2)]) } } })
    await act(async () => undefined)
    expect(count()).toBe('5 v1×3,v2×2')
    expect(page.cart?.subtotal).toEqual(usd(2800 * 5))
    for (const call of fetch.mock.calls) headers.push(new Headers((call[1] as RequestInit).headers).get('x-shop-cart'))
    expect(headers.every((h) => h === 'tok-1')).toBe(true)
    expect(asked.map((a) => a.variables)).toEqual([{}, { versionId: 'v1', quantity: 3 }])
  })

  it('takes a refused change back and says why', async () => {
    localStorage.setItem('df-cart', 'tok-1')
    shopAnswering(({ query }) => (query.includes('setCartQuantity') ? { errors: [{ message: 'That isn’t available any more.', extensions: { code: 'UNAVAILABLE' } }] } : { data: { cart: cartOf([line('v1', 2)]) } }))
    mount()
    await act(async () => undefined)
    await act(async () => void (await page.remove('v1')))
    expect(count()).toBe('2 v1×2')
    expect(page.error).toBe('UNAVAILABLE')
  })

  it('forgets an expired cart and adds to a new one', async () => {
    localStorage.setItem('df-cart', 'old')
    let tries = 0
    shopAnswering(({ query }) => {
      if (!query.includes('addToCart')) return { data: { cart: cartOf([]) } }
      tries += 1
      return tries === 1 ? { errors: [{ message: 'expired', extensions: { code: 'NO_CART' } }] } : { data: { addToCart: { cartToken: 'new', cart: cartOf([line('v1', 1)]) } } }
    })
    mount()
    await act(async () => undefined)
    await act(async () => void (await page.add('v1')))
    expect(tries).toBe(2)
    expect(localStorage.getItem('df-cart')).toBe('new')
    expect(count()).toBe('1 v1×1')
  })

  it('buys now by adding to the cart and opening checkout, and stays put when the add is refused', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...location, pathname: '/products/organic-cotton-tee/', origin: location.origin, assign })
    let refuse = true
    shopAnswering(() => (refuse ? { errors: [{ message: 'gone', extensions: { code: 'UNAVAILABLE' } }] } : { data: { addToCart: { cartToken: 't', cart: cartOf([line('v1', 2)]) } } }))
    mount()
    await act(async () => undefined)
    await act(async () => void (await page.buyNow('v1', 2)))
    expect(assign).not.toHaveBeenCalled()
    refuse = false
    await act(async () => void (await page.buyNow('v1', 2)))
    expect(assign).toHaveBeenCalledWith('/checkout/')
  })

  it('answers a code’s state and shows the cart the engine priced with it', async () => {
    localStorage.setItem('df-cart', 'tok-1')
    shopAnswering(({ query }) => (query.includes('applyCode') ? { data: { applyCode: { state: 'APPLIED', cart: cartOf([line('v1', 1)], { codes: [{ code: 'AUTUMN', state: 'APPLIED' }], discount: usd(280), discounts: [{ name: 'Autumn', code: 'AUTUMN', amount: usd(280) }] }) } } } : { data: { cart: cartOf([line('v1', 1)]) } }))
    mount()
    await act(async () => undefined)
    let state: string | null = null
    await act(async () => void (state = await page.applyCode('AUTUMN')))
    expect(state).toBe('APPLIED')
    expect(page.cart?.codes).toEqual([{ code: 'AUTUMN', state: 'APPLIED' }])
    expect(page.cart?.discounts).toEqual([{ name: 'Autumn', code: 'AUTUMN', amount: usd(280) }])
  })

  it('says the cart failed to load, and loads it again on retry', async () => {
    localStorage.setItem('df-cart', 'tok-1')
    let up = false
    shopAnswering(() => (up ? { data: { cart: cartOf([line('v1', 1)]) } } : { errors: [{ message: 'down', extensions: { code: 'UNAVAILABLE' } }] }))
    mount()
    await act(async () => undefined)
    expect(count()).toBe('error')
    expect(page.code).toBe('UNAVAILABLE')
    up = true
    await act(async () => page.retry())
    expect(count()).toBe('1 v1×1')
  })

  it('never lets an older read land over a newer change’s answer', async () => {
    localStorage.setItem('df-cart', 'tok-1')
    const read = later<unknown>()
    let reads = 0
    const now = cartOf([line('v1', 1), line('v2', 1)])
    shopAnswering((a) => (a.query.startsWith('query Cart') ? ((reads += 1) === 1 ? read.promise : { data: { cart: now } }) : { data: { addToCart: { cartToken: null, cart: now } } }))
    mount()
    await act(async () => undefined)
    const added = page.add('v2')
    await act(async () => undefined)
    read.settle({ data: { cart: cartOf([line('v1', 1)]) } })
    await act(async () => void (await added))
    expect(count()).toBe('2 v1×1,v2×1')
    await act(async () => page.retry())
    expect(count()).toBe('2 v1×1,v2×1')
  })
})
