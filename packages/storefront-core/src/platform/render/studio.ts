// The studio frame's side of core (storefront AI-STUDIO §3 step 6, §4 step 5): every request it makes carries the
// studio-session id in its path, read from core's own module address, never handed to the theme (ARCHITECTURE §3.4).

import { studioCspSchema } from '../csp/csp'

const studioPrefix = /^\/__studio\/[A-Za-z0-9_-]{22}\//

const portalOrigin = studioCspSchema.shape.portalOrigin
const portalMeta = 'df-studio-portal'

/** The frame's page naming the portal its CSP lets frame it, the only origin core's studio messages go to and come from (AI-STUDIO §8). */
export const studioFramePage = (html: string, portal: string): string => {
  const head = /<head\b[^>]*>/i.exec(html)
  if (!head) throw new Error('The frame’s page has no <head> to name its portal in.')
  const at = head.index + head[0].length
  return `${html.slice(0, at)}<meta name="${portalMeta}" content="${portalOrigin.parse(portal)}">${html.slice(at)}`
}

/** The portal's origin from the frame's page; null on a preview or a live page, which carry none. */
export const studioPortalOrigin = (doc: Document): string | null => {
  const parsed = portalOrigin.safeParse(doc.querySelector(`meta[name="${portalMeta}"]`)?.getAttribute('content'))
  return parsed.success ? parsed.data : null
}

/** `/__studio/{session}/` when `moduleUrl` is under a studio frame, else null (a preview or a live site). */
export const studioBasePath = (moduleUrl: string): string | null => {
  let path: string
  try {
    path = new URL(moduleUrl).pathname
  } catch {
    return null
  }
  return studioPrefix.exec(path)?.[0] ?? null
}

/** The Shop API inside the frame: `/__studio/{session}/shop-api`, so each call carries the session with no cookie. */
export const studioShopEndpoint = (base: string): string => `${base}shop-api`

/** The page's path inside the frame, as the theme's routes know it: the frame's prefix taken off. */
export const studioPagePath = (base: string, pathname: string): string => (pathname.startsWith(base) ? `/${pathname.slice(base.length)}` : '/')

/** What the store's Durable Object sends when a change passed the gate: the new bundle's entry, relative to the frame. */
export type BundleNotice = { type: 'bundle'; id: string; entry: string }

const isNotice = (value: unknown): value is BundleNotice => {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return v['type'] === 'bundle' && typeof v['id'] === 'string' && typeof v['entry'] === 'string' && /^assets\/[A-Za-z0-9_.-]+\.js$/.test(v['entry'])
}

export type HotReloadOptions<T> = {
  base: string
  origin: string
  /** Loads the new entry module and returns what it exports for `apply`. */
  load: (entryUrl: string) => Promise<T>
  /** Renders the new theme into the same root, keeping the page and its state. */
  apply: (loaded: T) => void | Promise<void>
  open?: (url: string) => WebSocket
  scroll?: { read: () => [number, number]; restore: (x: number, y: number) => void }
  /** Runs `run` after `ms`; a test's clock in tests. */
  wait?: (ms: number, run: () => void) => void
}

/** A dropped socket is opened again after 1 second, doubling to at most 30 (a deploy, a network change, a sleep). */
export const reconnectMs = { first: 1_000, most: 30_000 } as const

/**
 * The hot-swap entry point (AI-STUDIO §4 step 5): each notice loads the new theme modules and puts the scroll back, so
 * the merchant keeps the page, the scroll and the width. Only the newest notice's bundle is applied, whatever order
 * the loads finish in; a load that fails is tried again on the next notice, and a dropped socket is opened again.
 */
export const connectHotReload = <T>({ base, origin, load, apply, open = (url) => new WebSocket(url), scroll, wait = (ms, run) => void setTimeout(run, ms) }: HotReloadOptions<T>): (() => void) => {
  const socketUrl = new URL(`${base}__hot`, origin)
  socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  let latest = ''
  let sequence = 0
  let stopped = false
  let delay: number = reconnectMs.first
  let socket: WebSocket

  const onMessage = (event: MessageEvent) => {
    let notice: unknown
    try {
      notice = JSON.parse(String(event.data))
    } catch {
      return
    }
    if (!isNotice(notice) || notice.id === latest) return
    const id = notice.id
    latest = id
    const mine = (sequence += 1)
    void load(new URL(`${base}${notice.entry}`, origin).toString())
      .then(async (loaded) => {
        if (mine !== sequence) return
        const at = scroll?.read()
        await apply(loaded)
        if (at) scroll?.restore(at[0], at[1])
      })
      .catch(() => {
        // The frame keeps the theme it shows; the same bundle is loaded again when it is announced again.
        if (latest === id) latest = ''
      })
  }

  const connect = () => {
    socket = open(socketUrl.toString())
    socket.addEventListener('open', () => {
      delay = reconnectMs.first
    })
    socket.addEventListener('message', onMessage)
    socket.addEventListener('close', () => {
      if (stopped) return
      wait(delay, connect)
      delay = Math.min(delay * 2, reconnectMs.most)
    })
  }

  connect()
  return () => {
    stopped = true
    socket.close()
  }
}
