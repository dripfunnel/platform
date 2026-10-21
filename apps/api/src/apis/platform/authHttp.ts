import { refusalResponse } from '#core/http'

export { json, readBody } from '#core/http'

// The answers every /api/auth/* route gives (FIRST-RELEASE §3): a JSON body, a code the console
// words, and a cookie when a session starts or changes.

export type Refusal =
  | { code: 'INVALID_CREDENTIALS' | 'CODE_EXPIRED' | 'NOT_CONNECTED' | 'RATE_LIMITED' }
  | { code: 'WRONG_CODE'; triesLeft?: number }
  | { code: 'LOCKED'; minutes: number }
  | { code: 'NAME_REQUIRED' | 'WEAK_PASSWORD' | 'SECOND_FACTOR_REQUIRED' | 'RESET_INVALID' }
  | { code: 'INVITATION_EXPIRED' | 'INVITATION_USED' | 'INVITATION_REPLACED' | 'INVITATION_INVALID' }

const badRequest = new Set<Refusal['code']>(['NAME_REQUIRED', 'WEAK_PASSWORD', 'SECOND_FACTOR_REQUIRED', 'RESET_INVALID', 'INVITATION_EXPIRED', 'INVITATION_USED', 'INVITATION_REPLACED', 'INVITATION_INVALID'])

export const refuse = (refusal: Refusal): Response => refusalResponse(refusal, badRequest)
