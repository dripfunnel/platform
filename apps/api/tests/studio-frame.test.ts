import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { TenantContext } from '#core/tenancy'
import { handleStudioFrame, type StudioFrameStub } from '#apis/studio/frame'
import { closeEndedSockets, hashStudioSession, studioStoreHeader, liveStudioSession, liveStudioSessionHash, openStudioSession, serveFrame } from '#saas/studio/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// INF 3 (#482), part 3: the studio frame on a store's preview origin (storefront AI-STUDIO §3 step 6, §8), with the real
// database and the session check the store's Durable Object makes; the object itself is a stand-in that records calls.

let db: TestDatabase
let t: Tenants
const domain = 'webpreview.test'
const keys: Record<string, string> = {}
let session = ''

const owner = { side: 'merchant', role: 'owner' } as const

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  for (const [name, id] of [['A1', t.storeA1], ['B1', t.storeB1]] as const) {
    keys[name] = (await db.sql<{ preview_key: string }[]>`select preview_key from storefront where store_id = ${id}`)[0]?.preview_key ?? ''
  }
  const [user] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, 'frame.a1@studio.example', 'Frame', 'active') returning id`
  const userId = user?.id ?? ''
  const hash = 'f'.repeat(64)
  await db.sql`insert into user_session (id_hash, user_id, partner_id, absolute_expires_at) values (${hash}, ${userId}, ${t.partnerA}, now() + interval '1 day')`
  const context: TenantContext = { caller: { kind: 'person', userId, sessionId: hash }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' }, subscription: 'active' }
  session = (await openStudioSession(db.sql, context, owner, new Date()))?.id ?? ''
})

afterAll(async () => {
  await db.drop()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const page = '<!doctype html><link rel="stylesheet" href="/assets/entry-X.css"><script type="module" src="/assets/entry-X.js"></script>'

/** The API's handler with each store's Durable Object stood in by serveFrame over the real session check. */
const harness = (loaded = true) => {
  const seen: { kind: 'check' | 'file' | 'shop' | 'open' | 'socket'; storeId: string | null; path: string }[] = []
  const studioFor = (storeId: string): StudioFrameStub => ({
    check: async (forStore, id) => (seen.push({ kind: 'check', storeId: forStore, path: '' }), (await liveStudioSession(db.sql, forStore, id, new Date())) !== null),
    fetch: (request) =>
      serveFrame(request, {
        storeId,
        live: (forStore, id) => liveStudioSession(db.sql, forStore, id, new Date()),
        loaded: () => loaded,
        open: () => void seen.push({ kind: 'open', storeId, path: '' }),
        origins: async (origin) => ({ media: origin, portal: 'https://store.partner-a.example' }),
        socket: async () => (seen.push({ kind: 'socket', storeId, path: '' }), new Response('socket')),
        file: async (path) => {
          seen.push({ kind: 'file', storeId, path })
          if (path === 'index.html') return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'" } })
          return path.startsWith('assets/') ? new Response('export {}', { headers: { 'content-type': 'text/javascript' } }) : new Response(null, { status: 404 })
        },
      }),
  })
  const shop = async (request: Request) => (seen.push({ kind: 'shop', storeId: null, path: new URL(request.url).pathname }), new Response('{}'))
  const frame = (host: string, path: string, headers: Record<string, string> = {}) => handleStudioFrame(new Request(`https://${host}${path}`, { headers }), { sql: db.sql, previewDomain: domain, studioFor, shop })
  return { seen, frame }
}

