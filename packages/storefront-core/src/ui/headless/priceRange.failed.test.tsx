// @vitest-environment happy-dom
import { Component, type ReactNode } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Provided } from '../../../test/shop'
import { moneySchema } from '../../pricing/money'
import { PriceRange } from './priceRange'

// The slider's chunk fails to load, as after a deploy removed the old hashed file.
vi.mock('./priceRangeSlider', () => {
  throw new Error('Failed to fetch dynamically imported module')
})

afterEach(cleanup)

/** Stands in for the page's error boundary: it shows "broken" if the filter throws. */
class Page extends Component<{ children: ReactNode }, { broken: boolean }> {
  override state = { broken: false }
  static getDerivedStateFromError = () => ({ broken: true })
  override render = () => (this.state.broken ? <p>broken</p> : this.props.children)
}

describe('PriceRange when its chunk fails to load', () => {
  it('leaves the filter out and keeps the rest of the page', async () => {
    const bounds = { min: moneySchema.parse({ amount: '0', currency: 'INR' }), max: moneySchema.parse({ amount: '100000', currency: 'INR' }) }
    render(
      <Provided>
        <Page>
          <p>Products</p>
          <PriceRange bounds={bounds} value={{ min: null, max: null }} onChange={() => undefined} label="Price" />
        </Page>
      </Provided>,
    )
    await act(() => new Promise((settle) => setTimeout(settle, 50)))
    expect(screen.queryByText('broken')).toBeNull()
    expect(screen.getByText('Products')).toBeTruthy()
    expect(screen.queryAllByRole('slider')).toHaveLength(0)
  })
})
