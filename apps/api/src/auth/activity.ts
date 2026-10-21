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
  /** Many entries in one statement, for a bulk action's one entry per target (AGENTS.md "no N+1"). */
  recordAll: (tx: ScopedSql, entries: readonly ActivityEntry[]) => Promise<void>
}

/** A staff session ended in the partner console: by the staff member, or by its user or partner going (ACCESS.md §8.1, §8.2). */
export const staffSessionEnded = (
  s: { kind: 'impersonation' | 'setup'; id: string; staff_id: string; staff_name: string; staff_email: string; partner_id: string; partner_name: string; target_id: string | null; target_name: string | null },
  facts: RequestFacts,
  why: 'portal' | 'target_gone' | 'partner_closed',
): ActivityEntry => ({
  category: 'support',
  action: s.kind === 'impersonation' ? 'impersonation.ended' : 'setup_session.ended',
  result: 'success',
  ...(why === 'portal' ? { actorKind: 'staff' as const, actorId: s.staff_id, actorLabel: `${s.staff_name} <${s.staff_email}>` } : { actorKind: 'job' as const, actorId: null, actorLabel: null }),
  access: { kind: s.kind === 'impersonation' ? 'impersonation' : 'setup_session', id: s.id },
  partnerId: s.partner_id,
  target: s.target_id && s.target_name ? { type: 'partner_user', id: s.target_id, label: s.target_name } : { type: 'partner', id: s.partner_id, label: s.partner_name },
  // A code, never free text (LOGGING.md §4).
  reason: why === 'portal' ? null : why,
  api: 'platform',
  visibility: 'partner',
  ...facts,
})

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

/** The invitee bound their SSO account (ui/admin/FIRST-RELEASE.md §10); no token is logged. */
export const invitationAccepted = (staff: { id: string; email: string; name: string }, request: RequestFacts): ActivityEntry => ({
  ...signedIn(staff, request),
  action: 'staff.invitation_accepted',
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

/** ACCESS.md §6.2: the token proves the address; neither it nor the password is logged. */
export const partnerInvitationAccepted = (user: { id: string; partnerId: string }, request: RequestFacts) =>
  partnerUserEntry('partner_user.invitation_accepted', 'auth', user, request)

export const partnerPasswordResetRequested = (user: { id: string; partnerId: string }, request: RequestFacts) =>
  partnerUserEntry('partner_user.password_reset_requested', 'security', user, request)

export const partnerPasswordReset = (user: { id: string; partnerId: string }, request: RequestFacts) => partnerUserEntry('partner_user.password_reset', 'security', user, request)

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

// A merchant or supplier person on a portal host (#290). Visibility `self`: a person spans the
// partner's stores, so their sign-ins are theirs to see, and staff's (LOGGING.md §6).
const personEntry = (action: string, category: 'auth' | 'security', user: { id: string; partnerId: string }, request: RequestFacts, reason: string | null = null): ActivityEntry => ({
  category,
  action,
  result: 'success',
  actorKind: 'person',
  actorId: user.id,
  actorLabel: null,
  partnerId: user.partnerId,
  reason,
  api: 'store',
  visibility: 'self',
  ...request,
})

export const personSignedIn = (user: { id: string; partnerId: string }, request: RequestFacts) => personEntry('person.signed_in', 'auth', user, request)
export const personSignedOut = (user: { id: string; partnerId: string }, request: RequestFacts) => personEntry('person.signed_out', 'auth', user, request)
// LOGGING.md §3 names these three for the merchant portal.
export const personSecondFactorEnrolled = (user: { id: string; partnerId: string }, request: RequestFacts, method: 'app' | 'sms') =>
  personEntry('two_factor.enabled', 'security', user, request, method)
export const personBackupCodesGenerated = (user: { id: string; partnerId: string }, request: RequestFacts) => personEntry('backup_codes.generated', 'security', user, request)
export const personBackupCodeUsed = (user: { id: string; partnerId: string }, request: RequestFacts) => personEntry('backup_code.used', 'security', user, request)
export const personLocked = (user: { id: string; partnerId: string }, request: RequestFacts) => ({ ...personEntry('person.locked', 'security', user, request), result: 'denied' as const })
export const personCodeRefused = (user: { id: string; partnerId: string }, request: RequestFacts, code: string) => ({ ...personEntry('person.second_factor_refused', 'security', user, request, code), result: 'denied' as const })

/** No account is named: the same entry whether the email exists or not (ACCESS.md §2). */
export const personSignInRefused = (partnerId: string, request: RequestFacts, reason: 'invalid_credentials' | 'locked'): ActivityEntry => ({
  category: 'auth',
  action: 'person.sign_in_refused',
  result: 'denied',
  actorKind: 'anonymous',
  actorId: null,
  actorLabel: null,
  partnerId,
  reason,
  api: 'store',
  visibility: 'staff',
  ...request,
})

/** ACCESS.md §6.2: the store's own log shows who joined, as what; the token is never logged. */
export const personJoinedStore = (user: { id: string; partnerId: string }, request: RequestFacts, store: { id: string; name: string }, sellerId: string | null, role: string): ActivityEntry => ({
  ...personEntry('person.invitation_accepted', 'auth', user, request, role),
  storeId: store.id,
  sellerId,
  target: { type: 'store', id: store.id, label: store.name },
  visibility: 'store',
})
export const personPasswordResetRequested = (user: { id: string; partnerId: string }, request: RequestFacts) => personEntry('person.password_reset_requested', 'security', user, request)
export const personPasswordReset = (user: { id: string; partnerId: string }, request: RequestFacts) => personEntry('person.password_reset', 'security', user, request)
// My profile (FIRST-RELEASE §4); LOGGING.md §3 names the two-factor and session codes.
export const personProfileUpdated = (user: { id: string; partnerId: string }, request: RequestFacts) => personEntry('person.profile_updated', 'auth', user, request)
export const personPasswordChanged = (user: { id: string; partnerId: string }, request: RequestFacts) => personEntry('person.password_changed', 'security', user, request)
export const personEmailChangeRequested = (user: { id: string; partnerId: string }, request: RequestFacts) => personEntry('person.email_change_requested', 'security', user, request)
export const personEmailChanged = (user: { id: string; partnerId: string }, request: RequestFacts) => personEntry('person.email_changed', 'security', user, request)
export const personSecondFactorChanged = (user: { id: string; partnerId: string }, request: RequestFacts, method: 'app' | 'sms') =>
  personEntry('two_factor.method_changed', 'security', user, request, method)
export const personSecondFactorDisabled = (user: { id: string; partnerId: string }, request: RequestFacts) => personEntry('two_factor.disabled', 'security', user, request)
export const personOtherSessionsEnded = (user: { id: string; partnerId: string }, request: RequestFacts) => personEntry('sessions.others_ended', 'security', user, request)
