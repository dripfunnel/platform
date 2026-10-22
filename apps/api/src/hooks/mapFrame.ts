// hooks.<host>/maps/pin (#814; storefront ARCHITECTURE §3.5): the storefront's "Pin on map" in a frame of its own, so Google
// Maps runs under this page's CSP and never the store's. Core's pin control talks to it by postMessage (ui/headless/pinFrame).
export const mapFramePath = '/maps/pin'
export const mapFrameScriptPath = '/maps/pin.js'

// Google's own allowlist for the Maps JavaScript API (its CSP guide), on this page only.
const google = {
  script: ["'unsafe-eval'", 'https://*.googleapis.com', 'https://*.gstatic.com', 'https://*.google.com', 'https://*.ggpht.com', 'https://*.googleusercontent.com', 'blob:'],
  img: ['https://*.googleapis.com', 'https://*.gstatic.com', 'https://*.google.com', 'https://*.googleusercontent.com', 'data:'],
  connect: ['https://*.googleapis.com', 'https://*.google.com', 'https://*.gstatic.com', 'data:', 'blob:'],
}

/** Any store may frame it: every store has its own domain. On this machine, the http storefront too. */
const frameCsp = (local: boolean) =>
  [
    "default-src 'none'",
    `script-src 'self' ${google.script.join(' ')}`,
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    `img-src ${google.img.join(' ')}`,
    `connect-src ${google.connect.join(' ')}`,
    'frame-src https://*.google.com',
    'worker-src blob:',
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'none'",
    `frame-ancestors https:${local ? ' http://localhost:* http://127.0.0.1:*' : ''}`,
  ].join('; ')

const page = (key: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Map</title><style>html,body,#map{margin:0;height:100%}</style></head><body><div id="map"></div><script src="${mapFrameScriptPath}" data-key="${key}"></script></body></html>`

// The frame's half of the messages core's pinFrame.ts sends: hello, draw, move, find and place; it answers ready or failed,
// moved, and answer. It replies only to the window that framed it, at the origin its first message came from.
const script = `(() => {
  const key = document.currentScript.dataset.key
  // The store page's language, so Google names streets and states in it, never its own guess.
  const language = new URLSearchParams(location.search).get('language')
  let parentOrigin = null
  let lib = null
  let failed = false
  let map = null
  let marker = null
  const send = (message) => { if (parentOrigin) parent.postMessage(message, parentOrigin) }
  const fail = () => { failed = true; send({ type: 'failed' }) }
  const finite = (n, limit) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= limit
  const latLng = (p) => (p && finite(p.latitude, 90) && finite(p.longitude, 180) ? { lat: p.latitude, lng: p.longitude } : null)
  const pinOf = (l) => ({ latitude: l.lat(), longitude: l.lng() })
  const part = (result, type, short) => { const p = result.address_components.find((c) => c.types.includes(type)); return p ? (short ? p.short_name : p.long_name) : null }
  // The first answer that agrees with most of them on state, city and PIN: a building's own record can be in another script.
  const placeOf = (results) => {
    const usual = (type) => {
      const counts = new Map()
      for (const r of results.slice(0, 8)) { const v = part(r, type); if (v) counts.set(v, (counts.get(v) || 0) + 1) }
      return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    }
    const agreed = ['administrative_area_level_1', 'locality', 'postal_code'].map((type) => [type, usual(type)])
    const best = results.find((r) => agreed.every(([type, v]) => !v || part(r, type) === v)) || results[0]
    if (!best) return null
    const of = (type, short) => part(best, type, short)
    const country = of('country', true)
    if (!country) return null
    const street = [of('street_number'), of('route')].filter(Boolean).join(' ')
    const line1 = [of('premise'), street, of('sublocality_level_2'), of('sublocality_level_1')].filter(Boolean).join(', ')
    return { line1: line1 || null, city: of('locality') || of('postal_town') || of('administrative_area_level_2'), region: of('administrative_area_level_1'), postalCode: of('postal_code'), country }
  }
  window.gm_authFailure = fail
  window.__dfMapsReady = async () => {
    try {
      const maps = window.google.maps
      const [{ Map }, { Marker }, { Geocoder }] = await Promise.all([maps.importLibrary('maps'), maps.importLibrary('marker'), maps.importLibrary('geocoding')])
      lib = { Map, Marker, geocoder: new Geocoder() }
      send({ type: 'ready' })
    } catch {
      fail()
    }
  }
  addEventListener('message', async (e) => {
    const m = e.data
    if (e.source !== parent || !m || typeof m !== 'object') return
    if (m.type === 'hello' && parentOrigin === null) {
      parentOrigin = e.origin
      if (failed) fail()
      else if (lib) send({ type: 'ready' })
      return
    }
    if (e.origin !== parentOrigin || !lib) return
    if (m.type === 'draw') {
      const at = latLng(m.at)
      if (!at) return
      map = new lib.Map(document.getElementById('map'), { center: at, zoom: finite(m.zoom, 22) ? m.zoom : 17, disableDefaultUI: true, zoomControl: true, keyboardShortcuts: false })
      marker = new lib.Marker({ map, position: at, draggable: true })
      marker.addListener('dragend', () => { const p = marker.getPosition(); if (p) send({ type: 'moved', at: pinOf(p) }) })
    } else if (m.type === 'move') {
      const at = latLng(m.at)
      if (at && marker) { marker.setPosition(at); map.panTo(at) }
    } else if ((m.type === 'find' || m.type === 'place') && Number.isInteger(m.id)) {
      let result = null
      try {
        if (m.type === 'find' && typeof m.country === 'string' && /^([A-Z]{2})?$/.test(m.country) && typeof m.address === 'string' && m.address.length <= 500 && (m.address || m.country)) {
          // Without a country, the address alone (#815's form may leave it empty).
          const found = await lib.geocoder.geocode({ ...(m.address ? { address: m.address } : {}), ...(m.country ? { componentRestrictions: { country: m.country } } : {}) })
          const at = found.results[0] && found.results[0].geometry.location
          result = at ? pinOf(at) : null
        } else if (m.type === 'place' && latLng(m.at)) {
          const found = await lib.geocoder.geocode({ location: latLng(m.at) })
          result = placeOf(found.results)
        }
      } catch {
        result = null
      }
      send({ type: 'answer', id: m.id, result })
    }
  })
  const s = document.createElement('script')
  s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&v=weekly&loading=async&callback=__dfMapsReady' + (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(language || '') ? '&language=' + language : '')
  s.async = true
  s.onerror = fail
  document.head.appendChild(s)
})()
`

const headers = (type: string, local: boolean) => ({
  'content-type': `${type}; charset=utf-8`,
  'content-security-policy': frameCsp(local),
  'x-content-type-options': 'nosniff',
  // Google sees this host as the referrer, which the key is restricted to (THIRD-PARTY-ACCESS §2.12).
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cache-control': 'public, max-age=300',
})

/** The frame's page and its script; 404 without a key, so the store hides the button (THIRD-PARTY-ACCESS §2.12). */
export const handleMapFrame = (request: Request, path: string, { key, local }: { key: string | null; local: boolean }): Response => {
  if (!key || request.method !== 'GET') return new Response('Not found', { status: 404 })
  if (path === mapFrameScriptPath) return new Response(script, { headers: headers('text/javascript', local) })
  return new Response(page(key), { headers: headers('text/html', local) })
}
