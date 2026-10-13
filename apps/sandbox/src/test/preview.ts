import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type BrowserContext } from 'playwright-core'
import { bundle, runtimeFolder } from '../gate/bundle'
import { fileFor } from '../publish/serve'
import { buildRuntime } from '../runtime/build'

// The baseline theme's preview bundle served as the preview host serves it (PREVIEW §5 step 4), for tests that drive its
// pages in a browser against a Shop API the test answers.

export const previewOrigin = 'https://k7f3q9f2xa.webpreview.store'
export const chrome = [process.env['CHROME_PATH'], '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p): p is string => p !== undefined && existsSync(p))

export type ShopRequest = { query: string; variables: Record<string, unknown>; headers: Record<string, string> }
export type ShopAnswer = (request: ShopRequest) => unknown

export const baselineTheme = fileURLToPath(new URL('../../../../templates/storefront/themes/baseline/', import.meta.url))

export type Preview = { browser: Browser; open: (answer: ShopAnswer, width?: number) => Promise<BrowserContext>; close: () => Promise<void> }

/** Builds core's runtime and a theme's bundle (the baseline's unless named) once, and launches the browser. */
export const startPreview = async (theme = baselineTheme): Promise<Preview> => {
  if (!chrome) throw new Error('no browser')
  const root = mkdtempSync(join(tmpdir(), 'preview-test-'))
  const runtime = join(root, 'runtime')
  const out = join(root, 'preview')
  await buildRuntime(runtime)
  const built = await bundle(theme, out)
  if (!built.ok) throw new Error(JSON.stringify(built.problems))
  const browser = await chromium.launch({ executablePath: chrome, headless: true })
  const open = async (answer: ShopAnswer, width = 1440) => {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    // A shopper who answered consent, so the banner covers nothing the test presses.
    await context.addInitScript(() => localStorage.setItem('df-consent-v1', JSON.stringify({ analytics: false, marketing: false, at: '2026-01-01T00:00:00.000Z' })))
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== previewOrigin) return route.abort('blockedbyclient')
      if (url.pathname === '/shop-api') {
        const body = JSON.parse(route.request().postData() ?? '{}') as { query: string; variables?: Record<string, unknown> }
        const reply = answer({ query: body.query, variables: body.variables ?? {}, headers: route.request().headers() })
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) })
      }
      const found = url.pathname.startsWith(`/${runtimeFolder}`) ? await fileFor([runtime], url.pathname.slice(runtimeFolder.length + 1)) : await fileFor([out], url.pathname)
      const file = found ?? (/\.[a-z]+$/.test(url.pathname) ? null : await fileFor([out], '/index.html'))
      if (!file) return route.fulfill({ status: 404 })
      return route.fulfill({ status: 200, body: file.bytes, contentType: file.rel.endsWith('.css') ? 'text/css' : file.rel.endsWith('.js') ? 'text/javascript' : 'text/html' })
    })
    return context
  }
  return {
    browser,
    open,
    close: async () => {
      await browser.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

export const previewStore = { name: 'Juniper & Co.', description: 'Everyday clothes and home goods, made to last.', language: 'en', mainLanguage: 'en', languages: ['en'], currency: 'USD', pricingCurrency: 'USD', currencies: [{ code: 'USD' }], pricesIncludeTax: false, timeZone: 'America/New_York', contactEmail: 'hello@juniper.example', contactPhone: null, logo: null, address: null }

/** The answers every page asks for, and a refusal for anything the test doesn't answer. */
export const basics = (request: ShopRequest): unknown => {
  if (request.query.includes('reportStorefrontProblem')) return { data: { reportStorefrontProblem: true } }
  if (request.query.startsWith('query Store')) return { data: { store: previewStore } }
  if (request.query.startsWith('query Menu')) return { data: { menu: [] } }
  return { errors: [{ message: 'No answer.', extensions: { code: 'UNAVAILABLE' } }] }
}
