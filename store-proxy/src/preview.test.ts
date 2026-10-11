import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import worker, { route } from './index'
import { sessionSeconds } from './session'
import { depsWith, fakeCache, fakeEdge, fakeSites, sessionKey, type Clock, type FakeEdge } from './testSupport'

// Card #317: a preview host, {key}.webpreview.store (storefront PREVIEW.md §5, §6).

const storeA = '00000000-0000-4000-8000-00000000000a'
const storeB = '00000000-0000-4000-8000-00000000000b'
const owner = '00000000-0000-4000-8000-0000000000c1'
const keyA = 'abcdefghij'
const keyB = 'klmnopqrst'
const hostA = `${keyA}.webpreview.store`
const hostB = `${keyB}.webpreview.store`
const objects = {
  [`stores/${storeA}/preview/change-2/index.html`]: { body: '<p>draft A</p>', contentType: 'text/html', csp: "script-src 'self'" },
  [`stores/${storeA}/preview/change-2/assets/app.js`]: { body: 'js A', contentType: 'text/javascript' },
  [`stores/${storeB}/preview/change-7/index.html`]: { body: '<p>draft B</p>', contentType: 'text/html' },
}

let clock: Clock
let edge: FakeEdge
let cache: ReturnType<typeof fakeCache>
let sites: ReturnType<typeof fakeSites>
let deps: Deps
let settle: () => Promise<void>
const env = { API: { fetch: async () => new Response('api') } as unknown as Fetcher, OWN_ZONE: 'dripfunnel.ai', PAGES_HOST: 'store.pages.dev', PREVIEW_DOMAIN: 'webpreview.store' }
const grantA = { ok: true as const, storeId: storeA, userId: owner, epoch: 3, folder: 'change-2' }

beforeEach(async () => {
  clock = { at: 1_700_000_000_000 }
  edge = fakeEdge()
  edge.tokens.set('link-a', { key: keyA, access: grantA })
  edge.tokens.set('link-b', { key: keyB, access: { ok: true, storeId: storeB, userId: owner, epoch: 0, folder: 'change-7' } })
  edge.access.set(`${keyA}:${storeA}:${owner}:3`, grantA)
  cache = fakeCache(clock)
  sites = fakeSites(objects)
  ;({ deps, settle } = await depsWith({ edge, sites: sites.sites, cache: cache.cache, clock }))
})

afterEach(() => {
  vi.restoreAllMocks()
})

const get = async (href: string, init: RequestInit = {}) => {
  const response = await route(new Request(href, init), env, deps)
  await settle()
  return response
}
const cookieOf = (response: Response) => /__Host-df_preview=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1] ?? ''
const opened = async (host = hostA, token = 'link-a') => cookieOf(await get(`https://${host}/__open?t=${token}`))
const withCookie = (cookie: string, extra = '') => ({ headers: { cookie: `__Host-df_preview=${cookie}${extra}` } })
const isClosed = async (response: Response) => response.status === 403 && (await response.text()).includes('This preview has closed')

describe('opening a preview', () => {
  it('turns the link into the session cookie and drops the token from the address', async () => {
    const response = await get(`https://${hostA}/__open?t=link-a`)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/')
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/^__Host-df_preview=[A-Za-z0-9_-]+; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=900$/)
    expect(cookie).not.toContain(owner)
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(edge.calls).toEqual([`openPreview ${keyA}`])
  })

  it('refuses a link for another store’s preview, or one the API refuses, with the closed page', async () => {
    expect(await isClosed(await get(`https://${hostB}/__open?t=link-a`))).toBe(true)
    expect(await isClosed(await get(`https://${hostA}/__open?t=forged`))).toBe(true)
    expect(await isClosed(await get(`https://${hostA}/__open`))).toBe(true)
  })
})

