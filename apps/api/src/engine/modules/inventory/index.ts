import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { PageWindow } from '#core/paging'
import type { TenantContext } from '#core/tenancy'
import { serialise, withScope, type ScopedSql } from '#db/scoped/index'
import {
  changeStock,
  countWarehouses,
  insertWarehouse,
  makeDefaultWarehouse,
  maxWarehouses,
  selectProductStock,
  selectStockHistory,
  selectWarehouse,
  selectWarehouses,
  setLowStockThreshold,
  softDeleteWarehouse,
  stockRefused,
  updateWarehouse,
  type ChangeReason,
  type WarehouseAddress,
} from '#db/scoped/inventory'
import { isUuid } from '#core/ids'

// Inventory (PLATFORM-PROMPT §5.4, CATALOG-DESIGN G, SetOps): each owner counts its own locations, and
// every change to a quantity is a movement with its reason, by the database (migration 0046).

export { defaultLowStock, type StockLevelRow, type StockMovementRow, type StockVersionRow, type WarehouseRow } from '#db/scoped/inventory'

export const inventoryAudit = {
  adjusted: 'stock.adjusted',
  thresholdSet: 'stock.threshold_set',
  warehouseSaved: 'warehouse.saved',
  warehouseDeleted: 'warehouse.deleted',
} as const

export type InventoryRefusal =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'STALE_REVISION'
  | 'BELOW_ZERO'
  | 'TOO_MANY_WAREHOUSES'
  | 'DEFAULT_WAREHOUSE'
  | 'WAREHOUSE_HOLDS_STOCK'
export type InventoryResult<T> = { ok: true; value: T } | { ok: false; reason: InventoryRefusal }

/** The reasons a person gives (G4); a typed number is `typed`, and the first count of a location `starting`. */
export const adjustReasons = ['received', 'returned', 'damaged', 'counted'] as const
export type AdjustReason = (typeof adjustReasons)[number]

/** One save of the editor or the list's quick edit, in one transaction. */
export const maxStockEntries = 100
const maxQuantity = 1_000_000


class Refused extends Error {
  constructor(readonly reason: InventoryRefusal) {
    super(reason)
  }
}

export interface WarehouseInput {
  name: string
  address?: Partial<Record<keyof WarehouseAddress, string | null | undefined>> | null | undefined
}

const addressKeys = ['line1', 'line2', 'city', 'region', 'postalCode', 'country'] as const

const cleanWarehouse = (input: WarehouseInput) => {
  const name = input.name.trim()
  if (name === '' || name.length > 80) throw new Refused('INVALID_INPUT')
  const address = Object.fromEntries(
    addressKeys.map((key) => {
      const value = input.address?.[key]?.trim() ?? ''
      if (value.length > 120) throw new Refused('INVALID_INPUT')
      return [key, value === '' ? null : key === 'country' ? value.toUpperCase() : value]
    }),
  ) as unknown as WarehouseAddress
  if (address.country !== null && !/^[A-Z]{2}$/.test(address.country)) throw new Refused('INVALID_INPUT')
  return { name, address }
}

const whole = (value: number, min: number): number => {
  if (!Number.isInteger(value) || value < min || value > maxQuantity) throw new Refused('INVALID_INPUT')
  return value
}

export interface InventoryDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

