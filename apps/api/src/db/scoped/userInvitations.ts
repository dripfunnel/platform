import type { ScopedSql } from './index'

// Accepting a store invitation and resetting a merchant's password on a portal host (ACCESS.md
// §4, §6; #290). Sign-in's work: every function here runs in system scope, pinned to the host's
// partner so a token never works on another partner's portal.

export interface StoreInvitationByToken {
  id: string
  store_id: string
  store_name: string
  store_status: string
  seller_id: string | null
  seller_name: string | null
  email: string
  role_key: string
  invited_by_label: string
  expires_at: Date
  accepted_at: Date | null
  revoked_at: Date | null
  replaced: boolean
  user_id: string | null
  user_status: string | null
}

/** The invitation a token names under this partner, locked so two acceptances cannot both pass. */
export const selectStoreInvitationByToken = async (tx: ScopedSql, partnerId: string, tokenHash: string): Promise<StoreInvitationByToken | null> =>
  (
    await tx<StoreInvitationByToken[]>`
      select i.id, i.store_id, s.name as store_name, s.status as store_status, i.seller_id, sel.name as seller_name,
        i.email, i.role_key, i.invited_by_label, i.expires_at, i.accepted_at, i.revoked_at,
        exists (
          select 1 from invitation n
          where n.store_id = i.store_id and lower(n.email) = lower(i.email) and n.seller_id is not distinct from i.seller_id and n.created_at > i.created_at
        ) as replaced,
        u.id as user_id, u.status as user_status
      from invitation i
      join store s on s.id = i.store_id
      left join seller sel on sel.id = i.seller_id
      left join "user" u on u.partner_id = s.partner_id and lower(u.email) = lower(i.email)
      where i.token_hash = ${tokenHash} and s.partner_id = ${partnerId}
      for update of i
    `
  )[0] ?? null

/** For the invitation email's deliverer: stores the link's token as its hash; false once the invitation is closed. */
export const issueStoreInvitationToken = async (tx: ScopedSql, invitationId: string, tokenHash: string, now: Date): Promise<boolean> =>
  (await tx`
    update invitation set token_hash = ${tokenHash}
    where id = ${invitationId} and accepted_at is null and revoked_at is null and expires_at > ${now}
  `).count > 0

/** The invitation's store, role and address, and whether the account it names has a password yet. */
export const selectStoreInvitationForEmail = async (
  tx: ScopedSql,
  invitationId: string,
): Promise<{ partner_id: string; store_name: string; role_key: string; seller_name: string | null; invited_by_label: string; has_password: boolean } | null> =>
  (
    await tx<{ partner_id: string; store_name: string; role_key: string; seller_name: string | null; invited_by_label: string; has_password: boolean }[]>`
      select s.partner_id, s.name as store_name, i.role_key, sel.name as seller_name, i.invited_by_label,
        coalesce((select u.password_hash is not null from "user" u where u.partner_id = s.partner_id and lower(u.email) = lower(i.email)), false) as has_password
      from invitation i join store s on s.id = i.store_id left join seller sel on sel.id = i.seller_id
      where i.id = ${invitationId}
    `
  )[0] ?? null

/** ACCESS.md §6.2: the membership the invitation names becomes active, made if the inviter's step didn't. */
const activateMembership = async (tx: ScopedSql, i: StoreInvitationByToken, userId: string): Promise<void> => {
  const updated = await tx`
    update membership set status = 'active', role_key = ${i.role_key}
    where user_id = ${userId} and store_id = ${i.store_id} and seller_id is not distinct from ${i.seller_id}
  `
  if (updated.count === 0) {
    await tx`insert into membership (user_id, store_id, seller_id, role_key, status) values (${userId}, ${i.store_id}, ${i.seller_id}, ${i.role_key}, 'active')`
  }
}

/** A new person: their name and password, the address proven by the token, and the membership. */
export const acceptAsNewPerson = async (tx: ScopedSql, i: StoreInvitationByToken, userId: string, name: string, passwordHash: string, now: Date): Promise<void> => {
  await tx`
    update "user" set name = ${name}, password_hash = ${passwordHash}, status = 'active', email_verified_at = ${now},
      two_factor_method = null, two_factor_secret_enc = null, two_factor_enrolled_at = null, last_code_step = null, failed_code_count = 0, locked_until = null
    where id = ${userId} and status = 'invited'
  `
  await activateMembership(tx, i, userId)
  await tx`update invitation set accepted_at = ${now} where id = ${i.id}`
}

/** An existing account joins without any change to it (ACCESS.md §6.2, the JOIN path). */
export const acceptAsExistingPerson = async (tx: ScopedSql, i: StoreInvitationByToken, userId: string, now: Date): Promise<void> => {
  await tx`update "user" set email_verified_at = coalesce(email_verified_at, ${now}) where id = ${userId}`
  await activateMembership(tx, i, userId)
  await tx`update invitation set accepted_at = ${now} where id = ${i.id}`
}

/** At most one reset per request: the active person with this email under the host's partner, if any. */
export const insertUserPasswordReset = (tx: ScopedSql, requestId: string, partnerId: string, email: string): Promise<{ id: string; user_id: string; email: string }[]> =>
  tx<{ id: string; user_id: string; email: string }[]>`
    insert into user_password_reset (request_id, partner_id, user_id)
    select ${requestId}, u.partner_id, u.id from "user" u join partner p on p.id = u.partner_id
    where u.partner_id = ${partnerId} and lower(u.email) = lower(${email}) and u.status = 'active' and p.state <> 'closed'
    on conflict (request_id, user_id) do nothing
    returning id, user_id, (select email from "user" where id = user_id) as email
  `

/** For the reset email's deliverer: the token, valid for `validMs` from now; false once the reset is used or already sent. */
export const issueUserResetToken = async (tx: ScopedSql, resetId: string, tokenHash: string, now: Date, validMs: number): Promise<boolean> =>
  (await tx`
    update user_password_reset set token_hash = ${tokenHash}, expires_at = ${new Date(now.getTime() + validMs)}
    where id = ${resetId} and used_at is null and token_hash is null
  `).count > 0

export const selectUserResetPartner = async (tx: ScopedSql, resetId: string): Promise<string | null> =>
  (await tx<{ partner_id: string }[]>`select partner_id from user_password_reset where id = ${resetId}`)[0]?.partner_id ?? null

/** The open reset a token names under this partner, locked; null when unknown, used or past its 30 minutes. */
export const selectUserResetByToken = async (tx: ScopedSql, partnerId: string, tokenHash: string, now: Date): Promise<{ id: string; user_id: string; email: string } | null> =>
  (
    await tx<{ id: string; user_id: string; email: string }[]>`
      select r.id, r.user_id, u.email from user_password_reset r
      join "user" u on u.id = r.user_id join partner p on p.id = r.partner_id
      where r.token_hash = ${tokenHash} and r.partner_id = ${partnerId} and r.used_at is null and r.expires_at > ${now} and u.status = 'active' and p.state <> 'closed'
      for update of r
    `
  )[0] ?? null

/**
 * The new password: every reset of that person is spent, every session of theirs on every host ends
 * (ACCESS.md §4), and a sign-in pause lifts, as the locked screen promises.
 */
export const resetUserPassword = async (tx: ScopedSql, userId: string, passwordHash: string, now: Date): Promise<number> => {
  await tx`update "user" set password_hash = ${passwordHash}, failed_code_count = 0, locked_until = null where id = ${userId}`
  await tx`update user_password_reset set used_at = ${now} where user_id = ${userId} and used_at is null`
  return (await tx`delete from user_session where user_id = ${userId}`).count
}
