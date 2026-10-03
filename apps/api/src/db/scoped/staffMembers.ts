import type { KeysetPage } from './activity'
import type { ScopedSql } from './index'

// Staff on the Admin API (ui/admin/FIRST-RELEASE.md §10; card #39). Requests run in platform
// scope; accepting an invitation and the sign-in stamp are sign-in's, in system scope.

export interface StaffMemberRow {
  id: string
  name: string
  email: string
  role_key: string
  status: 'active' | 'invited' | 'suspended' | 'removed'
  last_sign_in_at: Date | null
  two_factor: boolean | null
  created_at: Date
  invitation_id: string | null
  invitation_sent_at: Date | null
  invitation_expires_at: Date | null
}

/** One change to the staff list at a time: the last-Super-admin rule holds under concurrent requests. */
export const lockStaffTeam = async (tx: ScopedSql): Promise<void> => {
  await tx`select pg_advisory_xact_lock(hashtext('staff_team'))`
}

const columns = (tx: ScopedSql) => tx`
  u.id, u.name, u.email, u.role_key, u.status, u.last_sign_in_at, u.two_factor, date_trunc('milliseconds', u.created_at) as created_at,
  i.id as invitation_id, i.sent_at as invitation_sent_at, i.expires_at as invitation_expires_at
  from staff_user u
  left join lateral (
    select id, sent_at, expires_at from staff_invitation where staff_user_id = u.id and accepted_at is null and revoked_at is null order by created_at desc limit 1
  ) i on true
`

/** Oldest first by (created_at, id), one more row than asked; `before` reads backwards and is flipped. */
export const selectStaffPage = async (tx: ScopedSql, page: KeysetPage, limit: number): Promise<StaffMemberRow[]> => {
  const backwards = page.before !== undefined
  const key = tx`date_trunc('milliseconds', u.created_at)`
  const rows = await tx<StaffMemberRow[]>`
    select ${columns(tx)}
    where u.status <> 'removed'
      ${page.after !== undefined ? tx`and (${key}, u.id) > (${page.after.occurredAt}, ${page.after.id}::uuid)` : tx``}
      ${page.before !== undefined ? tx`and (${key}, u.id) < (${page.before.occurredAt}, ${page.before.id}::uuid)` : tx``}
    ${backwards ? tx`order by ${key} desc, u.id desc` : tx`order by ${key} asc, u.id asc`}
    limit ${limit + 1}
  `
  return backwards ? rows.reverse() : rows
}

export const selectStaffMember = async (tx: ScopedSql, id: string): Promise<StaffMemberRow | null> =>
  (await tx<StaffMemberRow[]>`select ${columns(tx)} where u.id = ${id} and u.status <> 'removed'`)[0] ?? null

export const selectStaffByEmail = async (tx: ScopedSql, email: string): Promise<StaffMemberRow | null> =>
  (await tx<StaffMemberRow[]>`select ${columns(tx)} where lower(u.email) = lower(${email}) and u.status <> 'removed'`)[0] ?? null

/** Accepted Super admins: pending invitations don't count (decided on #45). */
export const countActiveSuperAdmins = async (tx: ScopedSql): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from staff_user where role_key = 'staff-super-admin' and status = 'active'`)[0]?.n ?? 0

export const insertInvitedStaff = async (tx: ScopedSql, email: string, role: string): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`insert into staff_user (email, name, role_key, status) values (${email}, '', ${role}, 'invited') returning id`
  if (!row) throw new Error('staff_user: insert returned no row')
  return row.id
}

export const insertStaffInvitation = async (tx: ScopedSql, i: { staffUserId: string; sentAt: Date; expiresAt: Date; by: string }): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into staff_invitation (staff_user_id, sent_at, expires_at, invited_by_staff_id) values (${i.staffUserId}, ${i.sentAt}, ${i.expiresAt}, ${i.by}) returning id`
  if (!row) throw new Error('staff_invitation: insert returned no row')
  return row.id
}

