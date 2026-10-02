import type { Money } from '@dripfunnel/shared/format'
import type { PartnerRole } from '../features/shell/partnerRoles'
import {
  limitKeys,
  allowanceKeys,
  planInput,
  type ApplyTo,
  type EntitlementKey,
  type MakeLiveResult,
  type Plan,
  type PlanCeilings,
  type PlanEditor,
  type PlanEntitlements,
  type PlanInput,
  type PlanPermission,
  type PlanPrice,
  type PlanRow,
  type PlansPage,
  type RetireInput,
  type RetireResult,
  type SaveResult,
} from './plans'

// Northstar's plans from the prototype (designs/partner-data.js PLANS.ns, DFMAX), served the way the
// Platform API would: fee and margin worked out here, ceilings checked here, never in a component.
export interface PlanSeed {
  id: string
  name: string
  description: string
  status: Plan['status']
  trialDays: number
  // Monthly and yearly in minor units per currency; null is "Not priced".
  prices: Record<string, [monthly: number | null, yearly: number | null]>
  // DripFunnel's wholesale fee per store per month, in the first currency's minor units.
  feeMinor: number
  stores: number
  entitlements: PlanEntitlements
}

export const partnerCurrencies = ['USD', 'CAD'] as const

// The contract rate the second currency's fee is converted at.
const cadPerUsd = 1 / 0.74

export const planCeilings: PlanCeilings = { products: 20000, staff: 25, suppliers: 50, languages: 5, currencies: 5, publish: 300, ai: 1000, powered: { allowed: true, note: 'contract' } }

export const samplePlans: readonly PlanSeed[] = [
  { id: 'starter', name: 'Starter', description: 'Everything to open your first shop.', status: 'live', trialDays: 14, prices: { USD: [2900, 29000], CAD: [3900, 39000] }, feeMinor: 1200, stores: 31, entitlements: { domain: false, offers: false, suppliersOn: false, powered: false, aplus: false, size: true, products: 500, staff: 2, suppliers: 0, languages: 1, currencies: 1, publish: 20, ai: 50 } },
  { id: 'growth', name: 'Growth', description: 'For shops that sell every day.', status: 'live', trialDays: 14, prices: { USD: [4900, 49000], CAD: [6500, 65000] }, feeMinor: 1800, stores: 44, entitlements: { domain: true, offers: true, suppliersOn: true, powered: false, aplus: true, size: true, products: 5000, staff: 5, suppliers: 5, languages: 2, currencies: 2, publish: 60, ai: 200 } },
  { id: 'pro', name: 'Pro', description: 'For established brands with a team.', status: 'live', trialDays: 14, prices: { USD: [9900, 99000], CAD: [12900, 129000] }, feeMinor: 3500, stores: 11, entitlements: { domain: true, offers: true, suppliersOn: true, powered: true, aplus: true, size: true, products: 10000, staff: 15, suppliers: 20, languages: 4, currencies: 3, publish: 150, ai: 500 } },
  { id: 'basic24', name: 'Basic (2024)', description: 'Our first plan. Replaced by Starter.', status: 'retired', trialDays: 0, prices: { USD: [1900, 19000], CAD: [2500, 25000] }, feeMinor: 1000, stores: 0, entitlements: { domain: false, offers: false, suppliersOn: false, powered: false, aplus: false, size: false, products: 200, staff: 1, suppliers: 0, languages: 1, currencies: 1, publish: 10, ai: 0 } },
]

const chargedBy = 'DripFunnel for Northstar'
const retireDates = ['2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', '2027-01-01T00:00:00Z']

const feeFor = (feeMinor: number, currency: string): Money => ({ amount: currency === 'USD' ? feeMinor : Math.round(feeMinor * cadPerUsd), currency })

const priceOf = (currency: string, monthly: number | null, yearly: number | null, feeMinor: number): PlanPrice => {
  const fee = feeFor(feeMinor, currency)
  const margin: PlanPrice['margin'] =
    monthly === null ? { kind: 'unpriced' } : monthly < fee.amount ? { kind: 'loss', amount: { amount: fee.amount - monthly, currency } } : { kind: 'keep', amount: { amount: monthly - fee.amount, currency }, of: { amount: monthly, currency } }
  return { currency, monthly: monthly === null ? null : { amount: monthly, currency }, yearly: yearly === null ? null : { amount: yearly, currency }, fee, converted: currency !== 'USD', margin }
}

const rowOf = (seed: PlanSeed): PlanRow => ({
  id: seed.id,
  name: seed.name,
  description: seed.description,
  status: seed.status,
  trialDays: seed.trialDays,
  prices: partnerCurrencies.map((currency) => priceOf(currency, seed.prices[currency]?.[0] ?? null, seed.prices[currency]?.[1] ?? null, seed.feeMinor)),
  stores: seed.stores,
})

const editors: readonly PartnerRole[] = ['partner-owner', 'partner-admin']
const pricers: readonly PartnerRole[] = ['partner-owner', 'partner-admin', 'partner-finance']

const can = (caller: PartnerRole, roles: readonly PartnerRole[], reason: 'OWNERS_AND_ADMINS_ONLY' | 'PRICES_ONLY'): PlanPermission =>
  roles.includes(caller) ? { allowed: true } : { allowed: false, reason }

// A new plan's wholesale fee until DripFunnel sets one on the contract: the Growth fee.
const defaultFeeMinor = 1800

