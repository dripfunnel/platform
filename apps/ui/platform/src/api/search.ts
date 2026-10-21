import { z } from 'zod'
import { query } from './client'

// The header's search over the partner's own stores (FIRST-RELEASE.md §2.2, §16): by name, code,
// domain or owner email, capped by the API, which never reaches another partner's stores.
// Shorter terms match nothing (apps/api src/saas/partnerConsole `search`), so they are not sent.
export const searchMinLength = 2

export const searchStatuses = ['trial', 'active', 'past_due', 'suspended', 'cancelled', 'closed'] as const

export type SearchStatus = (typeof searchStatuses)[number]

const searchSchema = z.object({
  search: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      code: z.string(),
      status: z.enum(searchStatuses),
      // The store's own domain when it has one.
      domain: z.string().nullable(),
      ownerEmail: z.string().nullable(),
    }),
  ),
})

export type StoreMatch = z.infer<typeof searchSchema>['search'][number]

export const searchStores = async (term: string): Promise<readonly StoreMatch[]> =>
  (await query(`query Search($term: String!) { search(query: $term) { id name code status domain ownerEmail } }`, searchSchema, { term })).search
