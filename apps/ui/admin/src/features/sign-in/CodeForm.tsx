import { useId, useState } from 'react'
import { messages } from '../../messages'
import '@dripfunnel/shared/ui/states.css'
import './signIn.css'

const words = messages.signIn.states.code

export const CodeForm = ({ onVerify, onSendToPhone }: { onVerify: () => void; onSendToPhone: () => void }) => {
  const [code, setCode] = useState('')
  const inputId = useId()
  const hintId = useId()
  const complete = /^\d{6}$/.test(code)

  return (
    <form
      className="df-sign-in-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (complete) onVerify()
      }}
    >
      <div className="df-field">
        <label htmlFor={inputId}>{words.codeLabel}</label>
        <input
          id={inputId}
          className="df-code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder={words.codePlaceholder}
          aria-describedby={hintId}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        <p id={hintId} className="df-field-hint">
          {words.codeHint}
        </p>
      </div>
      <button
        type="submit"
        className="df-button df-button--primary df-sign-in-submit"
        disabled={!complete}
        aria-describedby={complete ? undefined : hintId}
      >
        {words.verify}
      </button>
      <button type="button" className="df-sign-in-link" onClick={onSendToPhone}>
        {words.sendToPhone}
      </button>
    </form>
  )
}
