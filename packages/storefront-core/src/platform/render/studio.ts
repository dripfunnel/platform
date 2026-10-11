// The studio frame's side of core (storefront AI-STUDIO §3 step 6, §4 step 5): every request it makes carries the
// studio-session id in its path, read from core's own module address, never handed to the theme (ARCHITECTURE §3.4).

const studioPrefix = /^\/__studio\/[A-Za-z0-9_-]{22}\//

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
}

/**
 * The hot-swap entry point (AI-STUDIO §4 step 5): each notice loads the new theme modules and puts the scroll back, so
 * the merchant keeps the page, the scroll and the width. Only the newest notice's bundle is applied, whatever order
 * the loads finish in.
 */
export const connectHotReload = <T>({ base, origin, load, apply, open = (url) => new WebSocket(url), scroll }: HotReloadOptions<T>): (() => void) => {
  const socketUrl = new URL(`${base}__hot`, origin)
  socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = open(socketUrl.toString())
  let latest = ''
  let sequence = 0
  socket.addEventListener('message', (event: MessageEvent) => {
    let notice: unknown
    try {
      notice = JSON.parse(String(event.data))
    } catch {
      return
    }
    if (!isNotice(notice) || notice.id === latest) return
    latest = notice.id
    const mine = (sequence += 1)
    void load(new URL(`${base}${notice.entry}`, origin).toString()).then(async (loaded) => {
      if (mine !== sequence) return
      const at = scroll?.read()
      await apply(loaded)
      if (at) scroll?.restore(at[0], at[1])
    })
  })
  return () => socket.close()
}
