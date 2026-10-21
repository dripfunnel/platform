import type { KeysetPage } from './activity'
import { maxPageSize, pgArray, type ScopedSql } from './index'
import { likePattern } from './stores'

// Staff sessions on the Admin API (ACCESS.md §8.1–§8.3; card #40): who staff may act as, the
// impersonation rows, and one list over impersonations and setup sessions. Platform scope.

export type TargetKind = 'partnerUser' | 'storeUser' | 'supplierUser'

export interface TargetMembership {
  id: string
  level: 'partner' | 'store'
  partnerId: string
  partnerName: string
  storeId?: string
  storeName?: string
  role: string
  supplier?: string | null
}

export interface TargetRow {
  source: 'partner_user' | 'person'
  id: string
  name: string
  email: string
  kind: TargetKind
  status: string
  last_sign_in_at: Date | null
  created_at: Date
  partner_id: string
  partner_state: string
  memberships: TargetMembership[]
}

export interface TargetFilter {
  kind?: TargetKind | undefined
  partnerId?: string | undefined
  storeId?: string | undefined
  role?: string | undefined
  status?: string | undefined
  search?: string | undefined
}

// Partner users and merchant or supplier people: never staff, never a shopper (ACCESS.md §8.1).
const targets = (tx: ScopedSql) => tx`
  select * from (
    select 'partner_user' as source, u.id, u.name, u.email, 'partnerUser' as kind, u.status, u.last_sign_in_at,
      date_trunc('milliseconds', u.created_at) as created_at, u.partner_id, p.state as partner_state,
      json_build_array(json_build_object('id', u.id, 'level', 'partner', 'partnerId', p.id, 'partnerName', p.name, 'role', u.role_key)) as memberships
    from partner_user u join partner p on p.id = u.partner_id
    where u.status <> 'removed'
    union all
    select 'person', u.id, u.name, u.email,
      case when exists (select 1 from membership m where m.user_id = u.id and m.seller_id is null) then 'storeUser' else 'supplierUser' end,
      u.status, u.last_sign_in_at, date_trunc('milliseconds', u.created_at), u.partner_id, p.state,
      coalesce((
        select json_agg(json_build_object('id', m.id, 'level', 'store', 'partnerId', p.id, 'partnerName', p.name, 'storeId', s.id, 'storeName', s.name, 'role', m.role_key, 'supplier', sl.name) order by s.name)
        from membership m join store s on s.id = m.store_id left join seller sl on sl.id = m.seller_id where m.user_id = u.id
      ), '[]'::json)
    from "user" u join partner p on p.id = u.partner_id
    where u.status <> 'deleted' and exists (select 1 from membership m where m.user_id = u.id)
  ) t
`

/** Oldest first by (created_at, id), one more row than asked; `before` reads backwards and is flipped. */
export const selectTargets = async (tx: ScopedSql, f: TargetFilter, page: KeysetPage, limit: number): Promise<TargetRow[]> => {
  const backwards = page.before !== undefined
  const like = f.search ? likePattern(f.search) : null
  const rows = await tx<TargetRow[]>`
    ${targets(tx)}
    where true
      ${f.kind !== undefined ? tx`and t.kind = ${f.kind}` : tx``}
      ${f.partnerId !== undefined ? tx`and t.partner_id = ${f.partnerId}` : tx``}
      ${f.status !== undefined ? tx`and t.status = ${f.status}` : tx``}
      ${f.storeId !== undefined ? tx`and exists (select 1 from json_array_elements(t.memberships) e where e->>'storeId' = ${f.storeId})` : tx``}
      ${f.role !== undefined ? tx`and exists (select 1 from json_array_elements(t.memberships) e where e->>'role' = ${f.role})` : tx``}
      ${like ? tx`and (t.name ilike ${like} or t.email ilike ${like})` : tx``}
      ${page.after !== undefined ? tx`and (t.created_at, t.id) > (${page.after.occurredAt}, ${page.after.id}::uuid)` : tx``}
      ${page.before !== undefined ? tx`and (t.created_at, t.id) < (${page.before.occurredAt}, ${page.before.id}::uuid)` : tx``}
    ${backwards ? tx`order by t.created_at desc, t.id desc` : tx`order by t.created_at asc, t.id asc`}
    limit ${limit + 1}
  `
  return backwards ? rows.reverse() : rows
}

export interface MembershipTarget {
  target_kind: 'partner_user' | 'person'
  target_id: string
  membership_id: string | null
  name: string
  email: string
  role: string
  seller_id: string | null
  partner_id: string
  partner_state: string
  store_id: string | null
  /** The person and, for a store user, the membership, both active. */
  active: boolean
}

