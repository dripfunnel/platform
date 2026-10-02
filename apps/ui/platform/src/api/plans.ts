import type { Money } from '@dripfunnel/shared/format'
import { z } from 'zod'
import type { PartnerRole } from '../features/shell/partnerRoles'
import { harnessEnabled } from '../harness'
import { plansServer } from './plansSample'

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
  fee: Money
  // A second currency's fee is converted at the contract rate.
  converted: boolean
  margin: { kind: 'keep'; amount: Money; of: Money } | { kind: 'loss'; amount: Money } | { kind: 'unpriced' }
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

// DripFunnel's maximum per entitlement (SAAS.md §6.1), and what the contract says about "Powered by".
export interface PlanCeilings extends Record<NumberKey, number> {
  powered: { allowed: boolean; note: 'contract' | 'firstYear' }
}

export type PlanRefusal = 'OWNERS_AND_ADMINS_ONLY' | 'PRICES_ONLY' | 'ABOVE_CEILING' | 'LAST_LIVE_PLAN' | 'UNPRICED_CURRENCY' | 'NEEDS_APPLY_TO'

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

export type SaveResult = { ok: true; id: string } | { ok: false; reason: Exclude<PlanRefusal, 'ABOVE_CEILING' | 'LAST_LIVE_PLAN' | 'UNPRICED_CURRENCY'> } | { ok: false; reason: 'ABOVE_CEILING'; row: EntitlementKey }

export type MakeLiveResult = { ok: true } | { ok: false; reason: 'OWNERS_AND_ADMINS_ONLY' } | { ok: false; reason: 'UNPRICED_CURRENCY'; currency: string }

export type RetireInput = { keep: true } | { keep: false; moveTo: string; on: string }

export type RetireResult = { ok: true } | { ok: false; reason: 'OWNERS_AND_ADMINS_ONLY' | 'LAST_LIVE_PLAN' }

const notConnected = () => Promise.reject(new Error('The Platform API has no plans operations yet.'))

// Seam: the sample stands in for the Platform API's plans operations until they land; it answers only
// where the ?state= harness does, and a production build shows the error state.
export const loadPlans = (caller: PartnerRole): Promise<PlansPage> => (harnessEnabled ? Promise.resolve(plansServer.list(caller)) : notConnected())

export const loadPlanEditor = (id: string | null, caller: PartnerRole): Promise<PlanEditor | null> =>
  harnessEnabled ? Promise.resolve(plansServer.editor(id, caller)) : notConnected()

// `id` is null for a new plan, whose fee is the contract's default until DripFunnel sets one.
export const quotePlanPrices = (id: string | null, prices: PlanInput['prices']): Promise<readonly PlanPrice[]> =>
  harnessEnabled ? Promise.resolve(plansServer.quote(id, prices)) : notConnected()

export const savePlan = (id: string | null, input: PlanInput, applyTo: ApplyTo | null, caller: PartnerRole): Promise<SaveResult> =>
  harnessEnabled ? Promise.resolve(plansServer.save(id, input, applyTo, caller)) : notConnected()

export const makePlanLive = (id: string, caller: PartnerRole): Promise<MakeLiveResult> =>
  harnessEnabled ? Promise.resolve(plansServer.makeLive(id, caller)) : notConnected()

export const retirePlan = (id: string, input: RetireInput, caller: PartnerRole): Promise<RetireResult> =>
  harnessEnabled ? Promise.resolve(plansServer.retire(id, input, caller)) : notConnected()
