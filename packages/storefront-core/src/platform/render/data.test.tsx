// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Provided, shopAnswering } from '../../../test/shop'
import { useShopData } from './data'

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
})
