import { identityChanged } from '@dripfunnel/shared/ui'
import { z } from 'zod'

// The Store API's /api/auth/* routes on a partner's portal host (ACCESS.md §4, §6; FIRST-RELEASE §4;
// apps/api src/apis/store/auth.ts, invitations.ts, signup.ts, emailChange.ts): JSON in, `{ ok, … }` or
// `{ ok: false, code }` out, and the session is the cookie they set. Anything else reads as NOT_CONNECTED.
export const authCodes = [
  'INVALID_CREDENTIALS',
  'WRONG_CODE',
  'CODE_EXPIRED',
  'LOCKED',
  'RATE_LIMITED',
  'NOT_CONNECTED',
  'INVALID_PHONE',
  'INVALID_INPUT',
  'INVALID_EMAIL',
  'INVALID_SUBDOMAIN',
  'SUBDOMAIN_TAKEN',
  'COUNTRY_UNAVAILABLE',
  'SIGNUP_CLOSED',
  'SIGNUP_EXPIRED',
  'NAME_REQUIRED',
  'WEAK_PASSWORD',
  'RESET_INVALID',
  'INVITATION_EXPIRED',
  'INVITATION_USED',
  'INVITATION_REPLACED',
  'INVITATION_INVALID',
  'EMAIL_CHANGE_INVALID',
] as const

export type AuthCode = (typeof authCodes)[number]

export interface AuthRefusal {
  ok: false
  code: AuthCode
  triesLeft?: number | undefined
  minutes?: number | undefined
  invitedBy?: string | undefined
  suggestions?: string[] | undefined
}

const refusalSchema = z.object({
  ok: z.literal(false),
  code: z.string(),
  triesLeft: z.number().int().optional(),
  minutes: z.number().int().optional(),
  invitedBy: z.string().optional(),
  suggestions: z.array(z.string()).optional(),
})

// A code the API has never promised is not worded as if it had been.
const refusalOf = (answer: z.infer<typeof refusalSchema>): AuthRefusal => {
  const code = z.enum(authCodes).safeParse(answer.code)
  if (!code.success) return { ok: false, code: 'NOT_CONNECTED' }
  return { ok: false, code: code.data, triesLeft: answer.triesLeft, minutes: answer.minutes, invitedBy: answer.invitedBy, suggestions: answer.suggestions }
}

const notConnected: AuthRefusal = { ok: false, code: 'NOT_CONNECTED' }
const timeoutMs = 15_000

// The routes after which this browser is someone else (sharedSessionReads.ts `identityChanged`).
const identityRoutes = new Set(['sign-in', 'second-factor', 'backup-code', 'enrol-second-factor', 'accept-invitation', 'join', 'reset-password', 'sign-up/verify-phone'])

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
    if (identityRoutes.has(route)) identityChanged()
    return parsed.data as z.infer<Schema>
  } catch {
    return notConnected
  }
}

export const isRefusal = (value: { ok: boolean }): value is AuthRefusal => value.ok === false

const ok = z.object({ ok: z.literal(true) })
const method = z.enum(['app', 'sms'])

/** What follows a password, an accepted invitation or a reset: the portal, a code, or setting one up. */
const step = z.discriminatedUnion('step', [
  z.object({ ok: z.literal(true), step: z.literal('done') }),
  z.object({ ok: z.literal(true), step: z.literal('second-factor'), method }),
  z.object({ ok: z.literal(true), step: z.literal('enrol') }),
])

export type Admitted = z.infer<typeof step>

export const signIn = (email: string, password: string, remember: boolean) => post('sign-in', { email, password, remember }, step)

/** Texts the sign-in code; the hint is the number's last four digits (`•••• 2113`). */
export const sendCode = () => post('send-code', {}, z.object({ ok: z.literal(true), hint: z.string() }))

export const verifyCode = (code: string) => post('second-factor', { code }, ok)

export const useBackupCode = (code: string) => post('backup-code', { code }, z.object({ ok: z.literal(true), left: z.number().int() }))

const enrolStep = z.union([
  z.object({ ok: z.literal(true), done: z.literal(true), backupCodes: z.array(z.string()) }),
  z.object({ ok: z.literal(true), hint: z.string() }),
  z.object({ ok: z.literal(true), secret: z.string(), uri: z.string() }),
])

export type EnrolStep = z.infer<typeof enrolStep>

/** An Owner's set-up at sign-in: by SMS, the number then its code; ten backup codes come back once at the end. */
export const enrolBySms = (phone: string) => post('enrol-second-factor', { method: 'sms', phone }, enrolStep)
export const confirmEnrolBySms = (code: string) => post('enrol-second-factor', { method: 'sms', code }, enrolStep)

/** The same answer for any email (ACCESS.md §2); only RATE_LIMITED differs. */
export const requestPasswordReset = (email: string) => post('request-password-reset', { email }, ok)

export const resetPassword = (token: string, password: string) => post('reset-password', { token, password }, step)

const invitationSchema = z.object({
  store: z.string(),
  role: z.string(),
  supplier: z.string().nullable(),
  email: z.string(),
  invitedBy: z.string(),
  path: z.enum(['new', 'join']),
})

export type Invitation = z.infer<typeof invitationSchema>

export const lookUpInvitation = (token: string) => post('invitation', { token }, z.object({ ok: z.literal(true), invitation: invitationSchema }))

export const acceptInvitation = (token: string, name: string, password: string) => post('accept-invitation', { token, name, password }, step)

export const joinStore = (token: string) => post('join', { token }, z.object({ ok: z.literal(true), step: z.enum(['done', 'enrol']) }))

export const confirmEmailChange = (token: string) => post('confirm-email', { token }, ok)

const countrySchema = z.object({ code: z.string(), name: z.string(), currency: z.string() })

export type Country = z.infer<typeof countrySchema>

export const startSignup = (name: string, email: string, password: string) => post('sign-up', { name, email, password }, z.object({ ok: z.literal(true), step: z.literal('verify-email') }))

export const verifySignupEmail = (code: string) => post('sign-up/verify-email', { code }, z.object({ ok: z.literal(true), step: z.literal('store'), countries: z.array(countrySchema) }))

export const signupStore = (storeName: string, subdomain: string, country: string) => post('sign-up/store', { storeName, subdomain, country }, z.object({ ok: z.literal(true), step: z.literal('phone') }))

export const sendSignupPhone = (phone: string) => post('sign-up/send-phone', { phone }, z.object({ ok: z.literal(true), hint: z.string() }))

export const verifySignupPhone = (code: string) => post('sign-up/verify-phone', { code }, z.object({ ok: z.literal(true), step: z.enum(['done', 'enrol']), storeId: z.string() }))

/** A web address from a store name, as the prototype suggests one: lower-case words joined by hyphens. */
export const subdomainFrom = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')

/** A backup code as the API stores it, `abcd-efgh` (storeCodes.ts), however it was typed; null if it isn't one. */
export const backupCodeFrom = (typed: string): string | null => {
  const match = /^([a-z0-9]{4})-?([a-z0-9]{4})$/.exec(typed.replace(/\s/g, '').toLowerCase())
  return match ? `${match[1]}-${match[2]}` : null
}
