import { z } from 'zod'
import { allPages } from './allPages'
import { loadTaxSetup } from './productEditor'
import { query } from './client'

// The Products list's reads and writes (FIRST-RELEASE §11, CatList; apps/api/schema/store.graphql,
// src/apis/store/products.ts, approval.ts, structure.ts, tax.ts).

export const productFilters = ['all', 'visible', 'hidden', 'pending', 'sent_back', 'low_stock', 'missing_info'] as const
export type ProductFilter = (typeof productFilters)[number]

export const productSorts = ['updated', 'name', 'price_low', 'price_high', 'stock'] as const
export type ProductSort = (typeof productSorts)[number]

const moneySchema = z.object({ amount: z.string(), currency: z.string() })

const readinessSchema = z.object({ marketName: z.string(), ready: z.boolean(), missing: z.array(z.string()) })

const rowSchema = z.object({
  id: z.string(),
  name: z.string(),
  visible: z.boolean(),
  approval: z.enum(['approved', 'pending', 'sent_back']).nullable(),
  productType: z.string(),
  supplier: z.object({ id: z.string(), name: z.string() }).nullable(),
  supplierRemoved: z.boolean(),
  versionCount: z.number().int(),
  minPrice: moneySchema.nullable(),
  maxPrice: moneySchema.nullable(),
  photoUrl: z.string().nullable(),
  stock: z.number().int(),
  // The Low stock chip's own test, by each location's threshold.
  lowStock: z.boolean(),
  // Null for a supplier, which reads no market.
  readiness: z.array(readinessSchema).nullable(),
})

export type ProductRow = z.infer<typeof rowSchema>

const pageSchema = z.object({
  products: z.object({
    nodes: z.array(rowSchema),
    pageInfo: z.object({ hasNextPage: z.boolean(), hasPreviousPage: z.boolean(), startCursor: z.string().nullable(), endCursor: z.string().nullable() }),
  }),
})

export interface ProductQuery {
  filter: ProductFilter
  search: string
  /** A supplier's id, `own`, or empty for all (the Owner's filter). */
  supplier: string
  sort: ProductSort
}

export interface ProductPage {
  rows: ProductRow[]
  next: string | null
  previous: string | null
}

export const productPageSize = 10

const rowFields = 'id name visible approval productType supplier { id name } supplierRemoved versionCount minPrice { amount currency } maxPrice { amount currency } photoUrl stock lowStock readiness { marketName ready missing }'

/** One page; `after` pages on, `before` back. */
export const loadProducts = async (q: ProductQuery, cursor: { after?: string | null; before?: string | null } = {}): Promise<ProductPage> => {
  const { products } = await query(
    `query Products($filter: String, $search: String, $supplier: String, $sort: String, $first: Int, $after: String, $before: String) {
      products(filter: $filter, search: $search, supplier: $supplier, sort: $sort, first: $first, after: $after, before: $before) { nodes { ${rowFields} } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } }
    }`,
    pageSchema,
    { filter: q.filter, search: q.search.trim() || null, supplier: q.supplier || null, sort: q.sort, first: productPageSize, after: cursor.after ?? null, before: cursor.before ?? null },
  )
  return { rows: products.nodes, next: products.pageInfo.hasNextPage ? products.pageInfo.endCursor : null, previous: products.pageInfo.hasPreviousPage ? products.pageInfo.startCursor : null }
}

const countsSchema = z.object({ all: z.number(), visible: z.number(), hidden: z.number(), pending: z.number(), sentBack: z.number(), lowStock: z.number(), missingInfo: z.number(), fromSuppliers: z.number(), outOfStock: z.number() })

export type ProductCounts = z.infer<typeof countsSchema>

export const loadProductCounts = async (): Promise<ProductCounts> =>
  (await query('{ productCounts { all visible hidden pending sentBack lowStock missingInfo fromSuppliers outOfStock } }', z.object({ productCounts: countsSchema }))).productCounts

const named = z.object({ id: z.string(), name: z.string() })
const pageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })

/** The Owner's supplier filter: every supplier by name. */
export const loadSupplierChoices = (): Promise<{ id: string; name: string }[]> =>
  allPages(async (after) => {
    const { suppliers } = await query(
      'query S($after: String) { suppliers(first: 50, after: $after) { nodes { id name } pageInfo { hasNextPage endCursor } } }',
      z.object({ suppliers: z.object({ nodes: z.array(named), pageInfo: pageInfoSchema }) }),
      { after },
    )
    return suppliers
  })

/** Every hand-picked collection, the ones "Add to collection" can fill; the API lists both kinds together. */
export const loadHandPicked = async (): Promise<{ id: string; name: string }[]> => {
  const all = await allPages(async (after) => {
    const { collections } = await query(
      'query C($after: String) { collections(first: 50, after: $after) { nodes { id name kind } pageInfo { hasNextPage endCursor } } }',
      z.object({ collections: z.object({ nodes: z.array(named.extend({ kind: z.string() })), pageInfo: pageInfoSchema }) }),
      { after },
    )
    return collections
  })
  return all.filter((c) => c.kind === 'manual').map(({ id, name }) => ({ id, name }))
}

export const loadTaxClasses = async (): Promise<{ id: string; name: string; isDefault: boolean }[]> => (await loadTaxSetup())?.classes ?? []

export const setProductsVisible = async (ids: string[], visible: boolean): Promise<number> =>
  (await query('mutation V($ids: [ID!]!, $visible: Boolean!) { updateProducts(ids: $ids, patch: { visible: $visible }) }', z.object({ updateProducts: z.number() }), { ids, visible })).updateProducts

export const deleteProducts = async (ids: string[]): Promise<number> =>
  (await query('mutation D($ids: [ID!]!) { deleteProducts(ids: $ids) }', z.object({ deleteProducts: z.number() }), { ids })).deleteProducts

export const addToCollection = async (collectionId: string, productIds: string[]): Promise<number> =>
  (await query('mutation A($c: ID!, $p: [ID!]!) { addProductsToCollection(collectionId: $c, productIds: $p) }', z.object({ addProductsToCollection: z.number() }), { c: collectionId, p: productIds })).addProductsToCollection

export const setTaxClass = async (ids: string[], taxClassId: string): Promise<number> =>
  (await query('mutation T($ids: [ID!]!, $c: ID) { setProductsTaxClass(ids: $ids, taxClassId: $c) }', z.object({ setProductsTaxClass: z.number() }), { ids, c: taxClassId })).setProductsTaxClass

export const approveProduct = async (id: string): Promise<void> => {
  await query('mutation A($id: ID!) { approveProduct(id: $id) }', z.object({ approveProduct: z.boolean() }), { id })
}

export const sendBackProduct = async (id: string, reason: string): Promise<void> => {
  await query('mutation B($id: ID!, $reason: String!) { sendBackProduct(id: $id, reason: $reason) }', z.object({ sendBackProduct: z.boolean() }), { id, reason })
}
