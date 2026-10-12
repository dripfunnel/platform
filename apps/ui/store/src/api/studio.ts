import { z } from 'zod'
import { query } from './client'

// The AI studio (PortalStorefront › studio; FIRST-RELEASE §14, §19 "Built on #318 (part 2)"; storefront AI-STUDIO §3–§5):
// `storefront.read` reads, `publish` (the Owner) changes.

export const studioStates = ['starting', 'queued', 'ready', 'busy', 'unavailable'] as const
export type StudioState = (typeof studioStates)[number]

const sessionSchema = z.object({ state: z.enum(studioStates), place: z.number().int().nullable(), session: z.string(), frameUrl: z.string(), access: z.enum(['change', 'view']), expiresAt: z.string() })
export type StudioSession = z.infer<typeof sessionSchema>

/** Opens the studio, or with a live `session` of the caller's renews it and reads where the sandbox stands. */
export const loadStudioSession = async (session: string | null): Promise<StudioSession> =>
  (await query('query S($s: String) { studioSession(session: $s) { state place session frameUrl access expiresAt } }', z.object({ studioSession: sessionSchema }), { s: session })).studioSession

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
  page: string
  device: StudioDevice
}

/** One change, checked and repaired in the store's sandbox before it answers: changed, unchanged, refused or failed. */
export const askDesign = async (input: DesignRequest): Promise<string> =>
  (
    await query(
      'mutation A($text: String!, $image: ID, $sample: String, $page: String!, $device: String!) { askDesign(text: $text, imageAssetId: $image, sampleUrl: $sample, page: $page, device: $device) { outcome } }',
      z.object({ askDesign: z.object({ outcome: z.string() }) }),
      { text: input.text, image: input.imageAssetId, sample: input.sampleUrl, page: input.page, device: input.device },
    )
  ).askDesign.outcome

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

export const loadStudioPages = async (): Promise<StudioPages> => {
  const r = await query(
    '{ products(first: 1, sort: "updated") { nodes { name slug } } contentPages(first: 50) { nodes { title path } } customPagePaths }',
    z.object({
      products: z.object({ nodes: z.array(z.object({ name: z.string(), slug: text })) }).nullable(),
      contentPages: z.object({ nodes: z.array(z.object({ title: z.string(), path: z.string() })) }).nullable(),
      customPagePaths: z.array(z.string()).nullable(),
    }),
  )
  const first = r.products?.nodes[0]
  return { product: first?.slug ? { name: first.name, slug: first.slug } : null, content: r.contentPages?.nodes ?? [], custom: r.customPagePaths ?? [] }
}

/** The languages Edit text offers, the main one first. */
export const loadStudioLanguages = async (): Promise<string[]> => {
  const { storeLocale } = await query('{ storeLocale { mainLanguage offeredLanguages } }', z.object({ storeLocale: z.object({ mainLanguage: z.string(), offeredLanguages: z.array(z.string()) }).nullable() }))
  return storeLocale ? [storeLocale.mainLanguage, ...storeLocale.offeredLanguages.filter((l) => l !== storeLocale.mainLanguage)] : []
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
