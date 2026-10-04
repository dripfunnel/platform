import type { KeysetPage } from './activity'
import type { ScopedSql } from './index'

// The partner's team and company (ui/platform/FIRST-RELEASE.md §14; card #199), in the partner's
// own scope: 0011's column grants and policies hold every read and write to it.

export type PartnerRoleKey = 'partner-owner' | 'partner-admin' | 'partner-support' | 'partner-finance' | 'partner-read-only'

export interface TeamMemberRow {
  id: string
  name: string
  email: string
  role_key: PartnerRoleKey
  status: 'invited' | 'active' | 'suspended' | 'removed'
  last_sign_in_at: Date | null
  two_factor_enrolled_at: Date | null
  created_at: Date
  invitation_id: string | null
  invitation_sent_at: Date | null
  invitation_expires_at: Date | null
}

/** One team change at a time per partner: the last-Owner rule holds under concurrent requests. */
export const lockTeam = async (tx: ScopedSql, partnerId: string): Promise<void> => {
  await tx`select pg_advisory_xact_lock(hashtext(${`partner_team:${partnerId}`}))`
}

const memberColumns = (tx: ScopedSql) => tx`
  u.id, u.name, u.email, u.role_key, u.status, u.last_sign_in_at, u.two_factor_enrolled_at,
  date_trunc('milliseconds', u.created_at) as created_at, i.id as invitation_id, i.sent_at as invitation_sent_at, i.expires_at as invitation_expires_at
`

const openInvitation = (tx: ScopedSql) => tx`
  left join lateral (
    select id, sent_at, expires_at from partner_invitation
    where partner_user_id = u.id and revoked_at is null and accepted_at is null order by created_at desc limit 1
  ) i on true
`

// partner_user keeps microseconds; the cursor carries milliseconds, so both sides are cut to them.
export const selectTeam = async (tx: ScopedSql, partnerId: string, page: KeysetPage, limit: number): Promise<TeamMemberRow[]> => {
  const backwards = page.before !== undefined
  const rows = await tx<TeamMemberRow[]>`
    select ${memberColumns(tx)} from partner_user u ${openInvitation(tx)}
    where u.partner_id = ${partnerId} and u.status <> 'removed'
      ${page.after !== undefined ? tx`and (date_trunc('milliseconds', u.created_at), u.id) > (${page.after.occurredAt}, ${page.after.id}::uuid)` : tx``}
      ${page.before !== undefined ? tx`and (date_trunc('milliseconds', u.created_at), u.id) < (${page.before.occurredAt}, ${page.before.id}::uuid)` : tx``}
    ${backwards ? tx`order by date_trunc('milliseconds', u.created_at) desc, u.id desc` : tx`order by date_trunc('milliseconds', u.created_at) asc, u.id asc`}
    limit ${limit + 1}
  `
  return backwards ? rows.reverse() : rows
}

export const selectTeamMember = async (tx: ScopedSql, partnerId: string, id: string): Promise<TeamMemberRow | null> =>
  (await tx<TeamMemberRow[]>`select ${memberColumns(tx)} from partner_user u ${openInvitation(tx)} where u.partner_id = ${partnerId} and u.id = ${id}`)[0] ?? null

export const selectTeamMemberByEmail = async (tx: ScopedSql, partnerId: string, email: string): Promise<TeamMemberRow | null> =>
  (await tx<TeamMemberRow[]>`select ${memberColumns(tx)} from partner_user u ${openInvitation(tx)} where u.partner_id = ${partnerId} and lower(u.email) = lower(${email})`)[0] ?? null

