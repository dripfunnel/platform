import type { Browser, Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { launchChrome } from '../../test/browser'
import { reducedMotionCss } from './reducedMotion'

// Core's reduced-motion rule stops a theme's CSS animations, scroll timelines and transitions in a real browser (#1245).
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

// A theme's CSS as a module or Tailwind writes it, unlayered and after core's, an !important of its own included.
const theme = `
.rise { animation: rise 5s ease infinite both; }
.loud { animation: rise 5s ease infinite both !important; }
.reveal { animation: reveal linear both; animation-timeline: view(); animation-range: entry 0% cover 40%; }
.shade { background-color: rgb(255, 255, 255); transition: background-color 5s ease; }
.shade.on { background-color: rgb(0, 0, 0); }
@keyframes rise { from { opacity: 0; } to { opacity: 1; } }
@keyframes reveal { from { clip-path: inset(0 0 100% 0); } to { clip-path: inset(0); } }
`
const html = `<!doctype html><html><head><style>${reducedMotionCss}</style><style>${theme}</style></head>
<body><div id="rise" class="rise">a</div><div id="loud" class="loud">b</div><div id="shade" class="shade">c</div><div style="height: 3000px"></div><div id="reveal" class="reveal">d</div></body></html>`

type Seen = { rise: string; loud: string; reveal: string; timeline: string; running: number; shade: string }

const look = (page: Page): Promise<Seen> =>
  page.evaluate(async () => {
    const at = (id: string) => document.getElementById(id) ?? document.body
    at('shade').classList.add('on')
    await new Promise((done) => setTimeout(done, 150))
    const style = (id: string) => getComputedStyle(at(id))
    return {
      rise: style('rise').opacity,
      loud: style('loud').opacity,
      reveal: style('reveal').clipPath,
      timeline: style('reveal').animationTimeline,
      running: document.getAnimations().filter((a) => a.playState === 'running').length,
      shade: style('shade').backgroundColor,
    }
  })

let browser: Browser
beforeAll(async () => {
  browser = await launchChrome()
})
afterAll(() => browser.close())

describe("core's reduced-motion rule", () => {
  it('ends every CSS animation, scroll timeline and transition at its last frame under prefers-reduced-motion', async () => {
    const page = await browser.newPage()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setContent(html)
    expect(await look(page)).toEqual({ rise: '1', loud: '1', reveal: 'inset(0px 0px 0%)', timeline: 'auto', running: 0, shade: 'rgb(0, 0, 0)' })
    await page.close()
  })

  it('leaves them running for a shopper who allows motion', async () => {
    const page = await browser.newPage()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.setContent(html)
    const seen = await look(page)
    expect(seen.timeline).toBe('view()')
    expect(seen.running).toBeGreaterThanOrEqual(3)
    expect(seen.shade).not.toBe('rgb(0, 0, 0)')
    await page.close()
  })
})
