import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { GuardContext } from '@dripfunnel/storefront-core/guard'
import { buildRuntime } from './runtime/build'
import { sandboxServer } from './server'

// The first change builds the TypeScript program with the DOM's types, which takes several seconds on CI's runners.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

const baselineDir = decodeURIComponent(new URL('../../../packages/storefront-core/src/guard/fixtures/baseline/', import.meta.url).pathname)

const walk = async (dir: string, prefix = ''): Promise<{ path: string; content: string }[]> =>
  (
    await Promise.all(
      (await readdir(join(dir, prefix))).map(async (name) => {
        const rel = prefix ? `${prefix}/${name}` : name
        return (await stat(join(dir, rel))).isDirectory() ? walk(dir, rel) : [{ path: rel, content: await readFile(join(dir, rel), 'utf8') }]
      }),
    )
  ).flat()

const context: GuardContext = {
  locales: ['en', 'hi'],
  usedPaths: ['/faq'],
  mediaIds: ['m_hero01'],
  brand: { name: 'Northstar Linen', tagline: null, email: null, phone: null, address: [], socialLinks: [] },
}

let root: string
let base: string
let close: () => Promise<void>
let template: { path: string; content: string }[]

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'sandbox-test-'))
  await buildRuntime(join(root, 'runtime'))
  const server = sandboxServer({ slots: 2, workRoot: join(root, 'work'), runtimeDir: join(root, 'runtime') })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  close = () => new Promise((resolve) => server.close(() => resolve()))
  // A skeleton file beside the theme, as a store repo has (ARCHITECTURE §2.2): it is never part of a change.
  template = [...(await walk(baselineDir)), { path: 'package.json', content: '{ "name": "store" }\n' }]
})

afterAll(async () => {
  await close()
  await rm(root, { recursive: true, force: true })
})

type Json = Record<string, unknown> & { ok?: boolean; problems?: { step: string; rule: string; file: string | null }[] }

const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: res.status, body: (await res.json()) as Json }
}

const load = (slot: string) => call('PUT', `/slots/${slot}/draft`, { files: template, message: 'Start from the baseline template' })
const change = (slot: string, files: { path: string; content: string | null }[], message = 'Make the home page warmer') => call('POST', `/slots/${slot}/changes`, { files, message, context })
const head = async (slot: string) => (await call('GET', `/slots/${slot}/theme`)).body['head'] as string

