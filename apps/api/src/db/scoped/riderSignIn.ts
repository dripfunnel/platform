import type { ScopedSql } from './index'
import type { RiderStatus } from './riders'

// Riders signing in (DELIVERY §4, §5; DATA-MODEL §3.6): codes and sessions, in system scope, every query naming the store.

/** The store's rider holding a number, removed ones aside: only these are ever texted a code. */
export const selectRiderByPhone = async (tx: ScopedSql, storeId: string, phone: string): Promise<{ id: string; name: string; status: RiderStatus } | null> =>
  (await tx<{ id: string; name: string; status: RiderStatus }[]>`
    select id, name, status from rider where store_id = ${storeId} and phone = ${phone} and status <> 'removed' limit 1
  `)[0] ?? null

export const countRecentRiderCodes = async (tx: ScopedSql, storeId: string, phone: string, since: Date): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from rider_code where store_id = ${storeId} and phone = ${phone} and created_at >= ${since}`)[0]?.n ?? 0

export const countStoreRiderCodes = async (tx: ScopedSql, storeId: string, since: Date): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from rider_code where store_id = ${storeId} and created_at >= ${since}`)[0]?.n ?? 0

export const insertRiderCode = async (tx: ScopedSql, c: { storeId: string; phone: string; expiresAt: Date; now: Date }): Promise<string> => {
  const [made] = await tx<{ id: string }[]>`
    insert into rider_code (store_id, phone, expires_at, created_at) values (${c.storeId}, ${c.phone}, ${c.expiresAt}, ${c.now}) returning id
  `
  if (!made) throw new Error('riders: code insert returned nothing')
  return made.id
}

export const setRiderCodeHash = async (tx: ScopedSql, id: string, codeHash: string): Promise<void> => {
  await tx`update rider_code set code_hash = ${codeHash} where id = ${id}`
}

/** The number's newest unspent, unexpired code; earlier ones die with it. */
export const selectLiveRiderCode = async (tx: ScopedSql, storeId: string, phone: string, now: Date): Promise<{ id: string; code_hash: string | null; attempts: number } | null> =>
  (await tx<{ id: string; code_hash: string | null; attempts: number }[]>`
    select id, code_hash, attempts from rider_code
    where store_id = ${storeId} and phone = ${phone} and used_at is null and expires_at > ${now}
    order by created_at desc, id desc limit 1 for update
  `)[0] ?? null

export const countRiderCodeAttempt = async (tx: ScopedSql, id: string): Promise<void> => {
  await tx`update rider_code set attempts = attempts + 1 where id = ${id}`
}

export const spendRiderCode = async (tx: ScopedSql, id: string, now: Date): Promise<void> => {
  await tx`update rider_code set used_at = ${now} where id = ${id}`
}

/** Taking the first code is joining (DELIVERY §5): an invited rider becomes active. */
export const activateRider = async (tx: ScopedSql, storeId: string, id: string, now: Date): Promise<void> => {
  await tx`update rider set status = 'active', updated_at = ${now} where store_id = ${storeId} and id = ${id} and status = 'invited'`
}

export const insertRiderSession = async (tx: ScopedSql, s: { idHash: string; storeId: string; riderId: string; expiresAt: Date; now: Date }): Promise<void> => {
  await tx`insert into rider_session (id_hash, store_id, rider_id, created_at, last_seen_at, expires_at) values (${s.idHash}, ${s.storeId}, ${s.riderId}, ${s.now}, ${s.now}, ${s.expiresAt})`
}

/** A live session of an active rider of this store, moved on to `expiresAt` at most hourly. */
export const touchRiderSession = async (tx: ScopedSql, idHash: string, storeId: string, now: Date, expiresAt: Date): Promise<string | null> =>
  (
    await tx<{ rider_id: string }[]>`
      with live as (
        select s.id_hash, s.rider_id, s.last_seen_at from rider_session s join rider r on r.id = s.rider_id and r.store_id = ${storeId} and r.status = 'active'
        where s.id_hash = ${idHash} and s.store_id = ${storeId} and s.ended_at is null and s.expires_at > ${now}
      ), moved as (
        update rider_session set last_seen_at = ${now}, expires_at = ${expiresAt}
        where id_hash in (select id_hash from live where last_seen_at < ${new Date(now.getTime() - 3_600_000)}) returning id_hash
      )
      select rider_id from live
    `
  )[0]?.rider_id ?? null

export const endRiderSession = async (tx: ScopedSql, idHash: string, storeId: string, now: Date): Promise<{ id: string; name: string } | null> =>
  (
    await tx<{ id: string; name: string }[]>`
      update rider_session s set ended_at = ${now} from rider r
      where s.id_hash = ${idHash} and s.store_id = ${storeId} and s.ended_at is null and r.id = s.rider_id
      returning r.id, r.name
    `
  )[0] ?? null

/** The hourly sweep, as shoppers' (ACCESS §2.1): codes a day past expiry, sessions ended or expired 30 days ago. */
export const purgeRiderSignIns = async (tx: ScopedSql, now: Date, limit: number): Promise<number> => {
  const codes = await tx`delete from rider_code where id in (select id from rider_code where expires_at < ${new Date(now.getTime() - 86_400_000)} limit ${limit})`
  const sessions = await tx`
    delete from rider_session where id_hash in (select id_hash from rider_session
      where coalesce(ended_at, expires_at) < ${new Date(now.getTime() - 30 * 86_400_000)} limit ${limit})
  `
  return codes.count + sessions.count
}

export interface DeliveryStoreRow {
  store_id: string
  partner_id: string
  status: 'trial' | 'active' | 'past_due' | 'cancelled' | 'suspended' | 'closed'
}

/** The store whose free address `{slug}.<SHOP_DOMAIN>` is: the Delivery API's only host (DELIVERY §4), never a closed one's. */
export const selectDeliveryStore = async (tx: ScopedSql, slug: string): Promise<DeliveryStoreRow | null> => {
  const rows = await tx<DeliveryStoreRow[]>`
    select s.id as store_id, s.partner_id, s.status from store s join partner p on p.id = s.partner_id
    where lower(s.slug) = ${slug} and s.status <> 'closed' and p.state <> 'closed'
    limit 2
  `
  return rows.length === 1 ? (rows[0] ?? null) : null
}

export const selectEndingRider = async (tx: ScopedSql, idHash: string, storeId: string): Promise<{ id: string; name: string } | null> => (await tx<{ id: string; name: string }[]>`select r.id,r.name from rider_session s join rider r on r.id = s.rider_id and r.store_id = s.store_id where s.id_hash = ${idHash} and s.store_id = ${storeId} and s.ended_at is null`)[0] ?? null
