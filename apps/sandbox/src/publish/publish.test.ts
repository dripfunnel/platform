import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { catalogueSnapshotSchema, type CatalogueSnapshot, type GateReport } from '@dripfunnel/storefront-core/guard'
import { buildRuntime } from '../runtime/build'
import { refusedEnvironment, runStep } from './main'

// Card #483: the build image's build step, run as the locked workflow runs it (storefront LIVE-SHOP §4 steps
// 6–7). A build renders the store's whole site, so the timeouts are long.
vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 })

const run = promisify(execFile)
const sandbox = fileURLToPath(new URL('../../', import.meta.url))
const baselineDir = fileURLToPath(new URL('../../../../packages/storefront-core/src/guard/fixtures/baseline/', import.meta.url))

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

const cli = (args: string[], env: Record<string, string> = {}) => run(join(sandbox, 'node_modules/.bin/tsx'), [join(sandbox, 'src/publish/cli.ts'), ...args], { cwd: sandbox, env: { PATH: process.env['PATH'] ?? '', SANDBOX_RUNTIME: runtime, ...env }, maxBuffer: 16 * 1024 * 1024 })

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
    await expect(runStep(['deploy', '--out', join(root, 'unknown')], { PATH: '/usr/bin' })).rejects.toThrow('Name the step: build.')
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
  })

  it('stops at the typecheck too, with the validator’s check failing and naming the file, and no site', async () => {
    const source = await sourceOf('untyped', { 'src/theme/pages/SearchPage.tsx': 'export const SearchPage = () => {\n  const count: string = 1\n  return count === null ? null : null\n}\n' })
    await cli(['build', ...stepArgs(source, join(root, 'snapshot.json')), '--out', join(root, 'untyped')])
    const report = JSON.parse(readFileSync(join(root, 'untyped/report.json'), 'utf8')) as GateReport
    expect(report.checks.find((c) => c.name === 'validator')).toMatchObject({ passed: false, detail: expect.stringContaining('src/theme/pages/SearchPage.tsx:2') })
    expect(existsSync(join(root, 'untyped/site'))).toBe(false)
  })
})
