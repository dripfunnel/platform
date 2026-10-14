import type { StockLevel, Warehouse } from '../../../api/inventory'

/** What the stock parts of the editor need: the seat's own locations, the levels as the API last said, and whether it may count. */
export type StockContext = {
  warehouses: readonly Warehouse[]
  /** By version id. */
  levels: ReadonlyMap<string, readonly StockLevel[]>
  canStock: boolean
}

export const levelsOf = (stock: StockContext, versionId: string | null): readonly StockLevel[] => (versionId ? (stock.levels.get(versionId) ?? []) : [])

/** Locations that hold this version's stock but aren't the seat's own (a supplier's, seen by the merchant): shown, never counted here. */
export const otherLevels = (stock: StockContext, versionId: string | null): StockLevel[] => levelsOf(stock, versionId).filter((level) => !stock.warehouses.some((warehouse) => warehouse.id === level.warehouseId))

/** What the API says is reserved for orders: sold, not shipped yet. */
export const reservedOf = (stock: StockContext, versionIds: readonly (string | null)[]): number => versionIds.reduce((total, id) => total + levelsOf(stock, id).reduce((sum, level) => sum + level.reserved, 0), 0)

export const onHandOf = (stock: StockContext, versionIds: readonly (string | null)[]): number => versionIds.reduce((total, id) => total + levelsOf(stock, id).reduce((sum, level) => sum + level.onHand, 0), 0)

/** The level after an adjustment the API answered with, in a copy of the levels. */
export const withQuantity = (levels: ReadonlyMap<string, readonly StockLevel[]>, change: { versionId: string; warehouse: { id: string; name: string; isDefault: boolean }; quantity: number }): Map<string, StockLevel[]> => {
  const next = new Map<string, StockLevel[]>([...levels].map(([key, value]) => [key, [...value]]))
  const existing = next.get(change.versionId) ?? []
  const has = existing.some((level) => level.warehouseId === change.warehouse.id)
  next.set(
    change.versionId,
    has
      ? existing.map((level) => (level.warehouseId === change.warehouse.id ? { ...level, onHand: change.quantity } : level))
      : [...existing, { warehouseId: change.warehouse.id, warehouseName: change.warehouse.name, isDefault: change.warehouse.isDefault, onHand: change.quantity, reserved: 0 }],
  )
  return next
}
