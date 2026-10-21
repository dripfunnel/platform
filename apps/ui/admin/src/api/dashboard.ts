// The Dashboard's one query: `dashboard(partnerId)` on the Admin API (FIRST-RELEASE.md §3, §12).
// Every number here is the API's; the screen only formats and links them (ui/README §3).
import { z } from 'zod'
import { query } from './client'
import { provisioningSteps, type ProvisioningStep } from './provisioningSteps'

export const partnerStates = ['live', 'awaiting', 'draft', 'paused'] as const
export type PartnerState = (typeof partnerStates)[number]

export interface PartnerOption {
  id: string
  name: string
}

export type AttentionReason =
  | { kind: 'pastDue'; daysPastDue: number }
  | { kind: 'suspended'; reason: string }
  | { kind: 'setup'; state: 'failed' | 'stuck'; step: ProvisioningStep; attempt: number }

export interface AttentionStore {
  id: string
  name: string
  partnerName: string
  reason: AttentionReason
}

export interface DashboardData {
  // The filter the API applied: null for all partners, including when the one asked for is
  // unknown or not the caller's.
  partnerId: string | null
  partnerOptions: readonly PartnerOption[]
  asOf: string
  partners: Record<PartnerState, number>
  awaiting: {
    count: number
    oldest: { id: string; name: string; submittedAt: string; waitingSeconds: number } | null
  }
  stores: {
    total: number
    newThisWeek: number
    // At most five, largest first; the API sorts and caps it.
    newThisWeekByPartner: readonly (PartnerOption & { count: number })[]
  }
  attention: {
    pastDue: number
    suspended: number
    setupFailed: number
    setupStuck: number
    // Every store needing attention, each counted once; `stores` holds the most urgent few,
    // and the API sorts and caps it.
    total: number
    stores: readonly AttentionStore[]
  }
  signups: { started: number; completed: number; failed: number; medianSecondsToReady: number | null }
}

const option = z.object({ id: z.string(), name: z.string() })
const count = z.number().int().nonnegative()

// One object with the facts of every reason, switched on `kind` (apps/api/schema/admin.graphql).
const reason = z
  .object({
    kind: z.enum(['pastDue', 'suspended', 'setup']),
    daysPastDue: count.nullable(),
    reason: z.string().nullable(),
    state: z.enum(['failed', 'stuck']).nullable(),
    step: z.enum(provisioningSteps).nullable(),
    attempt: z.number().int().nullable(),
  })
  .transform((r, ctx): AttentionReason => {
    if (r.kind === 'pastDue' && r.daysPastDue !== null) return { kind: 'pastDue', daysPastDue: r.daysPastDue }
    if (r.kind === 'suspended') return { kind: 'suspended', reason: r.reason ?? '' }
    if (r.kind === 'setup' && r.state && r.step && r.attempt !== null) return { kind: 'setup', state: r.state, step: r.step, attempt: r.attempt }
    ctx.addIssue({ code: 'custom', message: `incomplete attention reason ${r.kind}` })
    return z.NEVER
  })

const dashboardSchema = z.object({
  dashboard: z.object({
    partnerId: z.string().nullable(),
    partnerOptions: z.array(option),
    asOf: z.string(),
    partners: z.object({ live: count, awaiting: count, draft: count, paused: count }),
    awaiting: z.object({
      count,
      oldest: z.object({ id: z.string(), name: z.string(), submittedAt: z.string(), waitingSeconds: count }).nullable(),
    }),
    stores: z.object({ total: count, newThisWeek: count, newThisWeekByPartner: z.array(option.extend({ count })) }),
    attention: z.object({
      pastDue: count,
      suspended: count,
      setupFailed: count,
      setupStuck: count,
      total: count,
      stores: z.array(z.object({ id: z.string(), name: z.string(), partnerName: z.string(), reason })),
    }),
    signups: z.object({ started: count, completed: count, failed: count, medianSecondsToReady: count.nullable() }),
  }),
})

const dashboardQuery = `query Dashboard($partnerId: ID) {
  dashboard(partnerId: $partnerId) {
    partnerId partnerOptions { id name } asOf
    partners { live awaiting draft paused }
    awaiting { count oldest { id name submittedAt waitingSeconds } }
    stores { total newThisWeek newThisWeekByPartner { id name count } }
    attention { pastDue suspended setupFailed setupStuck total stores { id name partnerName reason { kind daysPastDue reason state step attempt } } }
    signups { started completed failed medianSecondsToReady }
  }
}`

export const loadDashboard = async (partnerId: string | undefined): Promise<DashboardData> =>
  (await query(dashboardQuery, dashboardSchema, { partnerId: partnerId ?? null })).dashboard