describe('the studio frame', () => {
  it('serves the container’s page under the session’s path, with the frame’s headers, and a page’s path as the SPA', async () => {
    const { seen, frame } = harness()
    const response = await frame(`${keys['A1']}.${domain}`, `/__studio/${session}/our-story`)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain(`src="/__studio/${session}/assets/entry-X.js"`)
    expect(html).toContain(`href="/__studio/${session}/assets/entry-X.css"`)
    expect(html).not.toContain('="/assets/')
    expect(Object.fromEntries(['cache-control', 'referrer-policy', 'x-robots-tag', 'content-security-policy'].map((h) => [h, response.headers.get(h)]))).toEqual({
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow',
      'content-security-policy': "default-src 'none'",
    })
    expect(seen.map((s) => [s.kind, s.storeId, s.path])).toEqual([
      ['file', t.storeA1, 'our-story'],
      ['file', t.storeA1, 'index.html'],
    ])
    const chunk = await frame(`${keys['A1']}.${domain}`, `/__studio/${session}/assets/entry-X.js`)
    expect(chunk.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
  })

  it('opens the hot-reload WebSocket for a live session only', async () => {
    const { seen, frame } = harness()
    expect(await (await frame(`${keys['A1']}.${domain}`, `/__studio/${session}/__hot`, { upgrade: 'websocket' })).text()).toBe('socket')
    expect((await frame(`${keys['A1']}.${domain}`, `/__studio/${session}/__hot`)).status).toBe(404)
    expect(seen.filter((s) => s.kind === 'socket')).toHaveLength(1)
  })

  it('shows the opening page and starts the sandbox while it is not loaded', async () => {
    const { seen, frame } = harness(false)
    const response = await frame(`${keys['A1']}.${domain}`, `/__studio/${session}/`)
    expect([response.status, response.headers.get('retry-after')]).toEqual([503, '2'])
    expect(seen.map((s) => s.kind)).toEqual(['open'])
  })

  it('sends /__studio/{session}/shop-api to the preview host’s Shop API only after the session check, without the id', async () => {
    const { seen, frame } = harness()
    expect((await frame(`${keys['A1']}.${domain}`, `/__studio/${session}/shop-api`)).status).toBe(200)
    expect(seen.map((s) => [s.kind, s.storeId ?? null, s.path])).toEqual([
      ['check', t.storeA1, ''],
      ['shop', null, '/shop-api'],
    ])
  })

  it('refuses store A’s session on store B’s preview host, an unknown host, and a malformed id, the same way', async () => {
    const { seen, frame } = harness()
    for (const path of [`/__studio/${session}/shop-api`, `/__studio/${session}/`, `/__studio/${session}/__hot`]) expect((await frame(`${keys['B1']}.${domain}`, path, { upgrade: 'websocket' })).status).toBe(404)
    expect(seen.filter((s) => s.kind !== 'check')).toEqual([])
    for (const [host, path] of [
      [`zzzzzzzzzz.${domain}`, `/__studio/${session}/`],
      [`${keys['A1']}.${domain}`, '/__studio/short/'],
      [`${keys['A1']}.${domain}`, `/__studio/${session}x/`],
      [`${keys['A1']}.other.test`, `/__studio/${session}/`],
    ] as const) {
      const r = await frame(host, path)
      expect([host, r.status, r.headers.get('referrer-policy')]).toEqual([host, 404, 'no-referrer'])
    }
    expect(seen.filter((s) => s.kind === 'shop' || s.kind === 'file')).toEqual([])
  })

  it('never writes the session id to a log', async () => {
    const lines: string[] = []
    for (const level of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' ')))
    const { frame } = harness()
    await frame(`${keys['A1']}.${domain}`, `/__studio/${session}/shop-api`)
    await frame(`${keys['B1']}.${domain}`, `/__studio/${session}/`)
    expect(lines.filter((l) => l.includes(session))).toEqual([])
  })

  it('closes the hot-reload socket of a session that ended, and leaves a live one open (AI-STUDIO §8)', async () => {
    const [user] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, 'socket.a1@studio.example', 'Socket', 'active') returning id`
    const hash = 'e'.repeat(64)
    await db.sql`insert into user_session (id_hash, user_id, partner_id, absolute_expires_at) values (${hash}, ${user?.id ?? ''}, ${t.partnerA}, now() + interval '1 day')`
    const context: TenantContext = { caller: { kind: 'person', userId: user?.id ?? '', sessionId: hash }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' }, subscription: 'active' }
    const ending = (await openStudioSession(db.sql, context, owner, new Date()))?.id ?? ''
    const closed: string[] = []
    const sockets = [
      { tag: await hashStudioSession(session), close: () => void closed.push('live') },
      { tag: await hashStudioSession(ending), close: () => void closed.push('ending') },
      { tag: undefined, close: () => void closed.push('untagged') },
    ]
    const live = async (idHash: string) => (await liveStudioSessionHash(db.sql, t.storeA1, idHash, new Date())) !== null
    expect(await closeEndedSockets(sockets, live)).toBe(1)
    expect(closed).toEqual(['untagged'])
    // Signing out ends the session at once; the next sweep closes its socket and only its socket.
    await db.sql`delete from user_session where id_hash = ${hash}`
    closed.length = 0
    expect(await closeEndedSockets(sockets, live)).toBe(2)
    expect(closed).toEqual(['ending', 'untagged'])
  })

  it('refuses, before any check or read, a frame request naming a store other than the object’s own', async () => {
    const asked: string[] = []
    const server = {
      storeId: t.storeA1,
      live: async () => (asked.push('live'), true),
      loaded: () => true,
      open: () => undefined,
      origins: async () => ({ media: 'https://a.example', portal: 'https://p.example' }),
      file: async () => (asked.push('file'), new Response('x')),
      socket: async () => (asked.push('socket'), new Response('x')),
    }
    for (const header of [t.storeB1, '']) {
      const r = await serveFrame(new Request(`https://${keys['A1']}.${domain}/__studio/${session}/`, { headers: header ? { [studioStoreHeader]: header } : {} }), server)
      expect(r.status).toBe(404)
    }
    expect(asked).toEqual([])
  })
})
