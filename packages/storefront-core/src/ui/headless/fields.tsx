'use client'

import { useEffect, useId, useState, type ReactNode } from 'react'

// The form controls a theme skins (ARCHITECTURE §2.1 `ui/headless`): a theme may not write <form>, <input> or <select>
// (§3.4), so core renders them, unstyled, with the theme's classes and words.

type Styled = { className?: string }

/** A checkbox inside its label, such as one filter value. */
export const Checkbox = ({ checked, onChange, children, className }: Styled & { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) => (
  <label className={className}>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> <span>{children}</span>
  </label>
)

/** A labelled choice of one option, such as the sort. */
export const Select = <V extends string>({ label, value, options, onChange, className }: Styled & { label: string; value: V; options: readonly { value: V; label: string }[]; onChange: (value: V) => void }) => {
  const id = useId()
  return (
    <span className={className}>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(options.find((o) => o.value === e.target.value)?.value ?? value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  )
}

/** A search box that hands its words over on submit; the page's own search runs there, nothing is posted. */
export const SearchField = ({ label, placeholder, button, value, onSearch, className }: Styled & { label: string; placeholder?: string; button: string; value: string; onSearch: (words: string) => void }) => {
  const id = useId()
  const [words, setWords] = useState(value)
  useEffect(() => setWords(value), [value])
  return (
    <form
      action="/search/"
      role="search"
      className={className}
      onSubmit={(e) => {
        e.preventDefault()
        onSearch(words)
      }}
    >
      <label htmlFor={id}>{label}</label>
      <input id={id} type="search" name="q" value={words} placeholder={placeholder} maxLength={200} autoComplete="off" onChange={(e) => setWords(e.target.value)} />
      <button type="submit">{button}</button>
    </form>
  )
}

/**
 * A code to apply, such as a discount code: trimmed, handed to `onApply`, and cleared once it worked; nothing is posted.
 * `message` is what the last try answered; `refused` announces it as an error.
 */
export const CodeField = ({ label, button, onApply, message, refused = false, className }: Styled & { label: string; button: string; onApply: (code: string) => Promise<boolean>; message?: string | null; refused?: boolean }) => {
  const id = useId()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault()
        const value = code.trim()
        if (!value || busy) return
        setBusy(true)
        onApply(value)
          .then((worked) => {
            if (worked) setCode('')
          })
          .catch(() => undefined)
          .finally(() => setBusy(false))
      }}
    >
      <label htmlFor={id}>{label}</label>
      <input id={id} type="text" value={code} maxLength={60} autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-invalid={message && refused ? true : undefined} aria-describedby={message ? `${id}-message` : undefined} onChange={(e) => setCode(e.target.value)} />
      <button type="submit" disabled={busy}>
        {button}
      </button>
      {message ? (
        <p id={`${id}-message`} role={refused ? 'alert' : 'status'}>
          {message}
        </p>
      ) : null}
    </form>
  )
}
