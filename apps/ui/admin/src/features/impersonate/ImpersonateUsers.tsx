// States (?state=): see impersonateHarness.ts. Without one: every partner and store user the
// API lists for impersonation, never staff or shoppers (FIRST-RELEASE.md §8).
import { Link } from '@tanstack/react-router'
import { useRef, type ReactNode } from 'react'
import type { ImpersonationTarget, TargetFilter, TargetPage } from '../../api/impersonation'
import { fill, messages } from '../../messages'
import { EmptyState } from '../common/EmptyState'
import { ErrorState } from '../common/ErrorState'
import { InfoNote } from '../common/InfoNote'
import { LoadingState } from '../common/LoadingState'
import { Pager, type PagerProps } from '../common/Pager'
import type { StaffRole } from '../shell/staffRoles'
import type { UsersState } from './impersonateHarness'
import { ImpersonateHeader } from './ImpersonateHeader'
import { TargetFilters } from './TargetFilters'
import { TargetsTable } from './TargetsTable'
import type { TargetPageResult } from './useTargetPage'
import '../common/list.css'

const words = messages.impersonate

export interface ImpersonateUsersProps {
  result: TargetPageResult
  filter: TargetFilter
  search: string | undefined
  forced: UsersState | null
  role: StaffRole
  openCount: number
  onFilterChange: (filter: TargetFilter) => void
  onSearch: (search: string | undefined) => void
  onClear: () => void
  onRetry: () => void
  onImpersonate: (target: ImpersonationTarget) => void
  onReturn: (sessionId: string) => void
  pageLink: PagerProps['link']
}

export const ImpersonateDenied = ({ role }: { role: StaffRole }) => (
  <EmptyState
    title={words.denied.title}
    body={fill(words.denied.body, { role: messages.shell.roles[role] })}
    action={
      <Link to="/dashboard" className="df-button">
        {words.denied.back}
      </Link>
    }
  />
)

export const ImpersonateUsers = (props: ImpersonateUsersProps) => {
  const { result, filter, search, forced, role, openCount, onFilterChange, onSearch, onClear, onRetry, onImpersonate, onReturn, pageLink } = props
  // Kept from the last answer, so the Partner and Store choices don't vanish while a page loads.
  const options = useRef<Pick<TargetPage, 'partners' | 'stores'>>({ partners: [], stores: [] })
  if (result.kind === 'ready') options.current = result.page

  const filtered = search !== undefined || Object.values(filter).some((value) => value !== undefined)
  const content = (): ReactNode => {
    if (forced === 'loading' || result.kind === 'loading') return <LoadingState label={words.loading} rows={8} />
    if (forced === 'error' || result.kind === 'error') {
      return <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
    }
    if (result.kind === 'denied') return <ImpersonateDenied role={role} />
    const { items, pageInfo } = result.page
    if (forced === 'empty' || (items.length === 0 && !filtered && !pageInfo.hasPreviousPage)) return <EmptyState title={words.empty.title} body={words.empty.body} />
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
        <TargetsTable targets={items} onImpersonate={onImpersonate} onReturn={onReturn} />
        <Pager label={words.users.pagerLabel} pageInfo={pageInfo} link={pageLink} />
      </>
    )
  }

  return (
    <div className="df-page df-list">
      <ImpersonateHeader current="users" openCount={openCount} />
      {result.kind !== 'denied' && (
        <>
          <InfoNote>{words.neverListed}</InfoNote>
          <div className="df-list-toolbar">
            <TargetFilters filter={filter} search={search} options={options.current} onChange={onFilterChange} onSearch={onSearch} onClear={onClear} />
          </div>
        </>
      )}
      {content()}
    </div>
  )
}
