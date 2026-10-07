import { z } from 'zod'
import {
  factsOf,
  personBackupCodesGenerated,
  personBackupCodeUsed,
  personCodeRefused,
  personSecondFactorEnrolled,
  personSignedIn,
  personSignedOut,
  personSignInRefused,
  type RequestFacts,
} from '#auth/activity'
import { originAllowed, readCookie } from '#auth/cookie'
import { lockMs, minutesUntil } from '#auth/partnerCode'
import { verifyPassword } from '#auth/password'
import { hashBackupCode, maxSmsCodesPer10Min, newBackupCodes, phoneHint } from '#auth/storeCodes'
import {
  clearStoreCookie,
  completeUserSession,
  endUserSession,
  readPendingUserSession,
  setPendingEnrolment,
  setStoreCookie,
  storeCookieName,
  type PendingUserSession,
} from '#auth/storeSession'
import { checkCode, newTotpSecret, otpauthUri } from '#auth/totp'
import { isE164 } from '#core/sms'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import {
  countCodesSince,
  recordUserGoodCode,
  replaceBackupCodes,
  selectSignInCandidate,
  selectUserSecondFactor,
  setUserSecondFactor,
  spendBackupCode,
  type UserSecondFactor,
} from '#db/scoped/userSignIn'
import { admit, admitted, type StoreAuthDeps } from './admission'
import { brandName, checkTextedCode, countWrong, textCode } from './codes'
import { confirmEmailChange } from './emailChange'
import { sendSignupPhoneCode, signupCookieName, signupStore, startSignup, verifySignupEmail, verifySignupPhone } from './signup'
import { acceptStoreInvitation, joinStore, lookUpStoreInvitation, requestStorePasswordReset, resetStorePassword } from './invitations'
import { json, readBody, refuse, type Refusal } from './authHttp'

export type { StoreAuthDeps } from './admission'

// Sign-in on a partner's portal host (ACCESS.md §2, §4; FIRST-RELEASE §4; #290): the same shape
// as the partner console's (apis/platform/auth.ts), with SMS codes and backup codes besides an
// authenticator app, and 2-factor required of every Owner.

const paths = {
  signIn: '/api/auth/sign-in',
  sendCode: '/api/auth/send-code',
  secondFactor: '/api/auth/second-factor',
  backupCode: '/api/auth/backup-code',
  enrol: '/api/auth/enrol-second-factor',
  signOut: '/api/auth/sign-out',
  invitation: '/api/auth/invitation',
  acceptInvitation: '/api/auth/accept-invitation',
  join: '/api/auth/join',
  requestReset: '/api/auth/request-password-reset',
  reset: '/api/auth/reset-password',
  confirmEmail: '/api/auth/confirm-email',
  signUp: '/api/auth/sign-up',
  signUpEmail: '/api/auth/sign-up/verify-email',
  signUpStore: '/api/auth/sign-up/store',
  signUpPhone: '/api/auth/sign-up/send-phone',
  signUpVerifyPhone: '/api/auth/sign-up/verify-phone',
}

const isRefusal = (value: Refusal | Record<string, unknown>): value is Refusal => typeof value['code'] === 'string'

export const isStoreAuthPath = (pathname: string): boolean => Object.values(paths).includes(pathname)

const signInInput = z.strictObject({ email: z.string().max(320), password: z.string().max(1024), remember: z.boolean().optional() })
const codeInput = z.strictObject({ code: z.string().max(32) })
const enrolInput = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('app'), code: z.string().max(16).optional() }),
  z.strictObject({ method: z.literal('sms'), phone: z.string().max(20).optional(), code: z.string().max(16).optional() }),
])


