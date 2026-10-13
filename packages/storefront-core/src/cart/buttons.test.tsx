// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cartOf, line } from '../../test/cart'
import { Provided, shopAnswering } from '../../test/shop'
import { createShopClient } from '../platform/api/client'
import { storedShopState } from '../platform/api/tokens'
import { AddToCart, BuyNow } from './buttons'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('AddToCart and BuyNow', () => {
  it('wait for a version, carry the smoke test’s marker, and add the version when pressed', async () => {
    const asked = shopAnswering(() => ({ data: { addToCart: { cartToken: 't', cart: cartOf([line('v1', 2)]) } } }))
    const done = vi.fn()
    const { rerender } = render(
      <Provided client={createShopClient({ state: storedShopState })}>
        <AddToCart versionId={null}>Add</AddToCart>
      </Provided>,
    )
    expect(screen.getByRole('button', { name: 'Add' })).toHaveProperty('disabled', true)
    rerender(
      <Provided client={createShopClient({ state: storedShopState })}>
        <AddToCart versionId="v1" quantity={2} onDone={done}>
          Add
        </AddToCart>
      </Provided>,
    )
    const button = screen.getByRole('button', { name: 'Add' })
    expect(button.getAttribute('data-df-action')).toBe('add-to-cart')
    await act(async () => void fireEvent.click(button))
    expect(asked.map((a) => a.variables)).toEqual([{ versionId: 'v1', quantity: 2 }])
    expect(done).toHaveBeenCalledWith(true)
  })

  it('opens checkout after buying now', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...location, pathname: '/products/tee/', origin: location.origin, assign })
    shopAnswering(() => ({ data: { addToCart: { cartToken: 't', cart: cartOf([line('v1', 1)]) } } }))
    render(
      <Provided client={createShopClient({ state: storedShopState })}>
        <BuyNow versionId="v1">Buy now</BuyNow>
      </Provided>,
    )
    expect(screen.getByRole('button', { name: 'Buy now' }).getAttribute('data-df-action')).toBe('buy-now')
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Buy now' })))
    expect(assign).toHaveBeenCalledWith('/checkout/')
  })
})

describe('when the engine refuses', () => {
  it('tells the theme the add failed, and buy now stays on the page', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...location, pathname: '/products/tee/', origin: location.origin, assign })
    shopAnswering(() => ({ errors: [{ message: 'gone', extensions: { code: 'UNAVAILABLE' } }] }))
    const added = vi.fn()
    const bought = vi.fn()
    render(
      <Provided client={createShopClient({ state: storedShopState })}>
        <AddToCart versionId="v1" onDone={added}>
          Add
        </AddToCart>
        <BuyNow versionId="v1" onDone={bought}>
          Buy now
        </BuyNow>
        <AddToCart versionId="v2" disabled>
          Sold out
        </AddToCart>
      </Provided>,
    )
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Add' })))
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Buy now' })))
    expect(added).toHaveBeenCalledWith(false)
    expect(bought).toHaveBeenCalledWith(false)
    expect(assign).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Sold out' })).toHaveProperty('disabled', true)
  })
})