describe('a preview page', () => {
  it('shows nothing of the store without the cookie: the closed page, or PREVIEW_CLOSED to the SPA', async () => {
    const page = await get(`https://${hostA}/`)
    expect(page.status).toBe(403)
    const html = await page.text()
    expect(html).not.toContain('draft')
    expect(page.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(page.headers.get('referrer-policy')).toBe('no-referrer')
    const api = await get(`https://${hostA}/shop-api/graphql`, { method: 'POST' })
    expect(api.status).toBe(401)
    expect(await api.json()).toMatchObject({ errors: [{ extensions: { code: 'PREVIEW_CLOSED' } }] })
    expect(edge.forwarded).toEqual([])
    expect(sites.asked).toEqual([])
  })

  it('serves index.html for a deep link, never cached, not indexed, and renews the session after the re-check', async () => {
    const cookie = await opened()
    const page = await get(`https://${hostA}/products/linen-shirt/`, withCookie(cookie))
    expect(page.status).toBe(200)
    expect(await page.text()).toBe('<p>draft A</p>')
    expect(page.headers.get('cache-control')).toBe('no-store')
    expect(page.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(page.headers.get('content-security-policy')).toBe("script-src 'self'")
    expect(page.headers.get('set-cookie')).toContain('Max-Age=900')
    expect(edge.calls).toContain(`previewAccess ${keyA}`)
    expect(await (await get(`https://${hostA}/robots.txt`)).text()).toBe('User-agent: *\nDisallow: /\n')
  })

  it('closes for a removed team member or after "End all preview links" at the next page', async () => {
    const cookie = await opened()
    expect((await get(`https://${hostA}/`, withCookie(cookie))).status).toBe(200)
    edge.access.clear()
    expect(await isClosed(await get(`https://${hostA}/`, withCookie(cookie)))).toBe(true)
    expect((await get(`https://${hostA}/shop-api/graphql`, { method: 'POST', ...withCookie(cookie) })).status).toBe(401)
  })

  it('closes once the 15-minute session runs out', async () => {
    const cookie = await opened()
    clock.at += sessionSeconds * 1000 + 1
    expect(await isClosed(await get(`https://${hostA}/`, withCookie(cookie)))).toBe(true)
  })

  it('refuses store A’s cookie, a forged cookie and a studio session on store B’s host', async () => {
    const cookie = await opened()
    expect(await isClosed(await get(`https://${hostB}/`, withCookie(cookie)))).toBe(true)
    expect((await get(`https://${hostB}/assets/app.js`, withCookie(cookie))).status).toBe(403)
    expect(await isClosed(await get(`https://${hostA}/`, withCookie(`${cookie.slice(0, -2)}xx`)))).toBe(true)
    expect(await isClosed(await get(`https://${hostB}/__studio/session-of-a/`))).toBe(true)
    expect(sites.asked.filter((k) => k.includes(storeB))).toEqual([])
  })

  it('serves chunks on the cookie alone, checked before the cache; the copy kept is shared, the one sent private', async () => {
    const cookie = await opened()
    const chunk = await get(`https://${hostA}/assets/app.js`, withCookie(cookie))
    expect([chunk.status, await chunk.text()]).toEqual([200, 'js A'])
    expect(chunk.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
    expect(edge.calls.filter((c) => c.startsWith('previewAccess'))).toEqual([])
    expect(cache.keys()).toEqual([`https://${hostA}/__df/preview/${storeA}/change-2/assets/app.js`])
    const asked = sites.asked.length
    expect((await get(`https://${hostA}/assets/app.js`, withCookie(cookie))).status).toBe(200)
    expect(sites.asked.length).toBe(asked)
    expect((await get(`https://${hostA}/assets/app.js`)).status).toBe(403)
  })

  it('passes /shop-api to the API as a guest: the preview cookie and its issuer never go with it', async () => {
    const cookie = await opened()
    const response = await get(`https://${hostA}/shop-api/graphql`, { method: 'POST', body: '{}', ...withCookie(cookie, '; cart=xyz') })
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('__Host-df_preview=')
    const [forwarded] = edge.forwarded
    expect(forwarded?.headers.get('cookie')).toBe('cart=xyz')
    expect(JSON.stringify([...(forwarded?.headers ?? [])])).not.toContain(owner)
  })

  it('answers a name under the preview domain that is no preview key with nothing', async () => {
    expect((await get('https://not-a-key.webpreview.store/')).status).toBe(404)
    expect((await get(`https://x.${hostA}/`)).status).toBe(404)
  })
})

describe('the request log', () => {
  it('never holds a preview token or a studio session', async () => {
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(line))
    const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext
    vi.stubGlobal('caches', { default: fakeCache(clock).cache })
    const full = { ...env, EDGE: edge, SITES: sites.sites, PREVIEW_SESSION_KEY: sessionKey }
    await worker.fetch(new Request(`https://${hostA}/__open?t=link-a`), full as never, ctx)
    await worker.fetch(new Request(`https://${hostA}/__studio/studio-secret-1/index.html`), full as never, ctx)
    vi.unstubAllGlobals()
    expect(lines.join('\n')).not.toMatch(/link-a|studio-secret-1/)
    expect(lines.map((l) => (JSON.parse(l) as { path: string }).path)).toEqual(['/__open?t=:token', '/__studio/:session/…'])
  })
})
