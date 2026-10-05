import { z } from 'zod'
import type { RequestFacts } from '#auth/activity'
import { hashPassword, minPasswordLength } from '#auth/password'
import { hashSessionId, newSessionId } from '#auth/session'
import { hashSmsCode, maxSmsCodeAttempts, maxSmsCodesPer10Min, newSmsCode, phoneHint, smsCodeMs } from '#auth/storeCodes'
import { setStoreCookie } from '#auth/storeSession'
import { countriesIn, countryOf } from '#core/countries'
import { isE164 } from '#core/sms'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import {
  advanceSignup,
  bumpSignupAttempt,
  countSignupsSince,
  countSignupTextsSince,
  deleteSignup,
  insertSignup,
  selectPartnerState,
  selectSignup,
  selectSignupCurrencies,
  setSignupPhoneCode,
  subdomainTaken,
  type SignupRow,
} from '#db/scoped/signup'
import { selectSignInCandidate } from '#db/scoped/userSignIn'
import { queueSideEffect } from '#saas/outbox/index'
import { provisionStore, type FailAt } from '#saas/provisioning/index'
import { queueSms } from '#saas/sms/index'
import { admit, type Admission, type StoreAuthDeps } from './admission'
import { json, readBody, refuse, type Refusal } from './authHttp'
import { brandName } from './codes'

// Merchant sign-up on a partner's portal host (FIRST-RELEASE §4, PortalAuth su1–su4, SAAS.md §4.1,
// §5): name, email and password; the emailed code; the store; the texted code; then the store is made.

export const signupCookieName = '__Host-portal_signup'
const signupMs = 24 * 60 * 60 * 1000
const setSignupCookie = (token: string) => `${signupCookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${signupMs / 1000}`
const clearSignupCookie = () => `${signupCookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`

/** Names a store can't take: the platform's own hosts under every partner domain. */
const reservedSubdomains = new Set(['admin', 'api', 'app', 'help', 'hooks', 'mail', 'platform', 'portal', 'preview', 'shop', 'shops', 'status', 'store', 'support', 'www'])
const subdomainPattern = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/
const textsPerNumberPerDay = 3
const textsPerPartnerPerHour = 200
const startsPerPartnerPerHour = 500

const startInput = z.strictObject({ name: z.string().max(120), email: z.string().max(320), password: z.string().max(1024) })
const codeInput = z.strictObject({ code: z.string().max(16) })
const storeInput = z.strictObject({ storeName: z.string().max(120), subdomain: z.string().max(60), country: z.string().max(2) })
const phoneInput = z.strictObject({ phone: z.string().max(20) })

type SignupRefusal = Refusal | { code: 'SUBDOMAIN_TAKEN'; suggestions: string[] }

const offeredCountries = async (tx: ScopedSql, partnerId: string) => countriesIn(new Set(await selectSignupCurrencies(tx, partnerId))).map((c) => ({ code: c.code, name: c.name, currency: c.currency }))

/** Step 1: the same answer, and the same email (a code, or how to sign in), whether or not the address has an account. */
export const startSignup = async (request: Request, deps: StoreAuthDeps): Promise<Response> => {
  const input = await readBody(request, startInput)
  if (!input) return refuse({ code: 'INVALID_INPUT' })
  const name = input.name.trim()
  const email = input.email.trim()
  if (name === '') return refuse({ code: 'NAME_REQUIRED' })
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return refuse({ code: 'INVALID_EMAIL' })
  if (input.password.length < minPasswordLength) return refuse({ code: 'WEAK_PASSWORD' })
  if (!(await deps.allowAttempt(`store:${deps.host}:signup:${email.toLowerCase()}`))) return refuse({ code: 'RATE_LIMITED' })
  const token = newSessionId()
  const passwordHash = await hashPassword(input.password)
  const now = deps.now()
  const open = await withSystemScope(deps.sql, async (tx) => {
    // SAAS.md §4.1: sign-up is open only while the partner is Live.
    if ((await selectPartnerState(tx, deps.partnerId)) !== 'live') return 'closed' as const
    // Per typed address and per client address already (handleStoreAuth); this bounds the partner's hour.
    if ((await countSignupsSince(tx, deps.partnerId, new Date(now.getTime() - 60 * 60_000))) >= startsPerPartnerPerHour) return 'busy' as const
    const signupId = await insertSignup(tx, { partnerId: deps.partnerId, tokenHash: await hashSessionId(token), name, email, passwordHash, expiresAt: new Date(now.getTime() + signupMs), now })
    await queueSideEffect(tx, { kind: 'email', idempotencyKey: `signup-code:${signupId}`, payload: { template: 'signup-code', signupId }, partnerId: deps.partnerId, storeId: null })
    return 'open' as const
  })
  if (open === 'closed') return refuse({ code: 'SIGNUP_CLOSED' })
  if (open === 'busy') return refuse({ code: 'RATE_LIMITED' })
  return json(200, { ok: true, step: 'verify-email' }, setSignupCookie(token))
}

