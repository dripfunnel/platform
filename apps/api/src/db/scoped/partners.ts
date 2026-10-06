import type { Keyset } from '#core/cursor'
import { likePattern } from './stores'
import type {
  AgentKind,
  DomainKind,
  HostStatus,
  PartnerDomainRow,
  PartnerInvitationRow,
  PartnerRole,
  PartnerRow,
  PartnerSetupItemRow,
  PartnerState,
  PartnerUserRow,
  PlanRow,
  PlanStatus,
  PoweredBy,
  SetupItem,
} from '../schema/saas'
import { writeVersionRows, type Entitlements, type PlanVersionPrice } from './plans'
import { maxPageSize, pageLimit, pgArray, type ScopedSql } from './index'

const one = <T extends { id: string }>(rows: T[], table: string): string => {
  const row = rows[0]
  if (!row) throw new Error(`${table} insert returned no row`)
  return row.id
}

export interface NewPartner {
  name: string
  isHouse?: boolean
  kind?: string | null
  region?: string | null
  country?: string | null
  state?: PartnerState
  productName?: string | null
  primaryColor?: string | null
  accentColor?: string | null
  poweredBy?: PoweredBy
  fallbackSenderAccepted?: boolean
  createdAt?: Date
}

export const insertPartner = async (tx: ScopedSql, p: NewPartner): Promise<string> =>
  one(
    await tx<{ id: string }[]>`
      insert into partner (name, is_house, kind, region, country, state, product_name, primary_color, accent_color, powered_by, fallback_sender_accepted, created_at)
      values (${p.name}, ${p.isHouse ?? false}, ${p.kind ?? null}, ${p.region ?? null}, ${p.country ?? null}, ${p.state ?? 'draft'},
              ${p.productName ?? null}, ${p.primaryColor ?? null}, ${p.accentColor ?? null}, ${p.poweredBy ?? 'on'}, ${p.fallbackSenderAccepted ?? false}, ${p.createdAt ?? new Date()})
      returning id
    `,
    'partner',
  )

/** A new draft partner, or null when a partner that isn't closed already has the name (0031). */
export const insertNamedPartner = async (tx: ScopedSql, p: NewPartner): Promise<string | null> => {
  try {
    return await tx.savepoint((sp) => insertPartner(sp, p))
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') return null
    throw error
  }
}

/** The columns a state change writes (saas/partners/states.ts decides which). */
export interface PartnerStatePatch {
  state: PartnerState
  submittedAt?: Date | null
  submittedByKind?: AgentKind | null
  submittedByLabel?: string | null
  sentBackReason?: string | null
  approvedAt?: Date | null
  pausedAt?: Date | null
  pauseReason?: string | null
}

export const updatePartnerState = async (tx: ScopedSql, id: string, patch: PartnerStatePatch): Promise<boolean> => {
  const rows = await tx<{ id: string }[]>`
    update partner set
      state = ${patch.state},
      submitted_at = ${patch.submittedAt === undefined ? tx`submitted_at` : patch.submittedAt},
      submitted_by_kind = ${patch.submittedByKind === undefined ? tx`submitted_by_kind` : patch.submittedByKind},
      submitted_by_label = ${patch.submittedByLabel === undefined ? tx`submitted_by_label` : patch.submittedByLabel},
      sent_back_reason = ${patch.sentBackReason === undefined ? tx`sent_back_reason` : patch.sentBackReason},
      approved_at = ${patch.approvedAt === undefined ? tx`approved_at` : patch.approvedAt},
      paused_at = ${patch.pausedAt === undefined ? tx`paused_at` : patch.pausedAt},
      pause_reason = ${patch.pauseReason === undefined ? tx`pause_reason` : patch.pauseReason}
    where id = ${id}
    returning id
  `
  return rows.length > 0
}

