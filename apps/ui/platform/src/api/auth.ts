import { identityChanged } from '@dripfunnel/shared/ui'
import { z } from 'zod'
import { partnerRoles } from '../features/shell/partnerRoles'

// The Platform API's /api/auth/* routes (FIRST-RELEASE.md §3, ACCESS.md §2, §4, apps/api
// src/apis/platform/auth.ts): JSON in, `{ ok, … }` or `{ ok: false, code }` out, and the session
// is the cookie they set. Every refusal is a stable code; anything else reads as NOT_CONNECTED.
export const authCodes = [
  'INVALID_CREDENTIALS',
  'WRONG_CODE',
  'CODE_EXPIRED',
  'LOCKED',
  'RATE_LIMITED',
  'NAME_REQUIRED',
  'WEAK_PASSWORD',
  'SECOND_FACTOR_REQUIRED',
  'RESET_INVALID',
  'INVITATION_EXPIRED',
  'INVITATION_USED',
  'INVITATION_REPLACED',
  'INVITATION_INVALID',
  'NOT_CONNECTED',
] as const

export type AuthCode = (typeof authCodes)[number]

export interface AuthRefusal {
  ok: false
  code: AuthCode
  triesLeft?: number | undefined
  minutes?: number | undefined
}

const invitationSchema = z.object({
  partner: z.string(),
  role: z.enum(partnerRoles),
  email: z.string(),
  // DripFunnel for the Owner's invitation, the inviter by name otherwise.
  invitedBy: z.string(),
  secondFactorRequired: z.boolean(),
})

export type Invitation = z.infer<typeof invitationSchema>

const refusalSchema = z.object({ ok: z.literal(false), code: z.string(), triesLeft: z.number().int().optional(), minutes: z.number().int().optional() })

// A code the API has never promised is not worded as if it had been.
const refusalOf = (answer: z.infer<typeof refusalSchema>): AuthRefusal => {
  const code = z.enum(authCodes).safeParse(answer.code)
  return code.success ? { ok: false, code: code.data, triesLeft: answer.triesLeft, minutes: answer.minutes } : { ok: false, code: 'NOT_CONNECTED' }
}

const notConnected: AuthRefusal = { ok: false, code: 'NOT_CONNECTED' }
const timeoutMs = 15_000

// The routes that change who this browser is signed in as (sharedSessionReads.ts `identityChanged`).
const signInRoutes = new Set(['sign-in', 'second-factor', 'accept-invitation', 'enrol-second-factor', 'skip-second-factor'])

const post = async <Schema extends z.ZodType>(route: string, body: Record<string, unknown>, done: Schema): Promise<z.infer<Schema> | AuthRefusal> => {
  try {
    const response = await fetch(`/api/auth/${route}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const answer: unknown = await response.json()
    const refused = refusalSchema.safeParse(answer)
    if (refused.success) return refusalOf(refused.data)
    const parsed = done.safeParse(answer)
    if (!parsed.success) return notConnected
    if (signInRoutes.has(route)) identityChanged()
    return parsed.data as z.infer<Schema>
  } catch {
    return notConnected
  }
}

const ok = z.object({ ok: z.literal(true) })
// What follows a password: the console, a code, or enrolling one the partner requires.
const signInSteps = z.enum(['done', 'second-factor', 'enrol'])

export type SignInStep = z.infer<typeof signInSteps>

export const signIn = (email: string, password: string, next: string): Promise<{ ok: true; step: SignInStep } | AuthRefusal> =>
  post('sign-in', { email, password, next }, z.object({ ok: z.literal(true), step: signInSteps }))

export const verifySecondFactor = (code: string): Promise<{ ok: true } | AuthRefusal> => post('second-factor', { code }, ok)

// Identical whether or not the email has an account (FIRST-RELEASE §3); only RATE_LIMITED differs.
export const requestPasswordReset = (email: string): Promise<{ ok: true } | AuthRefusal> => post('request-password-reset', { email }, ok)

// The emailed link's token and a new password; the API signs no one in, so sign-in follows.
export const resetPassword = (token: string | undefined, password: string): Promise<{ ok: true } | AuthRefusal> =>
  token ? post('reset-password', { token, password }, ok) : Promise.resolve({ ok: false, code: 'RESET_INVALID' })

export const invitation = (token: string | undefined): Promise<{ ok: true; invitation: Invitation } | AuthRefusal> =>
  token ? post('invitation', { token }, z.object({ ok: z.literal(true), invitation: invitationSchema })) : Promise.resolve({ ok: false, code: 'INVITATION_INVALID' })

export const acceptInvitation = (token: string | undefined, name: string, password: string): Promise<{ ok: true; secondFactorRequired: boolean } | AuthRefusal> =>
  token
    ? post('accept-invitation', { token, name, password }, z.object({ ok: z.literal(true), secondFactorRequired: z.boolean() }))
    : Promise.resolve({ ok: false, code: 'INVITATION_INVALID' })

// The first call issues the secret, shown once as text and as the URI a QR code encodes.
export const startEnrolment = (): Promise<{ ok: true; secret: string; uri: string } | AuthRefusal> =>
  post('enrol-second-factor', {}, z.object({ ok: z.literal(true), secret: z.string().min(1), uri: z.string().min(1) }))

export const enrolSecondFactor = (code: string): Promise<{ ok: true } | AuthRefusal> => post('enrol-second-factor', { code }, ok)

// The partner's requirement is the session's, never a flag the caller sends (FIRST-RELEASE §14.4).
export const skipSecondFactor = (): Promise<{ ok: true } | AuthRefusal> => post('skip-second-factor', {}, ok)

// The route ends the session and redirects to `/`, which a signed-out visitor leaves for
// sign-in: a plain form post, so the browser follows it rather than a script waiting on it.
export const signOut = (): void => {
  const form = document.createElement('form')
  form.method = 'post'
  form.action = '/api/auth/sign-out'
  identityChanged()
  document.body.append(form)
  form.submit()
}

// The text key in groups of four, as authenticator apps print it.
export const groupedKey = (secret: string): string => secret.replace(/(.{4})(?=.)/g, '$1 ')

// The redirect after sign-in is same-origin only (ACCESS §4): a path on this host, never a
// protocol-relative or absolute address, which the URL parser would send elsewhere.
export const safeNext = (next: unknown, origin: string, fallback = '/dashboard'): string => {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) return fallback
  try {
    const url = new URL(next, origin)
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : fallback
  } catch {
    return fallback
  }
}
