import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import './searchSelect.css'

export interface SearchOption {
  id: string
  label: string
}

export interface SearchSelectProps {
  options: readonly SearchOption[]
  value: string | null
  onChange: (id: string) => void
  /** The visible label's id; the field takes its name from it. */
  labelledBy: string
  placeholder: string
  noMatches: string
  disabled?: boolean
  autoFocus?: boolean
}

const matches = (label: string, typed: string) => label.toLocaleLowerCase().includes(typed.trim().toLocaleLowerCase())

/** A select that filters as you type: an ARIA 1.2 combobox over a list the screen already holds. */
export const SearchSelect = ({ options, value, onChange, labelledBy, placeholder, noMatches, disabled = false, autoFocus = false }: SearchSelectProps) => {
  const id = useId()
  const listId = `${id}-list`
  const chosen = options.find((o) => o.id === value) ?? null
  const [typed, setTyped] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const shown = useMemo(() => (typed === null ? options : options.filter((o) => matches(o.label, typed))), [options, typed])

  const close = () => {
    setOpen(false)
    setTyped(null)
  }
  const choose = (option: SearchOption) => {
    close()
    if (option.id !== value) onChange(option.id)
  }
  const show = () => {
    if (disabled) return
    setOpen(true)
    setActive(Math.max(0, shown.findIndex((o) => o.id === value)))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return show()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((a) => (shown.length === 0 ? 0 : (a + step + shown.length) % shown.length))
    } else if (e.key === 'Enter' && open) {
      e.preventDefault()
      const option = shown[active]
      if (option) choose(option)
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      close()
    }
  }

  return (
    <div className="df-search-select">
      <input
        ref={input}
        id={id}
        type="text"
        role="combobox"
        aria-labelledby={labelledBy}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${listId}-${shown[active].id}` : undefined}
        autoComplete="off"
        placeholder={chosen ? chosen.label : placeholder}
        value={typed ?? chosen?.label ?? ''}
        disabled={disabled}
        autoFocus={autoFocus}
        onFocus={show}
        onClick={show}
        onBlur={close}
        onChange={(e) => {
          setTyped(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
      />
      <span className="df-search-select-caret" aria-hidden="true" />
      {open && (
        <ul id={listId} role="listbox" aria-labelledby={labelledBy} className="df-search-select-list">
          {shown.length === 0 && <li className="df-search-select-none">{noMatches}</li>}
          {shown.map((o, i) => (
            <li
              key={o.id}
              id={`${listId}-${o.id}`}
              role="option"
              aria-selected={o.id === value}
              className={i === active ? 'df-search-select-active' : undefined}
              // Before the field's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault()
                choose(o)
              }}
              onMouseEnter={() => setActive(i)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
