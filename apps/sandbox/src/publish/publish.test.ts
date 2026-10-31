import { execFile, execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { catalogueSnapshotSchema, type CatalogueSnapshot, type GateReport } from '@dripfunnel/storefront-core/guard'
import { buildRuntime } from '../runtime/build'
import { buildSite } from './build'
import { browserMetrics, checkSite, difference, type LoadMetrics } from './check'
import { refusedEnvironment, runStep } from './main'
import { checkout } from './source'

// Card #483: the build image's two publish steps, run as the locked workflow runs them (storefront LIVE-SHOP §4 steps
// 6–7). Each run here takes the store's whole site through a real headless browser, so the timeouts are long.
vi.setConfig({ testTimeout: 600_000, hookTimeout: 120_000 })

const run = promisify(execFile)
const sandbox = fileURLToPath(new URL('../../', import.meta.url))
const baselineDir = fileURLToPath(new URL('../../../../packages/storefront-core/src/guard/fixtures/baseline/', import.meta.url))
const chrome = [process.env['CHROME_PATH'], '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p): p is string => p !== undefined && existsSync(p))

const snapshot: CatalogueSnapshot = catalogueSnapshotSchema.parse({
  version: 1,
  origin: 'https://shop.northstar.example',
  store: { name: 'Northstar Linen', description: 'Linen clothes, made slowly.', language: 'en', mainLanguage: 'en', languages: ['en', 'hi'], currency: 'INR', pricingCurrency: 'INR', currencies: [{ code: 'INR' }], pricesIncludeTax: true, timeZone: 'Asia/Kolkata', contactEmail: null, contactPhone: null, logo: null, address: null },
  poweredBy: 'Acme Commerce',
  guard: { locales: ['en', 'hi'], usedPaths: [], mediaIds: ['m_hero01'], brand: { name: 'Northstar Linen', tagline: null, email: null, phone: null, address: [], socialLinks: [] } },
  csp: { assetOrigin: null, mediaOrigins: [], analytics: [], payments: [] },
  assetBase: null,
})

// Card #1011: the Shop API's answers as the platform records them at freeze (apis/shop/record.ts).
const catalogueSnapshot = catalogueSnapshotSchema.parse({
  ...snapshot,
  version: 2,
  catalogue: {
    answers: [
      {
        operation: 'Product',
        variables: { slug: 'linen-shirt' },
        data: {
          product: { id: 'p1', name: 'Linen shirt', slug: 'linen-shirt', productType: 'physical', description: 'Soft.', inStock: true, price: { amount: '249900', currency: 'INR' }, versions: [{ id: 'v-blue', name: 'Blue', choices: [], price: { amount: '249900', currency: 'INR' }, inStock: true }, { id: 'v-red', name: 'Red', choices: [], price: { amount: '249900', currency: 'INR' }, inStock: true }] },
          store: { marketId: null, markets: [] },
        },
      },
      { operation: 'Collection', variables: { slug: 'summer' }, data: { collection: { id: 'c1', name: 'Summer', slug: 'summer', description: null, seoTitle: null, seoDescription: null, image: null } } },
    ],
    products: [{ slug: 'linen-shirt', versions: ['v-blue', 'v-red'] }],
    collections: [{ slug: 'summer' }],
  },
})

/** The baseline's product page showing the product's name and core's sealed price. */
const pricedProductPage = [
  "import { Price, useProduct, useStorefront } from '@dripfunnel/storefront-core/theme'",
  "import { Shell } from '../components/Shell'",
  "import styles from '../styles/page.module.css'",
  '',
  'export const ProductPage = () => {',
  '  const { t, store, locale } = useStorefront()',
  '  const page = useProduct()',
  '  return (',
  "    <Shell title={page.product ? page.product.name : t('pages.product.title')}>",
  "      {page.price ? <Price money={page.price} includesTax={store.pricesIncludeTax} locale={locale} t={t} /> : <p className={styles.lead}>{t('pages.product.lead')}</p>}",
  '    </Shell>',
  '  )',
  '}',
  '',
].join('\n')

let root: string
let runtime: string

const git = (cwd: string, ...args: string[]) => run('git', args, { cwd, env: { PATH: process.env['PATH'] ?? '', HOME: cwd, GIT_AUTHOR_NAME: 'DripFunnel', GIT_AUTHOR_EMAIL: 'noreply@dripfunnel.com', GIT_COMMITTER_NAME: 'DripFunnel', GIT_COMMITTER_EMAIL: 'noreply@dripfunnel.com', GIT_CONFIG_GLOBAL: '/dev/null' } }).then((r) => r.stdout.trim())

/** A store repo of the baseline theme with `overlay` written over it, as a git bundle and its head commit. */
const sourceOf = async (name: string, overlay: Record<string, string> = {}) => {
  const repo = join(root, `${name}-repo`)
  cpSync(baselineDir, repo, { recursive: true })
  for (const [path, text] of Object.entries(overlay)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true })
    writeFileSync(join(repo, path), text)
  }
  await git(repo, 'init', '--quiet', '--initial-branch', 'main')
  await git(repo, 'add', '--all')
  await git(repo, 'commit', '--quiet', '--message', name)
  const bundle = join(root, `${name}.bundle`)
  await git(repo, 'bundle', 'create', '--quiet', bundle, 'main')
  return { bundle, commit: await git(repo, 'rev-parse', 'HEAD') }
}