export interface NewPartnerUser {
  partnerId: string
  email: string
  name: string
  role: PartnerRole
  status: PartnerUserRow['status']
  lastSignInAt?: Date | null
}

export const insertPartnerUser = async (tx: ScopedSql, u: NewPartnerUser): Promise<string> =>
  one(
    await tx<{ id: string }[]>`
      insert into partner_user (partner_id, email, name, role_key, status, last_sign_in_at)
      values (${u.partnerId}, ${u.email}, ${u.name}, ${u.role}, ${u.status}, ${u.lastSignInAt ?? null})
      returning id
    `,
    'partner_user',
  )

export interface NewPartnerInvitation {
  partnerId: string
  partnerUserId: string
  tokenHash?: string | null
  expiresAt?: Date | null
  /** Null holds the invitation (FIRST-RELEASE §4.3). */
  sentAt: Date | null
  invitedByKind: AgentKind
  invitedByLabel: string
  acceptedAt?: Date | null
}

export const insertPartnerInvitation = async (tx: ScopedSql, i: NewPartnerInvitation): Promise<string> =>
  one(
    await tx<{ id: string }[]>`
      insert into partner_invitation (partner_id, partner_user_id, token_hash, expires_at, sent_at, invited_by_kind, invited_by_label, accepted_at)
      values (${i.partnerId}, ${i.partnerUserId}, ${i.tokenHash ?? null}, ${i.expiresAt ?? null}, ${i.sentAt}, ${i.invitedByKind}, ${i.invitedByLabel}, ${i.acceptedAt ?? null})
      returning id
    `,
    'partner_invitation',
  )

export interface NewPartnerDomain {
  partnerId: string
  kind: DomainKind
  host: string
  status: HostStatus
  recordType: 'CNAME' | 'TXT' | 'A'
  expected: string
  found?: string | null
  checkedAt?: Date | null
}

export const upsertPartnerDomain = async (tx: ScopedSql, d: NewPartnerDomain): Promise<void> => {
  await tx`
    insert into partner_domain (partner_id, kind, host, status, record_type, expected, found, checked_at)
    values (${d.partnerId}, ${d.kind}, ${d.host}, ${d.status}, ${d.recordType}, ${d.expected}, ${d.found ?? null}, ${d.checkedAt ?? null})
    on conflict (partner_id, kind) do update set
      host = excluded.host, status = excluded.status, record_type = excluded.record_type,
      expected = excluded.expected, found = excluded.found, checked_at = excluded.checked_at
  `
}

export interface NewSetupItem {
  partnerId: string
  item: SetupItem
  status: PartnerSetupItemRow['status']
  detail?: string | null
  doneByKind?: AgentKind | null
  doneByLabel?: string | null
  doneAt?: Date | null
}

export const upsertSetupItem = async (tx: ScopedSql, s: NewSetupItem): Promise<void> => {
  await tx`
    insert into partner_setup_item (partner_id, item, status, detail, done_by_kind, done_by_label, done_at)
    values (${s.partnerId}, ${s.item}, ${s.status}, ${s.detail ?? null}, ${s.doneByKind ?? null}, ${s.doneByLabel ?? null}, ${s.doneAt ?? null})
    on conflict (partner_id, item) do update set
      status = excluded.status, detail = excluded.detail, done_by_kind = excluded.done_by_kind,
      done_by_label = excluded.done_by_label, done_at = excluded.done_at
  `
}

export interface NewPlan {
  partnerId: string
  name: string
  description?: string | null
  status?: PlanStatus
  trialDays?: number
  maxProducts?: number | null
  maxStaff?: number | null
  prices?: readonly PlanVersionPrice[]
  entitlements?: Entitlements | null
}

