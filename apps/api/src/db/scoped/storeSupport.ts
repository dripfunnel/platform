import type { Subscription } from '#core/tenancy'
import type { KeysetPage } from './activity'
import type { ScopedSql } from './index'

// The store's half of partner support sessions (ACCESS.md §8; #331). The exchange and the support
// caller run in system scope, since no caller is known until the cookie resolves; the merchant's
// switch, Allow/Deny and log run in its own store scope through 0160's definer functions.

/**
 * Spends a handoff once, on this partner's portal host, before its link expires and while a start
 * would still be allowed (ACCESS.md §8: support on, store not cancelled, user active), and keeps the
 * new cookie's hash on the session.
 */
export const spendSupportHandoff = async (tx: ScopedSql, partnerId: string, handoffHash: string, portalHash: string, now: Date): Promise<string | null> =>
  (
    await tx<{ id: string }[]>`
      update support_session ss set handoff_used_at = ${now}, handoff_hash = null, portal_session_hash = ${portalHash}
      where ss.handoff_hash = ${handoffHash} and ss.partner_id = ${partnerId} and ss.handoff_used_at is null
        and ss.handoff_expires_at > ${now} and ss.ended_at is null and ss.expires_at > ${now}
        and exists (
          select 1 from store s join membership m on m.store_id = s.id join "user" u on u.id = m.user_id
          where s.id = ss.store_id and m.id = ss.membership_id and s.support_access_allowed
            and s.status not in ('cancelled', 'closed') and m.status = 'active' and u.status = 'active'
        )
      returning ss.id
    `
  )[0]?.id ?? null

export interface SupportPortalRow {
  id: string
  partner_id: string
  partner_name: string
  partner_user_id: string
  agent_name: string
  store_id: string
  store_name: string
  store_status: Subscription | 'closed'
  support_access_allowed: boolean
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
  started_at: Date
  expires_at: Date
  ended_at: Date | null
  ended_by_partner_user_id: string | null
  end_reason: string | null
  access: 'read' | 'write'
  write_requested_at: Date | null
  write_request_note: string | null
  write_decided_at: Date | null
}

/** The session a support cookie belongs to on this partner's host, open or not, so the portal can say how it ended. */
export const selectSupportPortalSession = async (tx: ScopedSql, partnerId: string, portalHash: string): Promise<SupportPortalRow | null> =>
  (
    await tx<SupportPortalRow[]>`
      select ss.id, ss.partner_id, p.name as partner_name, ss.partner_user_id, pu.name as agent_name,
        s.id as store_id, s.name as store_name, s.status as store_status, s.support_access_allowed, s.plan_id, pl.name as plan_name,
        m.id as membership_id, m.status as membership_status, m.role_key, m.seller_id, se.name as seller_name, se.status as seller_status, se.access_level,
        u.id as user_id, u.name as user_name, u.email as user_email, u.status as user_status,
        ss.started_at, ss.expires_at, ss.ended_at, ss.ended_by_partner_user_id, ss.end_reason, ss.access,
        ss.write_requested_at, ss.write_request_note, ss.write_decided_at
      from support_session ss
      join partner p on p.id = ss.partner_id
      join partner_user pu on pu.id = ss.partner_user_id
      join store s on s.id = ss.store_id
      left join plan pl on pl.id = s.plan_id
      join membership m on m.id = ss.membership_id
      left join seller se on se.id = m.seller_id
      join "user" u on u.id = m.user_id
      where ss.portal_session_hash = ${portalHash} and ss.partner_id = ${partnerId}
    `
  )[0] ?? null

export type SupportEnd = 'support_off' | 'target_gone' | 'store_closed'

/** Ends a session the store side can no longer host: support switched off, its user or seat gone, or the store closed (ACCESS.md §8). */
export const endGoneSupportSession = async (tx: ScopedSql, id: string, reason: SupportEnd, now: Date): Promise<boolean> =>
  (await tx`update support_session set ended_at = ${now}, end_reason = ${reason}, handoff_hash = null where id = ${id} and ended_at is null`).count > 0

/** The agent's "End now" in the portal's bar: ended by the agent, as from the partner console. */
export const endSupportFromPortal = async (tx: ScopedSql, id: string, agentId: string, now: Date): Promise<boolean> =>
  (await tx`update support_session set ended_at = ${now}, ended_by_partner_user_id = ${agentId}, handoff_hash = null where id = ${id} and ended_at is null and expires_at > ${now}`).count > 0

