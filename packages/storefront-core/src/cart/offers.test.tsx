// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cartOf, line, usd } from '../../test/cart'
import { Provided, shopAnswering } from '../../test/shop'
import { createShopClient } from '../platform/api/client'
import { storedShopState } from '../platform/api/tokens'
import { useAvailableOffers, type AvailableOffersPage } from './cart'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
})
beforeEach(() => history.replaceState(null, '', '/'))

let page: AvailableOffersPage
const Probe = () => {
  page = useAvailableOffers()
  return <p data-testid="offers">{`${page.status} ${page.offers.map((o) => `${o.code}:${o.savesText}`).join(',')}`}</p>
}
const mount = () => render(<Provided client={createShopClient({ state: storedShopState })}><Probe /></Provided>)
const shown = () => screen.getByTestId('offers').textContent
const settle = () => act(async () => undefined)

const summer = { name: 'Summer 20% off', code: 'SUMMER20', saves: usd(560) }
const asksOffers = (query: string) => query.includes('availableOffers')

describe('useAvailableOffers (#1698)', () => {
  it('asks nothing without a cart, and nothing for an empty one', async () => {
    const asked = shopAnswering(() => ({ data: { cart: null } }))
    mount()
    await settle()
    expect(shown()).toBe('ready ')
    expect(asked).toEqual([])
  })

  it('asks for the offers once the cart is read, and shows each with what it saves', async () => {
    localStorage.setItem('df-cart', 'tok-1')
    const asked = shopAnswering(({ query }) => (asksOffers(query) ? { data: { cart: { availableOffers: [summer] } } } : { data: { cart: cartOf([line('v1', 1)]) } }))
    mount()
    expect(shown()).toBe('loading ')
    await settle()
    expect(shown()).toBe('ready SUMMER20:$5.60')
    expect(asked.filter((a) => asksOffers(a.query))).toHaveLength(1)
  })

  it('applies an offer by its code, hides it once it is on the cart, and asks again for the changed cart', async () => {
    localStorage.setItem('df-cart', 'tok-1')
    let held = false
    const asked = shopAnswering(({ query }) => {
      if (query.includes('applyCode')) {
        held = true
        return { data: { applyCode: { state: 'APPLIED', cart: cartOf([line('v1', 1)], { codes: [{ code: 'SUMMER20', state: 'APPLIED' }], discount: usd(560) }) } } }
      }
      if (asksOffers(query)) return { data: { cart: { availableOffers: held ? [] : [summer] } } }
      return { data: { cart: cartOf([line('v1', 1)]) } }
    })
    mount()
    await settle()
    let worked = false
    await act(async () => void (worked = await page.apply('SUMMER20')))
    expect(worked).toBe(true)
    expect(asked.find((a) => a.query.includes('applyCode'))?.variables).toEqual({ code: 'SUMMER20' })
    await settle()
    expect(shown()).toBe('ready ')
    expect(page.applying).toBeNull()
    expect(page.refused).toBeNull()
    expect(asked.filter((a) => asksOffers(a.query))).toHaveLength(2)
  })

  it('says why a code was refused and leaves the list as it was', async () => {
    localStorage.setItem('df-cart', 'tok-1')
    shopAnswering(({ query }) => {
      if (query.includes('applyCode')) return { data: { applyCode: { state: 'NOT_ELIGIBLE', cart: cartOf([line('v1', 1)]) } } }
      if (asksOffers(query)) return { data: { cart: { availableOffers: [summer] } } }
      return { data: { cart: cartOf([line('v1', 1)]) } }
    })
    mount()
    await settle()
    await act(async () => void (await page.apply('SUMMER20')))
    expect(page.refused).toBe('NOT_ELIGIBLE')
    expect(shown()).toBe('ready SUMMER20:$5.60')
  })

  it('reports a failed read, keeps the cart usable, and tries again on retry', async () => {
    localStorage.setItem('df-cart', 'tok-1')
    let failing = true
    shopAnswering(({ query }) => {
      if (!asksOffers(query)) return { data: { cart: cartOf([line('v1', 1)]) } }
      return failing ? { errors: [{ message: 'down', extensions: { code: 'INTERNAL' } }] } : { data: { cart: { availableOffers: [summer] } } }
    })
    mount()
    await settle()
    expect(shown()).toBe('error ')
    failing = false
    await act(async () => page.retry())
    await settle()
    expect(shown()).toBe('ready SUMMER20:$5.60')
  })
})
