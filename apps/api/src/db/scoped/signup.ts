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
  password_hash: string | null
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
  store_id: string | null
  expires_at: Date
}

// A Google sign-up starts at the store step with no password: Google proved the address (ACCESS.md §2).
export const insertSignup = async (tx: ScopedSql, s: { partnerId: string; tokenHash: string; name: string; email: string; passwordHash: string | null; stage?: 'email' | 'store'; expiresAt: Date; now: Date }): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into signup (partner_id, token_hash, stage, name, email, password_hash, expires_at, created_at)
    values (${s.partnerId}, ${s.tokenHash}, ${s.stage ?? 'email'}, ${s.name}, ${s.email}, ${s.passwordHash}, ${s.expiresAt}, ${s.now}) returning id
  `
  if (!row) throw new Error('signup: insert returned no row')
  return row.id
}

/** The live sign-up a cookie names under this partner, locked for the step that reads it. */
export const selectSignup = async (tx: ScopedSql, partnerId: string, tokenHash: string, now: Date): Promise<SignupRow | null> =>
  (
    await tx<SignupRow[]>`
      select id, partner_id, stage, name, email, password_hash, email_code_hash, email_code_expires_at, email_code_attempts, store_name, subdomain, country,
        phone, phone_code_hash, phone_code_expires_at, phone_code_attempts, store_id, expires_at
      from signup where token_hash = ${tokenHash} and partner_id = ${partnerId} and expires_at > ${now} for update
    `
  )[0] ?? null

/** Sign-up texts since `since`, for one sign-up, one number or the whole partner (the three limits in signup.ts). */
export const countSignupTextsSince = async (tx: ScopedSql, partnerId: string, since: Date, by: { signupId?: string; phone?: string }): Promise<number> =>
  (
    await tx<{ n: number }[]>`
      select count(*)::int as n from signup_text
      where partner_id = ${partnerId} and sent_at > ${since}
        and ${by.signupId ? tx`signup_id = ${by.signupId}` : tx`true`}
        and ${by.phone ? tx`phone = ${by.phone}` : tx`true`}
    `
  )[0]?.n ?? 0

/** Sign-ups started under the partner since `since`: a cap on starts, beside the per-address and per-client ones. */
export const countSignupsSince = async (tx: ScopedSql, partnerId: string, since: Date): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from signup where partner_id = ${partnerId} and created_at > ${since}`)[0]?.n ?? 0

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

export const setSignupPhoneCode = async (tx: ScopedSql, s: { id: string; partnerId: string }, phone: string, codeHash: string, expiresAt: Date, sentAt: Date): Promise<void> => {
  await tx`update signup set phone = ${phone}, phone_code_hash = ${codeHash}, phone_code_expires_at = ${expiresAt}, phone_code_attempts = 0 where id = ${s.id}`
  await tx`insert into signup_text (partner_id, signup_id, phone, sent_at) values (${s.partnerId}, ${s.id}, ${phone}, ${sentAt})`
}

/** Whether any store, or any other sign-up in progress, across every partner, holds this web address (store.slug). Never says whose. */
export const subdomainTaken = async (tx: ScopedSql, subdomain: string, signupId: string | null): Promise<boolean> =>
  (await tx<{ taken: boolean }[]>`select store_slug_taken(${subdomain}, ${signupId}) as taken`)[0]?.taken ?? true

export const storeCodeTaken = async (tx: ScopedSql, partnerId: string, code: string): Promise<boolean> =>
  (await tx`select 1 from store where partner_id = ${partnerId} and code = ${code}`).length > 0

/** A store, in any partner, already has this slug; sign-ups in progress don't count, the one being made is among them. */
export const storeSlugTaken = async (tx: ScopedSql, slug: string): Promise<boolean> =>
  (await tx<{ taken: boolean }[]>`select store_slug_in_use(${slug}) as taken`)[0]?.taken ?? true

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

/** Stores made under the partner since `since`: the hour's cap for a signed-in person's next store (#1136). */
export const countStoresCreatedSince = async (tx: ScopedSql, partnerId: string, since: Date): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from store where partner_id = ${partnerId} and created_at > ${since}`)[0]?.n ?? 0

/** Stores made since `since` that this person owns: Create another store's one a day (#1136). */
export const countOwnStoresSince = async (tx: ScopedSql, userId: string, since: Date): Promise<number> =>
  (
    await tx<{ n: number }[]>`
      select count(*)::int as n from store s join membership m on m.store_id = s.id and m.user_id = ${userId} and m.role_key = 'owner' and m.status = 'active'
      where s.created_at > ${since}
    `
  )[0]?.n ?? 0

/** The store at this address that this person was just made Owner of, so a retried creation answers it again (#1136). */
export const selectOwnNewStore = async (tx: ScopedSql, partnerId: string, userId: string, slug: string, since: Date): Promise<string | null> =>
  (
    await tx<{ id: string }[]>`
      select s.id from store s join membership m on m.store_id = s.id and m.user_id = ${userId} and m.role_key = 'owner' and m.status = 'active'
      where s.partner_id = ${partnerId} and lower(s.slug) = lower(${slug}) and s.created_at > ${since}
    `
  )[0]?.id ?? null

// SAAS.md §5 step 1, inside provisioning's one transaction.

export const insertSignupUser = async (tx: ScopedSql, u: { partnerId: string; email: string; name: string; passwordHash: string | null; phone: string; now: Date }): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into "user" (partner_id, email, name, status, password_hash, phone, email_verified_at, password_changed_at)
    values (${u.partnerId}, ${u.email}, ${u.name}, 'active', ${u.passwordHash}, ${u.phone}, ${u.now}, ${u.passwordHash === null ? null : u.now}) returning id
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

/** Sign-ups nobody finished, past their day, with their password hashes; and text records past theirs. How many rows of both. */
export const deleteExpiredSignups = async (tx: ScopedSql, now: Date, limit: number): Promise<number> => {
  const texts = await tx`delete from signup_text where id in (select id from signup_text where sent_at <= ${new Date(now.getTime() - 24 * 60 * 60 * 1000)} order by sent_at limit ${limit})`
  return texts.count + (await tx`delete from signup where id in (select id from signup where expires_at <= ${now} order by expires_at limit ${limit})`).count
}
