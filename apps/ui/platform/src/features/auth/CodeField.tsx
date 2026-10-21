import { useId } from 'react'
import { messages } from '../../messages'

const words = messages.auth

// The 6-digit authenticator code: numeric keypad, one-time-code autofill, digits only.
export const CodeField = ({ value, onChange, disabled = false }: { value: string; onChange: (code: string) => void; disabled?: boolean }) => {
  const id = useId()
  return (
    <div className="df-field">
      <label htmlFor={id}>{words.codeLabel}</label>
      <input
        id={id}
        className="df-code-input"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder={words.codePlaceholder}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
      />
    </div>
  )
}
