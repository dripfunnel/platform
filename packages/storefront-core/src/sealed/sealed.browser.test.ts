import type { Browser, Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { launchChrome, serve, type Site } from '../../test/browser'

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

// A theme's CSS that tries every way to hide, cover, shrink or move a sealed price, around hosts core made.
const page = `<!doctype html><html><head><style>
body{margin:0;font:16px sans-serif}
.box{position:relative;height:32px;padding:4px}
.gone{display:none}
.faded{opacity:0}
.locked{display:none!important;opacity:0!important;visibility:hidden!important;filter:opacity(0)!important}
.clear::part(amount),.clear::part(tax){color:transparent}
.cover{position:absolute;inset:0;z-index:99;background:#fff}
.tiny{transform:scale(0.1);transform-origin:0 0}
.away{position:absolute;left:-5000px}
.reach span{display:none}
.reach::part(amount){color:rgb(1, 2, 3)}
.over{position:fixed;inset:auto 0 0 0;height:300px;z-index:99;background:#000}
</style></head><body>
<div class="box" id="ok"></div>
<div class="box gone"><div id="hidden"></div></div>
<div class="box" id="locked"></div>
<div class="box faded"><div id="transparent"></div></div>
<div class="box" id="clear"></div>
<div class="box"><div id="covered"></div><div class="cover"></div></div>
<div class="box tiny"><div id="small"></div></div>
<div class="box away"><div id="offscreen"></div></div>
<div class="box reach" id="reach"></div>
<script type="module">
import { defineSealed, rootOf, sealedRoot, showInTopLayer } from '/core/sealed/element'
import { visibilityProblem, watchVisibility } from '/core/sealed/visibility'
import { setProblemReporter } from '/core/sealed/report'
import { visibilityProblems } from '/core/testing/index'
defineSealed()
const host = (id, part, html, cls = '') => {
  const el = document.createElement('df-sealed')
  el.dataset.dfSealed = part
  el.className = cls
  document.getElementById(id).prepend(el)
  sealedRoot(el, part).innerHTML = html
  return el
}
const price = '<span class="price"><span part="amount">$28.00</span> <span part="tax">+ tax</span></span>'
const hosts = {
  ok: host('ok', 'price', price),
  hidden: host('hidden', 'price', price),
  locked: host('locked', 'price', price, 'locked'),
  transparent: host('transparent', 'price', price),
  clear: host('clear', 'price', price, 'clear'),
  covered: host('covered', 'price', price),
  small: host('small', 'price', price),
  offscreen: host('offscreen', 'price', price),
  reach: host('reach', 'price', price, 'reach'),
}
window.reports = []
setProblemReporter((p) => window.reports.push(p))
watchVisibility(hosts.hidden, 'price')
watchVisibility(hosts.covered, 'price')
watchVisibility(hosts.ok, 'price')
const amount = rootOf(hosts.reach).querySelector('[part=amount]')
const problems = Object.fromEntries(Object.entries(hosts).map(([k, h]) => [k, visibilityProblem(h, 'price', { layout: true })]))
const contract = visibilityProblems('cart', document, { preview: false, poweredBy: false, legal: false })

const over = document.createElement('div')
over.className = 'over'
document.body.append(over)
const consent = host('ok', 'consent', '<section part="banner" popover="manual"><h2 part="title">Cookies on this site</h2><p part="body">We use cookies.</p><button part="button">Accept all</button></section>')
const banner = rootOf(consent).querySelector('[popover]')
showInTopLayer(banner)
window.results = {
  problems,
  contract,
  shadowRoot: hosts.ok.shadowRoot,
  reachedInside: getComputedStyle(amount).display,
  partColour: getComputedStyle(amount).color,
  consent: visibilityProblem(consent, 'consent', { layout: true }),
  topLayer: banner.matches(':popover-open'),
}
</script></body></html>`

type Results = {
  problems: Record<string, string | null>
  contract: string[]
  shadowRoot: null
  reachedInside: string
  partColour: string
  consent: string | null
  topLayer: boolean
}

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

const results = () => tab.evaluate(() => (window as unknown as { results: Results }).results)

describe('sealed components in a browser', () => {
  it('render in a closed shadow root theme CSS reaches only through ::part', async () => {
    const r = await results()
    expect(r.shadowRoot).toBeNull()
    expect(r.reachedInside).not.toBe('none')
    expect(r.partColour).toBe('rgb(1, 2, 3)')
    expect(r.problems.reach).toBeNull()
  })

  it('keep their own host shown, opaque and in place whatever the theme sets on it', async () => {
    expect((await results()).problems.locked).toBeNull()
  })

  it('find each way a theme hides, covers, shrinks or moves one', async () => {
    expect((await results()).problems).toEqual({
      ok: null,
      hidden: 'hidden',
      locked: null,
      transparent: 'transparent',
      clear: 'transparent',
      covered: 'covered',
      small: 'too-small',
      offscreen: 'off-screen',
      reach: null,
    })
  })

  it('report what stays unseen after the page settles, once each', async () => {
    await tab.waitForFunction(() => (window as unknown as { reports: unknown[] }).reports.length >= 2, undefined, { timeout: 5000 })
    const reports = await tab.evaluate(() => (window as unknown as { reports: unknown[] }).reports)
    expect(reports).toEqual(
      expect.arrayContaining([
        { kind: 'sealed', subject: 'price', detail: 'hidden' },
        { kind: 'sealed', subject: 'price', detail: 'covered' },
      ]),
    )
    expect(reports).toHaveLength(2)
  })

  it('fail ./testing for every unseen one and every one missing', async () => {
    const { contract } = await results()
    expect(contract).toEqual([
      'The cart page must render the required "consent" component.',
      `The "price" component on the cart page isn't seen: it is hidden.`,
      `The "price" component on the cart page isn't seen: it or its text is transparent.`,
      `The "price" component on the cart page isn't seen: it or its text is transparent.`,
      `The "price" component on the cart page isn't seen: something covers its centre.`,
      `The "price" component on the cart page isn't seen: it is smaller than 24×12 px.`,
      `The "price" component on the cart page isn't seen: it is off the page.`,
    ])
  })

  it('put the consent banner in the top layer, above anything a theme draws', async () => {
    const r = await results()
    expect(r.topLayer).toBe(true)
    expect(r.consent).toBeNull()
  })
})
