import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { factsOf, partnerSecondFactorEnrolled, partnerSecondFactorRefused, partnerSignedIn, partnerSignedOut, partnerSignInRefused } from '#auth/activity'
import { originAllowed, readCookie } from '#auth/cookie'
import { clearStaffPortalCookie, staffPortalCookieName } from '#auth/staffPortal'
import { safeNext } from '#auth/next'
import { verifyPassword } from '#auth/password'
import {
  clearPartnerCookie,
  completePartnerSession,
  createPartnerSession,
  endPartnerSession,
  partnerCookieName,
  readPendingSession,
  setPartnerCookie,
  setPendingSecret,
  type SessionStage,
} from '#auth/partnerSession'
import type { SecretBox } from '#auth/secretBox'
import { minutesUntil, wrongPartnerCode } from '#auth/partnerCode'
import { checkCode, newTotpSecret, otpauthUri } from '#auth/totp'
import { json, readBody, refuse, type Refusal } from './authHttp'
import { currentStaffSession, endOwnPortalSession, endStaffSessionFromPortal, exchangeHandoff, staffSessionPaths } from './staffSession'
import { acceptPartnerInvitation, lookUpInvitation, requestPasswordReset, resetPartnerPassword, skipSecondFactor } from './invitations'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import {
  markPartnerSignedIn,
  partnerOfUser,
  recordGoodCode,
  selectSecondFactorState,
  selectSignInCandidates,
  signInCandidateLimit,
  type SecondFactorState,
} from '#db/scoped/partnerUsers'

export interface PlatformAuthDeps {
  sql: postgres.Sql
  activity: ActivityLog
  platformHost: string
  /** The credential key (THIRD-PARTY-ACCESS.md §5); without it no second factor can be read or set. */
  secrets: SecretBox | null
  now: () => Date
  /** False when this key has made too many attempts (ARCHITECTURE.md §7). */
  allowAttempt: (key: string) => Promise<boolean>
}

const paths = {
  signIn: '/api/auth/sign-in',
  secondFactor: '/api/auth/second-factor',
  enrol: '/api/auth/enrol-second-factor',
  signOut: '/api/auth/sign-out',
  invitation: '/api/auth/invitation',
  acceptInvitation: '/api/auth/accept-invitation',
  skipSecondFactor: '/api/auth/skip-second-factor',
  requestPasswordReset: '/api/auth/request-password-reset',
  resetPassword: '/api/auth/reset-password',
}

export const isPlatformAuthPath = (pathname: string): boolean => Object.values(paths).includes(pathname) || Object.values<string>(staffSessionPaths).includes(pathname)

const signInInput = z.strictObject({ email: z.string().max(320), password: z.string().max(1024), next: z.string().max(2048).optional() })
const codeInput = z.strictObject({ code: z.string().max(16) })
const enrolInput = z.strictObject({ code: z.string().max(16).optional() })

