import type { ProvisioningStep } from '#db/schema/saas'
import { pgArray, type ScopedSql } from './index'

// Merchant sign-up between its steps (SAAS.md §4.1) and the rows provisioning's first steps write
// (§5). System scope: there is no caller until the store exists.

export interface SignupRow {
  id: string
  partner_id: string
  stage: 'email' | 'store' | 'phone' | 'provisioning'
  name: string
  email: string
  password_hash: string
  email_code_hash: string | null
  email_code_expires_at: Date | null
  email_code_attempts: number
  store_name: string | null
  subdomain: string | null
  country: string | null
  phone: string | null
  phone_code_hash: string | null
  phone_code_expires_at: Date | null
  phone_code_attempts: number
  phone_codes_sent: Date[]
  store_id: string | null
  expires_at: Date
}

export const insertSignup = async (tx: ScopedSql, s: { partnerId: string; tokenHash: string; name: string; email: string; passwordHash: string; expiresAt: Date; now: Date }): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into signup (partner_id, token_hash, stage, name, email, password_hash, expires_at, created_at)
    values (${s.partnerId}, ${s.tokenHash}, 'email', ${s.name}, ${s.email}, ${s.passwordHash}, ${s.expiresAt}, ${s.now}) returning id
  `
  if (!row) throw new Error('signup: insert returned no row')
  return row.id
}

/** The live sign-up a cookie names under this partner, locked for the step that reads it. */
export const selectSignup = async (tx: ScopedSql, partnerId: string, tokenHash: string, now: Date): Promise<SignupRow | null> =>
  (await tx<SignupRow[]>`select * from signup where token_hash = ${tokenHash} and partner_id = ${partnerId} and expires_at > ${now} for update`)[0] ?? null

/** For the code email's deliverer: a fresh code's hash and expiry; false once the sign-up has moved on. */
export const setSignupEmailCode = async (tx: ScopedSql, signupId: string, codeHash: string, expiresAt: Date): Promise<boolean> =>
  (await tx`update signup set email_code_hash = ${codeHash}, email_code_expires_at = ${expiresAt}, email_code_attempts = 0 where id = ${signupId} and stage = 'email'`).count > 0

export const selectSignupForEmail = async (tx: ScopedSql, signupId: string): Promise<{ partner_id: string; email: string; stage: string; has_account: boolean } | null> =>
  (
    await tx<{ partner_id: string; email: string; stage: string; has_account: boolean }[]>`
      select s.partner_id, s.email, s.stage,
        exists (select 1 from "user" u where u.partner_id = s.partner_id and lower(u.email) = lower(s.email) and u.status in ('active', 'invited')) as has_account
      from signup s where s.id = ${signupId}
    `
  )[0] ?? null

export const bumpSignupAttempt = async (tx: ScopedSql, signupId: string, which: 'email' | 'phone'): Promise<void> => {
  if (which === 'email') await tx`update signup set email_code_attempts = email_code_attempts + 1 where id = ${signupId}`
  else await tx`update signup set phone_code_attempts = phone_code_attempts + 1 where id = ${signupId}`
}

export const advanceSignup = async (tx: ScopedSql, signupId: string, stage: SignupRow['stage'], fields: Partial<Pick<SignupRow, 'store_name' | 'subdomain' | 'country'>> = {}): Promise<void> => {
  await tx`
    update signup set stage = ${stage}, email_code_hash = null, phone_code_hash = null,
      store_name = coalesce(${fields.store_name ?? null}, store_name), subdomain = coalesce(${fields.subdomain ?? null}, subdomain), country = coalesce(${fields.country ?? null}, country)
    where id = ${signupId}
  `
}

export const setSignupPhoneCode = async (tx: ScopedSql, signupId: string, phone: string, codeHash: string, expiresAt: Date, sentAt: Date): Promise<void> => {
  await tx`
    update signup set phone = ${phone}, phone_code_hash = ${codeHash}, phone_code_expires_at = ${expiresAt}, phone_code_attempts = 0,
      phone_codes_sent = (array_append(phone_codes_sent, ${sentAt}::timestamptz))[greatest(cardinality(phone_codes_sent) - 4, 1):]
    where id = ${signupId}
  `
}

/** Whether the partner already has a store at this web address (store_code_key), or a sign-up holding it. */
export const subdomainTaken = async (tx: ScopedSql, partnerId: string, subdomain: string, signupId: string, now: Date): Promise<boolean> =>
  (
    await tx`
      select 1 from store where partner_id = ${partnerId} and code = ${subdomain}
      union all
      select 1 from signup where partner_id = ${partnerId} and subdomain = ${subdomain} and id <> ${signupId} and expires_at > ${now} and stage in ('phone', 'provisioning')
      limit 1
    `
  ).length > 0

export const storeCodeTaken = async (tx: ScopedSql, partnerId: string, code: string): Promise<boolean> =>
  (await tx`select 1 from store where partner_id = ${partnerId} and code = ${code}`).length > 0

/** The partner's live plans with a monthly price in this currency, cheapest first. */
export const selectSignupPlan = async (tx: ScopedSql, partnerId: string, currency: string): Promise<{ id: string; version: number; trial_days: number; monthly: number } | null> =>
  (
    await tx<{ id: string; version: number; trial_days: number; monthly: number }[]>`
      select p.id, p.version, v.trial_days, pp.monthly_amount as monthly
      from plan p join plan_version v on v.plan_id = p.id and v.version = p.version
      join plan_price pp on pp.plan_id = p.id and pp.version = p.version and pp.currency = ${currency}
      where p.partner_id = ${partnerId} and p.status = 'live' and pp.monthly_amount is not null
      order by pp.monthly_amount, p.id limit 1
    `
  )[0] ?? null

/** The currencies the partner's live plans are priced in: the countries sign-up offers. */
export const selectSignupCurrencies = async (tx: ScopedSql, partnerId: string): Promise<string[]> =>
  (
    await tx<{ currency: string }[]>`
      select distinct pp.currency from plan p join plan_price pp on pp.plan_id = p.id and pp.version = p.version
      where p.partner_id = ${partnerId} and p.status = 'live' and pp.monthly_amount is not null
    `
  ).map((r) => r.currency)

export const selectPartnerState = async (tx: ScopedSql, partnerId: string): Promise<string | null> =>
  (await tx<{ state: string }[]>`select state from partner where id = ${partnerId}`)[0]?.state ?? null

// SAAS.md §5 step 1, inside provisioning's one transaction.

export const insertSignupUser = async (tx: ScopedSql, u: { partnerId: string; email: string; name: string; passwordHash: string; phone: string; now: Date }): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into "user" (partner_id, email, name, status, password_hash, phone, email_verified_at, password_changed_at)
    values (${u.partnerId}, ${u.email}, ${u.name}, 'active', ${u.passwordHash}, ${u.phone}, ${u.now}, ${u.now}) returning id
  `
  if (!row) throw new Error('user: insert returned no row')
  return row.id
}

