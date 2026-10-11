import type { Deps } from './deps'
import type { EdgeApi, LiveHost, PreviewAccess, PreviewCheck } from './edge'
import { sessionSeal } from './session'

// In-memory stand-ins for the tests: R2, one data centre's Cache API (honouring max-age against the test's clock, and
// purge by tag), and the API's StorefrontEdge entrypoint.

export interface Clock {
  at: number
}

export const fakeCache = (clock: Clock) => {
  const entries = new Map<string, { body: ArrayBuffer; status: number; headers: [string, string][]; expires: number; tags: string[] }>()
  const keyOf = (key: RequestInfo | URL) => (typeof key === 'string' ? key : key instanceof URL ? key.href : key.url)
  const cache = {
    match: async (key: RequestInfo | URL) => {
      const found = entries.get(keyOf(key))
      if (!found || found.expires <= clock.at) return undefined
      return new Response(found.body.slice(0), { status: found.status, headers: found.headers })
    },
    put: async (key: RequestInfo | URL, response: Response) => {
      const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 0)
      if (/private|no-store/.test(response.headers.get('cache-control') ?? '') || maxAge === 0) return
      entries.set(keyOf(key), { body: await response.arrayBuffer(), status: response.status, headers: [...response.headers], expires: clock.at + maxAge * 1000, tags: (response.headers.get('cache-tag') ?? '').split(',').filter(Boolean) })
    },
    delete: async (key: RequestInfo | URL) => entries.delete(keyOf(key)),
  }
  return {
    cache: cache as unknown as Cache,
    keys: () => [...entries.keys()],
    purgeTag: (tag: string) => {
      for (const [key, entry] of entries) if (entry.tags.includes(tag)) entries.delete(key)
    },
  }
}

export interface FakeObject {
  body: string
  contentType?: string
  cacheControl?: string
  csp?: string
}

export const fakeSites = (objects: Record<string, FakeObject>) => {
  const asked: string[] = []
  const bucket = {
    get: async (key: string) => {
      asked.push(key)
      const o = objects[key]
      if (!o) return null
      return {
        body: new Response(o.body).body,
        httpEtag: `"${key.length}"`,
        httpMetadata: { ...(o.contentType ? { contentType: o.contentType } : {}), ...(o.cacheControl ? { cacheControl: o.cacheControl } : {}) },
        customMetadata: o.csp ? { csp: o.csp } : {},
      }
    },
  }
  return { sites: bucket as unknown as R2Bucket, asked }
}

export interface FakeEdge extends EdgeApi {
  hosts: Map<string, LiveHost>
  /** Each token's preview key and what `openPreview` answers for it there; `previewAccess` per key, store, user and epoch. */
  tokens: Map<string, { key: string; access: PreviewAccess }>
  access: Map<string, PreviewAccess>
  /** Each store's renamed addresses, old to new, as `redirects` answers them. */
  renamed: Map<string, { from: string; to: string }[]>
  calls: string[]
  forwarded: Request[]
}

export const fakeEdge = (): FakeEdge => {
  const edge: FakeEdge = {
    hosts: new Map(),
    tokens: new Map(),
    access: new Map(),
    renamed: new Map(),
    calls: [],
    forwarded: [],
    fetch: async (request) => {
      edge.forwarded.push(request)
      return new Response('{"data":{}}', { headers: { 'content-type': 'application/json' } })
    },
    liveHost: async (host) => {
      edge.calls.push(`liveHost ${host}`)
      return edge.hosts.get(host) ?? { kind: 'none' }
    },
    redirects: async (storeId) => {
      edge.calls.push(`redirects ${storeId}`)
      return { redirects: edge.renamed.get(storeId) ?? [] }
    },
    openPreview: async (key, token) => {
      edge.calls.push(`openPreview ${key}`)
      const found = edge.tokens.get(token)
      // The API refuses a link on any host but its own store's (PREVIEW §5 step 2).
      return found && found.key === key ? found.access : { ok: false }
    },
    previewAccess: async (check: PreviewCheck) => {
      edge.calls.push(`previewAccess ${check.key}`)
      return edge.access.get(`${check.key}:${check.storeId}:${check.userId}:${check.epoch}`) ?? { ok: false }
    },
  }
  return edge
}

export const sessionKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))

/** The deps, and `settle` to wait for the cache writes `waitUntil` was handed. */
export const depsWith = async (parts: { edge: EdgeApi; sites: R2Bucket; cache: Cache; clock: Clock }): Promise<{ deps: Deps; settle: () => Promise<void> }> => {
  const pending: Promise<unknown>[] = []
  const deps: Deps = {
    edge: parts.edge,
    sites: parts.sites,
    cache: parts.cache,
    waitUntil: (work) => void pending.push(work),
    now: () => parts.clock.at,
    sessions: await sessionSeal(sessionKey),
  }
  return { deps, settle: async () => void (await Promise.all(pending.splice(0))) }
}
