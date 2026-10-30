import { z } from 'zod'
import { allPages } from './allPages'
import { createApiClient, typedQuery } from '@dripfunnel/shared/graphql'
import { actingHeaders } from '../acting'
import { query } from './client'

// A change waits on the model, up to 180 s a try (SAAS §9.3); the 15 s default would show a failure while it still runs.
const slowQuery = typedQuery(createApiClient({ headers: actingHeaders, timeoutMs: 200_000 }))

// The AI studio (PortalStorefront › studio; FIRST-RELEASE §14, §19 "Built on #318 (part 2)"; storefront AI-STUDIO §3–§5):
// `storefront.read` reads, `publish` (the Owner) changes.

export const studioStates = ['starting', 'queued', 'ready', 'busy', 'unavailable'] as const
export type StudioState = (typeof studioStates)[number]

const sessionSchema = z.object({ state: z.enum(studioStates), place: z.number().int().nullable(), session: z.string(), models: z.array(z.string()), frameUrl: z.string(), access: z.enum(['change', 'view']), expiresAt: z.string() })
export type StudioSession = z.infer<typeof sessionSchema>

/** Opens the studio, or with a live `session` of the caller's renews it and reads where the sandbox stands. */
export const loadStudioSession = async (session: string | null): Promise<StudioSession> =>
  (await query('query S($s: String) { studioSession(session: $s) { state place session models frameUrl access expiresAt } }', z.object({ studioSession: sessionSchema }), { s: session })).studioSession

/** Refused with SESSION_ENDED once the seat no longer has the studio (AI-STUDIO §8). */
export const renewStudioSession = async (session: string): Promise<void> => {
  await query('mutation R($s: String!) { renewStudioSession(session: $s) }', z.object({ renewStudioSession: z.string() }), { s: session })
}

const text = z.string().nullable()
const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'ai', 'note', 'error']),
  text: z.string(),
  changed: z.array(z.string()),
  imageAssetId: text,
  sampleUrl: text,
  canUndo: z.boolean(),
  undone: z.boolean(),
  createdAt: z.string(),
})
export type DesignMessage = z.infer<typeof messageSchema>
const messageFields = 'id role text changed imageAssetId sampleUrl canUndo undone createdAt'

/** Newest first, 50 at a time. */
export const loadDesignChat = async (after: string | null): Promise<{ messages: DesignMessage[]; next: string | null }> =>
  (await query(`query C($a: String) { designChat(after: $a) { messages { ${messageFields} } next } }`, z.object({ designChat: z.object({ messages: z.array(messageSchema), next: text }) }), { a: after })).designChat

export const studioDevices = ['desktop', 'tablet', 'phone'] as const
export type StudioDevice = (typeof studioDevices)[number]

export interface DesignRequest {
  text: string
  imageAssetId: string | null
  sampleUrl: string | null
  /** One of the studio session's `models`; null where the merchant has no choice. */
  model: string | null
  page: string
  device: StudioDevice
  /** `chat` asks a question and changes nothing; the default is a change. */
  mode?: 'change' | 'chat'
}

/** One change, checked and repaired in the store's sandbox before it answers: changed, unchanged, refused or failed. */
export const askDesign = async (input: DesignRequest): Promise<string> =>
  (
    await slowQuery(
      'mutation A($text: String!, $image: ID, $sample: String, $model: String, $page: String!, $device: String!, $mode: String) { askDesign(text: $text, imageAssetId: $image, sampleUrl: $sample, model: $model, page: $page, device: $device, mode: $mode) { outcome } }',
      z.object({ askDesign: z.object({ outcome: z.string() }) }),
      { text: input.text, image: input.imageAssetId, sample: input.sampleUrl, model: input.model, page: input.page, device: input.device, mode: input.mode ?? 'change' },
    )
  ).askDesign.outcome

/** The platform fetches a public https image into the store's own files; resolves its asset id (AI-STUDIO §8). */
export const importDesignImage = async (url: string): Promise<string> =>
  (await query('mutation I($u: String!) { importDesignImage(url: $u) }', z.object({ importDesignImage: z.string() }), { u: url })).importDesignImage

/** Stops the change running for this store; the pending askDesign then answers `cancelled`. */
export const cancelDesign = async (): Promise<boolean> => (await query('mutation { cancelDesign }', z.object({ cancelDesign: z.boolean() }), {})).cancelDesign

const stockPhoto = z.object({ id: z.string(), thumb: z.string(), user: z.string(), pageUrl: z.string(), tags: z.string() })
export type StockPhoto = z.infer<typeof stockPhoto>

/** Whether the platform has a stock photo source set up; the picker is hidden without one. */
export const loadStockAvailable = async (): Promise<boolean> => (await query('query { stockImagesAvailable }', z.object({ stockImagesAvailable: z.boolean() }), {})).stockImagesAvailable

