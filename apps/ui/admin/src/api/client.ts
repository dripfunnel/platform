import { createApiClient, outcome, typedQuery } from '@dripfunnel/shared/graphql'
import { z } from 'zod'

// The one client of this app (ui/README.md §3). Every module in src/api/ sends its operation
// through `query` and decodes the answer with a zod schema written from apps/api/schema/admin.graphql.
export const api = createApiClient()

export const query = typedQuery(api)

const outcomeSchema = z.object({ ok: z.boolean(), code: z.string().nullable() })

// One mutation returning the §12 outcome; `selection` is the field with its arguments.
export const mutate = async (field: string, selection: string, args: string, variables: Record<string, unknown>): Promise<void> => {
  const result = await query(`mutation ${field}${args} { ${selection} { ok code } }`, z.object({ [field]: outcomeSchema }), variables)
  outcome(result[field] as z.infer<typeof outcomeSchema>)
}

export { isApiError, outcome } from '@dripfunnel/shared/graphql'
