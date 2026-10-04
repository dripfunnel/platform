import type postgres from 'postgres'
import { z } from 'zod'
import { type PartnerCaller, partnerContextOf } from '#auth/partnerCaller'
import type { ProvisioningStep } from '#db/schema/saas'
import { withScope } from '#db/scoped/index'
import { countPartnerStores, selectAttention, selectBillingFeed, selectTopStores, sumRevenue, sumSignups, type AttentionRow, type Window } from '#db/scoped/partnerDashboard'
import { selectNearestLimits } from '#db/scoped/stores'
import { permissionFor, type ActionPermission } from '#saas/partnerStores/index'
import { stuckAfterMinutes } from '#saas/provisioning/index'
import { daysPastDue, trialDaysLeft } from '#saas/stores/index'

// The partner Dashboard on the Platform API (ui/platform/FIRST-RELEASE.md §5; card #163). Every
// number is the database's and every comparison is worded here, so the screen computes nothing.

export const dashboardRange = z.enum(['month', 'last', 'q'])
export type DashboardRange = z.infer<typeof dashboardRange>

const dayMs = 24 * 60 * 60 * 1000
const attentionMax = 10
const trialEndingDays = 3
const topStoresMax = 5
const nearestMax = 4
// Before the first charge arrives, the payout currency is the default one (SAAS §7.2).
const defaultCurrency = 'USD'

const monthStart = (d: Date, back = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1))
const monthName = (d: Date) => d.toLocaleString('en', { month: 'long', timeZone: 'UTC' })
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const percent = (part: number, whole: number) => Math.round((part * 100) / whole)
const signed = (n: number) => (n > 0 ? `+${n}%` : `${n}%`.replace('-', '−'))

/** The range's window and the one its comparison reads (FIRST-RELEASE §5). */
export const windowsOf = (range: DashboardRange, now: Date): { current: Window; previous: Window } => {
  // A window that runs to now includes now, as the Stores list's `created` filter does.
  const end = new Date(now.getTime() + 1)
  switch (range) {
    case 'month':
      return { current: { from: monthStart(now), to: end }, previous: { from: monthStart(now, 1), to: monthStart(now) } }
    case 'last':
      return { current: { from: monthStart(now, 1), to: monthStart(now) }, previous: { from: monthStart(now, 2), to: monthStart(now, 1) } }
    case 'q':
      return { current: { from: new Date(now.getTime() - 90 * dayMs), to: end }, previous: { from: new Date(now.getTime() - 180 * dayMs), to: new Date(now.getTime() - 90 * dayMs) } }
  }
}

export const revenueWords = (range: DashboardRange, now: Date, collected: number, previous: number): string => {
  if (previous === 0) return ''
  if (range === 'month') {
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
    return `${percent(collected, previous)}% of ${monthName(monthStart(now, 1))} so far, with ${plural(daysInMonth - now.getUTCDate() + 1, 'day')} to go`
  }
  const change = percent(collected - previous, previous)
  const against = range === 'last' ? monthName(monthStart(now, 2)) : 'the 90 days before'
  return change === 0 ? `Same as ${against}` : `${signed(change)} vs ${against}`
}

export const conversionWords = (range: DashboardRange, now: Date, current: number | null, previous: number | null): string => {
  if (current === null || previous === null) return ''
  const against = range === 'month' ? 'last month' : range === 'last' ? `in ${monthName(monthStart(now, 2))}` : 'the 90 days before'
  if (current === previous) return `the same as ${against}`
  return `${current > previous ? 'up' : 'down'} from ${previous}%${range === 'q' ? '' : ` ${against}`}`
}

// The partner console's five setup steps (messages `setup.steps`) over SAAS §5's eight.
const stepWords: Record<ProvisioningStep, string> = {
  accountAndStore: 'Account',
  defaults: 'Store',
  hostnames: 'Portal ready',
  repo: 'Storefront building',
  storeConfig: 'Storefront building',
  hostingTarget: 'Storefront building',
  firstBuild: 'Storefront building',
  done: 'Done',
}

const tabs = { pastDue: 'billing', setupStuck: 'setup', domainStuck: 'domains', trialEnding: 'overview' } as const

