import type { KeysetPage } from './activity'
import type { ScopedSql } from './index'

// Partner support sessions (ACCESS.md §8, ui/platform/FIRST-RELEASE.md §12; card #202).

export interface SupportTargetRow {
  membership_id: string
  user_id: string
  name: string
  email: string
  user_status: 'invited' | 'active' | 'suspended'
  membership_status: 'invited' | 'active' | 'suspended'
  role_key: string
  store_id: string
  store_name: string
  store_status: string
  support_access_allowed: boolean
  seller_name: string | null
  last_sign_in_at: Date | null
  created_at: Date
  open_session_id: string | null
  open_agent_id: string | null
  open_agent_name: string | null
  open_expires_at: Date | null
  store_owner: string | null
}

// membership keeps microseconds; the cursor carries milliseconds, so both sides are cut to them.
const memberKey = (tx: ScopedSql) => tx`date_trunc('milliseconds', m.created_at)`

/** The store and supplier users of the partner's stores, never a deleted person; `now` decides which sessions are open. */
export const selectSupportTargets = async (tx: ScopedSql, partnerId: string, search: string | null, page: KeysetPage, limit: number, now: Date): Promise<SupportTargetRow[]> => {
  const backwards = page.before !== undefined
  const like = search ? `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null
  const rows = await tx<SupportTargetRow[]>`
    select m.id as membership_id, u.id as user_id, u.name, u.email, u.status as user_status, m.status as membership_status,
      m.role_key, s.id as store_id, s.name as store_name, s.status as store_status, s.support_access_allowed,
      sl.name as seller_name, u.last_sign_in_at, ${memberKey(tx)} as created_at,
      o.id as open_session_id, o.partner_user_id as open_agent_id, a.name as open_agent_name, o.expires_at as open_expires_at, own.name as store_owner
    from membership m
    join "user" u on u.id = m.user_id
    join store s on s.id = m.store_id
    left join seller sl on sl.id = m.seller_id
    left join support_session o on o.membership_id = m.id and o.ended_at is null and o.expires_at > ${now}
    left join partner_user a on a.id = o.partner_user_id
    left join lateral (
      select ou.name from membership om join "user" ou on ou.id = om.user_id
      where om.store_id = s.id and om.seller_id is null and om.role_key = 'owner' order by om.created_at limit 1
    ) own on not s.support_access_allowed
    where s.partner_id = ${partnerId} and u.status <> 'deleted'
      ${like ? tx`and (u.name ilike ${like} or u.email ilike ${like} or s.name ilike ${like})` : tx``}
      ${page.after !== undefined ? tx`and (${memberKey(tx)}, m.id) > (${page.after.occurredAt}, ${page.after.id}::uuid)` : tx``}
      ${page.before !== undefined ? tx`and (${memberKey(tx)}, m.id) < (${page.before.occurredAt}, ${page.before.id}::uuid)` : tx``}
    ${backwards ? tx`order by ${memberKey(tx)} desc, m.id desc` : tx`order by ${memberKey(tx)} asc, m.id asc`}
    limit ${limit + 1}
  `
  return backwards ? rows.reverse() : rows
}

export const selectSupportTarget = async (tx: ScopedSql, partnerId: string, membershipId: string, now: Date): Promise<SupportTargetRow | null> =>
  (
    await tx<SupportTargetRow[]>`
      select m.id as membership_id, u.id as user_id, u.name, u.email, u.status as user_status, m.status as membership_status,
        m.role_key, s.id as store_id, s.name as store_name, s.status as store_status, s.support_access_allowed,
        sl.name as seller_name, u.last_sign_in_at, m.created_at,
        o.id as open_session_id, o.partner_user_id as open_agent_id, a.name as open_agent_name, o.expires_at as open_expires_at, own.name as store_owner
      from membership m
      join "user" u on u.id = m.user_id
      join store s on s.id = m.store_id
      left join seller sl on sl.id = m.seller_id
      left join support_session o on o.membership_id = m.id and o.ended_at is null and o.expires_at > ${now}
      left join partner_user a on a.id = o.partner_user_id
      left join lateral (
        select ou.name from membership om join "user" ou on ou.id = om.user_id
        where om.store_id = s.id and om.seller_id is null and om.role_key = 'owner' order by om.created_at limit 1
      ) own on not s.support_access_allowed
      where s.partner_id = ${partnerId} and m.id = ${membershipId} and u.status <> 'deleted'
    `
  )[0] ?? null

/** Sessions that ran out without being ended are closed at the moment they ran out, so the open indexes free up. */
export const expireStaleSupportSessions = async (tx: ScopedSql, by: { partnerUserId: string; membershipId: string | null }, now: Date): Promise<void> => {
  await tx`
    update support_session set ended_at = expires_at, handoff_hash = null
    where ended_at is null and expires_at <= ${now}
      and (partner_user_id = ${by.partnerUserId} ${by.membershipId ? tx`or membership_id = ${by.membershipId}` : tx``})
  `
}

/** The caller's proof from `reauthenticate`, spent here: true once (0024's `spend_partner_reauth`). */
export const spendReauthProof = async (tx: ScopedSql, proofHash: string, now: Date): Promise<boolean> =>
  (await tx<{ spent: boolean }[]>`select spend_partner_reauth(${proofHash}, ${now}) as spent`)[0]?.spent ?? false

export interface NewSupportSession {
  partnerId: string
  storeId: string
  membershipId: string
  partnerUserId: string
  reason: string
  ticket: string | null
  startedAt: Date
  expiresAt: Date
  handoffHash: string
  handoffExpiresAt: Date
}

export type InsertOutcome = { ok: true; id: string } | { ok: false; refused: 'proof' | 'agent' | 'target' }

class ProofNotSpent extends Error {}

/**
 * Spends the caller's re-authentication proof and inserts the session as one savepoint: a race
 * lost to the open indexes rolls the spend back too, so the proof survives a refusal.
 */
export const insertSupportSession = async (tx: ScopedSql, proofHash: string, s: NewSupportSession): Promise<InsertOutcome> => {
  try {
    const id = await tx.savepoint(async (sp) => {
      if (!(await spendReauthProof(sp, proofHash, s.startedAt))) throw new ProofNotSpent()
      const rows = await sp<{ id: string }[]>`
        insert into support_session (partner_id, store_id, membership_id, partner_user_id, reason, ticket, started_at, expires_at, handoff_hash, handoff_expires_at)
        values (${s.partnerId}, ${s.storeId}, ${s.membershipId}, ${s.partnerUserId}, ${s.reason}, ${s.ticket}, ${s.startedAt}, ${s.expiresAt}, ${s.handoffHash}, ${s.handoffExpiresAt})
        returning id
      `
      const row = rows[0]
      if (!row) throw new Error('support_session: insert returned no row')
      return row.id
    })
    return { ok: true, id }
  } catch (error) {
    if (error instanceof ProofNotSpent) return { ok: false, refused: 'proof' }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      const constraint = 'constraint_name' in error ? error.constraint_name : null
      return { ok: false, refused: constraint === 'support_session_target_open_key' ? 'target' : 'agent' }
    }
    throw error
  }
}

export interface SupportSessionRow {
  id: string
  store_id: string
  store_name: string
  membership_id: string
  user_id: string
  user_name: string
  role_key: string
  seller_name: string | null
  partner_user_id: string
  agent_name: string
  reason: string
  ticket: string | null
  started_at: Date
  expires_at: Date
  ended_at: Date | null
  ended_by_partner_user_id: string | null
  ended_by_name: string | null
  /** Set when the store side ended it (0160): support switched off, its user gone or the store closed. */
  end_reason: string | null
}

const sessionColumns = (tx: ScopedSql) => tx`
  select ss.id, ss.store_id, s.name as store_name, ss.membership_id, u.id as user_id, u.name as user_name, m.role_key, sl.name as seller_name,
    ss.partner_user_id, a.name as agent_name, ss.reason, ss.ticket, ss.started_at, ss.expires_at, ss.ended_at,
    ss.ended_by_partner_user_id, e.name as ended_by_name, ss.end_reason
  from support_session ss
  join store s on s.id = ss.store_id
  join membership m on m.id = ss.membership_id
  join "user" u on u.id = m.user_id
  left join seller sl on sl.id = m.seller_id
  join partner_user a on a.id = ss.partner_user_id
  left join partner_user e on e.id = ss.ended_by_partner_user_id
`

export const selectSupportSession = async (tx: ScopedSql, partnerId: string, id: string): Promise<SupportSessionRow | null> =>
  (await tx<SupportSessionRow[]>`${sessionColumns(tx)} where ss.partner_id = ${partnerId} and ss.id = ${id}`)[0] ?? null

/** The row for update, so an end and a return on one session cannot cross. */
export const lockSupportSession = async (tx: ScopedSql, partnerId: string, id: string): Promise<boolean> =>
  (await tx`select 1 from support_session where partner_id = ${partnerId} and id = ${id} for update`).length > 0

export const selectOpenSupportSessionOf = async (tx: ScopedSql, partnerId: string, partnerUserId: string, now: Date): Promise<SupportSessionRow | null> =>
  (await tx<SupportSessionRow[]>`
    ${sessionColumns(tx)} where ss.partner_id = ${partnerId} and ss.partner_user_id = ${partnerUserId} and ss.ended_at is null and ss.expires_at > ${now}
  `)[0] ?? null

/** Open now (not ended, not past its time) or history, newest first, by `(started_at, id)`. */
export const selectSupportSessions = async (tx: ScopedSql, partnerId: string, open: boolean, page: KeysetPage, limit: number, now: Date): Promise<SupportSessionRow[]> => {
  const backwards = page.before !== undefined
  const rows = await tx<SupportSessionRow[]>`
    ${sessionColumns(tx)}
    where ss.partner_id = ${partnerId}
      and ${open ? tx`ss.ended_at is null and ss.expires_at > ${now}` : tx`(ss.ended_at is not null or ss.expires_at <= ${now})`}
      ${page.after !== undefined ? tx`and (ss.started_at, ss.id) < (${page.after.occurredAt}, ${page.after.id}::uuid)` : tx``}
      ${page.before !== undefined ? tx`and (ss.started_at, ss.id) > (${page.before.occurredAt}, ${page.before.id}::uuid)` : tx``}
    ${backwards ? tx`order by ss.started_at asc, ss.id asc` : tx`order by ss.started_at desc, ss.id desc`}
    limit ${limit + 1}
  `
  return backwards ? rows.reverse() : rows
}

export const endSupportSession = async (tx: ScopedSql, id: string, endedBy: string, now: Date): Promise<boolean> =>
  (await tx`update support_session set ended_at = ${now}, ended_by_partner_user_id = ${endedBy}, handoff_hash = null where id = ${id} and ended_at is null`).count > 0

/** A fresh link for an open session: the previous one stops working (ACCESS.md §8.3). */
export const reissueSupportHandoff = async (tx: ScopedSql, id: string, handoffHash: string, handoffExpiresAt: Date): Promise<void> => {
  await tx`update support_session set handoff_hash = ${handoffHash}, handoff_expires_at = ${handoffExpiresAt}, handoff_used_at = null where id = ${id}`
}

/** The partner's live portal host, where the store's portal opens (USERS-AND-DOMAINS.md §2). */
export const selectLivePortalHost = async (tx: ScopedSql, partnerId: string): Promise<string | null> =>
  (await tx<{ host: string }[]>`select host from partner_domain where partner_id = ${partnerId} and kind = 'portal' and status = 'live'`)[0]?.host ?? null