const withSignup = async <T>(deps: StoreAuthDeps, cookie: string | null, stages: readonly SignupRow['stage'][], work: (tx: ScopedSql, s: SignupRow) => Promise<T | SignupRefusal>): Promise<T | SignupRefusal> => {
  if (!cookie) return { code: 'SIGNUP_EXPIRED' }
  const tokenHash = await hashSessionId(cookie)
  return withSystemScope(deps.sql, async (tx) => {
    const signup = await selectSignup(tx, deps.partnerId, tokenHash, deps.now())
    if (!signup || !stages.includes(signup.stage)) return { code: 'SIGNUP_EXPIRED' }
    return work(tx, signup)
  })
}

const isRefusal = (v: unknown): v is SignupRefusal => typeof v === 'object' && v !== null && 'code' in v && typeof (v as { code: unknown }).code === 'string'

const answer = (outcome: unknown, ok: Record<string, unknown>, cookie?: string) => (isRefusal(outcome) ? refuseSignup(outcome) : json(200, { ok: true, ...ok }, cookie))

const refuseSignup = (r: SignupRefusal): Response => (r.code === 'SUBDOMAIN_TAKEN' ? json(400, { ok: false, ...r }) : refuse(r))

/** A wrong code counts, committed with the answer; the fifth closes the code (a new one comes by asking again). */
const checkCode = async (tx: ScopedSql, s: SignupRow, which: 'email' | 'phone', typed: string, now: Date): Promise<Refusal | null> => {
  const hash = which === 'email' ? s.email_code_hash : s.phone_code_hash
  const expiresAt = which === 'email' ? s.email_code_expires_at : s.phone_code_expires_at
  const attempts = which === 'email' ? s.email_code_attempts : s.phone_code_attempts
  if (!hash || !expiresAt || expiresAt <= now || attempts >= maxSmsCodeAttempts) return { code: 'CODE_EXPIRED' }
  if ((await hashSmsCode(`signup-${which}:${s.id}`, typed.trim())) === hash) return null
  await bumpSignupAttempt(tx, s.id, which)
  return { code: 'WRONG_CODE', triesLeft: Math.max(0, maxSmsCodeAttempts - attempts - 1) }
}

/** Step 2: the emailed code proves the address; the answer carries the countries step 3 offers. */
export const verifySignupEmail = async (request: Request, deps: StoreAuthDeps, cookie: string | null): Promise<Response> => {
  const input = await readBody(request, codeInput)
  const now = deps.now()
  const outcome = await withSignup(deps, cookie, ['email'], async (tx, s) => {
    const wrong = input ? await checkCode(tx, s, 'email', input.code, now) : { code: 'WRONG_CODE' as const }
    if (wrong) return wrong
    await advanceSignup(tx, s.id, 'store')
    return { countries: await offeredCountries(tx, deps.partnerId) }
  })
  return answer(outcome, { step: 'store', ...(isRefusal(outcome) ? {} : outcome) })
}

const suggestionsFor = async (tx: ScopedSql, partnerId: string, base: string, signupId: string, now: Date): Promise<string[]> => {
  const free: string[] = []
  for (const candidate of [`${base}-co`, `${base}-shop`, `${base}-store`, `${base}-online`]) {
    if (subdomainPattern.test(candidate) && !(await subdomainTaken(tx, partnerId, candidate, signupId, now))) free.push(candidate)
    if (free.length === 2) break
  }
  return free
}

/** Step 3: the store's name, its web address on the partner's domain, and its country (which sets the currency). */
export const signupStore = async (request: Request, deps: StoreAuthDeps, cookie: string | null): Promise<Response> => {
  const input = await readBody(request, storeInput)
  const now = deps.now()
  const outcome = await withSignup(deps, cookie, ['store', 'phone'], async (tx, s): Promise<SignupRefusal | Record<string, never>> => {
    if (!input) return { code: 'INVALID_INPUT' }
    const storeName = input.storeName.trim()
    const subdomain = input.subdomain.trim().toLowerCase()
    if (storeName === '' || storeName.length > 80) return { code: 'NAME_REQUIRED' }
    if (!subdomainPattern.test(subdomain)) return { code: 'INVALID_SUBDOMAIN' }
    if (reservedSubdomains.has(subdomain) || (await subdomainTaken(tx, deps.partnerId, subdomain, s.id, now))) {
      return { code: 'SUBDOMAIN_TAKEN', suggestions: await suggestionsFor(tx, deps.partnerId, subdomain, s.id, now) }
    }
    if (!(await offeredCountries(tx, deps.partnerId)).some((c) => c.code === input.country)) return { code: 'COUNTRY_UNAVAILABLE' }
    await advanceSignup(tx, s.id, 'phone', { store_name: storeName, subdomain, country: input.country })
    return {}
  })
  return answer(outcome, { step: 'phone' })
}

