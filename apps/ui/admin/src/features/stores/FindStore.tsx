import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { loadStores, type StoreRow } from '../../api/stores'
import { messages } from '../../messages'
import { useScreenState } from '@dripfunnel/shared/ui'
import { harnessEnabled } from '../../harness'
import { StatusSub, StoreStatusPill } from './storeLook'
import '../common/phone.css'
import './stores.css'

const words = messages.phone.find

// The same wait as the person finder (FIRST-RELEASE.md §9), so typing doesn't send a search per key.
const typingDelayMs = 250

export const findStates = ['nomatch', 'searching', 'failed'] as const
export type FindState = (typeof findStates)[number]

export type FindResult = { kind: 'searching' } | { kind: 'failed' } | { kind: 'found'; rows: readonly StoreRow[] }

export interface FindStoreViewProps {
  typed: string
  result: FindResult
  onType: (typed: string) => void
  onRetry: () => void
  // Enter opens the first store found.
  onSubmit: () => void
}

export const FindStoreView = ({ typed, result, onType, onRetry, onSubmit }: FindStoreViewProps) => {
  const inputId = useId()
  const statusId = useId()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit()
  }
  const status = result.kind === 'searching' ? words.searching : result.kind === 'found' && result.rows.length === 0 ? words.none : ''
  return (
    <div className="df-phone">
      <h1 className="df-phone-title">{words.title}</h1>
      <form role="search" onSubmit={submit}>
        <label htmlFor={inputId} className="df-visually-hidden">
          {words.label}
        </label>
        <input
          id={inputId}
          className="df-phone-search"
          type="search"
          enterKeyHint="go"
          autoComplete="off"
          placeholder={words.placeholder}
          aria-describedby={statusId}
          value={typed}
          onChange={(event) => onType(event.target.value)}
        />
      </form>
      <p id={statusId} className="df-phone-status" role="status">
        {status}
      </p>
      {result.kind === 'failed' && (
        <div className="df-phone-failed" role="alert">
          <p>{words.failed}</p>
          <button type="button" className="df-button" onClick={onRetry}>
            {words.retry}
          </button>
        </div>
      )}
      {result.kind === 'found' && result.rows.length > 0 && (
        <ul className="df-phone-results" aria-label={words.resultsLabel}>
          {result.rows.map((store) => (
            <li key={store.id}>
              <Link to="/stores/$storeId" params={{ storeId: store.id }} className="df-phone-result">
                <span className="df-phone-result-head">
                  <strong>{store.name}</strong>
                  <span>{store.partner.name}</span>
                </span>
                <StoreStatusPill state={store.state} />
                <StatusSub state={store.state} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Searches what the desktop Stores list searches (name, code, domain, owner email) through the
// same `stores(filter)` query; no query lists the first page, as the prototype does.
export const FindStore = () => {
  const forced = useScreenState(findStates, harnessEnabled)
  const navigate = useNavigate()
  // A link with ?q= (the Stores list's search) opens with it typed; Find a store has no filters.
  const linked = useRouterState({ select: (state) => state.location.search }) as { q?: unknown }
  const [typed, setTyped] = useState(() => (typeof linked.q === 'string' ? linked.q : ''))
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<FindResult>({ kind: 'searching' })
  const q = typed.trim()

  useEffect(() => {
    if (forced) return
    let current = true
    setResult({ kind: 'searching' })
    const timer = setTimeout(() => {
      loadStores(q === '' ? {} : { q }, {})
        .then((page) => current && setResult({ kind: 'found', rows: page.items }))
        .catch(() => current && setResult({ kind: 'failed' }))
    }, typingDelayMs)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [q, attempt, forced])

  const shown: FindResult = forced === 'nomatch' ? { kind: 'found', rows: [] } : forced === 'searching' ? { kind: 'searching' } : forced === 'failed' ? { kind: 'failed' } : result
  const first = shown.kind === 'found' ? shown.rows[0] : undefined

  return (
    <FindStoreView
      typed={typed}
      result={shown}
      onType={setTyped}
      onRetry={() => setAttempt((count) => count + 1)}
      onSubmit={() => first && void navigate({ to: '/stores/$storeId', params: { storeId: first.id } })}
    />
  )
}
