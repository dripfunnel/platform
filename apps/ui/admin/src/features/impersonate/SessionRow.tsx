import { StatusPill, type StatusTone } from '@dripfunnel/shared/ui'
import type { StatusIconName } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import type { SessionAction, SessionOutcome, StaffSession } from '../../api/impersonation'
import { fill, formatTime, messages } from '../../messages'
import { ActionControl } from '../common/ActionControl'
import { refusalText, sessionPlace, sessionTitle, timeLeftText } from './sessionText'
import './impersonate.css'

const words = messages.impersonate.sessions

export const outcomeLook: Record<SessionOutcome, { tone: StatusTone; icon: StatusIconName }> = {
  open: { tone: 'warning', icon: 'clock' },
  expired: { tone: 'neutral', icon: 'hour' },
  endedByStaff: { tone: 'neutral', icon: 'ok' },
  endedFromPortal: { tone: 'neutral', icon: 'ok' },
  targetGone: { tone: 'danger', icon: 'ban' },
  partnerClosed: { tone: 'danger', icon: 'ban' },
}

const actionOrder: readonly SessionAction[] = ['return', 'extend', 'end']

export interface SessionRowProps {
  session: StaffSession
  now: number
  onAction: (action: SessionAction, session: StaffSession) => void
}

export const SessionEntriesLink = ({ session }: { session: StaffSession }) => (
  <Link to="/activity" search={session.kind === 'impersonation' ? { imp: session.id } : { su: session.id }} className="df-row-link">
    {words.row.allEntries}
  </Link>
)

// One session, open or past: who, where, why, when, and what the caller may do to it.
export const SessionRow = ({ session, now, onAction }: SessionRowProps) => {
  const open = session.outcome === 'open'
  return (
    <li className="df-imp-session">
      <div className="df-stack df-imp-session-who">
        <Link to="/impersonate/sessions/$sessionId" params={{ sessionId: session.id }} className="df-row-title">
          {sessionTitle(session)}
        </Link>
        <span className="df-muted">
          {words.kinds[session.kind]} · {sessionPlace(session)}
        </span>
      </div>
      <div className="df-stack df-imp-session-why">
        <span>{session.reason}</span>
        {session.ticket ? (
          <a href={session.ticket} target="_blank" rel="noopener noreferrer" className="df-row-link df-imp-ticket">
            {session.ticket}
          </a>
        ) : (
          <span className="df-muted">{words.row.noTicket}</span>
        )}
      </div>
      <div className="df-stack df-muted df-imp-session-when">
        <span>{fill(words.row.started, { time: formatTime(session.startedAt) })}</span>
        {open ? (
          <strong className="df-imp-left">{fill(words.row.left, { time: timeLeftText(session.expiresAt, now) })}</strong>
        ) : (
          session.endedAt && <span>{fill(words.row.ended, { time: formatTime(session.endedAt) })}</span>
        )}
        {session.extendedAt && <span>{words.row.extended}</span>}
      </div>
      {!open && <StatusPill {...outcomeLook[session.outcome]} label={words.outcomes[session.outcome]} />}
      <SessionEntriesLink session={session} />
      {open && (
        <div className="df-actions df-imp-session-actions" role="group" aria-label={fill(words.actionsLabel, { id: session.id })}>
          {actionOrder.map((action) => {
            const permission = session.actions[action]
            if (!permission) return null
            return (
              <ActionControl
                key={action}
                label={words.actions[action]}
                primary={action === 'return'}
                danger={action === 'end'}
                refusal={permission.allowed ? null : refusalText(permission.reason)}
                onRun={() => onAction(action, session)}
              />
            )
          })}
        </div>
      )}
    </li>
  )
}
