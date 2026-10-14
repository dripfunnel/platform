import { z } from 'zod'
import { pageInfoSchema, typedQuery, type ApiClient } from '../graphql'

// A product's A+ content (CATALOG-DESIGN.md Q; apps/api src/apis/store/story.ts): the draft that is edited and the live page,
// published separately, and the shared brand stories a module can show.

const photoSchema = z.object({ assetId: z.string().nullable(), alt: z.string().nullable() })
const itemSchema = z.object({ title: z.string().nullable(), text: z.string().nullable(), photo: photoSchema.nullable() })

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
  /** The products a comparison names, by name. */
  products: z.array(z.object({ id: z.string(), name: z.string() })),
})
export type ProductStory = z.infer<typeof storySchema>

const storyFields = 'revision status template publishedAt products { id name } modules { id kind title body side photo { assetId alt } items { title text photo { assetId alt } } photos { assetId alt } productIds blockId video { assetId url } }'

export const loadProductStory = async (client: ApiClient, productId: string): Promise<ProductStory | null> =>
  (await typedQuery(client)(`query Story($p: ID!) { productStory(productId: $p) { ${storyFields} } }`, z.object({ productStory: storySchema.nullable() }), { p: productId })).productStory

export type StoryModuleInput = {
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
export const saveProductStory = async (client: ApiClient, productId: string, revision: number, modules: StoryModuleInput[], template: string | null): Promise<ProductStory> =>
  (
    await typedQuery(client)(
      `mutation SaveStory($p: ID!, $r: Int!, $input: ProductStoryInput!) { saveProductStory(productId: $p, revision: $r, input: $input) { ${storyFields} } }`,
      z.object({ saveProductStory: storySchema }),
      { p: productId, r: revision, input: { modules, template } },
    )
  ).saveProductStory

/** The draft goes live, refused as `STORY_INCOMPLETE` with each gap while anything is missing. */
export const publishProductStory = async (client: ApiClient, productId: string, revision: number): Promise<ProductStory> =>
  (await typedQuery(client)(`mutation PublishStory($p: ID!, $r: Int!) { publishProductStory(productId: $p, revision: $r) { ${storyFields} } }`, z.object({ publishProductStory: storySchema }), { p: productId, r: revision })).publishProductStory

/** "Copy from another product…": that product's draft becomes this one's. */
export const copyProductStory = async (client: ApiClient, fromProductId: string, toProductId: string): Promise<void> => {
  await typedQuery(client)('mutation CopyStory($from: ID!, $to: [ID!]!) { copyProductStory(fromProductId: $from, toProductIds: $to) }', z.object({ copyProductStory: z.number() }), { from: fromProductId, to: [toProductId] })
}

/** The store's brand stories, which a Brand story module can show (the merchant side's). */
export const loadStoryBlocks = async (client: ApiClient): Promise<{ id: string; name: string }[]> => {
  const blocks: { id: string; name: string }[] = []
  let after: string | null = null
  do {
    const page: z.infer<typeof blockPageSchema> = await typedQuery(client)(
      'query Blocks($after: String) { storyBlocks(first: 50, after: $after) { nodes { id name } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } } }',
      blockPageSchema,
      { after },
    )
    blocks.push(...page.storyBlocks.nodes)
    after = page.storyBlocks.pageInfo.hasNextPage ? page.storyBlocks.pageInfo.endCursor : null
  } while (after !== null)
  return blocks
}

const blockPageSchema = z.object({ storyBlocks: z.object({ nodes: z.array(z.object({ id: z.string(), name: z.string() })), pageInfo: pageInfoSchema }) })

const gapSchema = z.array(z.object({ moduleId: z.string(), field: z.string() }))
export type StoryGap = z.infer<typeof gapSchema>[number]

/** What `STORY_INCOMPLETE` says is still to fill, read from the refusal's details. */
export const gapsOf = (details: Readonly<Record<string, unknown>>): StoryGap[] => {
  const parsed = gapSchema.safeParse(details['gaps'])
  return parsed.success ? parsed.data : []
}
