import { harnessEnabled } from '../harness'

// The refusals the Platform API returns (FIRST-RELEASE.md §3, ACCESS.md §2, §4); this fixture
// stands in for it until the auth routes exist (#112's "Not in this item").
export const authCodes = [
  'INVALID_CREDENTIALS',
  'WRONG_CODE',
  'CODE_EXPIRED',
  'LOCKED',
  'NOT_CONNECTED',
] as const

export type AuthCode = (typeof authCodes)[number]

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

const accounts: Record<string, { password: string; secondFactor: boolean }> = {
  'maya@northstar.com': { password: 'northstar-partners', secondFactor: true },
  'alex@northstar.com': { password: 'northstar-partners', secondFactor: false },
}
export const maxCodeTries = 5
export const lockMinutes = 15
let wrongCodes = 0

export const signIn = async (email: string, password: string): Promise<{ ok: true; secondFactor: boolean } | AuthRefusal> => {
  if (!harnessEnabled) return notConnected()
  await settle()
  const account = accounts[email.trim().toLowerCase()]
  if (!account || account.password !== password) return refuse('INVALID_CREDENTIALS')
  return { ok: true, secondFactor: account.secondFactor }
}

export const verifySecondFactor = async (code: string): Promise<{ ok: true } | AuthRefusal> => {
  if (!harnessEnabled) return notConnected()
  await settle()
  if (wrongCodes >= maxCodeTries) return refuse('LOCKED', { minutes: lockMinutes })
  if (code === '000000') return refuse('CODE_EXPIRED')
  if (code !== '123456') {
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
