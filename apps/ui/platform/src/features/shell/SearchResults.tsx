import { initials } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import type { StoreMatch } from '../../api/stores'
import { fill, messages } from '../../messages'
import { StoreStatusPill } from '../stores/storeLook'

const words = messages.shell.search

export interface SearchResultsProps {
  query: string
  matches: readonly StoreMatch[] | 'failed' | null
  onPick: () => void
}

// The prototype's palette rows: initials, name, owner email · domain, status (FIRST-RELEASE.md §2.2).
export const SearchResults = ({ query, matches, onPick }: SearchResultsProps) => {
  if (query.trim() === '') return <p className="df-search-hint">{words.hint}</p>
  if (matches === null) return <p className="df-search-hint">{words.searching}</p>
  if (matches === 'failed') return <p className="df-search-hint" role="alert">{words.failed}</p>
  if (matches.length === 0) return <p className="df-search-hint">{fill(words.none, { query })}</p>
  return (
    <ul className="df-search-results">
      {matches.map((match) => (
        <li key={match.id}>
          <Link to="/stores/$storeId" params={{ storeId: match.id }} className="df-search-result" onClick={onPick}>
            <span className="df-search-initials" aria-hidden="true">
              {initials(match.name)}
            </span>
            <span className="df-search-text">
              <strong>{match.name}</strong>
              <span className="df-muted">{fill(words.result, { email: match.email, host: match.host })}</span>
            </span>
            <StoreStatusPill state={match.state} />
          </Link>
        </li>
      ))}
      <li>
        <Link to="/stores" search={{ q: query.trim() }} className="df-search-all" onClick={onPick}>
          {words.all}
        </Link>
      </li>
    </ul>
  )
}