/** Who a membership id names: a partner user (their id is the partner-level membership) or a store membership. */
export const selectMembershipTarget = async (tx: ScopedSql, membershipId: string): Promise<MembershipTarget | null> =>
  (
    await tx<MembershipTarget[]>`
      select 'partner_user' as target_kind, u.id as target_id, null::uuid as membership_id, u.name, u.email, u.role_key as role, null::uuid as seller_id,
        u.partner_id, p.state as partner_state, null::uuid as store_id, u.status = 'active' as active
      from partner_user u join partner p on p.id = u.partner_id where u.id = ${membershipId} and u.status <> 'removed'
      union all
      select 'person', u.id, m.id, u.name, u.email, m.role_key, m.seller_id, s.partner_id, p.state, m.store_id, u.status = 'active' and m.status = 'active'
      from membership m join "user" u on u.id = m.user_id join store s on s.id = m.store_id join partner p on p.id = s.partner_id
      where m.id = ${membershipId} and u.status <> 'deleted'
    `
  )[0] ?? null

export interface NewImpersonation {
  staffUserId: string
  targetKind: 'partner_user' | 'person'
  targetId: string
  membershipId: string | null
  partnerId: string
  storeId: string | null
  reason: string
  ticket: string | null
  startedAt: Date
  expiresAt: Date
  handoffHash: string
  handoffExpiresAt: Date
}

/** The new impersonation's id, or null when the staff member already has one open (the partial unique index). */
export const insertImpersonation = async (tx: ScopedSql, i: NewImpersonation): Promise<string | null> => {
  try {
    const rows = await tx.savepoint(
      (sp) => sp<{ id: string }[]>`
        insert into impersonation (staff_user_id, target_kind, target_id, membership_id, partner_id, store_id, reason, ticket, started_at, expires_at, handoff_hash, handoff_expires_at)
        values (${i.staffUserId}, ${i.targetKind}, ${i.targetId}, ${i.membershipId}, ${i.partnerId}, ${i.storeId}, ${i.reason}, ${i.ticket}, ${i.startedAt}, ${i.expiresAt}, ${i.handoffHash}, ${i.handoffExpiresAt})
        returning id
      `,
    )
    return rows[0]?.id ?? null
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') return null
    throw error
  }
}

/** Closes the staff member's impersonations that ran out without being ended, at the moment they ran out. */
export const expireStaleImpersonations = async (tx: ScopedSql, staffUserId: string, now: Date): Promise<void> => {
  await tx`
    update impersonation set ended_at = expires_at, end_reason = 'expired', handoff_hash = null
    where staff_user_id = ${staffUserId} and ended_at is null and expires_at <= ${now}
  `
}

/** Locks the session's row, whichever kind it is: an extension, a return and an end can't cross. */
export const lockStaffSession = async (tx: ScopedSql, id: string): Promise<void> => {
  await tx`select 1 from impersonation where id = ${id} for update`
  await tx`select 1 from partner_setup_session where id = ${id} for update`
}

/** The one extension: refused at the row if it was already taken (DATA-MODEL §3.5). */
export const extendImpersonation = async (tx: ScopedSql, id: string, byMs: number, at: Date): Promise<boolean> =>
  (await tx`update impersonation set extended_at = ${at}, expires_at = expires_at + ${`${byMs / 1000} seconds`}::interval where id = ${id} and extended_at is null and ended_at is null`).count > 0

export const endImpersonation = async (tx: ScopedSql, id: string, by: string, at: Date): Promise<boolean> =>
  (await tx`update impersonation set ended_at = ${at}, ended_by = ${by}, end_reason = 'staff', handoff_hash = null where id = ${id} and ended_at is null`).count > 0

/** A fresh link for a session still open (either kind): the previous one stops working (ACCESS.md §8.3). */
export const reissueHandoff = async (tx: ScopedSql, kind: 'impersonation' | 'setup', id: string, hash: string, expiresAt: Date, now: Date): Promise<boolean> =>
  (kind === 'impersonation'
    ? await tx`update impersonation set handoff_hash = ${hash}, handoff_expires_at = ${expiresAt}, handoff_used_at = null where id = ${id} and ended_at is null and expires_at > ${now}`
    : await tx`update partner_setup_session set handoff_hash = ${hash}, handoff_expires_at = ${expiresAt}, handoff_used_at = null where id = ${id} and ended_at is null and expires_at > ${now}`
  ).count > 0

export interface StaffSessionRow {
  kind: 'impersonation' | 'setup'
  id: string
  staff_user_id: string
  staff_name: string
  target_kind: 'partner_user' | 'person' | null
  target_id: string | null
  target_name: string | null
  membership_id: string | null
  membership_role: string | null
  supplier: string | null
  partner_id: string
  partner_name: string
  store_id: string | null
  store_name: string | null
  reason: string
  ticket: string | null
  started_at: Date
  expires_at: Date
  extended_at: Date | null
  ended_at: Date | null
  ended_by: string | null
  end_reason: string | null
}

