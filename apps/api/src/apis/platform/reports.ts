import { GraphQLError } from 'graphql'
import { reportAudit, type PartnerReportsService, type ReportDto, type ReportTab } from '#saas/partnerReports/index'
import { builder } from './builder'
import { MoneyType } from './money'
import { exportResultType, partnerRead, present, signedIn } from './fields'

// Reports on the Platform API (ui/platform/FIRST-RELEASE.md §10; card #200). Thin:
// saas/partnerReports composes every number and sentence; each field is partner scope only.

type Of<T extends ReportTab> = Extract<ReportDto, { tab: T }>
type Growth = Of<'growth'>
type Revenue = Of<'revenue'>
type Plans = Of<'plans'>
type Performance = Of<'storePerformance'>
type Usage = Of<'usage'>
type Setup = Of<'setupHealth'>
const iso = (d: Date) => d.toISOString()

const CountBar = builder.objectRef<{ label: string; count: number }>('ReportCountBar').implement({
  fields: (t) => ({ label: t.exposeString('label'), count: t.exposeInt('count') }),
})
const MoneyBar = builder.objectRef<Revenue['bars'][number]>('ReportMoneyBar').implement({
  fields: (t) => ({ label: t.exposeString('label'), amount: t.field({ type: MoneyType, resolve: (b) => b.amount }) }),
})

const GrowthRow = builder.objectRef<Growth['rows'][number]>('GrowthRow').implement({
  fields: (t) => ({
    month: t.string({ resolve: (r) => iso(r.month) }),
    signups: t.exposeInt('signups'),
    newStores: t.exposeInt('newStores'),
    trialToPaidBps: t.exposeInt('trialToPaidBps', { nullable: true }),
    churned: t.exposeInt('churned'),
    netStores: t.exposeInt('netStores'),
  }),
})
const GrowthType = builder.objectRef<Growth>('GrowthReport').implement({
  fields: (t) => ({
    fresh: t.exposeBoolean('fresh'),
    summary: t.exposeString('summary'),
    rows: t.field({ type: [GrowthRow], resolve: (r) => r.rows }),
    bars: t.field({ type: [CountBar], resolve: (r) => r.bars }),
  }),
})

const RevenueRow = builder.objectRef<Revenue['rows'][number]>('RevenueRow').implement({
  fields: (t) => ({
    month: t.string({ resolve: (r) => iso(r.month) }),
    collected: t.field({ type: MoneyType, resolve: (r) => r.collected }),
    fee: t.field({ type: MoneyType, resolve: (r) => r.fee }),
    payout: t.field({ type: MoneyType, resolve: (r) => r.payout }),
  }),
})
const MrrRow = builder.objectRef<Revenue['mrr'][number]>('MrrRow').implement({
  fields: (t) => ({ plan: t.exposeString('plan'), amount: t.field({ type: MoneyType, resolve: (m) => m.amount }), approximate: t.exposeBoolean('approximate') }),
})
const Payments = builder.objectRef<Revenue['payments']>('PaymentOutcomes').implement({
  fields: (t) => ({ failed: t.exposeInt('failed'), recovered: t.exposeInt('recovered') }),
})
const RevenueType = builder.objectRef<Revenue>('RevenueReport').implement({
  fields: (t) => ({
    fresh: t.exposeBoolean('fresh'),
    summary: t.exposeString('summary'),
    currency: t.exposeString('currency'),
    currencyNote: t.exposeString('currencyNote', { nullable: true }),
    rows: t.field({ type: [RevenueRow], resolve: (r) => r.rows }),
    bars: t.field({ type: [MoneyBar], resolve: (r) => r.bars }),
    mrr: t.field({ type: [MrrRow], resolve: (r) => r.mrr }),
    payments: t.field({ type: Payments, resolve: (r) => r.payments }),
  }),
})

const PlanRow = builder.objectRef<Plans['rows'][number]>('PlanStoresRow').implement({
  fields: (t) => ({ plan: t.exposeString('plan', { nullable: true }), stores: t.exposeInt('stores') }),
})
const PlanChange = builder.objectRef<Plans['changes'][number]>('PlanChangeRow').implement({
  fields: (t) => ({ from: t.exposeString('from'), to: t.exposeString('to'), stores: t.exposeInt('stores') }),
})
const PlansType = builder.objectRef<Plans>('PlansReport').implement({
  fields: (t) => ({
    fresh: t.exposeBoolean('fresh'),
    summary: t.exposeString('summary'),
    rows: t.field({ type: [PlanRow], resolve: (r) => r.rows }),
    bars: t.field({ type: [CountBar], resolve: (r) => r.bars }),
    changes: t.field({ type: [PlanChange], resolve: (r) => r.changes }),
  }),
})

const SalesRow = builder.objectRef<Performance['rows'][number]>('StoreSalesRow').implement({
  fields: (t) => ({
    storeId: t.exposeID('storeId'),
    store: t.exposeString('store'),
    plan: t.exposeString('plan', { nullable: true }),
    sales: t.field({ type: MoneyType, resolve: (r) => r.sales }),
    orders: t.exposeInt('orders'),
    // Basis points can pass 32 bits (a store from 1 to 50,000 sales); always a whole number.
    changeBps: t.exposeFloat('changeBps', { nullable: true }),
    declining: t.exposeBoolean('declining'),
  }),
})
const PerformanceType = builder.objectRef<Performance>('StorePerformanceReport').implement({
  fields: (t) => ({
    fresh: t.exposeBoolean('fresh'),
    summary: t.exposeString('summary'),
    note: t.exposeString('note'),
    rows: t.field({ type: [SalesRow], resolve: (r) => r.rows }),
    declining: t.field({ type: [SalesRow], resolve: (r) => r.declining }),
    truncated: t.exposeBoolean('truncated'),
    decliningTruncated: t.exposeBoolean('decliningTruncated'),
  }),
})