/** Every file under `dir` with its SHA-256, as the runner lists them. */
const listing = (dir: string, prefix = ''): string[] =>
  readdirSync(join(dir, prefix))
    .sort()
    .flatMap((name) => {
      const rel = prefix ? `${prefix}/${name}` : name
      return statSync(join(dir, rel)).isDirectory() ? listing(dir, rel) : [`${createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex')}  ${rel}`]
    })

const cli = (args: string[], env: Record<string, string> = {}) => run(join(sandbox, 'node_modules/.bin/tsx'), [join(sandbox, 'src/publish/cli.ts'), ...args], { cwd: sandbox, env: { PATH: process.env['PATH'] ?? '', SANDBOX_RUNTIME: runtime, ...(chrome ? { CHROME_PATH: chrome } : {}), ...env }, maxBuffer: 16 * 1024 * 1024 })

const stepArgs = (source: { bundle: string; commit: string }, snapshotFile: string) => ['--source', source.bundle, '--commit', source.commit, '--snapshot', snapshotFile]

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'publish-test-'))
  runtime = join(root, 'runtime')
  await buildRuntime(runtime)
  writeFileSync(join(root, 'snapshot.json'), JSON.stringify(snapshot))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('step build', () => {
  it('builds the same commit and snapshot to byte-identical files, twice', async () => {
    const source = await sourceOf('same')
    await cli(['build', ...stepArgs(source, join(root, 'snapshot.json')), '--out', join(root, 'same-1')])
    await cli(['build', ...stepArgs(source, join(root, 'snapshot.json')), '--out', join(root, 'same-2')])
    const first = listing(join(root, 'same-1/site'))
    expect(first.length).toBeGreaterThan(40)
    expect(listing(join(root, 'same-2/site'))).toEqual(first)
    expect(listing(join(root, 'same-2/edge'))).toEqual(listing(join(root, 'same-1/edge')))
    // What the build writes around the pages: the other language under its code, the sitemap, robots.txt and the edge rules.
    const site = (path: string) => readFileSync(join(root, 'same-1/site', path), 'utf8')
    expect(site('hi/index.html')).toContain('<html lang="hi" dir="ltr">')
    expect(site('sitemap.xml')).toContain('<loc>https://shop.northstar.example/hi/our-story/</loc>')
    expect(site('sitemap.xml')).not.toContain('/cart/')
    expect(site('robots.txt')).toBe('User-agent: *\nAllow: /\nSitemap: https://shop.northstar.example/sitemap.xml\n')
    expect(JSON.parse(site('_edge.json'))).toMatchObject({ notFound: '/404/', fallbacks: expect.arrayContaining([{ prefix: '/products/', page: '/_fallback/product/' }, { prefix: '/hi/products/', page: '/hi/_fallback/product/' }]) })
    // Every edge case has every page of the main language, the right-to-left one laid out so.
    for (const n of [0, 1, 2]) expect(listing(join(root, `same-1/edge/${n}`)).filter((l) => l.endsWith('index.html'))).toHaveLength(first.filter((l) => l.endsWith('index.html') && !l.includes('  hi/')).length)
    expect(readFileSync(join(root, 'same-1/edge/2/index.html'), 'utf8')).toContain('dir="rtl"')
  })

  it('escapes the store’s own words wherever the page carries them: its head, its body and its data for the script', async () => {
    const name = 'Linen & "Co" </script><script>alert(1)</script>'
    const hostile = catalogueSnapshotSchema.parse({ ...snapshot, store: { ...snapshot.store, name, description: '<img src=x onerror=alert(1)> & more' } })
    writeFileSync(join(root, 'hostile.json'), JSON.stringify(hostile))
    const source = await sourceOf('hostile')
    await cli(['build', ...stepArgs(source, join(root, 'hostile.json')), '--out', join(root, 'hostile')])
    const home = readFileSync(join(root, 'hostile/site/index.html'), 'utf8')
    expect(home).toContain('<title>Linen &amp; &quot;Co&quot; &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>')
    expect(home).toContain('<meta name="description" content="&lt;img src=x onerror=alert(1)&gt; &amp; more">')
    expect(home).toContain('\\u003c/script>\\u003cscript>alert(1)\\u003c/script>')
    // Exactly the build's own two scripts: the page's module and its data, nothing the name opened.
    expect(home.match(/<script/g)).toHaveLength(2)
    expect(home.match(/<\/script>/g)).toHaveLength(2)
  })

  it('writes each product, version and collection of a catalogue snapshot as its own page, rendered from the recorded answers', async () => {
    writeFileSync(join(root, 'catalogue.json'), JSON.stringify(catalogueSnapshot))
    const source = await sourceOf('catalogue', { 'src/theme/pages/ProductPage.tsx': pricedProductPage })
    await cli(['build', ...stepArgs(source, join(root, 'catalogue.json')), '--out', join(root, 'catalogue')])
    expect(existsSync(join(root, 'catalogue/report.json'))).toBe(false)
    const site = (path: string) => readFileSync(join(root, 'catalogue/site', path), 'utf8')
    const shirt = site('products/linen-shirt/index.html')
    expect(shirt).toContain('<title>Linen shirt</title>')
    expect(shirt).toMatch(/<h1[^>]*>Linen shirt<\/h1>/)
    expect(shirt).toContain('data-df-sealed="price"')
    expect(shirt).toContain('2,499.00')
    expect(shirt).toContain('"answers":{"[\\"product\\",\\"linen-shirt\\"]"')
    expect(site('products/linen-shirt/v-blue/index.html')).toContain('<link rel="canonical" href="https://shop.northstar.example/products/linen-shirt/">')
    expect(existsSync(join(root, 'catalogue/site/collections/summer/index.html'))).toBe(true)
    expect(existsSync(join(root, 'catalogue/site/collections/all/index.html'))).toBe(true)
    // Another language's items are its client-rendered page's, which reads its own words; so is a product added later.
    expect(existsSync(join(root, 'catalogue/site/hi/products/linen-shirt/index.html'))).toBe(false)
    expect(site('_fallback/product/index.html')).not.toContain('"answers"')
    expect(site('sitemap.xml')).toContain('<loc>https://shop.northstar.example/products/linen-shirt/</loc>')
  })

  it('builds a version 1 snapshot exactly as before: no item pages, no answers in a page', async () => {
    const source = await sourceOf('plain', { 'src/theme/pages/ProductPage.tsx': pricedProductPage })
    await cli(['build', ...stepArgs(source, join(root, 'snapshot.json')), '--out', join(root, 'plain')])
    expect(existsSync(join(root, 'plain/site/products'))).toBe(false)
    expect(readFileSync(join(root, 'plain/site/_fallback/product/index.html'), 'utf8')).not.toContain('"answers"')
  })

  it('builds with the image’s own packages, never ones the store repo carries', async () => {
    const source = await sourceOf('shadowed', {
      'node_modules/clsx/package.json': '{ "name": "clsx", "main": "index.js" }\n',
      'node_modules/clsx/index.js': "module.exports = { clsx: () => 'REPO-CLSX' }\n",
      'node_modules/react/package.json': '{ "name": "react", "main": "index.js" }\n',
      'node_modules/react/index.js': "throw new Error('REPO-REACT')\n",
    })
    await cli(['build', ...stepArgs(source, join(root, 'snapshot.json')), '--out', join(root, 'shadowed')])
    expect(existsSync(join(root, 'shadowed/report.json'))).toBe(false)
    const built = execSync(`grep -rl "REPO-" ${join(root, 'shadowed')} || true`, { encoding: 'utf8' }).trim()
    expect(built.split('\n').filter((f) => f !== '' && !f.includes('/.work/source/'))).toEqual([])
  })

  it('fetches the source only from a local bundle: another transport runs nothing', async () => {
    const marker = join(root, 'transport-ran')
    await expect(runStep(['build', '--source', `ext::sh -c touch% ${marker}`, '--commit', 'a'.repeat(40), '--snapshot', join(root, 'snapshot.json'), '--out', join(root, 'transport')], { PATH: process.env['PATH'] ?? '' })).rejects.toThrow()
    expect(existsSync(marker)).toBe(false)
  })

  it('refuses to start with a token or any of the runner’s own variables in its environment', async () => {
    for (const name of ['GITHUB_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_RUNTIME_TOKEN', 'RUNNER_TEMP', 'INPUT_BUILD_ID', 'R2_SECRET']) {
      expect(await runStep(['build', '--out', join(root, 'never')], { PATH: '/usr/bin', [name]: 'x' })).toBe(1)
    }
    expect(refusedEnvironment({ PATH: '/usr/bin', HOME: '/tmp', SANDBOX_RUNTIME: '/opt/x', NODE_ENV: 'production' })).toEqual([])
    expect(existsSync(join(root, 'never'))).toBe(false)
  })

  it('refuses an unknown step and a commit not named by its full id before it reads anything', async () => {
    await expect(runStep(['deploy', '--out', join(root, 'unknown')], { PATH: '/usr/bin' })).rejects.toThrow('Name the step: build or check.')
    expect(existsSync(join(root, 'unknown'))).toBe(false)
    const source = await sourceOf('named')
    await expect(runStep(['build', '--source', source.bundle, '--commit', 'main', '--snapshot', join(root, 'snapshot.json'), '--out', join(root, 'named')], { PATH: process.env['PATH'] ?? '' })).rejects.toThrow('Name the commit to build by its full id.')
    expect(existsSync(join(root, 'named/site'))).toBe(false)
  })

  it('has no network once the theme renders: a fetch in the build process fails', async () => {
    const source = await sourceOf('offline')
    const probe = join(sandbox, 'src/test/offline-build.ts')
    const { stdout } = await run(join(sandbox, 'node_modules/.bin/tsx'), [probe, ...stepArgs(source, join(root, 'snapshot.json')), '--out', join(root, 'offline')], { cwd: sandbox, env: { PATH: process.env['PATH'] ?? '', SANDBOX_RUNTIME: runtime } })
    expect(stdout.trim()).toBe('NetworkBlocked')
  })

  it('stops at the validator and writes a failing report naming it, with no site', async () => {
    const source = await sourceOf('refused', { 'src/theme/pages/HomePage.tsx': "export const HomePage = () => { void fetch('https://example.com'); return null }\n" })
    await cli(['build', ...stepArgs(source, join(root, 'snapshot.json')), '--out', join(root, 'refused')])
    const report = JSON.parse(readFileSync(join(root, 'refused/report.json'), 'utf8')) as GateReport
    expect(report.passed).toBe(false)
    expect(report.checks.find((c) => c.name === 'validator')).toMatchObject({ passed: false })
    expect(existsSync(join(root, 'refused/site'))).toBe(false)
  })

  it('names a page whose theme code throws while rendering, writes no site, and keeps the error’s text out of the report', async () => {
    const source = await sourceOf('throwing', { 'src/theme/pages/SearchPage.tsx': 'export const SearchPage = () => {\n  const parsed: number = JSON.parse(\'{\') as number\n  return parsed === 0 ? null : null\n}\n' })
    await cli(['build', ...stepArgs(source, join(root, 'snapshot.json')), '--out', join(root, 'throwing')])
    const report = JSON.parse(readFileSync(join(root, 'throwing/report.json'), 'utf8')) as GateReport
    const contracts = report.checks.find((c) => c.name === 'contracts')
    expect(contracts).toMatchObject({ passed: false, detail: expect.stringContaining('The search page (/search/) failed while rendering.') })
    expect(contracts?.detail).not.toMatch(/JSON|SyntaxError|Unexpected/)
    expect(existsSync(join(root, 'throwing/site'))).toBe(false)
    expect(existsSync(join(root, 'throwing/edge'))).toBe(false)
  })

  it('refuses a theme that only breaks on the edge-case catalogue, naming the case, with no site or edge render left', async () => {
    const source = await sourceOf('edge-throwing', {
      'src/theme/pages/SearchPage.tsx': [
        "import { useStorefront } from '@dripfunnel/storefront-core/theme'",
        '',
        'export const SearchPage = () => {',
        '  const { store } = useStorefront()',
        "  const parsed: number = store.name.length > 150 ? (JSON.parse('{') as number) : 0",
        '  return parsed === 1 ? null : null',
        '}',
        '',
      ].join('\n'),
    })
    await cli(['build', ...stepArgs(source, join(root, 'snapshot.json')), '--out', join(root, 'edge-throwing')])
    const report = JSON.parse(readFileSync(join(root, 'edge-throwing/report.json'), 'utf8')) as GateReport
    expect(report.checks.find((c) => c.name === 'edge-cases')).toMatchObject({ passed: false, detail: 'With very long names and no logo or contact details: The search page (/search/) failed while rendering.' })
    expect(existsSync(join(root, 'edge-throwing/site'))).toBe(false)
    expect(existsSync(join(root, 'edge-throwing/edge'))).toBe(false)
  })

  it('stops at the typecheck too, with the validator’s check failing and naming the file, and no site', async () => {
    const source = await sourceOf('untyped', { 'src/theme/pages/SearchPage.tsx': 'export const SearchPage = () => {\n  const count: string = 1\n  return count === null ? null : null\n}\n' })
    await cli(['build', ...stepArgs(source, join(root, 'snapshot.json')), '--out', join(root, 'untyped')])
    const report = JSON.parse(readFileSync(join(root, 'untyped/report.json'), 'utf8')) as GateReport
    expect(report.checks.find((c) => c.name === 'validator')).toMatchObject({ passed: false, detail: expect.stringContaining('src/theme/pages/SearchPage.tsx:2') })
    expect(existsSync(join(root, 'untyped/site'))).toBe(false)
  })
})

