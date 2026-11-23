import type { Browser, Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { launchChrome, serve, type Site } from '../../test/browser'

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

// The checkout's order summary with a wide picture, in a card laid out as the starting themes lay it out (#1669).
const picture = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#c33"/></svg>')}`

const page = `<!doctype html><html><head><style>
body{margin:0;font:16px sans-serif}
.side{display:flex;flex-direction:column;gap:14px;padding:20px;border:1px solid #ccc;width:400px;box-sizing:border-box}
.side h2{margin:0}
</style></head><body>
<div class="side"><h2>Order summary</h2><div id="slot"></div></div>
<script type="module">
import { defineSealed, rootOf, sealedRoot } from '/core/sealed/element'
defineSealed()
const host = document.createElement('df-sealed')
host.dataset.dfSealed = 'summary'
document.getElementById('slot').prepend(host)
sealedRoot(host, 'summary').innerHTML = '<section part="panel"><ul part="lines"><li part="line"><img part="photo" src="${picture}" alt="" width="56" height="70"><span><span part="name">car × 1</span></span><span>₹7,000.00</span></li></ul><dl part="rows"><div part="row"><dt>Subtotal</dt><dd>₹7,000.00</dd></div></dl></section>'
const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, height: r.height } }
const root = rootOf(host)
const img = root.querySelector('[part=photo]')
await img.decode()
window.results = { photo: box(img), name: box(root.querySelector('[part=name]')), subtotal: box(root.querySelector('dt')), overflow: getComputedStyle(img).overflow }
</script></body></html>`

type Box = { left: number; right: number; width: number; height: number }
type Results = { photo: Box; name: Box; subtotal: Box; overflow: string }

let browser: Browser
let site: Site
let tab: Page

beforeAll(async () => {
  browser = await launchChrome()
  site = await serve((path) => (path === '/' ? { body: page } : undefined))
  tab = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await tab.goto(site.origin)
  await tab.waitForFunction(() => 'results' in window)
})

afterAll(async () => {
  await browser.close()
  await site.close()
})

describe('the order summary’s line picture', () => {
  it('stays in its 56 by 70 box, lined up with the rows, and apart from the name', async () => {
    const r = await tab.evaluate(() => (window as unknown as { results: Results }).results)
    expect(r.photo.width).toBe(56)
    expect(r.photo.height).toBe(70)
    expect(r.photo.left).toBe(r.subtotal.left)
    expect(r.name.left).toBeGreaterThan(r.photo.right)
  })

  it('clips a wide picture to its box instead of painting it over the name and past the card’s padding', async () => {
    const r = await tab.evaluate(() => (window as unknown as { results: Results }).results)
    expect(r.overflow).not.toBe('visible')
  })
})
