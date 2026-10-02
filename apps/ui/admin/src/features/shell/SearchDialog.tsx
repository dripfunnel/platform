import { Link } from '@tanstack/react-router'
import { useEffect, useId, useRef, useState } from 'react'
import { searchMaxLength } from '@dripfunnel/shared/search'
import { search, searchMinLength, type SearchResult } from '../../api/search'
import { fill, messages } from '../../messages'
import { Icon, isBackdropClick } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import './search.css'

const words = messages.shell.search
const partnerWords = messages.partners
const storeWords = messages.stores

const debounceMs = 300

type Outcome = { kind: 'idle' } | { kind: 'searching' } | { kind: 'found'; query: string; result: SearchResult } | { kind: 'failed' }

// Debounced, capped by the server and asked only once there are enough characters
// (FIRST-RELEASE.md §2); a stale answer never overwrites a newer one.
const useSearch = (text: string, attempt: number): Outcome => {
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' })
  useEffect(() => {
    // The API takes two to a hundred characters; the field stops at the hundred.
    const query = text.trim().slice(0, searchMaxLength)
    if (query.length < searchMinLength) {
      setOutcome({ kind: 'idle' })
      return
    }
    let current = true
    setOutcome({ kind: 'searching' })
    const timer = setTimeout(() => {
      search(query)
        .then((result) => current && setOutcome({ kind: 'found', query, result }))
        .catch(() => current && setOutcome({ kind: 'failed' }))
    }, debounceMs)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [text, attempt])
  return outcome
}

const Results = ({ outcome, onPick, onRetry }: { outcome: Outcome; onPick: () => void; onRetry: () => void }) => {
  switch (outcome.kind) {
    case 'idle':
      return <p className="df-search-hint">{words.hint}</p>
    case 'searching':
      return (
        <p className="df-search-hint" role="status">
          {words.searching}
        </p>
      )
    case 'failed':
      return (
        <div className="df-search-hint" role="alert">
          <span>{words.error}</span>
          <button type="button" className="df-button df-button--small" onClick={onRetry}>
            {words.retry}
          </button>
        </div>
      )
    case 'found': {
      const { partners, stores } = outcome.result
      if (partners.length === 0 && stores.length === 0) {
        return (
          <p className="df-search-hint" role="status">
            {fill(words.noMatch, { query: outcome.query })}
          </p>
        )
      }
      return (
        <div className="df-search-results">
          {partners.length > 0 && (
            <section aria-label={words.partners}>
              <h2>{words.partners}</h2>
              <ul>
                {partners.map((partner) => (
                  <li key={partner.id}>
                    <Link to="/partners/$partnerId" params={{ partnerId: partner.id }} onClick={onPick}>
                      <span className="df-row-title">{partner.name}</span>
                      <span className="df-muted">{[partnerWords.states[partner.state], partner.host, partner.ownerEmail].filter(Boolean).join(' · ')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {stores.length > 0 && (
            <section aria-label={words.stores}>
              <h2>{words.stores}</h2>
              <ul>
                {stores.map((store) => (
                  <li key={store.id}>
                    <Link to="/stores/$storeId" params={{ storeId: store.id }} onClick={onPick}>
                      <span className="df-row-title">{store.name}</span>
                      <span className="df-muted">{[store.code, store.partnerName, storeWords.statuses[store.status], store.host ?? store.ownerEmail].filter(Boolean).join(' · ')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )
    }
  }
}

// Opens and closes like the prototype's search (Esc or a click outside closes it), and asks the
// Admin API's `search` query for partners and stores (FIRST-RELEASE.md §12, Header).
export const SearchDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const inputId = useId()
  const hintId = useId()
  const [text, setText] = useState('')
  const [attempt, setAttempt] = useState(0)
  const outcome = useSearch(open ? text : '', attempt)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dialog.showModal()
      inputRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="df-search"
      aria-labelledby={`${inputId}-label`}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClose={() => triggerRef.current?.focus()}
      onClick={(event) => {
        if (isBackdropClick(event)) onClose()
      }}
    >
      <div className="df-search-panel">
        <div className="df-search-field">
          <Icon name="search" />
          <label htmlFor={inputId} id={`${inputId}-label`} className="df-visually-hidden">
            {words.inputLabel}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="search"
            autoComplete="off"
            placeholder={words.placeholder}
            aria-describedby={hintId}
            maxLength={searchMaxLength}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="button" className="df-search-close" onClick={onClose}>
            <kbd aria-hidden="true">{words.escapeHint}</kbd>
            <span className="df-visually-hidden">{words.close}</span>
          </button>
        </div>
        <div id={hintId}>
          <Results outcome={outcome} onPick={onClose} onRetry={() => setAttempt((n) => n + 1)} />
        </div>
      </div>
    </dialog>
  )
}
