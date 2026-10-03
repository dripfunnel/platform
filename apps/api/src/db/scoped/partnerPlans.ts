import type { PlanStatus } from '../schema/saas'
import type { Keyset } from '#core/cursor'
import { maxPageSize, pgArray, type ScopedSql } from './index'
import type { AmountKey, Entitlements, PlanVersionPrice } from './plans'

// The partner's own catalogue as the Plans screens read and change it (ui/platform/FIRST-RELEASE.md
// §7). Every query names the partner as well as running under its RLS scope.

export interface CatalogueRow {
  id: string
  name: string
  description: string | null
  status: PlanStatus
  trial_days: number
  version: number
  stores: number
  fee: number | null
  created_at: Date
}

const catalogueColumns = (tx: ScopedSql) => tx`
  p.id, p.name, p.description, p.status, p.trial_days, p.version, p.created_at,
  (select count(*)::int from store s where s.plan_id = p.id and s.status <> 'closed') as stores,
  (select amount from plan_fee f where f.plan_id = p.id) as fee
`

/**
 * One page of the catalogue, oldest first after the keyset cursor (core/cursor.ts). The cursor
 * holds milliseconds and plan.created_at microseconds, so both sides compare at milliseconds.
 */
export const selectCatalogue = (tx: ScopedSql, partnerId: string, after: Keyset | undefined, limit: number): Promise<CatalogueRow[]> =>
  tx<CatalogueRow[]>`
    select ${catalogueColumns(tx)} from plan p
    where p.partner_id = ${partnerId}
      ${after ? tx`and (date_trunc('milliseconds', p.created_at), p.id) > (${after.occurredAt}::timestamptz, ${after.id}::uuid)` : tx``}
    order by date_trunc('milliseconds', p.created_at), p.id limit ${limit}
  `

export const selectCataloguePlan = async (tx: ScopedSql, partnerId: string, id: string): Promise<CatalogueRow | null> =>
  (await tx<CatalogueRow[]>`select ${catalogueColumns(tx)} from plan p where p.partner_id = ${partnerId} and p.id = ${id}`)[0] ?? null

/** The Live plans a retiring plan's stores may move to: a choice list, so capped at a page. */
export const selectLivePlanChoices = (tx: ScopedSql, partnerId: string, except: string | null): Promise<{ id: string; name: string; version: number }[]> =>
  tx<{ id: string; name: string; version: number }[]>`
    select id, name, version from plan where partner_id = ${partnerId} and status = 'live' and id is distinct from ${except}
    order by name, id limit ${maxPageSize}
  `

/** The lowest fee the partner's contract charges today; null when no plan has one. */
export const selectLowestFee = async (tx: ScopedSql, partnerId: string): Promise<number | null> =>
  (await tx<{ amount: number | null }[]>`select min(amount) as amount from plan_fee where partner_id = ${partnerId}`)[0]?.amount ?? null

/** The currencies the partner's current plan versions are priced in. */
export const selectPlanCurrencies = async (tx: ScopedSql, partnerId: string): Promise<string[]> =>
  (await tx<{ currency: string }[]>`
    select distinct pp.currency from plan_price pp join plan p on p.id = pp.plan_id and pp.version = p.version
    where p.partner_id = ${partnerId} order by pp.currency
  `).map((r) => r.currency)

/** Each plan's current-version prices and values, keyed by plan id. */
export const selectCurrentVersions = async (tx: ScopedSql, planIds: readonly string[]): Promise<Map<string, { prices: PlanVersionPrice[]; entitlements: Partial<Entitlements> }>> => {
  const ids = pgArray(planIds)
  const prices = await tx<{ plan_id: string; currency: string; monthly_amount: number | null; yearly_amount: number | null }[]>`
    select pp.plan_id, pp.currency, pp.monthly_amount, pp.yearly_amount from plan_price pp join plan p on p.id = pp.plan_id and pp.version = p.version
    where p.id = any(${ids}::uuid[]) order by pp.currency
  `
  const values = await tx<{ plan_id: string; key: keyof Entitlements; enabled: boolean | null; amount: number | null }[]>`
    select e.plan_id, e.key, e.enabled, e.amount from plan_entitlement e join plan p on p.id = e.plan_id and e.version = p.version
    where p.id = any(${ids}::uuid[])
  `
  const out = new Map<string, { prices: PlanVersionPrice[]; entitlements: Partial<Entitlements> }>(planIds.map((id) => [id, { prices: [], entitlements: {} }]))
  for (const p of prices) out.get(p.plan_id)?.prices.push({ currency: p.currency, monthly: p.monthly_amount, yearly: p.yearly_amount })
  for (const v of values) {
    const entry = out.get(v.plan_id)
    if (entry) Object.assign(entry.entitlements, { [v.key]: v.enabled ?? v.amount })
  }
  return out
}

