import { refusalResponse } from '#core/http'

export { json, readBody } from '#core/http'

// The merchant portal's /api/auth/* refusals (docs/api/ACCESS.md §4).
export type Refusal =
  | { code: 'INVALID_CREDENTIALS' | 'CODE_EXPIRED' | 'NOT_CONNECTED' | 'RATE_LIMITED' }
  | { code: 'WRONG_CODE'; triesLeft?: number }
  | { code: 'LOCKED'; minutes: number }
  | { code: 'INVALID_PHONE' }

const badRequest = new Set<Refusal['code']>(['INVALID_PHONE'])

export const refuse = (refusal: Refusal): Response => refusalResponse(refusal, badRequest)
