// States (?state=): see staffHarness.ts. Without one: everyone who can sign in to the console,
// and the invitations still open, for a Super admin only.
import { Link } from '@tanstack/react-router'
import type { StaffAction, StaffMember, StaffPage } from '../../api/staff'
import { fill, messages } from '../../messages'
import { EmptyState, ErrorState, LoadingState, ListHeader } from '@dripfunnel/shared/ui'
import { Pager } from '../common/Pager'
import { InfoNote } from '../common/InfoNote'
import type { StaffRole } from '../shell/staffRoles'
import type { StaffScreenState } from './staffHarness'
import { StaffTable } from './StaffTable'
import '@dripfunnel/shared/ui/list.css'
import './staff.css'

const words = messages.staff

export interface StaffProps {
  page: StaffPage | null
  forced: StaffScreenState | null
  me: { id: string; role: StaffRole }
  // The server's refusal of the last change, in words; null when there is none.
  refusal: string | null
  onInvite: () => void
  onAction: (action: StaffAction, member: StaffMember) => void
  onReload: () => void
}

const StaffHeader = ({ onInvite }: { onInvite?: () => void }) => (
  <ListHeader
    level={words.level}
    title={words.title}
    sub={words.sub}
    action={
      onInvite && (
        <button type="button" className="df-button df-button--primary" onClick={onInvite}>
          {words.invite}
        </button>
      )
    }
  />
)

export const StaffLoading = () => (
  <div className="df-page df-list">
    <StaffHeader />
    <LoadingState label={words.loading} rows={6} />
  </div>
)

export const StaffError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="df-page df-list">
    <StaffHeader />
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

export const Staff = ({ page, forced, me, refusal, onInvite, onAction, onReload }: StaffProps) => {
  if (forced === 'loading') return <StaffLoading />
  if (forced === 'error') return <StaffError onRetry={onReload} />

  // Reached by URL without the menu row: the server answered no list (design.md §4).
  if (!page) {
    return (
      <div className="df-page df-list">
        <StaffHeader />
        <EmptyState
          title={words.denied.title}
          body={fill(words.denied.body, { role: messages.shell.roles[me.role] })}
          action={
            <Link to="/dashboard" className="df-button">
              {words.denied.back}
            </Link>
          }
        />
      </div>
    )
  }

  const onlyMe = page.items.length === 1 && page.items[0]?.id === me.id && !page.pageInfo.hasPreviousPage
  if (forced === 'empty' || onlyMe) {
    return (
      <div className="df-page df-list">
        <StaffHeader onInvite={onInvite} />
        <EmptyState
          title={words.empty.title}
          body={words.empty.body}
          action={
            <button type="button" className="df-button df-button--primary" onClick={onInvite}>
              {words.invite}
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className="df-page df-list">
      <StaffHeader onInvite={onInvite} />
      {page.soleSuperAdmin && <InfoNote>{words.soleSuperAdmin}</InfoNote>}
      <p className="df-staff-refusal" role="alert">
        {refusal}
      </p>
      <StaffTable staff={page.items} meId={me.id} onAction={onAction} />
      <Pager
        label={words.pagerLabel}
        pageInfo={page.pageInfo}
        link={(cursor, label) => (
          <Link to="/staff" search={cursor} className="df-button">
            {label}
          </Link>
        )}
      />
    </div>
  )
}
