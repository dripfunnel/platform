import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import type { LiveHost } from './edge'
import { route } from './index'
import { lookupSeconds } from './live'
import { depsWith, fakeCache, fakeEdge, fakeSites, type Clock, type FakeEdge } from './testSupport'

// Card #317: a storefront host's live site (storefront LIVE-SHOP.md §5).

const storeA = '00000000-0000-4000-8000-00000000000a'
const storeB = '00000000-0000-4000-8000-00000000000b'
const partner = '00000000-0000-4000-8000-0000000000aa'
const build1 = '00000000-0000-4000-8000-000000000001'
const build2 = '00000000-0000-4000-8000-000000000002'
const buildB = '00000000-0000-4000-8000-0000000000b1'
const hostA = 'a.shops.acme.example'
const hostB = 'www.b-shop.example'
const folder = (store: string, build: string) => `stores/${store}/builds/${build}/`
const store = (storeId: string, buildId: string | null, state: 'open' | 'suspended' | 'offline' = 'open', name = 'Shop'): LiveHost => ({ kind: 'store', storeId, partnerId: partner, buildId, state, name, language: 'en' })

const objects = {
  [`${folder(storeA, build1)}index.html`]: { body: 'A one', contentType: 'text/html', cacheControl: 'no-cache', csp: "script-src 'sha256-x'" },
  [`${folder(storeA, build2)}index.html`]: { body: 'A two', contentType: 'text/html' },
  [`${folder(storeA, build1)}about/index.html`]: { body: 'A about', contentType: 'text/html' },
  [`${folder(storeA, build1)}feed.json`]: { body: '{}', contentType: 'application/json' },
  [`${folder(storeA, build1)}_edge.json`]: {
    body: JSON.stringify({ redirects: [{ from: '/products/old', to: '/products/new/' }, { from: '/away', to: '/\\evil.example' }, { from: '/away2', to: '//evil.example' }, { from: '/away3', to: '/%5Cevil.example' }], fallbacks: [{ prefix: '/products/', page: '/products/_/index.html' }], notFound: '/404.html' }),
  },
  [`${folder(storeA, build1)}products/_/index.html`]: { body: 'A product fallback', contentType: 'text/html' },
  [`${folder(storeA, build1)}404.html`]: { body: 'A not found', contentType: 'text/html' },
  [`${folder(storeB, buildB)}index.html`]: { body: 'B home', contentType: 'text/html' },
  [`${folder(storeB, buildB)}secret.html`]: { body: 'B only', contentType: 'text/html' },
}

let clock: Clock
let edge: FakeEdge
let cache: ReturnType<typeof fakeCache>
let sites: ReturnType<typeof fakeSites>
let deps: Deps
let settle: () => Promise<void>
const env = { API: { fetch: async () => new Response('api') } as unknown as Fetcher, OWN_ZONE: 'dripfunnel.ai', PAGES_HOST: 'store.pages.dev', PREVIEW_DOMAIN: 'webpreview.store' }

beforeEach(async () => {
  vi.unstubAllGlobals()
  clock = { at: 1_000_000 }
  edge = fakeEdge()
  edge.hosts.set(hostA, store(storeA, build1))
  edge.hosts.set(hostB, store(storeB, buildB))
  cache = fakeCache(clock)
  sites = fakeSites(objects)
  ;({ deps, settle } = await depsWith({ edge, sites: sites.sites, cache: cache.cache, clock }))
})

const get = async (href: string, init: RequestInit = {}) => {
  const response = await route(new Request(href, init), env, deps)
  await settle()
  return response
}
const text = async (href: string) => (await get(href)).text()

