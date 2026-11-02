import type { ScopedSql } from './index'

// A partner user's own name and password (#1053). The name is the partner role's to write; the password and
// sessions are system scope only, as sign-in and reset are.

export const setPartnerUserName = async (tx: ScopedSql, partnerUserId: string, partnerId: string, name: string): Promise<boolean> =>
  (await tx`update partner_user set name = ${name} where id = ${partnerUserId} and partner_id = ${partnerId} and status = 'active'`).count === 1

export interface PasswordState {
  id: string
  partner_id: string
  email: string
  password_hash: string | null
  locked_until: Date | null
}

/** Locks the row, so two changes or a change and a wrong code can't both read it unlocked. */
export const selectPasswordState = async (tx: ScopedSql, partnerUserId: string): Promise<PasswordState | null> =>
  (await tx<PasswordState[]>`select id, partner_id, email, password_hash, locked_until from partner_user where id = ${partnerUserId} and status = 'active' for update`)[0] ?? null

/** The new password, the wrong-try count cleared, and every session of the user but this one ended (ACCESS.md §2). */
export const setPartnerPassword = async (tx: ScopedSql, partnerUserId: string, passwordHash: string, keepSessionHash: string | null): Promise<number> => {
  await tx`update partner_user set password_hash = ${passwordHash}, failed_code_count = 0 where id = ${partnerUserId}`
  return (await tx`delete from partner_session where partner_user_id = ${partnerUserId} and id_hash is distinct from ${keepSessionHash}`).count
}
