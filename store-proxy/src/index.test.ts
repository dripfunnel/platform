import { afterEach, describe, expect, it, vi } from 'vitest'
import { configProblem, previewKeyOf, route, type Env } from './index'
import { depsWith, fakeCache, fakeEdge, fakeSites } from './testSupport'

const seen: string[] = []
const api = { fetch: async (r: Request) => (seen.push(`api ${r.url}`), new Response('api')), portalHost: async () => false } as unknown as Env['API']
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

  describe('own-zone partner portal hosts (#899)', () => {
    const portalHosts = new Set(['mystore.dripfunnel.ai'])
    const asked: string[] = []
    let failing = false
    const apiWith = {
      fetch: async (r: Request) => (seen.push(`api ${r.url}`), new Response('api')),
      portalHost: async (host: string) => {
        asked.push(host)
        if (failing) throw new Error('down')
        return portalHosts.has(host)
      },
    } as unknown as Env['API']
    const zoneEnv = { ...env, API: apiWith }
    const clock = { at: 1_000_000 }
    const setup = async () => {
      asked.length = 0
      failing = false
      const { deps, settle } = await depsWith({ edge: fakeEdge(), sites: fakeSites({}).sites, cache: fakeCache(clock).cache, clock })
      return { deps, settle }
    }

    it('rewrites a live portal host inside our zone to Pages and sends its /api/* to the API', async () => {
      stubFetch()
      const { deps } = await setup()
      await route(new Request('https://mystore.dripfunnel.ai/dashboard'), zoneEnv, deps)
      await route(new Request('https://mystore.dripfunnel.ai/api/graphql'), zoneEnv, deps)
      expect(seen).toEqual(['net https://store.pages.dev/dashboard', 'api https://mystore.dripfunnel.ai/api/graphql'])
    })

    it('passes every other own-zone host through untouched', async () => {
      stubFetch()
      const { deps } = await setup()
      for (const host of ['dev-admin.dripfunnel.ai', 'dev-platform.dripfunnel.ai', 'unknown.dripfunnel.ai', 'dripfunnel.ai']) await route(new Request(`https://${host}/api/health`), zoneEnv, deps)
      expect(seen).toEqual(['dev-admin', 'dev-platform', 'unknown', ''].map((h) => `net https://${h ? `${h}.` : ''}dripfunnel.ai/api/health`))
    })

    it('asks the API once a minute per host, found or not', async () => {
      stubFetch()
      const { deps, settle } = await setup()
      for (const host of ['mystore.dripfunnel.ai', 'dev-admin.dripfunnel.ai']) {
        await route(new Request(`https://${host}/`), zoneEnv, deps)
        await settle()
        await route(new Request(`https://${host}/`), zoneEnv, deps)
      }
      expect(asked).toEqual(['mystore.dripfunnel.ai', 'dev-admin.dripfunnel.ai'])
      clock.at += 61_000
      await route(new Request('https://mystore.dripfunnel.ai/'), zoneEnv, deps)
      expect(asked).toHaveLength(3)
    })

    it('passes an own-zone host through untouched when the API cannot be asked', async () => {
      stubFetch()
      const { deps } = await setup()
      failing = true
      await route(new Request('https://dev-admin.dripfunnel.ai/'), zoneEnv, deps)
      expect(seen).toEqual(['net https://dev-admin.dripfunnel.ai/'])
    })
  })

  it('does not treat a lookalike host as ours', async () => {
    stubFetch()
    await route(new Request('https://evildripfunnel.ai/'), env, null)
    expect(seen).toEqual(['net https://store.pages.dev/'])
  })

  it('checks its configuration: a preview domain apart from our zone, a 32-byte key, and the edge with its bucket', () => {
    const fine = { ...env, SHOP_DOMAIN: 'my-store.one', PREVIEW_SESSION_KEY: `${'A'.repeat(43)}=` }
    expect(configProblem(fine)).toBeNull()
    expect(configProblem({ ...fine, SHOP_DOMAIN: 'preview.dripfunnel.ai' })).toBe('SHOP_DOMAIN')
    expect(configProblem({ ...fine, PREVIEW_SESSION_KEY: 'short' })).toBe('PREVIEW_SESSION_KEY')
    expect(configProblem({ ...fine, SITES: {} as R2Bucket })).toBe('EDGE')
  })

  it('takes a preview key only from one label of the preview domain', () => {
    expect(previewKeyOf('acme-preview.my-store.one', 'my-store.one')).toBe('acme')
    expect(previewKeyOf('x.acme-preview.my-store.one', 'my-store.one')).toBeNull()
    expect(previewKeyOf('acme-preview.my-store.one.evil.example', 'my-store.one')).toBeNull()
    expect(previewKeyOf('acme-preview.my-store.one', undefined)).toBeNull()
    expect(previewKeyOf('acme.my-store.one', 'my-store.one')).toBeNull()
    expect(previewKeyOf('-preview.my-store.one', 'my-store.one')).toBeNull()
  })
})
