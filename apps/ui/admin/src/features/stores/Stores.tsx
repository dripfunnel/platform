// States (?state=): loading, empty, error, readonly, denied. Without one the screen shows the
// API's page of stores, newest first, and is empty when no merchant has signed up yet.
import { Link } from '@tanstack/react-router'
import type { StoreFilter, StorePage } from '../../api/stores'
import { messages } from '../../messages'
import { EmptyState, ErrorState, LoadingState, ReadOnlyNotice, ListHeader, type ErrorDetails } from '@dripfunnel/shared/ui'
import { Pager } from '../common/Pager'
import { isFiltered } from './isFiltered'
import type { StoresState } from './storeHarness'
import { StoreFilters } from './StoreFilters'
import { StoresTable } from './StoresTable'
import '@dripfunnel/shared/ui/list.css'

const words = messages.stores

export interface StoresProps {
  page: StorePage
  filter: StoreFilter
  forced: StoresState | null
  readOnly: boolean
  onFilterChange: (filter: StoreFilter) => void
  onReload: () => void
}

const StoresHeader = () => <ListHeader level={words.level} title={words.title} sub={words.sub} />

export const StoresLoading = () => (
  <div className="df-page df-list">
    <StoresHeader />
    <LoadingState label={words.loading} rows={8} />
  </div>
)

export const StoresError = ({ onRetry, details }: { onRetry: () => void; details?: ErrorDetails }) => (
  <div className="df-page df-list">
    <StoresHeader />
    <ErrorState title={words.error.title} body={words.error.body} {...(details ? { details } : {})} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

export const Stores = ({ page, filter, forced, readOnly, onFilterChange, onReload }: StoresProps) => {
  if (forced === 'loading') return <StoresLoading />
  if (forced === 'error') return <StoresError onRetry={onReload} />

  if (forced === 'empty' || (page.items.length === 0 && !isFiltered(filter) && !page.pageInfo.hasPreviousPage)) {
    return (
      <div className="df-page df-list">
        <StoresHeader />
        <EmptyState title={words.empty.title} body={words.empty.body} />
      </div>
    )
  }

  return (
    <div className="df-page df-list">
      {readOnly && <ReadOnlyNotice title={words.readOnly.title} body={words.readOnly.body} />}
      <StoresHeader />
      <div className="df-list-toolbar">
        <StoreFilters filter={filter} partners={page.partners} onChange={onFilterChange} />
        <p className="df-muted">{words.newestFirst}</p>
      </div>
      {page.items.length === 0 ? (
        <EmptyState
          title={words.noMatch.title}
          body={words.noMatch.body}
          action={
            <button type="button" className="df-button" onClick={() => onFilterChange({})}>
              {words.filters.clear}
            </button>
          }
        />
      ) : (
        <>
          <StoresTable stores={page.items} />
          <Pager
            label={words.pagerLabel}
            pageInfo={page.pageInfo}
            link={(cursor, label) => (
              <Link to="/stores" search={{ ...filter, ...cursor }} className="df-button">
                {label}
              </Link>
            )}
          />
        </>
      )}
    </div>
  )
}
