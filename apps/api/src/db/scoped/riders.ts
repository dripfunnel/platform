import type { PageWindow } from '#core/paging'
import type { ScopedSql } from './index'

// Settings › Riders (DELIVERY §5; DATA-MODEL §3.6, migration 0359): the merchant side only, in its own scope.

export type RiderStatus = 'invited' | 'active' | 'suspended' | 'removed'

export interface RiderRow {
  id: string
  name: string
  /** Null once removed. */
  phone: string | null
  status: RiderStatus
  vehicle_type: string | null
  vehicle_number: string | null
  online: boolean
  created_at: Date
}

const columns = (tx: ScopedSql) => tx`r.id, r.name, r.phone, r.status, r.vehicle_type, r.vehicle_number, r.online_at is not null as online, r.created_at`

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

/** Invitations texted to this rider lately, from the log, as partner invitations are counted (partnerTeam.ts). */
export const countRiderInvitationsSince = async (tx: ScopedSql, storeId: string, riderId: string, since: Date): Promise<number> =>
  (
    await tx<{ n: number }[]>`
      select count(*)::int as n from activity_log
      where store_id = ${storeId} and occurred_at >= ${since} and action = 'rider.invitation_resent' and target_type = 'rider' and target_id = ${riderId}
    `
  )[0]?.n ?? 0
