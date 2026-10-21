import type { PageWindow } from '#core/paging'
import { pgArray, type ScopedSql } from './index'

// The store's API keys (DATA-MODEL §3.5, migrations/0150). Listing and changing run in the store's own scope;
// resolving a presented secret runs in system scope, since no caller is known yet.

export interface ApiKeyRow {
  id: string
  name: string
  prefix: string
  scopes: string[]
  seller_id: string | null
  seller_name: string | null
  created_by_user_id: string
  created_by_name: string | null
  /** False once the creator is no longer an active Owner here (decided on #337). */
  created_by_here: boolean
  created_at: Date
  expires_at: Date | null
  last_used_at: Date | null
  /** Until when the secret this key was rotated from still works; null once it doesn't. */
  previous_until: Date | null
}

const live = (tx: ScopedSql, now: Date) => tx`k.revoked_at is null and k.superseded_at is null and (k.expires_at is null or k.expires_at > ${now})`

/** Live keys, newest first; a rotated key's predecessor shows only as its successor's `previous_until`. */
export const selectApiKeys = (tx: ScopedSql, storeId: string, window: PageWindow, now: Date): Promise<ApiKeyRow[]> =>
  tx<ApiKeyRow[]>`
    select k.id, k.name, k.prefix, to_jsonb(k.scopes) as scopes, k.seller_id, se.name as seller_name, k.created_by_user_id, u.name as created_by_name,
      exists (select 1 from membership m where m.store_id = k.store_id and m.user_id = k.created_by_user_id and m.seller_id is null and m.status = 'active' and m.role_key = 'owner') as created_by_here,
      k.created_at, k.expires_at, k.last_used_at,
      (select p.expires_at from api_key p where p.id = k.rotated_from_id and p.revoked_at is null and p.expires_at > ${now}) as previous_until
    from api_key k
    left join seller se on se.id = k.seller_id
    left join "user" u on u.id = k.created_by_user_id
    where k.store_id = ${storeId} and ${live(tx, now)}
      and ${window.after ? tx`(k.created_at, k.id) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(k.created_at, k.id) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by k.created_at ${window.before && !window.after ? tx`asc` : tx`desc`}, k.id ${window.before && !window.after ? tx`asc` : tx`desc`}
    limit ${window.limit + 1}
  `

export const countLiveApiKeys = async (tx: ScopedSql, storeId: string, now: Date): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from api_key k where k.store_id = ${storeId} and ${live(tx, now)}`)[0]?.n ?? 0

export interface NewApiKey {
  id: string
  storeId: string
  sellerId: string | null
  name: string
  prefix: string
  hash: string
  scopes: readonly string[]
  createdBy: string
  expiresAt: Date | null
  rotatedFromId: string | null
  now: Date
}

/** The id is chosen here, not returned: the role inserts but never reads the hash it wrote back. */
export const insertApiKey = async (tx: ScopedSql, k: NewApiKey): Promise<void> => {
  await tx`
    insert into api_key (id, store_id, seller_id, name, prefix, secret_hash, scopes, created_by_user_id, created_at, expires_at, rotated_from_id)
    values (${k.id}, ${k.storeId}, ${k.sellerId}, ${k.name}, ${k.prefix}, ${k.hash}, ${pgArray(k.scopes)}::text[], ${k.createdBy}, ${k.now}, ${k.expiresAt}, ${k.rotatedFromId})
  `
}

export interface LockedApiKey {
  id: string
  name: string
  prefix: string
  scopes: string[]
  seller_id: string | null
  expires_at: Date | null
}

/** A live key of this store, locked, so a rotation and a revocation of it take turns. */
export const lockLiveApiKey = async (tx: ScopedSql, storeId: string, id: string, now: Date): Promise<LockedApiKey | null> =>
  (
    await tx<LockedApiKey[]>`
      select k.id, k.name, k.prefix, to_jsonb(k.scopes) as scopes, k.seller_id, k.expires_at from api_key k
      where k.id = ${id} and k.store_id = ${storeId} and ${live(tx, now)}
      for update
    `
  )[0] ?? null

/** The old secret works until `until` (ACCESS.md §5.6's day), or its own earlier expiry. */
export const supersedeApiKey = async (tx: ScopedSql, id: string, until: Date, now: Date): Promise<void> => {
  await tx`update api_key set superseded_at = ${now}, expires_at = least(coalesce(expires_at, ${until}), ${until}) where id = ${id}`
}

/** Revokes the key and the predecessors still working for it, so "stops straight away" holds for every secret it had. */
export const revokeApiKeyChain = async (tx: ScopedSql, storeId: string, id: string, by: string, now: Date): Promise<void> => {
  await tx`
    with recursive chain as (
      select id, rotated_from_id from api_key where id = ${id} and store_id = ${storeId}
      union all
      select k.id, k.rotated_from_id from api_key k join chain c on k.id = c.rotated_from_id where k.store_id = ${storeId}
    )
    update api_key set revoked_at = ${now}, revoked_by_user_id = ${by}
    where id in (select id from chain) and revoked_at is null
  `
}

export interface PresentedKeyRow {
  id: string
  name: string
  store_id: string
  partner_id: string
  store_name: string
  store_status: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled'
  seller_id: string | null
  seller_name: string | null
  seller_status: string | null
  access_level: string | null
  scopes: string[]
  created_by_user_id: string
}

/** The live key with this hash on a live store of the host's partner; anything else reads as no key. */
export const selectPresentedKey = async (tx: ScopedSql, hash: string, partnerId: string, now: Date): Promise<PresentedKeyRow | null> =>
  (
    await tx<PresentedKeyRow[]>`
      select k.id, k.name, k.store_id, s.partner_id, s.name as store_name, s.status as store_status, k.seller_id, se.name as seller_name, se.status as seller_status,
        se.access_level, to_jsonb(k.scopes) as scopes, k.created_by_user_id
      from api_key k
      join store s on s.id = k.store_id
      left join seller se on se.id = k.seller_id
      where k.secret_hash = ${hash} and k.revoked_at is null and (k.expires_at is null or k.expires_at > ${now})
        and s.partner_id = ${partnerId} and s.status <> 'closed'
    `
  )[0] ?? null

/** "Last used" to the minute: at most one write a minute per key, however busy it is. */
export const touchApiKey = async (tx: ScopedSql, id: string, now: Date): Promise<void> => {
  await tx`update api_key set last_used_at = ${now} where id = ${id} and (last_used_at is null or last_used_at < ${new Date(now.getTime() - 60_000)})`
}

/** The live keys a person made here, for telling the Owners when that person leaves or stops being an Owner. */
export const selectKeysMadeBy = async (tx: ScopedSql, storeId: string, userId: string, now: Date): Promise<string[]> =>
  (await tx<{ id: string }[]>`select k.id from api_key k where k.store_id = ${storeId} and k.created_by_user_id = ${userId} and ${live(tx, now)} order by k.id`).map((r) => r.id)

/** The name the Owners' email gives the person who made the keys, read when it's sent rather than kept in the outbox. */
export const selectKeyCreatorName = async (tx: ScopedSql, userId: string, partnerId: string): Promise<string | null> =>
  (await tx<{ label: string }[]>`select coalesce(nullif(name, ''), email) as label from "user" where id = ${userId} and partner_id = ${partnerId}`)[0]?.label ?? null