/** A plan, its first version (written by the table's trigger) and that version's prices and values (DATA-MODEL.md §2.3). */
export const insertPlan = async (tx: ScopedSql, p: NewPlan): Promise<string> => {
  const id = one(
    await tx<{ id: string }[]>`
      insert into plan (partner_id, name, description, status, trial_days, max_products, max_staff)
      values (${p.partnerId}, ${p.name}, ${p.description ?? null}, ${p.status ?? 'draft'}, ${p.trialDays ?? 14}, ${p.maxProducts ?? null}, ${p.maxStaff ?? null})
      returning id
    `,
    'plan',
  )
  await writeVersionRows(tx, {
    planId: id,
    partnerId: p.partnerId,
    version: 1,
    trialDays: p.trialDays ?? 14,
    prices: p.prices ?? [],
    entitlements: p.entitlements ?? null,
    by: { kind: 'system', label: 'Plan created' },
  })
  return id
}

export interface PartnerFilter {
  state?: PartnerState | undefined
  /** Whether every setup item is done (FIRST-RELEASE §4.1). */
  setup?: 'complete' | 'incomplete' | undefined
  /** Name, portal host or owner email. */
  q?: string | undefined
  /** A Partner manager's list is the partners assigned to them (ACCESS.md §5.4). */
  assignedTo?: string | undefined
}

/** Approvals asks for the oldest submitted first (FIRST-RELEASE §6); the list is newest first. */
export type PartnerSort = 'newest' | 'oldestSubmitted'

export interface KeysetPage {
  after?: Keyset | undefined
  before?: Keyset | undefined
}

/** FIRST-RELEASE §4.1's columns, one query. */
export interface PartnerListRow extends PartnerRow {
  store_count: number
  portal_host: string | null
  portal_status: HostStatus | null
  setup_done: number
  setup_total: number
  owner_name: string | null
  owner_email: string | null
  /** FIRST-RELEASE §4.1: the Owner's invitation, active once accepted, else sent or held. */
  owner_invitation: 'active' | 'sent' | 'held' | null
  owner_invitation_sent_at: Date | null
}

// Every reader's checklist rows for the partners `partner` matches (`= p.id`, `= any(...)`). Like the domain
// items, the plan item is the pricedPlan check itself (SAAS §3.2), never its stored row, and names nobody (#435).
const setupItems = (tx: ScopedSql, partner: ReturnType<ScopedSql>) => tx`
  select si.partner_id, si.item, si.status, si.detail, si.done_by_kind, si.done_by_label, si.done_at
  from partner_setup_item si where si.partner_id ${partner} and si.item not in ('testSignup', 'plan')
  union all
  select sp.id, 'plan', d.status, null, null, null, null
  from partner sp
  cross join lateral (
    select case
      when exists (
        select 1 from plan pl where pl.partner_id = sp.id and pl.status = 'live'
          and exists (select 1 from plan_price pp where pp.plan_id = pl.id and pp.version = pl.version and pp.monthly_amount is not null)
      ) then 'done'
      when exists (select 1 from plan pl where pl.partner_id = sp.id) then 'progress'
      else 'missing'
    end as status
  ) d
  where sp.id ${partner} and exists (select 1 from partner_setup_item sc where sc.partner_id = sp.id and sc.item <> 'testSignup')
`

// The list's projection, shared with the single-row read so the two can never disagree.
const listProjection = (tx: ScopedSql) => tx`
  select p.*,
    (select count(*)::int from store s where s.partner_id = p.id) as store_count,
    pd.host as portal_host, pd.status as portal_status,
    su.done as setup_done, su.total as setup_total,
    o.name as owner_name, o.email as owner_email,
    case
      when o.id is null then null
      when o.status = 'active' then 'active'
      when oi.sent_at is null then 'held'
      else 'sent'
    end as owner_invitation,
    oi.sent_at as owner_invitation_sent_at
  from partner p
  left join partner_domain pd on pd.partner_id = p.id and pd.kind = 'portal'
  cross join lateral (
    select count(*) filter (where i.status = 'done')::int as done, count(*)::int as total from (${setupItems(tx, tx`= p.id`)}) i
  ) su
  left join lateral (
    select u.id, u.name, u.email, u.status from partner_user u
    where u.partner_id = p.id and u.role_key = 'partner-owner' order by u.created_at limit 1
  ) o on true
  left join lateral (
    select pi.sent_at from partner_invitation pi
    where pi.partner_user_id = o.id and pi.revoked_at is null and pi.accepted_at is null order by pi.created_at desc limit 1
  ) oi on true
`

