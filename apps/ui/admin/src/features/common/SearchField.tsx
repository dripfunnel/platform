import { useEffect, useId, useState } from 'react'
import { searchMaxLength } from './searchParams'
import './list.css'

// Waits for a pause in typing, so each keystroke doesn't become a request.
const searchDelayMs = 300

export interface SearchFieldProps {
  label: string
  placeholder: string
  value: string | undefined
  onChange: (value: string | undefined) => void
}

export const SearchField = ({ label, placeholder, value, onChange }: SearchFieldProps) => {
  const id = useId()
  const [typed, setTyped] = useState(value ?? '')

  useEffect(() => setTyped(value ?? ''), [value])

  useEffect(() => {
    const q = typed.trim()
    if (q === (value ?? '')) return
    const timer = setTimeout(() => onChange(q === '' ? undefined : q), searchDelayMs)
    return () => clearTimeout(timer)
  }, [typed, value, onChange])

  return (
    <label className="df-list-search" htmlFor={id}>
      <span className="df-visually-hidden">{label}</span>
      <input id={id} type="search" maxLength={searchMaxLength} value={typed} placeholder={placeholder} onChange={(event) => setTyped(event.target.value)} />
    </label>
  )
}
