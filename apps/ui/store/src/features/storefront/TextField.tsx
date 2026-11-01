import { useId } from 'react'
import { fill, formatCount, messages } from '../../messages'
import { PhoneInput } from '../common/PhoneInput'

const words = messages.storefront.brand

export interface TextFieldProps {
  label: string
  value: string
  onValue: (value: string) => void
  readOnly: boolean
  max: number
  help?: string | undefined
  problem?: string | null | undefined
  required?: boolean
  multiline?: boolean
  /** Shows "12 / 100" beside the label. */
  counted?: boolean
  placeholder?: string
  type?: 'text' | 'email' | 'tel'
  autoComplete?: string
  wide?: boolean
}

/** One labelled field of the brand, with its help or its refusal under it. */
export const TextField = ({ label, value, onValue, readOnly, max, help, problem, required = false, multiline = false, counted = false, placeholder, type = 'text', autoComplete, wide = false }: TextFieldProps) => {
  const id = useId()
  const below = problem ?? help
  const shared = {
    id,
    value,
    readOnly,
    maxLength: max,
    placeholder,
    autoComplete,
    required: required || undefined,
    'aria-invalid': problem ? true : undefined,
    'aria-describedby': below ? `${id}-below` : undefined,
  }
  return (
    <div className={wide ? 'df-sf-field df-sf-field--wide' : 'df-sf-field'}>
      <span className="df-sf-field-head">
        <label htmlFor={id}>
          {label}
          {required && <span className="df-sf-required">{words.required}</span>}
        </label>
        {counted && <span className="df-sf-count">{fill(words.count, { count: formatCount(value.length), limit: formatCount(max) })}</span>}
      </span>
      {multiline ? (
        <textarea rows={3} {...shared} onChange={(e) => onValue(e.target.value)} />
      ) : type === 'tel' ? (
        <PhoneInput {...shared} onValue={onValue} invalid={Boolean(problem)} />
      ) : (
        <input type={type} {...shared} onChange={(e) => onValue(e.target.value)} />
      )}
      {below && (
        <span id={`${id}-below`} className={problem ? 'df-sf-problem' : 'df-sf-help'} role={problem ? 'alert' : undefined}>
          {below}
        </span>
      )}
    </div>
  )
}
