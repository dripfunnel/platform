import { z } from 'zod'

// Expo's push service (THIRD-PARTY-ACCESS §2.13): one call per 100 messages with a timeout; the outbox relay retries
// (decided on #840). Only Expo's error codes are kept, never its message, which can echo a token.

export interface PushMessage {
  /** The phone's Expo push token. */
  to: string
  /** Whose phone, as `rider:<id>`: never sent to Expo, only what the local stand-in prints in place of the token. */
  subject: string
  title: string
  body: string
  data: Readonly<Record<string, string>>
}

/** Per message, in order: Expo's ticket id, or its error code (`DeviceNotRegistered`); both null when the answer was unreadable. */
export interface PushTicket {
  id: string | null
  error: string | null
}

/** Per ticket id answered: null when delivered to Apple or Google, else Expo's error code. A missing id isn't ready yet. */
export type PushReceipts = ReadonlyMap<string, string | null>

export interface ExpoPush {
  send: (messages: readonly PushMessage[], signal?: AbortSignal) => Promise<PushTicket[]>
  receipts: (ids: readonly string[], signal?: AbortSignal) => Promise<PushReceipts>
}

/** Expo's own limits: messages per send, and the SDK's receipt ids per call. */
export const maxPushMessages = 100
export const maxReceiptIds = 300
/** Under the relay's 10 seconds a row (outbox-relay.ts). */
export const expoPushTimeoutMs = 8_000

/** No answer, throttled, failed itself or refused our credential: the outbox tries again later. */
export class ExpoPushUnavailable extends Error {
  override name = 'ExpoPushUnavailable'
}

/** Expo refused the request itself; `code` is Expo's, safe to log. */
export class ExpoPushRefused extends Error {
  override name = 'ExpoPushRefused'
  constructor(readonly code: string) {
    super(`push refused: ${code}`)
  }
}

export const notRegistered = 'DeviceNotRegistered'

const outcome = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), id: z.string().min(1).optional() }).loose(),
  z.object({ status: z.literal('error'), details: z.object({ error: z.string().max(64).optional() }).loose().optional() }).loose(),
])
const ticketsSchema = z.object({ data: z.array(z.unknown()) }).loose()
const receiptsSchema = z.object({ data: z.record(z.string(), z.unknown()) }).loose()
const refusalSchema = z.object({ errors: z.array(z.object({ code: z.string().max(64) }).loose()).min(1) }).loose()

const ticketOf = (raw: unknown): PushTicket => {
  const parsed = outcome.safeParse(raw)
  if (!parsed.success) return { id: null, error: null }
  return parsed.data.status === 'ok' ? { id: parsed.data.id ?? null, error: null } : { id: null, error: parsed.data.details?.error ?? 'error' }
}

export const expoPushClient = ({ token, fetchImpl = fetch }: { token: string; fetchImpl?: typeof fetch }): ExpoPush => {
  const call = async (path: string, body: unknown, signal: AbortSignal | undefined): Promise<unknown> => {
    const timeout = AbortSignal.timeout(expoPushTimeoutMs)
    let response: Response
    try {
      response = await fetchImpl(`https://exp.host/--/api/v2/push/${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    } catch {
      throw new ExpoPushUnavailable('no answer')
    }
    const json: unknown = await response.json().catch(() => null)
    // A refused access token is ours to fix: retried, never dropped.
    if (response.status >= 500 || [401, 403, 429].includes(response.status)) throw new ExpoPushUnavailable(`answered ${response.status}`)
    if (!response.ok) {
      const refusal = refusalSchema.safeParse(json)
      throw new ExpoPushRefused(refusal.success ? `expo_${refusal.data.errors[0]?.code ?? response.status}` : `expo_${response.status}`)
    }
    return json
  }

  return {
    send: async (messages, signal) => {
      const tickets: PushTicket[] = []
      for (let i = 0; i < messages.length; i += maxPushMessages) {
        const chunk = messages.slice(i, i + maxPushMessages)
        const json = await call('send', chunk.map((m) => ({ to: m.to, title: m.title, body: m.body, data: m.data, sound: 'default' })), signal)
        // A 2xx is Expo taking the messages: an unreadable answer still counts as sent, so nothing goes twice.
        const answered = ticketsSchema.safeParse(json)
        tickets.push(...chunk.map((_, n) => ticketOf(answered.success ? answered.data.data[n] : null)))
      }
      return tickets
    },
    receipts: async (ids, signal) => {
      const receipts = new Map<string, string | null>()
      for (let i = 0; i < ids.length; i += maxReceiptIds) {
        const answered = receiptsSchema.safeParse(await call('getReceipts', { ids: ids.slice(i, i + maxReceiptIds) }, signal))
        if (!answered.success) throw new ExpoPushUnavailable('unreadable receipts')
        for (const [id, raw] of Object.entries(answered.data.data)) {
          const parsed = outcome.safeParse(raw)
          receipts.set(id, !parsed.success ? 'unreadable' : parsed.data.status === 'ok' ? null : (parsed.data.details?.error ?? 'error'))
        }
      }
      return receipts
    },
  }
}
