import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { actingName, type PartnerCaller, partnerContextOf, actingId } from '#auth/partnerCaller'
import { insertExportJob, selectExportJob } from '#db/scoped/exportJobs'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { selectContractTerms, selectCurrentVersions } from '#db/scoped/partnerPlans'
import {
  countDecliningStores,
  countSetupProblems,
  selectDecliningStores,
  selectGrowth,
  selectMrr,
  selectPaymentOutcomes,
  selectPlanChanges,
  selectRevenue,
  selectSetupHealth,
  selectSetupProblems,
  selectStoreSales,
  selectStoresPerPlan,
  sumMeters,
  type ReportScope,
  type StoreSalesRow,
} from '#db/scoped/reports'
import { selectNearestLimits } from '#db/scoped/stores'
import { partnerEntry } from '#saas/activity/index'
import { queueSideEffect } from '#saas/outbox/index'
import { stuckAfterMinutes } from '#saas/provisioning/index'
export { reportCsv } from './csv'

// Reports (ui/platform/FIRST-RELEASE.md §10, §16): every figure and sentence, from account-level
// totals only (LOGGING §6); percentages are basis points, money is in the payout currency.

export const reportTabs = ['growth', 'revenue', 'plans', 'storePerformance', 'usage', 'setupHealth'] as const
export type ReportTab = (typeof reportTabs)[number]

export const reportFilter = z.strictObject({
  range: z.enum(['6m', '3m']).default('6m'),
  plan: z.guid().optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
})
export type ReportFilter = z.infer<typeof reportFilter>

const listMax = 50
const decline = 0.97
const emptyWords = 'Reports fill in as your first merchants sign up.'

const monthStart = (d: Date, back = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1))
const monthName = (d: Date) => d.toLocaleString('en', { month: 'long', timeZone: 'UTC' })
const bps = (part: number, whole: number) => (whole > 0 ? Math.round((part * 10_000) / whole) : null)
const pct = (b: number) => `${Math.round(b / 100)}%`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const minorDigits = (currency: string) => new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
const money = (amount: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 10 ** minorDigits(currency))
const exact = (text: string): number => {
  const n = BigInt(text)
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('reports: beyond exact integer range')
  return Number(n)
}

/** Minor units of `from` as minor units of `to` at the contract's rate (`from` per `to`), rounded half up. */
export const toPayoutCurrency = (amount: number, rate: string, from: string, to: string): number => {
  const [whole = '0', fraction = ''] = rate.split('.')
  const numerator = BigInt(amount) * 10n ** BigInt(fraction.length) * 10n ** BigInt(minorDigits(to))
  const denominator = BigInt(whole + fraction) * 10n ** BigInt(minorDigits(from))
  return Number((numerator * 2n + denominator) / (denominator * 2n))
}

type Money = { amount: number; currency: string }

/** The months a range covers, oldest first, this month last. */
const monthsOf = (range: ReportFilter['range'], now: Date) => ({ from: monthStart(now, range === '6m' ? 5 : 2), to: monthStart(now, -1) })

