import { z } from 'zod'
import { allPages } from './allPages'
import { loadAllMarkets } from './markets'
import { query } from './client'

// Collections (CatCollections, FIRST-RELEASE §12): the merchant side's groups of products, by rules or by hand.

const pageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })

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
export const loadCollections = (): Promise<CollectionSummary[]> =>
  allPages(
    async (after) =>
      (
        await query(
          `query C($after: String) { collections(first: 50, after: $after) { nodes { id name kind visible parentId inheritParent match rules { ${ruleFields} } products computedAt } pageInfo { hasNextPage endCursor } } }`,
          z.object({ collections: z.object({ nodes: z.array(summarySchema), pageInfo: pageInfoSchema }) }),
          { after },
        )
      ).collections,
  )

const collectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
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

export const loadCollection = async (id: string): Promise<Collection | null> =>
  (
    await query(
      `query C($id: ID!) { collection(id: $id) { id name slug description kind match parentId inheritParent visible imageAssetId sort seoTitle seoDescription revision rules { ${ruleFields} } } }`,
      z.object({ collection: collectionSchema.nullable() }),
      { id },
    )
  ).collection

const memberSchema = z.object({ id: z.string(), name: z.string() })
export type Member = z.infer<typeof memberSchema>

/** A hand-picked collection's products in its order, every page. */
export const loadMembers = (id: string): Promise<Member[]> =>
  allPages(
    async (after) =>
      (
        await query(
          'query M($id: ID!, $after: String) { collectionProducts(id: $id, first: 50, after: $after) { nodes { id name } pageInfo { hasNextPage endCursor } } }',
          z.object({ collectionProducts: z.object({ nodes: z.array(memberSchema), pageInfo: pageInfoSchema }) }),
          { id, after },
        )
      ).collectionProducts,
  )

const pickSchema = z.object({ id: z.string(), name: z.string(), visible: z.boolean(), approval: z.string().nullable() })
export type Pickable = z.infer<typeof pickSchema>

/** "Search products to add": the first thirty by name, or the first thirty of all when nothing is typed. */
export const searchPickable = async (search: string): Promise<Pickable[]> =>
  (
    await query(
      'query P($search: String) { products(filter: "all", search: $search, sort: "name", first: 30) { nodes { id name visible approval } } }',
      z.object({ products: z.object({ nodes: z.array(pickSchema) }) }),
      { search },
    )
  ).products.nodes

export interface RuleInput {
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

/** What rules not saved yet would hold (CATALOG H4's live preview). */
export const previewCollection = async (draft: { match: 'all' | 'any'; rules: RuleInput[]; parentId: string | null; inheritParent: boolean }): Promise<Preview> =>
  (
    await query(
      'query P($m: String, $r: [CollectionRuleInput!]!, $p: ID, $i: Boolean) { collectionPreview(match: $m, rules: $r, parentId: $p, inheritParent: $i) { count products { id name } } }',
      z.object({ collectionPreview: previewSchema }),
      { m: draft.match, r: draft.rules, p: draft.parentId, i: draft.inheritParent },
    )
  ).collectionPreview

export interface CollectionInput {
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

/** A new collection (no id), or the next revision of one. */
export const saveCollection = async (id: string | null, revision: number | null, input: CollectionInput): Promise<{ id: string; revision: number }> =>
  (
    await query(
      'mutation S($id: ID, $r: Int, $input: CollectionInput!) { saveCollection(id: $id, revision: $r, input: $input) { id revision } }',
      z.object({ saveCollection: z.object({ id: z.string(), revision: z.number().int() }) }),
      { id, r: revision, input },
    )
  ).saveCollection

/** The products stay; children move up a level and the menu loses its link (CATALOG H9, J3). */
export const deleteCollection = async (id: string): Promise<void> => {
  await query('mutation D($id: ID!) { deleteCollection(id: $id) }', z.object({ deleteCollection: z.boolean() }), { id })
}

/** The countries the store's active markets sell to, for the seasonal ideas (CATALOG H13). */
export const loadMarketCountries = async (): Promise<string[]> => [...new Set((await loadAllMarkets()).filter((m) => m.active).flatMap((m) => m.countries))]
