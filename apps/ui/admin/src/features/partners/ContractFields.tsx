import { useId } from 'react'
import { poweredByTerms, type PartnerContract } from '../../api/partners'
import { messages } from '../../messages'
import { currencyName, partnerCurrencies } from './partnerCurrencies'
import './partners.css'

const words = messages.partner.contract

export interface ContractFieldsProps {
  value: PartnerContract
  onChange: (value: PartnerContract) => void
}

// The contract's three terms, for the Set contract dialog and the Create partner form.
export const ContractFields = ({ value, onChange }: ContractFieldsProps) => {
  const feeId = useId()
  const feeHintId = useId()
  const others = partnerCurrencies.filter((code) => code !== value.feeCurrency)
  const toggle = (code: string, on: boolean) =>
    onChange({ ...value, currencies: on ? partnerCurrencies.filter((c) => c === code || value.currencies.includes(c)) : value.currencies.filter((c) => c !== code) })

  return (
    <>
      <div className="df-field">
        <label htmlFor={feeId}>{words.feeCurrency}</label>
        <select
          id={feeId}
          aria-describedby={feeHintId}
          value={value.feeCurrency}
          onChange={(event) => onChange({ ...value, feeCurrency: event.target.value, currencies: value.currencies.filter((c) => c !== event.target.value) })}
        >
          {partnerCurrencies.map((code) => (
            <option key={code} value={code}>
              {currencyName(code)}
            </option>
          ))}
        </select>
        <p id={feeHintId} className="df-field-hint">
          {words.feeCurrencyHint}
        </p>
      </div>
      <fieldset className="df-choices">
        <legend>{words.currencies}</legend>
        <p className="df-field-hint">{words.currenciesHint}</p>
        <div className="df-currency-grid">
          {others.map((code) => (
            <label key={code} className="df-choice">
              <input type="checkbox" checked={value.currencies.includes(code)} onChange={(event) => toggle(code, event.target.checked)} />
              <span className="df-choice-label">{currencyName(code)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="df-choices">
        <legend>{words.poweredBy}</legend>
        {poweredByTerms.map((term) => (
          <label key={term} className="df-choice">
            <input type="radio" name={`${feeId}-powered`} checked={value.poweredBy === term} onChange={() => onChange({ ...value, poweredBy: term })} />
            <span className="df-choice-label">{words.poweredByTerms[term]}</span>
          </label>
        ))}
      </fieldset>
    </>
  )
}
