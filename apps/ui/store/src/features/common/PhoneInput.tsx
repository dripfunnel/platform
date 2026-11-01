import { useState, type InputHTMLAttributes } from 'react'
import { locale, messages } from '../../messages'
import { browserCountry, countryOptions, joinPhone, splitPhone } from './phone'
import './phone.css'

export interface PhoneInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'prefix'> {
  value: string
  /** E.164 with no spaces, as the API takes it. */
  onValue: (value: string) => void
  /** The country a new number starts in; the browser's by default. */
  country?: string | undefined
  invalid?: boolean | undefined
}

/** A mobile number as a country code dropdown and the number; the field around it gives the label and the border. */
export const PhoneInput = ({ value, onValue, country, invalid, readOnly, disabled, ...input }: PhoneInputProps) => {
  const [picked, setPicked] = useState<string | null>(null)
  const split = splitPhone(value, picked ?? country ?? browserCountry())
  return (
    <span className="df-phone">
      <select
        aria-label={messages.phone.countryCode}
        value={split.country}
        disabled={readOnly || disabled}
        onChange={(event) => {
          setPicked(event.target.value)
          onValue(joinPhone(event.target.value, split.national))
        }}
      >
        {split.country ? null : <option value="">+</option>}
        {/* The chosen code alone fits the closed dropdown; the list names each country for finding it by typing. */}
        {countryOptions(locale).map((o) => (
          <option key={o.country} value={o.country}>
            {o.country === split.country ? `+${o.dial}` : `${o.name} (+${o.dial})`}
          </option>
        ))}
      </select>
      <input
        inputMode="tel"
        autoComplete="tel"
        maxLength={20}
        {...input}
        type="tel"
        value={split.national}
        readOnly={readOnly}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(event) => onValue(joinPhone(split.country, event.target.value))}
      />
    </span>
  )
}
