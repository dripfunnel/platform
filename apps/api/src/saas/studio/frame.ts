// The studio frame's pages as the store's Durable Object serves them (storefront AI-STUDIO §3 step 6, §8; PREVIEW §5
// step 4): the container's files under the session's path, with headers that keep the id out of every Referer and cache.

const framePath = /^\/__studio\/([A-Za-z0-9_-]{22})(\/.*)?$/

/** The id and what follows it; null for anything that isn't a frame address. Neither is ever logged (LOGGING §9). */
export const studioFrameOf = (pathname: string): { session: string; rest: string } | null => {
  const m = framePath.exec(pathname)
  return m?.[1] ? { session: m[1], rest: m[2] ?? '/' } : null
}

/** The store a request's preview host names, set by the API for the Durable Object, never by the browser. */
export const studioStoreHeader = 'x-df-studio-store'

/** The frame's origins for core's studio CSP (ARCHITECTURE §3.5), as the sandbox builds it from them. */
export const frameOriginHeaders = { media: 'x-df-frame-media', portal: 'x-df-frame-portal' } as const

const always = { 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff' }

/** Every refused or closed frame gets the same page, whether the id is unknown, expired, or another store's. */
export const frameClosed = (): Response => new Response(null, { status: 404, headers: { ...always, 'cache-control': 'no-store' } })

/** Until the container answers: an empty page that asks again in two seconds; the portal shows the words (#319). */
export const frameOpening = (): Response =>
  new Response('<!doctype html><meta http-equiv="refresh" content="2"><title></title>', {
    status: 503,
    headers: { ...always, 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8', 'retry-after': '2', 'content-security-policy': "default-src 'none'" },
  })

const isHtml = (response: Response) => (response.headers.get('content-type') ?? '').startsWith('text/html')

/**
 * The bundle's page names its module by `/assets/…` (apps/sandbox gate/bundle.ts); in the frame every address is under
 * the session's prefix, so those references move there. Chunks import each other and core by relative path.
 */
export const dressFrameResponse = async (response: Response, base: string): Promise<Response> => {
  const headers = new Headers(always)
  for (const name of ['content-type', 'content-security-policy']) {
    const value = response.headers.get(name)
    if (value) headers.set(name, value)
  }
  if (!isHtml(response)) {
    // Private, so no shared cache keeps a chunk; the browser's own cache is keyed by the address, id and all.
    headers.set('cache-control', 'private, max-age=31536000, immutable')
    return new Response(response.body, { status: response.status, headers })
  }
  headers.set('cache-control', 'no-store')
  const html = (await response.text()).replaceAll('="/assets/', `="${base}assets/`)
  return new Response(html, { status: response.status, headers })
}

export interface FrameServer {
  /** The store this Durable Object belongs to. */
  storeId: string
  live: (storeId: string, session: string) => Promise<unknown>
  loaded: () => boolean
  open: () => void
  /** The frame's origins for its CSP: its own (images through `/shop-api/assets/`) and the partner's live portal. */
  origins: (frameOrigin: string) => Promise<{ media: string; portal: string } | null>
  file: (path: string, origins: { media: string; portal: string }) => Promise<Response | null>
  /** Accepts the hot-reload WebSocket (`/__studio/{session}/__hot`), tagged so the alarm can close it when the session ends. */
  socket: (session: string) => Promise<Response>
}

/**
 * One frame request at the store's Durable Object: the session is checked before anything is read; then the
 * container's file, or `index.html` for a page's path (a SPA), dressed for the frame; or the opening page.
 */
export const serveFrame = async (request: Request, server: FrameServer): Promise<Response> => {
  const url = new URL(request.url)
  const frame = studioFrameOf(url.pathname)
  if (!frame || request.headers.get(studioStoreHeader) !== server.storeId) return frameClosed()
  if (!(await server.live(server.storeId, frame.session))) return frameClosed()
  if (frame.rest === '/__hot') return request.headers.get('upgrade')?.toLowerCase() === 'websocket' ? server.socket(frame.session) : frameClosed()
  if (!server.loaded()) {
    server.open()
    return frameOpening()
  }
  const origins = await server.origins(url.origin)
  if (!origins) return frameClosed()
  const base = `/__studio/${frame.session}/`
  const path = frame.rest.slice(1) || 'index.html'
  let response = await server.file(path, origins)
  if ((!response || response.status === 404) && !/\.[A-Za-z0-9]+$/.test(path)) response = await server.file('index.html', origins)
  if (!response || !response.ok) return frameClosed()
  return dressFrameResponse(response, base)
}

/** A frame's hot-reload socket as the sweep sees it: the tag it was accepted with, its session's hash. */
export type FrameSocket = { tag: string | undefined; close: () => void }

/** AI-STUDIO §8 "Short-lived": every socket whose session is no longer live is closed; the others stay open. */
export const closeEndedSockets = async (sockets: readonly FrameSocket[], live: (idHash: string) => Promise<boolean>): Promise<number> => {
  let closed = 0
  for (const socket of sockets) {
    if (socket.tag && (await live(socket.tag))) continue
    socket.close()
    closed += 1
  }
  return closed
}
