import { finishStripeConnect } from '../../api/payments'
import { messages } from '../../messages'
import { refusalIn } from '../common/refusal'

// The way back from Stripe (apps/api/src/hooks/stripeConnect.ts): `/settings/payments?stripe=finish&key=…`, or
// `stripe=cancelled` / `stripe=failed`.

export const stripeAnswers = ['finish', 'cancelled', 'failed'] as const
export const stripeKeyPattern = /^[0-9a-f]{64}$/

export type StripeBack = { kind: 'finish'; key: string } | { kind: 'cancelled' } | { kind: 'failed' }
export type StripeOutcome = { kind: 'connected' } | { kind: 'cancelled' } | { kind: 'failed' } | { kind: 'refused'; text: string }

export const stripeBackOf = (stripe: (typeof stripeAnswers)[number] | undefined, key: string | undefined): StripeBack | null => {
  if (stripe === 'finish') return key ? { kind: 'finish', key } : { kind: 'failed' }
  return stripe ? { kind: stripe } : null
}

const refusalOf = refusalIn(messages.settings.payments.refused)
const finishing = new Map<string, Promise<StripeOutcome>>()

/** Each one-time key is sent once, however often the tab mounts (React's strict mode mounts it twice). */
export const stripeOutcome = (back: StripeBack): Promise<StripeOutcome> => {
  if (back.kind !== 'finish') return Promise.resolve(back)
  const known = finishing.get(back.key)
  if (known) return known
  const started = finishStripeConnect(back.key).then(
    (): StripeOutcome => ({ kind: 'connected' }),
    (error: unknown): StripeOutcome => ({ kind: 'refused', text: refusalOf(error) }),
  )
  finishing.set(back.key, started)
  return started
}
