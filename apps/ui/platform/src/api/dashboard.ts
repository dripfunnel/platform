import type { Money } from '@dripfunnel/shared/format'
import type { PartnerRole } from '../features/shell/partnerRoles'
import { harnessEnabled } from '../harness'

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
  top: readonly { storeId: string; storeName: string; plan: string; sales: Money }[]
}

const usd = (amount: number): Money => ({ amount, currency: 'USD' })

// The prototype's Northstar numbers per range (designs/partner-data.js), as the API would return them.
const ranges: Record<DashboardRange, Pick<DashboardData, 'revenue' | 'signups'>> = {
  month: {
    revenue: { collected: usd(398840), fee: usd(146600), payout: usd(252240), comparison: '94% of August so far, with 2 days to go', nextPayoutAt: '2026-10-01' },
    signups: { started: 9, completed: 7, conversion: '34%', comparison: 'up from 29% last month' },
  },
  last: {
    revenue: { collected: usd(426140), fee: usd(154900), payout: usd(271240), comparison: '+4% vs July', nextPayoutAt: '2026-10-01' },
    signups: { started: 31, completed: 27, conversion: '29%', comparison: 'down from 31% in July' },
  },
  q: {
    revenue: { collected: usd(1226420), fee: usd(446200), payout: usd(780220), comparison: '+15% vs the 90 days before', nextPayoutAt: '2026-10-01' },
    signups: { started: 82, completed: 71, conversion: '31%', comparison: 'up from 28%' },
  },
}

const can = (role: PartnerRole, roles: readonly PartnerRole[], code: 'OWNERS_AND_ADMINS_ONLY' | 'FINANCE_TRIAL_ONLY'): AttentionItem['action'] =>
  roles.includes(role) ? { allowed: true } : { allowed: false, code }

const attentionFor = (role: PartnerRole): readonly AttentionItem[] => [
  { storeId: 'st-tidewater', storeName: 'Tidewater Surf', kind: 'pastDue', detail: 'past due 9 days', tab: 'billing', action: { allowed: true } },
  { storeId: 'st-bayside', storeName: 'Bayside Pets', kind: 'pastDue', detail: 'past due 3 days', tab: 'billing', action: { allowed: true } },
  { storeId: 'st-fieldnote', storeName: 'Fieldnote Paper', kind: 'setupStuck', detail: '“Storefront building” for 43 min', tab: 'setup', action: can(role, ['partner-owner', 'partner-admin'], 'OWNERS_AND_ADMINS_ONLY') },
  { storeId: 'st-maple', storeName: 'Maple & Pine', kind: 'domainStuck', detail: 'shop.mapleandpine.ca waiting for DNS for 2 days', tab: 'domains', action: { allowed: true } },
  { storeId: 'st-harbor', storeName: 'Harbor Coffee Co.', kind: 'trialEnding', detail: 'trial ends in 2 days', tab: 'overview', action: can(role, ['partner-owner', 'partner-admin', 'partner-finance'], 'FINANCE_TRIAL_ONLY') },
]

const northstar = (range: DashboardRange, role: PartnerRole): DashboardData => ({
  range,
  asOf: '2026-09-29T17:42:00Z',
  staleSince: null,
  fresh: false,
  stores: { total: 86, byStatus: { active: 72, trial: 8, pastdue: 3, suspended: 1 }, newThisMonth: 13 },
  ...ranges[range],
  attention: attentionFor(role),
  usage: {
    nearCount: 4,
    stores: [
      { storeId: 'st-juniper', storeName: 'Juniper & Co.', used: 4210, limit: 5000, limitKey: 'products', percent: 84 },
      { storeId: 'st-cobalt', storeName: 'Cobalt Kitchen', used: 58, limit: 60, limitKey: 'publish', percent: 97 },
      { storeId: 'st-lumen', storeName: 'Lumen Candle Co.', used: 9, limit: 10, limitKey: 'staff', percent: 90 },
      { storeId: 'st-sparrow', storeName: 'Sparrow Apparel', used: 17, limit: 20, limitKey: 'ai', percent: 85 },
    ],
  },
  top: [
    { storeId: 'st-juniper', storeName: 'Juniper & Co.', plan: 'Pro', sales: usd(1842000) },
    { storeId: 'st-cobalt', storeName: 'Cobalt Kitchen', plan: 'Growth', sales: usd(1211000) },
    { storeId: 'st-maple', storeName: 'Maple & Pine', plan: 'Growth', sales: { amount: 988000, currency: 'CAD' } },
    { storeId: 'st-sparrow', storeName: 'Sparrow Apparel', plan: 'Starter', sales: usd(641000) },
    { storeId: 'st-harbor', storeName: 'Harbor Coffee Co.', plan: 'Growth', sales: usd(530000) },
  ],
})

// A Live partner with nothing yet: the Dashboard's empty state.
const fresh = (range: DashboardRange): DashboardData => ({
  range,
  asOf: '2026-09-29T17:42:00Z',
  staleSince: null,
  fresh: true,
  stores: { total: 0, byStatus: { active: 0, trial: 0, pastdue: 0, suspended: 0 }, newThisMonth: 0 },
  revenue: { collected: usd(0), fee: usd(0), payout: usd(0), comparison: '', nextPayoutAt: '2026-11-01' },
  attention: [],
  signups: { started: 0, completed: 0, conversion: null, comparison: '' },
  usage: { nearCount: 0, stores: [] },
  top: [],
})

export const dashboardVariants = ['northstar', 'fresh', 'stale'] as const

export type DashboardVariant = (typeof dashboardVariants)[number]

export const loadDashboard = (range: DashboardRange, role: PartnerRole, variant: DashboardVariant = 'northstar'): Promise<DashboardData> => {
  if (!harnessEnabled || variant === 'fresh') return Promise.resolve(fresh(range))
  const data = northstar(range, role)
  return Promise.resolve(variant === 'stale' ? { ...data, staleSince: '2026-09-29T17:12:00Z' } : data)
}
