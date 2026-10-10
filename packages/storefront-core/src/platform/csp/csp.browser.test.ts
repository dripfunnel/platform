import type { Browser, Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { launchChrome, serve, type Answer, type Site } from '../../../test/browser'
import { hashSource, storeCsp, studioCsp } from './csp'

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

const pixel: Answer = { body: Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0)), type: 'image/gif' }
const other: Answer = { body: 'window.fromOther = true', type: 'text/javascript' }
const asset = (path: string): Answer | undefined => (path === '/pixel.gif' ? pixel : path === '/x.js' ? other : path === '/data' ? { body: '{}', type: 'application/json' } : undefined)

// What every test page tries; `report` hands the results back.
const probes = (report: string) => `
const load = (src) => new Promise((done) => { const img = new Image(); img.onload = () => done('loaded'); img.onerror = () => done('refused'); img.src = src })
const get = (url) => fetch(url).then(() => 'ok', () => 'refused')
const out = { injected: 'injected' in window, fromOther: 'fromOther' in window }
out.mediaImage = await load(MEDIA + '/pixel.gif')
out.otherImage = await load(OTHER + '/pixel.gif')
out.sameFetch = await get('/data')
out.otherFetch = await get(OTHER + '/data')
try { document.body.innerHTML = '<b>x</b>'; out.html = 'set' } catch { out.html = 'refused' }
${report}`

let browser: Browser
let sites: Site[]
let site: Site, otherSite: Site, media: Site, portal: Site, stranger: Site
let liveScript = ''
let studioScript = ''
let live = ''
let studio = ''

// The live page runs its probes inline, by hash; the studio frame allows no inline script, so it loads them from its own origin.
const page = (script: string) =>
  `<!doctype html><html><head></head><body><script>window.injected = true</script><script src="${otherSite.origin}/x.js"></script>${script ? `<script type="module">${script}</script>` : '<script type="module" src="probe.js"></script>'}</body></html>`

beforeAll(async () => {
  browser = await launchChrome()
  otherSite = await serve(asset)
  media = await serve(asset)
  const parent = (path: string): Answer | undefined =>
    path === '/' ? { body: `<!doctype html><iframe src="${site.origin}/__studio/s1/"></iframe><script>addEventListener('message', (e) => { if (e.origin === '${site.origin}') window.results = e.data })</script>` } : undefined
  portal = await serve(parent)
  stranger = await serve(parent)
  site = await serve((path) => {
    if (path === '/') return { body: page(liveScript), headers: { 'content-security-policy': live } }
    if (path === '/__studio/s1/') return { body: page(''), headers: { 'content-security-policy': studio } }
    if (path === '/__studio/s1/probe.js') return { body: studioScript, type: 'text/javascript' }
    return asset(path)
  })
  sites = [site, otherSite, media, portal, stranger]
  const names = `const MEDIA = '${media.origin}'; const OTHER = '${otherSite.origin}';`
  liveScript = `${names}
import { installTrustedTypes } from '/core/platform/csp/trustedTypes'
${probes(`installTrustedTypes({ analyticsHosts: ['www.googletagmanager.com'], buildOrigins: [location.origin] })
const script = document.createElement('script')
try { script.src = OTHER + '/x.js'; out.otherScriptUrl = 'set' } catch { out.otherScriptUrl = 'refused' }
try { script.src = 'https://www.googletagmanager.com/gtag/js?id=G-1'; out.analyticsScriptUrl = 'set' } catch { out.analyticsScriptUrl = 'refused' }
try { trustedTypes.createPolicy('mine', { createHTML: (s) => s }); out.ownPolicy = 'made' } catch { out.ownPolicy = 'refused' }
window.results = out`)}`
  studioScript = `${names}\n${probes(`parent.postMessage(out, '${portal.origin}')`)}`
  const hashes = (script: string) => hashSource(script).then((h) => ({ scripts: [h], styles: [] }))
  live = storeCsp({ assetOrigin: null, mediaOrigins: [media.origin], analytics: ['ga4'], payments: [] }, await hashes(liveScript))
  studio = studioCsp({ mediaOrigin: media.origin, portalOrigin: portal.origin }, { styles: [] })
})

afterAll(async () => {
  await browser.close()
  await Promise.all(sites.map((s) => s.close()))
})

const resultsAt = async (url: string): Promise<{ tab: Page; results: Record<string, unknown> | undefined }> => {
  const tab = await browser.newPage()
  await tab.goto(url)
  const results = await tab
    .waitForFunction(() => (window as unknown as { results?: Record<string, unknown> }).results, undefined, { timeout: 3000 })
    .then((r) => r.jsonValue())
    .catch(() => undefined)
  return { tab, results }
}

describe("a store's CSP in a browser", () => {
  it('refuses an inline script it has no hash for, a script and a fetch from another origin, and HTML strings', async () => {
    const { results } = await resultsAt(site.origin)
    expect(results).toMatchObject({ injected: false, fromOther: false, otherFetch: 'refused', otherImage: 'refused', html: 'refused' })
    expect(results).toMatchObject({ sameFetch: 'ok', mediaImage: 'loaded' })
  })

  it("lets core's default policy take a script URL only on the store's analytics hosts, and no other policy be made", async () => {
    const { results } = await resultsAt(site.origin)
    expect(results).toMatchObject({ otherScriptUrl: 'refused', analyticsScriptUrl: 'set', ownPolicy: 'refused' })
  })
})

describe("the studio frame's CSP in a browser", () => {
  it("opens only inside the store's portal", async () => {
    expect((await resultsAt(portal.origin)).results).toBeDefined()
    expect((await resultsAt(stranger.origin)).results).toBeUndefined()
  })

  it("refuses a connection, a script or an image to any host but its own and the platform's media", async () => {
    const { results } = await resultsAt(portal.origin)
    expect(results).toEqual({ injected: false, fromOther: false, mediaImage: 'loaded', otherImage: 'refused', sameFetch: 'ok', otherFetch: 'refused', html: 'refused' })
  })
})
