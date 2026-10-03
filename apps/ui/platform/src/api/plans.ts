import type { Money } from '@dripfunnel/shared/format'
import { ApiError } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'

// The Plans operations on the Platform API (FIRST-RELEASE.md §7, §16): the catalogue, one plan with
// DripFunnel's ceilings, prices quoted with the fee and margin, and the save, make-live and retire mutations.
export const planStatuses = ['draft', 'live', 'retired'] as const
export type PlanStatus = (typeof planStatuses)[number]

export const toggleKeys = ['domain', 'offers', 'suppliersOn', 'powered', 'aplus', 'size'] as const
export const limitKeys = ['products', 'staff', 'suppliers', 'languages', 'currencies'] as const
export const allowanceKeys = ['publish', 'ai'] as const
export type ToggleKey = (typeof toggleKeys)[number]
export type NumberKey = (typeof limitKeys)[number] | (typeof allowanceKeys)[number]
export type EntitlementKey = ToggleKey | NumberKey

// The three kinds of SAAS.md §6.1, in the prototype's row order.
export const entitlementRows: readonly { key: EntitlementKey; kind: 'toggle' | 'limit' | 'allowance' }[] = [
  ...toggleKeys.map((key) => ({ key, kind: 'toggle' as const })),
  ...limitKeys.map((key) => ({ key, kind: 'limit' as const })),
  ...allowanceKeys.map((key) => ({ key, kind: 'allowance' as const })),
]

export type PlanEntitlements = Record<ToggleKey, boolean> & Record<NumberKey, number>

// Beside each price: DripFunnel's fee and the partner's margin, both the API's (§7.2; CONSOLE-DESIGN G3).
export interface PlanPrice {
  currency: string
  monthly: Money | null
  yearly: Money | null
  // Null while DripFunnel has no fee for this currency yet (no contract fee, or no rate for it).
  fee: Money | null
  // A second currency's fee is converted at the contract rate.
  converted: boolean
  margin: { kind: 'keep'; amount: Money; of: Money } | { kind: 'loss'; amount: Money } | { kind: 'unpriced' } | { kind: 'noFee' }
}

export interface PlanRow {
  id: string
  name: string
  description: string
  status: PlanStatus
  trialDays: number
  prices: readonly PlanPrice[]
  stores: number
}

export interface Plan extends PlanRow {
  entitlements: PlanEntitlements
}

// DripFunnel's maximum per entitlement (SAAS.md §6.1), null where it sets none, and what the
// contract says about "Powered by".
export type PlanCeilings = Record<NumberKey, number | null> & {
  powered: { allowed: boolean; note: 'contract' | 'firstYear' | null }
}

export const planRefusals = ['OWNERS_AND_ADMINS_ONLY', 'PRICES_ONLY', 'ABOVE_CEILING', 'LAST_LIVE_PLAN', 'UNPRICED_CURRENCY', 'NEEDS_APPLY_TO'] as const

// What saving, making live or retiring can also answer: the plan moved on, or the input was refused.
const settledRefusals = ['NOT_FOUND', 'INVALID_STATE', 'INVALID_TARGET', 'INVALID_CURRENCY', 'INVALID_INPUT'] as const
export type SettledRefusal = (typeof settledRefusals)[number]
export type PlanRefusal = (typeof planRefusals)[number]

export type PlanPermission = { allowed: true } | { allowed: false; reason: PlanRefusal }

export interface PlansPage {
  items: readonly PlanRow[]
  chargedBy: string
  actions: { create: PlanPermission }
}

export interface PlanEditor {
  // null for a new plan.
  plan: Plan | null
  ceilings: PlanCeilings
  currencies: readonly string[]
  trials: readonly number[]
  chargedBy: string
  // Owner and Admin edit everything; Finance has `price` only (ACCESS.md §5.3).
  permission: { edit: PlanPermission; price: PlanPermission }
  // Live plans this one's stores could move to when it retires, and the dates offered.
  retireTargets: readonly { id: string; name: string }[]
  retireDates: readonly string[]
}

const money = z.object({ amount: z.number().int().min(0), currency: z.string().min(3).max(3) })

export const planInput = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(140),
  trialDays: z.number().int().min(0).max(90),
  prices: z.array(z.object({ currency: z.string().min(3).max(3), monthly: money.nullable(), yearly: money.nullable() })),
  entitlements: z.object({
    domain: z.boolean(),
    offers: z.boolean(),
    suppliersOn: z.boolean(),
    powered: z.boolean(),
    aplus: z.boolean(),
    size: z.boolean(),
    products: z.number().int().min(0),
    staff: z.number().int().min(0),
    suppliers: z.number().int().min(0),
    languages: z.number().int().min(0),
    currencies: z.number().int().min(0),
    publish: z.number().int().min(0),
    ai: z.number().int().min(0),
  }),
})
export type PlanInput = z.infer<typeof planInput>

