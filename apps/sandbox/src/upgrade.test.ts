import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { GuardContext, UpgradeNote } from '@dripfunnel/storefront-core/guard'
import { buildRuntime } from './runtime/build'
import { sandboxServer } from './server'

// The upgrade bot's commit and the draft's rebase onto it (storefront ARCHITECTURE §7.1, AI-STUDIO §6 step 2), with real
// git and the real fast gate.
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

const context: GuardContext = { locales: ['en', 'hi'], usedPaths: [], mediaIds: [], brand: { name: 'Northstar Linen', tagline: null, email: null, phone: null, address: [], socialLinks: [] } }

const notes: UpgradeNote[] = [
  { version: '1.1.0', kind: 'minor', security: false, notes: 'The disclosure label reads the story key.', codemods: [{ kind: 'replace', paths: ['src/theme/pages/*.tsx'], find: "label={t('pages.home.more')}", replace: "label={t('pages.home.title')}" }] },
  { version: '1.2.0', kind: 'minor', security: false, notes: 'Not reached.', codemods: [{ kind: 'replace', paths: ['src/theme/**/*.tsx'], find: 'Shell', replace: 'Frame' }] },
]

let root: string
let base: string
let close: () => Promise<void>
let template: { path: string; content: string }[]

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'sandbox-upgrade-'))
  await buildRuntime(join(root, 'runtime'))
  const server = sandboxServer({ slots: 4, workRoot: join(root, 'work'), runtimeDir: join(root, 'runtime'), notes })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  close = () => new Promise((resolve) => server.close(() => resolve()))
  template = [...(await walk(baselineDir)), { path: 'package.json', content: '{\n  "name": "sf-store",\n  "dependencies": { "@dripfunnel/storefront-core": "1.0.0" }\n}\n' }]
})

afterAll(async () => {
  await close()
  await rm(root, { recursive: true, force: true })
})

type Json = Record<string, unknown>
const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: res.status, body: (await res.json()) as Json }
}
const exportBundle = async (slot: string) => Buffer.from(await (await fetch(`${base}/slots/${slot}/bundle`)).arrayBuffer())
const loadBundle = async (slot: string, bytes: Buffer) => (await fetch(`${base}/slots/${slot}/draft`, { method: 'PUT', headers: { 'content-type': 'application/x-git-bundle' }, body: bytes })).json() as Promise<Json>
const theme = async (slot: string) => new Map(((await call('GET', `/slots/${slot}/theme`)).body['files'] as { path: string; content: string }[]).map((f) => [f.path, f.content]))
const head = async (slot: string) => (await call('GET', `/slots/${slot}/theme`)).body['head'] as string
const repoFile = (slot: string, path: string) => readFile(join(root, 'work', slot, 'repo', path), 'utf8')
const pages = () => template.find((f) => f.path === 'content/en/pages.json')?.content ?? ''

let live: Buffer
let upgraded: { commit: string; bundle: Buffer }

