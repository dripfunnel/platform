import type { PaymentRead } from '../../../api/cart'

/** How long the app waits for a payment to be confirmed after its sheet closes: a short poll with a limit, then it says it is still confirming. */
export const settleEveryMs = 2_000
export const settleLimitMs = 30_000

export type Clock = { now: () => number; wait: (ms: number) => Promise<void> }
export const realClock: Clock = { now: () => Date.now(), wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }

export type Settled = 'paid' | 'cancelled' | 'pending'

/**
 * Reads the order until the provider's webhook has marked it paid (the read also asks the provider, as on the website), the order was
 * cancelled, or the limit is reached. A read that fails (no signal) is simply asked again: it neither pays nor fails the order.
 */
export const settle = async (read: () => Promise<PaymentRead | null>, clock: Clock = realClock, everyMs = settleEveryMs, limitMs = settleLimitMs): Promise<Settled> => {
  const started = clock.now()
  for (;;) {
    const seen = await read().catch(() => null)
    if (seen?.paid) return 'paid'
    if (seen?.cancelled) return 'cancelled'
    if (clock.now() - started >= limitMs) return 'pending'
    await clock.wait(everyMs)
  }
}