describe('the live site', () => {
  it('serves the live build’s file from R2 with the build’s headers, then from the cache', async () => {
    const first = await get(`https://${hostA}/`)
    expect(first.status).toBe(200)
    expect(await first.text()).toBe('A one')
    expect(first.headers.get('content-security-policy')).toBe("script-src 'sha256-x'")
    expect(first.headers.get('cache-control')).toBe('no-cache')
    const asked = sites.asked.length
    const second = await get(`https://${hostA}/`)
    expect(await second.text()).toBe('A one')
    expect(second.headers.get('cache-control')).toBe('no-cache')
    expect(sites.asked.length).toBe(asked)
    expect(await text(`https://${hostA}/about/`)).toBe('A about')
    expect(await text(`https://${hostA}/about`)).toBe('A about')
  })

  it('caches the lookup for at most a minute, under the store’s, host’s and partner’s tags, and asks the API on a miss', async () => {
    await get(`https://${hostA}/`)
    await get(`https://${hostA}/about/`)
    expect(edge.calls.filter((c) => c === `liveHost ${hostA}`)).toHaveLength(1)
    clock.at += lookupSeconds * 1000 + 1
    await get(`https://${hostA}/`)
    expect(edge.calls.filter((c) => c === `liveHost ${hostA}`)).toHaveLength(2)
  })

  it('switches atomically: within the minute the old build, after it (or a purge) the new one, never a mix', async () => {
    expect(await text(`https://${hostA}/`)).toBe('A one')
    edge.hosts.set(hostA, store(storeA, build2))
    expect(await text(`https://${hostA}/`)).toBe('A one')
    clock.at += lookupSeconds * 1000 + 1
    expect(await text(`https://${hostA}/`)).toBe('A two')
    // Go back is the same pointer move, with no build: the purge shows it at once where it reaches.
    edge.hosts.set(hostA, store(storeA, build1))
    cache.purgeTag(`df-store-${storeA}`)
    expect(await text(`https://${hostA}/`)).toBe('A one')
  })

  it('never serves one store’s files on another’s host, and no path names another folder', async () => {
    expect(await text(`https://${hostB}/`)).toBe('B home')
    expect(await text(`https://${hostA}/`)).toBe('A one')
    expect((await get(`https://${hostA}/secret.html`)).status).toBe(404)
    for (const path of ['/..%2f..%2f' + storeB + '%2fbuilds%2f' + buildB + '%2fsecret.html', '/%2e%2e/%2e%2e/secret.html', '/a%5c..%5csecret.html', '/a%00.html']) expect((await get(`https://${hostA}${path}`)).status, path).toBe(404)
    expect(sites.asked.filter((k) => k.includes(storeB) && !k.startsWith(folder(storeB, buildB)))).toEqual([])
    expect(sites.asked.filter((k) => k.startsWith(`stores/${storeB}`) && !k.startsWith(folder(storeB, buildB)))).toEqual([])
    expect(cache.keys().filter((k) => k.startsWith(`https://${hostA}/`)).every((k) => !k.includes(storeB))).toBe(true)
  })

  it('serves a suspended store the degraded page, an offline one nothing, and a store not yet published nothing', async () => {
    edge.hosts.set('s.shops.acme.example', store(storeA, build1, 'suspended', '<Bad & Co>'))
    const degraded = await get('https://s.shops.acme.example/')
    expect(degraded.status).toBe(503)
    const html = await degraded.text()
    expect(html).toContain('&#60;Bad &#38; Co&#62;')
    expect(html).toContain('contact the shop')
    expect(html).not.toMatch(/dripfunnel/i)
    edge.hosts.set('o.shops.acme.example', store(storeA, build1, 'offline'))
    expect((await get('https://o.shops.acme.example/')).status).toBe(404)
    edge.hosts.set('n.shops.acme.example', store(storeA, null))
    expect((await get('https://n.shops.acme.example/')).status).toBe(404)
  })

  it('answers a removed or unknown product address with the build’s redirect, its fallback page or its 404', async () => {
    const moved = await get(`https://${hostA}/products/old`)
    expect([moved.status, moved.headers.get('location')]).toEqual([301, '/products/new/'])
    for (const away of ['/away', '/away2', '/away3']) expect((await get(`https://${hostA}${away}`)).status, away).toBe(404)
    const fallback = await get(`https://${hostA}/products/brand-new/`)
    expect([fallback.status, await fallback.text()]).toEqual([200, 'A product fallback'])
    const missing = await get(`https://${hostA}/nowhere/`)
    expect([missing.status, await missing.text()]).toEqual([404, 'A not found'])
    expect((await get(`https://${hostB}/nowhere/`)).status).toBe(404)
  })

  it('sends /shop-api/* to the API, keeping the shopper’s host', async () => {
    await get(`https://${hostA}/shop-api/graphql`, { method: 'POST', body: '{}' })
    expect(edge.forwarded.map((r) => r.url)).toEqual([`https://${hostA}/shop-api/graphql`])
  })

  it('keeps a portal host’s routing when no store holds the host', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', async (r: Request) => (seen.push(r.url), new Response('pages')))
    expect(await (await route(new Request('https://portal.partner.example/api/'), env, deps)).text()).toBe('api')
    await route(new Request('https://portal.partner.example/dashboard'), env, deps)
    expect(seen).toEqual(['https://store.pages.dev/dashboard'])
  })

  it('answers 503 and caches nothing when the API can’t be asked', async () => {
    edge.liveHost = async () => {
      throw new Error('down')
    }
    expect((await get(`https://${hostA}/`)).status).toBe(503)
    expect(cache.keys()).toEqual([])
  })

  it('refuses writes to the built files', async () => {
    expect((await get(`https://${hostA}/`, { method: 'POST' })).status).toBe(405)
  })
})
