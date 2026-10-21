import { refusalResponse } from '#core/http'

export { json, readBody } from '#core/http'

// The merchant portal's /api/auth/* refusals (docs/api/ACCESS.md §4).
export type Refusal =
  | { code: 'INVALID_CREDENTIALS' | 'CODE_EXPIRED' | 'NOT_CONNECTED' | 'RATE_LIMITED' }
  | { code: 'WRONG_CODE'; triesLeft?: number }
  | { code: 'LOCKED'; minutes: number }
  | { code: 'INVALID_PHONE' }
  | { code: 'INVALID_INPUT' | 'INVALID_EMAIL' | 'INVALID_SUBDOMAIN' | 'COUNTRY_UNAVAILABLE' | 'SIGNUP_CLOSED' | 'SIGNUP_EXPIRED' }
  | { code: 'NAME_REQUIRED' | 'WEAK_PASSWORD' | 'RESET_INVALID' | 'INVITATION_USED' | 'INVITATION_REPLACED' | 'INVITATION_INVALID' | 'EMAIL_CHANGE_INVALID' }
  // The prototype's expired screen asks the inviter by name (PortalAuth `inviteBad`).
  | { code: 'INVITATION_EXPIRED'; invitedBy: string }

const badRequest = new Set<Refusal['code']>(['INVALID_PHONE', 'INVALID_INPUT', 'INVALID_EMAIL', 'INVALID_SUBDOMAIN', 'COUNTRY_UNAVAILABLE', 'SIGNUP_CLOSED', 'SIGNUP_EXPIRED', 'NAME_REQUIRED', 'WEAK_PASSWORD', 'RESET_INVALID', 'INVITATION_EXPIRED', 'INVITATION_USED', 'INVITATION_REPLACED', 'INVITATION_INVALID', 'EMAIL_CHANGE_INVALID'])

export const refuse = (refusal: Refusal): Response => refusalResponse(refusal, badRequest)
