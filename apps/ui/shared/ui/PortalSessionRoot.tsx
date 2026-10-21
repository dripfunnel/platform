import { useCallback, useEffect, useId, useRef } from 'react'
import { SessionEndCard } from './ImpBanner'
import type { PortalSession } from './portalSession'
import { useHandoff } from './portalSession'
import { StaffSessionLayer, type StaffSessionCopy } from './StaffSessionLayer'
import { blockedFor, type PortalStaffSession, type SessionBlock, type SessionControl } from './staffSession'
import type { PortalHarnessState } from './staffSessionFixture'
import { usePolling } from './usePolling'
import './session.css'

export interface PortalSessionRootProps {
  client: PortalSession
  copy: StaffSessionCopy
  adminUrl: string
  forced: PortalHarnessState | null
  invalid: { title: string; body: string }
}

// Above every page of a portal: the staff member's bar, the member notice, or an end card.
export const PortalSessionRoot = ({ client, copy, adminUrl, forced, invalid }: PortalSessionRootProps) => {
  const version = client.useVersion()
  const applied = useRef(false)
  useEffect(() => {
    if (applied.current || !forced || forced === 'invalid') return
    applied.current = true
    client.harness(forced)
  }, [client, forced])
  if (forced === 'invalid') return <SessionEndCard {...invalid} action={{ label: copy.action, href: adminUrl }} />
  return <StaffSessionLayer key={version} loadCurrent={client.current} loadNotice={client.notice} end={client.end} adminUrl={adminUrl} copy={copy} />
}

// Where the admin console's link lands in both portals (ACCESS.md §8.1).
export const handoffPath = '/impersonate/enter'

// The route's search: the token only, and only when it is a string of a sane length.
export const handoffSearch = (search: Record<string, unknown>): { token?: string } =>
  typeof search.token === 'string' && search.token.length <= 4096 ? { token: search.token } : {}

export interface HandoffWords {
  pending: string
  action: string
  invalid: { title: string; body: string }
}

export interface HandoffScreenProps {
  token: string | undefined
  client: PortalSession
  words: HandoffWords
  adminUrl: string
  // The app's router, replacing the current entry: `handoffPath` to drop the token, `/` once in.
  replaceUrl: (to: typeof handoffPath | '/') => void
}

// The link from the admin console, used once; the token leaves the address bar before it is exchanged.
export const HandoffScreen = ({ token, client, words, adminUrl, replaceUrl }: HandoffScreenProps) => {
  const replace = useRef(replaceUrl)
  replace.current = replaceUrl
  const clearUrl = useCallback(() => replace.current(handoffPath), [])
  const result = useHandoff(token, client.exchange, clearUrl)
  useEffect(() => {
    if (result === 'entered') replace.current('/')
  }, [result])
  if (result === 'invalid') return <SessionEndCard {...words.invalid} action={{ label: words.action, href: adminUrl }} />
  const pending = words.pending
  return (
    <p className="df-session-pending" role="status">
      {pending}
    </p>
  )
}

// The session this tab is in, for screens that disable what staff may not change.
export const useCurrentStaffSession = (client: PortalSession): PortalStaffSession | null => {
  const version = client.useVersion()
  const { value, refresh } = usePolling(client.current)
  useEffect(() => {
    if (version > 0) refresh()
  }, [version, refresh])
  return value?.state === 'open' ? value : null
}

export interface SessionControlsProps {
  session: PortalStaffSession | null
  items: readonly { control: SessionControl; label: string }[]
  reason: (block: SessionBlock, session: PortalStaffSession) => string
}

// Controls a staff session may not use stay in place, disabled, with the reason beside them.
export const SessionControls = ({ session, items, reason }: SessionControlsProps) => {
  const id = useId()
  return (
    <ul className="df-session-controls">
      {items.map(({ control, label }) => {
        const block = session ? blockedFor(session.kind, control) : null
        const reasonId = `${id}-${control}`
        return (
          <li key={control}>
            <button type="button" className="df-session-control" disabled={block !== null} aria-describedby={block && session ? reasonId : undefined}>
              {label}
            </button>
            {block && session && (
              <span id={reasonId} className="df-session-reason">
                {reason(block, session)}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
