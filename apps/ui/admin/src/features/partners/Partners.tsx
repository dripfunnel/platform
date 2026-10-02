// States (?state=): loading, empty, error, readonly, denied. Without one the screen shows the
// API's page of partners, and is empty when the platform has none: a new platform's first view.
import { Link } from '@tanstack/react-router'
import type { PartnerFilter, PartnerPage } from '../../api/partners'
import { messages } from '../../messages'
import { EmptyState, ErrorState, LoadingState, ReadOnlyNotice, type ErrorDetails } from '@dripfunnel/shared/ui'
import { Pager } from '../common/Pager'
import type { PartnersState } from './partnerHarness'
import { isFiltered } from './isFiltered'
import { PartnerFilters } from './PartnerFilters'
import { CreatePartner, PartnersHeader } from './PartnersHeader'
import { PartnersTable } from './PartnersTable'
import '@dripfunnel/shared/ui/list.css'
import './partners.css'

const words = messages.partners

export interface PartnersProps {
  page: PartnerPage
  filter: PartnerFilter
  forced: PartnersState | null
  readOnly: boolean
  onFilterChange: (filter: PartnerFilter) => void
  onReload: () => void
}

export const PartnersLoading = () => (
  <div className="df-page df-list">
    <PartnersHeader />
    <LoadingState label={words.loading} rows={7} />
  </div>
)

export const PartnersError = ({ onRetry, details }: { onRetry: () => void; details?: ErrorDetails }) => (
  <div className="df-page df-list">
    <PartnersHeader />
    <ErrorState title={words.error.title} body={words.error.body} {...(details ? { details } : {})} retry={{ label: words.error.retry, onRetry }} />
  </div>
)


export const Partners = ({ page, filter, forced, readOnly, onFilterChange, onReload }: PartnersProps) => {
  if (forced === 'loading') return <PartnersLoading />
  if (forced === 'error') return <PartnersError onRetry={onReload} />

  if (forced === 'empty' || (page.items.length === 0 && !isFiltered(filter) && !page.pageInfo.hasPreviousPage)) {
    return (
      <div className="df-page df-list">
        <PartnersHeader />
        <EmptyState title={words.empty.title} body={words.empty.body} action={<CreatePartner permission={page.create} />} />
      </div>
    )
  }

  return (
    <div className="df-page df-list">
      {readOnly && <ReadOnlyNotice title={words.readOnly.title} body={words.readOnly.body} />}
      <PartnersHeader create={page.create} />
      <div className="df-list-toolbar">
        <PartnerFilters filter={filter} onChange={onFilterChange} />
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
          <PartnersTable partners={page.items} />
          <Pager
            label={words.pagerLabel}
            pageInfo={page.pageInfo}
            link={(cursor, label) => (
              <Link to="/partners" search={{ ...filter, ...cursor }} className="df-button">
                {label}
              </Link>
            )}
          />
        </>
      )}
    </div>
  )
}
