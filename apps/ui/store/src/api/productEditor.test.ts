import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadMarketPrices } from './productEditor'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the price per market', () => {
  it('asks for every market in one request, each answer under its own market', async () => {
    const sent: { query: string; variables: Record<string, string> }[] = []
    const usd = { currency: 'USD', amount: '1599', compareAtAmount: null, source: 'converted' }
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)) as { query: string; variables: Record<string, string> })
      return new Response(JSON.stringify({ data: { product: { m0: [{ inMarket: usd }], m1: [] } } }))
    })
    const prices = await loadMarketPrices('p1', ['mk-us', 'mk-uk'])
    expect(sent).toHaveLength(1)
    expect(sent[0]?.variables).toEqual({ id: 'p1', m0: 'mk-us', m1: 'mk-uk' })
    expect([...prices]).toEqual([['mk-us', usd], ['mk-uk', null]])
  })

  it('sends nothing when there are no markets', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect((await loadMarketPrices('p1', [])).size).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })
})
