import { describe, expect, it } from 'vitest'
import { closeEndedSockets } from './frame'
import { firstOnly, isLiveSocket, liveHub, liveKeepMs, liveMaxText, liveSender, liveTags, liveUpgrade, liveUpgradeOf, type LiveEvent, type LiveMessage, type LiveStorage } from './live'

const memory = (): LiveStorage & { writes: number } => {
  const values = new Map<string, unknown>()
  const store = {
    writes: 0,
    get: async <T>(key: string) => structuredClone(values.get(key)) as T | undefined,
    put: async <T>(key: string, value: T) => {
      store.writes += 1
      values.set(key, structuredClone(value))
    },
  }
  return store
}

const socket = () => {
  const got: LiveMessage[] = []
  return { got, send: (text: string) => void got.push(JSON.parse(text) as LiveMessage) }
}

const world = () => {
  let clock = 1_000_000
  const storage = memory()
  const open: ReturnType<typeof socket>[] = []
  const hub = liveHub(storage, () => open, () => clock)
  const connect = async (after = 0) => {
    const s = socket()
    await hub.connect(() => (open.push(s), s), after)
    return s
  }
  return { hub, storage, open, connect, tick: (ms: number) => (clock += ms), reload: () => liveHub(storage, () => open, () => clock) }
}

const steps: LiveEvent[] = [
  { type: 'step', step: 'reading' },
  { type: 'step', step: 'asking' },
  { type: 'step', step: 'checking' },
  { type: 'step', step: 'repairing', attempt: 1, of: 3 },
  { type: 'step', step: 'checking' },
  { type: 'step', step: 'saving' },
]

