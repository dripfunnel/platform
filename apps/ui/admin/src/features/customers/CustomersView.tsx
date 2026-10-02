import type { ReactNode } from 'react'
import type { CustomerFilter, CustomerMatch, CustomerPage } from '../../api/customers'
import { fill, formatCount, formatCountry, locale, messages, plural } from '../../messages'
import { EmptyState, ErrorState, LoadingState, Pager, type PagerProps } from '@dripfunnel/shared/ui'
import { InfoNote } from '../common/InfoNote'
import type { CustomersState } from './customerHarness'
import { CustomerFilters } from './CustomerFilters'
import { CustomersTable } from './CustomersTable'
import type { CustomerPageResult } from './useCustomerPage'
import '@dripfunnel/shared/ui/list.css'

const words = messages.customers
const countryList = new Intl.ListFormat(locale, { type: 'conjunction' })

export interface CustomersViewProps {
  result: CustomerPageResult
  filter: CustomerFilter
  search: string | undefined
  options: Pick<CustomerPage, 'partners' | 'stores'>
  inStore: boolean
  forced: CustomersState | null
  empty: { title: string; body: string }
  onFilterChange: (filter: CustomerFilter) => void
  onSearch: (search: string | undefined) => void
  onClear: () => void
  onRetry: () => void
  pageLink: PagerProps['link']
}

// After an exact email or phone search, how many store accounts it found across every page.
// A number typed without its country code can match different people in different countries,
// and then the line names the countries rather than reading as one person (decided on #42).
const MatchSummary = ({ match }: { match: CustomerMatch }) => {
  const count = formatCount(match.accounts)
  const text =
    match.regions.length > 1
      ? fill(words.matches.phoneCountries, { count, countries: countryList.format(match.regions.map(formatCountry)) })
      : fill(plural(words.matches[match.kind], match.accounts), { count })
  return (
    <div role="status">
      <InfoNote>{text}</InfoNote>
    </div>
  )
}

export const CustomersView = ({ result, filter, search, options, inStore, forced, empty, onFilterChange, onSearch, onClear, onRetry, pageLink }: CustomersViewProps) => {
  const filtered = search !== undefined || Object.values(filter).some((value) => value !== undefined)
  const nothingYet =
    forced === 'empty' ||
    (forced === null && result.kind === 'ready' && result.page.items.length === 0 && !filtered && !result.page.pageInfo.hasPreviousPage)
  if (nothingYet) return <EmptyState title={empty.title} body={empty.body} />

  const content = (): ReactNode => {
    if (forced === 'loading' || result.kind === 'loading') return <LoadingState label={words.loading} rows={8} />
    if (forced === 'error' || result.kind === 'error') {
      return <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
    }
    const { items, pageInfo, match } = result.page
    if (forced === 'nomatch' || items.length === 0) {
      return (
        <EmptyState
          title={words.noMatch.title}
          body={words.noMatch.body}
          action={
            <button type="button" className="df-button" onClick={onClear}>
              {words.filters.clear}
            </button>
          }
        />
      )
    }
    return (
      <>
        {match && <MatchSummary match={match} />}
        <CustomersTable customers={items} inStore={inStore} showPhoneRegion={(match?.regions.length ?? 0) > 1} />
        <Pager words={messages.common.pager} label={words.pagerLabel} pageInfo={pageInfo} link={pageLink} />
      </>
    )
  }

  return (
    <>
      <InfoNote>{words.recorded}</InfoNote>
      <div className="df-list-toolbar">
        <CustomerFilters filter={filter} search={search} options={options} inStore={inStore} onChange={onFilterChange} onSearch={onSearch} onClear={onClear} />
        <p className="df-muted">{words.newestFirst}</p>
      </div>
      {content()}
    </>
  )
}