// Skipped only off CI, and then said so: in CI a missing Chromium fails the run rather than dropping these tests.
if (!chrome && process.env['CI']) throw new Error('The check step’s tests need Chromium in CI; set CHROME_PATH.')
if (!chrome) console.warn('Skipping the check step’s tests: no Chromium here (set CHROME_PATH).')

describe.skipIf(!chrome)('step check', () => {
  let browser: Browser
  // CI's runner is shared with every other suite, so its clock can't gate a page: the layout shift is the browser's
  // own, the times are fixed (the next test proves timings over budget fail).
  const steady = (tbt: (path: string) => number) => async (page: Page): Promise<LoadMetrics> => ({ ...(await browserMetrics(page)), lcp: 500, tbt: tbt(new URL(page.url()).pathname) })

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: chrome ?? '', headless: true })
  })

  afterAll(async () => {
    await browser?.close()
  })

  it('passes the baseline theme through the whole gate against the edge-case catalogue, and writes every page’s CSP', async () => {
    const source = await sourceOf('baseline')
    const built = join(root, 'baseline-built')
    await cli(['build', ...stepArgs(source, join(root, 'snapshot.json')), '--out', built])
    // Its own copy as the live site, in a publish that must keep the look: every page matches.
    cpSync(join(built, 'site'), join(root, 'baseline-live'), { recursive: true })
    const checkArgs = ['check', ...stepArgs(source, join(root, 'snapshot.json')), '--built', built, '--live', join(root, 'baseline-live'), '--strict-look', '--out', join(root, 'baseline-checked')]
    expect(await runStep(checkArgs, { PATH: process.env['PATH'] ?? '' }, { metrics: steady(() => 20) })).toBe(0)
    const report = JSON.parse(readFileSync(join(root, 'baseline-checked/report.json'), 'utf8')) as GateReport
    expect(report.checks.filter((c) => !c.passed)).toEqual([])
    expect(report.checks.find((c) => c.name === 'visual-diff')).toEqual({ name: 'visual-diff', passed: true })
    expect(report.passed).toBe(true)
    const headers = JSON.parse(readFileSync(join(root, 'baseline-checked/headers.json'), 'utf8')) as Record<string, { 'content-security-policy': string }>
    const pages = listing(join(built, 'site')).map((l) => l.slice(66)).filter((p) => p.endsWith('.html'))
    expect(Object.keys(headers).sort()).toEqual(pages.sort())
    expect(headers['index.html']?.['content-security-policy']).toMatch(/^default-src 'none'; script-src 'self' 'sha256-/)
    // A snapshot without the store's portal lets no page frame the site.
    expect(Object.values(headers).every((h) => h['content-security-policy'].includes("frame-ancestors 'none'"))).toBe(true)
  })

  it('passes a catalogue snapshot’s product and collection pages through the whole gate, hydrated from their answers (#1011)', async () => {
    writeFileSync(join(root, 'catalogue-check.json'), JSON.stringify(catalogueSnapshot))
    const source = await sourceOf('catalogue-check', { 'src/theme/pages/ProductPage.tsx': pricedProductPage })
    const built = join(root, 'catalogue-check-built')
    await cli(['build', ...stepArgs(source, join(root, 'catalogue-check.json')), '--out', built])
    const checkArgs = ['check', ...stepArgs(source, join(root, 'catalogue-check.json')), '--built', built, '--out', join(root, 'catalogue-check-checked')]
    expect(await runStep(checkArgs, { PATH: process.env['PATH'] ?? '' }, { metrics: steady(() => 20) })).toBe(0)
    const report = JSON.parse(readFileSync(join(root, 'catalogue-check-checked/report.json'), 'utf8')) as GateReport
    // The product page places the sealed price its answer gave it, and its script hydrates the built HTML without a mismatch.
    expect(report.checks.filter((c) => !c.passed)).toEqual([])
    const headers = JSON.parse(readFileSync(join(root, 'catalogue-check-checked/headers.json'), 'utf8')) as Record<string, unknown>
    expect(Object.keys(headers)).toEqual(expect.arrayContaining(['products/linen-shirt/index.html', 'products/linen-shirt/v-red/index.html', 'collections/summer/index.html']))
  })

  it('fails a page whose loads block the main thread past the budget, by the timings it measured', async () => {
    const source = await sourceOf('blocking')
    const out = join(root, 'blocking-built')
    const theme = await checkout(source.bundle, source.commit, join(root, 'blocking-src'))
    await buildSite({ repo: join(root, 'blocking-src'), theme, snapshot, runtimeDir: runtime, out, work: join(root, 'blocking-work') })
    const { report } = await checkSite({ site: join(out, 'site'), out, live: null, snapshot, theme, strictLook: false, browser, metrics: steady((path) => (path === '/' ? 400 : 20)) })
    // The slowdown is the host's own calibration, so only its shape is fixed.
    expect(report.checks.find((c) => c.name === 'budgets')).toEqual({ name: 'budgets', passed: false, detail: expect.stringMatching(/^Home page blocks for 400 ms while loading, over 150 ms \(runs 400, 400, 400 ms; CPU slowed \d\.\d×\)\.$/) })
  })

  it('refuses a covered required part, a checkout broken on phones, JavaScript over budget and an empty h1 without JavaScript, each by name', async () => {
    const digits = (seed: number) => {
      let x = seed
      return Array.from({ length: 11_000 }, () => (x = (x * 1103515245 + 12345) % 2147483648) % 1000000).join(', ')
    }
    const table = (n: number) => `export const table${n} = [${digits(n + 7)}]\n`
    const source = await sourceOf('broken', {
      'src/theme/components/interactive/tableA.tsx': table(1),
      'src/theme/components/interactive/tableB.tsx': table(2),
      'src/theme/components/interactive/tableC.tsx': table(3),
      'src/theme/components/interactive/tableD.tsx': table(4),
      'src/theme/components/interactive/Heavy.tsx': [
        "'use client'",
        '',
        "import { useMemo } from 'react'",
        "import { table1 } from './tableA'",
        "import { table2 } from './tableB'",
        "import { table3 } from './tableC'",
        "import { table4 } from './tableD'",
        '',
        'export const Heavy = () => {',
        '  const total = useMemo(() => table1.length + table2.length + table3.length + table4.length, [])',
        '  return <span data-total={total} />',
        '}',
        '',
      ].join('\n'),
      'src/theme/components/interactive/Later.tsx': [
        "'use client'",
        '',
        "import { useEffect, useState } from 'react'",
        '',
        'export const Later = ({ words }: { words: string }) => {',
        '  const [shown, setShown] = useState(false)',
        '  useEffect(() => setShown(true), [])',
        '  return <>{shown ? words : null}</>',
        '}',
        '',
      ].join('\n'),
      'src/theme/components/Shell.tsx': readFileSync(join(baselineDir, 'src/theme/components/Shell.tsx'), 'utf8')
        .replace("import styles from '../styles/shell.module.css'", "import styles from '../styles/shell.module.css'\nimport { Later } from './interactive/Later'")
        .replace('{title}</h1>', '<Later words={title} /></h1>')
        .replace('<PoweredBy brand={poweredBy} t={t} className={styles.powered} />', '<PoweredBy brand={poweredBy} t={t} className={styles.powered} />\n        <span className={styles.veil} />'),
      'src/theme/styles/shell.module.css': `${readFileSync(join(baselineDir, 'src/theme/styles/shell.module.css'), 'utf8')}\n.veil {\n  position: absolute;\n  inset: 0;\n  background: #fff;\n}\n\n.footer {\n  position: relative;\n}\n\n.blocker {\n  display: none;\n}\n\n@media (max-width: 500px) {\n  .blocker {\n    display: block;\n    position: fixed;\n    inset: 0;\n    z-index: 50;\n    background: #fff;\n  }\n}\n`,
      'src/theme/pages/CheckoutPage.tsx': readFileSync(join(baselineDir, 'src/theme/pages/CheckoutPage.tsx'), 'utf8')
        .replace("import styles from '../styles/page.module.css'", "import styles from '../styles/page.module.css'\nimport shell from '../styles/shell.module.css'")
        .replace('</p>\n    </Shell>', '</p>\n      <div className={shell.blocker} />\n    </Shell>'),
      'src/theme/pages/HomePage.tsx': readFileSync(join(baselineDir, 'src/theme/pages/HomePage.tsx'), 'utf8')
        .replace("import { Disclosure } from '../components/interactive/Disclosure'", "import { Disclosure } from '../components/interactive/Disclosure'\nimport { Heavy } from '../components/interactive/Heavy'")
        .replace('</Disclosure>', '</Disclosure>\n      <Heavy />'),
    })
    const out = join(root, 'broken-built')
    const theme = await checkout(source.bundle, source.commit, join(root, 'broken-src'))
    const built = await buildSite({ repo: join(root, 'broken-src'), theme, snapshot, runtimeDir: runtime, out, work: join(root, 'broken-work') })
    expect(built.ok ? [] : built.report.checks.filter((c) => !c.passed)).toEqual([])
    const { report } = await checkSite({ site: join(out, 'site'), out, live: null, snapshot, theme, strictLook: false, browser })
    const failed = Object.fromEntries(report.checks.filter((c) => !c.passed).map((c) => [c.name, c.detail ?? '']))
    expect(report.passed).toBe(false)
    expect(failed['sealed']).toContain('The "powered" component on the home page isn\'t seen: something covers its centre.')
    expect(failed['checkout']).toContain('The checkout page at 390 px can\'t be used')
    expect(failed['budgets']).toMatch(/^Home page loads [\d.]+ KB of JavaScript gzipped, over the 90.0 KB budget\./)
    expect(failed['no-js']).toContain("main heading is empty without JavaScript.")
    expect(report.checks.find((c) => c.name === 'validator')).toEqual({ name: 'validator', passed: true })
  })

  it('fails a page that reaches outside the store, with JavaScript on or off, and serves the build’s assets from its asset host', async () => {
    // The pages load their JS and CSS from the asset host, which the check step answers from the build's own files.
    const hosted = catalogueSnapshotSchema.parse({ ...snapshot, csp: { ...snapshot.csp, assetOrigin: 'https://sf-assets.example.com', portalOrigin: 'https://store.partner-a.example' }, assetBase: 'https://sf-assets.example.com/stores/s1/builds/b1/assets/' })
    const source = await sourceOf('reaching')
    const out = join(root, 'reaching-built')
    const theme = await checkout(source.bundle, source.commit, join(root, 'reaching-src'))
    await buildSite({ repo: join(root, 'reaching-src'), theme, snapshot: hosted, runtimeDir: runtime, out, work: join(root, 'reaching-work') })
    expect(readFileSync(join(out, 'site/index.html'), 'utf8')).toContain('src="https://sf-assets.example.com/stores/s1/builds/b1/assets/assets/entry-')
    // As if something slipped past the validator: the built cart page asks another host for an image.
    const cart = join(out, 'site/cart/index.html')
    writeFileSync(cart, readFileSync(cart, 'utf8').replace('<div id="root">', '<div id="root"><img alt="" src="https://tracker.example/pixel.gif">'))
    // And the search page never settles: its script asks the Shop API every 200 ms, so the page fails, not the step.
    writeFileSync(join(out, 'site/assets/poll.js'), "setInterval(() => fetch('/shop-api', { method: 'POST', body: '{}' }), 200)\n")
    const search = join(out, 'site/search/index.html')
    writeFileSync(search, readFileSync(search, 'utf8').replace('</head>', '<script src="/assets/poll.js"></script></head>'))
    const { report, headers } = await checkSite({ site: join(out, 'site'), out, live: null, snapshot: hosted, theme, strictLook: false, browser })
    // Every page may be framed by the store's portal and nothing else (ARCHITECTURE §3.5).
    expect(Object.values(headers).map((h) => h['content-security-policy'].split('; ').find((d) => d.startsWith('frame-ancestors')))).toEqual(Object.keys(headers).map(() => 'frame-ancestors https://store.partner-a.example'))
    const contracts = report.checks.find((c) => c.name === 'contracts')?.detail ?? ''
    // With JavaScript on the page's CSP stops it; with JavaScript off the CSP is bypassed and the routing refuses it.
    expect(contracts).toContain('The cart page at 390 px failed while loading.')
    expect(contracts).toContain('The cart page failed to load without JavaScript.')
    expect(contracts).not.toContain('tracker.example')
    expect(contracts).toContain('The search page at 390 px failed while loading.')
    // Only those two failed: every other page loaded its scripts and styles from the asset host.
    expect(contracts).not.toMatch(/home page|checkout page|page \/our-story/)
    expect(report.checks.find((c) => c.name === 'sealed')).toEqual({ name: 'sealed', passed: true })
  })

  it('compares each page with the live site’s, its JS and CSS from the live build’s own files, and fails a page whose script doesn’t hydrate its HTML', async () => {
    const source = await sourceOf('look')
    const out = join(root, 'look-built')
    const theme = await checkout(source.bundle, source.commit, join(root, 'look-src'))
    await buildSite({ repo: join(root, 'look-src'), theme, snapshot, runtimeDir: runtime, out, work: join(root, 'look-work') })
    // The live site is this same build with its stylesheet spacing headings out, served from the live build's own files.
    const live = join(root, 'look-live')
    cpSync(join(out, 'site'), live, { recursive: true })
    const css = readdirSync(join(live, 'assets')).find((f) => f.endsWith('.css')) ?? ''
    writeFileSync(join(live, 'assets', css), `${readFileSync(join(live, 'assets', css), 'utf8')}main h1{letter-spacing:12px}\n`)
    // This build's search page renders a heading its script doesn't, so its hydration fails.
    const search = join(out, 'site/search/index.html')
    writeFileSync(search, readFileSync(search, 'utf8').replace('>Search</h1>', '>Searching</h1>'))
    const { report } = await checkSite({ site: join(out, 'site'), out, live, snapshot, theme, strictLook: true, browser })
    const check = (name: string) => report.checks.find((c) => c.name === name)
    expect(check('visual-diff')).toMatchObject({ passed: false, detail: expect.stringMatching(/^The home page at 390 px looks different from the live site/) })
    expect(check('contracts')?.detail).toContain('The search page at 390 px failed while loading.')
  })

  it('counts every pixel when two screenshots differ in size', async () => {
    const page = await browser.newPage()
    try {
      await page.setContent('<body style="margin:0;background:#fff"></body>')
      await page.setViewportSize({ width: 40, height: 40 })
      const small = await page.screenshot()
      expect(await difference(page, small, small)).toBe(0)
      await page.setViewportSize({ width: 60, height: 40 })
      expect(await difference(page, small, await page.screenshot())).toBe(1)
      await page.setContent('<body style="margin:0;background:#000"></body>')
      await page.setViewportSize({ width: 40, height: 40 })
      expect(await difference(page, small, await page.screenshot())).toBe(1)
    } finally {
      await page.close()
    }
  })
})
