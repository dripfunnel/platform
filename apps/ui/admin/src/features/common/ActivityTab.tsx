import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { ActivityFilter } from '../../api/activity'
import type { ActionCode } from '../../api/activityActions'
import type { PageRequest } from '../../api/pageInfo'
import { messages } from '../../messages'
import type { StaffRole } from '../shell/staffRoles'
import { ActivityFilters } from './ActivityFilters'
import { ActivityList } from './ActivityList'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { LoadingState } from './LoadingState'
import { useActivityPage } from './useActivityPage'
import './activity.css'

const words = messages.activity

export type ActivityScope = { partner: string } | { store: string } | { customer: string }

export interface ActivityTabProps {
  scope: ActivityScope
  filter: ActivityFilter
  page: PageRequest
  caller: StaffRole
  actions: readonly ActionCode[]
  onFilterChange: (filter: ActivityFilter) => void
  pageLink: (cursor: { before: string } | { after: string }, label: string) => ReactNode
}

// The Activity tab on a partner, store or customer: the log pre-filtered to that scope (FIRST-RELEASE.md §9).
export const ActivityTab = ({ scope, filter, page, caller, actions, onFilterChange, pageLink }: ActivityTabProps) => {
  const { result, reload } = useActivityPage({ ...filter, ...scope }, page, caller)
  const filtered = Object.values(filter).some((value) => value !== undefined)
  return (
    <section className="df-list df-activity-tab">
      <div className="df-list-toolbar">
        <ActivityFilters filter={filter} onChange={onFilterChange} actions={actions} />
        <p className="df-muted">{words.newestFirst}</p>
      </div>
      {result.kind === 'loading' && <LoadingState label={words.loading} rows={6} />}
      {result.kind === 'error' && <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: reload }} />}
      {result.kind === 'ready' &&
        (result.page.items.length === 0 && !result.page.pageInfo.hasPreviousPage ? (
          <EmptyState
            title={filtered ? words.noMatch.title : words.tabEmpty.title}
            body={filtered ? words.noMatch.body : words.tabEmpty.body}
            {...(filtered ? { action: <button type="button" className="df-button" onClick={() => onFilterChange({})}>{words.filters.clear}</button> } : {})}
          />
        ) : (
          <ActivityList page={result.page} pageLink={pageLink} />
        ))}
      <p>
        <Link to="/activity" search={scope} className="df-row-link">
          {words.openInLog}
        </Link>
      </p>
    </section>
  )
}