const homeWords = (lead: string) => [
  { path: 'content/en/pages.json', content: (template.find((f) => f.path === 'content/en/pages.json')?.content ?? '').replace(/"lead": "[^"]*"/, `"lead": "${lead}"`) },
]

describe('the sandbox server', () => {
  it('loads a template as the first commit, bundles it, and serves the frame with core beside it', async () => {
    const loaded = await load('store-a')
    expect(loaded.status).toBe(200)
    expect(loaded.body['head']).toMatch(/^[0-9a-f]{40}$/)
    expect(loaded.body['problems']).toEqual([])
    const page = await fetch(`${base}/slots/store-a/client/index.html`)
    const html = await page.text()
    expect(html).toMatch(/<script type="module" src="\/assets\/entry-[A-Z0-9]+\.js"><\/script>/)
    expect(html).not.toMatch(/<script>|<base/)
    const entry = /src="\/(assets\/entry-[A-Z0-9]+\.js)"/.exec(html)?.[1] ?? ''
    const js = await (await fetch(`${base}/slots/store-a/client/${entry}`)).text()
    expect(js).toContain('./core/boot.js')
    expect(js).not.toMatch(/https?:\/\//)
    expect((await fetch(`${base}/slots/store-a/client/assets/core/react.js`)).status).toBe(200)
    expect((await fetch(`${base}/slots/store-a/client/../../repo/package.json`)).status).toBe(404)
  })

  it('gives the frame’s page core’s studio CSP for the origins it is sent, and nothing to a page asked without them', async () => {
    const framed = await fetch(`${base}/slots/store-a/client/index.html`, { headers: { 'x-df-frame-media': 'https://k7f3q9f2xa.webpreview.store', 'x-df-frame-portal': 'https://store.partner-a.example' } })
    const csp = framed.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain('frame-ancestors https://store.partner-a.example')
    expect((await fetch(`${base}/slots/store-a/client/index.html`)).headers.get('content-security-policy')).toBeNull()
  })

  it('exports the theme from the entry and boots it once, so the hot reload can load a later one', async () => {
    const html = await (await fetch(`${base}/slots/store-a/client/index.html`)).text()
    const entry = /src="\/(assets\/entry-[A-Z0-9]+\.js)"/.exec(html)?.[1] ?? ''
    const js = await (await fetch(`${base}/slots/store-a/client/${entry}`)).text()
    expect(js).toMatch(/export\s*\{[^}]*\btheme\b/)
  })

  it('makes an accepted change a local commit with a new bundle', async () => {
    const before = await head('store-a')
    const bundleBefore = await (await fetch(`${base}/slots/store-a/client/index.html`)).text()
    const result = await change('store-a', [...homeWords('Linen made slowly, for warm days.'), { path: 'content/hi/pages.json', content: (template.find((f) => f.path === 'content/hi/pages.json')?.content ?? '') }])
    expect(result.body).toMatchObject({ ok: true, changed: true })
    expect(result.body['commit']).not.toBe(before)
    expect(await head('store-a')).toBe(result.body['commit'])
    const theme = (await call('GET', '/slots/store-a/theme')).body['files'] as { path: string; content: string }[]
    expect(theme.find((f) => f.path === 'content/en/pages.json')?.content).toContain('Linen made slowly')
    expect(theme.some((f) => f.path === 'package.json')).toBe(false)
    expect(await (await fetch(`${base}/slots/store-a/client/index.html`)).text()).not.toBe(bundleBefore)
  })

  it.each([
    ['the validator', 'validator', 'code/browser-global', [{ path: 'src/theme/pages/HomePage.tsx', content: "export const HomePage = () => { fetch('/x'); return null }\n" }]],
    ['the validator, for a path outside the theme', 'validator', 'files/path-not-allowed', [{ path: '.github/workflows/build.yml', content: 'on: push\n' }]],
    ['the typecheck', 'typecheck', 'ts/2339', [{ path: 'src/theme/pages/HomePage.tsx', content: "import { useStorefront } from '@dripfunnel/storefront-core/theme'\n\nexport const HomePage = () => {\n  const { nothing } = useStorefront()\n  return <div>{nothing}</div>\n}\n" }]],
    ['the bundle', 'bundle', 'bundle/error', [{ path: 'src/theme/pages/NotFoundPage.tsx', content: "import { useStorefront } from '@dripfunnel/storefront-core/theme'\n\nexport const Missing = () => {\n  const { t } = useStorefront()\n  return <h1>{t('pages.notFound.title')}</h1>\n}\n" }]],
  ])('refuses a change %s fails, leaving the draft and its files as they were', async (_name, step, rule, files) => {
    const before = await head('store-a')
    const themeBefore = (await call('GET', '/slots/store-a/theme')).body['files']
    const result = await change('store-a', files)
    expect(result.body['ok']).toBe(false)
    expect(result.body.problems?.some((p) => p.step === step && p.rule === rule)).toBe(true)
    expect(await head('store-a')).toBe(before)
    expect((await call('GET', '/slots/store-a/theme')).body['files']).toEqual(themeBefore)
    await expect(stat(join(root, 'work', 'store-a', 'repo', '.github'))).rejects.toThrow()
  })

  it('undoes a change by putting its files back, through the same gate, as a new commit', async () => {
    const accepted = await change('store-a', homeWords('A second lead, to undo.'), 'Change the lead again')
    expect(accepted.body['ok']).toBe(true)
    const undone = await call('POST', '/slots/store-a/undo', { commit: accepted.body['commit'], message: 'Undo: Change the lead again', context })
    expect(undone.body).toMatchObject({ ok: true, changed: true })
    const theme = (await call('GET', '/slots/store-a/theme')).body['files'] as { path: string; content: string }[]
    expect(theme.find((f) => f.path === 'content/en/pages.json')?.content).toContain('Linen made slowly')
  })

  it('exports the draft as a git bundle that loads elsewhere at the same head, history included', async () => {
    const res = await fetch(`${base}/slots/store-a/bundle`)
    expect(res.headers.get('content-type')).toBe('application/x-git-bundle')
    const bytes = Buffer.from(await res.arrayBuffer())
    const loaded = await fetch(`${base}/slots/store-b/draft`, { method: 'PUT', headers: { 'content-type': 'application/x-git-bundle' }, body: bytes })
    expect(((await loaded.json()) as Json)['head']).toBe(await head('store-a'))
  })

  it('serves the preview files of the current bundle with their hashes, never core', async () => {
    const preview = (await call('GET', '/slots/store-a/preview')).body as { id: string; files: { path: string; sha256: string }[] }
    expect(preview.files.map((f) => f.path)).toContain('index.html')
    expect(preview.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256) && !f.path.startsWith('assets/core/'))).toBe(true)
  })

  it('holds no more stores than its slots, and refuses a path that climbs out of the repo', async () => {
    expect((await load('store-c')).status).toBe(409)
    expect((await call('PUT', '/slots/store-a/draft', { files: [{ path: '../escape', content: 'x' }], message: 'm' })).status).toBe(400)
    expect((await call('POST', '/slots/store-a/changes', { files: [], message: 'm', context: { locales: [] } })).status).toBe(400)
  })
})