export const insertActiveOwnerMembership = async (tx: ScopedSql, userId: string, storeId: string): Promise<void> => {
  await tx`insert into membership (user_id, store_id, role_key, status) values (${userId}, ${storeId}, 'owner', 'active')`
}

export const insertRunningJob = async (tx: ScopedSql, storeId: string, steps: readonly ProvisioningStep[], at: Date): Promise<string> => {
  const [first] = steps
  if (!first) throw new Error('job: no steps')
  const [row] = await tx<{ id: string }[]>`
    insert into job (store_id, kind, state, steps, step, step_started_at, started_at) values (${storeId}, 'provision-store', 'running', ${pgArray(steps)}::text[], ${first}, ${at}, ${at}) returning id
  `
  if (!row) throw new Error('job: insert returned no row')
  return row.id
}

export const moveJobTo = async (tx: ScopedSql, jobId: string, step: ProvisioningStep, at: Date): Promise<void> => {
  await tx`update job set step = ${step}, step_started_at = ${at} where id = ${jobId}`
}

export const finishJob = async (tx: ScopedSql, jobId: string, at: Date): Promise<void> => {
  await tx`update job set state = 'done', finished_at = ${at} where id = ${jobId}`
}

/** SAAS.md §5 step 8's last act for these first steps: the answers go once the store exists. */
export const deleteSignup = async (tx: ScopedSql, signupId: string): Promise<void> => {
  await tx`delete from signup where id = ${signupId}`
}

/** Sign-ups nobody finished, past their day: the cron clears them with their password hashes. */
export const deleteExpiredSignups = async (tx: ScopedSql, now: Date, limit: number): Promise<number> =>
  (await tx`delete from signup where id in (select id from signup where expires_at <= ${now} order by expires_at limit ${limit})`).count
