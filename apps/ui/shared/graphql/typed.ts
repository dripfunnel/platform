import type { z } from 'zod'
import { ApiError, type ApiClient, type FieldError } from './client'

// Every answer is decoded with a zod schema written from the app's generated schema
// (ui/README.md §3). The message names the field that drifted, for the dev tools and the
// tests; the screens show only the code.
const decoded = <Schema extends z.ZodType>(schema: Schema, data: unknown): z.infer<Schema> => {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new ApiError('BAD_RESPONSE', `The API answered with an unexpected shape at ${issue?.path.join('.') ?? '?'}: ${issue?.message ?? 'unknown'}`)
  }
  return parsed.data as z.infer<Schema>
}

export const typedQuery =
  (client: ApiClient) =>
  async <Schema extends z.ZodType>(operation: string, schema: Schema, variables?: Record<string, unknown>): Promise<z.infer<Schema>> =>
    decoded(schema, await client.request<unknown>(operation, variables))

/** `typedQuery` for an operation whose root fields answer or are refused one by one; a refused field is null in `data`. */
export const typedPartialQuery =
  (client: ApiClient) =>
  async <Schema extends z.ZodType>(operation: string, schema: Schema, variables?: Record<string, unknown>): Promise<{ data: z.infer<Schema>; errors: FieldError[] }> => {
    const { data, errors } = await client.requestPartial<unknown>(operation, variables)
    return { data: decoded(schema, data), errors }
  }

// A mutation's outcome: done, or refused with a stable code. A refusal becomes an ApiError so
// the screens word every failure the same way, by its code.
export const outcome = <T extends { ok: boolean; code: string | null }>(result: T): T => {
  if (!result.ok) throw new ApiError(result.code ?? 'UNKNOWN', 'The API refused the change.')
  return result
}

export const isApiError = (error: unknown, code?: string): error is ApiError =>
  error instanceof ApiError && (code === undefined || error.code === code)
