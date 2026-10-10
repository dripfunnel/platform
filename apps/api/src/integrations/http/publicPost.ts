import type { DnsLookup } from '../dns/doh'
import { checkedUrl, type PublicFetchRefusal } from './publicFetch'

// A POST to an address a merchant gave us (a webhook endpoint): checked as publicFetch checks a file's address, every
// time it is sent, with no redirect followed, so a name that later points inside is refused at the send.

export type PublicPostResult =
  | { ok: true; status: number; ms: number }
  | { ok: false; code: Exclude<PublicFetchRefusal, 'TOO_LARGE'> | 'TIMEOUT'; ms: number }

export interface PublicPostOptions {
  lookup: DnsLookup
  fetchImpl?: typeof fetch
  timeoutMs: number
  now?: () => number
}

export const postPublic = async (raw: string, body: string, headers: Record<string, string>, o: PublicPostOptions): Promise<PublicPostResult> => {
  const clock = o.now ?? Date.now
  const started = clock()
  const signal = AbortSignal.timeout(o.timeoutMs)
  try {
    const url = await checkedUrl(raw, o.lookup, signal)
    if (typeof url === 'string') return { ok: false, code: url === 'TOO_LARGE' ? 'UNAVAILABLE' : url, ms: clock() - started }
    const response = await (o.fetchImpl ?? fetch)(url, { method: 'POST', body, headers, redirect: 'manual', signal })
    await response.body?.cancel()
    return { ok: true, status: response.status, ms: clock() - started }
  } catch {
    return { ok: false, code: signal.aborted ? 'TIMEOUT' : 'UNAVAILABLE', ms: clock() - started }
  }
}
