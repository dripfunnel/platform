// The post-deploy checks' view of a live store (storefront LIVE-SHOP.md §4 step 10): what a shopper's browser gets from
// the edge Worker on the store's own address. Every call has a timeout, and a failure that may pass is tried again.

/** One answer from the edge; `build` is the build the edge Worker served it from (`x-df-build`). */
export interface ProbeAnswer {
  status: number
  contentType: string
  build: string | null
  body: string
}

export interface ShopAnswer {
  status: number
  data: unknown
  errors: boolean
}

export interface EdgeProbe {
  /** A GET as a shopper's browser makes it; null where this environment can't reach the address (the local stand-in). */
  get: (url: string) => Promise<ProbeAnswer | null>
  /** A Shop API query on the store's own host, through the edge Worker's `/shop-api` door. */
  shop: (host: string, query: string, variables: Record<string, unknown>) => Promise<ShopAnswer | null>
}

export interface HttpProbeOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Attempts in all for a failure that may pass (no answer, a 5xx); a 4xx is final. */
  tries?: number
  sleep?: (ms: number) => Promise<void>
}

const maxBody = 2 * 1024 * 1024
const maxRedirects = 3
const userAgent = 'DripFunnel-PostDeployCheck/1'

const readCapped = async (response: Response): Promise<string> => {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBody) {
      await reader.cancel()
      break
    }
    chunks.push(value)
  }
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0))
  let at = 0
  for (const chunk of chunks) {
    all.set(chunk, at)
    at += chunk.byteLength
  }
  return new TextDecoder().decode(all)
}

export const httpEdgeProbe = (options: HttpProbeOptions = {}): EdgeProbe => {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 10_000
  const tries = options.tries ?? 3
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  const attempt = async (request: () => Promise<Response>): Promise<Response | null> => {
    for (let n = 1; ; n++) {
      const response = await request().catch(() => null)
      if (response && response.status < 500) return response
      if (n >= tries) return response
      await response?.body?.cancel()
      await sleep(500 * 3 ** (n - 1))
    }
  }

  const get = async (raw: string): Promise<ProbeAnswer | null> => {
    let url = new URL(raw)
    for (let hops = 0; ; hops++) {
      const target = url
      const response = await attempt(() => fetchImpl(target, { redirect: 'manual', headers: { 'user-agent': userAgent }, signal: AbortSignal.timeout(timeoutMs) }))
      if (!response) return { status: 0, contentType: '', build: null, body: '' }
      const location = response.headers.get('location')
      // The store's own redirects (the root to its language, a renamed page) stay on its host; anything else is the answer.
      if (response.status >= 300 && response.status < 400 && location && hops < maxRedirects) {
        const next = new URL(location, url)
        if (next.host === url.host && next.protocol === 'https:') {
          await response.body?.cancel()
          url = next
          continue
        }
      }
      return { status: response.status, contentType: response.headers.get('content-type') ?? '', build: response.headers.get('x-df-build'), body: await readCapped(response) }
    }
  }

  const shop = async (host: string, query: string, variables: Record<string, unknown>): Promise<ShopAnswer | null> => {
    const response = await attempt(() =>
      fetchImpl(`https://${host}/shop-api`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': userAgent },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(timeoutMs),
      }),
    )
    if (!response) return { status: 0, data: null, errors: true }
    let body: unknown
    try {
      body = JSON.parse(await readCapped(response))
    } catch {
      return { status: response.status, data: null, errors: true }
    }
    const v = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
    return { status: response.status, data: v['data'] ?? null, errors: Array.isArray(v['errors']) && v['errors'].length > 0 }
  }

  return { get, shop }
}
