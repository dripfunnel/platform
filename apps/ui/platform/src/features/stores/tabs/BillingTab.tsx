import { StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import type { Store, StoreBilling } from '../../../api/stores'
import { fill, formatAmount, formatDate, messages } from '../../../messages'

const words = messages.store.billing

const paymentLook: Record<StoreBilling['payment'], { tone: StatusTone; icon: StatusIconName }> = {
  paid: { tone: 'success', icon: 'ok' },
  failed: { tone: 'danger', icon: 'cross' },
  noCard: { tone: 'info', icon: 'hour' },
}

const nextText = (next: StoreBilling['next']) =>
  next.kind === 'firstCharge' ? fill(words.firstCharge, { date: formatDate(next.at) }) : next.kind === 'charge' ? formatDate(next.at) : words.noCharge

// Billing (§6.3): the subscription as the API states it, who charges, and the invoices. Never a card number.
export const BillingTab = ({ store }: { store: Store }) => {
  const { billing } = store
  return (
    <div className="df-panels">
      <section className="df-panel" aria-labelledby="store-subscription">
        <h2 id="store-subscription">{words.subscription}</h2>
        <p className="df-billing-by">{billing.mode === 'own' ? words.byYou : fill(words.byDripFunnel, { who: billing.chargedBy })}</p>
        <dl className="df-facts">
          <dt>{words.plan}</dt>
          <dd>{fill(words.cycle[billing.cycle], { plan: store.plan.name })}</dd>
          <dt>{words.priceLabel}</dt>
          <dd>
            <strong>{fill(words.price[billing.cycle], { price: formatAmount(billing.price) })}</strong>
          </dd>
          <dt>{words.next}</dt>
          <dd>{nextText(billing.next)}</dd>
          <dt>{words.payment}</dt>
          <dd>
            <StatusPill {...paymentLook[billing.payment]} label={words.payments[billing.payment]} />
          </dd>
          <dt>{words.card}</dt>
          <dd>{billing.cardLast4 ? fill(words.cardEnding, { last4: billing.cardLast4 }) : words.noCard}</dd>
        </dl>
      </section>
      <section className="df-panel" aria-labelledby="store-invoices">
        <h2 id="store-invoices">{words.invoices}</h2>
        {store.invoices.length === 0 ? (
          <p className="df-muted">{words.noInvoices}</p>
        ) : (
          <ul className="df-rows">
            {store.invoices.map((invoice) => (
              <li key={invoice.id}>
                <code className="df-invoice-id">{invoice.id}</code>
                <span className="df-muted">{formatDate(invoice.at)}</span>
                <strong>{formatAmount(invoice.amount)}</strong>
                <StatusPill tone={invoice.status === 'paid' ? 'success' : 'danger'} icon={invoice.status === 'paid' ? 'ok' : 'cross'} label={words.invoiceStatus[invoice.status]} />
                {invoice.cardLast4 && <span className="df-muted">{fill(words.cardEnding, { last4: invoice.cardLast4 })}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
