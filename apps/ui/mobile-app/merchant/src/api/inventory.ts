import { z } from 'zod'
import { pageInfoSchema, typedQuery, type ApiClient } from '../graphql'

// A product's stock (CATALOG-DESIGN.md G1–G5; apps/api src/apis/store/inventory.ts): its levels per location, the history of
// every change, and the writes. The API says what is on hand and reserved; the phone adds nothing up that is charged or sold.

const levelSchema = z.object({ warehouseId: z.string(), warehouseName: z.string(), isDefault: z.boolean(), onHand: z.number().int(), reserved: z.number().int() })
export type StockLevel = z.infer<typeof levelSchema>

const stockPageSchema = z.object({
  productStock: z.object({ nodes: z.array(z.object({ versionId: z.string(), levels: z.array(levelSchema) })), pageInfo: pageInfoSchema }),
})

/** Each version's levels by version id, every page of them (a product holds up to 100 versions). */
export const loadProductStock = async (client: ApiClient, productId: string): Promise<Map<string, StockLevel[]>> => {
  const levels = new Map<string, StockLevel[]>()
  let after: string | null = null
  do {
    const page: z.infer<typeof stockPageSchema> = await typedQuery(client)(
      'query Stock($p: ID!, $after: String) { productStock(productId: $p, first: 50, after: $after) { nodes { versionId levels { warehouseId warehouseName isDefault onHand reserved } } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } } }',
      stockPageSchema,
      { p: productId, after },
    )
    for (const node of page.productStock.nodes) levels.set(node.versionId, node.levels)
    after = page.productStock.pageInfo.hasNextPage ? page.productStock.pageInfo.endCursor : null
  } while (after !== null)
  return levels
}

const warehouseSchema = z.object({ id: z.string(), name: z.string(), isDefault: z.boolean(), supplierId: z.string().nullable() })
const warehousePageSchema = z.object({ warehouses: z.object({ nodes: z.array(warehouseSchema), pageInfo: pageInfoSchema }) })
export type Warehouse = { id: string; name: string; isDefault: boolean }

/** Where the caller counts stock: the store's own locations for the merchant (its suppliers' are listed too, and never changed by it), a supplier's own for a supplier. */
export const loadWarehouses = async (client: ApiClient, supplier: boolean): Promise<Warehouse[]> => {
  const rows: Warehouse[] = []
  let after: string | null = null
  do {
    const page: z.infer<typeof warehousePageSchema> = await typedQuery(client)(
      'query Warehouses($after: String) { warehouses(first: 50, after: $after) { nodes { id name isDefault supplierId } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } } }',
      warehousePageSchema,
      { after },
    )
    rows.push(...page.warehouses.nodes.filter((warehouse) => supplier || warehouse.supplierId === null).map(({ id, name, isDefault }) => ({ id, name, isDefault })))
    after = page.warehouses.pageInfo.hasNextPage ? page.warehouses.pageInfo.endCursor : null
  } while (after !== null)
  return rows
}

const movementSchema = z.object({
  id: z.string(),
  versionId: z.string(),
  delta: z.number().int(),
  reason: z.string(),
  resultingQuantity: z.number().int(),
  warehouseName: z.string(),
  actorName: z.string().nullable(),
  actorKind: z.string(),
  occurredAt: z.string(),
})
export type StockMovement = z.infer<typeof movementSchema>

const historyPageSize = 20

/** Movements, newest first, `after` pages to older ones. */
export const loadStockHistory = async (client: ApiClient, productId: string, after: string | null = null): Promise<{ rows: StockMovement[]; next: string | null }> => {
  const { stockHistory } = await typedQuery(client)(
    'query History($p: ID!, $first: Int, $after: String) { stockHistory(productId: $p, first: $first, after: $after) { nodes { id versionId delta reason resultingQuantity warehouseName actorName actorKind occurredAt } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } } }',
    z.object({ stockHistory: z.object({ nodes: z.array(movementSchema), pageInfo: pageInfoSchema }) }),
    { p: productId, first: historyPageSize, after },
  )
  return { rows: stockHistory.nodes, next: stockHistory.pageInfo.hasNextPage ? stockHistory.pageInfo.endCursor : null }
}

/** The reasons "Change stock with a reason" offers (CATALOG-DESIGN.md G4); any other movement is made by orders, imports or a typed count. */
export const adjustReasons = ['received', 'returned', 'damaged', 'counted'] as const
export type AdjustReason = (typeof adjustReasons)[number]

/** Applied at once and logged with its reason; the answer is the quantity now there. */
export const adjustStock = async (client: ApiClient, change: { versionId: string; warehouseId: string; delta: number; reason: AdjustReason }): Promise<number> =>
  (
    await typedQuery(client)(
      'mutation Adjust($v: ID!, $w: ID!, $d: Int!, $r: String!) { adjustStock(versionId: $v, warehouseId: $w, delta: $d, reason: $r) }',
      z.object({ adjustStock: z.number().int() }),
      { v: change.versionId, w: change.warehouseId, d: change.delta, r: change.reason },
    )
  ).adjustStock

/** Typed quantities, all in one transaction; recorded as "Typed in". */
export const setStock = async (client: ApiClient, entries: { versionId: string; warehouseId: string; quantity: number }[]): Promise<void> => {
  if (entries.length === 0) return
  await typedQuery(client)('mutation SetStock($e: [StockQuantityInput!]!) { setStock(entries: $e) { versionId } }', z.object({ setStock: z.array(z.object({ versionId: z.string() })) }), { e: entries })
}