/** Step 4a: texts a code to the number, so nobody opens a store in someone else's name (PortalAuth su4). */
export const sendSignupPhoneCode = async (request: Request, deps: StoreAuthDeps, cookie: string | null): Promise<Response> => {
  const input = await readBody(request, phoneInput)
  const now = deps.now()
  const outcome = await withSignup(deps, cookie, ['phone'], async (tx, s): Promise<SignupRefusal | { hint: string }> => {
    const phone = input?.phone.trim() ?? ''
    if (!isE164(phone)) return { code: 'INVALID_PHONE' }
    // Per sign-up, per number and per partner, so texts can't be pumped to numbers nobody here owns.
    if ((await countSignupTextsSince(tx, deps.partnerId, new Date(now.getTime() - 10 * 60_000), { signupId: s.id })) >= maxSmsCodesPer10Min) return { code: 'RATE_LIMITED' }
    if ((await countSignupTextsSince(tx, deps.partnerId, new Date(now.getTime() - signupMs), { phone })) >= textsPerNumberPerDay) return { code: 'RATE_LIMITED' }
    if ((await countSignupTextsSince(tx, deps.partnerId, new Date(now.getTime() - 60 * 60_000), {})) >= textsPerPartnerPerHour) return { code: 'RATE_LIMITED' }
    const code = newSmsCode()
    const expiresAt = new Date(now.getTime() + smsCodeMs)
    await setSignupPhoneCode(tx, { id: s.id, partnerId: deps.partnerId }, phone, await hashSmsCode(`signup-phone:${s.id}`, code), expiresAt, now)
    await queueSms(tx, {
      partnerId: deps.partnerId,
      storeId: null,
      idempotencyKey: `signup-phone:${s.id}:${now.toISOString()}`,
      payload: { message: 'code.verify_phone', to: phone, brand: await brandName(tx, deps.partnerId, now), vars: { code }, expiresAt: expiresAt.toISOString() },
    })
    return { hint: phoneHint(phone) }
  })
  return answer(outcome, isRefusal(outcome) ? {} : outcome)
}

/**
 * Step 4b: the texted code proves the number, and the store is made in the same transaction (SAAS.md §5,
 * steps 1–3). The Owner then sets up 2-factor before anything else answers (ACCESS.md §4).
 */
export const verifySignupPhone = async (request: Request, deps: StoreAuthDeps, facts: RequestFacts, cookie: string | null, failAt?: FailAt): Promise<Response> => {
  const input = await readBody(request, codeInput)
  const now = deps.now()
  const outcome = await withSignup(deps, cookie, ['phone'], async (tx, s): Promise<SignupRefusal | { admission: Admission; storeId: string }> => {
    const wrong = input ? await checkCode(tx, s, 'phone', input.code, now) : { code: 'WRONG_CODE' as const }
    if (wrong) return wrong
    const country = s.country ? countryOf(s.country) : null
    if (!s.phone || !s.store_name || !s.subdomain || !country) return { code: 'SIGNUP_EXPIRED' }
    // The address was proven by email; an account made since then keeps it, and this sign-up stops here.
    if (await selectSignInCandidate(tx, deps.partnerId, s.email)) return { code: 'SIGNUP_EXPIRED' }
    const made = await provisionStore(tx, { partnerId: deps.partnerId, owner: { name: s.name, email: s.email, passwordHash: s.password_hash, phone: s.phone }, store: { name: s.store_name, code: s.subdomain, country: country.code, currency: country.currency } }, now, failAt)
    if (!made.ok) return made.reason === 'SUBDOMAIN_TAKEN' ? { code: 'SUBDOMAIN_TAKEN', suggestions: await suggestionsFor(tx, deps.partnerId, s.subdomain, s.id, now) } : { code: 'COUNTRY_UNAVAILABLE' }
    await deps.activity.record(tx, {
      category: 'auth',
      action: 'store.created',
      result: 'success',
      actorKind: 'person',
      actorId: made.userId,
      actorLabel: null,
      partnerId: deps.partnerId,
      storeId: made.storeId,
      target: { type: 'store', id: made.storeId, label: s.store_name },
      reason: 'signup',
      api: 'store',
      visibility: 'store',
      ...facts,
    })
    await deleteSignup(tx, s.id)
    const candidate = await selectSignInCandidate(tx, deps.partnerId, s.email)
    if (!candidate) throw new Error('signup: the new account is not readable')
    return { admission: await admit(tx, deps, facts, candidate, false, now), storeId: made.storeId }
  })
  if (isRefusal(outcome)) return refuseSignup(outcome)
  const { admission } = outcome
  const headers = new Headers({ 'content-type': 'application/json' })
  headers.append('set-cookie', clearSignupCookie())
  headers.append('set-cookie', setStoreCookie(admission.session, admission.remember, admission.stage))
  return new Response(JSON.stringify({ ok: true, step: admission.stage === 'full' ? 'done' : admission.stage, storeId: outcome.storeId }), { status: 200, headers })
}
