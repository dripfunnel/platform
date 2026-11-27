import { z } from 'zod'
import { allPages } from './allPages'
import { loadAllMarkets } from './markets'
import { query } from './client'

// Collections (CatCollections, FIRST-RELEASE §12): the merchant side's groups of products, from filter blocks joined by AND / OR.

const pageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })

const ruleSchema = z.object({
  kind: z.string(),
  joiner: z.string(),
  valueIds: z.array(z.string()),
  valueMatch: z.string().nullable(),
  productIds: z.array(z.string()).default([]),
  text: z.string().nullable(),
  productId: z.string().nullable(),
  versionId: z.string().nullable(),
  currency: z.string().nullable(),
  min: z.string().nullable(),
  max: z.string().nullable(),
})
export type CollectionRule = z.infer<typeof ruleSchema>
const listRuleFields = 'kind joiner valueIds valueMatch text productId versionId currency min max'
const ruleFields = `${listRuleFields} productIds`

const summarySchema = z.object({
  id: z.string(),
  name: z.string(),
  visible: z.boolean(),
  parentId: z.string().nullable(),
  inheritParent: z.boolean(),
  imageAssetId: z.string().nullable(),
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
          `query C($after: String) { collections(first: 50, after: $after) { nodes { id name visible parentId inheritParent imageAssetId rules { ${listRuleFields} } products computedAt } pageInfo { hasNextPage endCursor } } }`,
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
      `query C($id: ID!) { collection(id: $id) { id name slug description parentId inheritParent visible imageAssetId sort seoTitle seoDescription revision rules { ${ruleFields} } } }`,
      z.object({ collection: collectionSchema.nullable() }),
      { id },
    )
  ).collection

const memberSchema = z.object({ id: z.string(), name: z.string(), imageAssetId: z.string().nullable() })
export type Member = z.infer<typeof memberSchema>

const pickSchema = z.object({ id: z.string(), name: z.string(), visible: z.boolean(), approval: z.string().nullable(), photoUrl: z.string().nullable() })
export type Pickable = z.infer<typeof pickSchema>

/** "Search products to add": the first thirty by name, or the first thirty of all when nothing is typed. */
export const searchPickable = async (search: string): Promise<Pickable[]> =>
  (
    await query(
      'query P($search: String) { products(filter: "all", search: $search, sort: "name", first: 30) { nodes { id name visible approval photoUrl } } }',
      z.object({ products: z.object({ nodes: z.array(pickSchema) }) }),
      { search },
    )
  ).products.nodes

export interface RuleInput {
  kind: string
  /** How this block joins the one before it: "and" or "or". */
  joiner?: 'and' | 'or'
  valueIds?: string[]
  valueMatch?: 'any' | 'all'
  productIds?: string[]
  text?: string
  productId?: string
  versionId?: string
  currency?: string
  min?: string
  max?: string
}

const previewSchema = z.object({ count: z.number().int(), products: z.array(memberSchema) })
export type Preview = z.infer<typeof previewSchema>

/** What blocks not saved yet would hold (CATALOG H4's live preview). */
export const previewCollection = async (draft: { rules: RuleInput[]; parentId: string | null; inheritParent: boolean }): Promise<Preview> =>
  (
    await query(
      'query P($r: [CollectionRuleInput!]!, $p: ID, $i: Boolean) { collectionPreview(rules: $r, parentId: $p, inheritParent: $i) { count products { id name imageAssetId } } }',
      z.object({ collectionPreview: previewSchema }),
      { r: draft.rules, p: draft.parentId, i: draft.inheritParent },
    )
  ).collectionPreview

export interface CollectionInput {
  name: string
  description: string
  parentId: string | null
  inheritParent: boolean
  visible: boolean
  rules: RuleInput[]
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
