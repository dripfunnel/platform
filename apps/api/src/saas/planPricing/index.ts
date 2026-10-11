import type postgres from 'postgres'
import { withSystemScope } from '#db/scoped/index'
import { selectCurrentVersions } from '#db/scoped/partnerPlans'
import { planValuesOf, type PlanValue } from '#db/scoped/planKeys'
import { selectPricingPlans } from '#db/scoped/planPricing'

// A partner's live plans for its own pricing page (SAAS.md §6.1, #459): never the fee, the
// ceilings, a draft or a retired plan, and never a price converted from another currency.

interface Money {
  amount: string
  currency: string
}

export interface PricingPrice {
  currency: string
  monthly: Money | null
  yearly: Money | null
}

export interface PricingPlan {
  name: string
  description: string | null
  trialDays: number
  prices: PricingPrice[]
  settings: PlanValue[]
}

const money = (amount: number | null, currency: string): Money | null => (amount === null ? null : { amount: String(amount), currency })

/** `currency` keeps only that currency's prices; a plan not priced in it is still listed, with none. */
export const partnerPricing = (sql: postgres.Sql, partnerId: string, currency: string | null): Promise<PricingPlan[]> =>
  withSystemScope(sql, async (tx) => {
    const plans = await selectPricingPlans(tx, partnerId)
    const versions = await selectCurrentVersions(tx, plans.map((p) => p.id))
    return plans.map((p) => {
      const version = versions.get(p.id)
      const prices = (version?.prices ?? [])
        .filter((x) => (currency === null || x.currency === currency) && (x.monthly !== null || x.yearly !== null))
        .map((x) => ({ currency: x.currency, monthly: money(x.monthly, x.currency), yearly: money(x.yearly, x.currency) }))
      return { name: p.name, description: p.description, trialDays: p.trial_days, prices, settings: planValuesOf(version?.entitlements ?? {}) }
    })
  })
