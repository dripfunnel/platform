import { z } from 'zod'
import { allPages, pageInfoSchema, typedQuery, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

// Settings › Developers (SetDev; FIRST-RELEASE (store) §15; apps/api src/apis/store/developers.ts): API keys.
// A secret is in the answer that made it and in no other (ACCESS.md §5.6); nothing here keeps one.

const paging = 'pageInfo { hasNextPage hasPreviousPage startCursor endCursor }'

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

const issuedSchema = z.object({ id: z.string(), prefix: z.string(), secret: z.string() })
export type IssuedApiKey = z.infer<typeof issuedSchema>

/** The longest name the API takes. */
export const keyNameMax = 80

/** The keys newest first; a store holds at most 50, so the screen reads them whole. */
export const loadApiKeys = (client: ApiClient): Promise<ApiKey[]> =>
  allPages(
    async (after) =>
      (
        await typedQuery(client)(
          `query ApiKeys($after: String) { apiKeys(first: 50, after: $after) { nodes { id name prefix scopes supplier { id name } createdByName createdByHere createdAt expiresAt lastUsedAt previousWorksUntil } ${paging} } }`,
          z.object({ apiKeys: z.object({ nodes: z.array(apiKeySchema), pageInfo: pageInfoSchema }) }),
          { after },
        )
      ).apiKeys,
  )

export const loadApiKeyChoices = async (client: ApiClient): Promise<ApiKeyChoices | null> =>
  (await typedQuery(client)('{ apiKeyChoices { scopes expiresInDays requestsPerMinute requestsPerMonth } }', z.object({ apiKeyChoices: choicesSchema.nullable() }))).apiKeyChoices

export type NewApiKey = {
  name: string
  scopes: readonly string[]
  /** Null works for the whole store. */
  supplierId: string | null
  /** Null never expires. */
  expiresInDays: number | null
}

export const createApiKey = async (client: ApiClient, key: NewApiKey): Promise<IssuedApiKey> => {
  const { createApiKey: issued } = await typedQuery(client)(
    'mutation CreateApiKey($n: String!, $s: [String!]!, $v: ID, $e: Int) { createApiKey(name: $n, scopes: $s, supplierId: $v, expiresInDays: $e) { id prefix secret } }',
    z.object({ createApiKey: issuedSchema.nullable() }),
    { n: key.name, s: key.scopes, v: key.supplierId, e: key.expiresInDays },
  )
  if (!issued) throw new Error('no key was issued')
  return issued
}

export const rotateApiKey = async (client: ApiClient, id: string): Promise<IssuedApiKey> => {
  const { rotateApiKey: issued } = await typedQuery(client)('mutation RotateApiKey($id: ID!) { rotateApiKey(id: $id) { id prefix secret } }', z.object({ rotateApiKey: issuedSchema.nullable() }), { id })
  if (!issued) throw new Error('no key was issued')
  return issued
}

export const revokeApiKey = async (client: ApiClient, id: string): Promise<void> => {
  await typedQuery(client)('mutation RevokeApiKey($id: ID!) { revokeApiKey(id: $id) }', z.object({ revokeApiKey: z.boolean().nullable() }), { id })
}
