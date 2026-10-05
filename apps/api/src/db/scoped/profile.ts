import type { PageWindow } from '#core/paging'
import type { ScopedSql } from './index'

// My profile (FIRST-RELEASE §4, ACCESS.md §4): a person's own account, read and changed in system
// scope before any acting store, every statement pinned to their own user id (ACCESS.md §4).

export interface ProfileRow {
  id: string
  partner_id: string
  name: string
  email: string
  phone: string | null
  theme: 'light' | 'dark' | null
  password_changed_at: Date | null
  two_factor_method: 'app' | 'sms' | null
  backup_codes_left: number
  pending_email: string | null
  is_owner: boolean
}

export const selectProfile = async (tx: ScopedSql, userId: string, now: Date): Promise<ProfileRow | null> =>
  (
    await tx<ProfileRow[]>`
      select u.id, u.partner_id, u.name, u.email, u.phone, u.theme, u.password_changed_at, u.two_factor_method,
        (select count(*)::int from user_backup_code b where b.user_id = u.id and b.used_at is null) as backup_codes_left,
        (select c.new_email from user_email_change c where c.user_id = u.id and c.used_at is null and c.expires_at > ${now} order by c.created_at desc limit 1) as pending_email,
        exists (
          select 1 from membership m join store s on s.id = m.store_id
          where m.user_id = u.id and m.role_key = 'owner' and m.status = 'active' and s.status <> 'closed'
        ) as is_owner
      from "user" u where u.id = ${userId} and u.status = 'active'
    `
  )[0] ?? null

export const updateProfileDetails = async (tx: ScopedSql, userId: string, d: { name: string; phone: string | null; theme: 'light' | 'dark' | null }): Promise<void> => {
  await tx`update "user" set name = ${d.name}, phone = ${d.phone}, theme = ${d.theme} where id = ${userId}`
}

/** Light or dark only, so a theme click never writes back a name or number read earlier. */
export const updateUserTheme = async (tx: ScopedSql, userId: string, theme: 'light' | 'dark'): Promise<void> => {
  await tx`update "user" set theme = ${theme} where id = ${userId}`
}

/** The new password; every other session ends on every host (ACCESS.md §4), and so does any email change in flight. */
export const changeUserPassword = async (tx: ScopedSql, userId: string, passwordHash: string, keepSessionHash: string, now: Date): Promise<void> => {
  await tx`update "user" set password_hash = ${passwordHash}, password_changed_at = ${now} where id = ${userId}`
  await endOtherSessions(tx, userId, keepSessionHash, now)
}

/** Securing the account: the other sessions end, and an open email change can no longer be confirmed. */
export const endOtherSessions = async (tx: ScopedSql, userId: string, keepSessionHash: string, now: Date): Promise<number> => {
  await tx`update user_email_change set used_at = ${now} where user_id = ${userId} and used_at is null`
  return (await tx`delete from user_session where user_id = ${userId} and id_hash <> ${keepSessionHash}`).count
}

export interface SessionRow {
  current: boolean
  device_label: string | null
  user_agent: string | null
  created_at: Date
  last_seen_at: Date
}

/** The person's live sessions, most recently used first, at most `limit`: the hash is compared here, never sent. */
export const selectMySessions = async (tx: ScopedSql, userId: string, now: Date, currentHash: string, limit: number): Promise<SessionRow[]> =>
  tx<SessionRow[]>`
    select device_label, user_agent, created_at, last_seen_at, id_hash = ${currentHash} as current from user_session
    where user_id = ${userId} and stage = 'full' and absolute_expires_at > ${now}
    order by last_seen_at desc
    limit ${limit}
  `

