// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { frameMaps } from './pinFrame'

const source = 'https://hooks.dripfunnel.com/maps/pin'
const origin = 'https://hooks.dripfunnel.com'

// The frame's page is the API's to serve; here it never loads.
type Settings = { fetch: { interceptor: { beforeAsyncRequest: () => Promise<Response> } | null } }
beforeAll(() => {
  ;(window as unknown as { happyDOM: { settings: Settings } }).happyDOM.settings.fetch.interceptor = { beforeAsyncRequest: async () => new window.Response('<!doctype html><title>Map</title>', { headers: { 'content-type': 'text/html' } }) }
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

/** Opens the frame in a fresh element and gives the test the frame's voice. */
const open = (stop = new AbortController()) => {
  const element = document.createElement('div')
  document.body.append(element)
  const loading = frameMaps(source, element, 'Pin your delivery address', stop.signal)
  const frame = element.querySelector('iframe')
  if (!frame?.contentWindow) throw new Error('no frame')
  const sent = vi.spyOn(frame.contentWindow, 'postMessage')
  const say = (data: unknown, from: { origin?: string; source?: Window | null } = {}) =>
    dispatchEvent(new MessageEvent('message', { data, origin: from.origin ?? origin, source: from.source === undefined ? frame.contentWindow : from.source }))
  return { element, frame, loading, sent, say, stop }
}

describe('Pin on map’s frame', () => {
  it('frames the hooks host’s page, sandboxed and titled, and says hello to it once loaded', async () => {
    const { frame, sent, loading, stop } = open()
    expect(frame.src).toBe(source)
    expect(frame.title).toBe('Pin your delivery address')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox')
    frame.dispatchEvent(new Event('load'))
    expect(sent).toHaveBeenCalledWith({ type: 'hello' }, origin)
    stop.abort()
    await expect(loading).rejects.toThrow()
  })

  it('is ready when the frame says so, and draws, moves, finds and reads addresses through it', async () => {
    const { loading, sent, say, element } = open()
    say({ type: 'ready' })
    const maps = await loading
    const moved = vi.fn()
    const drawn = maps.draw(element, { latitude: 18.52, longitude: 73.85 }, 17, moved)
    expect(sent).toHaveBeenLastCalledWith({ type: 'draw', at: { latitude: 18.52, longitude: 73.85 }, zoom: 17 }, origin)
    drawn.move({ latitude: 18.53, longitude: 73.86 })
    expect(sent).toHaveBeenLastCalledWith({ type: 'move', at: { latitude: 18.53, longitude: 73.86 } }, origin)
    say({ type: 'moved', at: { latitude: 18.54, longitude: 73.87 } })
    expect(moved).toHaveBeenCalledWith({ latitude: 18.54, longitude: 73.87 })

    const found = maps.find('12 MG Road, Pune', 'IN')
    say({ type: 'answer', id: 1, result: { latitude: 18.52, longitude: 73.85 } })
    expect(await found).toEqual({ latitude: 18.52, longitude: 73.85 })
    const place = maps.place({ latitude: 18.52, longitude: 73.85 })
    say({ type: 'answer', id: 2, result: { line1: 'Camp', city: 'Pune', region: 'Maharashtra', postalCode: '411001', country: 'IN' } })
    expect(await place).toEqual({ line1: 'Camp', city: 'Pune', region: 'Maharashtra', postalCode: '411001', country: 'IN' })
  })

  it('believes nothing from another window or origin, and nothing malformed', async () => {
    const { loading, say, element } = open()
    say({ type: 'ready' })
    const maps = await loading
    const moved = vi.fn()
    maps.draw(element, { latitude: 0, longitude: 0 }, 2, moved)
    say({ type: 'moved', at: { latitude: 1, longitude: 1 } }, { origin: 'https://evil.example' })
    say({ type: 'moved', at: { latitude: 1, longitude: 1 } }, { source: window })
    say({ type: 'moved', at: { latitude: 91, longitude: 1 } })
    expect(moved).not.toHaveBeenCalled()
    const place = maps.place({ latitude: 18.52, longitude: 73.85 })
    say({ type: 'answer', id: 1, result: { line1: '<script>', city: 'Pune', region: null, postalCode: null, country: 'India' } })
    expect(await place).toBeNull()
  })

  it('fails when the frame says Google failed, when it says nothing in 15 s, or when the shopper closes it first', async () => {
    const failed = open()
    failed.say({ type: 'failed' })
    await expect(failed.loading).rejects.toThrow()
    expect(failed.element.querySelector('iframe')).toBeNull()

    vi.useFakeTimers()
    const silent = open()
    vi.advanceTimersByTime(15_000)
    await expect(silent.loading).rejects.toThrow()

    const closed = open()
    closed.stop.abort()
    await expect(closed.loading).rejects.toThrow()
    expect(closed.element.querySelector('iframe')).toBeNull()
  })

  it('fails at once when the store’s CSP refuses the frame, and not for another refusal', async () => {
    const refuse = (effectiveDirective: string, blockedURI: string) => document.dispatchEvent(Object.assign(new Event('securitypolicyviolation'), { effectiveDirective, blockedURI }))
    const map = open()
    refuse('img-src', `${origin}/x.png`)
    refuse('frame-src', 'https://elsewhere.example/')
    map.say({ type: 'ready' })
    await expect(map.loading).resolves.toBeTruthy()

    const blocked = open()
    refuse('frame-src', source)
    await expect(blocked.loading).rejects.toThrow()
    expect(blocked.element.querySelector('iframe')).toBeNull()
    expect(map.element.querySelector('iframe')).not.toBeNull()
  })

  it('keeps the map once ready, though the loading it was waiting on is cancelled after', async () => {
    const { loading, say, element, stop } = open()
    say({ type: 'ready' })
    await loading
    stop.abort()
    expect(element.querySelector('iframe')).not.toBeNull()
  })

  it('takes the frame away on close', async () => {
    const { loading, say, element } = open()
    say({ type: 'ready' })
    ;(await loading).close()
    expect(element.querySelector('iframe')).toBeNull()
  })
})