export const createPlansServer = (initial: readonly PlanSeed[]) => {
  let seeds = [...initial]
  const find = (id: string) => seeds.find((seed) => seed.id === id)

  const list = (caller: PartnerRole): PlansPage => ({ items: seeds.map(rowOf), chargedBy, actions: { create: can(caller, editors, 'OWNERS_AND_ADMINS_ONLY') } })

  const editor = (id: string | null, caller: PartnerRole): PlanEditor | null => {
    const seed = id === null ? null : find(id)
    if (id !== null && !seed) return null
    return {
      plan: seed ? { ...rowOf(seed), entitlements: { ...seed.entitlements } } : null,
      ceilings: planCeilings,
      currencies: partnerCurrencies,
      trials: [0, 7, 14, 30],
      chargedBy,
      // Finance prices existing plans only; a new plan is an Owner's or Admin's to make (ACCESS.md §5.3).
      permission: { edit: can(caller, editors, 'OWNERS_AND_ADMINS_ONLY'), price: can(caller, seed ? pricers : editors, 'OWNERS_AND_ADMINS_ONLY') },
      retireTargets: seeds.filter((candidate) => candidate.status === 'live' && candidate.id !== id).map(({ id: targetId, name }) => ({ id: targetId, name })),
      retireDates,
    }
  }

  const quote = (id: string | null, prices: PlanInput['prices']): readonly PlanPrice[] => {
    const feeMinor = (id === null ? null : find(id)?.feeMinor) ?? defaultFeeMinor
    return prices.map((price) => priceOf(price.currency, price.monthly?.amount ?? null, price.yearly?.amount ?? null, feeMinor))
  }

  // The ceilings (SAAS.md §6.1), "Powered by" included: the contract decides whether a plan may remove it.
  const aboveCeiling = (entitlements: PlanEntitlements): EntitlementKey | null =>
    [...limitKeys, ...allowanceKeys].find((key) => entitlements[key] > planCeilings[key]) ?? (entitlements.powered && !planCeilings.powered.allowed ? 'powered' : null)

  // Finance may change prices only (ACCESS.md §5.3): everything else must match the saved plan.
  const changesBeyondPrices = (seed: PlanSeed, input: PlanInput) =>
    seed.name !== input.name || seed.description !== input.description || seed.trialDays !== input.trialDays || JSON.stringify(seed.entitlements) !== JSON.stringify(input.entitlements)

  const save = (id: string | null, raw: PlanInput, applyTo: ApplyTo | null, caller: PartnerRole): SaveResult => {
    const input = planInput.parse(raw)
    const seed = id === null ? null : find(id)
    if (id !== null && !seed) throw new Error('No such plan.')
    if (!editors.includes(caller)) {
      if (!pricers.includes(caller) || !seed) return { ok: false, reason: 'OWNERS_AND_ADMINS_ONLY' }
      if (changesBeyondPrices(seed, input)) return { ok: false, reason: 'PRICES_ONLY' }
    }
    const row = aboveCeiling(input.entitlements)
    if (row) return { ok: false, reason: 'ABOVE_CEILING', row }
    if (seed && seed.stores > 0 && applyTo === null) return { ok: false, reason: 'NEEDS_APPLY_TO' }
    const prices = Object.fromEntries(input.prices.map((price) => [price.currency, [price.monthly?.amount ?? null, price.yearly?.amount ?? null] as [number | null, number | null]]))
    if (seed) {
      seeds = seeds.map((candidate) => (candidate.id === id ? { ...candidate, name: input.name, description: input.description, trialDays: input.trialDays, prices, entitlements: { ...input.entitlements } } : candidate))
      return { ok: true, id: seed.id }
    }
    const newId = `plan-${seeds.length + 1}`
    seeds = [...seeds, { id: newId, name: input.name, description: input.description, status: 'draft', trialDays: input.trialDays, prices, feeMinor: defaultFeeMinor, stores: 0, entitlements: { ...input.entitlements } }]
    return { ok: true, id: newId }
  }

  const makeLive = (id: string, caller: PartnerRole): MakeLiveResult => {
    const seed = find(id)
    if (!seed) throw new Error('No such plan.')
    if (!editors.includes(caller)) return { ok: false, reason: 'OWNERS_AND_ADMINS_ONLY' }
    const unpriced = partnerCurrencies.find((currency) => (seed.prices[currency]?.[0] ?? null) === null)
    if (unpriced) return { ok: false, reason: 'UNPRICED_CURRENCY', currency: unpriced }
    seeds = seeds.map((candidate) => (candidate.id === id ? { ...candidate, status: 'live' } : candidate))
    return { ok: true }
  }

  const retire = (id: string, input: RetireInput, caller: PartnerRole): RetireResult => {
    const seed = find(id)
    if (!seed) throw new Error('No such plan.')
    if (!editors.includes(caller)) return { ok: false, reason: 'OWNERS_AND_ADMINS_ONLY' }
    if (!seeds.some((candidate) => candidate.status === 'live' && candidate.id !== id)) return { ok: false, reason: 'LAST_LIVE_PLAN' }
    if (!input.keep) {
      const target = find(input.moveTo)
      if (!target || target.status !== 'live' || target.id === id || !retireDates.includes(input.on)) throw new Error('The stores can only move to another Live plan on an offered date.')
      seeds = seeds.map((candidate) => (candidate.id === target.id ? { ...candidate, stores: candidate.stores + seed.stores } : candidate.id === id ? { ...candidate, stores: 0 } : candidate))
    }
    seeds = seeds.map((candidate) => (candidate.id === id ? { ...candidate, status: 'retired' } : candidate))
    return { ok: true }
  }

  // What the stores fixture needs: the catalogue's names, prices and the limits it enforces, Live ones first.
  const catalogue = () => seeds.map((seed) => ({ id: seed.id, name: seed.name, status: seed.status, prices: seed.prices, limits: seed.entitlements }))

  return { list, editor, quote, save, makeLive, retire, catalogue }
}

export const plansServer = createPlansServer(samplePlans)