/** Email change requests in the last day, so a stolen session can't make this an email cannon. */
export const countEmailChangesSince = async (tx: ScopedSql, userId: string, since: Date): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from user_email_change where user_id = ${userId} and created_at > ${since}`)[0]?.n ?? 0

/** A new request replaces any open one: only the latest link can change the address. */
export const insertEmailChange = async (tx: ScopedSql, user: { id: string; partnerId: string }, newEmail: string, expiresAt: Date, now: Date): Promise<string> => {
  await tx`update user_email_change set used_at = ${now} where user_id = ${user.id} and used_at is null`
  const [row] = await tx<{ id: string }[]>`
    insert into user_email_change (partner_id, user_id, new_email, expires_at, created_at) values (${user.partnerId}, ${user.id}, ${newEmail}, ${expiresAt}, ${now}) returning id
  `
  if (!row) throw new Error('user_email_change: insert returned no row')
  return row.id
}

/** For the confirmation email's deliverer: stores the link's token as its hash; false once the request is closed. */
export const issueEmailChangeToken = async (tx: ScopedSql, changeId: string, tokenHash: string, now: Date): Promise<boolean> =>
  (await tx`update user_email_change set token_hash = ${tokenHash} where id = ${changeId} and used_at is null and expires_at > ${now}`).count > 0

export const selectEmailChangeForEmail = async (tx: ScopedSql, changeId: string): Promise<{ partner_id: string; new_email: string; old_email: string } | null> =>
  (
    await tx<{ partner_id: string; new_email: string; old_email: string }[]>`
      select c.partner_id, c.new_email, u.email as old_email from user_email_change c join "user" u on u.id = c.user_id where c.id = ${changeId}
    `
  )[0] ?? null

/** The open change a token names under this partner, locked; null when unknown, used or expired. */
export const selectEmailChangeByToken = async (tx: ScopedSql, partnerId: string, tokenHash: string, now: Date): Promise<{ id: string; user_id: string; new_email: string } | null> =>
  (
    await tx<{ id: string; user_id: string; new_email: string }[]>`
      select c.id, c.user_id, c.new_email from user_email_change c join "user" u on u.id = c.user_id
      where c.token_hash = ${tokenHash} and c.partner_id = ${partnerId} and c.used_at is null and c.expires_at > ${now} and u.status = 'active'
      for update of c
    `
  )[0] ?? null

/** False when another account under the partner holds the address by now: the link then changes nothing. */
export const applyEmailChange = async (tx: ScopedSql, change: { id: string; user_id: string; new_email: string }, partnerId: string, now: Date): Promise<boolean> => {
  const taken = await tx`select 1 from "user" where partner_id = ${partnerId} and lower(email) = lower(${change.new_email}) and id <> ${change.user_id}`
  await tx`update user_email_change set used_at = ${now} where id = ${change.id}`
  if (taken.length > 0) return false
  await tx`update "user" set email = ${change.new_email}, email_verified_at = ${now} where id = ${change.user_id}`
  return true
}

/** A switched or confirmed method's pending secret or number, kept on the person's own full session. */
export const setPendingSecondFactor = async (tx: ScopedSql, sessionHash: string, userId: string, pending: { secretEnc: string | null; phone: string | null }): Promise<void> => {
  await tx`update user_session set pending_secret_enc = ${pending.secretEnc}, pending_phone = ${pending.phone} where id_hash = ${sessionHash} and user_id = ${userId} and stage = 'full'`
}

export const selectPendingSecondFactor = async (tx: ScopedSql, sessionHash: string, userId: string): Promise<{ pending_secret_enc: string | null; pending_phone: string | null } | null> =>
  (
    await tx<{ pending_secret_enc: string | null; pending_phone: string | null }[]>`
      select pending_secret_enc, pending_phone from user_session where id_hash = ${sessionHash} and user_id = ${userId} and stage = 'full'
    `
  )[0] ?? null

/** Off: the method, its secret and the backup codes go together (never for an Owner; the caller checks). */
export const turnOffUserSecondFactor = async (tx: ScopedSql, userId: string): Promise<void> => {
  await tx`update "user" set two_factor_method = null, two_factor_secret_enc = null, two_factor_enrolled_at = null, last_code_step = null where id = ${userId}`
  await tx`delete from user_backup_code where user_id = ${userId}`
}

export interface MyActivityRow {
  id: string
  occurred_at: Date
  action: string
  result: string
  store_id: string | null
  target_type: string | null
  target_label: string | null
}

/** LOGGING.md §6: a person's own entries, newest first, in every store of the partner; never a staff-only one. */
export const selectMyActivity = (tx: ScopedSql, userId: string, partnerId: string, window: PageWindow): Promise<MyActivityRow[]> =>
  tx<MyActivityRow[]>`
    select id, occurred_at, action, result, store_id, target_type, target_label from activity_log
    where actor_kind = 'person' and actor_id = ${userId} and partner_id = ${partnerId} and visibility <> 'staff'
      and ${window.after ? tx`(occurred_at, id) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(occurred_at, id) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by occurred_at ${window.before && !window.after ? tx`asc` : tx`desc`}, id ${window.before && !window.after ? tx`asc` : tx`desc`}
    limit ${window.limit + 1}
  `