export const selectPartnerListRow = async (tx: ScopedSql, id: string): Promise<PartnerListRow | null> =>
  (await tx<PartnerListRow[]>`${listProjection(tx)} where p.id = ${id}`)[0] ?? null

export const selectPartners = async (tx: ScopedSql, filter: PartnerFilter, page: KeysetPage, limit: number, sort: PartnerSort = 'newest'): Promise<PartnerListRow[]> => {
  const backwards = page.before !== undefined
  const q = filter.q ? likePattern(filter.q) : null
  // `newest` orders by (created_at, id) descending; `oldestSubmitted` by (submitted_at, id) ascending.
  const key = sort === 'newest' ? tx`p.created_at` : tx`p.submitted_at`
  const forward = (sort === 'newest') !== backwards
  const rows = await tx<PartnerListRow[]>`
    ${listProjection(tx)}
    where true
      ${filter.state !== undefined ? tx`and p.state = ${filter.state}` : tx``}
      ${filter.assignedTo !== undefined ? tx`and exists (select 1 from staff_partner_assignment a where a.partner_id = p.id and a.staff_user_id = ${filter.assignedTo} and a.removed_at is null)` : tx``}
      ${filter.setup === 'complete' ? tx`and su.total > 0 and su.done = su.total` : tx``}
      ${filter.setup === 'incomplete' ? tx`and su.done < su.total` : tx``}
      ${q !== null ? tx`and (p.name ilike ${q} or pd.host ilike ${q} or o.email ilike ${q})` : tx``}
      ${sort === 'oldestSubmitted' ? tx`and p.submitted_at is not null` : tx``}
      ${page.after !== undefined ? (sort === 'newest' ? tx`and (${key}, p.id) < (${page.after.occurredAt}, ${page.after.id}::uuid)` : tx`and (${key}, p.id) > (${page.after.occurredAt}, ${page.after.id}::uuid)`) : tx``}
      ${page.before !== undefined ? (sort === 'newest' ? tx`and (${key}, p.id) > (${page.before.occurredAt}, ${page.before.id}::uuid)` : tx`and (${key}, p.id) < (${page.before.occurredAt}, ${page.before.id}::uuid)`) : tx``}
    ${forward ? tx`order by ${key} desc, p.id desc` : tx`order by ${key} asc, p.id asc`}
    limit ${pageLimit(limit) + 1}
  `
  return backwards ? rows.reverse() : rows
}

export const selectPartner = async (tx: ScopedSql, id: string): Promise<PartnerRow | null> =>
  (await tx<PartnerRow[]>`select * from partner where id = ${id}`)[0] ?? null

export const selectPartnerUsers = (tx: ScopedSql, partnerId: string): Promise<PartnerUserRow[]> =>
  tx<PartnerUserRow[]>`
    select id, partner_id, email, name, role_key, status, last_sign_in_at, created_at
    from partner_user where partner_id = ${partnerId} order by created_at limit ${maxPageSize}
  `




export const selectPlans = (tx: ScopedSql, partnerId: string): Promise<(PlanRow & { store_count: number })[]> =>
  tx<(PlanRow & { store_count: number })[]>`
    select pl.*, (select count(*)::int from store s where s.plan_id = pl.id) as store_count
    from plan pl where pl.partner_id = ${partnerId} order by pl.created_at limit ${maxPageSize}
  `

