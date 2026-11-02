import { z } from 'zod'
import { query } from './client'

// Storefront › Journal (StorefrontContent; FIRST-RELEASE §14, §19 "SAPI 24, built on #338";
// apps/api/src/apis/store/content.ts): `storefront.read` reads, `publish` (the Owner) writes.

/** The API's own limits (engine/modules/content/rules.ts), so a field never takes more than a save allows. */
export const contentLimits = { title: 200, slug: 100, heading: 200, text: 10_000, alt: 300, question: 300, answer: 5_000, seoTitle: 60, seoDescription: 160, author: 80, blocks: 100, questions: 50, products: 24 } as const

export const blockKinds = ['heading', 'text', 'image', 'faq', 'products'] as const
export type BlockKind = (typeof blockKinds)[number]

export const contentStatuses = ['draft', 'scheduled', 'published'] as const
export type ContentStatus = (typeof contentStatuses)[number]

const text = z.string().nullable()
const questionSchema = z.object({ question: z.string(), answer: z.string() })
const blockSchema = z.object({ kind: z.enum(blockKinds), text, assetId: text, alt: text, items: z.array(questionSchema).nullable(), productIds: z.array(z.string()).nullable() })
export type ContentBlock = z.infer<typeof blockSchema>

const rowSchema = z.object({ id: z.string(), title: z.string(), path: z.string(), status: z.enum(contentStatuses), publishAt: text, author: text, waitingForPublish: z.boolean(), updatedAt: z.string() })
export type ContentRow = z.infer<typeof rowSchema>
const rowFields = 'id title path status publishAt author waitingForPublish updatedAt'

const entrySchema = rowSchema.extend({ slug: z.string(), body: z.array(blockSchema), seoTitle: text, seoDescription: text, tags: z.array(z.string()), coverAssetId: text, revision: z.number().int() })
export type ContentEntry = z.infer<typeof entrySchema>
const entryFields = `${rowFields} slug body { kind text assetId alt items { question answer } productIds } seoTitle seoDescription tags coverAssetId revision`

const pageSchema = z.object({ nodes: z.array(rowSchema), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: text }) })

/** Fifty at a time, newest first by their date. */
export const loadContentList = async (after: string | null): Promise<{ rows: ContentRow[]; next: string | null }> => {
  const page = (await query(`query L($after: String) { blogPosts(first: 50, after: $after) { nodes { ${rowFields} } pageInfo { hasNextPage endCursor } } }`, z.object({ blogPosts: pageSchema.nullable() }), { after })).blogPosts
  return { rows: page?.nodes ?? [], next: page?.pageInfo.hasNextPage ? page.pageInfo.endCursor : null }
}

// contentEntry answers any kind; a page reads as missing, since only posts are edited here (#1078).
const entryAnswer = z.union([entrySchema.extend({ kind: z.literal('post') }), z.object({ kind: z.literal('page') })]).nullable()

export const loadContentEntry = async (id: string): Promise<ContentEntry | null> => {
  const entry = (await query(`query E($id: ID!) { contentEntry(id: $id) { kind ${entryFields} } }`, z.object({ contentEntry: entryAnswer }), { id })).contentEntry
  return entry?.kind === 'post' ? entry : null
}

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
  /** Later than now schedules the post; left out, it is dated when published. */
  publishAt?: string
  author: string | null
  tags: string[]
  coverAssetId: string | null
}

/**
 * Creates (no id) or updates at the revision read. Refused as PATH_TAKEN with `path` and `heldBy` in its details when
 * the address is held (storefront ARCHITECTURE §3.1), STALE_REVISION, INVALID_INPUT with its `field`, or NOT_FOUND.
 */
export const saveContent = async (id: string | null, revision: number | null, input: ContentInput): Promise<ContentEntry> =>
  (await query(`mutation S($id: ID, $revision: Int, $input: BlogPostInput!) { saveBlogPost(id: $id, revision: $revision, input: $input) { ${entryFields} } }`, z.object({ saveBlogPost: entrySchema }), { id, revision, input })).saveBlogPost

export const deleteContent = async (id: string): Promise<void> => {
  await query('mutation D($id: ID!) { deleteBlogPost(id: $id) }', z.object({ deleteBlogPost: z.boolean().nullable() }), { id })
}

const translationSchema = z.object({ language: z.string(), title: z.string(), body: z.array(blockSchema), seoTitle: text, seoDescription: text, changed: z.boolean() })
export type ContentTranslation = z.infer<typeof translationSchema>

/** A post's words in another language the store offers; null until written. */
export const loadContentTranslation = async (id: string, language: string): Promise<ContentTranslation | null> =>
  (
    await query(
      'query T($id: ID!, $language: String!) { contentTranslation(id: $id, language: $language) { language title body { kind text assetId alt items { question answer } productIds } seoTitle seoDescription changed } }',
      z.object({ contentTranslation: translationSchema.nullable() }),
      { id, language },
    )
  ).contentTranslation

export interface ContentTranslationInput {
  title: string
  body: ContentBlockInput[]
  seoTitle: string | null
  seoDescription: string | null
}

/** Saves another language's words, or with null removes them, so the shop shows the main language's. */
export const saveContentTranslation = async (id: string, language: string, input: ContentTranslationInput | null): Promise<void> => {
  await query('mutation W($id: ID!, $language: String!, $input: ContentTranslationInput) { saveBlogPostTranslation(id: $id, language: $language, input: $input) { language } }', z.object({ saveBlogPostTranslation: z.object({ language: z.string() }).nullable() }), { id, language, input })
}
