import { CourierUnavailable, courierTimeoutMs, maxLabelBytes, type BookedLabel } from '#core/couriers'
import { readCapped } from '#core/http'

// What every courier call shares (AGENTS.md Reliability): a timeout on each call, and for calls that change nothing at
// the courier a bounded retry with backoff. A purchase is never retried here: a lost answer could mean a second label.

export interface CallOptions {
  fetchImpl: typeof fetch
  signal: AbortSignal | undefined
  /** Only for a call that changes nothing at the courier (a login, a read, a file). */
  retry?: boolean
  name: string
}

const tries = 3
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const courierCall = async (url: string, init: RequestInit, o: CallOptions): Promise<Response> => {
  for (let attempt = 1; ; attempt++) {
    const timeout = AbortSignal.timeout(courierTimeoutMs)
    let response: Response | null
    try {
      response = await o.fetchImpl(url, { ...init, signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout })
    } catch {
      response = null
    }
    const again = o.retry === true && attempt < tries && !o.signal?.aborted && (response === null || response.status === 429 || response.status >= 500)
    if (!again) {
      if (response === null) throw new CourierUnavailable(`${o.name}: no answer`)
      return response
    }
    await response?.body?.cancel()
    await pause(250 * 2 ** attempt)
  }
}

// The courier's own file stores (Shiprocket's and EasyPost's labels sit on S3): a link anywhere else is refused, so a
// courier's answer can't point the Worker at another address (AGENTS.md Security: SSRF).
const labelHosts = ['.amazonaws.com', '.easypost.com', '.shiprocket.in', '.shiprocket.co']

export const isLabelHost = (raw: string): boolean => {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.port === '' && labelHosts.some((h) => url.hostname.endsWith(h))
  } catch {
    return false
  }
}

const startsWith = (bytes: Uint8Array, magic: readonly number[]) => magic.every((b, i) => bytes[i] === b)

/** The label file a courier links to, checked by its bytes: a PDF or a PNG, within the cap. */
export const fetchLabel = async (raw: string, o: Omit<CallOptions, 'retry'>): Promise<BookedLabel['label']> => {
  if (!isLabelHost(raw)) throw new CourierUnavailable(`${o.name}: label link refused`)
  const response = await courierCall(raw, { redirect: 'manual' }, { ...o, retry: true })
  if (!response.ok) throw new CourierUnavailable(`${o.name}: label answered ${response.status}`)
  const read = await readCapped(response, maxLabelBytes)
  if (!read.ok) throw new CourierUnavailable(`${o.name}: label too large`)
  if (startsWith(read.bytes, [0x25, 0x50, 0x44, 0x46])) return { bytes: read.bytes, mime: 'application/pdf' }
  if (startsWith(read.bytes, [0x89, 0x50, 0x4e, 0x47])) return { bytes: read.bytes, mime: 'image/png' }
  throw new CourierUnavailable(`${o.name}: label unreadable`)
}
