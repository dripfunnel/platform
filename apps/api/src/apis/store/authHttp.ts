import { json, refusalResponse } from '#core/http'

export { json, readBody } from '#core/http'

// The merchant portal's /api/auth/* refusals (docs/api/ACCESS.md §4).
export type Refusal =
  | { code: 'INVALID_CREDENTIALS' | 'CODE_EXPIRED' | 'NOT_CONNECTED' | 'RATE_LIMITED' }
  | { code: 'WRONG_CODE'; triesLeft?: number }
  | { code: 'LOCKED'; minutes: number }
  | { code: 'INVALID_PHONE' }
  // Google sign-in (#1046): no account for Google's address, Google's answer refused, or no Google here.
  | { code: 'NO_ACCOUNT' | 'GOOGLE_REFUSED' | 'GOOGLE_UNAVAILABLE' }
  | { code: 'INVALID_INPUT' | 'INVALID_EMAIL' | 'INVALID_SUBDOMAIN' | 'COUNTRY_UNAVAILABLE' | 'SIGNUP_CLOSED' | 'SIGNUP_EXPIRED' }
  | { code: 'NAME_REQUIRED' | 'WEAK_PASSWORD' | 'RESET_INVALID' | 'INVITATION_USED' | 'INVITATION_REPLACED' | 'INVITATION_INVALID' | 'EMAIL_CHANGE_INVALID' }
  // The prototype's expired screen asks the inviter by name (PortalAuth `inviteBad`).
  | { code: 'INVITATION_EXPIRED'; invitedBy: string }
  // Create another store in a support session, or a second within a day (#1136).
  | { code: 'FORBIDDEN' | 'DAILY_LIMIT' }

const badRequest = new Set<Refusal['code']>(['INVALID_PHONE', 'INVALID_INPUT', 'INVALID_EMAIL', 'INVALID_SUBDOMAIN', 'COUNTRY_UNAVAILABLE', 'SIGNUP_CLOSED', 'SIGNUP_EXPIRED', 'NAME_REQUIRED', 'WEAK_PASSWORD', 'RESET_INVALID', 'INVITATION_EXPIRED', 'INVITATION_USED', 'INVITATION_REPLACED', 'INVITATION_INVALID', 'EMAIL_CHANGE_INVALID'])

const ownStatus: Partial<Record<Refusal['code'], number>> = { FORBIDDEN: 403, DAILY_LIMIT: 429 }

export const refuse = (refusal: Refusal): Response => {
  const status = ownStatus[refusal.code]
  return status ? json(status, { ok: false, ...refusal }) : refusalResponse<Refusal>(refusal, badRequest)
}