// Who gets a change to a plan stores are on (SAAS.md §6.3): new signups only, or everyone at renewal.
export type ApplyTo = 'new' | 'renewal'

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; reason: Exclude<PlanRefusal, 'ABOVE_CEILING' | 'LAST_LIVE_PLAN' | 'UNPRICED_CURRENCY'> | SettledRefusal }
  | { ok: false; reason: 'ABOVE_CEILING'; row: EntitlementKey }

// UNPRICED_CURRENCY names the currency missing a price, or none when the plan has no price at all.
export type MakeLiveResult = { ok: true } | { ok: false; reason: 'OWNERS_AND_ADMINS_ONLY' | SettledRefusal } | { ok: false; reason: 'UNPRICED_CURRENCY'; currency: string | null }

export type RetireInput = { keep: true } | { keep: false; moveTo: string; on: string }

export type RetireResult = { ok: true } | { ok: false; reason: 'OWNERS_AND_ADMINS_ONLY' | 'LAST_LIVE_PLAN' | SettledRefusal }

const moneyOut = z.object({ amount: z.number().int(), currency: z.string() })
const permission = z
  .object({ allowed: z.boolean(), reason: z.string().nullable() })
  .transform((p, ctx): PlanPermission => {
    if (p.allowed) return { allowed: true }
    const reason = z.enum(planRefusals).safeParse(p.reason)
    if (reason.success) return { allowed: false, reason: reason.data }
    ctx.addIssue({ code: 'custom', message: `unknown refusal ${p.reason ?? 'null'}` })
    return z.NEVER
  })

const priceSchema = z.object({
  currency: z.string(),
  monthly: moneyOut.nullable(),
  yearly: moneyOut.nullable(),
  fee: moneyOut.nullable(),
  converted: z.boolean(),
  margin: z
    .object({ kind: z.enum(['keep', 'loss', 'unpriced', 'noFee']), amount: moneyOut.nullable(), of: moneyOut.nullable() })
    .transform((m, ctx): PlanPrice['margin'] => {
      if (m.kind === 'unpriced' || m.kind === 'noFee') return { kind: m.kind }
      if (m.kind === 'loss' && m.amount) return { kind: 'loss', amount: m.amount }
      if (m.kind === 'keep' && m.amount && m.of) return { kind: 'keep', amount: m.amount, of: m.of }
      ctx.addIssue({ code: 'custom', message: `margin ${m.kind} without its amounts` })
      return z.NEVER
    }),
})
const priceFields = 'currency monthly { amount currency } yearly { amount currency } fee { amount currency } converted margin { kind amount { amount currency } of { amount currency } }'

const rowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.enum(planStatuses),
  trialDays: z.number().int().nonnegative(),
  prices: z.array(priceSchema),
  stores: z.number().int().nonnegative(),
})
const rowFields = `id name description status trialDays prices { ${priceFields} } stores`

const entitlementsSchema = z.object({
  domain: z.boolean(),
  offers: z.boolean(),
  suppliersOn: z.boolean(),
  powered: z.boolean(),
  aplus: z.boolean(),
  size: z.boolean(),
  products: z.number().int(),
  staff: z.number().int(),
  suppliers: z.number().int(),
  languages: z.number().int(),
  currencies: z.number().int(),
  publish: z.number().int(),
  ai: z.number().int(),
})
const entitlementFields = 'domain offers suppliersOn powered aplus size products staff suppliers languages currencies publish ai'

// The catalogue; the API pages it, and a partner has a handful of plans, so one page of its maximum is the list.
export const loadPlans = async (): Promise<PlansPage> => {
  const { plans } = await query(
    `{ plans(first: 50) { items { ${rowFields} } chargedBy create { allowed reason } } }`,
    z.object({ plans: z.object({ items: z.array(rowSchema), chargedBy: z.string(), create: permission }) }),
  )
  return { items: plans.items, chargedBy: plans.chargedBy, actions: { create: plans.create } }
}

const ceiling = z.number().int().nullable()
const editorSchema = z.object({
  planEditor: z
    .object({
      plan: z.object({ row: rowSchema, entitlements: entitlementsSchema }).nullable(),
      ceilings: z.object({ products: ceiling, staff: ceiling, suppliers: ceiling, languages: ceiling, currencies: ceiling, publish: ceiling, ai: ceiling }),
      powered: z.object({ allowed: z.boolean(), note: z.enum(['contract', 'firstYear']).nullable() }),
      currencies: z.array(z.string()),
      trials: z.array(z.number().int()),
      chargedBy: z.string(),
      edit: permission,
      price: permission,
      retireTargets: z.array(z.object({ id: z.string(), name: z.string() })),
      retireDates: z.array(z.string()),
    })
    .nullable(),
})

