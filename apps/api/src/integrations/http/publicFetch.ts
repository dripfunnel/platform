import { parseHostname } from '#core/hostname'
import type { DnsLookup } from '../dns/doh'

// A file from an address a user gave us (AGENTS.md "Security": SSRF, timeouts, bounded retries): https on a
// public name only, every address it resolves to public, each redirect checked the same way, and a size cap.
// A name whose answer changes between the check and the fetch isn't stopped here; why that's bounded, and when it
// stops being, is docs/ARCHITECTURE.md §7 ("Fetching a URL a user gave us").

export type PublicFetchRefusal = 'BAD_URL' | 'PRIVATE_ADDRESS' | 'NOT_FOUND' | 'TOO_LARGE' | 'UNAVAILABLE'
export type PublicFetchResult = { ok: true; bytes: Uint8Array<ArrayBuffer> } | { ok: false; code: PublicFetchRefusal }

export interface PublicFetchOptions {
  lookup: DnsLookup
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxBytes: number
  /** Attempts in all for a failure that may pass (a timeout, a 5xx); a 4xx is final. */
  tries?: number
  maxRedirects?: number
}

const octets = (ip: string) => ip.split('.').map(Number)

/** Loopback, private, link-local, shared, multicast and reserved IPv4 ranges. */
export const isPrivateIpv4 = (ip: string): boolean => {
  const [a = 0, b = 0, c = 0] = octets(ip)
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) ||
    // IETF protocol assignments and the three documentation ranges (RFC 6890, RFC 5737).
    (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)
  )
}

/** Anything but a global unicast IPv6 address, mapped and translated IPv4 included. */
export const isPrivateIpv6 = (ip: string): boolean => {
  const v = ip.toLowerCase()
  // Global unicast only; documentation, 6to4 and Teredo (2001::/32, which carries an IPv4 address) aren't.
  return !/^[23][0-9a-f]{0,3}:/.test(v) || v.startsWith('2001:db8') || v.startsWith('2002:') || /^2001:0{0,4}:/.test(v)
}

const checkedUrl = async (raw: string, lookup: DnsLookup, signal: AbortSignal): Promise<URL | PublicFetchRefusal> => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'BAD_URL'
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return 'BAD_URL'
  const host = parseHostname(url.hostname)
  if (!host.ok || host.wildcard) return 'BAD_URL'
  const [v4, v6] = await Promise.all([lookup.resolve(host.host, 'A', signal), lookup.resolve(host.host, 'AAAA', signal)])
  if (v4.length + v6.length === 0) return 'NOT_FOUND'
  if (v4.some(isPrivateIpv4) || v6.some(isPrivateIpv6)) return 'PRIVATE_ADDRESS'
  return url
}

const readCapped = async (response: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> => {
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) return null
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array(0)
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      return null
    }
    parts.push(value)
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const part of parts) {
    bytes.set(part, at)
    at += part.byteLength
  }
  return bytes
}

const once = async (raw: string, o: PublicFetchOptions): Promise<PublicFetchResult | 'retry'> => {
  const signal = AbortSignal.timeout(o.timeoutMs ?? 5_000)
  const fetchImpl = o.fetchImpl ?? fetch
  try {
    let next = raw
    for (let hop = 0; hop <= (o.maxRedirects ?? 3); hop++) {
      const url = await checkedUrl(next, o.lookup, signal)
      if (typeof url === 'string') return { ok: false, code: url }
      const response = await fetchImpl(url, { redirect: 'manual', signal, headers: { accept: 'image/*' } })
      const location = response.headers.get('location')
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel()
        next = new URL(location, url).toString()
        continue
      }
      if (response.status >= 500 || response.status === 429) return 'retry'
      if (!response.ok) return { ok: false, code: 'NOT_FOUND' }
      const bytes = await readCapped(response, o.maxBytes)
      return bytes ? { ok: true, bytes } : { ok: false, code: 'TOO_LARGE' }
    }
    return { ok: false, code: 'UNAVAILABLE' }
  } catch {
    return 'retry'
  }
}

export const fetchPublic = async (raw: string, o: PublicFetchOptions): Promise<PublicFetchResult> => {
  const tries = o.tries ?? 2
  for (let attempt = 1; attempt <= tries; attempt++) {
    const result = await once(raw, o)
    if (result !== 'retry') return result
    if (attempt < tries) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
  }
  return { ok: false, code: 'UNAVAILABLE' }
}
