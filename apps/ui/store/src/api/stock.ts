import { z } from 'zod'
import { allPages } from './allPages'
import { query } from './client'

// A product's stock in the editor and the list's quick edit (CATALOG G1–G5; apps/api/schema/store.graphql,
// src/apis/store/inventory.ts): its levels per location, the locations, the history, and the two writes.

const pageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })

const levelSchema = z.object({ warehouseId: z.string(), warehouseName: z.string(), isDefault: z.boolean(), onHand: z.number().int(), reserved: z.number().int() })
export type StockLevel = z.infer<typeof levelSchema>

/** Each version's levels, version id → levels. */
export const loadProductStock = async (productId: string): Promise<Map<string, StockLevel[]>> => {
  const rows = await allPages(async (after) =>
    (
      await query(
        'query S($p: ID!, $after: String) { productStock(productId: $p, first: 50, after: $after) { nodes { versionId levels { warehouseId warehouseName isDefault onHand reserved } } pageInfo { hasNextPage endCursor } } }',
        z.object({ productStock: z.object({ nodes: z.array(z.object({ versionId: z.string(), levels: z.array(levelSchema) })), pageInfo: pageInfoSchema }) }),
        { p: productId, after },
      )
    ).productStock,
  )
  return new Map(rows.map((r) => [r.versionId, r.levels]))
}

const warehouseSchema = z.object({ id: z.string(), name: z.string(), isDefault: z.boolean() })
export type Warehouse = z.infer<typeof warehouseSchema>

/** The caller's locations: the store's for the merchant, a supplier's own for a supplier. */
export const loadWarehouses = (): Promise<Warehouse[]> =>
  allPages(async (after) => (await query('query W($after: String) { warehouses(first: 50, after: $after) { nodes { id name isDefault } pageInfo { hasNextPage endCursor } } }', z.object({ warehouses: z.object({ nodes: z.array(warehouseSchema), pageInfo: pageInfoSchema }) }), { after })).warehouses)

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

/** The latest movements, newest first; the editor shows a page and says how many more. */
export const loadStockHistory = async (productId: string): Promise<{ rows: StockMovement[]; more: boolean }> => {
  const { stockHistory } = await query(
    'query H($p: ID!) { stockHistory(productId: $p, first: 20) { nodes { id versionId delta reason resultingQuantity warehouseName actorName actorKind occurredAt } pageInfo { hasNextPage endCursor } } }',
    z.object({ stockHistory: z.object({ nodes: z.array(movementSchema), pageInfo: pageInfoSchema }) }),
    { p: productId },
  )
  return { rows: stockHistory.nodes, more: stockHistory.pageInfo.hasNextPage }
}

export const adjustReasons = ['received', 'returned', 'damaged', 'counted'] as const
export type AdjustReason = (typeof adjustReasons)[number]

/** "Change stock with a reason" (G4): applied at once and logged; the answer is the quantity now there. */
export const adjustStock = async (versionId: string, warehouseId: string, delta: number, reason: AdjustReason): Promise<number> =>
  (await query('mutation A($v: ID!, $w: ID!, $d: Int!, $r: String!) { adjustStock(versionId: $v, warehouseId: $w, delta: $d, reason: $r) }', z.object({ adjustStock: z.number().int() }), { v: versionId, w: warehouseId, d: delta, r: reason })).adjustStock

/** Typed quantities, all in one transaction. */
export const setStock = async (entries: { versionId: string; warehouseId: string; quantity: number }[]): Promise<void> => {
  if (entries.length === 0) return
  await query('mutation S($e: [StockQuantityInput!]!) { setStock(entries: $e) { versionId } }', z.object({ setStock: z.array(z.object({ versionId: z.string() })) }), { e: entries })
}

const addressSchema = z.object({ line1: z.string().nullable(), line2: z.string().nullable(), city: z.string().nullable(), region: z.string().nullable(), postalCode: z.string().nullable(), country: z.string().nullable() })
export type WarehouseAddress = z.infer<typeof addressSchema>

const placeSchema = z.object({ id: z.string(), name: z.string(), isDefault: z.boolean(), units: z.number().int(), revision: z.number().int(), address: addressSchema.nullable() })
export type Place = z.infer<typeof placeSchema>

/** The caller's locations in full, for the Warehouses list: the merchant's own, or a supplier's own (#337). */
export const loadPlaces = (): Promise<Place[]> =>
  allPages(async (after) => (await query('query W($after: String) { warehouses(first: 50, after: $after) { nodes { id name isDefault units revision address { line1 line2 city region postalCode country } } pageInfo { hasNextPage endCursor } } }', z.object({ warehouses: z.object({ nodes: z.array(placeSchema), pageInfo: pageInfoSchema }) }), { after })).warehouses)

export interface PlaceInput {
  name: string
  address: { line1?: string; line2?: string; city?: string; region?: string; postalCode?: string; country?: string }
}

/** A new location (no id), or the next revision of one; answers its id. */
export const savePlace = async (id: string | null, revision: number | null, input: PlaceInput): Promise<string> =>
  (await query('mutation S($id: ID, $r: Int, $input: WarehouseInput!) { saveWarehouse(id: $id, revision: $r, input: $input) }', z.object({ saveWarehouse: z.string() }), { id, r: revision, input })).saveWarehouse

/** New products start here; stock already elsewhere stays where it is. */
export const makeDefaultPlace = async (id: string): Promise<void> => {
  await query('mutation D($id: ID!) { setDefaultWarehouse(id: $id) }', z.object({ setDefaultWarehouse: z.boolean() }), { id })
}

/** Refused while it holds stock (WAREHOUSE_HOLDS_STOCK) or is the default (DEFAULT_WAREHOUSE). */
export const deletePlace = async (id: string): Promise<void> => {
  await query('mutation X($id: ID!) { deleteWarehouse(id: $id) }', z.object({ deleteWarehouse: z.boolean() }), { id })
}
