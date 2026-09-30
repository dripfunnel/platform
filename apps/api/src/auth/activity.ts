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
  requestId: string | null
  ip: string | null
  userAgent: string | null
}

export interface ActivityLog {
  record: (tx: ScopedSql, entry: ActivityEntry) => Promise<void>
}

/**
 * Until #15 builds the table. It drops entries rather than storing them, which is why
 * nothing here may depend on reading one back.
 */
export const noopActivityLog: ActivityLog = { record: async () => {} }

export const signedIn = (staff: { id: string; email: string; name: string }, request: RequestFacts): ActivityEntry => ({
  category: 'auth',
  action: 'staff.signed_in',
  result: 'success',
  actorKind: 'staff',
  actorId: staff.id,
  actorLabel: `${staff.name} <${staff.email}>`,
  ...request,
})

export const signedOut = (staffId: string, request: RequestFacts): ActivityEntry => ({
  category: 'auth',
  action: 'staff.signed_out',
  result: 'success',
  actorKind: 'staff',
  actorId: staffId,
  actorLabel: null,
  ...request,
})

/** A refusal names no subject: the entry must not become the enumeration the response avoids. */
export const signInRefused = (request: RequestFacts): ActivityEntry => ({
  category: 'security',
  action: 'staff.sign_in_refused',
  result: 'denied',
  actorKind: 'anonymous',
  actorId: null,
  actorLabel: null,
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
