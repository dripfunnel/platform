// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": false } }
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { frameMap } from './mapFrame'

const source = 'https://hooks.dripfunnel.ai/maps/pin'
const origin = 'https://hooks.dripfunnel.ai'

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
  const loading = frameMap(source, element, 'Pin this location on the map', stop.signal)
  const frame = element.querySelector('iframe')
  if (!frame?.contentWindow) throw new Error('no frame')
  const sent = vi.spyOn(frame.contentWindow, 'postMessage')
  const say = (data: unknown, from: { origin?: string; source?: Window | null } = {}) =>
    dispatchEvent(new MessageEvent('message', { data, origin: from.origin ?? origin, source: from.source === undefined ? frame.contentWindow : from.source }))
  return { element, frame, loading, sent, say, stop }
}

describe('the warehouse map’s frame (#815)', () => {
  it('frames the hooks host’s page sandboxed and titled, says hello once loaded, and draws, moves and finds through it', async () => {
    const { frame, loading, sent, say } = open()
    expect(frame.src).toBe(source)
    expect(frame.title).toBe('Pin this location on the map')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox')
    frame.dispatchEvent(new Event('load'))
    expect(sent).toHaveBeenCalledWith({ type: 'hello' }, origin)
    say({ type: 'ready' })
    const map = await loading
    const moved = vi.fn()
    map.draw({ latitude: 18.52, longitude: 73.85 }, 17, moved)
    expect(sent).toHaveBeenCalledWith({ type: 'draw', at: { latitude: 18.52, longitude: 73.85 }, zoom: 17 }, origin)
    say({ type: 'moved', at: { latitude: 18.53, longitude: 73.86 } })
    expect(moved).toHaveBeenCalledWith({ latitude: 18.53, longitude: 73.86 })
    map.move({ latitude: 1, longitude: 2 })
    expect(sent).toHaveBeenCalledWith({ type: 'move', at: { latitude: 1, longitude: 2 } }, origin)
    const found = map.find('12 Ring Road, Pune', 'IN')
    expect(sent).toHaveBeenCalledWith({ type: 'find', id: 1, address: '12 Ring Road, Pune', country: 'IN' }, origin)
    say({ type: 'answer', id: 1, result: { latitude: 18.5679, longitude: 73.9143 } })
    expect(await found).toEqual({ latitude: 18.5679, longitude: 73.9143 })
    const named = map.place({ latitude: 18.5679, longitude: 73.9143 })
    expect(sent).toHaveBeenCalledWith({ type: 'place', id: 2, at: { latitude: 18.5679, longitude: 73.9143 } }, origin)
    const address = { line1: 'Viman Nagar', city: 'Pune', region: 'Maharashtra', postalCode: '411014', country: 'IN' }
    say({ type: 'answer', id: 2, result: address })
    expect(await named).toEqual(address)
    const bad = map.place({ latitude: 1, longitude: 1 })
    say({ type: 'answer', id: 3, result: { ...address, country: 'India' } })
    expect(await bad).toBeNull()
    map.close()
    expect(frame.isConnected).toBe(false)
  })

  it('believes nothing from another window or origin, and nothing malformed', async () => {
    const { loading, say } = open()
    say({ type: 'ready' }, { origin: 'https://evil.example' })
    say({ type: 'ready' }, { source: window })
    say({ type: 'ready' })
    const map = await loading
    const moved = vi.fn()
    map.draw({ latitude: 0, longitude: 0 }, 2, moved)
    say({ type: 'moved', at: { latitude: 1, longitude: 1 } }, { origin: 'https://evil.example' })
    say({ type: 'moved', at: { latitude: 91, longitude: 1 } })
    expect(moved).not.toHaveBeenCalled()
    const found = map.find('Pune', 'IN')
    say({ type: 'answer', id: 1, result: { latitude: '18', longitude: 73 } })
    expect(await found).toBeNull()
    map.close()
  })

  it('fails when the frame says Google failed, when it says nothing in 15 s, or when loading is cancelled', async () => {
    const failed = open()
    failed.say({ type: 'failed' })
    await expect(failed.loading).rejects.toThrow()
    expect(failed.element.querySelector('iframe')).toBeNull()

    const cancelled = open()
    cancelled.stop.abort()
    await expect(cancelled.loading).rejects.toThrow()

    vi.useFakeTimers()
    const silent = open()
    vi.advanceTimersByTime(15_000)
    await expect(silent.loading).rejects.toThrow()
  })

  it('keeps the map once ready, though the loading it waited on is cancelled after', async () => {
    const { loading, say, element, stop } = open()
    say({ type: 'ready' })
    const map = await loading
    stop.abort()
    expect(element.querySelector('iframe')).not.toBeNull()
    map.close()
  })
})
