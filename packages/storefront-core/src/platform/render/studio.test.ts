import { afterEach, describe, expect, it, vi } from 'vitest'
import { createShopClient } from '../api/client'
import { connectHotReload, studioBasePath, studioPagePath, studioShopEndpoint } from './studio'

const id = 'Ab3_9-xYz0Ab3_9-xYz0Ab'
const frame = `https://k7f3q9f2xa.webpreview.store/__studio/${id}/`

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the studio frame’s base path (AI-STUDIO §3 step 6)', () => {
  it('is read from core’s own module address, and only a studio address has one', () => {
    expect(studioBasePath(`${frame}assets/core/boot.js`)).toBe(`/__studio/${id}/`)
    expect(studioBasePath('https://k7f3q9f2xa.webpreview.store/assets/core/boot.js')).toBeNull()
    expect(studioBasePath(`https://k7f3q9f2xa.webpreview.store/__studio/${id.slice(1)}/assets/core/boot.js`)).toBeNull()
    expect(studioBasePath('not a url')).toBeNull()
    expect(studioPagePath(`/__studio/${id}/`, `/__studio/${id}/our-story`)).toBe('/our-story')
    expect(studioPagePath(`/__studio/${id}/`, '/elsewhere')).toBe('/')
  })

  it('sends every Shop API call inside the frame to /__studio/{session}/shop-api, and nowhere else', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => (calls.push(url), new Response(JSON.stringify({ data: { ok: true } }))))
    const client = createShopClient({ endpoint: studioShopEndpoint(studioBasePath(`${frame}assets/core/boot.js`) ?? '') })
    await client.request('query { ok }')
    await client.request('query { again }')
    expect(calls).toEqual([`/__studio/${id}/shop-api`, `/__studio/${id}/shop-api`])
  })
})

const fakeSocket = () => {
  let target = new EventTarget()
  const opened: string[] = []
  let closed = false
  return {
    open: (url: string) => {
      opened.push(url)
      target = new EventTarget()
      return Object.assign(target, { close: () => void (closed = true) }) as unknown as WebSocket
    },
    say: (data: unknown) => target.dispatchEvent(Object.assign(new Event('message'), { data: typeof data === 'string' ? data : JSON.stringify(data) })),
    drop: () => target.dispatchEvent(new Event('close')),
    up: () => target.dispatchEvent(new Event('open')),
    opened,
    closed: () => closed,
  }
}

describe('the hot-swap entry point (AI-STUDIO §4 step 5)', () => {
  it('opens the frame’s own WebSocket and applies each new bundle, keeping the scroll', async () => {
    const socket = fakeSocket()
    const applied: string[] = []
    let at: [number, number] = [0, 640]
    const stop = connectHotReload({
      base: `/__studio/${id}/`,
      origin: 'https://k7f3q9f2xa.webpreview.store',
      load: async (url) => url,
      apply: (url) => {
        applied.push(url)
        at = [0, 0]
      },
      open: socket.open,
      scroll: { read: () => at, restore: (x, y) => void (at = [x, y]) },
    })
    expect(socket.opened).toEqual([`wss://k7f3q9f2xa.webpreview.store/__studio/${id}/__hot`])
    socket.say({ type: 'bundle', id: 'aaaa', entry: 'assets/entry-ONE.js' })
    await vi.waitFor(() => expect(applied).toEqual([`${frame}assets/entry-ONE.js`]))
    expect(at).toEqual([0, 640])
    stop()
    expect(socket.closed()).toBe(true)
  })

  it('applies only the newest bundle when loads finish out of order, and ignores anything that is not a bundle notice', async () => {
    const socket = fakeSocket()
    const applied: string[] = []
    const pending = new Map<string, (v: string) => void>()
    connectHotReload({
      base: `/__studio/${id}/`,
      origin: 'https://k7f3q9f2xa.webpreview.store',
      load: (url) => new Promise<string>((resolve) => pending.set(url, resolve)),
      apply: (url) => void applied.push(url),
      open: socket.open,
    })
    socket.say('not json')
    socket.say({ type: 'bundle', id: 'x', entry: '../escape.js' })
    socket.say({ type: 'bundle', id: 'y', entry: 'https://elsewhere.example/a.js' })
    socket.say({ type: 'bundle', id: 'one', entry: 'assets/entry-ONE.js' })
    socket.say({ type: 'bundle', id: 'two', entry: 'assets/entry-TWO.js' })
    expect([...pending.keys()]).toEqual([`${frame}assets/entry-ONE.js`, `${frame}assets/entry-TWO.js`])
    pending.get(`${frame}assets/entry-TWO.js`)?.(`${frame}assets/entry-TWO.js`)
    pending.get(`${frame}assets/entry-ONE.js`)?.(`${frame}assets/entry-ONE.js`)
    await vi.waitFor(() => expect(applied).toEqual([`${frame}assets/entry-TWO.js`]))
    await new Promise((r) => setTimeout(r, 10))
    expect(applied).toEqual([`${frame}assets/entry-TWO.js`])
  })

  it('loads a bundle again when its load failed, rather than keeping the old theme for good', async () => {
    const socket = fakeSocket()
    const applied: string[] = []
    let fail = true
    connectHotReload({
      base: `/__studio/${id}/`,
      origin: 'https://k7f3q9f2xa.webpreview.store',
      load: async (url) => {
        if (fail) throw new Error('network')
        return url
      },
      apply: (url) => void applied.push(url),
      open: socket.open,
    })
    socket.say({ type: 'bundle', id: 'one', entry: 'assets/entry-ONE.js' })
    await new Promise((r) => setTimeout(r, 10))
    expect(applied).toEqual([])
    fail = false
    socket.say({ type: 'bundle', id: 'one', entry: 'assets/entry-ONE.js' })
    await vi.waitFor(() => expect(applied).toEqual([`${frame}assets/entry-ONE.js`]))
  })

  it('opens a dropped socket again, waiting longer each time until one opens, and never after it was stopped', () => {
    const socket = fakeSocket()
    const waits: number[] = []
    const queued: (() => void)[] = []
    const stop = connectHotReload({
      base: `/__studio/${id}/`,
      origin: 'https://k7f3q9f2xa.webpreview.store',
      load: async (url) => url,
      apply: () => undefined,
      open: socket.open,
      wait: (ms, run) => void (waits.push(ms), queued.push(run)),
    })
    socket.drop()
    queued.shift()?.()
    socket.drop()
    queued.shift()?.()
    socket.up()
    socket.drop()
    expect(waits).toEqual([1_000, 2_000, 1_000])
    expect(socket.opened).toHaveLength(3)
    queued.shift()?.()
    stop()
    socket.drop()
    expect(queued).toEqual([])
    expect(socket.opened).toHaveLength(4)
  })
})
