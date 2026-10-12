import { z } from 'zod'
import { query } from './client'

// Storefront › Pages and Journal (StorefrontContent; FIRST-RELEASE §14, §19 "SAPI 24, built on #338";
// apps/api/src/apis/store/content.ts): `storefront.read` reads, `publish` (the Owner) writes.

export type ContentKind = 'page' | 'post'

/** The API's own limits (engine/modules/content/rules.ts), so a field never takes more than a save allows. */
export const contentLimits = { title: 200, slug: 100, heading: 200, text: 10_000, alt: 300, question: 300, answer: 5_000, seoTitle: 60, seoDescription: 160, author: 80, blocks: 100, questions: 50, products: 24 } as const

export const blockKinds = ['heading', 'text', 'image', 'faq', 'products', 'form'] as const
export type BlockKind = (typeof blockKinds)[number]

export const contentStatuses = ['draft', 'scheduled', 'published'] as const
export type ContentStatus = (typeof contentStatuses)[number]

const text = z.string().nullable()
const questionSchema = z.object({ question: z.string(), answer: z.string() })
const blockSchema = z.object({ kind: z.enum(blockKinds), text, assetId: text, alt: text, items: z.array(questionSchema).nullable(), productIds: z.array(z.string()).nullable() })
export type ContentBlock = z.infer<typeof blockSchema>

const rowSchema = z.object({ id: z.string(), title: z.string(), path: z.string(), status: z.enum(contentStatuses), inMenu: z.boolean(), publishAt: text, author: text, waitingForPublish: z.boolean(), updatedAt: z.string() })
export type ContentRow = z.infer<typeof rowSchema>
const rowFields = 'id title path status inMenu publishAt author waitingForPublish updatedAt'

const entrySchema = rowSchema.extend({ kind: z.enum(['page', 'post']), slug: z.string(), body: z.array(blockSchema), seoTitle: text, seoDescription: text, tags: z.array(z.string()), coverAssetId: text, revision: z.number().int() })
export type ContentEntry = z.infer<typeof entrySchema>
const entryFields = `${rowFields} kind slug body { kind text assetId alt items { question answer } productIds } seoTitle seoDescription tags coverAssetId revision`

const pageSchema = z.object({ nodes: z.array(rowSchema), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: text }) })

/** Fifty at a time, newest first: pages by when they were edited, posts by their date. */
export const loadContentList = async (kind: ContentKind, after: string | null): Promise<{ rows: ContentRow[]; next: string | null }> => {
  const field = kind === 'page' ? 'contentPages' : 'blogPosts'
  const page = (await query(`query L($after: String) { ${field}(first: 50, after: $after) { nodes { ${rowFields} } pageInfo { hasNextPage endCursor } } }`, z.object({ [field]: pageSchema.nullable() }), { after }))[field]
  return { rows: page?.nodes ?? [], next: page?.pageInfo.hasNextPage ? page.pageInfo.endCursor : null }
}

/** The pages the AI made (the theme's `routes.json`), which the Pages tab lists to open in the studio. */
export const loadCustomPaths = async (): Promise<string[]> => (await query('{ customPagePaths }', z.object({ customPagePaths: z.array(z.string()).nullable() }))).customPagePaths ?? []

export const loadContentEntry = async (id: string): Promise<ContentEntry | null> =>
  (await query(`query E($id: ID!) { contentEntry(id: $id) { ${entryFields} } }`, z.object({ contentEntry: entrySchema.nullable() }), { id })).contentEntry

export interface ContentBlockInput {
  kind: BlockKind
  text?: string
  assetId?: string
  alt?: string
  items?: { question: string; answer: string }[]
  productIds?: string[]
}

export interface ContentInput {
  title: string
  slug: string
  body: ContentBlockInput[]
  seoTitle: string | null
  seoDescription: string | null
  /** false keeps a draft, off the shop. */
  publish: boolean
  inMenu?: boolean
}

/**
 * Creates (no id) or updates at the revision read. Refused as PATH_TAKEN with `path` and `heldBy` in its details when
 * the address is held (storefront ARCHITECTURE §3.1), STALE_REVISION, INVALID_INPUT with its `field`, or NOT_FOUND.
 */
export const saveContent = async (kind: ContentKind, id: string | null, revision: number | null, input: ContentInput): Promise<ContentEntry> => {
  const [field, type] = kind === 'page' ? ['saveContentPage', 'ContentPageInput'] : ['saveBlogPost', 'BlogPostInput']
  const answer = (await query(`mutation S($id: ID, $revision: Int, $input: ${type}!) { ${field}(id: $id, revision: $revision, input: $input) { ${entryFields} } }`, z.object({ [field]: entrySchema }), { id, revision, input }))[field]
  if (!answer) throw new Error('no answer')
  return answer
}

export const deleteContent = async (kind: ContentKind, id: string): Promise<void> => {
  const field = kind === 'page' ? 'deleteContentPage' : 'deleteBlogPost'
  await query(`mutation D($id: ID!) { ${field}(id: $id) }`, z.object({ [field]: z.boolean().nullable() }), { id })
}

/** Product names for a products block, in one request; a product no longer in the catalogue reads as null. */
export const loadProductNames = async (ids: readonly string[]): Promise<Record<string, string | null>> => {
  if (ids.length === 0) return {}
  const fields = ids.map((_, i) => `p${i}: product(id: $p${i}) { name }`).join(' ')
  const variables = Object.fromEntries(ids.map((id, i) => [`p${i}`, id]))
  const answer = await query(`query N(${ids.map((_, i) => `$p${i}: ID!`).join(', ')}) { ${fields} }`, z.record(z.string(), z.object({ name: z.string() }).nullable()), variables)
  return Object.fromEntries(ids.map((id, i) => [id, answer[`p${i}`]?.name ?? null]))
}
