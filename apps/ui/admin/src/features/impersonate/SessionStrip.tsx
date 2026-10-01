import { sessionPollMs, useNow, usePolling, Icon } from '@dripfunnel/shared/ui'
import { useCallback, useEffect } from 'react'
import { loadMySessions, type StaffSession } from '../../api/impersonation'
import { fill, messages } from '../../messages'
import type { StaffRole } from '../shell/staffRoles'
import { firstOf, roleText, timeLeftText, whereText } from './sessionText'
import { useSessionsVersion } from './sessionEvents'
import { useSessionActions } from './useSessionActions'
import { useStartSession } from './useStartSession'
import './impersonate.css'

const words = messages.impersonate.strip

const stripText = (session: StaffSession) =>
  session.kind === 'impersonation' && session.target && session.membership
    ? fill(words.impersonation, { name: firstOf(session.target.name), role: roleText(session.membership), where: whereText(session.membership) })
    : fill(words.setup, { partner: session.partner.name })

// On every page while the caller has a session open of either kind (FIRST-RELEASE.md §8), so
// a session left in another tab is never forgotten.
export const SessionStrip = ({ caller, meName }: { caller: StaffRole; meName: string }) => {
  const load = useCallback(() => loadMySessions(caller), [caller])
  const { value, refresh } = usePolling(load, sessionPollMs)
  const version = useSessionsVersion()
  const now = useNow()
  const actions = useSessionActions(caller, refresh)
  const start = useStartSession(caller, meName)
  useEffect(() => {
    if (version > 0) refresh()
  }, [version, refresh])

  const open = (value ?? []).filter((session) => Date.parse(session.expiresAt) > now)
  return (
    <>
      {open.length > 0 && (
        <section className="df-imp-strip" aria-label={words.label}>
          {open.map((session) => (
            <div key={session.id} className={`df-imp-strip-row df-imp-strip-row--${session.kind}`}>
              <Icon name={session.kind === 'setup' ? 'pen' : 'mask'} size={16} strokeWidth={2} />
              <p className="df-imp-strip-text">
                <strong>{stripText(session)}</strong>
                <span className="df-imp-strip-left">{fill(words.left, { host: session.host, time: timeLeftText(session.expiresAt, now) })}</span>
              </p>
              <div className="df-imp-strip-actions">
                <button type="button" className="df-button df-button--primary" onClick={() => start.returnTo(session.id)}>
                  {words.return}
                </button>
                {session.actions.end?.allowed && (
                  <button type="button" className="df-button" onClick={() => actions.request('end', session)}>
                    {words.end}
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>
      )}
      {actions.element}
      {start.element}
    </>
  )
}
