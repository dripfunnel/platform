import { z } from 'zod'
import { typedQuery, type ApiClient } from '../graphql'
import { designOutcomes, storefrontStatuses } from './storefront'

// The AI studio on the Store API (FIRST-RELEASE (store) §14; storefront AI-STUDIO §3–§5, §8; apps/api src/apis/store/studio.ts):
// `storefront.read` reads, `publish` (the Owner) changes, and the API refuses everyone else.

const designSchema = z.object({
  status: z.enum(storefrontStatuses),
  template: z.string().nullable(),
  live: z.object({ number: z.number().int() }).nullable(),
  draft: z.object({ previewReady: z.boolean() }).nullable(),
  history: z.array(z.object({ number: z.number().int() })),
})
export type DesignOverview = z.infer<typeof designSchema>

/** What the designer and the studio read of the site: where it stands, its template, the live version, the draft and the numbers taken. */
export const loadDesign = async (client: ApiClient): Promise<DesignOverview> =>
  (await typedQuery(client)('{ storefront { status template live { number } draft { previewReady } history { number } } }', z.object({ storefront: designSchema }))).storefront

export const studioStates = ['starting', 'queued', 'ready', 'busy', 'unavailable'] as const
export type StudioState = (typeof studioStates)[number]

const sessionSchema = z.object({ state: z.enum(studioStates), place: z.number().int().nullable(), session: z.string(), frameUrl: z.string(), access: z.enum(['change', 'view']), expiresAt: z.string() })
export type StudioSession = z.infer<typeof sessionSchema>

/** Opens the studio, or with a live `session` of the caller's renews it and reads where the sandbox stands. The id is a bearer credential: it goes to the frame's address and nowhere else. */
export const loadStudioSession = async (client: ApiClient, session: string | null): Promise<StudioSession> =>
  (await typedQuery(client)('query Studio($s: String) { studioSession(session: $s) { state place session frameUrl access expiresAt } }', z.object({ studioSession: sessionSchema }), { s: session })).studioSession

/** Refused with `SESSION_ENDED` once the seat no longer has the studio (AI-STUDIO §8). */
export const renewStudioSession = async (client: ApiClient, session: string): Promise<void> => {
  await typedQuery(client)('mutation Renew($s: String!) { renewStudioSession(session: $s) }', z.object({ renewStudioSession: z.string() }), { s: session })
}

const text = z.string().nullable()
const messageSchema = z.object({ id: z.string(), role: z.enum(['user', 'ai', 'note', 'error']), text: z.string(), changed: z.array(z.string()), sampleUrl: text, canUndo: z.boolean(), undone: z.boolean() })
export type DesignMessage = z.infer<typeof messageSchema>

/** Newest first; the API's first page of 50. */
export const loadDesignChat = async (client: ApiClient): Promise<DesignMessage[]> =>
  (await typedQuery(client)('{ designChat { messages { id role text changed sampleUrl canUndo undone } } }', z.object({ designChat: z.object({ messages: z.array(messageSchema) }).nullable() }))).designChat?.messages ?? []

export type StudioRequest = { text: string; sampleUrl: string | null; page: string }

/** One change, checked and repaired in the store's sandbox before it answers: changed, unchanged, refused or failed. The phone always asks for the page as a phone sees it. */
export const askStudio = async (client: ApiClient, request: StudioRequest): Promise<(typeof designOutcomes)[number]> =>
  (
    await typedQuery(client)(
      'mutation Ask($text: String!, $sample: String, $page: String!, $device: String!) { askDesign(text: $text, sampleUrl: $sample, page: $page, device: $device) { outcome } }',
      z.object({ askDesign: z.object({ outcome: z.enum(designOutcomes) }) }),
      { text: request.text, sample: request.sampleUrl, page: request.page, device: 'phone' },
    )
  ).askDesign.outcome

export const undoDesignChange = async (client: ApiClient, messageId: string): Promise<void> => {
  await typedQuery(client)('mutation Undo($id: ID!) { undoDesignChange(messageId: $id) { id } }', z.object({ undoDesignChange: z.object({ id: z.string() }) }), { id: messageId })
}

/** "Publish everything before this change": the change a refused publish named. Answers the publish's id. */
export const publishBefore = async (client: ApiClient, messageId: string): Promise<string> =>
  (await typedQuery(client)('mutation Before($id: ID!) { publishBefore(messageId: $id) }', z.object({ publishBefore: z.string() }), { id: messageId })).publishBefore

/** Everything the page picker lists that isn't one of core's routes: a product to show, content pages and the AI's own pages. */
export type StudioPages = { product: { name: string; slug: string } | null; content: { title: string; path: string }[]; custom: string[] }

const contentPagesSchema = z.object({ nodes: z.array(z.object({ title: z.string(), path: z.string() })), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: text }) })
const pagesAnswer = z.object({ contentPages: contentPagesSchema.nullable() })

/** The API's pages are 50 long; more than ten of them is not a list a phone's picker can hold. */
const contentPageLimit = 10

const loadContentPages = async (client: ApiClient): Promise<StudioPages['content']> => {
  const out: StudioPages['content'] = []
  let after: string | null = null
  for (let page = 0; page < contentPageLimit; page += 1) {
    const answer: z.infer<typeof pagesAnswer> = await typedQuery(client)(
      'query Pages($after: String) { contentPages(first: 50, after: $after) { nodes { title path } pageInfo { hasNextPage endCursor } } }',
      pagesAnswer,
      { after },
    )
    const { contentPages } = answer
    out.push(...(contentPages?.nodes ?? []))
    if (!contentPages?.pageInfo.hasNextPage) break
    after = contentPages.pageInfo.endCursor
  }
  return out
}

export const loadStudioPages = async (client: ApiClient): Promise<StudioPages> => {
  const [first, content] = await Promise.all([
    typedQuery(client)(
      '{ products(first: 1, sort: "updated") { nodes { name slug } } customPagePaths }',
      z.object({ products: z.object({ nodes: z.array(z.object({ name: z.string(), slug: text })) }).nullable(), customPagePaths: z.array(z.string()).nullable() }),
    ),
    loadContentPages(client),
  ])
  const product = first.products?.nodes[0]
  return { product: product?.slug ? { name: product.name, slug: product.slug } : null, content, custom: first.customPagePaths ?? [] }
}
