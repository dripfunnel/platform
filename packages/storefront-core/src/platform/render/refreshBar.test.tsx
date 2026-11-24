// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { later, Provided, shopAnswering } from '../../../test/shop'
import { useMenu } from '../store/menu'
import { PrefilledProvider, useShopData } from './data'

// The loading bar a live page shows while its built answers are asked again (#1578).

// The bar adopts its stylesheet once per page, so the first test to show it is the one that adds it.
const sheets: string[] = []
beforeAll(() => {
  vi.stubGlobal(
    'CSSStyleSheet',
    class {
      replaceSync(css: string) {
        sheets.push(css)
      }
    },
  )
  Object.defineProperty(document, 'adoptedStyleSheets', { value: [], writable: true, configurable: true })
})
afterEach(cleanup)
afterAll(() => vi.unstubAllGlobals())

const Health = ({ id = 'a' }: { id?: string }) => {
  const health = useShopData('health', (client) => client.request<{ health: string }>('{ health }'))
  return <p data-testid={id}>{health.status === 'ready' ? health.data.health : health.status}</p>
}
const built = new Map<string, unknown>([['health', { health: 'built' }]])
const live = (children: React.ReactNode, answers = built) => (
  <Provided mode="live">
    <PrefilledProvider value={{ answers }}>{children}</PrefilledProvider>
  </Provided>
)
const bar = () => document.querySelector('[role="progressbar"][aria-label="Checking for updates"]')

describe('the refresh bar', () => {
  it('shows while a pre-filled answer is asked again and hides when the newer one arrives', async () => {
    const answer = later<unknown>()
    shopAnswering(() => answer.promise)
    render(live(<Health />))
    expect(screen.getByTestId('a').textContent).toBe('built')
    expect(bar()).not.toBeNull()
    expect(document.body.getAttribute('aria-busy')).toBe('true')
    await act(async () => answer.settle({ data: { health: 'fresh' } }))
    expect(screen.getByTestId('a').textContent).toBe('fresh')
    expect(bar()).toBeNull()
    expect(document.body.hasAttribute('aria-busy')).toBe(false)
  })

  it('stays until every question is answered', async () => {
    const first = later<unknown>()
    const second = later<unknown>()
    shopAnswering(({ query }) => (query.includes('other') ? second.promise : first.promise))
    const Other = () => <p>{useShopData('other', (client) => client.request<{ other: string }>('{ other }')).status}</p>
    render(live(<><Health /><Other /></>, new Map([...built, ['other', { other: 'built' }]])))
    await act(async () => first.settle({ data: { health: 'fresh' } }))
    expect(bar()).not.toBeNull()
    await act(async () => second.settle({ data: { other: 'fresh' } }))
    expect(bar()).toBeNull()
  })

  it('hides when the Shop API fails, and the built content stays', async () => {
    shopAnswering(() => ({ errors: [{ message: 'down', extensions: { code: 'STORE_UNAVAILABLE' } }] }))
    render(live(<Health />))
    await vi.waitFor(() => expect(bar()).toBeNull())
    expect(screen.getByTestId('a').textContent).toBe('built')
    expect(document.body.hasAttribute('aria-busy')).toBe(false)
  })

  it('is not in the built HTML, so hydration matches', () => {
    const html = renderToString(live(<Health />))
    expect(html).toContain('built')
    expect(html).not.toContain('progressbar')
  })

  it('does not show for the menu, which keeps what it was built with (#1481)', async () => {
    const asked = shopAnswering(() => ({ data: {} }))
    const Menu = () => <p>{useMenu().status}</p>
    render(live(<Menu />, new Map([['menu', []]])))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(bar()).toBeNull()
    expect(asked).toEqual([])
  })

  it('does not show in the preview, where nothing is pre-filled', async () => {
    const answer = later<unknown>()
    shopAnswering(() => answer.promise)
    render(
      <Provided>
        <Health />
      </Provided>,
    )
    expect(screen.getByTestId('a').textContent).toBe('loading')
    expect(bar()).toBeNull()
    await act(async () => answer.settle({ data: { health: 'ok' } }))
    expect(bar()).toBeNull()
  })

  it('does not show for a question the build had no answer for, which loads as before', async () => {
    const answer = later<unknown>()
    shopAnswering(() => answer.promise)
    render(live(<Health />, new Map()))
    expect(screen.getByTestId('a').textContent).toBe('loading')
    expect(bar()).toBeNull()
    await act(async () => answer.settle({ data: { health: 'ok' } }))
  })

  it('stops animating under reduced motion', () => {
    expect(sheets.join('')).toMatch(/@media \(prefers-reduced-motion:reduce\)\{\[data-df-refresh\]::before\{[^}]*animation:none/)
  })
})