export const searchStockImages = async (words: string, page: number): Promise<StockPhoto[]> =>
  (await query('query S($q: String!, $p: Int!) { searchStockImages(query: $q, page: $p) { id thumb user pageUrl tags } }', z.object({ searchStockImages: z.array(stockPhoto) }), { q: words, p: page })).searchStockImages

/** The chosen photo is downloaded into the store's own files; resolves its asset id. */
export const useStockImage = async (id: string): Promise<string> => (await query('mutation U($i: String!) { useStockImage(id: $i) }', z.object({ useStockImage: z.string() }), { i: id })).useStockImage

export const undoDesignChange = async (messageId: string): Promise<void> => {
  await query('mutation U($id: ID!) { undoDesignChange(messageId: $id) { id } }', z.object({ undoDesignChange: z.object({ id: z.string() }) }), { id: messageId })
}

/** A page's own words and the shared ones in one language, keyed like `pages:home.lead` and `common:footer.note`. */
export const loadDesignText = async (page: string, locale: string): Promise<{ key: string; text: string }[]> =>
  (await query('query T($page: String!, $locale: String!) { designText(page: $page, locale: $locale) { key text } }', z.object({ designText: z.array(z.object({ key: z.string(), text: z.string() })) }), { page, locale })).designText

export const saveDesignText = async (locale: string, key: string, words: string): Promise<void> => {
  await query('mutation W($locale: String!, $key: String!, $text: String!) { saveDesignText(locale: $locale, key: $key, text: $text) }', z.object({ saveDesignText: z.boolean() }), { locale, key, text: words })
}

/** Everything the page picker lists that isn't one of core's routes: a product to show, content pages and the AI's own pages. */
export interface StudioPages {
  product: { name: string; slug: string } | null
  content: { title: string; path: string }[]
  custom: string[]
}

const contentPageSchema = z.object({ nodes: z.array(z.object({ title: z.string(), path: z.string() })), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: text }) })

/** Every content page, fifty at a time, so the picker lists them all. */
const loadContentPages = () =>
  allPages(async (after) => (await query('query C($after: String) { contentPages(first: 50, after: $after) { nodes { title path } pageInfo { hasNextPage endCursor } } }', z.object({ contentPages: contentPageSchema }), { after })).contentPages)

export const loadStudioPages = async (): Promise<StudioPages> => {
  const [r, content] = await Promise.all([
    query(
      '{ products(first: 1, sort: "updated") { nodes { name slug } } customPagePaths }',
      z.object({ products: z.object({ nodes: z.array(z.object({ name: z.string(), slug: text })) }).nullable(), customPagePaths: z.array(z.string()).nullable() }),
    ),
    loadContentPages(),
  ])
  const first = r.products?.nodes[0]
  return { product: first?.slug ? { name: first.name, slug: first.slug } : null, content, custom: r.customPagePaths ?? [] }
}

/** The languages Edit text offers: the store's own active ones, the main one first (the API refuses any other). */
export const loadStudioLanguages = async (): Promise<string[]> => {
  const language = z.object({ code: z.string(), status: z.string() })
  const { storeLocale } = await query('{ storeLocale { mainLanguage languages { code status } } }', z.object({ storeLocale: z.object({ mainLanguage: z.string(), languages: z.array(language) }).nullable() }))
  return storeLocale ? [storeLocale.mainLanguage, ...storeLocale.languages.filter((l) => l.status === 'active' && l.code !== storeLocale.mainLanguage).map((l) => l.code)] : []
}

// Publishing from the studio (FIRST-RELEASE §19 "Built on #318 (part 3)"; storefront AI-STUDIO §6).
export const publishSteps = ['queued', 'checking', 'going_live', 'live', 'failed', 'rolled_back'] as const
export type PublishStep = (typeof publishSteps)[number]

const runSchema = z.object({
  id: z.string(),
  step: z.enum(publishSteps),
  version: z.number().int().nullable(),
  repairAttempts: z.number().int(),
  checks: z.array(z.object({ name: z.string(), passed: z.boolean(), words: text })),
  bisectMessageId: text,
})
export type PublishRun = z.infer<typeof runSchema>

/** The draft through the whole site's checks; answers the publish's id for `loadPublishRun`. */
export const publishDesign = async (): Promise<string> => (await query('mutation { publishDesign }', z.object({ publishDesign: z.string() }))).publishDesign

/** "Publish everything before this change": the change a refused publish named. */
export const publishBefore = async (messageId: string): Promise<string> =>
  (await query('mutation B($id: ID!) { publishBefore(messageId: $id) }', z.object({ publishBefore: z.string() }), { id: messageId })).publishBefore

/** Null for a publish that isn't this store's. */
export const loadPublishRun = async (id: string): Promise<PublishRun | null> =>
  (await query('query P($id: ID!) { publishRun(id: $id) { id step version repairAttempts checks { name passed words } bisectMessageId } }', z.object({ publishRun: runSchema.nullable() }), { id })).publishRun
