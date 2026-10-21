// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usd } from '../../test/cart'
import { orderOf } from '../../test/order'
import { later, Provided, shopAnswering } from '../../test/shop'
import { createShopClient } from '../platform/api/client'
import { shopperToken, storedShopState } from '../platform/api/tokens'
import type { RenderMode } from '../platform/store/context'
import { useOrders, type OrdersPage } from './order'

let seen: OrdersPage | null = null
const Probe = () => {
  seen = useOrders()
  return null
}
const page = () => {
  if (!seen) throw new Error('not rendered')
  return seen
}
const show = async (mode: RenderMode = 'live') => {
  render(
    <Provided mode={mode} client={createShopClient({ state: storedShopState })}>
      <Probe />
    </Provided>,
  )
  await act(async () => undefined)
}
const ordersOf = (nodes: unknown[], endCursor: string | null = null) => ({ data: { orders: { nodes, pageInfo: { hasNextPage: endCursor !== null, endCursor } } } })

afterEach(() => {
  cleanup()
  seen = null
  sessionStorage.clear()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('useOrders', () => {
  it('asks nothing and is signed out on a preview, or with no session', async () => {
    sessionStorage.setItem('df-session', 'sess-1')
    const asked = shopAnswering(() => ordersOf([]))
    await show('preview')
    expect(page().status).toBe('signedOut')
    cleanup()
    await show('studio')
    expect(page().status).toBe('signedOut')
    cleanup()
    sessionStorage.clear()
    await show('live')
    expect(page().status).toBe('signedOut')
    expect(asked).toHaveLength(0)
  })

  it('is loading until the Shop API answers, then lists each order as a row', async () => {
    sessionStorage.setItem('df-session', 'sess-1')
    const answer = later<unknown>()
    const asked = shopAnswering(() => answer.promise)
    await show()
    expect(page().status).toBe('loading')
    expect(asked[0]?.variables).toEqual({ first: 20, after: null })
    await act(async () => answer.settle(ordersOf([orderOf(), orderOf({ id: 'o-2', number: '1052', state: 'cancelled', paymentState: 'refunded', lines: [{ quantity: 1 }, { quantity: 3 }], total: usd(900), pricesIncludeTax: true })])))
    expect(page()).toMatchObject({ status: 'ready', empty: false, more: false })
    expect(page().orders).toEqual([
      { id: 'o-1', number: '1051', placedOn: 'Oct 13, 2026', items: 2, cancelled: false, payment: 'paid', method: 'stripe', total: usd(5440), includesTax: false },
      { id: 'o-2', number: '1052', placedOn: 'Oct 13, 2026', items: 4, cancelled: true, payment: 'refunded', method: 'stripe', total: usd(900), includesTax: true },
    ])
    expect(document.title).toContain('Your orders')
  })

  it('is empty when the shopper has no orders yet', async () => {
    sessionStorage.setItem('df-session', 'sess-1')
    shopAnswering(() => ordersOf([]))
    await show()
    expect(page()).toMatchObject({ status: 'ready', empty: true, orders: [] })
  })

  it('adds the next page below with Load more, from the cursor the last page ended at', async () => {
    sessionStorage.setItem('df-session', 'sess-1')
    let fail = false
    const asked = shopAnswering((a) => {
      if (a.variables['after'] === null) return ordersOf([orderOf()], 'c-1')
      if (fail) return { errors: [{ message: 'no', extensions: { code: 'INTERNAL' } }] }
      return a.variables['after'] === 'c-1' ? ordersOf([orderOf({ id: 'o-2', number: '1050' })], 'c-2') : ordersOf([orderOf({ id: 'o-3', number: '1049' })])
    })
    await show()
    expect(page().more).toBe(true)
    await act(async () => page().loadMore())
    expect(asked[1]?.variables).toEqual({ first: 20, after: 'c-1' })
    expect(page().orders.map((o) => o.number)).toEqual(['1051', '1050'])
    fail = true
    await act(async () => page().loadMore())
    expect(page()).toMatchObject({ loadMoreFailed: true, more: true })
    fail = false
    await act(async () => page().loadMore())
    expect(page().orders.map((o) => o.number)).toEqual(['1051', '1050', '1049'])
    expect(page()).toMatchObject({ more: false, loadMoreFailed: false })
  })

  it('shows an error to try again, and is signed out, the session forgotten, when it has ended', async () => {
    sessionStorage.setItem('df-session', 'sess-1')
    let code = 'INTERNAL'
    const asked = shopAnswering(() => (code === 'none' ? ordersOf([orderOf()]) : { errors: [{ message: 'no', extensions: { code } }] }))
    await show()
    expect(page()).toMatchObject({ status: 'error', code: 'INTERNAL' })
    code = 'none'
    await act(async () => page().retry())
    expect(asked).toHaveLength(2)
    expect(page().status).toBe('ready')
    cleanup()
    code = 'SIGNED_OUT'
    await show()
    expect(page().status).toBe('signedOut')
    expect(shopperToken('session')).toBeUndefined()
  })
})
