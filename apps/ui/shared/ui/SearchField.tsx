import { useEffect, useId, useState } from 'react'
import { searchMaxLength } from '../search/searchMaxLength'
import './list.css'

// Waits for a pause in typing, so each keystroke doesn't become a request.
const searchDelayMs = 300

export interface SearchFieldProps {
  label: string
  placeholder: string
  value: string | undefined
  onChange: (value: string | undefined) => void
  // Shown inside the field, as the prototype draws a filter's name, rather than read out only.
  labelVisible?: boolean
  // The error for text the URL wouldn't keep, or null; such text is never sent.
  validate?: (value: string) => string | null
}

export const SearchField = ({ label, placeholder, value, onChange, labelVisible = false, validate }: SearchFieldProps) => {
  const id = useId()
  const errorId = `${id}-error`
  const [typed, setTyped] = useState(value ?? '')
  const q = typed.trim()
  const error = q === '' || !validate ? null : validate(q)

  useEffect(() => setTyped(value ?? ''), [value])

  useEffect(() => {
    if (q === (value ?? '') || error !== null) return
    const timer = setTimeout(() => onChange(q === '' ? undefined : q), searchDelayMs)
    return () => clearTimeout(timer)
  }, [q, error, value, onChange])

  return (
    <span className="df-list-search-field">
      <label className={labelVisible ? 'df-list-search df-list-search--labelled' : 'df-list-search'} htmlFor={id}>
        <span className={labelVisible ? 'df-list-search-label' : 'df-visually-hidden'}>{label}</span>
        <input
          id={id}
          type="search"
          maxLength={searchMaxLength}
          value={typed}
          placeholder={placeholder}
          aria-invalid={error !== null}
          aria-describedby={error !== null ? errorId : undefined}
          onChange={(event) => setTyped(event.target.value)}
        />
      </label>
      {error !== null && (
        <span id={errorId} className="df-list-search-error">
          {error}
        </span>
      )}
    </span>
  )
}
