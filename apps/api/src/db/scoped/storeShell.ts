import type { PageWindow } from '#core/paging'
import type { ScopedSql } from './index'

// What the portal's shell reads about the signed-in person and the acting store (FIRST-RELEASE
// §3, §19: `myStores`, `storeState`).

export interface MembershipChoiceRow {
  membership_id: string
  store_id: string
  store_name: string
  role_key: string
  seller_id: string | null
  seller_name: string | null
  access_level: string | null
  created_at: Date
}

/**
 * The person's memberships in this partner's open stores, newest first (`system` scope: a
 * person's stores span the partner, and the read is held to their own user id and partner).
 */
export const selectMyMemberships = async (tx: ScopedSql, userId: string, partnerId: string, window: PageWindow): Promise<MembershipChoiceRow[]> =>
  tx<MembershipChoiceRow[]>`
    select m.id as membership_id, s.id as store_id, s.name as store_name, m.role_key, m.seller_id, se.name as seller_name, se.access_level, m.created_at
    from membership m
    join store s on s.id = m.store_id
    left join seller se on se.id = m.seller_id
    where m.user_id = ${userId} and m.status = 'active' and s.partner_id = ${partnerId} and s.status <> 'closed'
      and (m.seller_id is null or se.status = 'active')
      and ${window.after ? tx`(m.created_at, m.id) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(m.created_at, m.id) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by m.created_at ${window.before && !window.after ? tx`asc` : tx`desc`}, m.id ${window.before && !window.after ? tx`asc` : tx`desc`}
    limit ${window.limit + 1}
  `

export interface StoreStateRow {
  status: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled'
  trial_ends_at: Date | null
  past_due_since: Date | null
  job_state: 'running' | 'failed' | 'cleaning' | 'done' | 'undone' | null
  job_step: string | null
}

/** The acting store's own state, read in its scope, with its newest provisioning job. */
export const selectStoreState = async (tx: ScopedSql, storeId: string): Promise<StoreStateRow | null> => {
  const rows = await tx<StoreStateRow[]>`
    select s.status, s.trial_ends_at, s.past_due_since, j.state as job_state, j.step as job_step
    from store s
    left join lateral (select state, step from job where store_id = s.id and kind = 'provision-store' order by started_at desc limit 1) j on true
    where s.id = ${storeId}
  `
  return rows[0] ?? null
}

export interface OpenSupportRow {
  agent_name: string
  partner_name: string
  expires_at: Date
}

/**
 * The partner support session open on this store now, for the banner every person in it sees
 * (ACCESS.md §8). `system` scope until SAPI 21 gives the store side its own policy; held to the
 * acting store and its partner, and only the banner's three facts leave.
 */
export const selectOpenSupportSession = async (tx: ScopedSql, storeId: string, partnerId: string, now: Date): Promise<OpenSupportRow | null> => {
  const rows = await tx<OpenSupportRow[]>`
    select pu.name as agent_name, p.name as partner_name, ss.expires_at
    from support_session ss
    join partner_user pu on pu.id = ss.partner_user_id
    join partner p on p.id = ss.partner_id
    where ss.store_id = ${storeId} and ss.partner_id = ${partnerId} and ss.ended_at is null and ss.expires_at > ${now}
    order by ss.started_at desc limit 1
  `
  return rows[0] ?? null
}