export const selectPartnerDomain = async (tx: ScopedSql, partnerId: string, kind: DomainKind): Promise<PartnerDomainRow | null> =>
  (await tx<PartnerDomainRow[]>`select * from partner_domain where partner_id = ${partnerId} and kind = ${kind}`)[0] ?? null

export const selectPartnerDomainById = async (tx: ScopedSql, id: string): Promise<PartnerDomainRow | null> =>
  (await tx<PartnerDomainRow[]>`select * from partner_domain where id = ${id}`)[0] ?? null

export const updatePartnerDomainCheck = async (tx: ScopedSql, id: string, check: { status: HostStatus; found: string | null; checkedAt: Date }): Promise<void> => {
  await tx`update partner_domain set status = ${check.status}, found = ${check.found}, checked_at = ${check.checkedAt} where id = ${id}`
}

/** Each address the partner has added, by kind: the email sender's fallback is named after one (SAAS §3.6). */
export const selectPartnerHosts = (tx: ScopedSql, partnerId: string): Promise<{ kind: DomainKind; host: string }[]> =>
  tx<{ kind: DomainKind; host: string }[]>`select kind, host from partner_domain where partner_id = ${partnerId}`

/** The partner's live portal host, where every link to a merchant leads; null until one is live. */
export const selectLivePortalHost = async (tx: ScopedSql, partnerId: string): Promise<string | null> =>
  (await tx<{ host: string }[]>`select host from partner_domain where partner_id = ${partnerId} and kind = 'portal' and status = 'live' order by created_at limit 1`)[0]?.host ?? null

/** A partner's active users with any of these roles, oldest first: who an account notice goes to. */
export const selectActivePartnerEmails = async (tx: ScopedSql, partnerId: string, roles: readonly PartnerUserRow['role_key'][], limit: number): Promise<string[]> =>
  (
    await tx<{ email: string }[]>`
      select email from partner_user
      where partner_id = ${partnerId} and status = 'active' and role_key = any(${pgArray(roles)}::text[])
      order by created_at limit ${limit}
    `
  ).map((r) => r.email)

/** The partner a record an account email names belongs to, or null when there is no such record. */
export const selectRecordPartner = async (tx: ScopedSql, record: 'invitation' | 'reset' | 'user', id: string): Promise<string | null> => {
  const rows =
    record === 'invitation'
      ? await tx<{ partner_id: string }[]>`select partner_id from partner_invitation where id = ${id}`
      : record === 'reset'
        ? await tx<{ partner_id: string }[]>`select partner_id from partner_password_reset where id = ${id}`
        : await tx<{ partner_id: string }[]>`select partner_id from partner_user where id = ${id}`
  return rows[0]?.partner_id ?? null
}

/** The role an open partner invitation offers, for its email. */
export const selectInvitedPartnerRole = async (tx: ScopedSql, invitationId: string): Promise<PartnerUserRow['role_key'] | null> =>
  (
    await tx<{ role_key: PartnerUserRow['role_key'] }[]>`
      select u.role_key from partner_invitation i join partner_user u on u.id = i.partner_user_id where i.id = ${invitationId}
    `
  )[0]?.role_key ?? null

/** The partner's Owner: the first user with that role. */
export const selectPartnerOwner = async (tx: ScopedSql, partnerId: string): Promise<PartnerUserRow | null> =>
  (
    await tx<PartnerUserRow[]>`
      select id, partner_id, email, name, role_key, status, last_sign_in_at, created_at from partner_user
      where partner_id = ${partnerId} and role_key = 'partner-owner' order by created_at limit 1
    `
  )[0] ?? null

export const selectOpenInvitation = async (tx: ScopedSql, partnerUserId: string): Promise<PartnerInvitationRow | null> =>
  (
    await tx<PartnerInvitationRow[]>`
      select id, partner_id, partner_user_id, expires_at, sent_at, invited_by_kind, invited_by_label, accepted_at, revoked_at, created_at
      from partner_invitation where partner_user_id = ${partnerUserId} and revoked_at is null and accepted_at is null
      order by created_at desc limit 1
    `
  )[0] ?? null

