// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Provided } from '../../../test/shop'
import { moneySchema } from '../../pricing/money'
import { PriceRange, priceStops } from './priceRange'

afterEach(cleanup)

const bounds = (min: string, max: string, currency = 'INR') => ({ min: moneySchema.parse({ amount: min, currency }), max: moneySchema.parse({ amount: max, currency }) })

describe('priceStops', () => {
  it('spans the bounds in round steps of 1, 2 or 5 times a power of ten', () => {
    expect(priceStops(bounds('67500', '180000')).map((s) => Number(s / 100n))).toEqual([600, 800, 1000, 1200, 1400, 1600, 1800])
    expect(priceStops(bounds('89900', '89900')).map((s) => Number(s / 100n))).toEqual([899, 900])
    expect(priceStops(bounds('150', '4800', 'JPY'))).toEqual([0n, 500n, 1000n, 1500n, 2000n, 2500n, 3000n, 3500n, 4000n, 4500n, 5000n])
  })
})

describe('PriceRange', () => {
  const draw = (value = { min: null as string | null, max: null as string | null }) => {
    const onChange = vi.fn()
    render(
      <Provided>
        <PriceRange bounds={bounds('0', '100000')} value={value} onChange={onChange} label="Price" />
      </Provided>,
    )
    return onChange
  }

  it('offers Min and an open top, and reports a lowest choice in minor units with the top left open', () => {
    const onChange = draw()
    const [low, high] = screen.getAllByRole('combobox')
    expect(low?.querySelector('option')?.textContent).toBe('Min')
    expect([...(high?.querySelectorAll('option') ?? [])].at(-1)?.textContent).toBe('₹1,000+')
    fireEvent.change(low as HTMLSelectElement, { target: { value: '2' } })
    expect(onChange).toHaveBeenCalledWith({ min: '20000', max: null })
  })

  it('writes no style attribute into built HTML, which the CSP would refuse, and places the thumbs once it runs', () => {
    const html = renderToStaticMarkup(
      <Provided>
        <PriceRange bounds={bounds('0', '100000')} value={{ min: '20000', max: null }} onChange={() => undefined} label="Price" />
      </Provided>,
    )
    expect(html).not.toContain('style=')
    draw({ min: '20000', max: null })
    expect(screen.getAllByRole('slider').map((s) => (s as HTMLElement).style.left)).toEqual(['20%', '100%'])
  })

  it('shows the chosen range on both thumbs and moves a thumb a stop by its keys', () => {
    vi.useFakeTimers()
    const onChange = draw({ min: '20000', max: '60000' })
    const [low, high] = screen.getAllByRole('slider')
    expect(low?.getAttribute('aria-valuetext')).toBe('₹200')
    expect(high?.getAttribute('aria-valuetext')).toBe('₹600')
    fireEvent.keyDown(high as HTMLElement, { key: 'ArrowRight' })
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(700)
    expect(onChange).toHaveBeenCalledWith({ min: '20000', max: '70000' })
    vi.useRealTimers()
  })
})
