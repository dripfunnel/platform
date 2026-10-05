import type { z } from 'zod'

export const json = (status: number, body: unknown, cookie?: string): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...(cookie ? { 'set-cookie': cookie } : {}) } })

/** A refusal's status: 429 for throttling, 400 for what the user can fix, 401 for anything about who they are. */
export const refusalResponse = <R extends { code: string }>(refusal: R, badRequest: ReadonlySet<R['code']>): Response =>
  json(refusal.code === 'RATE_LIMITED' ? 429 : badRequest.has(refusal.code) ? 400 : 401, { ok: false, ...refusal })

export const readBody = async <T>(request: Request, schema: z.ZodType<T>): Promise<T | null> => {
  try {
    const parsed = schema.safeParse(await request.json())
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
