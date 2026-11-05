import { z } from 'zod'
import { allPages } from './allPages'
import { createApiClient, typedQuery } from '@dripfunnel/shared/graphql'
import { actingHeaders, actingStore } from '../acting'
import { query } from './client'

// A change waits on the model, up to 180 s a try (SAAS §9.3); the 15 s default would show a failure while it still runs.
const slowQuery = typedQuery(createApiClient({ headers: actingHeaders, timeoutMs: 200_000 }))
// A plan's build is up to six such changes one after another (#1243); the live feed shows each page meanwhile.
const buildQuery = typedQuery(createApiClient({ headers: actingHeaders, timeoutMs: 6 * 200_000 }))

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

/** Focus or typing in the studio: wakes the store's sandbox if it stopped, and puts off its idle stop (AI-STUDIO §7). */
export const studioActivity = async (): Promise<void> => {
  await query('mutation { studioActivity }', z.object({ studioActivity: z.boolean() }), {})
}

const text = z.string().nullable()
// #1243: a vague request's questions, its plan, and a build's pages (storefront AI-STUDIO §4 "A plan").
export const flowStates = ['open', 'answered', 'skipped', 'replaced', 'building', 'built'] as const
export const buildOutcomes = ['changed', 'unchanged', 'refused', 'failed', 'left'] as const
const planSchema = z.object({ header: text, footer: text, pages: z.array(z.object({ page: z.string(), title: z.string(), sections: z.array(z.string()) })) })
export type DesignPlan = z.infer<typeof planSchema>
const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'ai', 'note', 'error', 'questions', 'plan']),
  text: z.string(),
  changed: z.array(z.string()),
  imageAssetId: text,
  sampleUrl: text,
  canUndo: z.boolean(),
  undone: z.boolean(),
  createdAt: z.string(),
  questions: z.array(z.object({ text: z.string(), options: z.array(z.string()) })),
  answers: z.array(text),
  plan: planSchema.nullable(),
  flowState: z.enum(flowStates).nullable(),
  build: z.object({ pages: z.array(z.object({ page: z.string(), title: z.string(), outcome: z.enum(buildOutcomes) })), stopped: z.boolean() }).nullable(),
})
export type DesignMessage = z.infer<typeof messageSchema>
const messageFields = 'id role text changed imageAssetId sampleUrl canUndo undone createdAt questions { text options } answers plan { header footer pages { page title sections } } flowState build { pages { page title outcome } stopped }'

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

const outcomeOf = z.object({ outcome: z.string() })

/** "Make the plan" with the answers in the questions' order (an option, words of their own, or ""), or Skip questions. */
export const answerDesignQuestions = async (messageId: string, answers: readonly string[], skip: boolean, model: string | null): Promise<string> =>
  (await slowQuery('mutation Q($id: ID!, $a: [String!]!, $s: Boolean, $m: String) { answerDesignQuestions(messageId: $id, answers: $a, skip: $s, model: $m) { outcome } }', z.object({ answerDesignQuestions: outcomeOf }), { id: messageId, a: answers, s: skip, m: model })).answerDesignQuestions.outcome

/** A change to the open plan, asked in words; it takes no new AI request. */
export const changeDesignPlan = async (messageId: string, words: string, model: string | null): Promise<string> =>
  (await slowQuery('mutation C($id: ID!, $t: String!, $m: String) { changeDesignPlan(messageId: $id, text: $t, model: $m) { outcome } }', z.object({ changeDesignPlan: outcomeOf }), { id: messageId, t: words, m: model })).changeDesignPlan.outcome

/** Build it: every planned page, home first; cancelDesign ends it after the page being built. */
export const buildDesignPlan = async (messageId: string, model: string | null): Promise<string> =>
  (await buildQuery('mutation B($id: ID!, $m: String) { buildDesignPlan(messageId: $id, model: $m) { outcome } }', z.object({ buildDesignPlan: outcomeOf }), { id: messageId, m: model })).buildDesignPlan.outcome

/** The platform fetches a public https image into the store's own files; resolves its asset id (AI-STUDIO §8). */
export const importDesignImage = async (url: string): Promise<string> =>
  (await query('mutation I($u: String!) { importDesignImage(url: $u) }', z.object({ importDesignImage: z.string() }), { u: url })).importDesignImage

