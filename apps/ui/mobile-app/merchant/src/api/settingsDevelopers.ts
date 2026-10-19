import { z } from 'zod'
import { allPages, pageInfoSchema, typedQuery, type ApiClient } from '../graphql'

// Settings › Developers (SetDev; FIRST-RELEASE (store) §15; apps/api src/apis/store/developers.ts, webhooks.ts): API keys and webhooks.
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

export const webhookStatuses = ['active', 'failing', 'disabled'] as const

const endpointSchema = z.object({
  id: z.string(),
  url: z.string(),
  events: z.array(z.string()),
  status: z.enum(webhookStatuses),
  failingSince: z.string().nullable(),
  disabledAt: z.string().nullable(),
  createdAt: z.string(),
})
export type WebhookEndpoint = z.infer<typeof endpointSchema>

const deliverySchema = z.object({
  id: z.string(),
  event: z.string(),
  status: z.enum(['pending', 'delivered', 'failed', 'held']),
  attempts: z.number().int(),
  responseCode: z.number().int().nullable(),
  error: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  createdAt: z.string(),
})
export type WebhookDelivery = z.infer<typeof deliverySchema>

/** The latest deliveries an endpoint's card shows. */
export const deliveriesShown = 10

export const loadWebhooks = (client: ApiClient): Promise<WebhookEndpoint[]> =>
  allPages(
    async (after) =>
      (
        await typedQuery(client)(
          `query Webhooks($after: String) { webhooks(first: 50, after: $after) { nodes { id url events status failingSince disabledAt createdAt } ${paging} } }`,
          z.object({ webhooks: z.object({ nodes: z.array(endpointSchema), pageInfo: pageInfoSchema }) }),
          { after },
        )
      ).webhooks,
  )

export const loadWebhookEvents = async (client: ApiClient): Promise<string[]> =>
  (await typedQuery(client)('{ webhookEvents }', z.object({ webhookEvents: z.array(z.string()).nullable() }))).webhookEvents ?? []

export const loadDeliveries = async (client: ApiClient, endpointId: string): Promise<WebhookDelivery[]> =>
  (
    await typedQuery(client)(
      'query Deliveries($id: ID!, $n: Int) { webhookDeliveries(endpointId: $id, first: $n) { nodes { id event status attempts responseCode error durationMs createdAt } } }',
      z.object({ webhookDeliveries: z.object({ nodes: z.array(deliverySchema) }) }),
      { id: endpointId, n: deliveriesShown },
    )
  ).webhookDeliveries.nodes

/** A new endpoint answers its signing secret, once. */
export const addWebhook = async (client: ApiClient, url: string, events: readonly string[]): Promise<{ id: string; secret: string | null }> => {
  const { saveWebhook } = await typedQuery(client)(
    'mutation AddWebhook($u: String!, $e: [String!]!) { saveWebhook(url: $u, events: $e) { id secret } }',
    z.object({ saveWebhook: z.object({ id: z.string(), secret: z.string().nullable() }).nullable() }),
    { u: url, e: events },
  )
  if (!saveWebhook) throw new Error('no endpoint was saved')
  return saveWebhook
}

/** Answers how many held events it sends. */
export const turnOnWebhook = async (client: ApiClient, id: string): Promise<number> =>
  (await typedQuery(client)('mutation TurnOnWebhook($id: ID!) { turnOnWebhook(id: $id) }', z.object({ turnOnWebhook: z.number().int().nullable() }), { id })).turnOnWebhook ?? 0

export const replayDelivery = async (client: ApiClient, id: string): Promise<void> => {
  await typedQuery(client)('mutation ReplayDelivery($id: ID!) { replayDelivery(id: $id) }', z.object({ replayDelivery: z.string().nullable() }), { id })
}