export const attentionDetail = (row: AttentionRow, now: Date): string => {
  switch (row.kind) {
    case 'pastDue':
      return `past due ${plural(daysPastDue(row.since, now), 'day')}`
    case 'setupStuck': {
      const minutes = Math.floor((now.getTime() - row.since.getTime()) / 60_000)
      return `“${row.step ? stepWords[row.step] : ''}” for ${minutes < 120 ? `${minutes} min` : plural(Math.floor(minutes / 60), 'hour')}`
    }
    case 'domainStuck':
      return `${row.host ?? ''} waiting for DNS for ${plural(Math.max(1, Math.floor((now.getTime() - row.since.getTime()) / dayMs)), 'day')}`
    case 'trialEnding': {
      const days = trialDaysLeft(row.since, now)
      return days === 0 ? 'trial ends today' : days === 1 ? 'trial ends tomorrow' : `trial ends in ${days} days`
    }
  }
}

// Open billing and Re-check need only what every partner role has; Retry and Extend are the
// store actions of §6.4, so they answer as `store(id)`'s block does.
const attentionAction = (kind: AttentionRow['kind'], role: PartnerCaller['role']): ActionPermission =>
  kind === 'setupStuck' ? permissionFor('retryStep', role) : kind === 'trialEnding' ? permissionFor('extendTrial', role) : { allowed: true }

const limitKeys = { products: 'products', staff: 'staff', suppliers: 'suppliers', ai_prompts: 'ai', publish_now: 'publish' } as const

const day = (d: Date) => d.toISOString().slice(0, 10)

export interface PartnerDashboardDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  now: () => Date
}

export const createPartnerDashboardService = ({ sql, caller, now }: PartnerDashboardDeps) => {
  const partnerId = caller.partner.id
  const context = partnerContextOf(caller)

  /** Null for a range it cannot read. */
  const dashboard = (rawRange: unknown) => {
    const parsed = dashboardRange.safeParse(rawRange)
    if (!parsed.success) return Promise.resolve(null)
    const range = parsed.data
    const at = now()
    const { current, previous } = windowsOf(range, at)
    return withScope(sql, context, async (tx) => {
      const stores = await countPartnerStores(tx, partnerId, monthStart(at))
      const revenue = await sumRevenue(tx, partnerId, current, previous)
      const attention = await selectAttention(tx, partnerId, stuckAfterMinutes, at, trialEndingDays, attentionMax)
      const signups = await sumSignups(tx, partnerId, current, previous)
      const near = await selectNearestLimits(tx, partnerId, at, nearestMax)
      const top = await selectTopStores(tx, partnerId, monthStart(at, 1), topStoresMax)
      const feed = await selectBillingFeed(tx, partnerId)
      const currency = revenue.currency ?? defaultCurrency
      const conversion = signups.ended > 0 ? percent(signups.converted, signups.ended) : null
      const previousConversion = signups.previous_ended > 0 ? percent(signups.previous_converted, signups.previous_ended) : null
      return {
        range,
        asOf: feed?.synced_at ?? at,
        staleSince: feed?.stale_since ?? null,
        fresh: caller.partner.state === 'live' && stores.total === 0 && revenue.charges === 0,
        stores: {
          total: stores.total,
          byStatus: { active: stores.active, trial: stores.trial, pastdue: stores.past_due, suspended: stores.suspended },
          newThisMonth: stores.new_this_month,
        },
        revenue: {
          collected: { amount: revenue.collected, currency },
          fee: { amount: revenue.fee, currency },
          payout: { amount: revenue.payout, currency },
          comparison: revenueWords(range, at, revenue.collected, revenue.previous),
          nextPayoutAt: revenue.next_payout_at ?? day(new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1))),
        },
        attention: attention.map((row) => ({
          storeId: row.store_id,
          storeName: row.store_name,
          kind: row.kind,
          detail: attentionDetail(row, at),
          tab: tabs[row.kind],
          action: attentionAction(row.kind, caller.role),
        })),
        signups: {
          started: signups.started,
          completed: signups.completed,
          conversion: conversion === null ? null : `${conversion}%`,
          comparison: conversionWords(range, at, conversion, previousConversion),
        },
        usage: {
          nearCount: near[0]?.total ?? 0,
          stores: near.map((n) => ({ storeId: n.store_id, storeName: n.store_name, used: n.used, limit: n.cap, limitKey: limitKeys[n.key], percent: n.percent })),
        },
        top: top.map((t) => ({ storeId: t.store_id, storeName: t.store_name, plan: t.plan_name, sales: { amount: t.amount, currency: t.currency } })),
      }
    })
  }

  return { dashboard }
}

export type PartnerDashboardService = ReturnType<typeof createPartnerDashboardService>
export type DashboardDto = NonNullable<Awaited<ReturnType<PartnerDashboardService['dashboard']>>>
