import { z } from 'zod'
import { allPages } from './allPages'
import { query } from './client'

// Settings › Developers (SetDev, FIRST-RELEASE §15; apps/api/src/apis/store/developers.ts and webhooks.ts).

const pageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })

const apiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  supplier: z.object({ id: z.string(), name: z.string() }).nullable(),
  createdByName: z.string().nullable(),
  createdByHere: z.boolean(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  previousWorksUntil: z.string().nullable(),
})
export type ApiKey = z.infer<typeof apiKeySchema>

const choicesSchema = z.object({
  scopes: z.array(z.string()),
  expiresInDays: z.array(z.number().int()),
  requestsPerMinute: z.number().int(),
  requestsPerMonth: z.number().int(),
})
export type ApiKeyChoices = z.infer<typeof choicesSchema>

/** A key's secret, in this answer and no other (ACCESS §5.6). */
const issuedSchema = z.object({ id: z.string(), prefix: z.string(), secret: z.string() })
export type IssuedApiKey = z.infer<typeof issuedSchema>

export const loadApiKeys = (): Promise<ApiKey[]> =>
  allPages(
    async (after) =>
      (
        await query(
          'query K($after: String) { apiKeys(first: 50, after: $after) { nodes { id name prefix scopes supplier { id name } createdByName createdByHere createdAt expiresAt lastUsedAt previousWorksUntil } pageInfo { hasNextPage endCursor } } }',
          z.object({ apiKeys: z.object({ nodes: z.array(apiKeySchema), pageInfo: pageInfoSchema }) }),
          { after },
        )
      ).apiKeys,
  )

export const loadApiKeyChoices = async (): Promise<ApiKeyChoices> =>
  (await query('{ apiKeyChoices { scopes expiresInDays requestsPerMinute requestsPerMonth } }', z.object({ apiKeyChoices: choicesSchema }))).apiKeyChoices

/** The longest name the API takes (apps/api/src/saas/apiKeys). */
export const keyNameMax = 80

export interface NewApiKey {
  name: string
  scopes: readonly string[]
  /** Null works for the whole store. */
  supplierId: string | null
  /** Null never expires. */
  expiresInDays: number | null
}

export const createApiKey = async (key: NewApiKey): Promise<IssuedApiKey> =>
  (
    await query('mutation C($n: String!, $s: [String!]!, $v: ID, $e: Int) { createApiKey(name: $n, scopes: $s, supplierId: $v, expiresInDays: $e) { id prefix secret } }', z.object({ createApiKey: issuedSchema }), {
      n: key.name,
      s: key.scopes,
      v: key.supplierId,
      e: key.expiresInDays,
    })
  ).createApiKey

export const rotateApiKey = async (id: string): Promise<IssuedApiKey> => (await query('mutation R($id: ID!) { rotateApiKey(id: $id) { id prefix secret } }', z.object({ rotateApiKey: issuedSchema }), { id })).rotateApiKey

export const revokeApiKey = async (id: string): Promise<void> => {
  await query('mutation R($id: ID!) { revokeApiKey(id: $id) }', z.object({ revokeApiKey: z.boolean() }), { id })
}
