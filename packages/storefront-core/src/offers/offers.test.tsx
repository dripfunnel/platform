// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Provided, shopAnswering } from '../../test/shop'
import { useOffers } from './offers'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const start = new Date('2026-11-04T10:00:00Z')
const offer = (id: string, endsAt: string | null, over: Record<string, unknown> = {}) => ({ id, name: `Offer ${id}`, description: null, endsAt, appliesTo: 'PRODUCTS', products: ['linen-shirt'], collections: ['summer'], ...over })

const Banner = () => {
  const { offers } = useOffers()
  return (
    <ul>
      {offers.map((o) => (
        <li key={o.id}>{`${o.name}|${o.appliesTo}|${o.products.map((p) => p.href).join()}|${o.collections.map((c) => c.href).join()}`}</li>
      ))}
    </ul>
  )
}

describe('useOffers', () => {
  it('lists the offers with where each applies, and drops one the moment it ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: start })
    const asked = shopAnswering(() => ({ data: { offers: [offer('a', '2026-11-04T10:00:05Z'), offer('b', null, { appliesTo: 'SHIPPING', products: [], collections: [] })] } }))
    render(<Provided><Banner /></Provided>)
    await screen.findByText('Offer a|products|/products/linen-shirt/|/collections/summer/')
    expect(screen.getByText('Offer b|shipping||')).toBeTruthy()
    expect(asked).toHaveLength(1)
    expect(asked[0]?.query).toBe('query Offers { offers { id name description endsAt appliesTo products collections } }')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })
    expect(screen.queryByText(/Offer a/)).toBeNull()
    expect(screen.getByText('Offer b|shipping||')).toBeTruthy()
    // Ending needs no new question: the banner goes by the clock.
    expect(asked).toHaveLength(1)
  })

  it('leaves out an answer it cannot read rather than guessing', async () => {
    shopAnswering(() => ({ data: { offers: [offer('c', 'not a date'), offer('d', null, { appliesTo: 'SOMETHING' }), offer('e', null)] } }))
    render(<Provided><Banner /></Provided>)
    await screen.findByText(/Offer e/)
    expect(screen.queryByText(/Offer c/)).toBeNull()
    expect(screen.queryByText(/Offer d/)).toBeNull()
  })
})