describe('the live feed (#1237)', () => {
  it('gives every open studio of the store the same events, numbered in order', async () => {
    const w = world()
    const [a, b] = [await w.connect(), await w.connect()]
    for (const e of steps) await w.hub.publish('run-1', e)
    await w.hub.publish('run-1', { type: 'done', outcome: 'changed', messageId: 'm1' })
    expect(a.got).toEqual(b.got)
    expect(a.got.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(a.got.map((m) => (m.type === 'step' ? m.step : m.type))).toEqual(['reading', 'asking', 'checking', 'repairing', 'checking', 'saving', 'done'])
    expect(a.got[3]).toMatchObject({ attempt: 1, of: 3, run: 'run-1' })
  })

  it('replays exactly the events after the last one a reconnecting socket saw, even after the object restarted', async () => {
    const w = world()
    const first = await w.connect()
    for (const e of steps.slice(0, 3)) await w.hub.publish('run-1', e)
    w.open.length = 0
    for (const e of steps.slice(3)) await w.hub.publish('run-1', e)
    const fresh = w.reload()
    const again = socket()
    await fresh.connect(() => again, first.got.at(-1)?.seq ?? 0)
    expect(again.got.map((m) => m.seq)).toEqual([4, 5, 6])
    expect([...first.got, ...again.got].map((m) => m.seq)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('keeps a change’s events for a minute after it ends, then replays nothing of it', async () => {
    const w = world()
    await w.hub.publish('run-1', { type: 'step', step: 'asking' })
    await w.hub.publish('run-1', { type: 'done', outcome: 'unchanged', messageId: 'm1' })
    w.tick(liveKeepMs - 1)
    expect((await w.connect()).got).toHaveLength(2)
    w.tick(2)
    expect((await w.connect()).got).toEqual([])
  })

  it('drops a late event of a run that already ended, and keeps numbering across runs', async () => {
    const w = world()
    const s = await w.connect()
    await w.hub.publish('run-1', { type: 'error', code: 'STUDIO_QUEUED' })
    expect(await w.hub.publish('run-1', { type: 'text', text: 'late' })).toBeNull()
    await w.hub.publish('run-2', { type: 'step', step: 'reading' })
    expect(s.got.map((m) => [m.run, m.seq])).toEqual([
      ['run-1', 1],
      ['run-2', 2],
    ])
  })

  it('sends an event that arrives while a socket connects once, after its replay', async () => {
    const w = world()
    await w.hub.publish('run-1', { type: 'step', step: 'reading' })
    const late = socket()
    const connecting = w.hub.connect(() => (w.open.push(late), late), 0)
    const publishing = w.hub.publish('run-1', { type: 'step', step: 'asking' })
    await Promise.all([connecting, publishing])
    expect(late.got.map((m) => m.seq)).toEqual([1, 2])
  })
})

describe('the Worker’s side of a run', () => {
  it('delivers in order, joins words waiting behind a call in flight, and stops a chat’s words at the stored length', async () => {
    const sent: LiveEvent[] = []
    let release: () => void = () => undefined
    const first = new Promise<void>((resolve) => (release = resolve))
    const sender = liveSender(async (e) => {
      sent.push(e)
      if (sent.length === 1) await first
    }, () => undefined)
    sender.step('asking')
    sender.text('Linen ')
    sender.text('looks ')
    sender.text('best')
    release()
    sender.text('x'.repeat(liveMaxText))
    await sender.end({ type: 'done', outcome: 'unchanged', messageId: 'm1' })
    expect(sent[0]).toEqual({ type: 'step', step: 'asking' })
    const words = sent.flatMap((e) => (e.type === 'text' ? [e.text] : [])).join('')
    expect(words.startsWith('Linen looks best')).toBe(true)
    expect(words).toHaveLength(liveMaxText)
    expect(sent.at(-1)).toEqual({ type: 'done', outcome: 'unchanged', messageId: 'm1' })
    expect(sent.length).toBeLessThan(5)
  })

  it('sends nothing for a request refused before its first step, and never fails on a lost event', async () => {
    const sent: LiveEvent[] = []
    await liveSender(async (e) => void sent.push(e), () => undefined).end({ type: 'error', code: 'INVALID_INPUT' })
    expect(sent).toEqual([])
    const lost: unknown[] = []
    const failing = liveSender(async () => Promise.reject(new Error('gone')), (e) => void lost.push(e))
    failing.step('reading')
    await expect(failing.end({ type: 'error', code: 'FAILED' })).resolves.toBeUndefined()
    expect(lost).toHaveLength(2)
  })
})

describe('the upgrade the Store API hands the object', () => {
  it('carries the store, the session’s hash and the last event seen, and nothing else is one', () => {
    expect(liveUpgradeOf(liveUpgrade('store-1', { sessionHash: 'abc', after: 7 }))).toEqual({ storeId: 'store-1', sessionHash: 'abc', after: 7 })
    expect(liveUpgradeOf(new Request('https://x/__studio/abcdefghijklmnopqrstuv/__live', { headers: { upgrade: 'websocket' } }))).toBeNull()
    expect(liveUpgradeOf(new Request('https://x/__live?after=-1', { headers: { upgrade: 'websocket', 'x-df-studio-store': 's', 'x-df-studio-live': 'h' } }))).toBeNull()
  })
})

describe('a live socket’s tags', () => {
  it('lead with its studio session’s hash, so the sweep closes it once that session ends, and keep the frame’s reload off it', async () => {
    const closed: string[] = []
    const sockets = [
      { tag: liveTags('ended')[0], close: () => void closed.push('live ended') },
      { tag: liveTags('open')[0], close: () => void closed.push('live open') },
      { tag: 'open', close: () => void closed.push('frame open') },
    ]
    expect(await closeEndedSockets(sockets, async (hash) => hash === 'open')).toBe(1)
    expect(closed).toEqual(['live ended'])
    expect(isLiveSocket(liveTags('open'))).toBe(true)
    expect(isLiveSocket(['open'])).toBe(false)
  })
})

describe('a run’s one "making your changes" step', () => {
  it('is sent the first time only, however many repairs ask for it', () => {
    const sent: string[] = []
    const editing = firstOnly(() => void sent.push('editing'))
    editing()
    editing()
    editing()
    expect(sent).toEqual(['editing'])
  })
})