export const handleStoreAuth = async (request: Request, deps: StoreAuthDeps): Promise<Response> => {
  const url = new URL(request.url)
  if (!originAllowed(request, deps.host)) return new Response('Bad origin', { status: 403 })
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const facts = factsOf(request)
  const cookie = readCookie(request.headers.get('cookie'), storeCookieName)

  if (url.pathname === paths.signOut) {
    if (cookie) {
      await withSystemScope(deps.sql, async (tx) => {
        const ended = await endUserSession(tx, cookie)
        if (ended) await deps.activity.record(tx, personSignedOut({ id: ended.userId, partnerId: ended.partnerId }, facts))
      })
    }
    return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': clearStoreCookie() } })
  }

  // Per address, per host: one partner's portal never spends another's attempts.
  if (facts.ip === null || !(await deps.allowAttempt(`store:${deps.host}:ip:${facts.ip}`))) return refuse({ code: 'RATE_LIMITED' })
  if (url.pathname === paths.signIn) return signIn(request, deps, facts)
  if (url.pathname === paths.sendCode) return sendSignInCode(deps, facts, cookie)
  if (url.pathname === paths.secondFactor) return secondFactor(request, deps, facts, cookie)
  if (url.pathname === paths.backupCode) return backupCode(request, deps, facts, cookie)
  if (url.pathname === paths.invitation) return lookUpStoreInvitation(request, deps)
  if (url.pathname === paths.acceptInvitation) return acceptStoreInvitation(request, deps, facts)
  if (url.pathname === paths.join) return joinStore(request, deps, facts, cookie)
  if (url.pathname === paths.requestReset) return requestStorePasswordReset(request, deps, facts)
  if (url.pathname === paths.reset) return resetStorePassword(request, deps, facts)
  if (url.pathname === paths.confirmEmail) return confirmEmailChange(request, deps, facts)
  const signup = readCookie(request.headers.get('cookie'), signupCookieName)
  if (url.pathname === paths.signUp) return startSignup(request, deps)
  if (url.pathname === paths.signUpEmail) return verifySignupEmail(request, deps, signup)
  if (url.pathname === paths.signUpStore) return signupStore(request, deps, signup)
  if (url.pathname === paths.signUpPhone) return sendSignupPhoneCode(request, deps, signup)
  if (url.pathname === paths.signUpVerifyPhone) return verifySignupPhone(request, deps, facts, signup)
  return enrol(request, deps, facts, cookie)
}

const signIn = async (request: Request, deps: StoreAuthDeps, facts: RequestFacts): Promise<Response> => {
  const input = await readBody(request, signInInput)
  // Per account too, keyed on what was typed, so it never says whether the account exists.
  if (input && !(await deps.allowAttempt(`store:${deps.host}:email:${input.email.trim().toLowerCase()}`))) return refuse({ code: 'RATE_LIMITED' })
  const now = deps.now()
  const outcome = await withSystemScope(deps.sql, async (tx) => {
    const candidate = input ? await selectSignInCandidate(tx, deps.partnerId, input.email.trim()) : null
    // Always one derivation, a decoy when there's no account, so the time says nothing (ACCESS.md §2).
    const ok = await verifyPassword(input?.password ?? '', candidate?.password_hash ?? null)
    if (!candidate || !ok) {
      await deps.activity.record(tx, personSignInRefused(deps.partnerId, facts, 'invalid_credentials'))
      // The answer stays the same either way (ACCESS.md §2): the pause shows only to the right password.
      if (candidate && !(candidate.locked_until && candidate.locked_until > now)) await countWrong(tx, deps.activity, facts, candidate, now)
      return { refusal: { code: 'INVALID_CREDENTIALS' } as const }
    }
    if (candidate.locked_until && candidate.locked_until > now) {
      await deps.activity.record(tx, personSignInRefused(deps.partnerId, facts, 'locked'))
      return { refusal: { code: 'LOCKED', minutes: minutesUntil(candidate.locked_until, now) } as const }
    }
    return admit(tx, deps, facts, candidate, input?.remember ?? false, now)
  })
  if ('refusal' in outcome) return refuse(outcome.refusal)
  return admitted(outcome)
}

const wrongCode = async (tx: ScopedSql, deps: StoreAuthDeps, facts: RequestFacts, state: UserSecondFactor, now: Date): Promise<Refusal> => {
  const { triesLeft, locked } = await countWrong(tx, deps.activity, facts, state, now)
  return locked ? { code: 'LOCKED', minutes: lockMs / 60_000 } : { code: 'WRONG_CODE', triesLeft }
}

const pendingSecondFactor = async (tx: ScopedSql, deps: StoreAuthDeps, cookie: string | null, now: Date): Promise<{ pending: PendingUserSession; state: UserSecondFactor } | null> => {
  const pending = cookie ? await readPendingUserSession(tx, cookie, deps.partnerId, 'second-factor', now) : null
  const state = pending ? await selectUserSecondFactor(tx, pending.userId) : null
  return pending && state ? { pending, state } : null
}

