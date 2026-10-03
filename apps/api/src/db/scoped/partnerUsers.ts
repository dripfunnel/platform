import type { PartnerState } from '../schema/saas'
import type { ScopedSql } from './index'

export interface PartnerCallerRow {
  id: string
  name: string
  email: string
  role_key: string
  partner_id: string
  partner_name: string
  product_name: string | null
  state: PartnerState
  sent_back_reason: string | null
  portal_host: string | null
}

/** An active partner user of a partner that is not closed, with what `me` shows of the partner. */
export const selectPartnerCaller = async (tx: ScopedSql, partnerUserId: string): Promise<PartnerCallerRow | null> => {
  const rows = await tx<PartnerCallerRow[]>`
    select u.id, u.name, u.email, u.role_key, p.id as partner_id, p.name as partner_name, p.product_name,
           p.state, p.sent_back_reason, d.host as portal_host
    from partner_user u
    join partner p on p.id = u.partner_id
    left join partner_domain d on d.partner_id = p.id and d.kind = 'portal'
    where u.id = ${partnerUserId} and u.status = 'active' and p.state <> 'closed'
  `
  return rows[0] ?? null
}

export const partnerOfUser = async (tx: ScopedSql, partnerUserId: string): Promise<string | null> => {
  const rows = await tx<{ partner_id: string }[]>`select partner_id from partner_user where id = ${partnerUserId}`
  return rows[0]?.partner_id ?? null
}

export interface SignInCandidate {
  id: string
  partner_id: string
  email: string
  password_hash: string | null
  has_second_factor: boolean
  second_factor_required: boolean
  locked_until: Date | null
}

/** How many accounts one email is checked against; sign-in always runs this many derivations. */
export const signInCandidateLimit = 3

/** Every active account with this email whose partner is not closed: the email is unique per partner only (ACCESS.md §2). */
export const selectSignInCandidates = async (tx: ScopedSql, email: string): Promise<SignInCandidate[]> =>
  tx<SignInCandidate[]>`
    select u.id, u.partner_id, u.email, u.password_hash, u.two_factor_secret_enc is not null as has_second_factor,
           p.second_factor_required, u.locked_until
    from partner_user u join partner p on p.id = u.partner_id
    where lower(u.email) = lower(${email}) and u.status = 'active' and p.state <> 'closed'
    order by u.last_sign_in_at desc nulls last, u.created_at
    limit ${signInCandidateLimit}
  `

export interface SecondFactorState {
  id: string
  partner_id: string
  email: string
  two_factor_secret_enc: string | null
  locked_until: Date | null
  last_code_step: string | null
}

/** Locks the row for the transaction, so parallel codes cannot all read it unlocked or replay one step. */
export const selectSecondFactorState = async (tx: ScopedSql, partnerUserId: string): Promise<SecondFactorState | null> => {
  const rows = await tx<SecondFactorState[]>`
    select id, partner_id, email, two_factor_secret_enc, locked_until, last_code_step::text from partner_user
    where id = ${partnerUserId} and status = 'active'
    for update
  `
  return rows[0] ?? null
}

/** Counts a wrong code; the one that reaches the limit locks and starts the count again. */
export const recordWrongCode = async (tx: ScopedSql, partnerUserId: string, limit: number, lockedUntil: Date): Promise<{ triesLeft: number; locked: boolean }> => {
  const rows = await tx<{ failed_code_count: number; locked_until: Date | null }[]>`
    update partner_user set
      locked_until = case when failed_code_count + 1 >= ${limit} then ${lockedUntil} else locked_until end,
      failed_code_count = case when failed_code_count + 1 >= ${limit} then 0 else failed_code_count + 1 end
    where id = ${partnerUserId}
    returning failed_code_count, locked_until
  `
  const row = rows[0]
  const locked = row?.locked_until?.getTime() === lockedUntil.getTime()
  return { triesLeft: locked ? 0 : limit - (row?.failed_code_count ?? 0), locked }
}

/** A good code, or a finished enrolment: the count starts again and the step cannot be replayed. */
export const recordGoodCode = async (tx: ScopedSql, partnerUserId: string, step: number, now: Date, enrolledSecretEnc: string | null = null): Promise<void> => {
  await tx`
    update partner_user set failed_code_count = 0, last_code_step = ${step}, last_sign_in_at = ${now},
      two_factor_secret_enc = coalesce(${enrolledSecretEnc}, two_factor_secret_enc),
      two_factor_enrolled_at = case when ${enrolledSecretEnc}::text is null then two_factor_enrolled_at else ${now} end
    where id = ${partnerUserId}
  `
}

export const markPartnerSignedIn = async (tx: ScopedSql, partnerUserId: string, now: Date): Promise<void> => {
  await tx`update partner_user set last_sign_in_at = ${now} where id = ${partnerUserId}`
}
