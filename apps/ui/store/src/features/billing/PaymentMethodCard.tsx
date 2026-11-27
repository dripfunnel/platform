import type { PlanPayments, Subscription } from '../../api/billing'
import { fill, messages } from '../../messages'
import { cardText } from './billingView'

const words = messages.billing.card

// Card that pays for your plan (PortalBilling; #1744): on a partner's own billing, the card or UPI AutoPay its Razorpay
// subscription charges, saved with the first plan payment. Changing it isn't offered yet (decided on #1744).
export const PaymentMethodCard = ({ sub, payments }: { sub: Subscription; payments: PlanPayments }) => {
  const own = sub.collectedBy === 'partner'
  const saved = sub.paymentMethod ?? (sub.card ? cardText(sub.card) : null)
  const note = !own ? words.note : payments.available ? fill(words.paidTo, { partner: sub.partnerName }) : fill(words.unavailable, { partner: sub.partnerName })
  return (
    <section className="df-billing-card" aria-labelledby="df-billing-card">
      <h2 id="df-billing-card">{words.title}</h2>
      <p className="df-billing-strong">{saved ?? words.none}</p>
      {payments.mode === 'test' && <p className="df-billing-note">{words.testMode}</p>}
      <p className="df-billing-note">{note}</p>
      {own && payments.available && !saved && <p className="df-billing-note">{words.savedWithPlan}</p>}
    </section>
  )
}
