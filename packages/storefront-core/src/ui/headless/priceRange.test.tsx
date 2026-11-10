// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { Provided } from '../../../test/shop'
import { moneySchema } from '../../pricing/money'
import { PriceRange } from './priceRange'

afterEach(cleanup)

const bounds = { min: moneySchema.parse({ amount: '0', currency: 'INR' }), max: moneySchema.parse({ amount: '100000', currency: 'INR' }) }
const drawn = (
  <Provided>
    <PriceRange bounds={bounds} value={{ min: null, max: null }} onChange={() => undefined} label="Price" />
  </Provided>
)

describe('PriceRange', () => {
  it('renders nothing in built HTML, where its chunk is not loaded, and the slider once it loads', async () => {
    expect(renderToString(drawn)).not.toContain('role="slider"')
    render(drawn)
    expect(await screen.findAllByRole('slider')).toHaveLength(2)
  })
})
