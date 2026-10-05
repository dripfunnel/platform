import { z } from 'zod'
import { allPages } from './allPages'
import { query } from './client'

// A product's A+ content (CatAPlus; CATALOG Q1–Q11; apps/api/schema/store.graphql, src/apis/store/story.ts): the draft
// the merchant edits, published separately, and the shared brand stories it can show.

const photoSchema = z.object({ assetId: z.string().nullable(), alt: z.string().nullable() })
export type StoryPhoto = z.infer<typeof photoSchema>

const itemSchema = z.object({ title: z.string().nullable(), text: z.string().nullable(), photo: photoSchema.nullable() })
export type StoryItem = z.infer<typeof itemSchema>

const moduleSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  side: z.string().nullable(),
  photo: photoSchema.nullable(),
  items: z.array(itemSchema).nullable(),
  photos: z.array(photoSchema).nullable(),
  productIds: z.array(z.string()).nullable(),
  blockId: z.string().nullable(),
  video: z.object({ assetId: z.string().nullable(), url: z.string().nullable() }).nullable(),
})
export type StoredModule = z.infer<typeof moduleSchema>

const storySchema = z.object({
  revision: z.number().int(),
  status: z.enum(['draft', 'live', 'changed']),
  template: z.string().nullable(),
  publishedAt: z.string().nullable(),
  modules: z.array(moduleSchema),
  // The products its comparisons name, by name.
  products: z.array(z.object({ id: z.string(), name: z.string() })),
})
export type ProductStory = z.infer<typeof storySchema>

const storyFields = 'revision status template publishedAt products { id name } modules { id kind title body side photo { assetId alt } items { title text photo { assetId alt } } photos { assetId alt } productIds blockId video { assetId url } }'

export const loadProductStory = async (productId: string): Promise<ProductStory | null> =>
  (await query(`query S($p: ID!) { productStory(productId: $p) { ${storyFields} } }`, z.object({ productStory: storySchema.nullable() }), { p: productId })).productStory

export interface StoryModuleInput {
  id: string
  kind: string
  title?: string
  body?: string
  side?: string
  photo?: { assetId: string; alt?: string }
  items?: { title?: string; text?: string; photo?: { assetId: string; alt?: string } }[]
  photos?: { assetId: string; alt?: string }[]
  productIds?: string[]
  blockId?: string
  video?: { url: string }
}

/** The draft, saved as the next revision; the live page doesn't change until it is published. */
export const saveProductStory = async (productId: string, revision: number, modules: StoryModuleInput[], template: string | null): Promise<ProductStory> =>
  (await query(`mutation S($p: ID!, $r: Int!, $input: ProductStoryInput!) { saveProductStory(productId: $p, revision: $r, input: $input) { ${storyFields} } }`, z.object({ saveProductStory: storySchema }), { p: productId, r: revision, input: { modules, template } })).saveProductStory

/** The draft goes live, refused with STORY_INCOMPLETE and its gaps while anything is missing. */
export const publishProductStory = async (productId: string, revision: number): Promise<ProductStory> =>
  (await query(`mutation P($p: ID!, $r: Int!) { publishProductStory(productId: $p, revision: $r) { ${storyFields} } }`, z.object({ publishProductStory: storySchema }), { p: productId, r: revision })).publishProductStory

/** "Copy from another product…": that product's draft becomes this one's. */
export const copyProductStory = async (fromProductId: string, toProductId: string): Promise<void> => {
  await query('mutation C($from: ID!, $to: [ID!]!) { copyProductStory(fromProductId: $from, toProductIds: $to) }', z.object({ copyProductStory: z.number() }), { from: fromProductId, to: [toProductId] })
}

/** The store's brand stories, which a Brand story module shows (the merchant side's). */
export const loadStoryBlocks = (): Promise<{ id: string; name: string }[]> =>
  allPages(async (after) => (await query('query B($after: String) { storyBlocks(first: 50, after: $after) { nodes { id name } pageInfo { hasNextPage endCursor } } }', z.object({ storyBlocks: z.object({ nodes: z.array(z.object({ id: z.string(), name: z.string() })), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }) }) }), { after })).storyBlocks)

const gapSchema = z.array(z.object({ moduleId: z.string(), field: z.string() }))
export type StoryGap = z.infer<typeof gapSchema>[number]

/** STORY_INCOMPLETE's gaps, read from the refusal's details. */
export const gapsOf = (details: Readonly<Record<string, unknown>>): StoryGap[] => {
  const parsed = gapSchema.safeParse(details['gaps'])
  return parsed.success ? parsed.data : []
}
