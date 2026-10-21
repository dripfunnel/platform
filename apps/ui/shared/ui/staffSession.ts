// A staff session as a portal sees it (ACCESS.md §8.1, §8.2): staff acting as a user, or as
// themselves with a partner's setup powers. The words are each app's; this holds the rules.
export type StaffSessionKind = 'impersonation' | 'setup'

export type StaffSessionState = 'open' | 'ended' | 'expired'

// Who closed it, so the ended card can say where it happened.
export type StaffSessionEndedBy = 'admin' | 'portal' | 'expiry'

export interface PortalStaffSession {
  id: string
  kind: StaffSessionKind
  state: StaffSessionState
  endedBy: StaffSessionEndedBy | null
  staffName: string
  // Impersonation only: the user acted as, their role and where, already in words.
  actingAs: { name: string; role: string; where: string } | null
  partnerName: string
  host: string
  expiresAt: string
}

export const sessionControls = ['password', 'twoFactor', 'signInMethods', 'paymentMethod', 'payoutDetails', 'ownership'] as const
export type SessionControl = (typeof sessionControls)[number]

export type SessionBlock = 'BLOCKED_WHILE_IMPERSONATING' | 'PARTNER_ENTERS_THIS_ITSELF'

// The server refuses these anyway (#40); the portal disables them with the reason where it can tell.
const blocked: Record<StaffSessionKind, readonly SessionControl[]> = {
  impersonation: sessionControls,
  setup: ['paymentMethod', 'payoutDetails', 'ownership'],
}

export const blockedFor = (kind: StaffSessionKind | null, control: SessionControl): SessionBlock | null => {
  if (!kind || !blocked[kind].includes(control)) return null
  return kind === 'impersonation' ? 'BLOCKED_WHILE_IMPERSONATING' : 'PARTNER_ENTERS_THIS_ITSELF'
}

// Whole minutes left, rounded up, so "1 min" shows until the moment it ends.
export const secondsLeft = (expiresAt: string, now: number): number => Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60_000) * 60)

// What the portal shows: the server's state, or expired as soon as the clock passes the end.
export const sessionStateAt = (session: PortalStaffSession, now: number): StaffSessionState =>
  session.state === 'open' && Date.parse(session.expiresAt) <= now ? 'expired' : session.state

export const firstName = (name: string): string => name.split(' ')[0] ?? name
