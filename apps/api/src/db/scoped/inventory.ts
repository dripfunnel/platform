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

/** Moves the owner's default here; existing stock stays where it is. False when it's gone, a delete having won. */
export const makeDefaultWarehouse = async (tx: ScopedSql, storeId: string, id: string, now: Date): Promise<boolean> => {
  // The row locked live first, so a delete either waits and then finds it the default, or has already removed it.
  const [target] = await tx<{ seller_id: string | null }[]>`select seller_id from warehouse where id = ${id} and store_id = ${storeId} and deleted_at is null for update`
  if (!target) return false
  await tx`
    update warehouse set is_default = false, updated_at = ${now}, revision = revision + 1
    where store_id = ${storeId} and is_default and deleted_at is null and id <> ${id} and seller_id is not distinct from ${target.seller_id}::uuid
  `
  await tx`update warehouse set is_default = true, updated_at = ${now}, revision = revision + 1 where id = ${id} and not is_default`
  return true
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
  warehouse_id: string
  warehouse_name: string
  is_default: boolean
  on_hand: number
  reserved: number
  low_stock_threshold: number | null
}

export interface StockVersionRow {
  version_id: string
  position: number
  levels: StockLevelRow[]
}

/**
 * A product's stock a page of versions at a time, in the editor's order, each with its levels in the
 * locations the caller reads, default first; a version's levels sit in its owner's locations, at most 20.
 */
export const selectProductStock = (tx: ScopedSql, storeId: string, productId: string, window: PageWindow): Promise<StockVersionRow[]> => {
  const backwards = window.before !== null && window.after === null
  return tx<StockVersionRow[]>`
    select v.id as version_id, v.position,
      coalesce((
        select jsonb_agg(jsonb_build_object('warehouse_id', l.warehouse_id, 'warehouse_name', w.name, 'is_default', w.is_default,
          'on_hand', l.on_hand, 'reserved', l.reserved, 'low_stock_threshold', l.low_stock_threshold) order by w.is_default desc, w.created_at, w.id)
        from stock_level l join warehouse w on w.id = l.warehouse_id
        where l.version_id = v.id and w.deleted_at is null
      ), '[]'::jsonb) as levels
    from product_version v
    where v.product_id = ${productId} and v.store_id = ${storeId} and v.deleted_at is null
      and ${window.after ? tx`(-v.position, v.id) < (${window.after.occurredAt.getTime()}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(-v.position, v.id) > (${window.before.occurredAt.getTime()}, ${window.before.id})` : tx`true`}
    order by v.position ${backwards ? tx`desc` : tx`asc`}, v.id ${backwards ? tx`asc` : tx`desc`}
    limit ${window.limit + 1}
  `
}

export type ChangeReason = 'received' | 'returned' | 'damaged' | 'counted' | 'typed'

/** The quantity now there, and by how much it moved (0 when it didn't, which records nothing). */
export const changeStock = async (tx: ScopedSql, versionId: string, warehouseId: string, change: { delta: number } | { target: number }, reason: ChangeReason): Promise<{ quantity: number; change: number }> => {
  const delta = 'delta' in change ? change.delta : null
  const target = 'target' in change ? change.target : null
  const [row] = await tx<{ quantity: number; change: number }[]>`select quantity, change from stock_change(${versionId}, ${warehouseId}, ${delta}::int, ${target}::int, ${reason})`
  if (!row) throw new Error('stock_change returned no row')
  return row
}

/** Typed numbers for many (version, location) pairs in one call (migration 0046 `stock_change_many`). */
export const setStockTargets = (tx: ScopedSql, entries: readonly { versionId: string; warehouseId: string; target: number }[], reason: 'typed' | 'import' = 'typed') =>
  tx<{ version_id: string; warehouse_id: string; quantity: number; change: number }[]>`
    select version_id, warehouse_id, quantity, change
    from stock_change_many(${tx.json(entries.map((e) => ({ version_id: e.versionId, warehouse_id: e.warehouseId, target: e.target })) as unknown as postgres.JSONValue)}, ${reason})
  `

/** False when the caller doesn't hold that version's stock in a location of its own. */
export const setLowStockThreshold = async (tx: ScopedSql, storeId: string, sellerId: string | null, versionId: string, warehouseId: string, threshold: number | null): Promise<boolean> =>
  (
    await tx`
      update stock_level set low_stock_threshold = ${threshold}
      where version_id = ${versionId} and warehouse_id = ${warehouseId} and store_id = ${storeId} and seller_id is not distinct from ${sellerId}
      returning version_id
    `
  ).length === 1

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
