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
import type { ScopedSql } from './index'

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
  recordType: 'CNAME' | 'TXT'
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
}

export const insertPlan = async (tx: ScopedSql, p: NewPlan): Promise<string> =>
  one(
    await tx<{ id: string }[]>`
      insert into plan (partner_id, name, description, status, trial_days, max_products, max_staff)
      values (${p.partnerId}, ${p.name}, ${p.description ?? null}, ${p.status ?? 'draft'}, ${p.trialDays ?? 14}, ${p.maxProducts ?? null}, ${p.maxStaff ?? null})
      returning id
    `,
    'plan',
  )

export interface PartnerFilter {
  state?: PartnerState | undefined
  /** Whether every setup item is done (FIRST-RELEASE §4.1). */
  setup?: 'complete' | 'incomplete' | undefined
  /** Name, portal host or owner email. */
  q?: string | undefined
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
}

export const selectPartners = async (tx: ScopedSql, filter: PartnerFilter, page: KeysetPage, limit: number, sort: PartnerSort = 'newest'): Promise<PartnerListRow[]> => {
  const backwards = page.before !== undefined
  const q = filter.q ? likePattern(filter.q) : null
  // `newest` orders by (created_at, id) descending; `oldestSubmitted` by (submitted_at, id) ascending.
  const key = sort === 'newest' ? tx`p.created_at` : tx`p.submitted_at`
  const forward = (sort === 'newest') !== backwards
  const rows = await tx<PartnerListRow[]>`
    select p.*,
      (select count(*)::int from store s where s.partner_id = p.id) as store_count,
      pd.host as portal_host, pd.status as portal_status,
      (select count(*)::int from partner_setup_item i where i.partner_id = p.id and i.status = 'done') as setup_done,
      (select count(*)::int from partner_setup_item i where i.partner_id = p.id) as setup_total,
      o.name as owner_name, o.email as owner_email,
      case
        when o.id is null then null
        when o.status = 'active' then 'active'
        when (select sent_at from partner_invitation pi where pi.partner_user_id = o.id and pi.revoked_at is null order by created_at desc limit 1) is null then 'held'
        else 'sent'
      end as owner_invitation
    from partner p
    left join partner_domain pd on pd.partner_id = p.id and pd.kind = 'portal'
    left join lateral (
      select u.id, u.name, u.email, u.status from partner_user u
      where u.partner_id = p.id and u.role_key = 'partner-owner' order by u.created_at limit 1
    ) o on true
    where true
      ${filter.state !== undefined ? tx`and p.state = ${filter.state}` : tx``}
      ${filter.setup === 'complete' ? tx`and exists (select 1 from partner_setup_item i where i.partner_id = p.id) and not exists (select 1 from partner_setup_item i where i.partner_id = p.id and i.status <> 'done')` : tx``}
      ${filter.setup === 'incomplete' ? tx`and exists (select 1 from partner_setup_item i where i.partner_id = p.id and i.status <> 'done')` : tx``}
      ${q !== null ? tx`and (p.name ilike ${q} or pd.host ilike ${q} or o.email ilike ${q})` : tx``}
      ${sort === 'oldestSubmitted' ? tx`and p.submitted_at is not null` : tx``}
      ${page.after !== undefined ? (sort === 'newest' ? tx`and (${key}, p.id) < (${page.after.occurredAt}, ${page.after.id}::uuid)` : tx`and (${key}, p.id) > (${page.after.occurredAt}, ${page.after.id}::uuid)`) : tx``}
      ${page.before !== undefined ? (sort === 'newest' ? tx`and (${key}, p.id) > (${page.before.occurredAt}, ${page.before.id}::uuid)` : tx`and (${key}, p.id) < (${page.before.occurredAt}, ${page.before.id}::uuid)`) : tx``}
    ${forward ? tx`order by ${key} desc, p.id desc` : tx`order by ${key} asc, p.id asc`}
    limit ${limit + 1}
  `
  return backwards ? rows.reverse() : rows
}

export const selectPartner = async (tx: ScopedSql, id: string): Promise<PartnerRow | null> =>
  (await tx<PartnerRow[]>`select * from partner where id = ${id}`)[0] ?? null

export const selectPartnerUsers = (tx: ScopedSql, partnerId: string): Promise<PartnerUserRow[]> =>
  tx<PartnerUserRow[]>`
    select id, partner_id, email, name, role_key, status, last_sign_in_at, created_at
    from partner_user where partner_id = ${partnerId} order by created_at
  `

export const selectPartnerInvitations = (tx: ScopedSql, partnerId: string): Promise<PartnerInvitationRow[]> =>
  tx<PartnerInvitationRow[]>`
    select id, partner_id, partner_user_id, expires_at, sent_at, invited_by_kind, invited_by_label, accepted_at, revoked_at, created_at
    from partner_invitation where partner_id = ${partnerId} order by created_at desc
  `

export const selectPartnerDomains = (tx: ScopedSql, partnerId: string): Promise<PartnerDomainRow[]> =>
  tx<PartnerDomainRow[]>`select * from partner_domain where partner_id = ${partnerId} order by kind`

export const selectSetupItems = (tx: ScopedSql, partnerId: string): Promise<PartnerSetupItemRow[]> =>
  tx<PartnerSetupItemRow[]>`select * from partner_setup_item where partner_id = ${partnerId}`

export const selectPlans = (tx: ScopedSql, partnerId: string): Promise<(PlanRow & { store_count: number })[]> =>
  tx<(PlanRow & { store_count: number })[]>`
    select pl.*, (select count(*)::int from store s where s.plan_id = pl.id) as store_count
    from plan pl where pl.partner_id = ${partnerId} order by pl.created_at
  `
