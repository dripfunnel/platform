import { useState } from 'react'
import { locale, messages } from '../../messages'
import { browserCountry, countryOptions, joinPhone, splitPhone } from './phone'
import './phone.css'

export interface PhoneInputProps {
  id?: string | undefined
  value: string
  /** One value, `+` and the calling code first, as the API takes it. */
  onValue: (value: string) => void
  /** The country a new number starts in; the browser's by default. */
  country?: string | undefined
  readOnly?: boolean | undefined
  invalid?: boolean | undefined
  describedBy?: string | undefined
  placeholder?: string | undefined
  autoComplete?: string | undefined
}

/** A mobile number as a country code dropdown and the number; the field around it gives the label and the border. */
export const PhoneInput = ({ id, value, onValue, country, readOnly, invalid, describedBy, placeholder, autoComplete = 'tel' }: PhoneInputProps) => {
  const [picked, setPicked] = useState<string | null>(null)
  const split = splitPhone(value, picked ?? country ?? browserCountry())
  return (
    <span className="df-phone">
      <select
        aria-label={messages.phone.countryCode}
        value={split.country}
        disabled={readOnly}
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
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete={autoComplete}
        maxLength={20}
        value={split.national}
        placeholder={placeholder}
        readOnly={readOnly}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => onValue(joinPhone(split.country, event.target.value))}
      />
    </span>
  )
}
