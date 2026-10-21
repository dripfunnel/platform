import type { Money } from '@dripfunnel/shared/format'
import { z } from 'zod'
import { query } from './client'

// The Dashboard's one query, `dashboard(range)` (FIRST-RELEASE.md §5, §16). Every number, comparison
// and conversion here is the API's; the screen formats and links them and computes nothing.
export const dashboardRanges = ['month', 'last', 'q'] as const

export type DashboardRange = (typeof dashboardRanges)[number]

export type StoreStatusKey = 'active' | 'trial' | 'pastdue' | 'suspended'

export interface AttentionItem {
  storeId: string
  storeName: string
  kind: 'pastDue' | 'setupStuck' | 'domainStuck' | 'trialEnding'
  // Already worded by the API ("past due 9 days", "“Storefront building” for 43 min").
  detail: string
  // The store tab the row opens (#116) and whether the caller may take the row's action.
  tab: 'billing' | 'setup' | 'domains' | 'overview'
  action: { allowed: true } | { allowed: false; code: 'OWNERS_AND_ADMINS_ONLY' | 'FINANCE_TRIAL_ONLY' }
}

export interface DashboardData {
  range: DashboardRange
  asOf: string
  staleSince: string | null
  // A brand-new Live partner: zeros, and the words that say so (FIRST-RELEASE §5).
  fresh: boolean
  stores: { total: number; byStatus: Record<StoreStatusKey, number>; newThisMonth: number }
  revenue: { collected: Money; fee: Money; payout: Money; comparison: string; nextPayoutAt: string }
  attention: readonly AttentionItem[]
  signups: { started: number; completed: number; conversion: string | null; comparison: string }
  usage: { nearCount: number; stores: readonly { storeId: string; storeName: string; used: number; limit: number; limitKey: 'products' | 'staff' | 'suppliers' | 'ai' | 'publish'; percent: number }[] }
  // `plan` is null for a store with no plan on record.
  top: readonly { storeId: string; storeName: string; plan: string | null; sales: Money }[]
}

const money = z.object({ amount: z.number().int(), currency: z.string() })
const count = z.number().int().nonnegative()

const dashboardSchema = z.object({
  dashboard: z.object({
    range: z.enum(dashboardRanges),
    asOf: z.string(),
    staleSince: z.string().nullable(),
    fresh: z.boolean(),
    stores: z.object({ total: count, byStatus: z.object({ active: count, trial: count, pastdue: count, suspended: count }), newThisMonth: count }),
    revenue: z.object({ collected: money, fee: money, payout: money, comparison: z.string(), nextPayoutAt: z.string() }),
    attention: z.array(
      z.object({
        storeId: z.string(),
        storeName: z.string(),
        kind: z.enum(['pastDue', 'setupStuck', 'domainStuck', 'trialEnding']),
        detail: z.string(),
        tab: z.enum(['billing', 'setup', 'domains', 'overview']),
        action: z.object({ allowed: z.boolean(), code: z.enum(['OWNERS_AND_ADMINS_ONLY', 'FINANCE_TRIAL_ONLY']).nullable() }).transform((a): AttentionItem['action'] => (a.allowed || !a.code ? { allowed: true } : { allowed: false, code: a.code })),
      }),
    ),
    signups: z.object({ started: count, completed: count, conversion: z.string().nullable(), comparison: z.string() }),
    usage: z.object({ nearCount: count, stores: z.array(z.object({ storeId: z.string(), storeName: z.string(), used: count, limit: count, limitKey: z.enum(['products', 'staff', 'suppliers', 'ai', 'publish']), percent: count })) }),
    top: z.array(z.object({ storeId: z.string(), storeName: z.string(), plan: z.string().nullable(), sales: money })),
  }),
})

export const loadDashboard = async (range: DashboardRange): Promise<DashboardData> =>
  (
    await query(
      `query Dashboard($range: String!) {
        dashboard(range: $range) {
          range asOf staleSince fresh
          stores { total byStatus { active trial pastdue suspended } newThisMonth }
          revenue { collected { amount currency } fee { amount currency } payout { amount currency } comparison nextPayoutAt }
          attention { storeId storeName kind detail tab action { allowed code } }
          signups { started completed conversion comparison }
          usage { nearCount stores { storeId storeName used limit limitKey percent } }
          top { storeId storeName plan sales { amount currency } }
        }
      }`,
      dashboardSchema,
      { range },
    )
  ).dashboard

// ?view=fresh and ?view=stale over the real answer: a brand-new Live partner's zeros (also what
// ?state=empty shows), or the same numbers as of when they were last fresh.
export const dashboardVariants = ['fresh', 'stale'] as const

export type DashboardVariant = (typeof dashboardVariants)[number]

export const asFresh = (data: DashboardData): DashboardData => {
  const zero = (m: Money): Money => ({ amount: 0, currency: m.currency })
  return {
    ...data,
    fresh: true,
    stores: { total: 0, byStatus: { active: 0, trial: 0, pastdue: 0, suspended: 0 }, newThisMonth: 0 },
    revenue: { ...data.revenue, collected: zero(data.revenue.collected), fee: zero(data.revenue.fee), payout: zero(data.revenue.payout), comparison: '' },
    attention: [],
    signups: { started: 0, completed: 0, conversion: null, comparison: '' },
    usage: { nearCount: 0, stores: [] },
    top: [],
  }
}

export const asVariant = (data: DashboardData, variant: DashboardVariant | null): DashboardData =>
  variant === 'fresh' ? asFresh(data) : variant === 'stale' ? { ...data, staleSince: data.staleSince ?? data.asOf } : data
