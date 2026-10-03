import type { ScopedSql } from './index'

// The catalogue of migrations/0013 (SAAS.md §6.1, §6.3).
export const switchKeys = ['custom_domain', 'offers', 'suppliers_enabled', 'powered_by_removal', 'aplus', 'size_charts'] as const
export const amountKeys = ['products', 'staff', 'suppliers', 'languages', 'currencies', 'publish_now', 'ai_prompts'] as const
export type SwitchKey = (typeof switchKeys)[number]
export type AmountKey = (typeof amountKeys)[number]
export type Entitlements = Record<SwitchKey, boolean> & Record<AmountKey, number>

/** Minor units per currency; null is "Not priced". */
export interface PlanVersionPrice {
  currency: string
  monthly: number | null
  yearly: number | null
}

export interface NewPlanVersion {
  planId: string
  partnerId: string
  trialDays: number
  prices: readonly PlanVersionPrice[]
  entitlements: Entitlements
  by: { kind: 'partner_user' | 'staff' | 'system'; label: string }
}

/** One version's prices and values; its `plan_version` row too unless it is the first, which the plan's own trigger writes. */
export const writeVersionRows = async (tx: ScopedSql, v: Omit<NewPlanVersion, 'entitlements'> & { version: number; entitlements: Entitlements | null }): Promise<void> => {
  if (v.version > 1) {
    await tx`
      insert into plan_version (plan_id, partner_id, version, trial_days, created_by_kind, created_by_label)
      values (${v.planId}, ${v.partnerId}, ${v.version}, ${v.trialDays}, ${v.by.kind}, ${v.by.label})
    `
  }
  const base = { plan_id: v.planId, partner_id: v.partnerId, version: v.version }
  if (v.prices.length > 0) {
    const prices = v.prices.map((p) => ({ ...base, currency: p.currency, monthly_amount: p.monthly, yearly_amount: p.yearly }))
    await tx`insert into plan_price ${tx(prices, 'plan_id', 'partner_id', 'version', 'currency', 'monthly_amount', 'yearly_amount')}`
  }
  const values = v.entitlements
  if (!values) return
  const rows = [
    ...switchKeys.map((key) => ({ ...base, key, enabled: values[key], amount: null })),
    ...amountKeys.map((key) => ({ ...base, key, enabled: null, amount: values[key] })),
  ]
  await tx`insert into plan_entitlement ${tx(rows, 'plan_id', 'partner_id', 'version', 'key', 'enabled', 'amount')}`
}

/** The next version, under the plan's row lock so concurrent edits never share a number (SAAS §6.3). */
export const insertPlanVersion = async (tx: ScopedSql, v: NewPlanVersion): Promise<number> => {
  const [row] = await tx<{ version: number }[]>`
    update plan set version = version + 1, trial_days = ${v.trialDays}
    where id = ${v.planId} and partner_id = ${v.partnerId}
    returning version
  `
  if (!row) throw new Error('plan version: no such plan in scope')
  await writeVersionRows(tx, { ...v, version: row.version })
  return row.version
}

/** In the contract's fee currency, which the fee then holds (a contract must exist). */
export const setPlanFee = async (tx: ScopedSql, planId: string, partnerId: string, amount: number): Promise<void> => {
  const rows = await tx`
    insert into plan_fee (plan_id, partner_id, amount, currency)
    select ${planId}, ${partnerId}, ${amount}, fee_currency from partner_contract where partner_id = ${partnerId}
    on conflict (plan_id) do update set amount = excluded.amount, currency = excluded.currency
    returning plan_id
  `
  if (rows.length === 0) throw new Error('plan fee: the partner has no contract')
}

export const setPlanCeiling = async (tx: ScopedSql, key: AmountKey, amount: number): Promise<void> => {
  await tx`insert into plan_ceiling (key, amount) values (${key}, ${amount}) on conflict (key) do update set amount = excluded.amount`
}

export interface PartnerContract {
  partnerId: string
  feeCurrency: string
  poweredByRemovable: boolean
  poweredByNote: 'contract' | 'firstYear' | null
  /** Units of each other currency per unit of the fee currency, as a decimal string. */
  rates: Record<string, string>
}

export const setPartnerContract = async (tx: ScopedSql, c: PartnerContract): Promise<void> => {
  await tx`
    insert into partner_contract (partner_id, fee_currency, powered_by_removable, powered_by_note)
    values (${c.partnerId}, ${c.feeCurrency}, ${c.poweredByRemovable}, ${c.poweredByNote})
    on conflict (partner_id) do update set fee_currency = excluded.fee_currency,
      powered_by_removable = excluded.powered_by_removable, powered_by_note = excluded.powered_by_note
  `
  for (const [currency, rate] of Object.entries(c.rates)) {
    await tx`
      insert into partner_contract_rate (partner_id, currency, per_fee_unit) values (${c.partnerId}, ${currency}, ${rate}::numeric)
      on conflict (partner_id, currency) do update set per_fee_unit = excluded.per_fee_unit
    `
  }
}

export interface PlanVersionRead {
  version: number
  trialDays: number
  prices: PlanVersionPrice[]
  entitlements: Partial<Entitlements>
}

export const selectPlanVersion = async (tx: ScopedSql, planId: string, version: number): Promise<PlanVersionRead | null> => {
  const [head] = await tx<{ trial_days: number }[]>`select trial_days from plan_version where plan_id = ${planId} and version = ${version}`
  if (!head) return null
  const prices = await tx<{ currency: string; monthly_amount: number | null; yearly_amount: number | null }[]>`
    select currency, monthly_amount, yearly_amount from plan_price where plan_id = ${planId} and version = ${version} order by currency
  `
  const rows = await tx<{ key: SwitchKey | AmountKey; enabled: boolean | null; amount: number | null }[]>`
    select key, enabled, amount from plan_entitlement where plan_id = ${planId} and version = ${version}
  `
  return {
    version,
    trialDays: head.trial_days,
    prices: prices.map((p) => ({ currency: p.currency, monthly: p.monthly_amount, yearly: p.yearly_amount })),
    entitlements: Object.fromEntries(rows.map((r) => [r.key, r.enabled ?? r.amount])),
  }
}
