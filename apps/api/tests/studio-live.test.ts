import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { TenantContext } from '#core/tenancy'
import { studioSessionClass } from '#jobs/durable/studio'
import { hashStudioSession, liveUpgrade, openStudioSession, studioIdleMs, studioStoreHeader, type LiveMessage } from '#saas/studio/index'
import type { ClientBundle } from '#integrations/sandbox/index'
import type { StudioEnv } from '#jobs/durable/studio'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// #1237: the store's StudioSession itself with its live sockets, on the real database for the studio sessions; the
// Durable Object's state (storage, sockets, alarm) is a stand-in, as the Workers runtime isn't here.

class FakeSocket {
  sent: string[] = []
  closed: number | null = null
  constructor(private readonly onClose: (s: FakeSocket) => void) {}
  send(message: string) {
    if (this.closed !== null) throw new Error('closed')
    this.sent.push(message)
  }
  close(code: number) {
    this.closed = code
    this.onClose(this)
  }
  get events(): LiveMessage[] {
    return this.sent.map((m) => JSON.parse(m) as LiveMessage).filter((m) => 'seq' in m)
  }
}

/** A Durable Object's state: storage that survives a new instance, hibernatable sockets with their tags, one alarm. */
const objectState = () => {
  const values = new Map<string, unknown>()
  let alarm: number | null = null
  const open: { socket: FakeSocket; tags: string[] }[] = []
  const drop = (s: FakeSocket) => open.splice(open.findIndex((o) => o.socket === s), 1)
  const ctx = {
    storage: {
      get: async (key: string) => structuredClone(values.get(key)),
      put: async (key: string, value: unknown) => void values.set(key, structuredClone(value)),
      delete: async (key: string) => values.delete(key),
      list: async () => new Map(),
      getAlarm: async () => alarm,
      setAlarm: async (at: number) => void (alarm = at),
    },
    getWebSockets: (tag?: string) => open.filter((o) => tag === undefined || o.tags.includes(tag)).map((o) => o.socket),
    getTags: (socket: FakeSocket) => open.find((o) => o.socket === socket)?.tags ?? [],
    acceptWebSocket: (socket: FakeSocket, tags: string[]) => void open.push({ socket, tags }),
    waitUntil: (work: Promise<unknown>) => void work.catch(() => undefined),
    container: undefined,
  }
  return { ctx, open, drop, alarm: () => alarm, clearAlarm: () => (alarm = null), socket: () => new FakeSocket(drop) }
}

let db: TestDatabase
let t: Tenants
const clients: postgres.Sql[] = []
const env = (): StudioEnv => ({
  ADMIN_HOST: 'admin.example',
  PLATFORM_HOST: 'platform.example',
  HOOKS_HOST: 'hooks.example',
  HYPERDRIVE: { connectionString: db.url },
  // Never reached: these tests make no change, so no bucket or lease is touched.
  STOREFRONT_SITES: {} as R2Bucket,
  STOREFRONT_DRAFTS: {} as R2Bucket,
  STUDIO_CAPACITY: { idFromName: () => 'account', get: () => ({ acquire: async () => ({ granted: true }), release: async () => undefined }) } as unknown as StudioEnv['STUDIO_CAPACITY'],
})
type State = ReturnType<typeof objectState>
type Session = InstanceType<ReturnType<typeof studioSessionClass>>
const objectOn = (state: State): Session => {
  const StudioSession = studioSessionClass((h) => {
    const sql = postgres(h.connectionString, { max: 1 })
    clients.push(sql)
    return sql
  })
  return new StudioSession(state.ctx as unknown as DurableObjectState, env())
}
/** The private parts the runtime drives: the runner, the last activity and the frame's hot reload. */
const inside = (o: Session) => o as unknown as { runner: unknown; lastActive: number; announce: (b: ClientBundle) => void }

let owner: { userId: string; context: TenantContext }
const studioSession = async () => {
  const opened = await openStudioSession(db.sql, owner.context, { side: 'merchant', role: 'owner' }, new Date())
  if (!opened) throw new Error('no studio session')
  return { id: opened.id, hash: await hashStudioSession(opened.id) }
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  const [user] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, 'live.owner@studio.example', 'Live', 'active') returning id`
  const userId = user?.id ?? ''
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${userId}, ${t.storeA1}, 'owner', 'active')`
  const sessionHash = 'a'.repeat(64)
  await db.sql`insert into user_session (id_hash, user_id, partner_id, absolute_expires_at) values (${sessionHash}, ${userId}, ${t.partnerA}, now() + interval '1 day')`
  owner = { userId, context: { caller: { kind: 'person', userId, sessionId: sessionHash }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' }, subscription: 'active' } }
  // The runtime's socket pair and its 101, which Node's Response refuses.
  vi.stubGlobal(
    'WebSocketPair',
    class {
      0 = { client: true }
      1: FakeSocket
      constructor() {
        this[1] = current.socket()
      }
    },
  )
  const RealResponse = Response
  vi.stubGlobal(
    'Response',
    class extends RealResponse {
      readonly upgraded: boolean
      constructor(body: BodyInit | null, init: ResponseInit & { webSocket?: unknown } = {}) {
        super(body, init.status === 101 ? { ...init, status: 200 } : init)
        this.upgraded = init.status === 101
      }
    },
  )
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await Promise.all(clients.map((c) => c.end({ timeout: 1 })))
  await db.drop()
})

