import type postgres from 'postgres'
import type { PageWindow } from '#core/paging'
import type { ScopedSql } from './index'

// Stock locations, stock per version and location, and the movement ledger (DATA-MODEL §7.4, migration
// 0046). Quantities change only through `stock_change()`; every read is the caller's scope's.

export const maxWarehouses = 20
/** A version is low when what it can still sell is at most this, unless a location sets its own (CatList). */
export const defaultLowStock = 5

export interface WarehouseAddress {
  line1: string | null
  line2: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  country: string | null
}

export interface WarehouseRow {
  id: string
  seller_id: string | null
  name: string
  address: WarehouseAddress
  is_default: boolean
  units: number
  revision: number
  created_at: Date
}

const units = (tx: ScopedSql) => tx`(select coalesce(sum(l.on_hand), 0)::int from stock_level l where l.warehouse_id = w.id)`

export const selectWarehouses = (tx: ScopedSql, storeId: string, window: PageWindow): Promise<WarehouseRow[]> => {
  const backwards = window.before !== null && window.after === null
  return tx<WarehouseRow[]>`
    select w.id, w.seller_id, w.name, w.address, w.is_default, w.revision, w.created_at, ${units(tx)} as units
    from warehouse w where w.store_id = ${storeId} and w.deleted_at is null
      and ${window.after ? tx`(w.created_at, w.id) > (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(w.created_at, w.id) < (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by w.created_at ${backwards ? tx`desc` : tx`asc`}, w.id ${backwards ? tx`desc` : tx`asc`}
    limit ${window.limit + 1}
  `
}

export const selectWarehouse = async (tx: ScopedSql, storeId: string, id: string): Promise<WarehouseRow | null> =>
  (await tx<WarehouseRow[]>`select w.id, w.seller_id, w.name, w.address, w.is_default, w.revision, w.created_at, ${units(tx)} as units from warehouse w where w.id = ${id} and w.store_id = ${storeId} and w.deleted_at is null`)[0] ?? null

/** The caller's own locations, so a supplier's count says nothing of others'. */
export const countWarehouses = async (tx: ScopedSql, storeId: string, sellerId: string | null): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from warehouse where store_id = ${storeId} and seller_id is not distinct from ${sellerId} and deleted_at is null`)[0]?.n ?? 0

export interface WarehouseFields {
  name: string
  address: WarehouseAddress
}

/** An owner's first location is its default (SetOps). */
export const insertWarehouse = async (tx: ScopedSql, storeId: string, sellerId: string | null, id: string, f: WarehouseFields): Promise<void> => {
  await tx`
    insert into warehouse (id, store_id, seller_id, name, address, is_default)
    values (${id}, ${storeId}, ${sellerId}, ${f.name}, ${tx.json(f.address as unknown as postgres.JSONValue)},
      not exists (select 1 from warehouse where store_id = ${storeId} and seller_id is not distinct from ${sellerId} and deleted_at is null))
  `
}

export const updateWarehouse = async (tx: ScopedSql, storeId: string, id: string, revision: number, f: WarehouseFields, now: Date): Promise<boolean> =>
  (
    await tx`
      update warehouse set name = ${f.name}, address = ${tx.json(f.address as unknown as postgres.JSONValue)}, updated_at = ${now}, revision = revision + 1
      where id = ${id} and store_id = ${storeId} and revision = ${revision} and deleted_at is null returning id
    `
  ).length === 1

/** Moves the owner's default here; existing stock stays where it is. */
export const makeDefaultWarehouse = async (tx: ScopedSql, storeId: string, id: string, now: Date): Promise<void> => {
  await tx`
    update warehouse set is_default = false, updated_at = ${now}, revision = revision + 1
    where store_id = ${storeId} and is_default and deleted_at is null and id <> ${id}
      and seller_id is not distinct from (select seller_id from warehouse where id = ${id})
  `
  await tx`update warehouse set is_default = true, updated_at = ${now} where id = ${id} and store_id = ${storeId}`
}

/** Refused while it holds stock or is the default, which a location must hand on first (SetOps). */
export const softDeleteWarehouse = async (tx: ScopedSql, storeId: string, id: string, now: Date): Promise<{ name: string } | 'default' | 'holds_stock' | null> => {
  const [w] = await tx<{ name: string; is_default: boolean }[]>`select name, is_default from warehouse where id = ${id} and store_id = ${storeId} and deleted_at is null for update`
  if (!w) return null
  if (w.is_default) return 'default'
  // A statement of its own after the lock, so it sees a count written while this waited.
  const [held] = await tx<{ any: boolean }[]>`select exists (select 1 from stock_level where warehouse_id = ${id} and on_hand > 0) as any`
  if (held?.any) return 'holds_stock'
  await tx`update warehouse set deleted_at = ${now}, updated_at = ${now} where id = ${id}`
  return { name: w.name }
}

export interface StockLevelRow {
  version_id: string
  warehouse_id: string
  warehouse_name: string
  is_default: boolean
  on_hand: number
  reserved: number
  low_stock_threshold: number | null
}

/** A product's stock in every location the caller reads, default location first. */
export const selectProductStock = (tx: ScopedSql, storeId: string, productId: string): Promise<StockLevelRow[]> =>
  tx<StockLevelRow[]>`
    select l.version_id, l.warehouse_id, w.name as warehouse_name, w.is_default, l.on_hand, l.reserved, l.low_stock_threshold
    from stock_level l join product_version v on v.id = l.version_id join warehouse w on w.id = l.warehouse_id
    where v.product_id = ${productId} and l.store_id = ${storeId} and v.deleted_at is null and w.deleted_at is null
    order by v.position, w.is_default desc, w.created_at, w.id
  `

export type ChangeReason = 'received' | 'returned' | 'damaged' | 'counted' | 'typed'

/** The quantity now there, and by how much it moved (0 when it didn't, which records nothing). */
export const changeStock = async (tx: ScopedSql, versionId: string, warehouseId: string, change: { delta: number } | { target: number }, reason: ChangeReason): Promise<{ quantity: number; change: number }> => {
  const delta = 'delta' in change ? change.delta : null
  const target = 'target' in change ? change.target : null
  const [row] = await tx<{ quantity: number; change: number }[]>`select quantity, change from stock_change(${versionId}, ${warehouseId}, ${delta}::int, ${target}::int, ${reason})`
  if (!row) throw new Error('stock_change returned no row')
  return row
}

/** False when the caller doesn't hold that version's stock there. */
export const setLowStockThreshold = async (tx: ScopedSql, storeId: string, versionId: string, warehouseId: string, threshold: number | null): Promise<boolean> =>
  (await tx`update stock_level set low_stock_threshold = ${threshold} where version_id = ${versionId} and warehouse_id = ${warehouseId} and store_id = ${storeId} returning version_id`).length === 1

export const stockRefused = (error: unknown): 'NOT_FOUND' | 'BELOW_ZERO' | null => {
  if (typeof error !== 'object' || error === null || !('message' in error) || typeof error.message !== 'string') return null
  if (/stock: that would take stock below zero/.test(error.message)) return 'BELOW_ZERO'
  if (/stock: (no such version or location|that location can't hold this version)/.test(error.message)) return 'NOT_FOUND'
  return null
}

export interface StockMovementRow {
  id: string
  version_id: string
  warehouse_id: string
  warehouse_name: string
  delta: number
  resulting_quantity: number
  reason: string
  actor_kind: 'person' | 'impersonation' | 'system'
  actor_name: string | null
  occurred_at: Date
}

/** Newest first, a product's or one version's (G4). A name shows only for a person the caller may see. */
export const selectStockHistory = (tx: ScopedSql, storeId: string, productId: string, versionId: string | null, window: PageWindow): Promise<StockMovementRow[]> => {
  const backwards = window.before !== null && window.after === null
  return tx<StockMovementRow[]>`
    select m.id, m.version_id, m.warehouse_id, w.name as warehouse_name, m.delta, m.resulting_quantity, m.reason, m.actor_kind, m.occurred_at,
      case when m.actor_kind = 'person' then u.name end as actor_name
    from stock_movement m join warehouse w on w.id = m.warehouse_id left join "user" u on u.id = m.actor_id
    where m.product_id = ${productId} and m.store_id = ${storeId}
      and ${versionId ? tx`m.version_id = ${versionId}` : tx`true`}
      and ${window.after ? tx`(m.occurred_at, m.id) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(m.occurred_at, m.id) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by m.occurred_at ${backwards ? tx`asc` : tx`desc`}, m.id ${backwards ? tx`asc` : tx`desc`}
    limit ${window.limit + 1}
  `
}
