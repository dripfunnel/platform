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
  const server = sandboxServer({ slots: 6, workRoot: join(root, 'work'), runtimeDir: join(root, 'runtime'), notes })
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
const exportBundle = async (slot: string) => (await fetch(`${base}/slots/${slot}/bundle`)).arrayBuffer()
const loadBundle = async (slot: string, bytes: ArrayBuffer) => (await fetch(`${base}/slots/${slot}/draft`, { method: 'PUT', headers: { 'content-type': 'application/x-git-bundle' }, body: bytes })).json() as Promise<Json>
const theme = async (slot: string) => new Map(((await call('GET', `/slots/${slot}/theme`)).body['files'] as { path: string; content: string }[]).map((f) => [f.path, f.content]))
const head = async (slot: string) => (await call('GET', `/slots/${slot}/theme`)).body['head'] as string
const repoFile = (slot: string, path: string) => readFile(join(root, 'work', slot, 'repo', path), 'utf8')
const pages = () => template.find((f) => f.path === 'content/en/pages.json')?.content ?? ''

let live: ArrayBuffer
let upgraded: { commit: string; bundle: ArrayBuffer }

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
    expect((await call('POST', '/slots/live/upgrade', { from: '1.1.0', to: '1.0.9', message: 'm', baseline: null })).status).toBe(400)
    expect((await call('POST', '/slots/live/upgrade', { from: '1.1.0', to: '1.1.0', message: 'm', baseline: null })).status).toBe(400)
  })

  it('leaves the working copy as it was when package.json can’t be read, so nothing rides along with the next commit', async () => {
    await call('PUT', '/slots/broken/draft', { files: [...template.filter((f) => f.path !== 'package.json'), { path: 'package.json', content: '{ not json' }], message: 'A broken package.json' })
    const before = await head('broken')
    expect((await call('POST', '/slots/broken/upgrade', { from: '1.0.0', to: '1.1.0', message: 'Upgrade', baseline: null })).status).toBe(500)
    expect(await head('broken')).toBe(before)
    expect((await theme('broken')).get('src/theme/pages/HomePage.tsx')).toContain("label={t('pages.home.more')}")
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

  it('names a missing or unrelated commit for what it is, never a conflict', async () => {
    await loadBundle('broken', live)
    const before = await head('broken')
    await fetch(`${base}/slots/broken/onto`, { method: 'PUT', body: upgraded.bundle })
    const missing = await call('POST', '/slots/broken/rebase', { onto: 'f'.repeat(40), context })
    expect((missing.body['problems'] as { rule: string }[])[0]?.rule).toBe('rebase/missing-onto')
    // No bundle sent first is the same fault.
    expect(((await call('POST', '/slots/broken/rebase', { onto: upgraded.commit, context })).body['problems'] as { rule: string }[])[0]?.rule).toBe('rebase/missing-onto')
    await call('PUT', '/slots/unrelated/draft', { files: template.map((f) => (f.path === 'routes.json' ? { path: f.path, content: `${f.content}\n` } : f)), message: 'Another start' })
    await fetch(`${base}/slots/broken/onto`, { method: 'PUT', body: await exportBundle('unrelated') })
    const unrelated = await call('POST', '/slots/broken/rebase', { onto: await head('unrelated'), context })
    expect((unrelated.body['problems'] as { rule: string }[])[0]?.rule).toBe('rebase/unrelated')
    expect(await head('broken')).toBe(before)
  })

  it('stays exactly as it was when the gate itself fails after the rebase', async () => {
    await loadBundle('broken', live)
    const before = await head('broken')
    await fetch(`${base}/slots/broken/onto`, { method: 'PUT', body: upgraded.bundle })
    expect((await call('POST', '/slots/broken/rebase', { onto: upgraded.commit, context: { locales: 'every' } })).status).toBe(400)
    expect(await head('broken')).toBe(before)
    expect((await theme('broken')).get('src/theme/pages/HomePage.tsx')).toContain("label={t('pages.home.more')}")
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

describe('a draft started before a push went live (#1211)', () => {
  const title = (words: string) => ({ path: 'content/en/pages.json', content: pages().replace('Made slowly, worn for years', words) })
  const homeLabel = () => ({ path: 'src/theme/pages/HomePage.tsx', content: (template.find((f) => f.path === 'src/theme/pages/HomePage.tsx')?.content ?? '').replace("label={t('pages.home.more')}", "label={t('pages.home.title')}") })
  /** A draft with one change on the live code, and a push made on the live code too: the live commit, and the push's. */
  const draftAndPush = async (draftFiles: unknown[], pushFiles: unknown[]) => {
    await loadBundle('draft', live)
    const from = await head('draft')
    expect((await call('POST', '/slots/draft/changes', { files: draftFiles, message: 'A draft change', context })).body['ok']).toBe(true)
    await loadBundle('fallback', live)
    expect((await call('POST', '/slots/fallback/changes', { files: pushFiles, message: 'A push to main', context })).body['ok']).toBe(true)
    return { from, pushed: { commit: await head('fallback'), bundle: await exportBundle('fallback') } }
  }
  const take = async (from: string, onto: { commit: string; bundle: ArrayBuffer }) => {
    await fetch(`${base}/slots/draft/onto`, { method: 'PUT', body: onto.bundle })
    return call('POST', '/slots/draft/take', { from, onto: onto.commit, context })
  }

  it('takes the files the push changed into the draft, keeping the draft’s own change', async () => {
    const { from, pushed } = await draftAndPush([title('Linen for slow days')], [homeLabel()])
    const taken = await take(from, pushed)
    expect(taken.body).toMatchObject({ ok: true, changed: true })
    const after = await theme('draft')
    expect(after.get('content/en/pages.json')).toContain('Linen for slow days')
    expect(after.get('src/theme/pages/HomePage.tsx')).toContain("label={t('pages.home.title')}")
    // Based on the commit it took, a later edit to a pushed file stays.
    const later = { path: 'src/theme/pages/HomePage.tsx', content: homeLabel().content.replace("label={t('pages.home.title')}", "label={t('pages.home.lead')}") }
    expect((await call('POST', '/slots/draft/changes', { files: [later], message: 'A later edit', context })).body['ok']).toBe(true)
    expect((await take(pushed.commit, pushed)).body).toMatchObject({ ok: true, changed: false })
    expect((await theme('draft')).get('src/theme/pages/HomePage.tsx')).toContain("label={t('pages.home.lead')}")
  })

  it('keeps the pushed version of a file both changed', async () => {
    const { from, pushed } = await draftAndPush([title('The draft words')], [title('The pushed words')])
    expect((await take(from, pushed)).body).toMatchObject({ ok: true, changed: true })
    const pagesNow = (await theme('draft')).get('content/en/pages.json') ?? ''
    expect(pagesNow).toContain('The pushed words')
    expect(pagesNow).not.toContain('The draft words')
  })

  it('deletes from the draft a file the push deleted', async () => {
    const extra = { path: 'src/theme/styles/extra.module.css', content: '.extra {\n  color: inherit;\n}\n' }
    await call('PUT', '/slots/fallback/draft', { files: [...template, extra], message: 'Live code with one more file' })
    const from = await head('fallback')
    await loadBundle('draft', await exportBundle('fallback'))
    expect((await call('POST', '/slots/draft/changes', { files: [title('Words beside the extra file')], message: 'A draft change', context })).body['ok']).toBe(true)
    expect((await call('POST', '/slots/fallback/changes', { files: [{ path: extra.path, content: null }], message: 'A push that deletes it', context })).body['ok']).toBe(true)
    expect((await take(from, { commit: await head('fallback'), bundle: await exportBundle('fallback') })).body).toMatchObject({ ok: true, changed: true })
    const after = await theme('draft')
    expect(after.has(extra.path)).toBe(false)
    expect(after.get('content/en/pages.json')).toContain('Words beside the extra file')
  })

  it('changes nothing when the live commit is the draft’s base or already in the draft, or the base is unknown', async () => {
    const { from, pushed } = await draftAndPush([title('Unchanged words')], [homeLabel()])
    const before = await head('draft')
    expect((await take(from, { commit: from, bundle: live })).body).toMatchObject({ ok: true, changed: false, commit: before })
    expect((await take('e'.repeat(40), pushed)).body).toMatchObject({ ok: true, changed: false, commit: before })
    // Live is one of the draft's own commits, as after "Publish everything before": its later edits stay.
    const own = { commit: before, bundle: await exportBundle('draft') }
    expect((await call('POST', '/slots/draft/changes', { files: [title('Edited after that publish')], message: 'A later edit', context })).body['ok']).toBe(true)
    expect((await take(from, own)).body).toMatchObject({ ok: true, changed: false })
    expect((await theme('draft')).get('content/en/pages.json')).toContain('Edited after that publish')
  })

  it('names a missing live commit, and leaves the draft as it was when the gate refuses what it would take', async () => {
    const { from } = await draftAndPush([title('Kept words')], [homeLabel()])
    const before = await head('draft')
    const missing = await take(from, { commit: 'f'.repeat(40), bundle: live })
    expect((missing.body['problems'] as { rule: string }[])[0]?.rule).toBe('take/missing-onto')
    // A live commit with no history in common with the draft is still compared file by file.
    await call('PUT', '/slots/fallback/draft', { files: template.map((f) => (f.path === 'src/theme/pages/HomePage.tsx' ? { path: f.path, content: "export const HomePage = () => { fetch('/x'); return null }\n" } : f)), message: 'A push the gate refuses' })
    const refused = await take(from, { commit: await head('fallback'), bundle: await exportBundle('fallback') })
    expect(refused.body['ok']).toBe(false)
    expect(await head('draft')).toBe(before)
    expect((await theme('draft')).get('content/en/pages.json')).toContain('Kept words')
  })
})
