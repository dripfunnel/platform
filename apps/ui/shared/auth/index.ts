import { z } from 'zod'
import { identityChanged } from '../ui/index'

// Each app's `/api/auth/*` routes (ACCESS.md §4): JSON in, `{ ok, … }` or `{ ok: false, code }` out, the
// session the cookie they set. A code the app has never been promised, or no answer at all, is NOT_CONNECTED.

export interface AuthRefusal<Code extends string> {
  ok: false
  code: Code | 'NOT_CONNECTED'
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

export const authTimeoutMs = 15_000

export interface AuthClientOptions<Code extends string> {
  /** The refusal codes this app's routes promise. */
  codes: readonly Code[]
  /** The routes after which this browser is someone else, so the other tabs hear (sharedSessionReads `identityChanged`). */
  identityRoutes: ReadonlySet<string>
}

export const createAuthClient = <Code extends string>({ codes, identityRoutes }: AuthClientOptions<Code>) => {
  const notConnected: AuthRefusal<Code> = { ok: false, code: 'NOT_CONNECTED' }
  const known = new Set<string>(codes)

  const refusalOf = (answer: z.infer<typeof refusalSchema>): AuthRefusal<Code> =>
    known.has(answer.code)
      ? { ok: false, code: answer.code as Code, triesLeft: answer.triesLeft, minutes: answer.minutes, invitedBy: answer.invitedBy, suggestions: answer.suggestions }
      : notConnected

  const post = async <Schema extends z.ZodType>(route: string, body: Record<string, unknown>, done: Schema): Promise<z.infer<Schema> | AuthRefusal<Code>> => {
    try {
      const response = await fetch(`/api/auth/${route}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(authTimeoutMs),
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

  return { post }
}

export const isRefusal = (value: { ok: boolean }): value is { ok: false } & AuthRefusal<string> => value.ok === false