/** Every open link of this member stops working (ACCESS.md §6.3). */
export const revokeStaffInvitations = async (tx: ScopedSql, staffUserId: string, at: Date): Promise<void> => {
  await tx`update staff_invitation set revoked_at = ${at} where staff_user_id = ${staffUserId} and accepted_at is null and revoked_at is null`
}

export const updateStaffRole = async (tx: ScopedSql, id: string, role: string): Promise<void> => {
  await tx`update staff_user set role_key = ${role} where id = ${id}`
}

/** The row stays, so the log can name who acted; the person signs in no more (0029). */
export const markStaffRemoved = async (tx: ScopedSql, id: string): Promise<number> => {
  await tx`update staff_user set status = 'removed' where id = ${id}`
  return (await tx<{ ended: number }[]>`select end_staff_user_sessions(${id}) as ended`)[0]?.ended ?? 0
}

/** Invitation emails lately, from the log (ACCESS §13 item 13): by this inviter, and to this address, whichever row it had. */
export const countRecentStaffInvites = async (tx: ScopedSql, since: Date, by: { actorId: string } | { email: string }): Promise<number> =>
  (
    await tx<{ n: number }[]>`
      select count(*)::int as n from activity_log
      where occurred_at >= ${since} and action in ('staff.invited', 'staff.invitation_resent')
        ${'actorId' in by ? tx`and actor_kind = 'staff' and actor_id = ${by.actorId}` : tx`and target_type = 'staff' and lower(target_label) = lower(${by.email})`}
    `
  )[0]?.n ?? 0

export interface InvitationForAccept {
  id: string
  staff_user_id: string
  email: string
  role_key: string
  status: string
  expires_at: Date
  accepted_at: Date | null
  revoked_at: Date | null
}

/** The invitation a link names, locked, so two acceptances can't both bind (system scope). */
export const selectStaffInvitationByToken = async (tx: ScopedSql, tokenHash: string): Promise<InvitationForAccept | null> =>
  (
    await tx<InvitationForAccept[]>`
      select i.id, i.staff_user_id, u.email, u.role_key, u.status, i.expires_at, i.accepted_at, i.revoked_at
      from staff_invitation i join staff_user u on u.id = i.staff_user_id where i.token_hash = ${tokenHash}
      for update of i, u
    `
  )[0] ?? null

/** Whether the SSO account is another current member's; a removed member's doesn't count. */
export const subjectTaken = async (tx: ScopedSql, subject: string): Promise<boolean> =>
  (await tx`select 1 from staff_user where sso_subject = ${subject} and status <> 'removed'`).length > 0

export const acceptStaffInvitation = async (
  tx: ScopedSql,
  a: { invitationId: string; staffUserId: string; subject: string; name: string; twoFactor: boolean; at: Date },
): Promise<void> => {
  // A removed member's row gives the SSO account up, so a re-invited person can bind it (unique index).
  await tx`update staff_user set sso_subject = null where sso_subject = ${a.subject} and status = 'removed'`
  await tx`
    update staff_user set sso_subject = ${a.subject}, name = ${a.name}, status = 'active', last_sign_in_at = ${a.at}, two_factor = ${a.twoFactor}
    where id = ${a.staffUserId}`
  await tx`update staff_invitation set accepted_at = ${a.at} where id = ${a.invitationId}`
}

/** What the company SSO reported at this sign-in (decided on #45). */
export const markStaffSignedIn = async (tx: ScopedSql, id: string, at: Date, twoFactor: boolean): Promise<void> => {
  await tx`update staff_user set last_sign_in_at = ${at}, two_factor = ${twoFactor} where id = ${id}`
}

/** For the invitation email's deliverer: stores the link's token as its hash; false for one no longer open. */
export const issueStaffInvitationToken = async (tx: ScopedSql, invitationId: string, tokenHash: string, now: Date): Promise<boolean> =>
  (await tx`
    update staff_invitation set token_hash = ${tokenHash}
    where id = ${invitationId} and accepted_at is null and revoked_at is null and expires_at > ${now}
  `).count > 0
