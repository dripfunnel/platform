import type { Change } from '#core/redaction'
import type { AccessKind, ActivityApi, ActivityCategory, ActivityResult, ActorKind, AgentKind, Visibility } from '#db/schema/activity'
import type { ScopedSql } from '#db/scoped/index'
import type { SignInRefusal } from '#auth/oidc'

/**
 * One entry of LOGGING.md §4. `auth/` builds sign-in and sign-out entries; every write's
 * entry comes from its resolver's declaration. `saas/activity` persists them.
 */
export interface ActivityEntry {
  /** Null means the database's clock. */
  occurredAt?: Date | null
  category: ActivityCategory
  action: string
  result: ActivityResult
  actorKind: ActorKind
  actorId: string | null
  /** Name and email at the time, so the entry still reads after a rename (LOGGING.md §4). */
  actorLabel: string | null
  /** The real agent behind a support session or an impersonation; null otherwise. */
  onBehalfOf?: { kind: AgentKind; id: string; label: string } | null
  /** The session the action ran under; null for a person's own session. */
  access?: { kind: AccessKind; id: string } | null
  partnerId?: string | null
  storeId?: string | null
  sellerId?: string | null
  customerId?: string | null
  target?: { type: string; id: string; label: string } | null
  /** Redacted on write (LOGGING.md §4.1); the caller passes the raw before and after. */
  changes?: readonly Change[]
  /** Why, where the action needs one (LOGGING.md §4). Never free text from a caller. */
  reason: string | null
  api?: ActivityApi | null
  host?: string | null
  requestId: string | null
  ip: string | null
  userAgent: string | null
  visibility: Visibility
}

export interface ActivityLog {
  record: (tx: ScopedSql, entry: ActivityEntry) => Promise<void>
}

export const signedIn = (staff: { id: string; email: string; name: string }, request: RequestFacts): ActivityEntry => ({
  category: 'auth',
  action: 'staff.signed_in',
  result: 'success',
  actorKind: 'staff',
  actorId: staff.id,
  actorLabel: `${staff.name} <${staff.email}>`,
  reason: null,
  api: 'admin',
  visibility: 'staff',
  ...request,
})

export const signedOut = (staffId: string, request: RequestFacts): ActivityEntry => ({
  category: 'auth',
  action: 'staff.signed_out',
  result: 'success',
  actorKind: 'staff',
  actorId: staffId,
  actorLabel: null,
  reason: null,
  api: 'admin',
  visibility: 'staff',
  ...request,
})

/** CONSOLE-DESIGN A2: the credential behind a dangerous action, recorded like the sign-in. */
export const reauthenticated = (staff: { id: string; email: string; name: string }, request: RequestFacts): ActivityEntry => ({
  category: 'auth',
  action: 'staff.reauthenticated',
  result: 'success',
  actorKind: 'staff',
  actorId: staff.id,
  actorLabel: `${staff.name} <${staff.email}>`,
  reason: null,
  api: 'admin',
  visibility: 'staff',
  ...request,
})

const partnerUserEntry = (action: string, category: 'auth' | 'security', user: { id: string; partnerId: string }, request: RequestFacts): ActivityEntry => ({
  category,
  action,
  result: 'success',
  actorKind: 'partner_user',
  actorId: user.id,
  actorLabel: null,
  partnerId: user.partnerId,
  reason: null,
  api: 'platform',
  visibility: 'partner',
  ...request,
})

/** LOGGING.md §6: the partner's own users' actions are what its activity log shows. */
export const partnerSignedOut = (user: { id: string; partnerId: string }, request: RequestFacts) => partnerUserEntry('partner_user.signed_out', 'auth', user, request)

export const partnerSignedIn = (user: { id: string; partnerId: string }, request: RequestFacts) => partnerUserEntry('partner_user.signed_in', 'auth', user, request)

/** ACCESS.md §8: a code given to open a support session; the proof itself is never logged. */
export const partnerReauthenticated = (user: { id: string; partnerId: string }, request: RequestFacts) => partnerUserEntry('partner_user.reauthenticated', 'security', user, request)

export const partnerSecondFactorEnrolled = (user: { id: string; partnerId: string }, request: RequestFacts) =>
  partnerUserEntry('partner_user.second_factor_enrolled', 'security', user, request)

/** Five wrong codes (FIRST-RELEASE §3): the account's own partner sees it, as staff do. */
export const partnerLocked = (user: { id: string; partnerId: string }, request: RequestFacts): ActivityEntry => ({
  ...partnerUserEntry('partner_user.sign_in_locked', 'security', user, request),
  result: 'denied',
})

/** A wrong or stale code: the account is known by then, so its partner sees the attempt too. */
export const partnerSecondFactorRefused = (user: { id: string; partnerId: string }, request: RequestFacts, reason: 'WRONG_CODE' | 'CODE_EXPIRED'): ActivityEntry => ({
  ...partnerUserEntry('partner_user.second_factor_refused', 'security', user, request),
  result: 'denied',
  reason,
})

/** Names no subject, like the staff refusal, so the log never becomes the enumeration the answer avoids. */
export const partnerSignInRefused = (request: RequestFacts, reason: 'invalid_credentials' | 'locked'): ActivityEntry => ({
  category: 'security',
  action: 'partner_user.sign_in_refused',
  result: 'denied',
  actorKind: 'anonymous',
  actorId: null,
  actorLabel: null,
  reason,
  api: 'platform',
  visibility: 'staff',
  ...request,
})

/** A refusal names no subject: the entry must not become the enumeration the response avoids. */
export const signInRefused = (request: RequestFacts, refusal: SignInRefusal): ActivityEntry => ({
  category: 'security',
  action: 'staff.sign_in_refused',
  result: 'denied',
  actorKind: 'anonymous',
  actorId: null,
  actorLabel: null,
  reason: refusal,
  api: 'admin',
  visibility: 'staff',
  ...request,
})

export interface RequestFacts {
  requestId: string | null
  ip: string | null
  userAgent: string | null
}

export const factsOf = (request: Request): RequestFacts => ({
  requestId: request.headers.get('cf-ray'),
  ip: request.headers.get('cf-connecting-ip'),
  userAgent: request.headers.get('user-agent'),
})
