import type { Money } from '@dripfunnel/shared/format'
import { ApiError } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'
import { planKeyDefs } from './planKeys'

// The Plans operations on the Platform API (FIRST-RELEASE.md §7, §16): the catalogue, one plan with
// DripFunnel's ceilings, prices quoted with the fee and margin, and the save, make-live and retire mutations.
export const planStatuses = ['draft', 'live', 'retired'] as const
export type PlanStatus = (typeof planStatuses)[number]

// The plan settings of SAAS.md §6.1, keyed as the API's catalogue (planKeys.ts).
export type EntitlementKey = string
export type PlanEntitlements = Record<string, boolean | number>

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
export interface PlanCeilings {
  amounts: Record<string, number | null>
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
  entitlements: z.record(z.string(), z.union([z.boolean(), z.number().int().min(0)])),
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

// The API sends a list of entries; the console works with the record.
const entitlementsSchema = z
  .array(z.object({ key: z.string(), enabled: z.boolean().nullable(), amount: z.number().int().nullable() }))
  .transform((list): PlanEntitlements => Object.fromEntries(list.map((e) => [e.key, e.enabled ?? e.amount ?? 0])))
const entitlementFields = 'key enabled amount'

// The whole catalogue: the list shows every plan, so the API's pages are followed to the end.
const plansPageSize = 50

export const loadPlans = async (): Promise<PlansPage> => {
  const pageSchema = z.object({
    plans: z.object({ items: z.array(rowSchema), chargedBy: z.string(), create: permission, pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }) }),
  })
  const items: z.infer<typeof rowSchema>[] = []
  let after: string | null = null
  for (;;) {
    const { plans }: z.infer<typeof pageSchema> = await query(
      `query Plans($after: String) { plans(first: ${plansPageSize}, after: $after) { items { ${rowFields} } chargedBy create { allowed reason } pageInfo { hasNextPage endCursor } } }`,
      pageSchema,
      { after },
    )
    items.push(...plans.items)
    if (!plans.pageInfo.hasNextPage || !plans.pageInfo.endCursor) return { items, chargedBy: plans.chargedBy, actions: { create: plans.create } }
    after = plans.pageInfo.endCursor
  }
}

const ceiling = z.number().int().nullable()
const editorSchema = z.object({
  planEditor: z
    .object({
      plan: z.object({ row: rowSchema, entitlements: entitlementsSchema }).nullable(),
      ceilings: z.array(z.object({ key: z.string(), amount: ceiling })).transform((list) => Object.fromEntries(list.map((c) => [c.key, c.amount])) as Record<string, number | null>),
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
        ceilings { key amount } powered { allowed note }
        currencies trials chargedBy edit { allowed reason } price { allowed reason } retireTargets { id name } retireDates
      }
    }`,
    editorSchema,
    { id },
  )
  if (!e) return null
  return {
    plan: e.plan ? { ...e.plan.row, entitlements: e.plan.entitlements } : null,
    ceilings: { amounts: e.ceilings, powered: e.powered },
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

// The input's record goes to the API as its list of entries.
const wireOf = (input: PlanInput) => ({ ...input, entitlements: Object.entries(input.entitlements).map(([key, v]) => (typeof v === 'boolean' ? { key, enabled: v } : { key, amount: v })) })

export const savePlan = async (id: string | null, plan: PlanInput, applyTo: ApplyTo | null): Promise<SaveResult> => {
  const input = wireOf(plan)
  const outcome = id
    ? await mutatePlan('updatePlan', `mutation Update($id: ID!, $input: PlanInput!, $applyTo: String) { updatePlan(id: $id, input: $input, applyTo: $applyTo) { ok id reason row currency } }`, { id, input, applyTo })
    : await mutatePlan('createPlan', `mutation Create($input: PlanInput!) { createPlan(input: $input) { ok id reason row currency } }`, { input })
  if (outcome.ok) return { ok: true, id: outcome.id ?? id ?? '' }
  if (outcome.reason === 'ABOVE_CEILING') {
    const row = planKeyDefs.find((candidate) => candidate.key === outcome.row)
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