let current: State

describe('the StudioSession’s live sockets (#1237)', () => {
  it('accepts an upgrade as a hibernating socket tagged with its session, and nothing else is one', async () => {
    current = objectState()
    const object = objectOn(current)
    const { hash } = await studioSession()
    const answer = (await object.fetch(liveUpgrade(t.storeA1, { sessionHash: hash, after: 0 }))) as Response & { upgraded: boolean }
    expect(answer.upgraded).toBe(true)
    expect(current.open.map((o) => o.tags)).toEqual([[hash, 'live']])
    expect(current.alarm()).not.toBeNull()
    // The same path without the upgrade, or another store's, is the frame's closed page; nothing new is accepted.
    expect((await object.fetch(new Request('https://studio.internal/__live?after=0', { headers: { [studioStoreHeader]: t.storeA1, 'x-df-studio-live': hash } }))).status).toBe(404)
    expect((await object.fetch(liveUpgrade(t.storeB1, { sessionHash: hash, after: 0 }))).status).toBe(404)
    expect(current.open).toHaveLength(1)
  })

  it('sends events to live sockets only, and the frame’s hot reload to frame sockets only', async () => {
    current = objectState()
    const object = objectOn(current)
    const { hash } = await studioSession()
    await object.fetch(liveUpgrade(t.storeA1, { sessionHash: hash, after: 0 }))
    const frame = current.socket()
    current.ctx.acceptWebSocket(frame, [hash])
    const live = current.open[0]?.socket
    await object.progress(t.storeA1, 'run-1', { type: 'step', step: 'reading' })
    inside(object).announce({ id: 'b1', entry: 'assets/b1.js' } as ClientBundle)
    expect(live?.events.map((e) => e.seq)).toEqual([1])
    expect(live?.sent.some((m) => m.includes('"bundle"'))).toBe(false)
    expect(frame.sent).toEqual([JSON.stringify({ type: 'bundle', id: 'b1', entry: 'assets/b1.js' })])
  })

  it('replays exactly the missed events to a reconnect after the object was evicted and started again', async () => {
    current = objectState()
    const first = objectOn(current)
    const { hash } = await studioSession()
    for (const step of ['reading', 'asking', 'checking'] as const) await first.progress(t.storeA1, 'run-1', { type: 'step', step })
    const again = objectOn(current)
    await again.fetch(liveUpgrade(t.storeA1, { sessionHash: hash, after: 1 }))
    expect(current.open[0]?.socket.events.map((e) => e.seq)).toEqual([2, 3])
  })

  it('keeps sweeping after an idle stop while a socket is open, and closes a live socket within a tick of its session ending', async () => {
    current = objectState()
    const object = objectOn(current)
    const kept = await studioSession()
    const ending = await studioSession()
    await object.fetch(liveUpgrade(t.storeA1, { sessionHash: kept.hash, after: 0 }))
    await object.fetch(liveUpgrade(t.storeA1, { sessionHash: ending.hash, after: 0 }))
    await db.sql`delete from studio_session where id_hash = ${ending.hash}`
    // A loaded studio idle past its limit: the alarm stops it, which used to end the ticking.
    let stopped = false
    inside(object).runner = { loaded: true, pending: 0, stop: async () => void (stopped = true) }
    inside(object).lastActive = Date.now() - studioIdleMs - 1
    current.clearAlarm()
    await object.alarm()
    expect(stopped).toBe(true)
    expect(current.open.map((o) => o.tags[0])).toEqual([kept.hash])
    expect(current.alarm()).not.toBeNull()
    // The kept one's person signs out: the next tick closes it, and with no socket left nothing ticks.
    await db.sql`delete from user_session where user_id = ${owner.userId}`
    current.clearAlarm()
    await object.alarm()
    expect(current.open).toEqual([])
    expect(current.alarm()).toBeNull()
  })
})
