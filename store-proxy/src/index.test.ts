import { afterEach, describe, expect, it, vi } from 'vitest'
import { route } from './index'

const seen: string[] = []
const api = { fetch: async (r: Request) => (seen.push(`api ${r.url}`), new Response('api')) } as unknown as Fetcher
const env = { API: api, OWN_ZONE: 'dripfunnel.ai', PAGES_HOST: 'store.pages.dev' }

afterEach(() => {
  seen.length = 0
  vi.unstubAllGlobals()
})

const stubFetch = () => vi.stubGlobal('fetch', async (r: Request) => (seen.push(`net ${r.url}`), new Response('net')))

describe('store proxy', () => {
  it('sends a partner host /api/* to the API through the binding', async () => {
    stubFetch()
    await route(new Request('https://portal.example.com/api/graphql'), env)
    expect(seen).toEqual(['api https://portal.example.com/api/graphql'])
  })

  it('sends the rest of a partner host to Pages under Pages\' own name', async () => {
    stubFetch()
    await route(new Request('https://portal.example.com/dashboard?x=1'), env)
    expect(seen).toEqual(['net https://store.pages.dev/dashboard?x=1'])
  })

  it('passes our own hosts through untouched', async () => {
    stubFetch()
    await route(new Request('https://dev-admin.dripfunnel.ai/api/health'), env)
    await route(new Request('https://dripfunnel.ai/'), env)
    expect(seen).toEqual(['net https://dev-admin.dripfunnel.ai/api/health', 'net https://dripfunnel.ai/'])
  })

  it('does not treat a lookalike host as ours', async () => {
    stubFetch()
    await route(new Request('https://evildripfunnel.ai/'), env)
    expect(seen).toEqual(['net https://store.pages.dev/'])
  })

  it('sends a preview host’s studio frame to the API’s StorefrontEdge, and nothing else of it there', async () => {
    stubFetch()
    const edge = { fetch: async (r: Request) => (seen.push(`edge ${r.url}`), new Response('edge')) } as unknown as Fetcher
    const withEdge = { ...env, PREVIEW_DOMAIN: 'webpreview.store', STOREFRONT: edge }
    await route(new Request('https://k7f3q9f2xa.webpreview.store/__studio/Ab3_9-xYz0Ab3_9-xYz0Ab/'), withEdge)
    await route(new Request('https://portal.example.com/__studio/Ab3_9-xYz0Ab3_9-xYz0Ab/'), withEdge)
    await route(new Request('https://k7f3q9f2xa.webpreview.store/__studio/x'), env)
    expect(seen).toEqual([
      'edge https://k7f3q9f2xa.webpreview.store/__studio/Ab3_9-xYz0Ab3_9-xYz0Ab/',
      'net https://store.pages.dev/__studio/Ab3_9-xYz0Ab3_9-xYz0Ab/',
      'net https://store.pages.dev/__studio/x',
    ])
  })
})
