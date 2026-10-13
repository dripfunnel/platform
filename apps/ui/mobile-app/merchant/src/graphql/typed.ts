import type { z } from 'zod'
import { ApiError } from './errors'
import type { ApiClient } from './client'

// Every answer is decoded with a zod schema written from apps/api/schema/ (ARCHITECTURE.md §5).
// The message names the field that drifted; the screens show only the code.
export const decode = <Schema extends z.ZodType>(schema: Schema, data: unknown): z.infer<Schema> => {
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
    decode(schema, await client.request<unknown>(operation, variables))