export const computeReport = async (tx: ScopedSql, tab: ReportTab, scope: ReportScope, filter: ReportFilter, now: Date) => {
  const { from, to } = monthsOf(filter.range, now)
  const thisMonth = monthStart(now)
  const lastMonth = monthStart(now, 1)
  const terms = await selectContractTerms(tx, scope.partnerId)
  const currency = terms.fee_currency ?? 'USD'

  switch (tab) {
    case 'growth': {
      const months = await selectGrowth(tx, scope, from, to)
      const rows = months.map((m) => ({ month: m.month, signups: m.signups, newStores: m.new_stores, trialToPaidBps: bps(m.converted, m.ended), churned: m.churned, netStores: m.net }))
      const cur = rows.at(-1)
      const prev = rows.at(-2)
      const fresh = rows.every((r) => r.netStores === 0 && r.signups === 0)
      const conversion =
        cur?.trialToPaidBps != null
          ? `Trials converted at ${pct(cur.trialToPaidBps)} this month${prev?.trialToPaidBps != null ? `, ${cur.trialToPaidBps >= prev.trialToPaidBps ? 'up' : 'down'} from ${pct(prev.trialToPaidBps)}` : ''}. `
          : ''
      const diff = (cur?.netStores ?? 0) - (prev?.netStores ?? 0)
      const stores = `You have ${plural(cur?.netStores ?? 0, 'store')}, ${Math.abs(diff)} ${diff >= 0 ? 'more' : 'fewer'} than in ${monthName(lastMonth)}.`
      return { tab, fresh, summary: fresh ? emptyWords : `${conversion}${stores}`, currency: null, rows, bars: rows.map((r) => ({ label: monthName(r.month), count: r.signups })) }
    }

    case 'revenue': {
      const months = (await selectRevenue(tx, scope, from, to)).map((m) => ({ month: m.month, collected: exact(m.collected), fee: exact(m.fee), payout: exact(m.payout) }))
      const outcomes = await selectPaymentOutcomes(tx, scope, from, to)
      const mrr = new Map<string, { plan: string; amount: number; converted: boolean }>()
      for (const r of await selectMrr(tx, scope)) {
        const rate = r.currency === currency ? null : terms.rates[r.currency]
        if (r.currency !== currency && !rate) continue
        const entry = mrr.get(r.plan_id) ?? { plan: r.plan, amount: 0, converted: false }
        entry.amount += rate ? toPayoutCurrency(exact(r.amount), rate, r.currency, currency) : exact(r.amount)
        entry.converted ||= rate !== null
        mrr.set(r.plan_id, entry)
      }
      const cur = months.at(-1)
      const prev = months.at(-2)
      const fresh = months.every((m) => m.collected === 0)
      const daysIn = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
      const projected = cur ? (cur.collected * daysIn) / now.getUTCDate() : 0
      const summary = fresh
        ? emptyWords
        : `You've collected ${money(cur?.collected ?? 0, currency)} so far in ${monthName(thisMonth)}, ${prev && projected >= prev.collected ? 'on track to beat' : 'behind'} ${monthName(lastMonth)}'s ${money(prev?.collected ?? 0, currency)}.`
      const others = Object.keys(terms.rates).filter((c) => c !== currency)
      return {
        tab,
        fresh,
        summary,
        currency,
        currencyNote: others.length > 0 ? `All amounts in ${currency}; ${others.join(', ')} payments are converted at the payout rate.` : null,
        rows: months.map((m) => ({ month: m.month, collected: { amount: m.collected, currency }, fee: { amount: m.fee, currency }, payout: { amount: m.payout, currency } })),
        bars: months.map((m) => ({ label: monthName(m.month), amount: { amount: m.collected, currency } as Money })),
        mrr: [...mrr.values()].map((m) => ({ plan: m.plan, amount: { amount: m.amount, currency } as Money, approximate: m.converted })),
        payments: outcomes,
      }
    }

    case 'plans': {
      const perPlan = await selectStoresPerPlan(tx, scope)
      const changes = await selectPlanChanges(tx, scope, thisMonth, to)
      const ids = [...new Set(changes.flatMap((c) => [c.from_plan, c.to_plan]))]
      const versions = await selectCurrentVersions(tx, ids)
      // Up or down by monthly price, compared only in one currency both plans are priced in.
      const monthly = (id: string) => new Map((versions.get(id)?.prices ?? []).filter((p) => p.monthly !== null).map((p) => [p.currency, p.monthly ?? 0]))
      let up = 0
      let down = 0
      for (const c of changes) {
        const before = monthly(c.from_plan)
        const after = monthly(c.to_plan)
        const shared = [currency, ...before.keys()].find((k) => before.has(k) && after.has(k))
        if (!shared) continue
        const delta = (after.get(shared) ?? 0) - (before.get(shared) ?? 0)
        if (delta > 0) up += c.changes
        else if (delta < 0) down += c.changes
      }
      const total = perPlan.reduce((a, p) => a + p.stores, 0)
      const top = perPlan.find((p) => p.plan_id !== null)
      const fresh = total === 0
      return {
        tab,
        fresh,
        summary: fresh
          ? emptyWords
          : `${top?.plan ?? 'No plan'} is your most popular plan, with ${top?.stores ?? 0} of ${plural(total, 'store')}. ${plural(up, 'store')} upgraded and ${down} downgraded this month.`,
        currency: null,
        rows: perPlan.map((p) => ({ plan: p.plan, stores: p.stores })),
        bars: perPlan.map((p) => ({ label: p.plan ?? 'No plan', count: p.stores })),
        changes: changes.map((c) => ({ from: c.from_name ?? 'A removed plan', to: c.to_name ?? 'A removed plan', stores: c.changes })),
      }
    }

    case 'storePerformance': {
      const sales = await selectStoreSales(tx, scope, lastMonth, monthStart(now, 2), listMax + 1)
      const decliningCount = await countDecliningStores(tx, scope, lastMonth, monthStart(now, 2), decline)
      const falling = await selectDecliningStores(tx, scope, lastMonth, monthStart(now, 2), decline, listMax + 1)
      const salesRow = (s: StoreSalesRow) => {
        const amount = exact(s.amount)
        const previous = s.previous === null ? null : exact(s.previous)
        return { storeId: s.store_id, store: s.store_name, plan: s.plan, sales: { amount, currency: s.currency }, orders: s.orders, changeBps: previous ? bps(amount - previous, previous) : null, declining: previous !== null && amount < previous * decline }
      }
      const rows = sales.slice(0, listMax).map(salesRow)
      const top = rows[0]
      const declining = falling.slice(0, listMax).map(salesRow)
      const fresh = rows.length === 0
      return {
        tab,
        fresh,
        summary: fresh
          ? emptyWords
          : `${top?.store} sold the most last month (${money(top?.sales.amount ?? 0, top?.sales.currency ?? currency)}). ${plural(decliningCount, 'store')} sold less than the month before.`,
        currency: null,
        note: 'Totals only. Individual orders, customers and products stay with each merchant.',
        rows,
        truncated: sales.length > listMax,
        declining,
        decliningTruncated: falling.length > listMax,
      }
    }

    case 'usage': {
      const near = await selectNearestLimits(tx, scope.partnerId, now, listMax, { planId: scope.planId, country: scope.country })
      const meters = await sumMeters(tx, scope, `${now.toISOString().slice(0, 7)}-01`)
      const total = near[0]?.total ?? 0
      return {
        tab,
        fresh: false,
        summary: `${plural(total, 'store is', 'stores are')} at 80% or more of a limit. AI prompts used this month: ${meters.ai_prompts.toLocaleString('en')}; 'Publish now' presses: ${meters.publish_now.toLocaleString('en')}.`,
        currency: null,
        rows: near.map((n) => ({ storeId: n.store_id, store: n.store_name, limit: n.key, used: n.used, cap: n.cap, percentBps: n.percent * 100 })),
        meters,
        truncated: total > near.length,
      }
    }

    case 'setupHealth': {
      const health = await selectSetupHealth(tx, scope, new Date(now.getTime() - 30 * 86_400_000))
      const problems = await selectSetupProblems(tx, scope, stuckAfterMinutes, now, listMax + 1)
      const { stuck, domains } = await countSetupProblems(tx, scope, stuckAfterMinutes, now)
      const median = health.median_seconds === null ? null : Math.round(health.median_seconds)
      const ready = median === null ? 'No store finished setting up in the last 30 days.' : `A new store is ready in ${Math.floor(median / 60)} min ${median % 60} s on average.`
      return {
        tab,
        fresh: false,
        summary: `${ready} ${plural(stuck, 'setup is', 'setups are')} stuck and ${plural(domains, 'custom domain is', 'custom domains are')} waiting for DNS.`,
        currency: null,
        medianSeconds: median,
        failed: health.failed,
        domainsStuck: domains,
        rows: problems.slice(0, listMax).map((p) => ({ kind: p.kind, storeId: p.store_id, store: p.store_name, detail: p.detail, since: p.since })),
        truncated: problems.length > listMax,
      }
    }
  }
}

