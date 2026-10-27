import type { PaymentRead, PaymentStart } from '../../../api/cart'
import type { Outcome, Shown } from './outcome'
import { presentPaypal } from './paypal'
import { realClock, settle, type Clock } from './settle'
import { presentStripe, type SheetFacts } from './stripe'

export type Present = (provider: string, start: PaymentStart, facts: SheetFacts) => Promise<Shown>

/** The provider's own sheet for the way chosen: Stripe's Payment Sheet, or PayPal's approval page. */
export const presentSheet: Present = (provider, start, facts) => (provider === 'paypal' ? presentPaypal(start, facts.build.scheme) : presentStripe(start, facts))

export type PayDeps = { present?: Present; read: () => Promise<PaymentRead | null>; clock?: Clock; everyMs?: number; limitMs?: number; /** Called once the sheet has closed well, before the order is read back. */ settling?: () => void }

/**
 * One attempt to pay an order that is already placed: show the sheet, and when it closes without error read the order until the webhook
 * marks it paid. A closed or failed sheet stops here with its reason and places nothing; a sheet that closed but whose payment is not
 * confirmed in time is `pending`, and the shopper must not pay again.
 */
export const pay = async (provider: string, start: PaymentStart, facts: SheetFacts, deps: PayDeps): Promise<Outcome> => {
  const shown = await (deps.present ?? presentSheet)(provider, start, facts).catch((): Shown => 'unavailable')
  if (shown !== 'done') return { kind: 'stopped', reason: shown }
  deps.settling?.()
  const settled = await settle(deps.read, deps.clock ?? realClock, deps.everyMs, deps.limitMs)
  if (settled === 'paid') return { kind: 'paid' }
  return settled === 'cancelled' ? { kind: 'stopped', reason: 'declined' } : { kind: 'pending' }
}