describe('the upgrade bot’s commit', () => {
  it('pins the new core and applies only the codemods of the releases it crosses, as one commit on the live one', async () => {
    await call('PUT', '/slots/live/draft', { files: template, message: 'Start from the baseline template' })
    live = await exportBundle('live')
    const before = await head('live')
    const result = await call('POST', '/slots/live/upgrade', { from: '1.0.0', to: '1.1.0', message: 'Upgrade storefront-core to 1.1.0', baseline: null })
    expect(result.status).toBe(200)
    const commit = result.body['commit'] as string
    expect(commit).not.toBe(before)
    expect(await head('live')).toBe(commit)
    const files = result.body['files'] as { path: string; content: string | null }[]
    expect(files.map((f) => f.path)).toEqual(['src/theme/pages/HomePage.tsx', 'package.json'])
    expect(files[0]?.content).toContain("label={t('pages.home.title')}")
    expect(JSON.parse(await repoFile('live', 'package.json'))).toMatchObject({ name: 'sf-store', dependencies: { '@dripfunnel/storefront-core': '1.1.0' } })
    expect(result.body['notes']).toEqual([{ version: '1.1.0', kind: 'minor', notes: 'The disclosure label reads the story key.' }])
    expect((await theme('live')).get('src/theme/components/Shell.tsx')).toContain('Shell')
    upgraded = { commit, bundle: await exportBundle('live') }
  })

  it('refuses a request outside its shape, and a baseline file outside the theme', async () => {
    expect((await call('POST', '/slots/live/upgrade', { from: '1.0', to: '1.1.0', message: 'm', baseline: null })).status).toBe(400)
    expect((await call('POST', '/slots/live/upgrade', { from: '1.0.0', to: '1.1.0', message: 'm', baseline: [{ path: '.github/workflows/build.yml', content: 'on: push' }] })).status).toBe(400)
  })

  it('writes the baseline theme with the store’s own words over its own theme', async () => {
    await loadBundle('fallback', live)
    const baseline = template.filter((f) => f.path !== 'package.json' && f.path !== 'src/theme/pages/AboutPage.tsx').map((f) => (f.path === 'content/en/pages.json' ? { path: f.path, content: f.content.replace('Made slowly, worn for years', 'Baseline words') } : f))
    const result = await call('POST', '/slots/fallback/upgrade', { from: '1.0.0', to: '1.1.0', message: 'Serve the baseline theme on storefront-core 1.1.0', baseline })
    expect(result.status).toBe(200)
    const after = await theme('fallback')
    expect(after.has('src/theme/pages/AboutPage.tsx')).toBe(false)
    expect(after.get('content/en/pages.json')).toContain('Made slowly, worn for years')
    expect(result.body['notes']).toEqual([])
    expect((result.body['files'] as { path: string; content: string | null }[]).find((f) => f.path === 'src/theme/pages/AboutPage.tsx')).toEqual({ path: 'src/theme/pages/AboutPage.tsx', content: null })
  })
})

describe('a draft started before the upgrade', () => {
  it('keeps its own changes and moves onto the upgrade’s commit, through the fast gate', async () => {
    await loadBundle('draft', live)
    const changed = await call('POST', '/slots/draft/changes', { files: [{ path: 'content/en/pages.json', content: pages().replace('Made slowly, worn for years', 'Linen for slow days') }], message: 'A warmer title', context })
    expect(changed.body['ok']).toBe(true)
    expect((await fetch(`${base}/slots/draft/onto`, { method: 'PUT', body: upgraded.bundle })).status).toBe(200)
    const rebased = await call('POST', '/slots/draft/rebase', { onto: upgraded.commit, context })
    expect(rebased.body).toMatchObject({ ok: true, changed: true })
    const after = await theme('draft')
    expect(after.get('content/en/pages.json')).toContain('Linen for slow days')
    expect(after.get('src/theme/pages/HomePage.tsx')).toContain("label={t('pages.home.title')}")
    expect(JSON.parse(await repoFile('draft', 'package.json'))).toMatchObject({ dependencies: { '@dripfunnel/storefront-core': '1.1.0' } })
    // Rebasing again onto the same commit changes nothing.
    await fetch(`${base}/slots/draft/onto`, { method: 'PUT', body: upgraded.bundle })
    expect((await call('POST', '/slots/draft/rebase', { onto: upgraded.commit, context })).body).toMatchObject({ ok: true, changed: false, commit: rebased.body['commit'] })
  })

  it('stays exactly as it was when its changes and the upgrade’s touch the same lines', async () => {
    await loadBundle('conflict', live)
    const home = template.find((f) => f.path === 'src/theme/pages/HomePage.tsx')?.content ?? ''
    const changed = await call('POST', '/slots/conflict/changes', { files: [{ path: 'src/theme/pages/HomePage.tsx', content: home.replace("label={t('pages.home.more')}", "label={t('pages.home.lead')}") }], message: 'Another label', context })
    expect(changed.body['ok']).toBe(true)
    const before = await head('conflict')
    await fetch(`${base}/slots/conflict/onto`, { method: 'PUT', body: upgraded.bundle })
    const rebased = await call('POST', '/slots/conflict/rebase', { onto: upgraded.commit, context })
    expect(rebased.body['ok']).toBe(false)
    expect((rebased.body['problems'] as { rule: string }[])[0]?.rule).toBe('rebase/conflict')
    expect(await head('conflict')).toBe(before)
    expect((await theme('conflict')).get('src/theme/pages/HomePage.tsx')).toContain("label={t('pages.home.lead')}")
  })
})
