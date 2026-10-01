// States (?state=): see impersonateHarness.ts. Without one: the open sessions of both kinds, then
// the history, newest first (FIRST-RELEASE.md §8). A Partner manager is sent to setup pages only.
import { SessionNotice } from '@dripfunnel/shared/ui'
import type { ReactNode } from 'react'
import { sessionDates, sessionKinds, type SessionAction, type SessionFilter, type SessionPage, type StaffSession } from '../../api/impersonation'
import { fill, formatTime, messages } from '../../messages'
import { ErrorState } from '../common/ErrorState'
import { FilterSelect } from '../common/FilterSelect'
import { LoadingState } from '../common/LoadingState'
import { Pager, type PagerProps } from '../common/Pager'
import type { StaffRole } from '../shell/staffRoles'
import type { SessionsState } from './impersonateHarness'
import { ImpersonateHeader } from './ImpersonateHeader'
import { ImpersonateDenied } from './ImpersonateUsers'
import { SessionRow } from './SessionRow'
import { firstOf, timeLeftText } from './sessionText'
import '../common/list.css'
import './impersonate.css'

const words = messages.impersonate
const sessionWords = words.sessions
const kindOptions = sessionKinds.map((kind) => ({ value: kind, label: sessionWords.kinds[kind] }))
const dateOptions = sessionDates.map((date) => ({ value: date, label: sessionWords.filters.dates[date] }))

export interface ImpersonateSessionsProps {
  page: SessionPage | null
  filter: SessionFilter
  forced: SessionsState | null
  role: StaffRole
  openCount: number
  now: number
  onFilterChange: (filter: SessionFilter) => void
  onAction: (action: SessionAction, session: StaffSession) => void
  onRetry: () => void
  pageLink: PagerProps['link']
}

const SessionFilters = ({ filter, page, onChange }: { filter: SessionFilter; page: SessionPage; onChange: (filter: SessionFilter) => void }) => {
  const f = sessionWords.filters
  const refs = (list: SessionPage['staff']) => list.map((ref) => ({ value: ref.id, label: ref.name }))
  return (
    <form role="search" aria-label={f.label} className="df-list-filters" onSubmit={(event) => event.preventDefault()}>
      <FilterSelect label={f.kind} anyLabel={f.anyKind} options={kindOptions} value={filter.kind} onChange={(kind) => onChange({ ...filter, kind })} />
      <FilterSelect label={f.staff} anyLabel={f.anyStaff} options={refs(page.staff)} value={filter.staff} onChange={(staff) => onChange({ ...filter, staff })} />
      <FilterSelect label={f.partner} anyLabel={f.anyPartner} options={refs(page.partners)} value={filter.partner} onChange={(partner) => onChange({ ...filter, partner })} />
      <FilterSelect label={f.store} anyLabel={f.anyStore} options={refs(page.stores)} value={filter.store} onChange={(store) => onChange({ ...filter, store })} />
      <FilterSelect label={f.date} anyLabel={f.anyDate} options={dateOptions} value={filter.date} onChange={(date) => onChange({ ...filter, date })} />
    </form>
  )
}

// The notice each open session puts in front of its users, worded as the portal words it.
const Preview = ({ open, now }: { open: readonly StaffSession[]; now: number }) => {
  const shown = sessionKinds.map((kind) => open.find((session) => session.kind === kind)).filter((session) => session !== undefined)
  if (shown.length === 0) return null
  const preview = sessionWords.preview
  return (
    <section className="df-imp-preview" aria-labelledby="df-imp-preview">
      <h2 id="df-imp-preview">{preview.title}</h2>
      <p className="df-muted">{preview.body}</p>
      {shown.map((session) => (
        <SessionNotice
          key={session.id}
          text={
            session.kind === 'impersonation'
              ? fill(preview.impersonation, { staff: firstOf(session.staff.name), user: firstOf(session.target?.name ?? ''), time: timeLeftText(session.expiresAt, now) })
              : fill(preview.setup, { staff: firstOf(session.staff.name), time: formatTime(session.expiresAt) })
          }
        />
      ))}
    </section>
  )
}

const SessionList = ({ label, sessions, empty, now, onAction }: { label: string; sessions: readonly StaffSession[]; empty: string; now: number; onAction: ImpersonateSessionsProps['onAction'] }) =>
  sessions.length === 0 ? (
    <p className="df-muted">{empty}</p>
  ) : (
    <ul className="df-imp-sessions" aria-label={label}>
      {sessions.map((session) => (
        <SessionRow key={session.id} session={session} now={now} onAction={onAction} />
      ))}
    </ul>
  )

export const SessionsLoading = () => (
  <div className="df-page df-list">
    <ImpersonateHeader current="sessions" openCount={0} />
    <LoadingState label={words.loadingSessions} rows={6} />
  </div>
)

export const SessionsError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="df-page df-list">
    <ImpersonateHeader current="sessions" openCount={0} />
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

export const ImpersonateSessions = ({ page, filter, forced, role, openCount, now, onFilterChange, onAction, onRetry, pageLink }: ImpersonateSessionsProps) => {
  const content = (): ReactNode => {
    if (forced === 'loading') return <LoadingState label={words.loadingSessions} rows={6} />
    if (forced === 'error') return <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
    if (!page) return <ImpersonateDenied role={role} />
    const open = forced === 'empty' ? [] : page.open
    const history = forced === 'empty' ? [] : page.history.items
    return (
      <>
        <div className="df-list-toolbar">
          <SessionFilters filter={filter} page={page} onChange={onFilterChange} />
        </div>
        <section className="df-imp-section" aria-labelledby="df-imp-open">
          <h2 id="df-imp-open">{sessionWords.open}</h2>
          <SessionList label={sessionWords.openLabel} sessions={open} empty={sessionWords.openEmpty} now={now} onAction={onAction} />
        </section>
        <Preview open={open} now={now} />
        <section className="df-imp-section" aria-labelledby="df-imp-history">
          <h2 id="df-imp-history">{sessionWords.history}</h2>
          <SessionList label={sessionWords.historyLabel} sessions={history} empty={sessionWords.historyEmpty} now={now} onAction={onAction} />
          {history.length > 0 && <Pager label={sessionWords.pagerLabel} pageInfo={page.history.pageInfo} link={pageLink} />}
        </section>
      </>
    )
  }

  return (
    <div className="df-page df-list">
      <ImpersonateHeader current="sessions" openCount={forced === 'empty' ? 0 : openCount} />
      {content()}
    </div>
  )
}
