import { fill, messages } from '../../messages'

export interface FileCurrencies {
  pricing: string | null
  others: string[]
}

/** The currency to send: only a choice other than the store's own, which is the ordinary import. */
export const currencyToSend = (chosen: string | null, currencies: FileCurrencies): string | null => (chosen !== null && chosen !== currencies.pricing ? chosen : null)

/** Which currency a file's prices are in, when the store has others to choose from; nothing otherwise. */
export const CurrencyChoice = ({ currencies, chosen, copy, disabled, onChange }: { currencies: FileCurrencies; chosen: string | null; copy: { label: string; hint: string }; disabled: boolean; onChange: (code: string) => void }) => {
  const choices = currencies.pricing ? [currencies.pricing, ...currencies.others] : []
  if (choices.length < 2) return null
  return (
    <label className="df-import-place">
      <span>{copy.label}</span>
      <select aria-label={copy.label} disabled={disabled} value={chosen ?? currencies.pricing ?? ''} onChange={(event) => onChange(event.target.value)}>
        {choices.map((code) => (
          <option key={code} value={code}>
            {code === currencies.pricing ? fill(messages.imports.shopifyCsv.currency.own, { code }) : code}
          </option>
        ))}
      </select>
      <span className="df-import-hint">{copy.hint}</span>
    </label>
  )
}
