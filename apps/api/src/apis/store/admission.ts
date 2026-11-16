import type postgres from 'postgres'
import { personSecondFactorSkipped, personSignedIn, type ActivityLog, type RequestFacts } from '#auth/activity'
import type { CodeCheck } from '#auth/codeCheck'
import type { SecretBox } from '#auth/secretBox'
import type { OpenCodeChannels } from '#auth/storeCodes'
import { wantsBodySession } from '#auth/storeCredential'
import { createUserSession, setStoreCookie, type UserSessionStage } from '#auth/storeSession'
import type { ScopedSql } from '#db/scoped/index'
import { markUserSignedIn, type SignInCandidate } from '#db/scoped/userSignIn'
import type { CodeChannelCheck } from '#saas/portalCodes/index'
import { json } from './authHttp'

export interface StoreAuthDeps {
  /** The domain of every store's free address (SHOP_DOMAIN), told to sign-up so it can show the address; null where none is set. */
  shopDomain?: string | null | undefined
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
  /** CODE_CHECK: 0 accepts any text code; email codes are always checked (#1002). */
  codeCheck?: CodeCheck
  /** Which channels reach a number: the partner's WhatsApp, and SMS through an account for its route (ACCESS.md §4). */
  codeChannels: CodeChannelCheck
}

export interface Admission {
  session: string
  stage: UserSessionStage
  remember: boolean
  method: 'app' | 'sms' | null
  /** For a phone-method second factor: where its code can go. */
  codeChannels: OpenCodeChannels | null
}

/**
 * A proven password opens a session as far as the person's second factor allows (ACCESS.md §4): reset and invitations too.
 * A phone-method person whose number neither WhatsApp nor SMS reaches goes in without it; the method is kept.
 */
export const admit = async (tx: ScopedSql, deps: StoreAuthDeps, facts: RequestFacts, candidate: SignInCandidate, remember: boolean, now: Date, via: 'google' | null = null): Promise<Admission> => {
  const user = { id: candidate.id, partnerId: candidate.partner_id }
  const codeChannels = candidate.two_factor_method === 'sms' ? await deps.codeChannels.forPartner(tx, candidate.partner_id, candidate.phone) : null
  const skipped = codeChannels !== null && !codeChannels.whatsapp && !codeChannels.sms
  const stage: UserSessionStage = candidate.two_factor_method && !skipped ? 'second-factor' : 'full'
  if (stage === 'full') {
    await markUserSignedIn(tx, user.id, now)
    if (skipped) await deps.activity.record(tx, personSecondFactorSkipped(user, facts))
    await deps.activity.record(tx, personSignedIn(user, facts, via))
  }
  const session = await createUserSession(tx, user, now, { stage, remember, userAgent: facts.userAgent })
  return { session, stage, remember, method: candidate.two_factor_method, codeChannels: stage === 'second-factor' ? codeChannels : null }
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

/** What follows the password: `done`, or the second factor with its method and, for a phone code, the open channels. */
export const stepOf = (a: Admission): Record<string, unknown> => ({
  ok: true,
  step: a.stage === 'full' ? 'done' : a.stage,
  ...(a.stage === 'second-factor' ? { method: a.method } : {}),
  ...(a.codeChannels ? { codeChannels: a.codeChannels } : {}),
})

export const admitted = (request: Request, a: Admission): Response => withSession(request, stepOf(a), { id: a.session, remember: a.remember, stage: a.stage })