export interface ContractTerms {
  fee_currency: string | null
  powered_by_removable: boolean
  powered_by_note: 'contract' | 'firstYear' | null
  rates: Record<string, string>
}

export const selectContractTerms = async (tx: ScopedSql, partnerId: string): Promise<ContractTerms> => {
  const [c] = await tx<{ fee_currency: string; powered_by_removable: boolean; powered_by_note: 'contract' | 'firstYear' | null }[]>`
    select fee_currency, powered_by_removable, powered_by_note from partner_contract where partner_id = ${partnerId}
  `
  const rates = await tx<{ currency: string; per_fee_unit: string }[]>`select currency, per_fee_unit::text from partner_contract_rate where partner_id = ${partnerId}`
  return {
    fee_currency: c?.fee_currency ?? null,
    powered_by_removable: c?.powered_by_removable ?? false,
    powered_by_note: c?.powered_by_note ?? null,
    rates: Object.fromEntries(rates.map((r) => [r.currency, r.per_fee_unit])),
  }
}

export const selectCeilings = async (tx: ScopedSql): Promise<Partial<Record<AmountKey, number>>> =>
  Object.fromEntries((await tx<{ key: AmountKey; amount: number }[]>`select key, amount from plan_ceiling`).map((c) => [c.key, c.amount]))

/** The partner's Live plans, locked for the transaction. */
export const lockLivePlans = (tx: ScopedSql, partnerId: string): Promise<{ id: string }[]> =>
  tx<{ id: string }[]>`select id from plan where partner_id = ${partnerId} and status = 'live' order by id for update`

export const updatePlanText = async (tx: ScopedSql, planId: string, partnerId: string, name: string, description: string): Promise<void> => {
  await tx`update plan set name = ${name}, description = ${description} where id = ${planId} and partner_id = ${partnerId}`
}

export const updatePlanStatus = async (tx: ScopedSql, planId: string, partnerId: string, status: PlanStatus, retire: { at: Date; moveTo: string | null } | null): Promise<boolean> =>
  (await tx`
    update plan set status = ${status}, retire_at = ${retire?.at ?? null}, retire_move_to_plan_id = ${retire?.moveTo ?? null}
    where id = ${planId} and partner_id = ${partnerId} returning id
  `).length > 0

/**
 * SAAS §6.3: the stores on a plan move to a version at a date — each at its first renewal on or
 * after `atRenewalAfter`, or all `on` a date. A store with a change already scheduled (its own
 * downgrade, an earlier move) keeps it. The partner writes only these three columns (0015).
 */
export const scheduleSubscriptionMoves = (
  tx: ScopedSql,
  fromPlanId: string,
  to: { planId: string; version: number },
  when: { atRenewalAfter: Date } | { on: Date },
): Promise<{ store_id: string; change_at: Date }[]> =>
  tx<{ store_id: string; change_at: Date }[]>`
    update store_subscription set next_plan_id = ${to.planId}, next_plan_version = ${to.version},
      change_at = ${
        'on' in when
          ? tx`${when.on}::timestamptz`
          : tx`(select min(period_end + n * case interval when 'year' then interval '1 year' else interval '1 month' end)
                 from generate_series(0, 120) n
                 where period_end + n * case interval when 'year' then interval '1 year' else interval '1 month' end >= ${when.atRenewalAfter}::timestamptz)`
      }
    where plan_id = ${fromPlanId} and status <> 'cancelled' and next_plan_id is null
    returning store_id, change_at
  `
