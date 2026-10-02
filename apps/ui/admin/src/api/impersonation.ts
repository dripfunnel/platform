// Staff sessions on the Admin API (ACCESS.md §8.1, §8.2; FIRST-RELEASE.md §8): impersonating a
// partner or store user, and setup sessions. The only place this app talks to the API about them.
import type { PartnerUserRole } from './partners'
import type { StoreUser } from './stores'
import { harnessEnabled } from '../harness'
import type { StaffRole } from '../features/shell/staffRoles'
import { impersonationServer } from './impersonationSample'
import type { PageInfo, PageRequest } from '@dripfunnel/shared/ui'
import type { ActionPermission } from './permissions'

// The contract agreed on #46 for #40 (ACCESS.md §8.3): every refusal the Admin API returns.
export const sessionRefusals = [
  'STAFF_ROLE_NOT_ALLOWED',
  'TARGET_NOT_ACTIVE',
  'PARTNER_CLOSED',
  'IMPERSONATION_ALREADY_OPEN',
  'SETUP_SESSION_ALREADY_OPEN',
  'IMPERSONATION_ALREADY_EXTENDED',
  'SETUP_SESSION_NOT_EXTENDABLE',
  'NOT_SESSION_OWNER',
  'REASON_REQUIRED',
  'REAUTH_REQUIRED',
  'SESSION_ENDED',
  'SESSION_EXPIRED',
  'NOT_FOUND',
] as const
export type SessionRefusal = (typeof sessionRefusals)[number]

export type SessionPermission = ActionPermission<SessionRefusal>

export const targetKinds = ['partnerUser', 'storeUser', 'supplierUser'] as const
export type TargetKind = (typeof targetKinds)[number]

export const targetStatuses = ['active', 'invited', 'suspended'] as const
export type TargetStatus = (typeof targetStatuses)[number]

export interface Ref {
  id: string
  name: string
}

// Where a user can be acted as: their partner's console, or one store (and one supplier there).
export type Membership =
  | { id: string; level: 'partner'; partner: Ref; role: PartnerUserRole }
  | { id: string; level: 'store'; partner: Ref; store: Ref; role: StoreUser['role']; supplier: string | null }

export type MembershipRole = Membership['role']

export const membershipRoles = ['owner', 'admin', 'support', 'finance', 'readOnly', 'manager', 'staff', 'supplierAdmin', 'supplierMember'] as const satisfies readonly MembershipRole[]

export interface ImpersonationTarget {
  id: string
  name: string
  email: string
  kind: TargetKind
  memberships: readonly Membership[]
  lastSignInAt: string | null
  status: TargetStatus
  impersonate: SessionPermission
  // The caller's own open session as this user, which Impersonate returns to instead.
  openSession: string | null
}

export interface TargetFilter {
  type?: TargetKind | undefined
  partner?: string | undefined
  store?: string | undefined
  role?: MembershipRole | undefined
  status?: TargetStatus | undefined
}

export interface TargetPage {
  items: readonly ImpersonationTarget[]
  pageInfo: PageInfo
  partners: readonly Ref[]
  stores: readonly (Ref & { partnerId: string })[]
}

export const sessionKinds = ['impersonation', 'setup'] as const
export type SessionKind = (typeof sessionKinds)[number]

export type SessionOutcome = 'open' | 'expired' | 'endedByStaff' | 'endedFromPortal' | 'targetGone' | 'partnerClosed'

export type SessionAction = 'end' | 'extend' | 'return'

// Never the handoff token: that exists only in the link that opens the portal (ACCESS.md §8.1).
export interface StaffSession {
  id: string
  kind: SessionKind
  staff: Ref
  target: Ref | null
  membership: Membership | null
  partner: Ref
  store: Ref | null
  host: string
  reason: string
  ticket: string | null
  startedAt: string
  expiresAt: string
  endedAt: string | null
  extendedAt: string | null
  outcome: SessionOutcome
  mine: boolean
  actions: Partial<Record<SessionAction, SessionPermission>>
}

export const sessionDates = ['today', '7d', '30d'] as const
export type SessionDate = (typeof sessionDates)[number]

