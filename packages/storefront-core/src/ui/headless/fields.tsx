'use client'

import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { navigate } from '../../platform/browser/router'
import { Image } from '../../platform/media/media'
import { useStorefront } from '../../platform/store/context'
import type { ProductCard } from '../../products/summary'
import { Price } from '../../sealed/components'
import { minSuggestLength, useSuggestions } from '../../search/suggest'

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

type SearchFieldProps = Styled & {
  label: string
  placeholder?: string
  button: string
  value: string
  onSearch: (words: string) => void
  /** How many products to suggest while the shopper types, up to 4; none when left out. */
  suggest?: number
}

/** A search box that hands its words over on submit; the page's own search runs there, nothing is posted. */
export const SearchField = ({ suggest, ...props }: SearchFieldProps) => (suggest ? <SuggestingSearch {...props} first={suggest} /> : <PlainSearch {...props} />)

const PlainSearch = ({ label, placeholder, button, value, onSearch, className }: Omit<SearchFieldProps, 'suggest'>) => {
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

// The combobox pattern (WAI-ARIA APG): focus stays in the box, arrows move the highlighted option.
const SuggestingSearch = ({ label, placeholder, button, value, onSearch, className, first }: Omit<SearchFieldProps, 'suggest'> & { first: number }) => {
  const id = useId()
  const listId = `${id}-list`
  const { store, locale, t } = useStorefront()
  const [words, setWords] = useState(value)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  useEffect(() => setWords(value), [value])
  const found = useSuggestions(words, first)
  const [shown, setShown] = useState<{ words: string; products: ProductCard[] }>({ words: '', products: [] })
  useEffect(() => {
    if (found.status === 'ready') setShown({ words: found.words, products: found.products ?? [] })
    else if (found.status !== 'loading') setShown({ words: '', products: [] })
    setActive(-1)
  }, [found.status, found.words, found.products])

  const listed = open && shown.words !== '' && words.trim().length >= minSuggestLength
  const optionCount = listed ? shown.products.length + (shown.products.length ? 1 : 0) : 0
  const optionId = (i: number) => `${id}-option-${i}`
  const search = (q: string) => {
    setOpen(false)
    onSearch(q)
  }
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && listed) {
      e.preventDefault()
      setOpen(false)
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && optionCount) {
      e.preventDefault()
      setOpen(true)
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % optionCount : (i <= 0 ? optionCount : i) - 1))
    } else if (e.key === 'Enter' && listed && active >= 0) {
      e.preventDefault()
      const product = shown.products[active]
      if (product) {
        setOpen(false)
        navigate(product.href)
      } else search(words)
    }
  }
  return (
    <form
      action="/search/"
      role="search"
      className={className}
      onSubmit={(e) => {
        e.preventDefault()
        search(words)
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
    >
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="search"
        name="q"
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={optionCount > 0}
        aria-activedescendant={optionCount > 0 && active >= 0 ? optionId(active) : undefined}
        value={words}
        placeholder={placeholder}
        maxLength={200}
        autoComplete="off"
        onChange={(e) => {
          setWords(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={keys}
      />
      <button type="submit">{button}</button>
      {/* Pressing an option keeps the focus in the box, so the click lands before the list closes. */}
      <ul id={listId} role="listbox" aria-label={label} hidden={optionCount === 0} onMouseDown={(e) => e.preventDefault()}>
        {optionCount
          ? shown.products.map((p, i) => (
              <li key={p.id} id={optionId(i)} role="option" aria-selected={active === i}>
                <a href={p.href} tabIndex={-1} onClick={() => setOpen(false)}>
                  {p.photo ? <Image image={p.photo} alt="" ratio={1} sizes="64px" /> : null}
                  <span>{p.name}</span>
                  {p.price ? <Price money={p.price} compareAt={p.compareAt} includesTax={store.pricesIncludeTax} locale={locale} t={t} /> : null}
                </a>
              </li>
            ))
          : null}
        {optionCount ? (
          <li id={optionId(shown.products.length)} role="option" aria-selected={active === shown.products.length} onClick={() => search(words)}>
            {t('search.suggest.all', { query: words.trim() })}
          </li>
        ) : null}
      </ul>
      <p role="status">{listed && shown.products.length === 0 ? t('search.suggest.none', { query: shown.words }) : ''}</p>
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
