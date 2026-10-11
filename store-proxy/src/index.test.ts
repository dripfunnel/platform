import { afterEach, describe, expect, it, vi } from 'vitest'
import { configProblem, previewKeyOf, route } from './index'

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
    await route(new Request('https://portal.example.com/api/graphql'), env, null)
    expect(seen).toEqual(['api https://portal.example.com/api/graphql'])
  })

  it('sends the rest of a partner host to Pages under Pages\' own name', async () => {
    stubFetch()
    await route(new Request('https://portal.example.com/dashboard?x=1'), env, null)
    expect(seen).toEqual(['net https://store.pages.dev/dashboard?x=1'])
  })

  it('passes our own hosts through untouched', async () => {
    stubFetch()
    await route(new Request('https://dev-admin.dripfunnel.ai/api/health'), env, null)
    await route(new Request('https://dripfunnel.ai/'), env, null)
    expect(seen).toEqual(['net https://dev-admin.dripfunnel.ai/api/health', 'net https://dripfunnel.ai/'])
  })

  it('does not treat a lookalike host as ours', async () => {
    stubFetch()
    await route(new Request('https://evildripfunnel.ai/'), env, null)
    expect(seen).toEqual(['net https://store.pages.dev/'])
  })

  it('checks its configuration: a preview domain apart from our zone, a 32-byte key, and the edge with its bucket', () => {
    const fine = { ...env, PREVIEW_DOMAIN: 'webpreview.store', PREVIEW_SESSION_KEY: `${'A'.repeat(43)}=` }
    expect(configProblem(fine)).toBeNull()
    expect(configProblem({ ...fine, PREVIEW_DOMAIN: 'preview.dripfunnel.ai' })).toBe('PREVIEW_DOMAIN')
    expect(configProblem({ ...fine, PREVIEW_SESSION_KEY: 'short' })).toBe('PREVIEW_SESSION_KEY')
    expect(configProblem({ ...fine, SITES: {} as R2Bucket })).toBe('EDGE')
  })

  it('takes a preview key only from one label of the preview domain', () => {
    expect(previewKeyOf('abcdefghij.webpreview.store', 'webpreview.store')).toBe('abcdefghij')
    expect(previewKeyOf('x.abcdefghij.webpreview.store', 'webpreview.store')).toBeNull()
    expect(previewKeyOf('abcdefghij.webpreview.store.evil.example', 'webpreview.store')).toBeNull()
    expect(previewKeyOf('abcdefghij.webpreview.store', undefined)).toBeNull()
  })
})
