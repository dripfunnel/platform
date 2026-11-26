import { beforeEach, describe, expect, it } from 'vitest'
import type { Deps } from './deps'
import { route } from './index'
import { depsWith, fakeApi, fakeCache, fakeEdge, fakeSites, type Clock, type FakeApi, type FakeEdge } from './testSupport'

// Card #1732: the templates' demos on demo.my-store.one/?theme=<key> (storefront PREVIEW.md §9).

const thread = '00000000-0000-4000-8000-0000000000d1'
const grocery = '00000000-0000-4000-8000-0000000000d2'
const real = '00000000-0000-4000-8000-00000000000a'
const host = 'demo.my-store.one'
const objects = {
  [`stores/${thread}/preview/demo/index.html`]: { body: '<p>Thread</p>', contentType: 'text/html', csp: "script-src 'self'" },
  [`stores/${thread}/preview/demo/assets/core/boot.js`]: { body: 'boot Thread', contentType: 'text/javascript', cacheControl: 'public, max-age=31536000, immutable' },
  [`stores/${grocery}/preview/demo/index.html`]: { body: '<p>Grocery</p>', contentType: 'text/html' },
  [`stores/${real}/preview/change-1/index.html`]: { body: '<p>a real draft</p>', contentType: 'text/html' },
}
const env = { API: { fetch: async () => new Response('api') } as unknown as Fetcher, OWN_ZONE: 'dripfunnel.dev', PAGES_HOST: 'store.pages.dev', SHOP_DOMAIN: 'my-store.one' }

let clock: Clock
let edge: FakeEdge
let api: FakeApi
let deps: Deps
let settle: () => Promise<void>

beforeEach(async () => {
  clock = { at: 1_700_000_000_000 }
  edge = fakeEdge()
  api = fakeApi()
  edge.demos.set('thread', { ok: true, key: 'thread', storeId: thread, folder: 'demo' })
  // The API also finds a template by its name, and answers its key.
  edge.demos.set('basket', { ok: true, key: 'grocery', storeId: grocery, folder: 'demo' })
  edge.demos.set('grocery', { ok: true, key: 'grocery', storeId: grocery, folder: 'demo' })
  ;({ deps, settle } = await depsWith({ edge, api, sites: fakeSites(objects).sites, cache: fakeCache(clock).cache, clock }))
})

const get = async (path: string, init: RequestInit = {}) => {
  const response = await route(new Request(`https://${host}${path}`, init), env, deps)
  await settle()
  return response
}
const chose = (key: string) => ({ headers: { cookie: `other=1; __Host-df_demo=${key}` } })
const isNoDemo = async (response: Response) => response.status === 404 && (await response.text()).includes('No demo for this template')

describe('the demo host', () => {
  it('opens a template’s demo from ?theme= with no link, ignoring case, and keeps the choice in a cookie', async () => {
    const response = await get('/?theme=Thread')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('<p>Thread</p>')
    expect(response.headers.get('set-cookie')).toBe('__Host-df_demo=thread; Path=/; Secure; HttpOnly; SameSite=Lax')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-security-policy')).toBe("script-src 'self'")
  })

  it('keeps serving the chosen template on later pages and chunks, from the cookie', async () => {
    const product = await get('/products/blue-tee', chose('thread'))
    expect(await product.text()).toBe('<p>Thread</p>')
    expect(product.headers.get('set-cookie')).toBeNull()
    const chunk = await get('/assets/core/boot.js', chose('thread'))
    expect(await chunk.text()).toBe('boot Thread')
    // Another theme has a file of the same name on this origin, so the browser must ask again.
    expect(chunk.headers.get('cache-control')).toBe('no-cache')
  })

  it('switches template on a new ?theme=', async () => {
    const response = await get('/?theme=grocery', chose('thread'))
    expect(await response.text()).toBe('<p>Grocery</p>')
    expect(response.headers.get('set-cookie')).toContain('__Host-df_demo=grocery;')
  })

  it('takes a template’s name too, keeping its key in the cookie', async () => {
    const response = await get('/?theme=Basket')
    expect(await response.text()).toBe('<p>Grocery</p>')
    expect(response.headers.get('set-cookie')).toContain('__Host-df_demo=grocery;')
    expect(edge.calls).toContain('demoSite basket')
    expect(await isNoDemo(await get('/?theme=%3Cscript%3E'))).toBe(true)
  })

  it('is never indexed', async () => {
    const response = await get('/?theme=thread')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await (await get('/robots.txt')).text()).toBe('User-agent: *\nDisallow: /\n')
  })

  it('shows "No demo for this template" with no theme, an unknown or unready one, or a key that isn’t one', async () => {
    expect(await isNoDemo(await get('/'))).toBe(true)
    expect(await isNoDemo(await get('/?theme=market'))).toBe(true)
    expect(await isNoDemo(await get('/', chose('market')))).toBe(true)
    expect(await isNoDemo(await get('/?theme=../thread'))).toBe(true)
    expect(await isNoDemo(await get('/', chose('a/b')))).toBe(true)
    expect(edge.calls).not.toContain('demoSite ../thread')
  })

  it('never reads a folder outside the chosen demo’s', async () => {
    expect((await get('/..%2F..%2Fchange-1/index.html', chose('thread'))).status).toBe(404)
    expect(await isNoDemo(await get('/__open?t=x', chose('thread')))).toBe(true)
    expect(await isNoDemo(await get('/__studio/s/', chose('thread')))).toBe(true)
  })

  it('only reads pages', async () => {
    const response = await get('/?theme=thread', { method: 'POST' })
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, HEAD')
  })

  it('passes the Shop API on with its cookie, which the API reads the demo store from', async () => {
    await get('/shop-api/graphql', { method: 'POST', ...chose('thread') })
    expect(api.forwarded).toHaveLength(1)
    expect(api.forwarded[0]?.headers.get('cookie')).toContain('__Host-df_demo=thread')
  })

  it('asks the API about a template once a minute, not once a request', async () => {
    await get('/?theme=thread')
    await get('/assets/core/boot.js', chose('thread'))
    expect(edge.calls.filter((c) => c === 'demoSite thread')).toHaveLength(1)
    clock.at += 61_000
    await get('/', chose('thread'))
    expect(edge.calls.filter((c) => c === 'demoSite thread')).toHaveLength(2)
  })
})
