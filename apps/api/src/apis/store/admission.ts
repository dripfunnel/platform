import type postgres from 'postgres'
import { personSignedIn, type ActivityLog, type RequestFacts } from '#auth/activity'
import type { CodeCheck } from '#auth/codeCheck'
import type { SecretBox } from '#auth/secretBox'
import { wantsBodySession } from '#auth/storeCredential'
import { createUserSession, setStoreCookie, type UserSessionStage } from '#auth/storeSession'
import type { ScopedSql } from '#db/scoped/index'
import { markUserSignedIn, type SignInCandidate } from '#db/scoped/userSignIn'
import { json } from './authHttp'

export interface StoreAuthDeps {
  sql: postgres.Sql
  activity: ActivityLog
  /** The host's partner; every account and session here is that partner's. */
  partnerId: string
  host: string
  /** The credential key (THIRD-PARTY-ACCESS §5); without it no second factor can be read or set. */
  secrets: SecretBox | null
  now: () => Date
  /** False when this key has made too many attempts (ARCHITECTURE.md §7). */
  allowAttempt: (key: string) => Promise<boolean>
  /** CODE_CHECK: 0 accepts any email or text code, on dev and localhost only. */
  codeCheck?: CodeCheck
}

export interface Admission {
  session: string
  stage: UserSessionStage
  remember: boolean
  method: 'app' | 'sms' | null
}

/** A proven password opens a session as far as the person's second factor allows (ACCESS.md §4): reset and invitations too. */
export const admit = async (tx: ScopedSql, deps: StoreAuthDeps, facts: RequestFacts, candidate: SignInCandidate, remember: boolean, now: Date): Promise<Admission> => {
  const user = { id: candidate.id, partnerId: candidate.partner_id }
  const stage: UserSessionStage = candidate.two_factor_method ? 'second-factor' : candidate.is_owner ? 'enrol' : 'full'
  if (stage === 'full') {
    await markUserSignedIn(tx, user.id, now)
    await deps.activity.record(tx, personSignedIn(user, facts))
  }
  const session = await createUserSession(tx, user, now, { stage, remember, userAgent: facts.userAgent })
  return { session, stage, remember, method: candidate.two_factor_method }
}

export interface OpenedSession {
  id: string
  remember: boolean
  stage?: UserSessionStage
}

/** The session as the cookie, or in the body as `token` for the mobile app (ACCESS.md §4); never both. */
export const withSession = (request: Request, body: Record<string, unknown>, session: OpenedSession | null): Response => {
  if (!session) return json(200, body)
  return wantsBodySession(request) ? json(200, { ...body, token: session.id }) : json(200, body, setStoreCookie(session.id, session.remember, session.stage))
}

export const admitted = (request: Request, a: Admission): Response =>
  withSession(request, { ok: true, step: a.stage === 'full' ? 'done' : a.stage, ...(a.stage === 'second-factor' ? { method: a.method } : {}) }, { id: a.session, remember: a.remember, stage: a.stage })
