// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CheckoutBoundary } from '../../checkout/fallback'
import { setProblemReporter, type StorefrontProblem } from '../../sealed/report'
import { SectionBoundary } from './boundary'

let reports: StorefrontProblem[]

beforeEach(() => {
  reports = []
  setProblemReporter((p) => reports.push(p))
  // React logs the error it caught; the test reads the report instead.
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.restoreAllMocks()
})

const Broken = (): never => {
  throw new Error('theme bug')
}

describe('SectionBoundary', () => {
  it('renders the baseline section when the theme’s throws, and reports it', () => {
    render(
      <>
        <SectionBoundary name="hero" baseline={<p>Baseline hero</p>}>
          <Broken />
        </SectionBoundary>
        <SectionBoundary name="footer" baseline={<p>Baseline footer</p>}>
          <p>Theme footer</p>
        </SectionBoundary>
      </>,
    )
    expect(screen.getByText('Baseline hero')).toBeTruthy()
    expect(screen.getByText('Theme footer')).toBeTruthy()
    expect(reports).toEqual([{ kind: 'section', subject: 'hero' }])
  })
})

describe('CheckoutBoundary', () => {
  it('switches a shopper whose theme checkout throws to the baseline checkout, for the rest of the visit', () => {
    render(
      <CheckoutBoundary baseline={<p>Baseline checkout</p>}>
        <Broken />
      </CheckoutBoundary>,
    )
    expect(screen.getByText('Baseline checkout')).toBeTruthy()
    expect(reports).toEqual([{ kind: 'checkout', subject: 'checkout' }])
    cleanup()
    const theme = vi.fn(() => <p>Theme checkout</p>)
    const Theme = () => theme()
    render(
      <CheckoutBoundary baseline={<p>Baseline checkout</p>}>
        <Theme />
      </CheckoutBoundary>,
    )
    expect(screen.getByText('Baseline checkout')).toBeTruthy()
    expect(theme).not.toHaveBeenCalled()
  })

  it('leaves the choice to the browser: the server renders neither checkout', () => {
    sessionStorage.clear()
    expect(renderToStaticMarkup(<CheckoutBoundary baseline={<p>Baseline checkout</p>}>{<p>Theme checkout</p>}</CheckoutBoundary>)).toBe('')
  })

  it('keeps the theme’s checkout while it works', () => {
    render(
      <CheckoutBoundary baseline={<p>Baseline checkout</p>}>
        <p>Theme checkout</p>
      </CheckoutBoundary>,
    )
    expect(screen.getByText('Theme checkout')).toBeTruthy()
    expect(reports).toEqual([])
  })
})
