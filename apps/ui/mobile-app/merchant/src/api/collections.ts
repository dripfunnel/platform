import { z } from 'zod'
import { allPages, pageInfoSchema, typedQuery, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

// Collections on the Store API (FIRST-RELEASE.md §12; CATALOG-DESIGN.md H): groups of products, by rules or by hand. The API
// decides which products a rule-based collection holds; the app only reads its count and its preview.

const paging = 'pageInfo { hasNextPage hasPreviousPage startCursor endCursor }'

const ruleSchema = z.object({
  kind: z.string(),
  valueId: z.string().nullable(),
  text: z.string().nullable(),
  productId: z.string().nullable(),
  versionId: z.string().nullable(),
  currency: z.string().nullable(),
  min: z.string().nullable(),
  max: z.string().nullable(),
})
export type CollectionRule = z.infer<typeof ruleSchema>
const ruleFields = 'kind valueId text productId versionId currency min max'

const summarySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['manual', 'automatic']),
  visible: z.boolean(),
  parentId: z.string().nullable(),
  inheritParent: z.boolean(),
  match: z.enum(['all', 'any']),
  rules: z.array(ruleSchema),
  products: z.number().int(),
  computedAt: z.string().nullable(),
})
export type CollectionSummary = z.infer<typeof summarySchema>

/** Every collection the store has (up to 500, CATALOG H), so the list can nest children under their parents. */
export const loadCollections = (client: ApiClient): Promise<CollectionSummary[]> =>
  allPages(
    async (after) =>
      (
        await typedQuery(client)(
          `query Collections($after: String) { collections(first: 50, after: $after) { nodes { id name kind visible parentId inheritParent match rules { ${ruleFields} } products computedAt } ${paging} } }`,
          z.object({ collections: z.object({ nodes: z.array(summarySchema), pageInfo: pageInfoSchema }) }),
          { after },
        )
      ).collections,
  )

const collectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable().transform((value) => value ?? ''),
  kind: z.enum(['manual', 'automatic']),
  match: z.enum(['all', 'any']),
  parentId: z.string().nullable(),
  inheritParent: z.boolean(),
  visible: z.boolean(),
  imageAssetId: z.string().nullable(),
  sort: z.string(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  revision: z.number().int(),
  rules: z.array(ruleSchema),
})
export type Collection = z.infer<typeof collectionSchema>

/** The collection, or null for one that isn't here. */
export const loadCollection = async (client: ApiClient, id: string): Promise<Collection | null> =>
  (
    await typedQuery(client)(
      `query Collection($id: ID!) { collection(id: $id) { id name slug description kind match parentId inheritParent visible imageAssetId sort seoTitle seoDescription revision rules { ${ruleFields} } } }`,
      z.object({ collection: collectionSchema.nullable() }),
      { id },
    )
  ).collection

const memberSchema = z.object({ id: z.string(), name: z.string() })
export type Member = z.infer<typeof memberSchema>

/** A hand-picked collection's products in its order, every page. */
export const loadMembers = (client: ApiClient, id: string): Promise<Member[]> =>
  allPages(
    async (after) =>
      (
        await typedQuery(client)(
          `query Members($id: ID!, $after: String) { collectionProducts(id: $id, first: 50, after: $after) { nodes { id name } ${paging} } }`,
          z.object({ collectionProducts: z.object({ nodes: z.array(memberSchema), pageInfo: pageInfoSchema }) }),
          { id, after },
        )
      ).collectionProducts,
  )

const pickSchema = z.object({ id: z.string(), name: z.string(), visible: z.boolean(), approval: z.string().nullable() })
export type Pickable = z.infer<typeof pickSchema>

/** "Search products to add": the first thirty by name, or the first thirty of all when nothing is typed. */
export const searchPickable = async (client: ApiClient, search: string): Promise<Pickable[]> =>
  (
    await typedQuery(client)(
      'query Pick($search: String) { products(filter: "all", search: $search, sort: "name", first: 30) { nodes { id name visible approval } } }',
      z.object({ products: z.object({ nodes: z.array(pickSchema) }) }),
      { search: search.trim() || null },
    )
  ).products.nodes