/** Texts the sign-in code to the person's own number; answers the same hint whether or not a text went. */
const sendSignInCode = async (deps: StoreAuthDeps, facts: RequestFacts, cookie: string | null): Promise<Response> => {
  const now = deps.now()
  const outcome = await withSystemScope(deps.sql, async (tx): Promise<Refusal | { hint: string }> => {
    const found = await pendingSecondFactor(tx, deps, cookie, now)
    if (!found || found.state.two_factor_method !== 'sms' || !found.state.phone) return { code: 'INVALID_CREDENTIALS' }
    const { state } = found
    const phone = found.state.phone
    if (state.locked_until && state.locked_until > now) return { code: 'LOCKED', minutes: minutesUntil(state.locked_until, now) }
    if ((await countCodesSince(tx, state.id, new Date(now.getTime() - 10 * 60_000))) >= maxSmsCodesPer10Min) return { code: 'RATE_LIMITED' }
    await textCode(tx, deps.partnerId, state.id, phone, 'sign_in', now)
    return { hint: phoneHint(phone) }
  })
  return 'code' in outcome ? refuse(outcome) : json(200, { ok: true, hint: outcome.hint })
}

/** Once admitted, the cookie's lifetime grows from the pending ten minutes to the full session's. */
const admittedCookie = (admitted: { cookie: string; remember: boolean } | null): string | undefined =>
  admitted ? setStoreCookie(admitted.cookie, admitted.remember) : undefined

const secondFactor = async (request: Request, deps: StoreAuthDeps, facts: RequestFacts, cookie: string | null): Promise<Response> => {
  const input = await readBody(request, codeInput)
  const now = deps.now()
  const secrets = deps.secrets
  let admitted: { cookie: string; remember: boolean } | null = null
  const outcome = await withSystemScope(deps.sql, async (tx): Promise<Refusal | null> => {
    const found = await pendingSecondFactor(tx, deps, cookie, now)
    if (!cookie || !found || !input) return { code: 'INVALID_CREDENTIALS' }
    const { pending, state } = found
    const user = { id: state.id, partnerId: state.partner_id }
    // A correct code during the lock is still refused.
    if (state.locked_until && state.locked_until > now) return { code: 'LOCKED', minutes: minutesUntil(state.locked_until, now) }
    let step: number | null = null
    if (state.two_factor_method === 'app') {
      if (!secrets) return { code: 'NOT_CONNECTED' }
      const secret = state.two_factor_secret_enc ? await secrets.open(state.two_factor_secret_enc) : null
      if (!secret) return { code: 'INVALID_CREDENTIALS' }
      const checked = await checkCode(secret, input.code, now, state.last_code_step === null ? null : Number(state.last_code_step))
      if (!checked.ok) {
        await deps.activity.record(tx, personCodeRefused(user, facts, checked.code))
        return checked.code === 'WRONG_CODE' ? wrongCode(tx, deps, facts, state, now) : { code: checked.code }
      }
      step = checked.step
    } else {
      const checked = await checkTextedCode(tx, state.id, 'sign_in', input.code, now, deps.codeCheck)
      if (checked !== 'ok') {
        await deps.activity.record(tx, personCodeRefused(user, facts, checked === 'wrong' ? 'WRONG_CODE' : 'CODE_EXPIRED'))
        return checked === 'wrong' ? wrongCode(tx, deps, facts, state, now) : { code: 'CODE_EXPIRED' }
      }
    }
    if (!(await recordUserGoodCode(tx, state.id, step, now))) return { code: 'CODE_EXPIRED' }
    await completeUserSession(tx, cookie, pending.remember, now)
    admitted = { cookie, remember: pending.remember }
    await deps.activity.record(tx, personSignedIn(user, facts))
    return null
  })
  return outcome ? refuse(outcome) : json(200, { ok: true }, admittedCookie(admitted))
}

/** A backup code instead of the second factor, spent in the transaction that admits the session. */
const backupCode = async (request: Request, deps: StoreAuthDeps, facts: RequestFacts, cookie: string | null): Promise<Response> => {
  const input = await readBody(request, codeInput)
  const now = deps.now()
  let admitted: { cookie: string; remember: boolean } | null = null
  const outcome = await withSystemScope(deps.sql, async (tx): Promise<Refusal | { left: number }> => {
    const found = await pendingSecondFactor(tx, deps, cookie, now)
    if (!cookie || !found || !input) return { code: 'INVALID_CREDENTIALS' }
    const { pending, state } = found
    if (state.locked_until && state.locked_until > now) return { code: 'LOCKED', minutes: minutesUntil(state.locked_until, now) }
    const left = await spendBackupCode(tx, state.id, await hashBackupCode(state.id, input.code), now)
    const user = { id: state.id, partnerId: state.partner_id }
    if (left === null) {
      await deps.activity.record(tx, personCodeRefused(user, facts, 'WRONG_BACKUP_CODE'))
      return wrongCode(tx, deps, facts, state, now)
    }
    await recordUserGoodCode(tx, state.id, null, now)
    await completeUserSession(tx, cookie, pending.remember, now)
    admitted = { cookie, remember: pending.remember }
    await deps.activity.record(tx, personBackupCodeUsed(user, facts))
    await deps.activity.record(tx, personSignedIn(user, facts))
    return { left }
  })
  return 'code' in outcome ? refuse(outcome) : json(200, { ok: true, left: outcome.left }, admittedCookie(admitted))
}

