import { readCapped, type PublicFetchResult } from './publicFetch'

export interface LocalFetchOptions {
  maxBytes: number
  timeoutMs: number
  fetchImpl?: typeof fetch
}

/** The local stand-in for fetchPublic (#1561, DNS_LOCAL): a `*.localhost` link under `pathPrefix` (the shop's public assets, never another route), or null. */
export const localLink = (raw: string, pathPrefix: string): URL | null => {
  try {
    const url = new URL(raw)
    const web = url.protocol === 'http:' || url.protocol === 'https:'
    return web && url.hostname.endsWith('.localhost') && url.pathname.startsWith(`${pathPrefix}/`) ? url : null
  } catch {
    return null
  }
}

/** Reads the link from the local Worker's port, with fetchPublic's limits: no redirect is followed, a timeout, a size cap. */
export const fetchLocal = async (url: URL, o: LocalFetchOptions): Promise<PublicFetchResult> => {
  try {
    const response = await (o.fetchImpl ?? fetch)(`http://${url.hostname}:8787${url.pathname}${url.search}`, { redirect: 'manual', signal: AbortSignal.timeout(o.timeoutMs) })
    if (!response.ok) return { ok: false, code: response.status === 404 ? 'NOT_FOUND' : 'UNAVAILABLE' }
    const bytes = await readCapped(response, o.maxBytes)
    return bytes ? { ok: true, bytes } : { ok: false, code: 'TOO_LARGE' }
  } catch {
    return { ok: false, code: 'UNAVAILABLE' }
  }
}
