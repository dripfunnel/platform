import { StatusPill } from '@dripfunnel/shared/ui'
import { ticketError } from '@dripfunnel/shared/format'
import type { SupportSession } from '../../api/support'
import { fill, formatTime, messages } from '../../messages'
import { ShowMore, type More } from '../common/paged'
import { minutesLeft, refusalText, whereText } from './supportText'

const words = messages.support

export interface SessionsTabProps {
  open: readonly SupportSession[]
  openMore: More
  history: readonly SupportSession[]
  now: number
  // A Return to tab on its way: the buttons wait for its link.
  returning: boolean
  more: More
  onReturn: (session: SupportSession) => void
  onEnd: (session: SupportSession) => void
  onMore: () => void
  onOpenMore: () => void
}

const Who = ({ session }: { session: SupportSession }) => (
  <div className="df-support-session-who">
    <strong>{session.user.name}</strong>
    <span className="df-support-sub">{whereText(session)}</span>
    <span>{session.you ? words.you : session.agent.name}</span>
  </div>
)

// A pasted ticket is a link only when it is https; anything else is shown as text.
const Why = ({ session }: { session: SupportSession }) => (
  <div className="df-support-session-why">
    <span>{session.reason}</span>
    {session.ticket &&
      (ticketError(session.ticket) ? (
        <span className="df-support-ticket df-muted">{session.ticket}</span>
      ) : (
        <a className="df-support-ticket" href={session.ticket} target="_blank" rel="noopener noreferrer">
          {session.ticket}
        </a>
      ))}
  </div>
)

const endedText = (session: SupportSession): string => {
  if (session.endedBy === 'expired') return words.endedBy.expired
  const name = session.endedBy === 'colleague' ? (session.endedByName ?? '') : session.you ? words.you : session.agent.name
  return fill(session.endedBy === 'colleague' ? words.endedBy.colleague : words.endedBy.agent, { name })
}

// §12.3: who is signed in as whom now, with Return to tab (yours) and End; then the history.
export const SessionsTab = ({ open, openMore, history, now, returning, more, onReturn, onEnd, onMore, onOpenMore }: SessionsTabProps) => (
  <div className="df-panels">
    <section className="df-panel df-panel--wide" aria-labelledby="support-open">
      <h2 id="support-open">{words.openNow}</h2>
      {open.length === 0 ? (
        <p className="df-muted">{words.noOpen}</p>
      ) : (
        <ul className="df-support-sessions" aria-label={words.openLabel}>
          {open.map((session) => {
            const whyId = `support-end-${session.id}`
            return (
              <li key={session.id} className="df-support-session">
                <Who session={session} />
                <Why session={session} />
                <strong className="df-support-session-when">{fill(words.minutesLeft, { minutes: String(minutesLeft(session.expiresAt, now)) })}</strong>
                <div className="df-support-session-actions">
                  {session.return.allowed && (
                    <button type="button" className="df-button df-button--small" disabled={returning} onClick={() => onReturn(session)}>
                      {words.returnToTab}
                    </button>
                  )}
                  <button
                    type="button"
                    className="df-button df-button--small df-button--danger"
                    disabled={!session.end.allowed}
                    aria-describedby={session.end.allowed ? undefined : whyId}
                    onClick={() => onEnd(session)}
                  >
                    {words.end}
                  </button>
                  {!session.end.allowed && (
                    <span id={whyId} className="df-support-why">
                      {refusalText(session.end.reason)}
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <ShowMore more={openMore} onMore={onOpenMore} label={words.showMore} failed={words.moreFailed} />
    </section>
    <section className="df-panel df-panel--wide" aria-labelledby="support-history">
      <h2 id="support-history">{words.history}</h2>
      {history.length === 0 ? (
        <p className="df-muted">{words.noHistory}</p>
      ) : (
        <ul className="df-support-sessions" aria-label={words.historyLabel}>
          {history.map((session) => (
            <li key={session.id} className="df-support-session">
              <Who session={session} />
              <Why session={session} />
              <div className="df-support-session-when">
                <span>{fill(words.started, { time: formatTime(session.startedAt) })}</span>
                {session.endedAt && <span>{fill(words.ended, { time: formatTime(session.endedAt) })}</span>}
              </div>
              <StatusPill tone={session.endedBy === 'expired' ? 'neutral' : 'success'} icon={session.endedBy === 'expired' ? 'clock' : 'ok'} label={endedText(session)} />
            </li>
          ))}
        </ul>
      )}
      <ShowMore more={more} onMore={onMore} label={words.showMore} failed={words.moreFailed} />
    </section>
  </div>
)
