import type { PartnerState } from '#db/schema/saas'
import type { Subscription } from '#core/tenancy'
import type { ScopedSql } from './index'

// The store portal's half of staff impersonation (ACCESS.md §8.1, §8.3), in system scope: the
// caller isn't known until the cookie resolves, and `impersonation` is a platform table.

/** Spends a store user's handoff once, on this partner's portal host, and keeps the new cookie's hash on the session. */
export const spendStoreHandoff = async (tx: ScopedSql, partnerId: string, handoffHash: string, portalHash: string, now: Date): Promise<string | null> =>
  (
    await tx<{ id: string }[]>`
      update impersonation set handoff_used_at = ${now}, handoff_hash = null, portal_session_hash = ${portalHash}
      where handoff_hash = ${handoffHash} and target_kind = 'person' and partner_id = ${partnerId} and handoff_used_at is null
        and handoff_expires_at > ${now} and ended_at is null and expires_at > ${now}
      returning id
    `
  )[0]?.id ?? null

export interface StoreStaffRow {
  id: string
  staff_id: string
  staff_name: string
  staff_email: string
  partner_id: string
  partner_name: string
  partner_state: PartnerState
  store_id: string
  store_name: string
  store_status: Subscription | 'closed'
  plan_id: string | null
  plan_name: string | null
  membership_id: string
  membership_status: string
  role_key: string
  seller_id: string | null
  seller_name: string | null
  seller_status: string | null
  access_level: string | null
  user_id: string
  user_name: string
  user_email: string
  user_status: string
  expires_at: Date
  ended_at: Date | null
  end_reason: string | null
}

const storeSessions = (tx: ScopedSql) => tx`
  select i.id, st.id as staff_id, st.name as staff_name, st.email as staff_email, p.id as partner_id, p.name as partner_name, p.state as partner_state,
    s.id as store_id, s.name as store_name, s.status as store_status, s.plan_id, pl.name as plan_name,
    m.id as membership_id, m.status as membership_status, m.role_key, m.seller_id, se.name as seller_name, se.status as seller_status, se.access_level,
    u.id as user_id, u.name as user_name, u.email as user_email, u.status as user_status,
    i.expires_at, i.ended_at, i.end_reason
  from impersonation i
  join staff_user st on st.id = i.staff_user_id
  join partner p on p.id = i.partner_id
  join store s on s.id = i.store_id
  left join plan pl on pl.id = s.plan_id
  join membership m on m.id = i.membership_id
  left join seller se on se.id = m.seller_id
  join "user" u on u.id = m.user_id
`

/** The session a staff cookie on this partner's host belongs to, open or not, so the portal can say how it ended. */
export const selectStoreStaffSession = async (tx: ScopedSql, partnerId: string, portalHash: string): Promise<StoreStaffRow | null> =>
  (await tx<StoreStaffRow[]>`${storeSessions(tx)} where i.portal_session_hash = ${portalHash} and i.partner_id = ${partnerId} and i.target_kind = 'person'`)[0] ?? null

/** The newest open impersonation in a store, for the notice its own people see (ACCESS.md §8.1 "Visible"). */
export const selectOpenStoreImpersonation = async (tx: ScopedSql, storeId: string, now: Date): Promise<StoreStaffRow | null> =>
  (await tx<StoreStaffRow[]>`${storeSessions(tx)} where i.store_id = ${storeId} and i.ended_at is null and i.expires_at > ${now} order by i.started_at desc limit 1`)[0] ?? null