/** An Owner's 2-factor set-up, by app or by SMS, ending with the ten backup codes (ACCESS.md §4). */
const enrol = async (request: Request, deps: StoreAuthDeps, facts: RequestFacts, cookie: string | null): Promise<Response> => {
  const input = await readBody(request, enrolInput)
  const now = deps.now()
  let admitted: { cookie: string; remember: boolean } | null = null
  const outcome = await withSystemScope(deps.sql, async (tx): Promise<Refusal | Record<string, unknown>> => {
    const pending = cookie ? await readPendingUserSession(tx, cookie, deps.partnerId, 'enrol', now) : null
    const state = pending ? await selectUserSecondFactor(tx, pending.userId) : null
    // Enrolment only sets a first factor: a stale session never replaces one set up since.
    if (!cookie || !pending || !state || !input || state.two_factor_method !== null) return { code: 'INVALID_CREDENTIALS' }
    const user = { id: state.id, partnerId: state.partner_id }
    const finish = async (method: 'app' | 'sms', secretEnc: string | null, phone: string | null, step: number | null) => {
      await setUserSecondFactor(tx, state.id, method, secretEnc, phone, step, now)
      const codes = newBackupCodes()
      await replaceBackupCodes(tx, user, await Promise.all(codes.map((code) => hashBackupCode(user.id, code))))
      await completeUserSession(tx, cookie, pending.remember, now)
      admitted = { cookie, remember: pending.remember }
      await deps.activity.record(tx, personSecondFactorEnrolled(user, facts, method))
      await deps.activity.record(tx, personBackupCodesGenerated(user, facts))
      await deps.activity.record(tx, personSignedIn(user, facts))
      return { done: true, backupCodes: codes }
    }
    if (input.method === 'app') {
      const secrets = deps.secrets
      if (!secrets) return { code: 'NOT_CONNECTED' }
      if (input.code === undefined) {
        const secret = newTotpSecret()
        await setPendingEnrolment(tx, cookie, { secretEnc: await secrets.seal(secret) })
        return { secret, uri: otpauthUri(secret, state.email, await brandName(tx, deps.partnerId, now)) }
      }
      const secret = pending.pendingSecretEnc ? await secrets.open(pending.pendingSecretEnc) : null
      if (!secret) return { code: 'INVALID_CREDENTIALS' }
      const checked = await checkCode(secret, input.code, now, null)
      // Not counted toward the lock: the code is checked against a secret this session was just given.
      if (!checked.ok) return { code: checked.code }
      return finish('app', pending.pendingSecretEnc, null, checked.step)
    }
    if (input.code === undefined) {
      const phone = input.phone?.trim() ?? ''
      if (!isE164(phone)) return { code: 'INVALID_PHONE' }
      if ((await countCodesSince(tx, state.id, new Date(now.getTime() - 10 * 60_000))) >= maxSmsCodesPer10Min) return { code: 'RATE_LIMITED' }
      await setPendingEnrolment(tx, cookie, { phone })
      await textCode(tx, deps.partnerId, state.id, phone, 'enrol_phone', now)
      return { hint: phoneHint(phone) }
    }
    if (!pending.pendingPhone) return { code: 'INVALID_CREDENTIALS' }
    const checked = await checkTextedCode(tx, state.id, 'enrol_phone', input.code, now, deps.codeCheck)
    if (checked !== 'ok') return { code: checked === 'wrong' ? 'WRONG_CODE' : 'CODE_EXPIRED' }
    return finish('sms', null, pending.pendingPhone, null)
  })
  return isRefusal(outcome) ? refuse(outcome) : json(200, { ok: true, ...outcome }, admittedCookie(admitted))
}
