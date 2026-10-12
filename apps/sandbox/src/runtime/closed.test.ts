import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { bundle, runtimeFolder } from '../gate/bundle'
import { fileFor } from '../publish/serve'
import { buildRuntime } from './build'

// PREVIEW §5 step 3 (#520): once the edge says a preview's session has ended, core's runtime shows its closed screen
// and no store data, from whatever page the link opened.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const baseline = fileURLToPath(new URL('../../../../templates/storefront/themes/baseline/', import.meta.url))
const chrome = [process.env['CHROME_PATH'], '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p): p is string => p !== undefined && existsSync(p))
if (!chrome && process.env['CI']) throw new Error('The closed-preview test needs Chromium in CI; set CHROME_PATH.')

const origin = 'https://k7f3q9f2xa.webpreview.store'
let root: string
let browser: Browser | null = null

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'closed-test-'))
  await buildRuntime(join(root, 'runtime'))
  const built = await bundle(baseline, join(root, 'preview'))
  if (!built.ok) throw new Error(JSON.stringify(built.problems))
  if (chrome) browser = await chromium.launch({ executablePath: chrome, headless: true })
})

afterAll(async () => {
  await browser?.close()
  rmSync(root, { recursive: true, force: true })
})

describe.skipIf(!chrome)('a closed preview', () => {
  it("shows core's closed screen and no store data on a deep link", async () => {
    if (!browser) throw new Error('no browser')
    const context = await browser.newContext()
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== origin) return route.abort('blockedbyclient')
      if (url.pathname === '/shop-api') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ errors: [{ message: 'This preview has closed.', extensions: { code: 'PREVIEW_CLOSED' } }] }) })
      const found = url.pathname.startsWith(`/${runtimeFolder}`) ? await fileFor([join(root, 'runtime')], url.pathname.slice(runtimeFolder.length + 1)) : await fileFor([join(root, 'preview')], url.pathname)
      const file = found ?? (/\.[a-z]+$/.test(url.pathname) ? null : await fileFor([join(root, 'preview')], '/index.html'))
      if (!file) return route.fulfill({ status: 404 })
      return route.fulfill({ status: 200, body: file.bytes, contentType: file.rel.endsWith('.css') ? 'text/css' : file.rel.endsWith('.js') ? 'text/javascript' : 'text/html' })
    })
    try {
      const page = await context.newPage()
      await page.goto(`${origin}/collections/linen/`)
      await page.getByRole('heading', { level: 1, name: 'This preview has closed' }).waitFor()
      const seen = await page.evaluate(() => ({ text: document.body.innerText, robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') }))
      expect(seen.text).toContain('Open it again from your link or from the portal.')
      expect(seen.robots).toMatch(/noindex/)
      expect(await page.locator('header, footer, [data-df-sealed]').count()).toBe(0)
    } finally {
      await context.close()
    }
  })
})
