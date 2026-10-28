import type { PaymentRead, PaymentStart } from '../../../api/cart'
import type { Outcome, Shown } from './outcome'
import { presentCashfree } from './cashfree'
import { presentPaypal } from './paypal'
import { presentPhonePe } from './phonepe'
import { presentRazorpay } from './razorpay'
import { realClock, settle, type Clock } from './settle'
import { presentStripe, type SheetFacts } from './stripe'

export type Present = (provider: string, start: PaymentStart, facts: SheetFacts) => Promise<Shown>

/** The provider's own sheet for the way chosen. */
export const presentSheet: Present = async (provider, start, facts) => {
  switch (provider) {
    case 'stripe':
      return presentStripe(start, facts)
    case 'paypal':
      return presentPaypal(start, facts.build.scheme)
    case 'razorpay':
      return presentRazorpay(start, facts)
    case 'cashfree':
      return presentCashfree(start)
    case 'phonepe':
      return presentPhonePe(start, facts)
    default:
      return 'unavailable'
  }
}

export type PayDeps = { present?: Present; read: () => Promise<PaymentRead | null>; clock?: Clock; everyMs?: number; limitMs?: number; /** Called once the sheet has closed well, before the order is read back. */ settling?: () => void }

/**
 * One attempt to pay a placed order: the sheet, then the order read until the webhook marks it paid.
 * Unconfirmed in time is `pending`: the shopper must not pay again.
 */
export const pay = async (provider: string, start: PaymentStart, facts: SheetFacts, deps: PayDeps): Promise<Outcome> => {
  const shown = await (deps.present ?? presentSheet)(provider, start, facts).catch((): Shown => 'unavailable')
  if (shown !== 'done') return { kind: 'stopped', reason: shown }
  deps.settling?.()
  const settled = await settle(deps.read, deps.clock ?? realClock, deps.everyMs, deps.limitMs)
  if (settled === 'paid') return { kind: 'paid' }
  return settled === 'cancelled' ? { kind: 'stopped', reason: 'orderCancelled' } : { kind: 'pending' }
}