export const revokeInvitation = async (tx: ScopedSql, id: string, now: Date): Promise<void> => {
  await tx`update partner_invitation set revoked_at = ${now} where id = ${id} and revoked_at is null`
}

export const markInvitationSent = async (tx: ScopedSql, id: string, sentAt: Date, expiresAt: Date): Promise<void> => {
  await tx`update partner_invitation set sent_at = ${sentAt}, expires_at = ${expiresAt} where id = ${id}`
}


export const insertPartnerApproval = async (tx: ScopedSql, a: { partnerId: string; staffUserId: string; submittedAt: Date; note: string | null; approvedAt: Date }): Promise<void> => {
  await tx`
    insert into partner_approval (partner_id, staff_user_id, submitted_at, note, approved_at)
    values (${a.partnerId}, ${a.staffUserId}, ${a.submittedAt}, ${a.note}, ${a.approvedAt})
  `
}

export interface SetupSessionRow {
  id: string
  staff_user_id: string
  staff_name: string
  staff_role: string
  partner_id: string
  reason: string
  ticket: string | null
  started_at: Date
  expires_at: Date
  ended_at: Date | null
  ended_by_staff_id: string | null
}

const setupSessionFields = (tx: ScopedSql) => tx`
  select ss.id, ss.staff_user_id, st.name as staff_name, st.role_key as staff_role, ss.partner_id, ss.reason, ss.ticket,
         ss.started_at, ss.expires_at, ss.ended_at, ss.ended_by_staff_id
`
const setupSessionFrom = (tx: ScopedSql) => tx`from partner_setup_session ss join staff_user st on st.id = ss.staff_user_id`
const setupSessionColumns = (tx: ScopedSql) => tx`${setupSessionFields(tx)} ${setupSessionFrom(tx)}`


export const selectSetupSession = async (tx: ScopedSql, id: string): Promise<SetupSessionRow | null> =>
  (await tx<SetupSessionRow[]>`${setupSessionColumns(tx)} where ss.id = ${id}`)[0] ?? null

/** A session is open while it is neither ended nor past its two hours (ACCESS.md §8.2). */
export const selectOpenSetupSessionOf = async (tx: ScopedSql, staffUserId: string, now: Date): Promise<SetupSessionRow | null> =>
  (await tx<SetupSessionRow[]>`${setupSessionColumns(tx)} where ss.staff_user_id = ${staffUserId} and ss.ended_at is null and ss.expires_at > ${now}`)[0] ?? null

/** Closes the staff member's sessions that ran out without being ended, at the moment they ran out. */
export const expireStaleSetupSessions = async (tx: ScopedSql, staffUserId: string, now: Date): Promise<void> => {
  await tx`
    update partner_setup_session set ended_at = expires_at, handoff_hash = null
    where staff_user_id = ${staffUserId} and ended_at is null and expires_at <= ${now}
  `
}

/** The new session's id, or null when the staff member already has one open (the partial unique index). */
export const insertSetupSession = async (
  tx: ScopedSql,
  s: { staffUserId: string; partnerId: string; reason: string; ticket: string | null; startedAt: Date; expiresAt: Date; handoffHash: string; handoffExpiresAt: Date },
): Promise<string | null> => {
  try {
    const rows = await tx.savepoint(
      (sp) => sp<{ id: string }[]>`
        insert into partner_setup_session (staff_user_id, partner_id, reason, ticket, started_at, expires_at, handoff_hash, handoff_expires_at)
        values (${s.staffUserId}, ${s.partnerId}, ${s.reason}, ${s.ticket}, ${s.startedAt}, ${s.expiresAt}, ${s.handoffHash}, ${s.handoffExpiresAt})
        returning id
      `,
    )
    return one(rows, 'partner_setup_session')
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') return null
    throw error
  }
}

