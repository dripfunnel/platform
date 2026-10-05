import type postgres from 'postgres'
import type { OutboxRow } from '#db/schema/outbox'
import { withSystemScope } from '#db/scoped/index'
import { claimDue, markAttemptFailed, markDelivered, markPostponed, redactOutboxPayload } from '#db/scoped/outbox'
import { NotYet } from '#saas/outbox/index'

export interface Effect {
  id: string
  kind: string
  /** Hand it to the provider too, so a redelivery after a crash is still one effect. */
  idempotencyKey: string
  payload: unknown
  partnerId: string | null
  storeId: string | null
  attempt: number
}

export interface Deliverer {
  deliver: (effect: Effect, signal: AbortSignal) => Promise<void>
  /** What of the payload stays once the row is delivered or given up, written with that outcome. */
  redact?: (payload: unknown) => Record<string, unknown>
}

export type Deliverers = Readonly<Record<string, Deliverer>>

export interface RelayOptions {
  now: () => Date
  timeoutMs: number
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  leaseMs: number
  batch: number
}

export const defaultRelayOptions: RelayOptions = {
  now: () => new Date(),
  timeoutMs: 10_000,
  maxAttempts: 8,
  baseDelayMs: 30_000,
  maxDelayMs: 6 * 60 * 60 * 1000,
  leaseMs: 5 * 60 * 1000,
  batch: 50,
}

export type Outcome = 'delivered' | 'retry' | 'dead' | 'dropped' | 'skipped'

/** Thrown by a deliverer that will never deliver this row: given up at once, under `code`, never retried. */
export class GiveUp extends Error {
  constructor(readonly code: string) {
    super(`given up: ${code}`)
    this.name = 'GiveUp'
  }
}

/** Doubles per failed attempt, from the base to the cap. */
export const backoffMs = (attempts: number, base: number, max: number): number =>
  Math.min(max, base * 2 ** Math.max(0, attempts - 1))

class DeliveryTimeout extends Error {
  constructor() {
    super('delivery timed out')
    this.name = 'DeliveryTimeout'
  }
}

// Raced, not only signalled: a deliverer that ignores the signal must still not hold the
// relay past the timeout.
const withTimeout = <T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> => {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new DeliveryTimeout()
      controller.abort(error)
      reject(error)
    }, ms)
  })
  return Promise.race([work(controller.signal), expiry]).finally(() => clearTimeout(timer))
}

const effectOf = (row: OutboxRow): Effect => ({
  id: row.id,
  kind: row.kind,
  idempotencyKey: row.idempotency_key,
  payload: row.payload,
  partnerId: row.partner_id,
  storeId: row.store_id,
  attempt: row.attempts,
})

const settle = async (sql: postgres.Sql, row: OutboxRow, deliverer: Deliverer, opts: RelayOptions): Promise<Outcome> => {
  const now = opts.now()
  try {
    await withTimeout((signal) => deliverer.deliver(effectOf(row), signal), opts.timeoutMs)
  } catch (error) {
    if (error instanceof NotYet) {
      await withSystemScope(sql, (tx) => markPostponed(tx, row.id, { error: error.code, nextAttemptAt: new Date(now.getTime() + error.retryAfterMs) }))
      return 'retry'
    }
    const dropped = error instanceof GiveUp
    const dead = dropped || row.attempts >= opts.maxAttempts
    const delay = backoffMs(row.attempts, opts.baseDelayMs, opts.maxDelayMs)
    await withSystemScope(sql, async (tx) => {
      await markAttemptFailed(tx, row.id, {
        // A code, never the error's words: a provider message can carry an address or a name.
        error: dropped ? error.code : error instanceof DeliveryTimeout ? 'timeout' : 'failed',
        nextAttemptAt: new Date(now.getTime() + delay),
        dead,
        now,
      })
      if (dead && deliverer.redact) await redactOutboxPayload(tx, row.id, deliverer.redact(row.payload))
    })
    return dropped ? 'dropped' : dead ? 'dead' : 'retry'
  }
  const first = await withSystemScope(sql, async (tx) => {
    const marked = await markDelivered(tx, row.id, opts.now())
    if (marked && deliverer.redact) await redactOutboxPayload(tx, row.id, deliverer.redact(row.payload))
    return marked
  })
  return first ? 'delivered' : 'skipped'
}

/**
 * Everything due that a registered deliverer can take, from the schedule (api/README.md §5).
 * A per-row path fed by a queue message is added by the first effect that needs the latency.
 */
export const relayDue = async (sql: postgres.Sql, deliverers: Deliverers, opts: RelayOptions = defaultRelayOptions): Promise<Record<Outcome, number>> => {
  const counts: Record<Outcome, number> = { delivered: 0, retry: 0, dead: 0, dropped: 0, skipped: 0 }
  const kinds = Object.keys(deliverers)
  if (kinds.length === 0) return counts
  const rows = await withSystemScope(sql, (tx) => claimDue(tx, kinds, opts.now(), opts.batch, opts.leaseMs))
  for (const row of rows) {
    const deliverer = deliverers[row.kind]
    if (deliverer) counts[await settle(sql, row, deliverer, opts)] += 1
  }
  return counts
}
