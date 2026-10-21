// Stands in for the portal's half of #40 until #68: the one-time handoff and the session behind
// it. A fixture token carries the session's description; the real one is opaque (ACCESS.md §8.1).
import { sessionStateAt, type PortalStaffSession } from './staffSession'

export type FixtureHandoff = Omit<PortalStaffSession, 'state' | 'endedBy'>

const prefix = 'fx.'

const toBase64Url = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const fromBase64Url = (text: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0)))

export const isFixtureHandoff = (token: string): boolean => token.startsWith(prefix)

export const encodeFixtureHandoff = (session: FixtureHandoff, nonce: string): string => `${prefix}${toBase64Url(JSON.stringify({ session, nonce }))}`

const decode = (token: string): FixtureHandoff | null => {
  if (!token.startsWith(prefix)) return null
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(token.slice(prefix.length)))
    if (typeof parsed !== 'object' || parsed === null || !('session' in parsed)) return null
    const session = (parsed as { session: FixtureHandoff }).session
    return typeof session.id === 'string' && (session.kind === 'impersonation' || session.kind === 'setup') ? session : null
  } catch {
    return null
  }
}

export const portalHarnessStates = ['impersonating', 'setup', 'ended', 'expired', 'invalid', 'notice', 'noticeSetup'] as const
export type PortalHarnessState = (typeof portalHarnessStates)[number]

export interface PortalSessionFixtureOptions {
  now?: () => number
  // The sample a harness state shows, for an app that has no admin console to start one from.
  sample: (kind: PortalStaffSession['kind'], expiresAt: string) => FixtureHandoff
}

export const createPortalSessionFixture = ({ now = Date.now, sample }: PortalSessionFixtureOptions) => {
  const spent = new Set<string>()
  let current: PortalStaffSession | null = null
  let notice: PortalStaffSession | null = null

  const withState = (session: PortalStaffSession | null) => (session ? { ...session, state: sessionStateAt(session, now()) } : null)

  // Single use: a second exchange of the same link is refused, as it will be by the API.
  const enter = (token: string): PortalStaffSession | null => {
    const handoff = decode(token)
    if (!handoff || spent.has(token)) return null
    spent.add(token)
    current = { ...handoff, state: 'open', endedBy: null }
    return withState(current)
  }

  const end = (id: string, by: 'admin' | 'portal') => {
    if (current?.id === id && current.state === 'open') current = { ...current, state: 'ended', endedBy: by }
  }

  const harness = (state: PortalHarnessState) => {
    const inHalfAnHour = new Date(now() + 28 * 60_000).toISOString()
    const kind = state === 'setup' || state === 'noticeSetup' ? 'setup' : 'impersonation'
    const session: PortalStaffSession = { ...sample(kind, inHalfAnHour), state: 'open', endedBy: null }
    if (state === 'notice' || state === 'noticeSetup') notice = session
    else if (state === 'ended') current = { ...session, state: 'ended', endedBy: 'admin' }
    else if (state === 'expired') current = { ...session, expiresAt: new Date(now() - 60_000).toISOString(), state: 'expired', endedBy: 'expiry' }
    else if (state !== 'invalid') current = session
  }

  return {
    enter,
    current: () => withState(current),
    notice: () => withState(notice),
    end: (id: string) => end(id, 'portal'),
    endFromAdmin: (id: string) => end(id, 'admin'),
    harness,
  }
}

export type PortalSessionFixture = ReturnType<typeof createPortalSessionFixture>
