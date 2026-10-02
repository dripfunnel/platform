import type { PlanPrice } from '../../api/plans'
import { fill, formatAmount, messages } from '../../messages'
import { minorOf, type PlanDraft } from './planDraft'

const words = messages.plans.editor

export interface PriceRowsProps {
  draft: PlanDraft
  quoted: readonly PlanPrice[]
  disabled: boolean
  onChange: (currency: string, field: 'monthly' | 'yearly', text: string) => void
}

const Margin = ({ price }: { price: PlanPrice | undefined }) => {
  if (!price || price.margin.kind === 'unpriced') return <span className="df-muted">{words.addPrice}</span>
  if (price.margin.kind === 'loss') return <strong className="df-margin df-margin--loss">{fill(words.loss, { amount: formatAmount(price.margin.amount) })}</strong>
  return <strong className="df-margin df-margin--keep">{fill(words.keep, { amount: formatAmount(price.margin.amount), of: formatAmount(price.margin.of) })}</strong>
}

// Prices per currency (§7.2): what merchants pay, with DripFunnel's fee and the margin the API quotes beside each.
export const PriceRows = ({ draft, quoted, disabled, onChange }: PriceRowsProps) => (
  <section className="df-panel df-editor-card" aria-labelledby="plan-prices">
    <div className="df-stack">
      <h2 id="plan-prices">{words.prices}</h2>
      <span className="df-muted">{words.pricesSub}</span>
    </div>
    {Object.entries(draft.prices).map(([currency, price]) => {
      const quote = quoted.find((candidate) => candidate.currency === currency)
      const invalid = minorOf(price.monthly, currency) === 'invalid' || minorOf(price.yearly, currency) === 'invalid'
      return (
        <div key={currency} className="df-price-row">
          <strong className="df-price-currency">{currency}</strong>
          <div className="df-field">
            <label htmlFor={`price-${currency}-monthly`}>{fill(words.monthly, { currency })}</label>
            <input id={`price-${currency}-monthly`} inputMode="decimal" value={price.monthly} placeholder={messages.plans.unpriced} disabled={disabled} aria-invalid={minorOf(price.monthly, currency) === 'invalid'} onChange={(event) => onChange(currency, 'monthly', event.target.value)} />
          </div>
          <div className="df-field">
            <label htmlFor={`price-${currency}-yearly`}>{fill(words.yearly, { currency })}</label>
            <input id={`price-${currency}-yearly`} inputMode="decimal" value={price.yearly} placeholder={messages.plans.unpriced} disabled={disabled} aria-invalid={minorOf(price.yearly, currency) === 'invalid'} onChange={(event) => onChange(currency, 'yearly', event.target.value)} />
          </div>
          <div className="df-stack df-price-notes">
            {quote && <span className="df-muted">{fill(quote.converted ? words.feeConverted : words.fee, { fee: formatAmount(quote.fee) })}</span>}
            {invalid ? <strong className="df-margin df-margin--loss">{words.priceInvalid}</strong> : <Margin price={quote} />}
          </div>
        </div>
      )
    })}
  </section>
)
