import type { ScopedSql } from './index'

// Caller resolution on a portal host (ACCESS.md §3, §4). Each runs in `system` scope, because
// no caller is known yet; each takes the host's partner and never reaches past it.

/** The partner whose portal this host is; null for a host no partner holds, not yet live, or a closed partner's. */
export const selectPortalPartner = async (tx: ScopedSql, host: string): Promise<string | null> => {
  const rows = await tx<{ partner_id: string }[]>`
    select d.partner_id from partner_domain d join partner p on p.id = d.partner_id
    where d.kind = 'portal' and lower(d.host) = lower(${host})
      and d.status in ('live', 'expiring', 'broken') and p.state <> 'closed'
  `
  return rows[0]?.partner_id ?? null
}

export interface StorePersonRow {
  id: string
  name: string
  email: string
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

const membershipJoins = (tx: ScopedSql) => tx`
  from membership m
  join store s on s.id = m.store_id
  left join seller se on se.id = m.seller_id
  left join plan p on p.id = s.plan_id
`

// One rule for both readers of a seat (#1124): an active membership, a store of this partner not closed, an active supplier.
const heldMembership = (tx: ScopedSql, user: ReturnType<ScopedSql>, partnerId: string, storeId: string | null) => tx`
  m.user_id = ${user} and m.store_id = ${storeId} and m.status = 'active'
  and s.partner_id = ${partnerId} and s.status <> 'closed'
  and (m.seller_id is null or se.status = 'active')
`

/**
 * The person's active memberships in one store of this partner: the merchant one, or one per
 * supplier they work for (DATA-MODEL.md §3.3). A closed store, a suspended or removed supplier
 * and an inactive membership return nothing.
 */
export const selectMemberships = async (tx: ScopedSql, userId: string, partnerId: string, storeId: string): Promise<MembershipRow[]> =>
  tx<MembershipRow[]>`
    select m.id as membership_id, m.role_key, m.seller_id, se.name as seller_name, se.access_level,
           s.id as store_id, s.name as store_name, s.status as store_status, s.plan_id, p.name as plan_name
    ${membershipJoins(tx)}
    where ${heldMembership(tx, tx`${userId}`, partnerId, storeId)}
    order by m.seller_id nulls first, m.created_at
  `

/** What makes a portal session live (ACCESS.md §4); the idle limits come from the caller (auth/storeSession.ts). */
export interface UserSessionWindow {
  idHash: string
  partnerId: string
  now: Date
  idleMs: number
  rememberIdleMs: number
}

/** A full, unexpired, recently seen session of this partner: one condition for `readUserSession` and the standing (#1124). */
export const liveUserSession = (tx: ScopedSql, w: UserSessionWindow) => tx`
  id_hash = ${w.idHash}
  and partner_id = ${w.partnerId}
  and stage = 'full'
  and absolute_expires_at > ${w.now}
  and last_seen_at > ${w.now}::timestamptz - case when remember then ${`${w.rememberIdleMs} milliseconds`}::interval else ${`${w.idleMs} milliseconds`}::interval end
`

export interface StandingRow extends StorePersonRow {
  last_seen_at: Date
  memberships: MembershipRow[]
}

/**
 * The live session's active person and their seats in the store asked for, in one statement (#1124): no row for no live
 * session or an inactive person; an empty `memberships` for a store not held, or none asked (`storeId` null).
 */
export const selectStanding = async (tx: ScopedSql, w: UserSessionWindow, storeId: string | null): Promise<StandingRow | null> => {
  const rows = await tx<StandingRow[]>`
    with session as (select user_id, last_seen_at from user_session where ${liveUserSession(tx, w)})
    select u.id, u.name, u.email, session.last_seen_at,
      coalesce((
        select json_agg(json_build_object(
          'membership_id', m.id, 'role_key', m.role_key, 'seller_id', m.seller_id, 'seller_name', se.name, 'access_level', se.access_level,
          'store_id', s.id, 'store_name', s.name, 'store_status', s.status, 'plan_id', s.plan_id, 'plan_name', p.name
        ) order by m.seller_id nulls first, m.created_at)
        ${membershipJoins(tx)}
        where ${heldMembership(tx, tx`u.id`, w.partnerId, storeId)}
      ), '[]'::json) as memberships
    from session
    join "user" u on u.id = session.user_id
    where u.partner_id = ${w.partnerId} and u.status = 'active'
  `
  return rows[0] ?? null
}

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