export type RuleInput = {
  kind: string
  valueId?: string
  text?: string
  productId?: string
  versionId?: string
  currency?: string
  min?: string
  max?: string
}

const previewSchema = z.object({ count: z.number().int(), products: z.array(memberSchema) })
export type Preview = z.infer<typeof previewSchema>

export type PreviewDraft = { match: 'all' | 'any'; rules: RuleInput[]; parentId: string | null; inheritParent: boolean }

/** What rules not saved yet would hold: the API's answer (CATALOG H4's live preview), never worked out here. */
export const previewCollection = async (client: ApiClient, draft: PreviewDraft): Promise<Preview> =>
  (
    await typedQuery(client)(
      'query Preview($match: String, $rules: [CollectionRuleInput!]!, $parent: ID, $inherit: Boolean) { collectionPreview(match: $match, rules: $rules, parentId: $parent, inheritParent: $inherit) { count products { id name } } }',
      z.object({ collectionPreview: previewSchema }),
      { match: draft.match, rules: draft.rules, parent: draft.parentId, inherit: draft.inheritParent },
    )
  ).collectionPreview

export type CollectionInput = {
  name: string
  description: string
  kind: 'manual' | 'automatic'
  match: 'all' | 'any'
  parentId: string | null
  inheritParent: boolean
  visible: boolean
  rules: RuleInput[]
  productIds: string[]
  imageAssetId?: string | null
  sort?: string
  seoTitle?: string | null
  seoDescription?: string | null
}

const savedSchema = z.object({ id: z.string(), revision: z.number().int() })

/** A new collection (no id), or the next revision of one. */
export const saveCollection = async (client: ApiClient, id: string | null, revision: number | null, input: CollectionInput): Promise<{ id: string; revision: number }> =>
  (
    await typedQuery(client)(
      'mutation SaveCollection($id: ID, $revision: Int, $input: CollectionInput!) { saveCollection(id: $id, revision: $revision, input: $input) { id revision } }',
      z.object({ saveCollection: savedSchema }),
      { id, revision, input },
    )
  ).saveCollection

/** The products stay; children move up a level and the menu loses its link (CATALOG H9, J3). */
export const deleteCollection = async (client: ApiClient, id: string): Promise<void> => {
  await typedQuery(client)('mutation DeleteCollection($id: ID!) { deleteCollection(id: $id) }', z.object({ deleteCollection: z.boolean().nullable() }), { id })
}

const basicsSchema = z.object({
  pricingCurrency: z.string().nullable(),
  unitSystem: z.enum(['metric', 'imperial']).catch('metric'),
  features: z.array(z.object({ key: z.string(), enabled: z.boolean(), inPlan: z.boolean().nullable() })),
})

/** The store's pricing currency and unit system, and which catalogue features its plan has. */
export const loadCatalogueFacts = async (client: ApiClient): Promise<z.infer<typeof basicsSchema>> =>
  (await typedQuery(client)('{ catalogueSettings { pricingCurrency unitSystem features { key enabled inPlan } } }', z.object({ catalogueSettings: basicsSchema }))).catalogueSettings

/** The countries the store's active markets sell to, for the seasonal ideas (CATALOG H13). */
export const loadMarketCountries = async (client: ApiClient): Promise<string[]> => {
  const markets = await allPages(
    async (after) =>
      (
        await typedQuery(client)(
          `query Markets($after: String) { markets(first: 50, after: $after) { nodes { active countries } ${paging} } }`,
          z.object({ markets: z.object({ nodes: z.array(z.object({ active: z.boolean(), countries: z.array(z.string()) })), pageInfo: pageInfoSchema }) }),
          { after },
        )
      ).markets,
  )
  return [...new Set(markets.filter((market) => market.active).flatMap((market) => market.countries))]
}
