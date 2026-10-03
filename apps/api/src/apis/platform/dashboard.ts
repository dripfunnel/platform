import { GraphQLError } from 'graphql'
import type { DashboardDto, PartnerDashboardService } from '#saas/partnerDashboard/index'
import { unauthenticated } from '../graphql/scope'
import { builder } from './builder'
import { MoneyType } from './money'

// The partner Dashboard (ui/platform/FIRST-RELEASE.md §5; card #163). Thin: saas/partnerDashboard
// counts and words everything.

const service = (dashboard: PartnerDashboardService | null): PartnerDashboardService => {
  if (!dashboard) throw unauthenticated()
  return dashboard
}

type Attention = DashboardDto['attention'][number]
type Near = DashboardDto['usage']['stores'][number]
type Top = DashboardDto['top'][number]


const ByStatus = builder.objectRef<DashboardDto['stores']['byStatus']>('DashboardStoresByStatus').implement({
  fields: (t) => ({ active: t.exposeInt('active'), trial: t.exposeInt('trial'), pastdue: t.exposeInt('pastdue'), suspended: t.exposeInt('suspended') }),
})

const Stores = builder.objectRef<DashboardDto['stores']>('DashboardStores').implement({
  fields: (t) => ({ total: t.exposeInt('total'), byStatus: t.field({ type: ByStatus, resolve: (s) => s.byStatus }), newThisMonth: t.exposeInt('newThisMonth') }),
})

const Revenue = builder.objectRef<DashboardDto['revenue']>('DashboardRevenue').implement({
  fields: (t) => ({
    collected: t.field({ type: MoneyType, resolve: (r) => r.collected }),
    fee: t.field({ type: MoneyType, resolve: (r) => r.fee }),
    payout: t.field({ type: MoneyType, resolve: (r) => r.payout }),
    comparison: t.exposeString('comparison'),
    nextPayoutAt: t.exposeString('nextPayoutAt'),
  }),
})

const Action = builder.objectRef<Attention['action']>('DashboardAttentionAction').implement({
  fields: (t) => ({ allowed: t.exposeBoolean('allowed'), code: t.string({ nullable: true, resolve: (a) => (a.allowed ? null : a.reason) }) }),
})

const AttentionType = builder.objectRef<Attention>('DashboardAttention').implement({
  fields: (t) => ({
    storeId: t.exposeID('storeId'),
    storeName: t.exposeString('storeName'),
    kind: t.exposeString('kind'),
    detail: t.exposeString('detail'),
    tab: t.exposeString('tab'),
    action: t.field({ type: Action, resolve: (a) => a.action }),
  }),
})

const Signups = builder.objectRef<DashboardDto['signups']>('DashboardSignups').implement({
  fields: (t) => ({
    started: t.exposeInt('started'),
    completed: t.exposeInt('completed'),
    conversion: t.exposeString('conversion', { nullable: true }),
    comparison: t.exposeString('comparison'),
  }),
})

const NearType = builder.objectRef<Near>('DashboardNearLimit').implement({
  fields: (t) => ({
    storeId: t.exposeID('storeId'),
    storeName: t.exposeString('storeName'),
    used: t.exposeInt('used'),
    limit: t.exposeInt('limit'),
    limitKey: t.exposeString('limitKey'),
    percent: t.exposeInt('percent'),
  }),
})

const Usage = builder.objectRef<DashboardDto['usage']>('DashboardUsage').implement({
  fields: (t) => ({ nearCount: t.exposeInt('nearCount'), stores: t.field({ type: [NearType], resolve: (u) => u.stores }) }),
})

const TopType = builder.objectRef<Top>('DashboardTopStore').implement({
  fields: (t) => ({
    storeId: t.exposeID('storeId'),
    storeName: t.exposeString('storeName'),
    plan: t.exposeString('plan', { nullable: true }),
    sales: t.field({ type: MoneyType, resolve: (s) => s.sales }),
  }),
})

const Dashboard = builder.objectRef<DashboardDto>('PartnerDashboard').implement({
  fields: (t) => ({
    range: t.exposeString('range'),
    asOf: t.string({ resolve: (d) => d.asOf.toISOString() }),
    staleSince: t.string({ nullable: true, resolve: (d) => d.staleSince?.toISOString() ?? null }),
    fresh: t.exposeBoolean('fresh'),
    stores: t.field({ type: Stores, resolve: (d) => d.stores }),
    revenue: t.field({ type: Revenue, resolve: (d) => d.revenue }),
    attention: t.field({ type: [AttentionType], resolve: (d) => d.attention }),
    signups: t.field({ type: Signups, resolve: (d) => d.signups }),
    usage: t.field({ type: Usage, resolve: (d) => d.usage }),
    top: t.field({ type: [TopType], resolve: (d) => d.top }),
  }),
})

builder.queryFields((t) => ({
  dashboard: t.field({
    type: Dashboard,
    args: { range: t.arg.string({ required: true }) },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'partner.read', target: 'none' } },
    resolve: async (_, { range }, ctx) => {
      const data = await service(ctx.dashboard).dashboard(range)
      if (!data) throw new GraphQLError('That range does not work.', { extensions: { code: 'INVALID_INPUT' } })
      return data
    },
  }),
}))
