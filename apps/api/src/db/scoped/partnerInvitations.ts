import type { ScopedSql } from './index'

// Accepting a partner invitation and resetting a password (FIRST-RELEASE §3, ACCESS.md §4, §6;
// card #208). Sign-in's work: every function here runs in system scope.

export interface InvitationByToken {
  id: string
  partner_user_id: string
  partner_id: string
  partner_name: string
  partner_state: string
  second_factor_required: boolean
  email: string
  role_key: string
  user_status: string
  invited_by_kind: 'partner_user' | 'staff'
  invited_by_label: string
  expires_at: Date | null
  accepted_at: Date | null
  revoked_at: Date | null
  replaced: boolean
}

/** The invitation a token names, locked so two acceptances cannot both pass. */
export const selectInvitationByToken = async (tx: ScopedSql, tokenHash: string): Promise<InvitationByToken | null> =>
  (
    await tx<InvitationByToken[]>`
      select i.id, i.partner_user_id, i.partner_id, p.name as partner_name, p.state as partner_state, p.second_factor_required, u.email, u.role_key,
        u.status as user_status, i.invited_by_kind, i.invited_by_label, i.expires_at, i.accepted_at, i.revoked_at,
        exists (select 1 from partner_invitation n where n.partner_user_id = i.partner_user_id and n.created_at > i.created_at) as replaced
      from partner_invitation i join partner_user u on u.id = i.partner_user_id join partner p on p.id = i.partner_id
      where i.token_hash = ${tokenHash}
      for update of i
    `
  )[0] ?? null

/** A re-invited account (ACCESS §6.3) starts afresh: no 2-factor or lock is carried over from before. Sign-in itself is the next step's. */
export const acceptInvitation = async (tx: ScopedSql, invitation: { id: string; partnerUserId: string }, name: string, passwordHash: string, now: Date): Promise<void> => {
  await tx`
    update partner_user set name = ${name}, password_hash = ${passwordHash}, status = 'active',
      two_factor_secret_enc = null, two_factor_enrolled_at = null, last_code_step = null, failed_code_count = 0, locked_until = null
    where id = ${invitation.partnerUserId}
  `
  await tx`update partner_invitation set accepted_at = ${now} where id = ${invitation.id}`
}

/** For the invitation email's deliverer: stores the link's token as its hash; false for an invitation no longer open. */
export const issueInvitationToken = async (tx: ScopedSql, invitationId: string, tokenHash: string, now: Date): Promise<boolean> =>
  (await tx`
    update partner_invitation set token_hash = ${tokenHash}
    where id = ${invitationId} and accepted_at is null and revoked_at is null and sent_at is not null and (expires_at is null or expires_at > ${now})
  `).count > 0

/** One reset per active account the email has under a partner that isn't closed (as sign-in), once per request; none for an unknown email. */
export const insertPasswordResets = (tx: ScopedSql, requestId: string, email: string): Promise<{ id: string; partner_id: string; partner_user_id: string; email: string }[]> =>
  tx<{ id: string; partner_id: string; partner_user_id: string; email: string }[]>`
    insert into partner_password_reset (request_id, partner_id, partner_user_id)
    select ${requestId}, u.partner_id, u.id from partner_user u join partner p on p.id = u.partner_id
    where lower(u.email) = lower(${email}) and u.status = 'active' and p.state <> 'closed'
    on conflict (request_id, partner_user_id) do nothing
    returning id, partner_id, partner_user_id, (select email from partner_user where id = partner_user_id) as email
  `

/** For the reset email's deliverer: the token, valid for `validMs` from now; false once the reset is used or already sent. */
export const issueResetToken = async (tx: ScopedSql, resetId: string, tokenHash: string, now: Date, validMs: number): Promise<boolean> =>
  (await tx`
    update partner_password_reset set token_hash = ${tokenHash}, expires_at = ${new Date(now.getTime() + validMs)}
    where id = ${resetId} and used_at is null and token_hash is null
  `).count > 0

/** The open reset a token names, locked; null when unknown, used or past its 30 minutes. */
export const selectResetByToken = async (tx: ScopedSql, tokenHash: string, now: Date): Promise<{ id: string; partner_id: string; partner_user_id: string } | null> =>
  (
    await tx<{ id: string; partner_id: string; partner_user_id: string }[]>`
      select r.id, r.partner_id, r.partner_user_id from partner_password_reset r
      join partner_user u on u.id = r.partner_user_id join partner p on p.id = r.partner_id
      where r.token_hash = ${tokenHash} and r.used_at is null and r.expires_at > ${now} and u.status = 'active' and p.state <> 'closed'
      for update of r
    `
  )[0] ?? null

/** The new password; every reset of that user is spent and every session of theirs ends (ACCESS.md §4). */
export const resetPassword = async (tx: ScopedSql, partnerUserId: string, passwordHash: string, now: Date): Promise<number> => {
  await tx`update partner_user set password_hash = ${passwordHash} where id = ${partnerUserId}`
  await tx`update partner_password_reset set used_at = ${now} where partner_user_id = ${partnerUserId} and used_at is null`
  return (await tx`delete from partner_session where partner_user_id = ${partnerUserId}`).count
}
