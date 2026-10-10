import type { ScopedSql } from './index'

// Caller resolution on a portal host (ACCESS.md §3, §4). Each runs in `system` scope, because
// no caller is known yet; each takes the host's partner and never reaches past it.

/** The partner whose portal this host is; null for a host no partner holds, or a closed partner's. */
export const selectPortalPartner = async (tx: ScopedSql, host: string): Promise<string | null> => {
  const rows = await tx<{ partner_id: string }[]>`
    select d.partner_id from partner_domain d join partner p on p.id = d.partner_id
    where d.kind = 'portal' and lower(d.host) = lower(${host})
      and d.status not in ('waiting', 'failed') and p.state <> 'closed'
  `
  return rows[0]?.partner_id ?? null
}

export interface StorePersonRow {
  id: string
  name: string
  email: string
}

/** An active person of this partner; a suspended or deleted one reads as nobody. */
export const selectStorePerson = async (tx: ScopedSql, userId: string, partnerId: string): Promise<StorePersonRow | null> => {
  const rows = await tx<StorePersonRow[]>`
    select id, name, email from "user" where id = ${userId} and partner_id = ${partnerId} and status = 'active'
  `
  return rows[0] ?? null
}

export interface MembershipRow {
  membership_id: string
  role_key: string
  seller_id: string | null
  seller_name: string | null
  access_level: string | null
  store_id: string
  store_name: string
  store_status: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled'
  plan_id: string | null
  plan_name: string | null
}

/**
 * The person's active memberships in one store of this partner: the merchant one, or one per
 * supplier they work for (DATA-MODEL.md §3.3). A closed store, a suspended or removed supplier
 * and an inactive membership return nothing.
 */
export const selectMemberships = async (tx: ScopedSql, userId: string, partnerId: string, storeId: string): Promise<MembershipRow[]> =>
  tx<MembershipRow[]>`
    select m.id as membership_id, m.role_key, m.seller_id, se.name as seller_name, se.access_level,
           s.id as store_id, s.name as store_name, s.status as store_status, s.plan_id, p.name as plan_name
    from membership m
    join store s on s.id = m.store_id
    left join seller se on se.id = m.seller_id
    left join plan p on p.id = s.plan_id
    where m.user_id = ${userId} and m.store_id = ${storeId} and m.status = 'active'
      and s.partner_id = ${partnerId} and s.status <> 'closed'
      and (m.seller_id is null or se.status = 'active')
    order by m.seller_id nulls first, m.created_at
  `

/** Every store the person may act in under this partner, for the crossing entry (ACCESS.md §4). */
export const selectHeldStoreIds = async (tx: ScopedSql, userId: string, partnerId: string, limit: number): Promise<string[]> => {
  const rows = await tx<{ store_id: string }[]>`
    select distinct m.store_id from membership m join store s on s.id = m.store_id
    where m.user_id = ${userId} and m.status = 'active' and s.partner_id = ${partnerId} and s.status <> 'closed'
    order by m.store_id limit ${limit}
  `
  return rows.map((r) => r.store_id)
}

/** How many crossings this person or support session has had logged since `since` (actor index), counting no further than `cap`. */
export const crossingsLoggedSince = async (tx: ScopedSql, actor: { kind: 'person' | 'support_session'; id: string }, since: Date, cap: number): Promise<number> =>
  (
    await tx`
      select 1 from activity_log
      where actor_kind = ${actor.kind} and actor_id = ${actor.id} and occurred_at > ${since} and action = 'store.crossing_refused'
      limit ${cap}
    `
  ).length