export const createInventoryService = ({ sql, context, actor, activity, facts, now }: InventoryDeps) => {
  const { storeId } = context
  const sellerId = context.sellerScope.kind === 'seller' ? context.sellerScope.sellerId : null
  const inScope = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, context, work)

  const entry = (action: string, target: { type: string; id: string; label: string }): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    sellerId,
    target,
    reason: null,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const run = async <T>(work: (tx: ScopedSql) => Promise<T>): Promise<InventoryResult<T>> => {
    try {
      return { ok: true, value: await inScope(work) }
    } catch (error) {
      if (error instanceof Refused) return { ok: false, reason: error.reason }
      const refused = stockRefused(error)
      if (refused) return { ok: false, reason: refused }
      throw error
    }
  }

  /** The caller's own location: the merchant side changes only the merchant's, a supplier only its own. */
  const ownWarehouse = async (tx: ScopedSql, id: string) => {
    const w = isUuid(id) ? await selectWarehouse(tx, storeId, id) : null
    if (!w || w.seller_id !== sellerId) throw new Refused('NOT_FOUND')
    return w
  }

  const warehouses = (window: PageWindow) => inScope((tx) => selectWarehouses(tx, storeId, window))

  const saveWarehouse = (id: string | null, revision: number | null, input: WarehouseInput) =>
    run(async (tx) => {
      const clean = cleanWarehouse(input)
      let warehouseId: string
      if (id === null) {
        await serialise(tx, `warehouse:${storeId}:${sellerId ?? ''}`)
        if ((await countWarehouses(tx, storeId, sellerId)) >= maxWarehouses) throw new Refused('TOO_MANY_WAREHOUSES')
        warehouseId = crypto.randomUUID()
        await insertWarehouse(tx, storeId, sellerId, warehouseId, clean)
      } else {
        await ownWarehouse(tx, id)
        if (revision === null || !(await updateWarehouse(tx, storeId, id, revision, clean, now()))) throw new Refused('STALE_REVISION')
        warehouseId = id
      }
      await activity.record(tx, entry(inventoryAudit.warehouseSaved, { type: 'warehouse', id: warehouseId, label: clean.name }))
      return warehouseId
    })

  /** "Make default" (SetOps): new products start here; existing stock doesn't move. */
  const setDefault = (id: string) =>
    run(async (tx) => {
      const w = await ownWarehouse(tx, id)
      await makeDefaultWarehouse(tx, storeId, id, now())
      await activity.record(tx, entry(inventoryAudit.warehouseSaved, { type: 'warehouse', id, label: `${w.name}: default` }))
      return true
    })

  const deleteWarehouse = (id: string) =>
    run(async (tx) => {
      await ownWarehouse(tx, id)
      const gone = await softDeleteWarehouse(tx, storeId, id, now())
      if (gone === null) throw new Refused('NOT_FOUND')
      if (gone === 'default') throw new Refused('DEFAULT_WAREHOUSE')
      if (gone === 'holds_stock') throw new Refused('WAREHOUSE_HOLDS_STOCK')
      await activity.record(tx, entry(inventoryAudit.warehouseDeleted, { type: 'warehouse', id, label: gone.name }))
      return true
    })

  const productStock = (productId: string, window: PageWindow) => inScope((tx) => (isUuid(productId) ? selectProductStock(tx, storeId, productId, window) : Promise.resolve([])))

  const moved = (versionId: string, warehouseId: string, reason: ChangeReason, delta: number, quantity: number) =>
    entry(inventoryAudit.adjusted, { type: 'product_version', id: versionId, label: `${reason} ${delta > 0 ? '+' : ''}${delta} → ${quantity} at ${warehouseId}` })

  /** "Change stock with a reason" (G4): the answer is the quantity now there. */
  const adjust = (versionId: string, warehouseId: string, delta: number, reason: string) =>
    run(async (tx) => {
      if (!(adjustReasons as readonly string[]).includes(reason) || delta === 0 || !Number.isInteger(delta) || Math.abs(delta) > maxQuantity) throw new Refused('INVALID_INPUT')
      if (!isUuid(versionId) || !isUuid(warehouseId)) throw new Refused('NOT_FOUND')
      const { quantity } = await changeStock(tx, versionId, warehouseId, { delta }, reason as AdjustReason)
      await activity.record(tx, moved(versionId, warehouseId, reason as AdjustReason, delta, quantity))
      return quantity
    })

  /** Typed numbers, from the editor's save or the list's quick edit; each one that changes is a movement. */
  const setQuantities = (entries: readonly { versionId: string; warehouseId: string; quantity: number }[]) =>
    run(async (tx) => {
      if (entries.length === 0 || entries.length > maxStockEntries) throw new Refused('INVALID_INPUT')
      const keys = new Set(entries.map((e) => `${e.versionId.toLowerCase()}:${e.warehouseId.toLowerCase()}`))
      if (keys.size !== entries.length) throw new Refused('INVALID_INPUT')
      const logged: ActivityEntry[] = []
      const results: { versionId: string; warehouseId: string; quantity: number }[] = []
      for (const e of entries) {
        if (!isUuid(e.versionId) || !isUuid(e.warehouseId)) throw new Refused('NOT_FOUND')
        const { quantity, change } = await changeStock(tx, e.versionId, e.warehouseId, { target: whole(e.quantity, 0) }, 'typed')
        if (change !== 0) logged.push(moved(e.versionId, e.warehouseId, 'typed', change, quantity))
        results.push({ versionId: e.versionId, warehouseId: e.warehouseId, quantity })
      }
      await activity.recordAll(tx, logged)
      return results
    })

  const setThreshold = (versionId: string, warehouseId: string, threshold: number | null) =>
    run(async (tx) => {
      if (!isUuid(versionId)) throw new Refused('NOT_FOUND')
      // The merchant side reads a supplier's thresholds but never sets them: they drive the supplier's chip.
      await ownWarehouse(tx, warehouseId)
      const clean = threshold === null ? null : whole(threshold, 0)
      if (!(await setLowStockThreshold(tx, storeId, sellerId, versionId, warehouseId, clean))) throw new Refused('NOT_FOUND')
      await activity.record(tx, entry(inventoryAudit.thresholdSet, { type: 'product_version', id: versionId, label: clean === null ? 'default' : String(clean) }))
      return clean
    })

  const history = (productId: string, versionId: string | null, window: PageWindow) =>
    inScope((tx) => (isUuid(productId) && (versionId === null || isUuid(versionId)) ? selectStockHistory(tx, storeId, productId, versionId, window) : Promise.resolve([])))

  return { warehouses, saveWarehouse, setDefault, deleteWarehouse, productStock, adjust, setQuantities, setThreshold, history }
}
