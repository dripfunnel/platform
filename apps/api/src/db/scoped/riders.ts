import type { PageWindow } from '#core/paging'
import type { ScopedSql } from './index'

// Settings › Riders on the merchant side (DELIVERY §5; DATA-MODEL §3.6, migration 0359), and a rider's own row (0360).

export type RiderStatus = 'invited' | 'active' | 'suspended' | 'removed'

export interface RiderRow {
  id: string
  name: string
  /** Null once removed. */
  phone: string | null
  status: RiderStatus
  vehicle_type: string | null
  vehicle_number: string | null
  current_delivery_id: string | null
  online: boolean
  created_at: Date
}

const columns = (tx: ScopedSql) => tx`r.id, r.name, r.phone, r.status, r.vehicle_type, r.vehicle_number, r.online_at is not null as online, r.created_at,
  (select d.id from delivery d where d.rider_id = r.id and d.store_id = r.store_id and d.state in ('assigned','picked_up') order by (d.state = 'picked_up') desc, d.assigned_at, d.id limit 1) as current_delivery_id`

/** Newest first; a removed rider leaves the list, its row kept for past deliveries. */
export const selectRiders = (tx: ScopedSql, storeId: string, window: PageWindow): Promise<RiderRow[]> => {
  const backwards = window.before !== null && window.after === null
  return tx<RiderRow[]>`
    select ${columns(tx)} from rider r
    where r.store_id = ${storeId} and r.status <> 'removed'
      and ${window.after ? tx`(r.created_at, r.id) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(r.created_at, r.id) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by r.created_at ${backwards ? tx`asc` : tx`desc`}, r.id ${backwards ? tx`asc` : tx`desc`}
    limit ${window.limit + 1}
  `
}

export const lockRider = async (tx: ScopedSql, storeId: string, id: string): Promise<RiderRow | null> =>
  (await tx<RiderRow[]>`select ${columns(tx)} from rider r where r.id = ${id} and r.store_id = ${storeId} and r.status <> 'removed' for update`)[0] ?? null

/** Riders the plan counts (DELIVERY §9): those invited or active. */
export const countCountedRiders = async (tx: ScopedSql, storeId: string): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from rider where store_id = ${storeId} and status in ('invited', 'active')`)[0]?.n ?? 0

/** The number belongs to a rider here already, suspended ones included (the unique index's rule). */
export const riderPhoneTaken = async (tx: ScopedSql, storeId: string, phone: string): Promise<boolean> =>
  (await tx`select 1 from rider where store_id = ${storeId} and phone = ${phone} and status <> 'removed'`).length > 0

export const insertRider = async (tx: ScopedSql, r: { storeId: string; name: string; phone: string; invitedBy: string }): Promise<RiderRow> => {
  const [row] = await tx<RiderRow[]>`
    insert into rider as r (store_id, name, phone, status, invited_by_user_id) values (${r.storeId}, ${r.name}, ${r.phone}, 'invited', ${r.invitedBy})
    returning ${columns(tx)}
  `
  if (!row) throw new Error('riders: the insert returned no row')
  return row
}

export const setRiderStatus = async (tx: ScopedSql, storeId: string, id: string, status: 'active' | 'suspended', now: Date): Promise<RiderRow> => {
  const [row] = await tx<RiderRow[]>`
    update rider r set status = ${status}, online_at = null, updated_at = ${now} where r.id = ${id} and r.store_id = ${storeId}
    returning ${columns(tx)}
  `
  if (!row) throw new Error('riders: the update returned no row')
  return row
}

/** The phone and photo go; the name stays for the deliveries the rider made (DELIVERY §5). */
export const markRiderRemoved = async (tx: ScopedSql, storeId: string, id: string, now: Date): Promise<void> => {
  await tx`
    update rider set status = 'removed', phone = null, photo_asset_id = null, online_at = null, updated_at = ${now}, removed_at = ${now}
    where id = ${id} and store_id = ${storeId}
  `
}

/** Signs the rider out everywhere at once. */
export const endRiderSessions = async (tx: ScopedSql, storeId: string, riderId: string, now: Date): Promise<void> => {
  await tx`update rider_session set ended_at = ${now} where store_id = ${storeId} and rider_id = ${riderId} and ended_at is null`
}