// Both kinds as one row shape; a setup session has no target, membership or store.
const sessions = (tx: ScopedSql) => tx`
  select * from (
    select 'impersonation' as kind, i.id, i.staff_user_id, st.name as staff_name, i.target_kind, i.target_id,
      coalesce(pu.name, pe.name) as target_name, i.membership_id, coalesce(m.role_key, pu.role_key) as membership_role, sl.name as supplier,
      i.partner_id, p.name as partner_name, i.store_id, s.name as store_name, i.reason, i.ticket, i.started_at, i.expires_at,
      i.extended_at, i.ended_at, i.ended_by, i.end_reason
    from impersonation i join staff_user st on st.id = i.staff_user_id join partner p on p.id = i.partner_id
    left join store s on s.id = i.store_id
    left join partner_user pu on i.target_kind = 'partner_user' and pu.id = i.target_id
    left join "user" pe on i.target_kind = 'person' and pe.id = i.target_id
    left join membership m on m.id = i.membership_id left join seller sl on sl.id = m.seller_id
    union all
    select 'setup', ss.id, ss.staff_user_id, st.name, null, null, null, null, null, null, ss.partner_id, p.name, null, null, ss.reason, ss.ticket,
      date_trunc('milliseconds', ss.started_at), date_trunc('milliseconds', ss.expires_at), null, ss.ended_at, ss.ended_by_staff_id,
      coalesce(ss.end_reason, case when ss.ended_at is null then null when ss.ended_by_staff_id is null then 'expired' else 'staff' end)
    from partner_setup_session ss join staff_user st on st.id = ss.staff_user_id join partner p on p.id = ss.partner_id
  ) x
`

export interface SessionFilter {
  kind?: 'impersonation' | 'setup' | undefined
  staffId?: string | undefined
  partnerId?: string | undefined
  storeId?: string | undefined
  since?: Date | undefined
  /** A Partner manager sees setup sessions of their assigned partners only (ACCESS.md §8.3). */
  assignedTo?: string | undefined
}

const sessionWhere = (tx: ScopedSql, f: SessionFilter) => tx`
  ${f.kind !== undefined ? tx`and x.kind = ${f.kind}` : tx``}
  ${f.staffId !== undefined ? tx`and x.staff_user_id = ${f.staffId}` : tx``}
  ${f.partnerId !== undefined ? tx`and x.partner_id = ${f.partnerId}` : tx``}
  ${f.storeId !== undefined ? tx`and x.store_id = ${f.storeId}` : tx``}
  ${f.since !== undefined ? tx`and x.started_at >= ${f.since}` : tx``}
  ${f.assignedTo !== undefined ? tx`and x.partner_id in (select partner_id from staff_partner_assignment a where a.staff_user_id = ${f.assignedTo} and a.removed_at is null)` : tx``}
`

/** Every open session (neither ended nor past its time), newest first, capped like every list. */
export const selectOpenSessions = (tx: ScopedSql, f: SessionFilter, now: Date): Promise<StaffSessionRow[]> =>
  tx<StaffSessionRow[]>`${sessions(tx)} where x.ended_at is null and x.expires_at > ${now} ${sessionWhere(tx, f)} order by x.started_at desc, x.id desc limit ${maxPageSize}`

/** Ended or expired sessions, newest first by (started_at, id). */
export const selectSessionHistory = async (tx: ScopedSql, f: SessionFilter, page: KeysetPage, limit: number, now: Date): Promise<StaffSessionRow[]> => {
  const backwards = page.before !== undefined
  const rows = await tx<StaffSessionRow[]>`
    ${sessions(tx)} where (x.ended_at is not null or x.expires_at <= ${now}) ${sessionWhere(tx, f)}
      ${page.after !== undefined ? tx`and (x.started_at, x.id) < (${page.after.occurredAt}, ${page.after.id}::uuid)` : tx``}
      ${page.before !== undefined ? tx`and (x.started_at, x.id) > (${page.before.occurredAt}, ${page.before.id}::uuid)` : tx``}
    ${backwards ? tx`order by x.started_at asc, x.id asc` : tx`order by x.started_at desc, x.id desc`}
    limit ${limit + 1}
  `
  return backwards ? rows.reverse() : rows
}

export const selectStaffSession = async (tx: ScopedSql, id: string): Promise<StaffSessionRow | null> =>
  (await tx<StaffSessionRow[]>`${sessions(tx)} where x.id = ${id}`)[0] ?? null

/** The partners' live portal hosts, where a store user is acted as (USERS-AND-DOMAINS §2). */
export const selectLivePortalHosts = async (tx: ScopedSql, partnerIds: readonly string[]): Promise<Map<string, string>> =>
  new Map(
    (partnerIds.length
      ? await tx<{ partner_id: string; host: string }[]>`select partner_id, host from partner_domain where kind = 'portal' and status = 'live' and partner_id = any(${pgArray(partnerIds)}::uuid[])`
      : []
    ).map((r) => [r.partner_id, r.host]),
  )

export const isAssignedPartner = async (tx: ScopedSql, staffId: string, partnerId: string): Promise<boolean> =>
  (await tx`select 1 from staff_partner_assignment where staff_user_id = ${staffId} and partner_id = ${partnerId} and removed_at is null`).length > 0
