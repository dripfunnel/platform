import { describe, expect, it } from 'vitest'
import { handleMapFrame, mapFramePath, mapFrameScriptPath } from './mapFrame'

const key = 'AIzaSyTestTestTestTestTestTestTestTest12'
const get = (path: string, o: { key?: string | null; local?: boolean; method?: string } = {}) =>
  handleMapFrame(new Request(`https://hooks.dripfunnel.ai${path}`, { method: o.method ?? 'GET' }), path, { key: o.key === undefined ? key : o.key, local: o.local ?? false })
const directive = (csp: string | null, name: string) => (csp ?? '').split('; ').find((d) => d.startsWith(`${name} `))

describe('the Pin on map frame', () => {
  it('serves the page with the key and its script, under Google’s CSP for this page alone', async () => {
    const page = get(mapFramePath)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await page.text()).toContain(`<script src="${mapFrameScriptPath}" data-key="${key}"></script>`)
    const csp = page.headers.get('content-security-policy')
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'unsafe-eval' https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.ggpht.com https://*.googleusercontent.com blob:")
    expect(directive(csp, 'default-src')).toBe("default-src 'none'")
    expect(directive(csp, 'form-action')).toBe("form-action 'none'")
    expect(page.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    const script = get(mapFrameScriptPath)
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    const code = await script.text()
    expect(code).toContain('parent.postMessage(message, parentOrigin)')
    expect(code).toContain("'&language=' + lang")
    expect(code).toContain('result = placeOf(found.results)')
    expect(code).toContain('...(m.country ? { componentRestrictions: { country: m.country } } : {})')
  })

  it('may be framed by any https store, and by this machine’s http storefront only locally', () => {
    expect(directive(get(mapFramePath).headers.get('content-security-policy'), 'frame-ancestors')).toBe('frame-ancestors https:')
    expect(directive(get(mapFramePath, { local: true }).headers.get('content-security-policy'), 'frame-ancestors')).toBe('frame-ancestors https: http://localhost:* http://127.0.0.1:*')
  })

  it('is not there without a key, or for anything but a GET', () => {
    expect(get(mapFramePath, { key: null }).status).toBe(404)
    expect(get(mapFrameScriptPath, { key: null }).status).toBe(404)
    expect(get(mapFramePath, { method: 'POST' }).status).toBe(404)
  })
})

// The frame's script, run against a stand-in for Google, to see what it will and won't pass on to Places (#1609).
// What the script makes with `new`.
function thing() {
  return {}
}
const tokenOf = thing

const runFrame = async (frame: { predictions?: () => Promise<{ suggestions: unknown[] }>; withPlaces?: boolean } = {}) => {
  const code = await get(mapFrameScriptPath).text()
  const sent: unknown[] = []
  const listeners: ((e: unknown) => Promise<void>)[] = []
  const parent = {}
  const calls: { suggest: unknown[]; fetchFields: unknown[] } = { suggest: [], fetchFields: [] }
  const place = { location: { lat: () => 18.5, lng: () => 73.9 }, fetchFields: async (o: unknown) => void calls.fetchFields.push(o) }
  const prediction = { placeId: 'p1', text: { text: 'Viman Nagar, Pune' }, mainText: { text: 'Viman Nagar' }, secondaryText: { text: 'Pune' }, toPlace: () => place }
  const google = {
    maps: {
      importLibrary: async (name: string) =>
        name === 'places'
          ? frame.withPlaces === false
            ? Promise.reject(new Error('off'))
            : { AutocompleteSessionToken: tokenOf, AutocompleteSuggestion: { fetchAutocompleteSuggestions: async (o: unknown) => (calls.suggest.push(o), frame.predictions ? frame.predictions() : { suggestions: [{ placePrediction: prediction }, {}] }) } }
          : { Map: thing, Marker: thing, Geocoder: thing },
    },
  }
  const scope: Record<string, unknown> = { document: { currentScript: { dataset: { key } }, createElement: () => ({}), head: { appendChild: () => undefined }, getElementById: () => ({}) }, location: { search: '?language=en' }, parent, addEventListener: (_: string, fn: (e: unknown) => Promise<void>) => listeners.push(fn), window: {} }
  scope['window'] = { google, parent }
  new Function(...Object.keys(scope), 'Math', 'Number', code)(...Object.values(scope), Math, Number)
  const win = scope['window'] as { __dfMapsReady: () => Promise<void> }
  // parent.postMessage is what the script calls to answer.
  ;(parent as { postMessage?: (m: unknown) => void }).postMessage = (m) => void sent.push(m)
  await win.__dfMapsReady()
  const say = async (data: unknown) => {
    for (const fn of listeners) await fn({ data, source: parent, origin: 'https://store.example' })
  }
  await say({ type: 'hello' })
  sent.length = 0
  return { say, sent, calls }
}

describe('the frame’s address search (#1609)', () => {
  it('answers suggestions for a typed address, then the point of the one chosen, in one Places session', async () => {
    const { say, sent, calls } = await runFrame()
    await say({ type: 'suggest', id: 1, text: 'viman', country: 'IN' })
    expect(sent.at(-1)).toEqual({ type: 'answer', id: 1, result: [{ id: 'p1', main: 'Viman Nagar', secondary: 'Pune' }] })
    expect(calls.suggest[0]).toMatchObject({ input: 'viman', includedRegionCodes: ['in'], language: 'en' })
    await say({ type: 'select', id: 2, choice: 'p1' })
    expect(sent.at(-1)).toEqual({ type: 'answer', id: 2, result: { latitude: 18.5, longitude: 73.9 } })
    expect(calls.fetchFields).toEqual([{ fields: ['location'] }])
    const token = (calls.suggest[0] as { sessionToken: unknown }).sessionToken
    await say({ type: 'suggest', id: 3, text: 'viman', country: '' })
    expect((calls.suggest[1] as { sessionToken: unknown }).sessionToken).not.toBe(token)
    expect(calls.suggest[1]).not.toHaveProperty('includedRegionCodes')
  })

  it('asks Places for nothing it was not properly given, and picks nothing it did not offer', async () => {
    const { say, sent, calls } = await runFrame()
    for (const bad of [{ text: 'a', country: 'IN' }, { text: 'x'.repeat(201), country: 'IN' }, { text: 'viman', country: 'India' }, { text: 7, country: 'IN' }]) {
      await say({ type: 'suggest', id: 1, ...bad })
      expect(sent.at(-1)).toEqual({ type: 'answer', id: 1, result: null })
    }
    expect(calls.suggest).toEqual([])
    await say({ type: 'select', id: 2, choice: 'never-offered' })
    expect(sent.at(-1)).toEqual({ type: 'answer', id: 2, result: null })
    expect(calls.fetchFields).toEqual([])
  })

  it('answers nothing, and the map still loads, where Places is not available on the key', async () => {
    const off = await runFrame({ withPlaces: false })
    await off.say({ type: 'suggest', id: 1, text: 'viman', country: 'IN' })
    expect(off.sent.at(-1)).toEqual({ type: 'answer', id: 1, result: null })
    const failing = await runFrame({ predictions: () => Promise.reject(new Error('denied')) })
    await failing.say({ type: 'suggest', id: 1, text: 'viman', country: 'IN' })
    expect(failing.sent.at(-1)).toEqual({ type: 'answer', id: 1, result: null })
  })
})
