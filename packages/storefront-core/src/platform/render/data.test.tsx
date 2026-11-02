// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Provided, shopAnswering } from '../../../test/shop'
import { PrefilledProvider, useShopData } from './data'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const Health = ({ id }: { id: string }) => {
  const health = useShopData('health', (client) => client.request<{ health: string }>('{ health }'))
  return <p data-testid={id}>{health.status === 'ready' ? health.data.health : health.status}</p>
}

describe('useShopData', () => {
  it('asks a question once per page however many components ask it', async () => {
    const asked = shopAnswering(() => ({ data: { health: 'ok' } }))
    render(
      <Provided>
        <Health id="a" />
        <Health id="b" />
      </Provided>,
    )
    expect(screen.getByTestId('a').textContent).toBe('loading')
    await vi.waitFor(() => expect(screen.getByTestId('b').textContent).toBe('ok'))
    expect(asked).toHaveLength(1)
  })

  it('shows a pre-filled answer from the first render, then takes the Shop API’s newer one', async () => {
    const asked = shopAnswering(() => ({ data: { health: 'fresh' } }))
    render(
      <Provided mode="live">
        <PrefilledProvider value={{ answers: new Map([['health', { health: 'built' }]]) }}>
          <Health id="a" />
        </PrefilledProvider>
      </Provided>,
    )
    expect(screen.getByTestId('a').textContent).toBe('built')
    await vi.waitFor(() => expect(screen.getByTestId('a').textContent).toBe('fresh'))
    expect(asked).toHaveLength(1)
  })

  it('keeps the pre-filled answer when the Shop API fails', async () => {
    shopAnswering(() => ({ errors: [{ message: 'down', extensions: { code: 'STORE_UNAVAILABLE' } }] }))
    render(
      <Provided mode="live">
        <PrefilledProvider value={{ answers: new Map([['health', { health: 'built' }]]) }}>
          <Health id="a" />
        </PrefilledProvider>
      </Provided>,
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.getByTestId('a').textContent).toBe('built')
  })

  it('tells a static render each question it has no answer for, and renders the answers it has', () => {
    const asks: string[] = []
    const html = renderToString(
      <Provided mode="live">
        <PrefilledProvider value={{ answers: new Map([['health', { health: 'built' }]]), ask: (key) => asks.push(key) }}>
          <Health id="a" />
          <Other />
        </PrefilledProvider>
      </Provided>,
    )
    expect(html).toContain('built')
    expect(asks).toEqual(['other'])
  })
})

const Other = () => {
  const other = useShopData('other', (client) => client.request<{ health: string }>('{ health }'))
  return <p>{other.status}</p>
}
