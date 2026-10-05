import { pgArray, type ScopedSql } from './index'

// A merchant or supplier person's credentials on a portal host (ACCESS.md §2, §4). `system` scope
// only: sign-in runs before there is a caller, and these columns are credentials.

export interface SignInCandidate {
  id: string
  partner_id: string
  name: string
  email: string
  password_hash: string | null
  two_factor_method: 'app' | 'sms' | null
  locked_until: Date | null
  /** Holds an active Owner membership in an open store of this partner: 2-factor is required (ACCESS.md §2). */
  is_owner: boolean
}

/** The active person with this email under the host's partner; at most one (user_email_key). */
export const selectSignInCandidate = async (tx: ScopedSql, partnerId: string, email: string): Promise<SignInCandidate | null> => {
  const rows = await tx<SignInCandidate[]>`
    select u.id, u.partner_id, u.name, u.email, u.password_hash, u.two_factor_method, u.locked_until,
      exists (
        select 1 from membership m join store s on s.id = m.store_id
        where m.user_id = u.id and m.role_key = 'owner' and m.status = 'active' and s.status <> 'closed'
      ) as is_owner
    from "user" u
    where u.partner_id = ${partnerId} and lower(u.email) = lower(${email}) and u.status = 'active'
  `
  return rows[0] ?? null
}

export interface UserSecondFactor {
  id: string
  partner_id: string
  name: string
  email: string
  phone: string | null
  two_factor_method: 'app' | 'sms' | null
  two_factor_secret_enc: string | null
  last_code_step: string | null
  locked_until: Date | null
  is_owner: boolean
}

export const selectUserSecondFactor = async (tx: ScopedSql, userId: string): Promise<UserSecondFactor | null> => {
  const rows = await tx<UserSecondFactor[]>`
    select u.id, u.partner_id, u.name, u.email, u.phone, u.two_factor_method, u.two_factor_secret_enc, u.last_code_step::text as last_code_step, u.locked_until,
      exists (
        select 1 from membership m join store s on s.id = m.store_id
        where m.user_id = u.id and m.role_key = 'owner' and m.status = 'active' and s.status <> 'closed'
      ) as is_owner
    from "user" u where u.id = ${userId} and u.status = 'active'
  `
  return rows[0] ?? null
}

export const markUserSignedIn = async (tx: ScopedSql, userId: string, now: Date): Promise<void> => {
  await tx`update "user" set last_sign_in_at = ${now}, failed_code_count = 0, locked_until = null where id = ${userId}`
}

/** Clears the wrong-code count and keeps the TOTP step; false when that step or a newer one was already spent. */
export const recordUserGoodCode = async (tx: ScopedSql, userId: string, step: number | null, now: Date): Promise<boolean> =>
  (await tx`
    update "user" set failed_code_count = 0, locked_until = null, last_sign_in_at = ${now},
      last_code_step = coalesce(${step}, last_code_step)
    where id = ${userId} and (${step}::bigint is null or last_code_step is null or last_code_step < ${step})
  `).count > 0

/** Counts a wrong code; the one that reaches `max` locks the person until `lockedUntil`. */
export const recordUserWrongCode = async (tx: ScopedSql, userId: string, max: number, lockedUntil: Date): Promise<{ triesLeft: number; locked: boolean }> => {
  const rows = await tx<{ failed_code_count: number }[]>`
    update "user" set failed_code_count = failed_code_count + 1,
      locked_until = case when failed_code_count + 1 >= ${max} then ${lockedUntil}::timestamptz else locked_until end
    where id = ${userId} returning failed_code_count
  `
  const count = rows[0]?.failed_code_count ?? max
  return count >= max ? { triesLeft: 0, locked: true } : { triesLeft: max - count, locked: false }
}

/** Enrolment's end: the method, its secret or number, and the start of a fresh count. */
export const setUserSecondFactor = async (tx: ScopedSql, userId: string, method: 'app' | 'sms', secretEnc: string | null, phone: string | null, step: number | null, now: Date): Promise<void> => {
  await tx`
    update "user" set two_factor_method = ${method}, two_factor_enrolled_at = ${now},
      two_factor_secret_enc = ${method === 'app' ? secretEnc : null}, phone = coalesce(${phone}, phone),
      last_code_step = ${step}, failed_code_count = 0, locked_until = null, last_sign_in_at = ${now}
    where id = ${userId}
  `
}

/** Making new backup codes deletes the old (ACCESS.md §4). */
export const replaceBackupCodes = async (tx: ScopedSql, user: { id: string; partnerId: string }, hashes: readonly string[]): Promise<void> => {
  await tx`delete from user_backup_code where user_id = ${user.id}`
  await tx`insert into user_backup_code (user_id, partner_id, code_hash) select ${user.id}, ${user.partnerId}, unnest(${pgArray(hashes)}::text[])`
}

/** Spends one unused code in the transaction that admits the session; returns how many are left, or null for no match. */
export const spendBackupCode = async (tx: ScopedSql, userId: string, hash: string, now: Date): Promise<number | null> => {
  const spent = await tx`update user_backup_code set used_at = ${now} where user_id = ${userId} and code_hash = ${hash} and used_at is null returning id`
  if (spent.length === 0) return null
  const [left] = await tx<{ n: number }[]>`select count(*)::int as n from user_backup_code where user_id = ${userId} and used_at is null`
  return left?.n ?? 0
}

export interface VerificationCodeRow {
  id: string
  code_hash: string
  attempts: number
  expires_at: Date
}

export const insertVerificationCode = async (
  tx: ScopedSql,
  code: { id: string; partnerId: string; userId: string; purpose: 'sign_in' | 'enrol_phone'; hash: string; expiresAt: Date; createdAt: Date },
): Promise<void> => {
  await tx`
    insert into verification_code (id, partner_id, subject_kind, subject_id, purpose, code_hash, expires_at, created_at)
    values (${code.id}, ${code.partnerId}, 'user', ${code.userId}, ${code.purpose}, ${code.hash}, ${code.expiresAt}, ${code.createdAt})
  `
}

/** The latest unused, unexpired code for this purpose; an older one is never accepted. */
export const selectLiveCode = async (tx: ScopedSql, userId: string, purpose: 'sign_in' | 'enrol_phone', now: Date): Promise<VerificationCodeRow | null> => {
  const rows = await tx<VerificationCodeRow[]>`
    select id, code_hash, attempts, expires_at from verification_code
    where subject_kind = 'user' and subject_id = ${userId} and purpose = ${purpose} and used_at is null and expires_at > ${now}
    order by created_at desc limit 1
  `
  return rows[0] ?? null
}

export const countCodesSince = async (tx: ScopedSql, userId: string, since: Date): Promise<number> => {
  const [row] = await tx<{ n: number }[]>`select count(*)::int as n from verification_code where subject_kind = 'user' and subject_id = ${userId} and created_at > ${since}`
  return row?.n ?? 0
}

export const bumpCodeAttempt = async (tx: ScopedSql, id: string): Promise<void> => {
  await tx`update verification_code set attempts = attempts + 1 where id = ${id}`
}

/** False when another request spent it first: a code is accepted once, however many arrive together. */
export const markCodeUsed = async (tx: ScopedSql, id: string, now: Date): Promise<boolean> =>
  (await tx`update verification_code set used_at = ${now} where id = ${id} and used_at is null`).count > 0
