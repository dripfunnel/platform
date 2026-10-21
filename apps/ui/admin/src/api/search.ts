// The header search: `search(query)` on the Admin API (FIRST-RELEASE.md §2, §12), partners and
// stores by name, domain, code or owner email, capped by the server.
import { z } from 'zod'
import { query } from './client'
import { partnerStates, type PartnerState } from './partners'
import { apiStoreStatus, type StoreStatus } from './stores'

export interface PartnerMatch {
  id: string
  name: string
  state: PartnerState
  host: string | null
  ownerEmail: string | null
}

export interface StoreMatch {
  id: string
  name: string
  code: string
  status: StoreStatus
  partnerName: string
  ownerEmail: string | null
  host: string | null
}

export interface SearchResult {
  partners: readonly PartnerMatch[]
  stores: readonly StoreMatch[]
}

// The API wants two characters or more; the dialog waits for them instead of asking.
export const searchMinLength = 2

const searchSchema = z.object({
  search: z.object({
    partners: z.array(z.object({ id: z.string(), name: z.string(), state: z.enum(partnerStates), host: z.string().nullable(), ownerEmail: z.string().nullable() })),
    stores: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        code: z.string(),
        status: apiStoreStatus,
        partnerName: z.string(),
        ownerEmail: z.string().nullable(),
        host: z.string().nullable(),
      }),
    ),
  }),
})

export const search = async (text: string): Promise<SearchResult> =>
  (
    await query(
      `query Search($query: String!) { search(query: $query) {
        partners { id name state host ownerEmail }
        stores { id name code status partnerName ownerEmail host } } }`,
      searchSchema,
      { query: text },
    )
  ).search
