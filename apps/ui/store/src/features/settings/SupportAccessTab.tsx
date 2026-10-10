import { ConfirmDialog } from '@dripfunnel/shared/ui'
import { useCallback, useId, useRef, useState } from 'react'
import type { SupportAccess, SupportSession } from '../../api/support'
import { setSupportAccess } from '../../api/support'
import { fill, formatCount, formatTime, formatWait, messages, plural } from '../../messages'
import { productName } from '../common/productName'
import { refusalIn } from '../common/refusal'
import './developers.css'

const words = messages.settings.support
const refusalOf = refusalIn(words.refused)

type Ended = keyof typeof words.endedBy

/** How long a session lasted, and how it ended when that says something. */
export const whenLine = (s: SupportSession, now: number): string => {
  if (!s.endedAt && Date.parse(s.expiresAt) > now) return fill(words.openNow, { time: formatTime(s.expiresAt) })
  // One past its end that nothing has closed yet timed out.
  const end = s.endedAt ?? s.expiresAt
  const endedBy = s.endedAt ? s.endedBy : 'expired'
  const duration = formatWait((Date.parse(end) - Date.parse(s.startedAt)) / 1000)
  const how = endedBy && endedBy in words.endedBy ? words.endedBy[endedBy as Ended] : words.lasted
  return fill(how, { duration })
}

/** Whether support could change things in the session, and who let it. */
export const changesLine = (s: SupportSession, now: number): { text: string; wrote: boolean } => {
  if (s.access === 'write') return { text: s.allowedBy ? fill(words.allowed, { name: s.allowedBy }) : words.allowedNoName, wrote: true }
  if (s.writeRequest?.state === 'denied') return { text: words.denied, wrote: false }
  // Only an open session is still asking; one past its end timed out, as whenLine says.
  if (s.writeRequest?.state === 'pending' && !s.endedAt && Date.parse(s.expiresAt) > now) return { text: words.asking, wrote: false }
  return { text: words.readOnly, wrote: false }
}

export interface SupportAccessTabProps {
  initial: SupportAccess
  /** A page of the log, from a cursor, or the first. */
  read: (after: string | null) => Promise<SupportAccess>
  onToast: (text: string) => void
}

/** Support access (SetAccess "support", ACCESS §8): the On/Off switch, how a session works, and the support access log. */
export const SupportAccessTab = ({ initial, read, onToast }: SupportAccessTabProps) => {
  const id = useId()
  const partner = productName()
  const [allowed, setAllowed] = useState(initial.allowed)
  const [sessions, setSessions] = useState<readonly SupportSession[]>(initial.sessions.nodes)
  const [next, setNext] = useState(initial.sessions.pageInfo.hasNextPage ? initial.sessions.pageInfo.endCursor : null)
  const [more, setMore] = useState<'idle' | 'loading' | 'failed'>('idle')
  const [rereading, setRereading] = useState(false)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const latest = useRef(0)
  const now = Date.now()

  // The first page again after a switch: turning it off ends open sessions. Only the newest read lands.
  // Show older waits while it runs, and the switch while an older page loads, so the two never cross.
  const reread = useCallback(async () => {
    const ask = ++latest.current
    setRereading(true)
    try {
      const page = await read(null)
      if (ask !== latest.current) return
      setAllowed(page.allowed)
      setSessions(page.sessions.nodes)
      setNext(page.sessions.pageInfo.hasNextPage ? page.sessions.pageInfo.endCursor : null)
    } catch {
      // The switch's own answer stands; the log keeps what it showed.
    } finally {
      if (ask === latest.current) {
        setRereading(false)
        setMore('idle')
      }
    }
  }, [read])

  const older = async (after: string) => {
    const ask = ++latest.current
    setMore('loading')
    try {
      const page = await read(after)
      if (ask !== latest.current) return
      setSessions((shown) => [...shown, ...page.sessions.nodes])
      setNext(page.sessions.pageInfo.hasNextPage ? page.sessions.pageInfo.endCursor : null)
      setMore('idle')
    } catch {
      if (ask === latest.current) setMore('failed')
    }
  }

  const flip = async (to: boolean) => {
    setBusy(true)
    setFailure(null)
    try {
      const ended = await setSupportAccess(to)
      setAllowed(to)
      onToast(to ? words.turnedOn : ended > 0 ? fill(plural(words.ended, ended), { count: formatCount(ended) }) : words.turnedOff)
      void reread()
    } catch (error) {
      setFailure(refusalOf(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="df-set-store df-dev">
      <div>
        <h2 className="df-set-title">{words.title}</h2>
        <p className="df-set-sub">{fill(words.sub, { partner })}</p>
      </div>
      {failure && (
        <p className="df-set-failure" role="alert">
          {failure}
        </p>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={allowed}
        className="df-set-switch df-sup-switch"
        // A privacy control: a read-only store may still switch it (apis/store/support.ts `whileReadOnly`).
        disabled={busy || more === 'loading'}
        onClick={() => (allowed ? setAsking(true) : void flip(true))}
      >
        <span aria-hidden="true" />
        <span className="df-dev-cell">
          <strong className="df-dev-h3">{fill(words.switch, { partner })}</strong>
          <span className="df-dev-muted">{allowed ? words.on : words.off}</span>
        </span>
      </button>
      <section className="df-set-card" aria-labelledby={`${id}-how`}>
        <h2 id={`${id}-how`}>{words.howTitle}</h2>
        <ul className="df-app-list">
          {words.how.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <span className="df-set-help">{words.staff}</span>
      </section>
      <section className="df-dev-section" aria-labelledby={`${id}-log`}>
        <div className="df-dev-head">
          <h2 id={`${id}-log`} className="df-dev-h2">
            {words.logTitle}
          </h2>
          <span className="df-dev-muted">{words.logRange}</span>
        </div>
        {sessions.length === 0 ? (
          <p className="df-dev-empty">{fill(words.logEmpty, { partner })}</p>
        ) : (
          <table className="df-sup-log">
            <thead>
              <tr>
                <th scope="col">{words.cols.who}</th>
                <th scope="col">{words.cols.why}</th>
                <th scope="col">{words.cols.when}</th>
                <th scope="col">{words.cols.changes}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const changes = changesLine(s, now)
                return (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.agentName}</strong>
                      <span className="df-dev-muted">
                        {s.actingAs.supplier
                          ? fill(words.orgSupplier, { partner: s.partnerName, name: s.actingAs.name, supplier: s.actingAs.supplier })
                          : fill(words.org, { partner: s.partnerName, name: s.actingAs.name })}
                      </span>
                    </td>
                    <td>{s.ticket ? fill(words.ticket, { ticket: s.ticket, reason: s.reason }) : s.reason}</td>
                    <td>
                      <span>{formatTime(s.startedAt)}</span>
                      <span className="df-dev-muted">{whenLine(s, now)}</span>
                    </td>
                    <td className={changes.wrote ? 'df-dev-gone' : 'df-dev-muted'}>{changes.text}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {more === 'failed' && (
          <p className="df-set-problem" role="alert">
            {words.moreFailed}
          </p>
        )}
        {next && (
          <button type="button" className="df-button df-dev-start" disabled={more === 'loading' || rereading} onClick={() => void older(next)}>
            {words.more}
          </button>
        )}
      </section>
      {asking && (
        <ConfirmDialog
          open
          title={words.offTitle}
          target=""
          consequence={fill(words.offBody, { partner })}
          confirmLabel={words.offGo}
          cancelLabel={words.cancel}
          danger
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false)
            void flip(false)
          }}
        />
      )}
    </div>
  )
}
