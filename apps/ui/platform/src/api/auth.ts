import type { PartnerRole } from '../features/shell/partnerRoles'
import { harnessEnabled } from '../harness'

// The refusals the Platform API returns (FIRST-RELEASE.md §3, ACCESS.md §2, §4); this fixture
// stands in for it until the auth routes exist (#112's "Not in this item").
export const authCodes = [
  'INVALID_CREDENTIALS',
  'WRONG_CODE',
  'CODE_EXPIRED',
  'LOCKED',
  'WEAK_PASSWORD',
  'SECOND_FACTOR_REQUIRED',
  'INVITATION_EXPIRED',
  'INVITATION_USED',
  'INVITATION_REPLACED',
  'INVITATION_INVALID',
  'NOT_CONNECTED',
] as const

export type AuthCode = (typeof authCodes)[number]

export interface Invitation {
  partner: string
  role: PartnerRole
  email: string
  // Who sent it: DripFunnel for the Owner's invitation, the Owner or an Admin by name otherwise.
  invitedBy: string
  secondFactorRequired: boolean
  // The authenticator secret shown as text beside the QR code; the API issues a real one.
  secretKey: string
}

export interface AuthRefusal {
  ok: false
  code: AuthCode
  triesLeft?: number
  minutes?: number
}

// Every answer takes the same time, so a refused email and a refused password are
// indistinguishable by timing as well as by message (ACCESS §2, §6.2).
export const settleMs = 400
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, settleMs))

const refuse = (code: AuthCode, extra: Partial<AuthRefusal> = {}): AuthRefusal => ({ ok: false, code, ...extra })
const notConnected = async (): Promise<AuthRefusal> => {
  await settle()
  return refuse('NOT_CONNECTED')
}

// The sample accounts and codes exist only in a harness build: the condition is a build-time
// constant Vite folds, so a production bundle carries none of these literals (grep the dist).
const sample =
  import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'
    ? {
        accounts: {
          'maya@northstar.com': { password: 'northstar-partners', secondFactor: true },
          'alex@northstar.com': { password: 'northstar-partners', secondFactor: false },
        } as Record<string, { password: string; secondFactor: boolean }>,
        validCode: '123456',
        expiredCode: '000000',
      }
    : null
export const maxCodeTries = 5
export const lockMinutes = 15
let wrongCodes = 0

export const signIn = async (email: string, password: string): Promise<{ ok: true; secondFactor: boolean } | AuthRefusal> => {
  if (!harnessEnabled || !sample) return notConnected()
  await settle()
  const account = sample.accounts[email.trim().toLowerCase()]
  if (!account || account.password !== password) return refuse('INVALID_CREDENTIALS')
  return { ok: true, secondFactor: account.secondFactor }
}

export const verifySecondFactor = async (code: string): Promise<{ ok: true } | AuthRefusal> => {
  if (!harnessEnabled || !sample) return notConnected()
  await settle()
  if (wrongCodes >= maxCodeTries) return refuse('LOCKED', { minutes: lockMinutes })
  if (code === sample.expiredCode) return refuse('CODE_EXPIRED')
  if (code !== sample.validCode) {
    wrongCodes += 1
    return wrongCodes >= maxCodeTries ? refuse('LOCKED', { minutes: lockMinutes }) : refuse('WRONG_CODE', { triesLeft: maxCodeTries - wrongCodes })
  }
  wrongCodes = 0
  return { ok: true }
}

// Identical whether or not the email has an account (FIRST-RELEASE §3).
export const requestPasswordReset = async (): Promise<{ ok: true }> => {
  await settle()
  return { ok: true }
}

// Fixture invitations by token, so ?state= and a real link share one path (features/auth). Only in
// a harness build, like the accounts above.
const sampleInvitations: Record<string, Invitation | AuthCode> | null =
  import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'
    ? {
        invalid: 'INVITATION_INVALID',
        expired: 'INVITATION_EXPIRED',
        used: 'INVITATION_USED',
        replaced: 'INVITATION_REPLACED',
        member: { partner: 'Kaufladen Digital', role: 'partner-admin', email: 'petra@kaufladen.de', invitedBy: 'Jonas Weber, the Owner', secondFactorRequired: false, secretKey: 'JBSW Y3DP EHPK 3PXP' },
        required: { partner: 'Kaufladen Digital', role: 'partner-admin', email: 'petra@kaufladen.de', invitedBy: 'Jonas Weber, the Owner', secondFactorRequired: true, secretKey: 'JBSW Y3DP EHPK 3PXP' },
        owner: { partner: 'Kaufladen Digital', role: 'partner-owner', email: 'jonas@kaufladen.de', invitedBy: 'DripFunnel', secondFactorRequired: false, secretKey: 'JBSW Y3DP EHPK 3PXP' },
      }
    : null

export const invitation = async (token: string | undefined): Promise<{ ok: true; invitation: Invitation } | AuthRefusal> => {
  if (!harnessEnabled || !sampleInvitations) return notConnected()
  await settle()
  if (!token) return refuse('INVITATION_INVALID')
  const found = sampleInvitations[token] ?? sampleInvitations.owner
  if (found === undefined) return refuse('INVITATION_INVALID')
  return typeof found === 'string' ? refuse(found) : { ok: true, invitation: found }
}

export const acceptInvitation = async (token: string | undefined, name: string, password: string): Promise<{ ok: true; secondFactorRequired: boolean } | AuthRefusal> => {
  const found = await invitation(token)
  if (!found.ok) return found
  if (name.trim() === '' || password.length < 10) return refuse('WEAK_PASSWORD')
  return { ok: true, secondFactorRequired: found.invitation.secondFactorRequired }
}

export const enrolSecondFactor = async (code: string): Promise<{ ok: true } | AuthRefusal> => {
  if (!harnessEnabled) return notConnected()
  await settle()
  return /^\d{6}$/.test(code) ? { ok: true } : refuse('WRONG_CODE')
}

// Skipping is refused when the partner's Owner requires 2-factor (FIRST-RELEASE §14.4).
export const skipSecondFactor = async (required: boolean): Promise<{ ok: true } | AuthRefusal> => {
  await settle()
  return required ? refuse('SECOND_FACTOR_REQUIRED') : { ok: true }
}

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
