import { z } from 'zod'
import { typedQuery, type ApiClient } from '../graphql'

// Storefront › Pages and Journal on the Store API (FIRST-RELEASE (store) §14; apps/api src/apis/store/content.ts, SAPI 24, #338):
// `storefront.read` reads, `publish` (the Owner) writes.

export type ContentKind = 'page' | 'post'

/** The API's own limits (engine/modules/content/rules.ts), so a field never takes more than a save allows. */
export const contentLimits = { title: 200, slug: 100, text: 10_000, question: 300, answer: 5_000, seoTitle: 60, seoDescription: 160, blocks: 100, questions: 50, products: 24 } as const

export const blockKinds = ['heading', 'text', 'image', 'faq', 'products', 'form'] as const
export type BlockKind = (typeof blockKinds)[number]

export const contentStatuses = ['draft', 'scheduled', 'published'] as const
export type ContentStatus = (typeof contentStatuses)[number]

const text = z.string().nullable()
const questionSchema = z.object({ question: z.string(), answer: z.string() })
const blockSchema = z.object({ kind: z.enum(blockKinds), text, assetId: text, alt: text, items: z.array(questionSchema).nullable(), productIds: z.array(z.string()).nullable() })
export type ContentBlock = z.infer<typeof blockSchema>

const rowSchema = z.object({ id: z.string(), title: z.string(), path: z.string(), status: z.enum(contentStatuses), inMenu: z.boolean(), publishAt: text, waitingForPublish: z.boolean() })
export type ContentRow = z.infer<typeof rowSchema>
const rowFields = 'id title path status inMenu publishAt waitingForPublish'

const entrySchema = rowSchema.extend({ kind: z.enum(['page', 'post']), slug: z.string(), body: z.array(blockSchema), seoTitle: text, seoDescription: text, author: text, tags: z.array(z.string()), coverAssetId: text, revision: z.number().int() })
export type ContentEntry = z.infer<typeof entrySchema>
const entryFields = `${rowFields} kind slug body { kind text assetId alt items { question answer } productIds } seoTitle seoDescription author tags coverAssetId revision`

const pageSchema = z.object({ nodes: z.array(rowSchema), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: text }) })

/** Fifty at a time, newest first: pages by when they were edited, posts by their date. */
export const loadContentList = async (client: ApiClient, kind: ContentKind, after: string | null): Promise<{ rows: ContentRow[]; next: string | null }> => {
  const field = kind === 'page' ? 'contentPages' : 'blogPosts'
  const answer = await typedQuery(client)(`query List($after: String) { ${field}(first: 50, after: $after) { nodes { ${rowFields} } pageInfo { hasNextPage endCursor } } }`, z.object({ [field]: pageSchema.nullable() }), { after })
  const page = answer[field]
  return { rows: page?.nodes ?? [], next: page?.pageInfo.hasNextPage ? page.pageInfo.endCursor : null }
}

/** The pages the AI made (the theme's `routes.json`), which the Pages tab lists to open in the studio. */
export const loadCustomPaths = async (client: ApiClient): Promise<string[]> =>
  (await typedQuery(client)('{ customPagePaths }', z.object({ customPagePaths: z.array(z.string()).nullable() }))).customPagePaths ?? []

export const loadContentEntry = async (client: ApiClient, id: string): Promise<ContentEntry | null> =>
  (await typedQuery(client)(`query Entry($id: ID!) { contentEntry(id: $id) { ${entryFields} } }`, z.object({ contentEntry: entrySchema.nullable() }), { id })).contentEntry

export type ContentBlockInput = { kind: BlockKind; text?: string; assetId?: string; alt?: string; items?: { question: string; answer: string }[]; productIds?: string[] }

export type ContentInput = {
  title: string
  slug: string
  body: ContentBlockInput[]
  seoTitle: string | null
  seoDescription: string | null
  /** false keeps a draft, off the shop. */
  publish: boolean
  inMenu?: boolean
  /** A post's fields the phone has no control for, sent back as read so a save keeps them. */
  publishAt?: string
  author?: string | null
  tags?: string[]
  coverAssetId?: string | null
}

/** Creates (no id) or updates at the revision read; `PATH_TAKEN` carries `path` and `heldBy` (storefront ARCHITECTURE §3.1), `INVALID_INPUT` its `field`. */
export const saveContent = async (client: ApiClient, kind: ContentKind, id: string | null, revision: number | null, input: ContentInput): Promise<ContentEntry> => {
  const [field, type] = kind === 'page' ? ['saveContentPage', 'ContentPageInput'] : ['saveBlogPost', 'BlogPostInput']
  const answer = await typedQuery(client)(`mutation Save($id: ID, $revision: Int, $input: ${type}!) { ${field}(id: $id, revision: $revision, input: $input) { ${entryFields} } }`, z.object({ [field]: entrySchema }), { id, revision, input })
  const saved = answer[field]
  if (!saved) throw new Error('no answer')
  return saved
}

export const deleteContent = async (client: ApiClient, kind: ContentKind, id: string): Promise<void> => {
  const field = kind === 'page' ? 'deleteContentPage' : 'deleteBlogPost'
  await typedQuery(client)(`mutation Delete($id: ID!) { ${field}(id: $id) }`, z.object({ [field]: z.boolean().nullable() }), { id })
}