// The facts the list needs for a page of partners, one query per table (AGENTS.md: no N+1).
export const selectPartnerDomainsFor = (tx: ScopedSql, ids: readonly string[]): Promise<PartnerDomainRow[]> =>
  tx<PartnerDomainRow[]>`select * from partner_domain where partner_id = any(${pgArray(ids)}::uuid[]) order by kind`

export const selectSetupItemsFor = (tx: ScopedSql, ids: readonly string[]): Promise<PartnerSetupItemRow[]> =>
  tx<PartnerSetupItemRow[]>`${setupItems(tx, tx`= any(${pgArray(ids)}::uuid[])`)}`

// Capped per partner, not per batch: a page of partners must never lose one partner's rows
// to another's.
export const selectPlansFor = (tx: ScopedSql, ids: readonly string[]): Promise<(PlanRow & { store_count: number; priced: boolean })[]> =>
  tx<(PlanRow & { store_count: number; priced: boolean })[]>`
    select * from (
      select pl.*, (select count(*)::int from store s where s.plan_id = pl.id) as store_count,
        -- Priced: its current version has a monthly price in some currency (DATA-MODEL §2.3).
        exists (select 1 from plan_price pp where pp.plan_id = pl.id and pp.version = pl.version and pp.monthly_amount is not null) as priced,
        row_number() over (partition by pl.partner_id order by pl.created_at) as rn
      from plan pl where pl.partner_id = any(${pgArray(ids)}::uuid[])
    ) ranked where rn <= ${maxPageSize} order by created_at
  `

export const selectSetupSessionsFor = (tx: ScopedSql, ids: readonly string[]): Promise<SetupSessionRow[]> =>
  tx<SetupSessionRow[]>`
    select * from (
      ${setupSessionFields(tx)}, row_number() over (partition by ss.partner_id order by ss.started_at desc) as rn
      ${setupSessionFrom(tx)} where ss.partner_id = any(${pgArray(ids)}::uuid[])
    ) ranked where rn <= ${maxPageSize} order by started_at desc
  `

/** Who approved each partner's current submission. */
export const selectCurrentApproversFor = (tx: ScopedSql, ids: readonly string[]): Promise<{ partner_id: string; staff_user_id: string }[]> =>
  tx<{ partner_id: string; staff_user_id: string }[]>`
    select a.partner_id, a.staff_user_id from partner_approval a
    join partner p on p.id = a.partner_id and p.submitted_at = a.submitted_at
    where a.partner_id = any(${pgArray(ids)}::uuid[])
  `

export const endSetupSession = async (tx: ScopedSql, id: string, endedBy: string, now: Date): Promise<boolean> => {
  const rows = await tx<{ id: string }[]>`
    update partner_setup_session set ended_at = ${now}, ended_by_staff_id = ${endedBy}, end_reason = 'staff', handoff_hash = null
    where id = ${id} and ended_at is null returning id
  `
  return rows.length > 0
}

/** Locks the row for the rest of the transaction, so two staff cannot both approve as "the second". */
export const selectPartnerForUpdate = async (tx: ScopedSql, id: string): Promise<PartnerRow | null> =>
  (await tx<PartnerRow[]>`select * from partner where id = ${id} for update`)[0] ?? null

/** Each partner's domain, read off its shop wildcard (`*.shops.<partnerdomain>`, SAAS.md §3.5). */
export const selectPartnerDomainsOf = async (tx: ScopedSql, partnerIds: readonly string[]): Promise<Map<string, string>> => {
  const rows = await tx<{ partner_id: string; host: string }[]>`
    select partner_id, host from partner_domain where kind = 'shops' and partner_id = any(${pgArray(partnerIds)}::uuid[])
  `
  return new Map(rows.map((r) => [r.partner_id, r.host.replace(/^\*\.shops\./, '')]))
}
