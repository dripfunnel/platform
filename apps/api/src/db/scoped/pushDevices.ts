import { maxPageSize, pgArray, type ScopedSql } from './index'

// The phones a store's apps push to (DATA-MODEL §3.6, DELIVERY §6). Every query names the store.

export type PushPlatform = 'ios' | 'android'
export type PushSubjectKind = 'rider' | 'customer' | 'order'

/** What a register did: a new row, a token moved from another subject, or only `last_seen_at` moved on. */
export type DeviceChange = 'added' | 'moved' | 'refreshed'

/** In system scope: a token another subject of the store holds becomes this rider's (DELIVERY §4). */
export const upsertRiderDevice = async (tx: ScopedSql, d: { storeId: string; riderId: string; token: string; platform: PushPlatform; now: Date }): Promise<DeviceChange> => {
  const [before] = await tx<{ subject_kind: string; subject_id: string }[]>`
    select subject_kind, subject_id from push_device where store_id = ${d.storeId} and expo_token = ${d.token} for update
  `
  await tx`
    insert into push_device (store_id, subject_kind, subject_id, expo_token, platform, created_at, last_seen_at)
    values (${d.storeId}, 'rider', ${d.riderId}, ${d.token}, ${d.platform}, ${d.now}, ${d.now})
    on conflict (store_id, expo_token) do update set subject_kind = 'rider', subject_id = excluded.subject_id, platform = excluded.platform, last_seen_at = excluded.last_seen_at
  `
  if (!before) return 'added'
  return before.subject_kind === 'rider' && before.subject_id === d.riderId ? 'refreshed' : 'moved'
}

/** The rider's own phone, by its token; false when it isn't theirs. */
export const deleteOwnDevice = async (tx: ScopedSql, storeId: string, riderId: string, token: string): Promise<boolean> =>
  (await tx`delete from push_device where store_id = ${storeId} and subject_kind = 'rider' and subject_id = ${riderId} and expo_token = ${token}`).count > 0

/** Sign-out, suspension, removal and account deletion: every phone of the rider. */
export const deleteRiderDevices = async (tx: ScopedSql, storeId: string, riderId: string): Promise<void> => {
  await tx`delete from push_device where store_id = ${storeId} and subject_kind = 'rider' and subject_id = ${riderId}`
}

export interface PushDeviceRow {
  id: string
  expo_token: string
}

export const selectSubjectDevices = (tx: ScopedSql, storeId: string, kind: PushSubjectKind, subjectId: string): Promise<PushDeviceRow[]> =>
  tx<PushDeviceRow[]>`
    select id, expo_token from push_device where store_id = ${storeId} and subject_kind = ${kind} and subject_id = ${subjectId}
    order by last_seen_at desc, id limit ${maxPageSize}
  `

/** Tokens Expo answered `DeviceNotRegistered` (DELIVERY §6). */
export const deleteDevicesByIds = async (tx: ScopedSql, storeId: string, ids: readonly string[]): Promise<number> =>
  ids.length === 0 ? 0 : (await tx`delete from push_device where store_id = ${storeId} and id = any(${pgArray(ids)}::uuid[])`).count

export interface PushStoreRow {
  partner_id: string
  name: string
  locale: string
}

export const selectPushStore = async (tx: ScopedSql, storeId: string): Promise<PushStoreRow | null> =>
  (await tx<PushStoreRow[]>`select partner_id, name, main_language as locale from store where id = ${storeId}`)[0] ?? null
