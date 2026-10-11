import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium, type Browser } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { catalogueSnapshotSchema, type CatalogueSnapshot, type GateReport } from '@dripfunnel/storefront-core/guard'
import { buildRuntime } from '../runtime/build'
import { buildSite } from './build'
import { checkSite } from './check'
import { refusedEnvironment, runStep } from './main'
import { checkout } from './source'

// Card #483: the build image's two publish steps, run as the locked workflow runs them (storefront LIVE-SHOP §4 steps
// 6–7). Each run here takes the store's whole site through a real headless browser, so the timeouts are long.
vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 })

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

  it('stops at the typecheck too, with the validator’s check failing and naming the file, and no site', async () => {
    const source = await sourceOf('untyped', { 'src/theme/pages/SearchPage.tsx': 'export const SearchPage = () => {\n  const count: string = 1\n  return count === null ? null : null\n}\n' })
    await cli(['build', ...stepArgs(source, join(root, 'snapshot.json')), '--out', join(root, 'untyped')])
    const report = JSON.parse(readFileSync(join(root, 'untyped/report.json'), 'utf8')) as GateReport
    expect(report.checks.find((c) => c.name === 'validator')).toMatchObject({ passed: false, detail: expect.stringContaining('src/theme/pages/SearchPage.tsx:2') })
    expect(existsSync(join(root, 'untyped/site'))).toBe(false)
  })
})

describe.skipIf(!chrome)('step check', () => {
  let browser: Browser

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
    await cli(['check', ...stepArgs(source, join(root, 'snapshot.json')), '--built', built, '--out', join(root, 'baseline-checked')])
    const report = JSON.parse(readFileSync(join(root, 'baseline-checked/report.json'), 'utf8')) as GateReport
    expect(report.checks.filter((c) => !c.passed)).toEqual([])
    expect(report.passed).toBe(true)
    const headers = JSON.parse(readFileSync(join(root, 'baseline-checked/headers.json'), 'utf8')) as Record<string, { 'content-security-policy': string }>
    const pages = listing(join(built, 'site')).map((l) => l.slice(66)).filter((p) => p.endsWith('.html'))
    expect(Object.keys(headers).sort()).toEqual(pages.sort())
    expect(headers['index.html']?.['content-security-policy']).toMatch(/^default-src 'none'; script-src 'self' 'sha256-/)
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

  it('fails a page that reaches outside the store, and keeps the request from leaving', async () => {
    const source = await sourceOf('reaching')
    const out = join(root, 'reaching-built')
    const theme = await checkout(source.bundle, source.commit, join(root, 'reaching-src'))
    await buildSite({ repo: join(root, 'reaching-src'), theme, snapshot, runtimeDir: runtime, out, work: join(root, 'reaching-work') })
    // As if something slipped past the validator: the built cart page asks another host for an image.
    const cart = join(out, 'site/cart/index.html')
    writeFileSync(cart, readFileSync(cart, 'utf8').replace('<div id="root">', '<div id="root"><img alt="" src="https://tracker.example/pixel.gif">'))
    const { report } = await checkSite({ site: join(out, 'site'), out, live: null, snapshot, theme, strictLook: false, browser })
    const contracts = report.checks.find((c) => c.name === 'contracts')?.detail ?? ''
    expect(contracts).toContain('The cart page at 390 px failed while loading.')
    expect(contracts).not.toContain('tracker.example')
  })
})
