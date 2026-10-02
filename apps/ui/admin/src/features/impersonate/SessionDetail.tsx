// States (?state=): loading, error. Without one: one session of either kind, its facts and what
// the caller may still do to it. A Partner manager may open setup sessions only (decided on #46).
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { SessionAction, SessionLookup, StaffSession } from '../../api/impersonation'
import { fill, formatTime, messages } from '../../messages'
import { ActionControl } from '../common/ActionControl'
import { EmptyState, ErrorState, LoadingState, StatusPill } from '@dripfunnel/shared/ui'
import { impersonators } from '../../api/sessionRules'
import type { StaffRole } from '../shell/staffRoles'
import type { SessionScreenState } from './impersonateHarness'
import { outcomeLook, SessionEntriesLink } from './SessionRow'
import { roleText, refusalText, sessionPlace, sessionTitle, timeLeftText } from './sessionText'
import '../common/list.css'
import './impersonate.css'

const words = messages.impersonate
const facts = words.session.facts
const actionOrder: readonly SessionAction[] = ['return', 'extend', 'end']

export interface SessionDetailProps {
  id: string
  lookup: SessionLookup
  forced: SessionScreenState | null
  role: StaffRole
  now: number
  onAction: (action: SessionAction, session: StaffSession) => void
  onRetry: () => void
}

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
)

// A Partner manager has no Sessions list, so the trail and the way back lead elsewhere.
const Header = ({ id, listed }: { id: string; listed: boolean }) => (
  <header className="df-detail-header">
    {listed && (
      <nav aria-label={words.session.breadcrumbLabel} className="df-breadcrumb">
        <Link to="/impersonate/sessions">{words.session.breadcrumb}</Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page">{id}</span>
      </nav>
    )}
    <h1 className="df-page-title">{fill(words.session.title, { id })}</h1>
  </header>
)

const Facts = ({ session, now }: { session: StaffSession; now: number }) => {
  const open = session.outcome === 'open'
  return (
    <dl className="df-imp-facts">
      <Fact label={facts.kind}>{words.sessions.kinds[session.kind]}</Fact>
      <Fact label={facts.staff}>{session.staff.name}</Fact>
      {session.target && session.membership && (
        <Fact label={facts.actingAs}>
          {session.target.name} · {roleText(session.membership)}
        </Fact>
      )}
      <Fact label={facts.partner}>
        <Link to="/partners/$partnerId" params={{ partnerId: session.partner.id }} className="df-row-link">
          {session.partner.name}
        </Link>
      </Fact>
      <Fact label={facts.where}>
        {session.store ? (
          <Link to="/stores/$storeId" params={{ storeId: session.store.id }} className="df-row-link">
            {sessionPlace(session)}
          </Link>
        ) : (
          sessionPlace(session)
        )}
      </Fact>
      <Fact label={facts.host}>
        <code>{session.host}</code>
      </Fact>
      <Fact label={facts.reason}>{session.reason}</Fact>
      <Fact label={facts.ticket}>
        {session.ticket ? (
          <a href={session.ticket} target="_blank" rel="noopener noreferrer" className="df-row-link df-imp-ticket">
            {session.ticket}
          </a>
        ) : (
          words.sessions.row.noTicket
        )}
      </Fact>
      <Fact label={facts.started}>{formatTime(session.startedAt)}</Fact>
      {open ? (
        <Fact label={facts.ends}>
          {formatTime(session.expiresAt)} · {fill(words.sessions.row.left, { time: timeLeftText(session.expiresAt, now) })}
        </Fact>
      ) : (
        session.endedAt && <Fact label={facts.ended}>{formatTime(session.endedAt)}</Fact>
      )}
      <Fact label={facts.outcome}>
        <StatusPill {...outcomeLook[session.outcome]} label={words.sessions.outcomes[session.outcome]} />
      </Fact>
      {session.kind === 'impersonation' && <Fact label={facts.extended}>{session.extendedAt ? formatTime(session.extendedAt) : facts.notExtended}</Fact>}
    </dl>
  )
}

export const SessionDetail = ({ id, lookup, forced, role, now, onAction, onRetry }: SessionDetailProps) => {
  const listed = impersonators.includes(role)
  const body = (): ReactNode => {
    if (forced === 'loading') return <LoadingState label={words.session.loading} rows={6} />
    if (forced === 'error') return <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
    if (lookup.kind === 'denied') {
      return (
        <EmptyState
          title={words.session.denied.title}
          body={fill(words.session.denied.body, { role: messages.shell.roles[role] })}
          action={
            <Link to="/dashboard" className="df-button">
              {words.session.denied.back}
            </Link>
          }
        />
      )
    }
    if (lookup.kind === 'notFound') {
      return (
        <EmptyState
          title={words.session.notFound.title}
          body={words.session.notFound.body}
          action={
            <Link to={listed ? '/impersonate/sessions' : '/dashboard'} className="df-button">
              {listed ? words.session.notFound.back : words.session.denied.back}
            </Link>
          }
        />
      )
    }
    const { session } = lookup
    return (
      <>
        <p className="df-imp-detail-sub">{sessionTitle(session)}</p>
        <Facts session={session} now={now} />
        <div className="df-actions df-imp-detail-actions">
          <SessionEntriesLink session={session} />
          {actionOrder.map((action) => {
            const permission = session.actions[action]
            if (!permission) return null
            return (
              <ActionControl
                key={action}
                label={words.sessions.actions[action]}
                primary={action === 'return'}
                danger={action === 'end'}
                refusal={permission.allowed ? null : refusalText(permission.reason)}
                onRun={() => onAction(action, session)}
              />
            )
          })}
        </div>
      </>
    )
  }

  return (
    <div className="df-page df-list">
      <Header id={id} listed={listed} />
      {body()}
    </div>
  )
}
