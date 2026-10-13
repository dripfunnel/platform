import { appendFileSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { catalogueSnapshotSchema, smokeProblems, type ThemeFile } from '@dripfunnel/storefront-core/guard'
import { buildRuntime } from '../runtime/build'
import { buildSite } from './build'
import { smokeTest } from './smoke'

// Card #313: the checkout smoke test over a built live site, as the build image runs it (LIVE-SHOP §4 step 7): the
// baseline theme passes at every width, a theme whose checkout can't place an order fails, and a theme whose checkout
// throws still sells through core's baseline checkout.
vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 })

const baseline = fileURLToPath(new URL('../../../../templates/storefront/themes/baseline/', import.meta.url))
const chrome = [process.env['CHROME_PATH'], '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p): p is string => p !== undefined && existsSync(p))

const snapshot = catalogueSnapshotSchema.parse({
  version: 1,
  origin: 'https://shop.juniper.example',
  store: { name: 'Juniper & Co.', description: 'Everyday clothes and home goods, made to last.', language: 'en', mainLanguage: 'en', languages: ['en'], currency: 'USD', pricingCurrency: 'USD', currencies: [{ code: 'USD' }], pricesIncludeTax: false, timeZone: 'America/New_York', contactEmail: null, contactPhone: null, logo: null, address: { street: null, city: 'Columbus', region: 'OH', postal: null, country: 'US' } },
  poweredBy: null,
  guard: { locales: ['en'], usedPaths: [], mediaIds: [], brand: { name: 'Juniper & Co.', tagline: null, email: null, phone: null, address: [], socialLinks: [] } },
  csp: { assetOrigin: null, mediaOrigins: [], analytics: [], payments: [] },
  assetBase: null,
})

// Renders on the server, as the build needs, and throws once running in the browser.
const breaks = [
  "'use client'",
  '',
  "import { useEffect, useState } from 'react'",
  '',
  'export const Breaks = () => {',
  '  const [running, setRunning] = useState(false)',
  '  useEffect(() => setRunning(true), [])',
  "  if (running) throw new Error('This theme broke its checkout.')",
  '  return null',
  '}',
  '',
].join('\n')

const walk = (dir: string, rel = ''): string[] =>
  readdirSync(join(dir, rel)).flatMap((name) => {
    const path = rel ? `${rel}/${name}` : name
    return statSync(join(dir, path)).isDirectory() ? walk(dir, path) : [path]
  })

let root = ''
let runtime = ''
let browser: Browser | null = null

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'smoke-test-'))
  runtime = join(root, 'runtime')
  await buildRuntime(runtime)
  if (chrome) browser = await chromium.launch({ executablePath: chrome, headless: true })
})
afterAll(async () => {
  await browser?.close()
  if (root) rmSync(root, { recursive: true, force: true })
})

/** The baseline theme, changed by `change`, built as the store repo's workflow builds it; its live site's folder. */
const built = async (name: string, change: (repo: string) => void = () => undefined) => {
  const repo = join(root, `${name}-repo`)
  cpSync(baseline, repo, { recursive: true })
  change(repo)
  const theme: ThemeFile[] = walk(repo).filter((p) => p !== 'template.json').map((path) => ({ path, content: readFileSync(join(repo, path), 'utf8') }))
  const out = join(root, `${name}-out`)
  const result = await buildSite({ repo, theme, snapshot, runtimeDir: runtime, out, work: join(root, `${name}-work`) })
  if (!result.ok) throw new Error(JSON.stringify(result.report))
  return join(out, 'site')
}

describe.skipIf(!chrome)('the checkout smoke test', () => {
  it('buys the test product through the baseline theme’s cart and checkout to the order’s page at every width', async () => {
    if (!browser) throw new Error('no browser')
    const runs = await smokeTest({ browser, site: await built('baseline'), snapshot })
    expect(runs).toEqual([390, 768, 1440].map((width) => ({ width, problem: null })))
    expect(smokeProblems(runs)).toEqual([])
  })

  it('fails a theme whose checkout can’t place the order, at every width', async () => {
    if (!browser) throw new Error('no browser')
    const site = await built('no-place-order', (repo) => appendFileSync(join(repo, 'src/theme/styles/checkout.module.css'), '\n.pay {\n  display: none;\n}\n'))
    const problems = smokeProblems(await smokeTest({ browser, site, snapshot }))
    expect(problems).toHaveLength(3)
    expect(problems[0]).toMatch(/^The test purchase at 390 px didn't complete: /)
  })

  it('still sells through core’s baseline checkout when the theme’s checkout throws', async () => {
    if (!browser) throw new Error('no browser')
    const site = await built('throwing-checkout', (repo) => {
      writeFileSync(join(repo, 'src/theme/components/interactive/Breaks.tsx'), breaks)
      const page = join(repo, 'src/theme/pages/CheckoutPage.tsx')
      writeFileSync(page, readFileSync(page, 'utf8').replace("import { CheckoutView } from '../components/interactive/CheckoutView'", "import { Breaks } from '../components/interactive/Breaks'\nimport { CheckoutView } from '../components/interactive/CheckoutView'").replace('<CheckoutView />', '<Breaks />\n    <CheckoutView />'))
    })
    expect(smokeProblems(await smokeTest({ browser, site, snapshot }))).toEqual([])
  })
})
