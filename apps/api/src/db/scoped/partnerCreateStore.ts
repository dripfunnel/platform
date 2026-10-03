import type { ProvisioningStep } from '../schema/saas'
import { maxPageSize, pgArray, type ScopedSql } from './index'

// A store created from the partner console (ui/platform/FIRST-RELEASE.md §6.2; card #221), as
// app_partner: 0026 grants these inserts by column, so each writes exactly those columns.

export interface CreatablePlan {
  id: string
  name: string
  version: number
  trial_days: number
  prices: { currency: string; monthly: number }[]
}

/** The partner's Live plans at their current version, with every monthly price; one plan when `planId` is given. */
export const selectCreatablePlans = async (tx: ScopedSql, partnerId: string, planId: string | null = null): Promise<CreatablePlan[]> => {
  const plans = await tx<Omit<CreatablePlan, 'prices'>[]>`
    select p.id, p.name, p.version, v.trial_days from plan p join plan_version v on v.plan_id = p.id and v.version = p.version
    where p.partner_id = ${partnerId} and p.status = 'live' ${planId ? tx`and p.id = ${planId}` : tx``}
    order by p.name, p.id limit ${maxPageSize}
  `
  const prices = await tx<{ plan_id: string; currency: string; monthly: number }[]>`
    select pp.plan_id, pp.currency, pp.monthly_amount as monthly from plan_price pp join plan p on p.id = pp.plan_id and pp.version = p.version
    where p.partner_id = ${partnerId} and p.status = 'live' and pp.monthly_amount is not null ${planId ? tx`and p.id = ${planId}` : tx``}
    order by pp.currency
  `
  return plans.map((p) => ({ ...p, prices: prices.filter((x) => x.plan_id === p.id).map(({ currency, monthly }) => ({ currency, monthly })) }))
}

export const lockPartnerStores = async (tx: ScopedSql, partnerId: string): Promise<void> => {
  await tx`select pg_advisory_xact_lock(hashtext(${`partner_stores:${partnerId}`}))`
}

/** `base`, or `base-2`, `base-3`… the first code the partner hasn't used. */
export const freeStoreCode = async (tx: ScopedSql, partnerId: string, base: string): Promise<string> => {
  const taken = new Set(
    (await tx<{ code: string }[]>`select code from store where partner_id = ${partnerId} and (code = ${base} or code like ${`${base}-%`})`).map((r) => r.code),
  )
  let n = 1
  while (taken.has(n === 1 ? base : `${base}-${n}`)) n += 1
  return n === 1 ? base : `${base}-${n}`
}

export interface NewPartnerStore {
  partnerId: string
  name: string
  code: string
  country: string
  planId: string
  status: 'trial' | 'active'
  trialEndsAt: Date | null
  createdAt: Date
}

export const insertPartnerStore = async (tx: ScopedSql, s: NewPartnerStore): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into store (partner_id, name, code, country, status, plan_id, trial_ends_at, storefront_kind, created_at)
    values (${s.partnerId}, ${s.name}, ${s.code}, ${s.country}, ${s.status}, ${s.planId}, ${s.trialEndsAt}, 'ai', ${s.createdAt})
    returning id
  `
  if (!row) throw new Error('store: insert returned no row')
  return row.id
}

/**
 * The person this email already is under the partner (ACCESS §6.2's join path), or a new invited
 * one; null when that person is suspended or deleted, who can't accept an invitation.
 */
export const ownerPerson = async (tx: ScopedSql, partnerId: string, email: string, name: string): Promise<string | null> => {
  const [known] = await tx<{ id: string; status: string }[]>`select id, status from "user" where partner_id = ${partnerId} and lower(email) = lower(${email})`
  if (known) return known.status === 'invited' || known.status === 'active' ? known.id : null
  const [row] = await tx<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${name}, 'invited') returning id`
  if (!row) throw new Error('user: insert returned no row')
  return row.id
}

export const insertOwnerMembership = async (tx: ScopedSql, userId: string, storeId: string): Promise<void> => {
  await tx`insert into membership (user_id, store_id, role_key, status) values (${userId}, ${storeId}, 'owner', 'invited')`
}

export interface NewTrialSubscription {
  storeId: string
  partnerId: string
  planId: string
  planVersion: number
  status: 'trial' | 'active'
  currency: string
  amount: number
  periodStart: Date
  periodEnd: Date
  trialEndsAt: Date | null
}

export const insertNewSubscription = async (tx: ScopedSql, s: NewTrialSubscription): Promise<void> => {
  await tx`
    insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end, trial_ends_at)
    values (${s.storeId}, ${s.partnerId}, ${s.planId}, ${s.planVersion}, ${s.status}, 'month', ${s.currency}, ${s.amount}, ${s.periodStart}, ${s.periodEnd}, ${s.trialEndsAt})
  `
}

/** The setup job, its steps already done: what they do today happens in the creating transaction. */
export const insertFinishedJob = async (tx: ScopedSql, storeId: string, steps: readonly ProvisioningStep[], at: Date): Promise<void> => {
  const last = steps.at(-1)
  if (!last) throw new Error('job: no steps')
  await tx`
    insert into job (store_id, kind, state, steps, step, step_started_at, started_at, finished_at)
    values (${storeId}, 'provision-store', 'done', ${pgArray(steps)}::text[], ${last}, ${at}, ${at}, ${at})
  `
}

export interface ProvisioningRow {
  storefront_kind: 'ai' | 'own'
  build_state: string | null
  created_at: Date
  state: string | null
  steps: string[] | null
  step: string | null
  started_at: Date | null
  finished_at: Date | null
}

export const selectProvisioning = async (tx: ScopedSql, partnerId: string, storeId: string): Promise<ProvisioningRow | null> =>
  (
    await tx<ProvisioningRow[]>`
      select s.storefront_kind, s.build_state, s.created_at, j.state, j.steps, j.step, j.started_at, j.finished_at
      from store s left join lateral (select * from job where store_id = s.id order by started_at desc limit 1) j on true
      where s.partner_id = ${partnerId} and s.id = ${storeId}
    `
  )[0] ?? null