export interface SessionFilter {
  kind?: SessionKind | undefined
  staff?: string | undefined
  partner?: string | undefined
  store?: string | undefined
  date?: SessionDate | undefined
}

export interface SessionPage {
  open: readonly StaffSession[]
  history: { items: readonly StaffSession[]; pageInfo: PageInfo }
  staff: readonly Ref[]
  partners: readonly Ref[]
  stores: readonly Ref[]
}

export type StartResult = { ok: true; session: StaffSession; handoff: string } | { ok: false; reason: SessionRefusal }
// A role that can't open a session is told so, not shown a missing page (decided on #46).
export type SessionLookup = { kind: 'found'; session: StaffSession } | { kind: 'denied' } | { kind: 'notFound' }

export type SessionResult = { ok: true } | { ok: false; reason: SessionRefusal }

// A fresh sign-in with the company SSO, proved to the API by a short-lived proof (CONSOLE-DESIGN A2).
export type Reauth = { ok: true; proof: string } | { ok: false; outcome: 'failed' | 'cancelled' }

export const impersonationMinutes = 30
export const setupSessionMinutes = 120
export const targetPageSize = 25
export const sessionPageSize = 25

const notConnected = () => Promise.reject(new Error('The Admin API has no staff-session operations yet (#40).'))

// Seam: replace the sample with #40's queries and mutations (FIRST-RELEASE.md §12) through
// createApiClient from @dripfunnel/shared/graphql once #40 lands; #68 wires them
// (https://github.com/dripfunnel/platform/issues/40). The search term goes in the POST body, never a
// URL. `caller` stands in for the session the API reads the role from. Sample data only under ?state=.
export const loadTargets = (filter: TargetFilter, page: PageRequest, search: string | null, caller: StaffRole): Promise<TargetPage | null> =>
  harnessEnabled ? Promise.resolve(impersonationServer.targets(filter, page, search, targetPageSize, caller)) : notConnected()

export const loadTarget = (membershipId: string, caller: StaffRole): Promise<ImpersonationTarget | null> =>
  harnessEnabled ? Promise.resolve(impersonationServer.target(membershipId, caller)) : notConnected()

export const loadSessions = (filter: SessionFilter, page: PageRequest, caller: StaffRole): Promise<SessionPage | null> =>
  harnessEnabled ? Promise.resolve(impersonationServer.sessions(filter, page, sessionPageSize, caller)) : notConnected()

export const loadSession = (id: string, caller: StaffRole): Promise<SessionLookup> =>
  harnessEnabled ? Promise.resolve(impersonationServer.session(id, caller)) : notConnected()

export const loadMySessions = (caller: StaffRole): Promise<readonly StaffSession[]> =>
  harnessEnabled ? Promise.resolve(impersonationServer.mine(caller)) : Promise.resolve([])

export const reauthenticate = (simulate: Reauth | null = null): Promise<Reauth> =>
  harnessEnabled ? impersonationServer.reauthenticate(simulate) : notConnected()

export const startImpersonation = (targetId: string, membershipId: string, reason: string, ticket: string | null, proof: string, caller: StaffRole): Promise<StartResult> =>
  harnessEnabled ? Promise.resolve(impersonationServer.startImpersonation(targetId, membershipId, reason, ticket, proof, caller)) : notConnected()

export const startSetupSession = (partnerId: string, reason: string, ticket: string | null, proof: string, caller: StaffRole): Promise<StartResult> =>
  harnessEnabled ? Promise.resolve(impersonationServer.startSetup(partnerId, reason, ticket, proof, caller)) : notConnected()

export const returnToSession = (id: string, caller: StaffRole): Promise<StartResult> =>
  harnessEnabled ? Promise.resolve(impersonationServer.returnTo(id, caller)) : notConnected()

export const endSession = (id: string, caller: StaffRole): Promise<SessionResult> =>
  harnessEnabled ? Promise.resolve(impersonationServer.end(id, caller)) : notConnected()

export const extendImpersonation = (id: string, caller: StaffRole): Promise<SessionResult> =>
  harnessEnabled ? Promise.resolve(impersonationServer.extend(id, caller)) : notConnected()