export const handlePlatformAuth = async (request: Request, deps: PlatformAuthDeps): Promise<Response> => {
  const url = new URL(request.url)
  if (!originAllowed(request, deps.platformHost)) return new Response('Bad origin', { status: 403 })
  // GET is exempt from the Origin check, so no route here answers one.
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const facts = factsOf(request)
  const cookie = readCookie(request.headers.get('cookie'), partnerCookieName)

  if (url.pathname === paths.signOut) {
    const staffCookie = readCookie(request.headers.get('cookie'), staffPortalCookieName)
    if (staffCookie || cookie) {
      await withSystemScope(deps.sql, async (tx) => {
        // A staff member signing out of a session ends it (ACCESS.md §8.3), as End session does.
        if (staffCookie) await endOwnPortalSession(tx, staffCookie, null, deps, facts)
        const userId = cookie ? await endPartnerSession(tx, cookie) : null
        const partnerId = userId ? await partnerOfUser(tx, userId) : null
        if (userId && partnerId) await deps.activity.record(tx, partnerSignedOut({ id: userId, partnerId }, facts))
      })
    }
    const headers = new Headers({ location: '/' })
    headers.append('set-cookie', clearPartnerCookie())
    headers.append('set-cookie', clearStaffPortalCookie())
    return new Response(null, { status: 302, headers })
  }

  // Polled by every console tab, so outside the sign-in attempts' bucket; only a staff cookie costs a read, in a bucket of its own.
  if (url.pathname === staffSessionPaths.current) return currentStaffSession(request, deps, facts)
  if (url.pathname === staffSessionPaths.end) return endStaffSessionFromPortal(request, deps, facts)

  // Cloudflare sets the address on all real traffic; a request without one shares no bucket.
  if (facts.ip === null || !(await deps.allowAttempt(`ip:${facts.ip}`))) return refuse({ code: 'RATE_LIMITED' })

  if (url.pathname === staffSessionPaths.handoff) return exchangeHandoff(request, deps)
  if (url.pathname === paths.signIn) return signIn(request, deps, facts)
  if (url.pathname === paths.secondFactor) return secondFactor(request, deps, facts, cookie)
  if (url.pathname === paths.invitation) return lookUpInvitation(request, deps)
  if (url.pathname === paths.acceptInvitation) return acceptPartnerInvitation(request, deps, facts)
  if (url.pathname === paths.skipSecondFactor) return skipSecondFactor(deps, facts, cookie)
  if (url.pathname === paths.requestPasswordReset) return requestPasswordReset(request, deps, facts)
  if (url.pathname === paths.resetPassword) return resetPartnerPassword(request, deps, facts)
  return enrol(request, deps, facts, cookie)
}

const signIn = async (request: Request, deps: PlatformAuthDeps, facts: RequestFacts): Promise<Response> => {
  const input = await readBody(request, signInInput)
  // Per account as well as per address (ACCESS.md §4), keyed on what was typed, so it never says whether it exists.
  if (input && !(await deps.allowAttempt(`email:${input.email.trim().toLowerCase()}`))) return refuse({ code: 'RATE_LIMITED' })
  const now = deps.now()
  const next = safeNext(input?.next, `https://${deps.platformHost}`)

  const outcome = await withSystemScope(deps.sql, async (tx) => {
    const candidates = input ? await selectSignInCandidates(tx, input.email.trim()) : []
    // Always the same number of derivations, decoys making up the count, so the time taken says
    // nothing about how many accounts, if any, the email has (ACCESS.md §2).
    let matched = null
    for (let i = 0; i < signInCandidateLimit; i += 1) {
      const candidate = candidates[i] ?? null
      if ((await verifyPassword(input?.password ?? '', candidate?.password_hash ?? null)) && candidate && !matched) matched = candidate
    }
    if (!matched) {
      await deps.activity.record(tx, partnerSignInRefused(facts, 'invalid_credentials'))
      return { refusal: { code: 'INVALID_CREDENTIALS' } as const }
    }
    const user = { id: matched.id, partnerId: matched.partner_id }
    if (matched.locked_until && matched.locked_until > now) {
      await deps.activity.record(tx, partnerSignInRefused(facts, 'locked'))
      return { refusal: { code: 'LOCKED', minutes: minutesUntil(matched.locked_until, now) } as const }
    }
    const stage: SessionStage = matched.has_second_factor ? 'second-factor' : matched.second_factor_required ? 'enrol' : 'full'
    if (stage === 'full') {
      await markPartnerSignedIn(tx, user.id, now)
      await deps.activity.record(tx, partnerSignedIn(user, facts))
    }
    return { session: await createPartnerSession(tx, user.id, now, stage), stage }
  })

  if ('refusal' in outcome) return refuse(outcome.refusal)
  const step = outcome.stage === 'full' ? 'done' : outcome.stage
  return json(200, { ok: true, step, next }, setPartnerCookie(outcome.session))
}