const UsageRow = builder.objectRef<Usage['rows'][number]>('UsageReportRow').implement({
  fields: (t) => ({
    storeId: t.exposeID('storeId'),
    store: t.exposeString('store'),
    limit: t.exposeString('limit'),
    used: t.exposeInt('used'),
    cap: t.exposeInt('cap'),
    percentBps: t.exposeInt('percentBps'),
  }),
})
const Meters = builder.objectRef<Usage['meters']>('UsageMeters').implement({
  fields: (t) => ({ aiPrompts: t.int({ resolve: (m) => m.ai_prompts }), publishNow: t.int({ resolve: (m) => m.publish_now }) }),
})
const UsageType = builder.objectRef<Usage>('UsageReport').implement({
  fields: (t) => ({
    summary: t.exposeString('summary'),
    fresh: t.exposeBoolean('fresh'),
    rows: t.field({ type: [UsageRow], resolve: (r) => r.rows }),
    meters: t.field({ type: Meters, resolve: (r) => r.meters }),
    truncated: t.exposeBoolean('truncated'),
  }),
})

const SetupRow = builder.objectRef<Setup['rows'][number]>('SetupProblemRow').implement({
  fields: (t) => ({
    kind: t.exposeString('kind'),
    storeId: t.exposeID('storeId'),
    store: t.exposeString('store'),
    detail: t.exposeString('detail', { nullable: true }),
    since: t.string({ resolve: (r) => iso(r.since) }),
  }),
})
const SetupType = builder.objectRef<Setup>('SetupHealthReport').implement({
  fields: (t) => ({
    summary: t.exposeString('summary'),
    fresh: t.exposeBoolean('fresh'),
    medianSeconds: t.exposeInt('medianSeconds', { nullable: true }),
    failed: t.exposeInt('failed'),
    // Custom domains waiting for DNS over a day, the third of §10's figures.
    domainsStuck: t.exposeInt('domainsStuck'),
    rows: t.field({ type: [SetupRow], resolve: (r) => r.rows }),
    truncated: t.exposeBoolean('truncated'),
  }),
})

type Job = NonNullable<Awaited<ReturnType<PartnerReportsService['reportExport']>>>
const JobType = builder.objectRef<Job>('ReportExportJob').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    state: t.exposeString('state'),
    rows: t.exposeInt('rows', { nullable: true }),
    truncated: t.exposeBoolean('truncated'),
    csv: t.exposeString('csv', { nullable: true }),
    expiresAt: t.string({ nullable: true, resolve: (j) => j.expiresAt?.toISOString() ?? null }),
  }),
})
const ExportResult = exportResultType('ReportExportResult')

const FilterInput = builder.inputType('ReportFilterInput', { fields: (t) => ({ range: t.string(), plan: t.id(), country: t.string() }) })

/** One report resolver: the partner scope, the read permission, INVALID_INPUT for a filter it cannot read. */
const reportOf = async <T extends ReportTab>(reports: PartnerReportsService | null, tab: T, filter: Record<string, unknown> | null | undefined): Promise<Of<T>> => {
  const report = await signedIn(reports).report(tab, present(filter))
  if (!report || report.tab !== tab) throw new GraphQLError('That filter does not work.', { extensions: { code: 'INVALID_INPUT' } })
  return report as Of<T>
}

builder.queryFields((t) => ({
  reportGrowth: t.field({ type: GrowthType, args: { filter: t.arg({ type: FilterInput }) }, extensions: { access: partnerRead }, resolve: (_, { filter }, ctx) => reportOf(ctx.reports, 'growth', filter) }),
  reportRevenue: t.field({ type: RevenueType, args: { filter: t.arg({ type: FilterInput }) }, extensions: { access: partnerRead }, resolve: (_, { filter }, ctx) => reportOf(ctx.reports, 'revenue', filter) }),
  reportPlans: t.field({ type: PlansType, args: { filter: t.arg({ type: FilterInput }) }, extensions: { access: partnerRead }, resolve: (_, { filter }, ctx) => reportOf(ctx.reports, 'plans', filter) }),
  reportStorePerformance: t.field({ type: PerformanceType, args: { filter: t.arg({ type: FilterInput }) }, extensions: { access: partnerRead }, resolve: (_, { filter }, ctx) => reportOf(ctx.reports, 'storePerformance', filter) }),
  reportUsage: t.field({ type: UsageType, args: { filter: t.arg({ type: FilterInput }) }, extensions: { access: partnerRead }, resolve: (_, { filter }, ctx) => reportOf(ctx.reports, 'usage', filter) }),
  reportSetupHealth: t.field({ type: SetupType, args: { filter: t.arg({ type: FilterInput }) }, extensions: { access: partnerRead }, resolve: (_, { filter }, ctx) => reportOf(ctx.reports, 'setupHealth', filter) }),
  reportExport: t.field({
    type: JobType,
    nullable: true,
    args: { id: t.arg.id({ required: true }) },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'exports', target: 'none' } },
    resolve: (_, { id }, ctx) => signedIn(ctx.reports).reportExport(String(id)),
  }),
}))

builder.mutationFields((t) => ({
  exportReport: t.field({
    type: ExportResult,
    args: { tab: t.arg.string({ required: true }), filter: t.arg({ type: FilterInput }) },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'exports', target: 'none', audit: reportAudit.exportReport } },
    resolve: (_, { tab, filter }, ctx) => signedIn(ctx.reports).exportReport(tab, present(filter)),
  }),
}))
