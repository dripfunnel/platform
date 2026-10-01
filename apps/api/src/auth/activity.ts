import type { SignInRefusal } from '#auth/oidc'
import type { ScopedSql } from '#db/scoped/index'

/**
 * The shape #15 will persist (LOGGING.md §4). Agreed here so sign-in and sign-out are
 * recorded from the start and #15 implements this interface rather than replacing it.
 */
export interface ActivityEntry {
  category: 'auth' | 'write' | 'support' | 'system' | 'security'
  action: string
  result: 'success' | 'denied' | 'failed'
  actorKind: 'staff' | 'partner_user' | 'person' | 'customer' | 'api_key' | 'app_grant' | 'support_session' | 'job' | 'provider' | 'anonymous'
  actorId: string | null
  /** Name and email at the time, so the entry still reads after a rename (LOGGING.md §4). */
  actorLabel: string | null
  /** Why, where the action needs one (LOGGING.md §4). Never free text from a caller. */
  reason: string | null
  requestId: string | null
  ip: string | null
  userAgent: string | null
}

export interface ActivityLog {
  record: (tx: ScopedSql, entry: ActivityEntry) => Promise<void>
}

/**
 * Until #15 builds the table: a structured, PII-free line so a failed staff sign-in still
 * leaves a trace (LOGGING.md §9). Nothing may depend on reading one back.
 */
export const interimActivityLog: ActivityLog = {
  record: async (_tx, entry) => {
    console.log(
      JSON.stringify({
        log: 'activity_pending_15',
        category: entry.category,
        action: entry.action,
        result: entry.result,
        actorKind: entry.actorKind,
        actorId: entry.actorId,
        reason: entry.reason,
        requestId: entry.requestId,
      }),
    )
  },
}

export const signedIn = (staff: { id: string; email: string; name: string }, request: RequestFacts): ActivityEntry => ({
  category: 'auth',
  action: 'staff.signed_in',
  result: 'success',
  actorKind: 'staff',
  actorId: staff.id,
  actorLabel: `${staff.name} <${staff.email}>`,
  reason: null,
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
