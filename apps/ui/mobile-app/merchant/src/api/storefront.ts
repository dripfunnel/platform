import { z } from 'zod'
import { typedQuery, type ApiClient } from '../graphql'

// The compact Storefront screen on the Store API (FIRST-RELEASE (store) §14; apps/api src/apis/store/storefront.ts, studio.ts, publishing.ts, preview.ts).
// `storefront.read` reads; `publish` (the Owner) changes, and the API refuses everyone else.

const text = z.string().nullable()

export const storefrontStatuses = ['not_started', 'creating', 'create_failed', 'not_published', 'same_as_live', 'unpublished_changes'] as const

const versionSchema = z.object({ id: z.string(), number: z.number().int(), template: text, label: text, live: z.boolean(), publishedAt: z.string() })
export type StorefrontVersion = z.infer<typeof versionSchema>

const overviewSchema = z.object({
  status: z.enum(storefrontStatuses),
  live: z.object({ number: z.number().int() }).nullable(),
  draft: z.object({ previewReady: z.boolean() }).nullable(),
  // The newest finished design or catalogue publish.
  lastPublish: z.object({ state: z.enum(['live', 'failed', 'rolled_back']) }).nullable(),
  // Newest first; the API's first page.
  history: z.array(versionSchema),
})
export type StorefrontOverview = z.infer<typeof overviewSchema>

export const loadOverview = async (client: ApiClient): Promise<StorefrontOverview> =>
  (
    await typedQuery(client)(
      '{ storefront { status live { number } draft { previewReady } lastPublish { state } history { id number template label live publishedAt } } }',
      z.object({ storefront: overviewSchema }),
    )
  ).storefront

const domainsSchema = z.object({ domains: z.array(z.object({ host: z.string(), primary: z.boolean() })) })

/** The address shoppers use: the store's main one, else the first the API lists (the free address). */
export const loadShopHost = async (client: ApiClient): Promise<string | null> => {
  const { storefrontDomains } = await typedQuery(client)('{ storefrontDomains { domains { host primary } } }', z.object({ storefrontDomains: domainsSchema.nullable() }))
  const domains = storefrontDomains?.domains ?? []
  return (domains.find((domain) => domain.primary) ?? domains[0])?.host ?? null
}

const chatSchema = z.object({ messages: z.array(z.object({ role: z.string(), text: z.string() })) })

/** What the person last asked the designer for, which is what the draft holds. */
export const loadLatestRequest = async (client: ApiClient): Promise<string | null> => {
  const { designChat } = await typedQuery(client)('{ designChat { messages { role text } } }', z.object({ designChat: chatSchema.nullable() }))
  return designChat?.messages.find((message) => message.role === 'user')?.text ?? null
}

export const designOutcomes = ['changed', 'unchanged', 'refused', 'failed'] as const
export type DesignOutcome = (typeof designOutcomes)[number]

/** The API's own limit on one request (saas/ai-designer studio.ts). */
export const requestLimit = 2000

const answerSchema = z.object({ outcome: z.enum(designOutcomes), message: z.object({ text: z.string() }).nullable() })
export type DesignAnswer = { outcome: DesignOutcome; reply: string | null }

/** One change, checked and repaired in the store's sandbox before it answers; the phone always asks for the home page as a phone sees it. */
export const askDesign = async (client: ApiClient, request: string): Promise<DesignAnswer> => {
  const { askDesign: answer } = await typedQuery(client)(
    'mutation Ask($text: String!, $page: String!, $device: String!) { askDesign(text: $text, page: $page, device: $device) { outcome message { text } } }',
    z.object({ askDesign: answerSchema }),
    { text: request, page: '/', device: 'phone' },
  )
  return { outcome: answer.outcome, reply: answer.message?.text ?? null }
}

export const discardDraft = async (client: ApiClient): Promise<void> => {
  await typedQuery(client)('mutation { discardDraft }', z.object({ discardDraft: z.boolean() }))
}

/** A signed link to the draft on the store's preview host (PREVIEW §5), recorded as opened. It is a bearer credential: open it, never show or log it. */
export const previewLink = async (client: ApiClient): Promise<string> => (await typedQuery(client)('mutation { previewLink }', z.object({ previewLink: z.string() }))).previewLink

/** The draft through the whole site's checks; answers the publish's id for `loadPublishRun`. */
export const publishDesign = async (client: ApiClient): Promise<string> => (await typedQuery(client)('mutation { publishDesign }', z.object({ publishDesign: z.string() }))).publishDesign

export const publishSteps = ['queued', 'checking', 'going_live', 'live', 'failed', 'rolled_back'] as const
export type PublishStep = (typeof publishSteps)[number]

// `bisectMessageId` is the change a refused publish blames, when one is (the studio offers "Publish everything before this change").
const runSchema = z.object({ step: z.enum(publishSteps), version: z.number().int().nullable(), checks: z.array(z.object({ passed: z.boolean(), words: text })), bisectMessageId: text.optional() })
export type PublishRun = z.infer<typeof runSchema>

/** Null for a publish that isn't this store's. */
export const loadPublishRun = async (client: ApiClient, id: string): Promise<PublishRun | null> =>
  (await typedQuery(client)('query Run($id: ID!) { publishRun(id: $id) { step version checks { passed words } bisectMessageId } }', z.object({ publishRun: runSchema.nullable() }), { id })).publishRun

/** The version's kept build goes live again by moving the live pointer, using no build minutes; the draft becomes it (AI-STUDIO §5). */
export const goBackToVersion = async (client: ApiClient, number: number): Promise<void> => {
  await typedQuery(client)('mutation Back($number: Int!) { goBackToVersion(number: $number) }', z.object({ goBackToVersion: z.boolean() }), { number })
}