// `id` null is a new plan's editor; null back is a plan this partner doesn't have.
export const loadPlanEditor = async (id: string | null): Promise<PlanEditor | null> => {
  const { planEditor: e } = await query(
    `query Editor($id: ID) {
      planEditor(id: $id) {
        plan { row { ${rowFields} } entitlements { ${entitlementFields} } }
        ceilings { products staff suppliers languages currencies publish ai } powered { allowed note }
        currencies trials chargedBy edit { allowed reason } price { allowed reason } retireTargets { id name } retireDates
      }
    }`,
    editorSchema,
    { id },
  )
  if (!e) return null
  return {
    plan: e.plan ? { ...e.plan.row, entitlements: e.plan.entitlements } : null,
    ceilings: { ...e.ceilings, powered: e.powered },
    currencies: e.currencies,
    trials: e.trials,
    chargedBy: e.chargedBy,
    permission: { edit: e.edit, price: e.price },
    retireTargets: e.retireTargets,
    retireDates: e.retireDates,
  }
}

// `id` is null for a new plan, whose fee is the contract's default until DripFunnel sets one.
export const quotePlanPrices = async (id: string | null, prices: PlanInput['prices']): Promise<readonly PlanPrice[]> =>
  (await query(`query Quote($id: ID, $prices: [PlanPriceInput!]!) { quotePlanPrices(id: $id, prices: $prices) { ${priceFields} } }`, z.object({ quotePlanPrices: z.array(priceSchema) }), { id, prices })).quotePlanPrices

const resultSchema = (field: string) => z.object({ [field]: z.object({ ok: z.boolean(), id: z.string().nullable(), reason: z.string().nullable(), row: z.string().nullable(), currency: z.string().nullable() }) })
type Outcome = { ok: boolean; id: string | null; reason: string | null; row: string | null; currency: string | null }

const mutatePlan = async (field: string, operation: string, variables: Record<string, unknown>): Promise<Outcome> =>
  (await query(operation, resultSchema(field), variables))[field] as Outcome

// A refusal the API never promised is an error, not a state to word.
const refusal = <Code extends string>(outcome: Outcome, codes: readonly Code[]): Code => {
  const code = codes.find((candidate) => candidate === outcome.reason)
  if (!code) throw new ApiError(outcome.reason ?? 'UNKNOWN', 'The API refused the plan with a code this console does not know.')
  return code
}

export const savePlan = async (id: string | null, input: PlanInput, applyTo: ApplyTo | null): Promise<SaveResult> => {
  const outcome = id
    ? await mutatePlan('updatePlan', `mutation Update($id: ID!, $input: PlanInput!, $applyTo: String) { updatePlan(id: $id, input: $input, applyTo: $applyTo) { ok id reason row currency } }`, { id, input, applyTo })
    : await mutatePlan('createPlan', `mutation Create($input: PlanInput!) { createPlan(input: $input) { ok id reason row currency } }`, { input })
  if (outcome.ok) return { ok: true, id: outcome.id ?? id ?? '' }
  if (outcome.reason === 'ABOVE_CEILING') {
    const row = entitlementRows.find((candidate) => candidate.key === outcome.row)
    if (!row) throw new ApiError('ABOVE_CEILING', 'The API named no row the console knows.')
    return { ok: false, reason: 'ABOVE_CEILING', row: row.key }
  }
  return { ok: false, reason: refusal(outcome, ['OWNERS_AND_ADMINS_ONLY', 'PRICES_ONLY', 'NEEDS_APPLY_TO', ...settledRefusals] as const) }
}

export const makePlanLive = async (id: string): Promise<MakeLiveResult> => {
  const outcome = await mutatePlan('makePlanLive', `mutation Live($id: ID!) { makePlanLive(id: $id) { ok id reason row currency } }`, { id })
  if (outcome.ok) return { ok: true }
  if (outcome.reason === 'UNPRICED_CURRENCY') return { ok: false, reason: 'UNPRICED_CURRENCY', currency: outcome.currency }
  return { ok: false, reason: refusal(outcome, ['OWNERS_AND_ADMINS_ONLY', ...settledRefusals] as const) }
}

export const retirePlan = async (id: string, input: RetireInput): Promise<RetireResult> => {
  const outcome = await mutatePlan('retirePlan', `mutation Retire($id: ID!, $input: RetirePlanInput!) { retirePlan(id: $id, input: $input) { ok id reason row currency } }`, { id, input })
  return outcome.ok ? { ok: true } : { ok: false, reason: refusal(outcome, ['OWNERS_AND_ADMINS_ONLY', 'LAST_LIVE_PLAN', ...settledRefusals] as const) }
}