export type WriteRequestOutcome = 'asked' | 'pending' | 'allowed' | 'closed'

/** The agent asks for writes: one open request at a time, again after a Deny, never once allowed. */
export const requestSupportWrite = async (tx: ScopedSql, id: string, note: string, now: Date): Promise<WriteRequestOutcome> => {
  const rows = await tx<{ id: string }[]>`
    update support_session set write_requested_at = ${now}, write_request_note = ${note}, write_decided_at = null, write_decided_by_user_id = null
    where id = ${id} and ended_at is null and expires_at > ${now} and access = 'read'
      and (write_requested_at is null or write_decided_at is not null)
    returning id
  `
  if (rows[0]) return 'asked'
  const [row] = await tx<{ access: string; open: boolean }[]>`select access, ended_at is null and expires_at > ${now} as open from support_session where id = ${id}`
  if (!row?.open) return 'closed'
  return row.access === 'write' ? 'allowed' : 'pending'
}

export interface EndedSupportRow {
  session_id: string
  membership_id: string
  partner_user_id: string
}

/** Settings › Support access (0160): Off ends every open session on the store and returns them. */
export const setStoreSupportAccess = (tx: ScopedSql, allowed: boolean, now: Date): Promise<EndedSupportRow[]> =>
  tx<EndedSupportRow[]>`select session_id, membership_id, partner_user_id from set_store_support_access(${allowed}, ${now})`

/** Allow or Deny the open request (0160); null when there was none to answer. */
export const decideSupportWrite = async (tx: ScopedSql, sessionId: string, allow: boolean, now: Date): Promise<EndedSupportRow | null> =>
  (await tx<EndedSupportRow[]>`select session_id, membership_id, partner_user_id from decide_support_write(${sessionId}, ${allow}, ${now})`)[0] ?? null

export const selectSupportAllowed = async (tx: ScopedSql, storeId: string): Promise<boolean> =>
  (await tx<{ support_access_allowed: boolean }[]>`select support_access_allowed from store where id = ${storeId}`)[0]?.support_access_allowed ?? false

export interface StoreSupportRow {
  id: string
  partner_name: string
  agent_id: string
  agent_name: string
  user_name: string
  role_key: string
  seller_name: string | null
  reason: string
  ticket: string | null
  started_at: Date
  expires_at: Date
  ended_at: Date | null
  ended_by_partner_user_id: string | null
  ended_by_agent_name: string | null
  end_reason: string | null
  ended_by_user_name: string | null
  access: 'read' | 'write'
  write_requested_at: Date | null
  write_request_note: string | null
  write_decided_at: Date | null
  write_decided_by_name: string | null
}

/** The acting store's sessions since `since`, newest first by `(started_at, id)`, through 0160's `store_support_sessions`. */
export const selectStoreSupportSessions = (tx: ScopedSql, since: Date, page: KeysetPage, limit: number): Promise<StoreSupportRow[]> =>
  tx<StoreSupportRow[]>`
    select * from store_support_sessions(null, ${since}, ${page.after?.occurredAt ?? null}, ${page.after?.id ?? null}, ${page.before?.occurredAt ?? null}, ${page.before?.id ?? null}, ${limit + 1})
  `

/** The acting store's open session, for the banner every merchant-side person sees (ACCESS.md §8). */
export const selectOpenStoreSupportSession = async (tx: ScopedSql, now: Date): Promise<StoreSupportRow | null> =>
  (await tx<StoreSupportRow[]>`select * from store_support_sessions(${now}, null, null, null, null, null, 1)`)[0] ?? null

export interface SupportEmailRow {
  partner_id: string
  store_id: string
  partner_name: string
  agent_name: string
  user_name: string
  reason: string
  ticket: string | null
  decided_by_name: string | null
}

/** What the Owners' emails about a session say (ACCESS.md §8), read in system scope by the deliverer. */
export const selectSupportEmail = async (tx: ScopedSql, id: string): Promise<SupportEmailRow | null> =>
  (
    await tx<SupportEmailRow[]>`
      select ss.partner_id, ss.store_id, p.name as partner_name, pu.name as agent_name, u.name as user_name, ss.reason, ss.ticket, d.name as decided_by_name
      from support_session ss
      join partner p on p.id = ss.partner_id
      join partner_user pu on pu.id = ss.partner_user_id
      join membership m on m.id = ss.membership_id
      join "user" u on u.id = m.user_id
      left join "user" d on d.id = ss.write_decided_by_user_id
      where ss.id = ${id}
    `
  )[0] ?? null