export type ReportDto = Awaited<ReturnType<typeof computeReport>>

export interface PartnerReportsDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
  now: () => Date
}

export const reportAudit = { exportReport: 'report.exported' } as const
export const reportExportLifetimeMs = 60 * 60 * 1000

export const createPartnerReportsService = ({ sql, caller, facts, activity, now }: PartnerReportsDeps) => {
  const partnerId = caller.partner.id
  const context = partnerContextOf(caller)

  /** Null for a filter it cannot read. */
  const report = (tab: ReportTab, raw: unknown): Promise<ReportDto | null> => {
    const parsed = reportFilter.safeParse(raw ?? {})
    if (!parsed.success) return Promise.resolve(null)
    const f = parsed.data
    return withScope(sql, context, (tx) => computeReport(tx, tab, { partnerId, planId: f.plan, country: f.country }, f, now()))
  }

  // ACCESS §5.3 `exports` (stores, reports): every role; each export is logged (LOGGING §6).
  const exportReport = (rawTab: unknown, raw: unknown): Promise<{ ok: true; jobId: string } | { ok: false; reason: 'INVALID_INPUT' }> => {
    const tab = z.enum(reportTabs).safeParse(rawTab)
    const parsed = reportFilter.safeParse(raw ?? {})
    if (!tab.success || !parsed.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    const filter = { tab: tab.data, ...parsed.data }
    return withScope(sql, context, async (tx) => {
      const jobId = await insertExportJob(tx, { partnerId, kind: 'report', filter, byId: actingId(caller), byLabel: actingName(caller) })
      await queueSideEffect(tx, { kind: 'export.report', idempotencyKey: jobId, payload: { jobId, partnerId, requester: context.caller }, partnerId, storeId: null })
      await activity.record(tx, partnerEntry(caller, facts)({ action: reportAudit.exportReport, target: { type: 'export', id: jobId, label: `Report: ${tab.data}` }, reason: null, changes: [{ field: 'filter', before: null, after: JSON.stringify(filter) }] }))
      return { ok: true as const, jobId }
    })
  }

  /** A report export's state; its CSV until it expires. Null for an id that isn't the partner's report export. */
  const reportExport = (id: string) => {
    if (!z.guid().safeParse(id).success) return Promise.resolve(null)
    return withScope(sql, context, async (tx) => {
      const job = await selectExportJob(tx, id)
      if (job?.kind !== 'report') return null
      const expired = job.expires_at !== null && job.expires_at <= now()
      return { id: job.id, state: expired ? ('expired' as const) : job.state, rows: job.rows, truncated: job.truncated, csv: expired ? null : job.csv, expiresAt: job.expires_at }
    })
  }

  return { report, exportReport, reportExport }
}

export type PartnerReportsService = ReturnType<typeof createPartnerReportsService>
