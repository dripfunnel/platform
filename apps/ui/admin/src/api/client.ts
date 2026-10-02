import { ApiError, createApiClient } from '@dripfunnel/shared/graphql'
import { z } from 'zod'

// The one client of this app (ui/README.md §3). Every module in src/api/ sends its operation
// through `query` and decodes the answer with a zod schema written from apps/api/schema/admin.graphql.
export const api = createApiClient()

// The message names the field that drifted, for the dev tools and the tests; the screens show
// only the code (ui/README.md §3).
export const query = async <Schema extends z.ZodType>(operation: string, schema: Schema, variables?: Record<string, unknown>): Promise<z.infer<Schema>> => {
  const data = await api.request<unknown>(operation, variables)
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new ApiError('BAD_RESPONSE', `The API answered with an unexpected shape at ${issue?.path.join('.') ?? '?'}: ${issue?.message ?? 'unknown'}`)
  }
  return parsed.data as z.infer<Schema>
}

const outcomeSchema = z.object({ ok: z.boolean(), code: z.string().nullable() })

// One mutation returning the §12 outcome; `selection` is the field with its arguments.
export const mutate = async (field: string, selection: string, args: string, variables: Record<string, unknown>): Promise<void> => {
  const result = await query(`mutation ${field}${args} { ${selection} { ok code } }`, z.object({ [field]: outcomeSchema }), variables)
  outcome(result[field] as z.infer<typeof outcomeSchema>)
}

// A mutation's outcome: done, or refused with a stable code (FIRST-RELEASE.md §12). A refusal
// becomes an ApiError so the screens word every failure the same way, by its code.
export const outcome = <T extends { ok: boolean; code: string | null }>(result: T): T => {
  if (!result.ok) throw new ApiError(result.code ?? 'UNKNOWN', 'The API refused the change.')
  return result
}

export const isApiError = (error: unknown, code?: string): error is ApiError =>
  error instanceof ApiError && (code === undefined || error.code === code)