/** Stops the change running for this store; the pending askDesign then answers `cancelled`. */
export const cancelDesign = async (): Promise<boolean> => (await query('mutation { cancelDesign }', z.object({ cancelDesign: z.boolean() }), {})).cancelDesign

const stockPhoto = z.object({ id: z.string(), source: z.string(), thumb: z.string(), user: z.string(), pageUrl: z.string(), tags: z.string() })
export type StockPhoto = z.infer<typeof stockPhoto>

/** Whether any stock photo source is on; the picker is hidden without one. */
export const loadStockAvailable = async (): Promise<boolean> => (await query('query { stockImagesAvailable }', z.object({ stockImagesAvailable: z.boolean() }), {})).stockImagesAvailable

export const searchStockImages = async (words: string, page: number): Promise<StockPhoto[]> =>
  (await query('query S($q: String!, $p: Int!) { searchStockImages(query: $q, page: $p) { id source thumb user pageUrl tags } }', z.object({ searchStockImages: z.array(stockPhoto) }), { q: words, p: page })).searchStockImages

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

// Live progress (storefront AI-STUDIO §4 "Live progress", #1237): the one socket next to GraphQL, one-way, to the store's
// studio; it never starts or changes anything, so askDesign and cancelDesign stay the only writes.
export const liveSteps = ['reading', 'asking', 'planning', 'checking', 'repairing', 'editing', 'saving', 'updating'] as const
export type LiveStep = (typeof liveSteps)[number]

const liveBase = { seq: z.number().int().positive(), run: z.string() }
const liveEventSchema = z.discriminatedUnion('type', [
  z.object({ ...liveBase, type: z.literal('step'), step: z.enum(liveSteps), attempt: z.number().int().optional(), of: z.number().int().optional() }),
  z.object({ ...liveBase, type: z.literal('text'), text: z.string() }),
  z.object({ ...liveBase, type: z.literal('thought'), text: z.string() }),
  z.object({ ...liveBase, type: z.literal('page'), index: z.number().int().positive(), of: z.number().int().positive(), page: z.string(), titles: z.array(z.string()) }),
  z.object({ ...liveBase, type: z.literal('done'), outcome: z.string(), messageId: text }),
  z.object({ ...liveBase, type: z.literal('error'), code: z.string() }),
])
export type LiveEvent = z.infer<typeof liveEventSchema>

export interface StudioLive {
  close: () => void
}

/** A dropped socket tries again after these waits, the last one repeating. */
export const liveRetryMs = [1_000, 2_000, 5_000, 10_000] as const

/**
 * Opens the studio's live socket for `session`; a dropped one reconnects with the last event seen, so only the missed
 * ones come again. `onUp` says whether it is connected: without it the studio shows "Checking your change…" as before.
 */
export const openStudioLive = (session: string, onEvent: (event: LiveEvent) => void, onUp: (up: boolean) => void, connect: (url: string) => WebSocket = (url) => new WebSocket(url)): StudioLive => {
  let last = 0
  let tries = 0
  let closed = false
  let socket: WebSocket | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const address = () => {
    const url = new URL('/api/studio/live', window.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('session', session)
    url.searchParams.set('after', String(last))
    const store = actingStore()?.storeId
    if (store) url.searchParams.set('store', store)
    return url.toString()
  }
  const open = () => {
    if (closed) return
    const s = connect(address())
    socket = s
    s.onopen = () => {
      tries = 0
      onUp(true)
    }
    s.onmessage = (message: MessageEvent) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(message.data))
      } catch {
        return
      }
      const event = liveEventSchema.safeParse(parsed)
      if (!event.success || event.data.seq <= last) return
      last = event.data.seq
      onEvent(event.data)
    }
    s.onclose = () => {
      if (socket !== s || closed) return
      onUp(false)
      timer = setTimeout(open, liveRetryMs[Math.min(tries, liveRetryMs.length - 1)])
      tries += 1
    }
  }
  open()
  return {
    close: () => {
      closed = true
      clearTimeout(timer)
      socket?.close()
    },
  }
}
