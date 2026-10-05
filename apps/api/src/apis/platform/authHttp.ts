import type { z } from 'zod'

// The answers every /api/auth/* route gives (FIRST-RELEASE §3): a JSON body, a code the console
// words, and a cookie when a session starts or changes.

export type Refusal =
  | { code: 'INVALID_CREDENTIALS' | 'CODE_EXPIRED' | 'NOT_CONNECTED' | 'RATE_LIMITED' }
  | { code: 'WRONG_CODE'; triesLeft?: number }
  | { code: 'LOCKED'; minutes: number }
  | { code: 'NAME_REQUIRED' | 'WEAK_PASSWORD' | 'SECOND_FACTOR_REQUIRED' | 'RESET_INVALID' | 'INVALID_PHONE' }
  | { code: 'INVITATION_EXPIRED' | 'INVITATION_USED' | 'INVITATION_REPLACED' | 'INVITATION_INVALID' }

export const json = (status: number, body: unknown, cookie?: string): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...(cookie ? { 'set-cookie': cookie } : {}) } })

// A link, a name or a password the user can fix is a bad request; everything else about who you are is 401.
const badRequest = new Set<Refusal['code']>(['NAME_REQUIRED', 'WEAK_PASSWORD', 'SECOND_FACTOR_REQUIRED', 'RESET_INVALID', 'INVALID_PHONE', 'INVITATION_EXPIRED', 'INVITATION_USED', 'INVITATION_REPLACED', 'INVITATION_INVALID'])

export const refuse = (refusal: Refusal): Response => json(refusal.code === 'RATE_LIMITED' ? 429 : badRequest.has(refusal.code) ? 400 : 401, { ok: false, ...refusal })

export const readBody = async <T>(request: Request, schema: z.ZodType<T>): Promise<T | null> => {
  try {
    const parsed = schema.safeParse(await request.json())
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