/** Invitation texts sent to this rider lately, the first and every resend, from the log, as partner invitations are counted (partnerTeam.ts). */
export const countRiderTextsSince = async (tx: ScopedSql, storeId: string, riderId: string, since: Date): Promise<number> =>
  (
    await tx<{ n: number }[]>`
      select count(*)::int as n from activity_log
      where store_id = ${storeId} and occurred_at >= ${since} and action in ('rider.invited', 'rider.invitation_resent') and target_type = 'rider' and target_id = ${riderId}
    `
  )[0]?.n ?? 0

// The rider's own row, as app_rider (DELIVERY §4 `me`, `updateProfile`; migration 0360).

export interface OwnRiderRow {
  id: string
  name: string
  phone: string | null
  photo_asset_id: string | null
  vehicle_type: string | null
  vehicle_number: string | null
  status: RiderStatus
  created_at: Date
}

const ownColumns = (tx: ScopedSql) => tx`r.id, r.name, r.phone, r.photo_asset_id, r.vehicle_type, r.vehicle_number, r.status, r.created_at`

export const selectOwnRider = async (tx: ScopedSql, storeId: string, id: string): Promise<OwnRiderRow | null> =>
  (await tx<OwnRiderRow[]>`select ${ownColumns(tx)} from rider r where r.id = ${id} and r.store_id = ${storeId} and r.status = 'active'`)[0] ?? null

export const updateOwnRider = async (
  tx: ScopedSql,
  storeId: string,
  id: string,
  p: { name: string; photoAssetId: string | null; vehicleType: string | null; vehicleNumber: string | null },
  now: Date,
): Promise<OwnRiderRow | null> =>
  (
    await tx<OwnRiderRow[]>`
      update rider r set name = ${p.name}, photo_asset_id = ${p.photoAssetId}, vehicle_type = ${p.vehicleType}, vehicle_number = ${p.vehicleNumber}, updated_at = ${now}
      where r.id = ${id} and r.store_id = ${storeId} and r.status = 'active'
      returning ${ownColumns(tx)}
    `
  )[0] ?? null

/** An image the rider uploaded itself, in its own store: the only photo its profile may name. */
export const ownPhotoExists = async (tx: ScopedSql, storeId: string, riderId: string, assetId: string): Promise<boolean> =>
  (await tx`select 1 from asset where id = ${assetId} and store_id = ${storeId} and created_by = ${riderId} and kind = 'image'`).length > 0