const secondFactor = async (request: Request, deps: PlatformAuthDeps, facts: RequestFacts, cookie: string | null): Promise<Response> => {
  const input = await readBody(request, codeInput)
  if (!deps.secrets) return refuse({ code: 'NOT_CONNECTED' })
  const secrets = deps.secrets
  const now = deps.now()
  const outcome = await withSystemScope(deps.sql, async (tx): Promise<Refusal | null> => {
    const pending = cookie ? await readPendingSession(tx, cookie, 'second-factor', now) : null
    const state = pending ? await selectSecondFactorState(tx, pending.partnerUserId) : null
    const secret = state?.two_factor_secret_enc ? await secrets.open(state.two_factor_secret_enc) : null
    if (!cookie || !state || !secret) return { code: 'INVALID_CREDENTIALS' }
    // A correct code during the lock is still refused (FIRST-RELEASE §3).
    if (state.locked_until && state.locked_until > now) return { code: 'LOCKED', minutes: minutesUntil(state.locked_until, now) }
    const checked = await checkCode(secret, input?.code ?? '', now, state.last_code_step === null ? null : Number(state.last_code_step))
    if (!checked.ok) {
      await deps.activity.record(tx, partnerSecondFactorRefused({ id: state.id, partnerId: state.partner_id }, facts, checked.code))
      return checked.code === 'WRONG_CODE' ? wrongCode(tx, deps, facts, state, now) : { code: checked.code }
    }
    await recordGoodCode(tx, state.id, checked.step, now)
    await completePartnerSession(tx, cookie, now)
    await deps.activity.record(tx, partnerSignedIn({ id: state.id, partnerId: state.partner_id }, facts))
    return null
  })
  return outcome ? refuse(outcome) : json(200, { ok: true })
}

const wrongCode = (tx: ScopedSql, deps: PlatformAuthDeps, facts: RequestFacts, state: SecondFactorState, now: Date): Promise<Refusal> =>
  wrongPartnerCode(tx, deps.activity, facts, state, now)

// Called first with no code, which issues the secret (shown once, as text and as the URI a QR
// code encodes), then with the code that proves the app holds it.
const enrol = async (request: Request, deps: PlatformAuthDeps, facts: RequestFacts, cookie: string | null): Promise<Response> => {
  const input = await readBody(request, enrolInput)
  if (!deps.secrets) return refuse({ code: 'NOT_CONNECTED' })
  const secrets = deps.secrets
  const now = deps.now()
  const outcome = await withSystemScope(deps.sql, async (tx): Promise<Refusal | { secret: string; uri: string } | null> => {
    const pending = cookie ? await readPendingSession(tx, cookie, 'enrol', now) : null
    const state = pending ? await selectSecondFactorState(tx, pending.partnerUserId) : null
    // Enrolment only ever sets a first secret: a stale enrol session must not replace one the
    // user has since set up elsewhere, which this session never proved.
    if (!cookie || !pending || !state || !input || state.two_factor_secret_enc !== null) return { code: 'INVALID_CREDENTIALS' }
    if (input.code === undefined) {
      const secret = newTotpSecret()
      await setPendingSecret(tx, cookie, await secrets.seal(secret))
      return { secret, uri: otpauthUri(secret, state.email) }
    }
    const secret = pending.pendingSecretEnc ? await secrets.open(pending.pendingSecretEnc) : null
    if (!secret) return { code: 'INVALID_CREDENTIALS' }
    const checked = await checkCode(secret, input.code, now, null)
    // Not counted towards the lock: the code is checked against a secret this session was just given.
    if (!checked.ok) {
      await deps.activity.record(tx, partnerSecondFactorRefused({ id: state.id, partnerId: state.partner_id }, facts, checked.code))
      return { code: checked.code }
    }
    const user = { id: state.id, partnerId: state.partner_id }
    await recordGoodCode(tx, state.id, checked.step, now, pending.pendingSecretEnc)
    await completePartnerSession(tx, cookie, now)
    await deps.activity.record(tx, partnerSecondFactorEnrolled(user, facts))
    await deps.activity.record(tx, partnerSignedIn(user, facts))
    return null
  })
  if (outcome === null) return json(200, { ok: true })
  return 'code' in outcome ? refuse(outcome) : json(200, { ok: true, ...outcome })
}
