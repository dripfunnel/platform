import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { GuardContext } from '@dripfunnel/storefront-core/guard'
import { buildRuntime } from './runtime/build'
import { sandboxServer } from './server'

// A template's images on "Change template" (SAAS §9.2; ARCHITECTURE §3.4 "Images", #1537): the one change that writes
// src/theme/media/, replacing only the old template's images by their bytes.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 })

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

const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
// The smallest WebP the validator's structural read accepts (core test/images.ts), `width` making each one's bytes its own.
const webp = (width: number): Buffer => {
  const bits = ((width - 1) & 0x3fff) | ((3 - 1) << 14)
  const vp8l = [...Buffer.from('VP8L'), ...le32(5), 0x2f, ...le32(bits), 0]
  return Buffer.from([...Buffer.from('RIFF'), ...le32(4 + vp8l.length), ...Buffer.from('WEBP'), ...vp8l])
}
const image = (name: string, bytes: Buffer) => ({ path: `src/theme/media/${name}`, content: bytes.toString('base64') })
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

const context: GuardContext = { locales: ['en', 'hi'], usedPaths: ['/faq'], mediaIds: ['m_hero01'], brand: { name: 'Northstar Linen', tagline: null, email: null, phone: null, address: [], socialLinks: [] } }

let root: string
let base: string
let close: () => Promise<void>
let template: { path: string; content: string; encoding?: 'base64' }[]

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'sandbox-media-'))
  await buildRuntime(join(root, 'runtime'))
  const server = sandboxServer({ slots: 2, workRoot: join(root, 'work'), runtimeDir: join(root, 'runtime') })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  close = () => new Promise((resolve) => server.close(() => resolve()))
  template = [...(await walk(baselineDir)), { path: 'package.json', content: '{ "name": "store" }\n' }]
})

afterAll(async () => {
  await close()
  await rm(root, { recursive: true, force: true })
})

type Json = Record<string, unknown> & { ok?: boolean; problems?: { rule: string; file: string | null }[] }
const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: res.status, body: (await res.json()) as Json }
}
const load = (slot: string, own: { path: string; content: string }[] = []) =>
  call('PUT', `/slots/${slot}/draft`, { files: [...template, ...own.map((o) => ({ ...o, encoding: 'base64' }))], message: 'Start from the baseline template' })
const words = (lead: string) => [{ path: 'content/en/pages.json', content: (template.find((f) => f.path === 'content/en/pages.json')?.content ?? '').replace(/"lead": "[^"]*"/, `"lead": "${lead}"`) }]
const use = (slot: string, media: { path: string; content: string }[], previous: { path: string; sha256: string }[], lead = 'A new look') =>
  call('POST', `/slots/${slot}/template`, { files: words(lead), media, previous, message: 'Use the next template', context })
const mediaOn = (slot: string) => readdir(join(root, 'work', slot, 'repo', 'src/theme/media')).catch(() => [])

describe('a template’s images on Change template (#1537)', () => {
  it('writes the template’s images in one commit through the gate, and lists them for the push', async () => {
    expect((await load('store-a')).status).toBe(200)
    const hero = webp(4)
    const done = await use('store-a', [image('hero.webp', hero)], [])
    expect(done.body.problems ?? []).toEqual([])
    expect(done.body.ok).toBe(true)
    expect(await mediaOn('store-a')).toEqual(['hero.webp'])
    const listed = await call('GET', `/slots/store-a/media?at=${String(done.body['commit'])}`)
    expect(listed.body['media']).toEqual([expect.objectContaining({ path: 'src/theme/media/hero.webp', content: hero.toString('base64'), blob: expect.stringMatching(/^[0-9a-f]{40}$/) })])
  })

  it('replaces the old template’s images matched by bytes, and lists the removed one by its blob for the push', async () => {
    const hero = webp(4)
    const banner = webp(5)
    const done = await use('store-a', [image('banner.webp', banner)], [{ path: 'src/theme/media/hero.webp', sha256: sha(hero) }], 'Another look')
    expect(done.body.ok).toBe(true)
    expect(await mediaOn('store-a')).toEqual(['banner.webp'])
    const listed = await call('GET', `/slots/store-a/media?at=${String(done.body['commit'])}`)
    expect((listed.body['media'] as { path: string }[]).map((m) => m.path)).toEqual(['src/theme/media/banner.webp'])
    expect(listed.body['removed']).toEqual([{ path: 'src/theme/media/hero.webp', blob: expect.stringMatching(/^[0-9a-f]{40}$/) }])
  })

  it('undoes a template’s images back to the draft’s own earlier bytes', async () => {
    const before = (await call('GET', '/slots/store-a/theme')).body['head'] as string
    const undone = await call('POST', '/slots/store-a/undo', { commit: before, message: 'Undo', context })
    expect(undone.body.ok).toBe(true)
    expect(await mediaOn('store-a')).toEqual(['hero.webp'])
    expect(await readFile(join(root, 'work', 'store-a', 'repo', 'src/theme/media/hero.webp'))).toEqual(webp(4))
  })

  it('keeps an image the store pushed itself, and refuses a template image of the same name with other bytes', async () => {
    const mine = webp(7)
    expect((await load('store-b', [image('mine.webp', mine), image('hero.webp', webp(9))])).status).toBe(200)
    const kept = await use('store-b', [image('banner.webp', webp(5))], [{ path: 'src/theme/media/mine.webp', sha256: sha(webp(8)) }])
    expect(kept.body.ok).toBe(true)
    expect(await mediaOn('store-b')).toEqual(['banner.webp', 'hero.webp', 'mine.webp'])
    const clash = await use('store-b', [image('hero.webp', webp(4))], [], 'A clash')
    expect(clash.body.ok).toBe(false)
    expect(clash.body.problems?.map((p) => [p.rule, p.file])).toEqual([['studio/media-conflict', 'src/theme/media/hero.webp']])
    expect(await readFile(join(root, 'work', 'store-b', 'repo', 'src/theme/media/hero.webp'))).toEqual(webp(9))
  })

  it('refuses a template whose images pass the store’s caps, never trimming them, and changes nothing', async () => {
    const own = Array.from({ length: 60 }, (_, i) => image(`own-${i}.webp`, webp(10 + i)))
    expect((await load('store-b', own)).status).toBe(200)
    const many = Array.from({ length: 50 }, (_, i) => image(`t-${i}.webp`, webp(100 + i)))
    const refused = await use('store-b', many, [])
    expect(refused.body.ok).toBe(false)
    expect(refused.body.problems?.map((p) => p.rule)).toContain('files/too-many-media')
    expect(await mediaOn('store-b')).toHaveLength(60)
  })

  it('still refuses an image in an ordinary change, and a template whose code carries one', async () => {
    expect((await call('POST', '/slots/store-a/changes', { files: [image('x.webp', webp(4))], message: 'm', context })).body.problems?.map((p) => p.rule)).toEqual(['studio/media-not-allowed'])
    const sneaked = await call('POST', '/slots/store-a/template', { files: [image('x.webp', webp(4))], media: [], previous: [], message: 'm', context })
    expect(sneaked.body.problems?.map((p) => p.rule)).toEqual(['studio/media-not-allowed'])
    expect((await call('POST', '/slots/store-a/template', { files: [], media: [{ path: 'src/theme/pages/Home.tsx', content: 'eA==' }], previous: [], message: 'm', context })).status).toBe(400)
  })
})
