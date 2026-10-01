// States (?state=): see activityHarness.ts. Without one: the API's entries, newest first, 50 a page, never counted.
import { Link } from '@tanstack/react-router'
import type { ActivityExport as ExportJob, ActivityFilter, ActivityPage, ActivityPerson } from '../../api/activity'
import { actionCodes } from '../../api/activityActions'
import { messages } from '../../messages'
import { ActivityChips, ActivityFilters } from '../common/ActivityFilters'
import { ActivityList } from '../common/ActivityList'
import { EmptyState, ErrorState, LoadingState } from '@dripfunnel/shared/ui'
import { ListHeader } from '../common/ListHeader'
import { ActivityExport } from './ActivityExport'
import type { ActivityScreenState } from './activityHarness'
import { PersonCard } from './PersonCard'
import { PersonFinder } from './PersonFinder'
import '../common/list.css'
import './activityLog.css'

const words = messages.activity

export interface ActivityLogProps {
  page: ActivityPage
  person: ActivityPerson | null
  filter: ActivityFilter
  forced: ActivityScreenState | null
  exportJob: ExportJob | null
  onFilterChange: (filter: ActivityFilter) => void
  onChoosePerson: (personId: string) => void
  onExport: () => void
  onReload: () => void
}

const ActivityHeader = () => <ListHeader level={words.level} title={words.title} sub={words.sub} />

export const ActivityLoading = () => (
  <div className="df-page df-list">
    <ActivityHeader />
    <LoadingState label={words.loading} rows={10} />
  </div>
)

export const ActivityError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="df-page df-list">
    <ActivityHeader />
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

const isFiltered = (filter: ActivityFilter) => Object.values(filter).some((value) => value !== undefined)

export const ActivityLog = ({ page, person, filter, forced, exportJob, onFilterChange, onChoosePerson, onExport, onReload }: ActivityLogProps) => {
  if (forced === 'loading') return <ActivityLoading />
  if (forced === 'error') return <ActivityError onRetry={onReload} />

  if (forced === 'empty' || (page.items.length === 0 && !isFiltered(filter) && !page.pageInfo.hasPreviousPage)) {
    return (
      <div className="df-page df-list">
        <ActivityHeader />
        <EmptyState title={words.empty.title} body={words.empty.body} />
      </div>
    )
  }

  return (
    <div className="df-page df-list">
      <ActivityHeader />
      <PersonFinder onChoose={onChoosePerson} />
      {person && <PersonCard person={person} without={{ ...filter, person: undefined }} />}
      {filter.person && !person && <p className="df-muted">{words.person.notFound}</p>}
      <div className="df-list-toolbar df-activity-toolbar">
        <ActivityFilters filter={filter} onChange={onFilterChange} actions={actionCodes} scopes={page} />
        <p className="df-muted">{words.newestFirst}</p>
        <ActivityExport permission={page.export} job={exportJob} onExport={onExport} />
      </div>
      <ActivityChips filter={filter} remove={(key) => ({ ...filter, [key]: undefined })} />
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
        <ActivityList
          page={page}
          pageLink={(cursor, label) => (
            <Link to="/activity" search={{ ...filter, ...cursor }} className="df-button">
              {label}
            </Link>
          )}
        />
      )}
    </div>
  )
}
