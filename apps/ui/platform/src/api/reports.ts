import type { Money } from '@dripfunnel/shared/format'
import { ApiError, exportJobFields, exportJobSchema, readExportJob, type ExportJob } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'

// Reports on the Platform API (FIRST-RELEASE.md §10, §16). Every figure, bar and summary sentence
// is the API's; the console draws them and computes nothing. Percentages arrive as basis points.
export const reportTabs = ['growth', 'revenue', 'plans', 'stores', 'usage', 'setup'] as const
export type ReportTab = (typeof reportTabs)[number]

export const reportRanges = ['6m', '3m'] as const
export type ReportRange = (typeof reportRanges)[number]

export interface ReportFilter {
  range?: ReportRange | undefined
  plan?: string | undefined
  country?: string | undefined
}

const money = z.object({ amount: z.number().int(), currency: z.string() })
const countBar = z.object({ label: z.string(), count: z.number().int() })
const moneyBar = z.object({ label: z.string(), amount: money })

const growth = z.object({
  summary: z.string(),
  fresh: z.boolean(),
  bars: z.array(countBar),
  rows: z.array(z.object({ month: z.string(), signups: z.number().int(), newStores: z.number().int(), trialToPaidBps: z.number().int().nullable(), churned: z.number().int(), netStores: z.number().int() })),
})

const revenue = z.object({
  summary: z.string(),
  fresh: z.boolean(),
  currency: z.string(),
  currencyNote: z.string().nullable(),
  bars: z.array(moneyBar),
  rows: z.array(z.object({ month: z.string(), collected: money, fee: money, payout: money })),
  mrr: z.array(z.object({ plan: z.string(), amount: money, approximate: z.boolean() })),
  payments: z.object({ failed: z.number().int(), recovered: z.number().int() }),
})

const plans = z.object({
  summary: z.string(),
  fresh: z.boolean(),
  bars: z.array(countBar),
  rows: z.array(z.object({ plan: z.string().nullable(), stores: z.number().int() })),
  changes: z.array(z.object({ from: z.string(), to: z.string(), stores: z.number().int() })),
})

const salesRow = z.object({ storeId: z.string(), store: z.string(), plan: z.string().nullable(), sales: money, orders: z.number().int(), changeBps: z.number().nullable(), declining: z.boolean() })

const stores = z.object({ summary: z.string(), fresh: z.boolean(), note: z.string().nullable(), rows: z.array(salesRow), truncated: z.boolean(), declining: z.array(salesRow), decliningTruncated: z.boolean() })

const usage = z.object({
  summary: z.string(),
  fresh: z.boolean(),
  meters: z.object({ aiPrompts: z.number().int(), publishNow: z.number().int() }),
  rows: z.array(z.object({ storeId: z.string(), store: z.string(), limit: z.string(), used: z.number().int(), cap: z.number().int().nullable(), percentBps: z.number().int() })),
  truncated: z.boolean(),
})

const setup = z.object({
  summary: z.string(),
  fresh: z.boolean(),
  medianSeconds: z.number().int().nullable(),
  failed: z.number().int(),
  domainsStuck: z.number().int(),
  rows: z.array(z.object({ kind: z.enum(['stuck', 'failed', 'domain']), storeId: z.string(), store: z.string(), detail: z.string().nullable(), since: z.string() })),
  truncated: z.boolean(),
})

const fields = {
  growth: 'reportGrowth(filter: $filter) { summary fresh bars { label count } rows { month signups newStores trialToPaidBps churned netStores } }',
  revenue:
    'reportRevenue(filter: $filter) { summary fresh currency currencyNote bars { label amount { amount currency } } rows { month collected { amount currency } fee { amount currency } payout { amount currency } } mrr { plan amount { amount currency } approximate } payments { failed recovered } }',
  plans: 'reportPlans(filter: $filter) { summary fresh bars { label count } rows { plan stores } changes { from to stores } }',
  stores:
    'reportStorePerformance(filter: $filter) { summary fresh note truncated decliningTruncated rows { storeId store plan sales { amount currency } orders changeBps declining } declining { storeId store plan sales { amount currency } orders changeBps declining } }',
  usage: 'reportUsage(filter: $filter) { summary fresh truncated meters { aiPrompts publishNow } rows { storeId store limit used cap percentBps } }',
  setup: 'reportSetupHealth(filter: $filter) { summary fresh medianSeconds failed domainsStuck truncated rows { kind storeId store detail since } }',
} as const

const schemas = { growth, revenue, plans, stores, usage, setup } as const
const roots = { growth: 'reportGrowth', revenue: 'reportRevenue', plans: 'reportPlans', stores: 'reportStorePerformance', usage: 'reportUsage', setup: 'reportSetupHealth' } as const

export type Report =
  | { tab: 'growth'; data: z.infer<typeof growth> }
  | { tab: 'revenue'; data: z.infer<typeof revenue> }
  | { tab: 'plans'; data: z.infer<typeof plans> }
  | { tab: 'stores'; data: z.infer<typeof stores> }
  | { tab: 'usage'; data: z.infer<typeof usage> }
  | { tab: 'setup'; data: z.infer<typeof setup> }

export type SalesRow = z.infer<typeof salesRow>
export type MoneyValue = Money

// Only the filters the API declares: the ?state= harness and the tab stay out.
const filterOf = (filter: ReportFilter): ReportFilter =>
  Object.fromEntries(Object.entries({ range: filter.range, plan: filter.plan, country: filter.country }).filter(([, value]) => value !== undefined))

export const loadReport = async (tab: ReportTab, filter: ReportFilter): Promise<Report> => {
  const answer = await query(`query Report($filter: ReportFilterInput) { ${fields[tab]} }`, z.object({ [roots[tab]]: schemas[tab] }), { filter: filterOf(filter) })
  const data = answer[roots[tab]]
  if (!data) throw new ApiError('BAD_RESPONSE', `No ${roots[tab]} in the answer.`)
  return { tab, data } as Report
}

// The Plan and Country filters' choices: only what the partner's own stores have (§10).
export const loadReportFilters = async (): Promise<{ plans: readonly { id: string; name: string }[]; countries: readonly string[] }> =>
  (
    await query(
      `{ reportFilters { plans { id name } countries } }`,
      z.object({ reportFilters: z.object({ plans: z.array(z.object({ id: z.string(), name: z.string() })), countries: z.array(z.string()) }) }),
    )
  ).reportFilters

// `exportReport(tab, filter)` is a job for every role (§16).
export const startReportExport = async (tab: ReportTab, filter: ReportFilter): Promise<ExportJob> => {
  const { exportReport: started } = await query(
    `mutation Export($tab: String!, $filter: ReportFilterInput) { exportReport(tab: $tab, filter: $filter) { ok jobId reason } }`,
    z.object({ exportReport: z.object({ ok: z.boolean(), jobId: z.string().nullable(), reason: z.string().nullable() }) }),
    { tab: tab === 'stores' ? 'storePerformance' : tab === 'setup' ? 'setupHealth' : tab, filter: filterOf(filter) },
  )
  if (!started.ok || !started.jobId) throw new ApiError(started.reason ?? 'UNKNOWN', 'The API refused the export.')
  return { id: started.jobId, state: 'preparing', entries: null, url: null, expiresAt: null }
}

export const loadReportExport = async (id: string): Promise<ExportJob | null> =>
  readExportJob((await query(`query Job($id: ID!) { reportExport(id: $id) { ${exportJobFields} } }`, z.object({ reportExport: exportJobSchema.nullable() }), { id })).reportExport)