export const countActiveOwners = async (tx: ScopedSql, partnerId: string): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from partner_user where partner_id = ${partnerId} and role_key = 'partner-owner' and status = 'active'`)[0]?.n ?? 0

/** A removed person invited again: the same account, invited, with the role and name asked for. */
export const reinviteMember = async (tx: ScopedSql, id: string, name: string, role: PartnerRoleKey): Promise<void> => {
  await tx`update partner_user set status = 'invited', role_key = ${role}, name = ${name} where id = ${id}`
}

/** The columns 0011 grants a partner; the token is minted by the email's deliverer. */
export const insertTeamInvitation = async (tx: ScopedSql, i: { partnerId: string; userId: string; sentAt: Date; expiresAt: Date; byLabel: string }): Promise<string> => {
  const id = crypto.randomUUID()
  await tx`
    insert into partner_invitation (id, partner_id, partner_user_id, expires_at, sent_at, invited_by_kind, invited_by_label)
    values (${id}, ${i.partnerId}, ${i.userId}, ${i.expiresAt}, ${i.sentAt}, 'partner_user', ${i.byLabel})
  `
  return id
}

export const updateMemberRole = async (tx: ScopedSql, id: string, role: PartnerRoleKey): Promise<void> => {
  await tx`update partner_user set role_key = ${role} where id = ${id}`
}

export const markMemberRemoved = async (tx: ScopedSql, id: string): Promise<void> => {
  await tx`update partner_user set status = 'removed' where id = ${id}`
}

/** 0022's function: the person's sessions end now, wherever they are signed in. */
export const endMemberSessions = async (tx: ScopedSql, id: string): Promise<number> =>
  (await tx<{ ended: number }[]>`select end_partner_user_sessions(${id}) as ended`)[0]?.ended ?? 0

export const setSecondFactorRequired = async (tx: ScopedSql, partnerId: string, required: boolean): Promise<void> => {
  await tx`update partner set second_factor_required = ${required} where id = ${partnerId}`
}

export interface CompanyRow {
  name: string
  country: string | null
  region: string | null
  kind: string | null
  second_factor_required: boolean
  fee_currency: string | null
  powered_by_removable: boolean | null
  powered_by_note: string | null
}

export const selectCompany = async (tx: ScopedSql, partnerId: string): Promise<CompanyRow | null> =>
  (
    await tx<CompanyRow[]>`
      select p.name, p.country, p.region, p.kind, p.second_factor_required, c.fee_currency, c.powered_by_removable, c.powered_by_note
      from partner p left join partner_contract c on c.partner_id = p.id where p.id = ${partnerId}
    `
  )[0] ?? null

/** The wholesale fee per plan in the contract's currency, `limit` at most, and one more to say there are. */
export const selectPlanFees = (tx: ScopedSql, partnerId: string, limit: number): Promise<{ plan: string; amount: number; currency: string }[]> =>
  tx<{ plan: string; amount: number; currency: string }[]>`
    select p.name as plan, f.amount, f.currency from plan_fee f join plan p on p.id = f.plan_id
    where f.partner_id = ${partnerId} and p.status <> 'retired' order by f.amount, p.name limit ${limit + 1}
  `

/** The partner's earliest active member with a role: the company's main or billing contact. */
export const selectActiveWithRole = async (tx: ScopedSql, partnerId: string, role: PartnerRoleKey): Promise<{ name: string; email: string } | null> =>
  (await tx<{ name: string; email: string }[]>`
    select name, email from partner_user where partner_id = ${partnerId} and role_key = ${role} and status = 'active' order by created_at, id limit 1
  `)[0] ?? null

/**
 * Invitation emails sent lately, from the log (ACCESS §6.2, §13 item 13): by this inviter in the
 * partner, and to this account, so neither a person nor an address can be flooded.
 */
export const countRecentInvitations = async (tx: ScopedSql, partnerId: string, since: Date, by: { actorKind: 'partner_user' | 'staff'; actorId: string } | { targetId: string }): Promise<number> =>
  (
    await tx<{ n: number }[]>`
      select count(*)::int as n from activity_log
      where partner_id = ${partnerId} and occurred_at >= ${since} and action in ('partner_user.invited', 'partner_user.invitation_resent')
        ${'actorId' in by ? tx`and actor_kind = ${by.actorKind} and actor_id = ${by.actorId}` : tx`and target_type = 'partner_user' and target_id = ${by.targetId}`}
    `
  )[0]?.n ?? 0