export const countOwnUploadsSince = async (tx: ScopedSql, storeId: string, riderId: string, since: Date): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from asset where store_id = ${storeId} and created_by = ${riderId} and created_at >= ${since}`)[0]?.n ?? 0

/**
 * Every photo the rider uploaded goes, with Delete my account (DELIVERY §5); one the store has since put on a product
 * stays, as the store's. Returns the R2 keys of those deleted.
 */
export const deleteOwnUploads = async (tx: ScopedSql, storeId: string, riderId: string): Promise<string[]> => {
  const all = await refusedIfInUse(tx.savepoint((sp) => sp<{ r2_key: string }[]>`delete from asset where store_id = ${storeId} and created_by = ${riderId} returning r2_key`))
  if (all) return all.map((r) => r.r2_key)
  // One is in use, and app_rider can't see by whom (RLS), so each is tried alone; only a rider whose photo the store reused.
  const files = await tx<{ id: string; r2_key: string }[]>`select id, r2_key from asset where store_id = ${storeId} and created_by = ${riderId}`
  const deleted: string[] = []
  for (const file of files) {
    const gone = await refusedIfInUse(tx.savepoint((sp) => sp`delete from asset where id = ${file.id} and store_id = ${storeId} and created_by = ${riderId}`))
    if (gone?.count) deleted.push(file.r2_key)
  }
  return deleted
}

/** The statement's result, or null when a foreign key refused it (23503): the asset is in use. */
const refusedIfInUse = <T,>(statement: Promise<T>): Promise<T | null> =>
  statement.catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === '23503') return null
    throw error
  })

/** The rider named by an erasure, a removed one included, locked. */
export const lockRiderToErase = async (tx: ScopedSql, storeId: string, id: string): Promise<{ id: string; name: string; phone: string | null } | null> =>
  (await tx<{ id: string; name: string; phone: string | null }[]>`select id, name, phone from rider where id = ${id} and store_id = ${storeId} for update`)[0] ?? null

export const formerRiderName = 'Former rider'

/** The row stays for the deliveries the rider made; nothing on it names or reaches them (DELIVERY §5). */
export const eraseRiderRow = async (tx: ScopedSql, storeId: string, id: string, now: Date): Promise<void> => {
  await tx`
    update rider set name = ${formerRiderName}, status = 'removed', phone = null, photo_asset_id = null, vehicle_type = null, vehicle_number = null,
      online_at = null, updated_at = ${now}, removed_at = coalesce(removed_at, ${now})
    where id = ${id} and store_id = ${storeId}
  `
}

export const deleteRiderSessions = async (tx: ScopedSql, storeId: string, riderId: string): Promise<void> => {
  await tx`delete from rider_session where store_id = ${storeId} and rider_id = ${riderId}`
}

export const deleteRiderCodes = async (tx: ScopedSql, storeId: string, phone: string): Promise<void> => {
  await tx`delete from rider_code where store_id = ${storeId} and phone = ${phone}`
}

export const deleteRiderPosition = async (tx: ScopedSql, storeId: string, riderId: string): Promise<void> => {
  await tx`delete from rider_position where store_id = ${storeId} and rider_id = ${riderId}`
}

/** The rider's earlier exports hold their name and number, so they go with them. */
export const deleteRiderExports = async (tx: ScopedSql, storeId: string, riderId: string): Promise<void> => {
  await tx`delete from catalog_export where store_id = ${storeId} and kind = 'rider' and filter->>'riderId' = ${riderId}`
}

/** Queued and kept texts and pushes that name the rider lose their payload, and what is not yet sent is not sent (LOGGING §8). */
export const scrubRiderOutbox = async (tx: ScopedSql, storeId: string, riderId: string, phone: string | null): Promise<void> => {
  await tx`
    update outbox set payload = '{"erased":true}'::jsonb, failed_at = case when delivered_at is null then coalesce(failed_at, now()) else failed_at end,
      last_error = case when delivered_at is null then 'erased' else last_error end
    where store_id = ${storeId} and payload <> '{"erased":true}'::jsonb
      and (payload->'subject'->>'id' = ${riderId} or payload->>'riderId' = ${riderId} or ${phone === null ? tx`false` : tx`payload->>'to' = ${phone}`})
  `
}

/** Their name on the log's entries, by the one function that may change the log's labels (migration 0372). */
export const eraseRiderLabels = async (tx: ScopedSql, storeId: string, riderId: string): Promise<void> => {
  await tx`select erase_rider_labels(${storeId}, ${riderId})`
}

export interface RiderExportProfile {
  name: string
  phone: string | null
  status: RiderStatus
  vehicle_type: string | null
  vehicle_number: string | null
  created_at: Date
}

export const selectRiderForExport = async (tx: ScopedSql, storeId: string, id: string): Promise<RiderExportProfile | null> =>
  (await tx<RiderExportProfile[]>`select name, phone, status, vehicle_type, vehicle_number, created_at from rider where id = ${id} and store_id = ${storeId}`)[0] ?? null

export interface RiderExportDelivery {
  created_at: Date
  state: string
  warehouse: string
  area: string | null
  cash_collected: boolean
  assigned_at: Date | null
  picked_up_at: Date | null
  delivered_at: Date | null
  failed_at: Date | null
  failed_reason: string | null
}

/** The rider's deliveries, oldest first, never the customer's name, address or phone: the area only (DELIVERY §5). */
export const selectRiderDeliveriesForExport = (tx: ScopedSql, storeId: string, riderId: string, limit: number): Promise<RiderExportDelivery[]> =>
  tx<RiderExportDelivery[]>`
    select d.created_at, d.state, w.name as warehouse, d.area, d.cash_collected_at is not null as cash_collected,
      d.assigned_at, d.picked_up_at, d.delivered_at, d.failed_at, d.failed_reason
    from delivery d join warehouse w on w.id = d.warehouse_id and w.store_id = d.store_id
    where d.store_id = ${storeId} and d.rider_id = ${riderId}
    order by d.created_at, d.id
    limit ${limit}
  `

export interface RiderExportSession {
  created_at: Date
  last_seen_at: Date
  ended_at: Date | null
}

export const selectRiderSessionsForExport = (tx: ScopedSql, storeId: string, riderId: string, limit: number): Promise<RiderExportSession[]> =>
  tx<RiderExportSession[]>`select created_at, last_seen_at, ended_at from rider_session where store_id = ${storeId} and rider_id = ${riderId} order by created_at limit ${limit}`
