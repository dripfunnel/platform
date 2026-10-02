import type postgres from 'postgres'
import { z } from 'zod'
import { partnerScopedRoles, roleHas } from '#auth/permissions'
import type { StaffMember } from '#auth/staff'
import type { StaffContext } from '#core/tenancy'
import type { PartnerState, ProvisioningStep } from '#db/schema/saas'
import {
  countAwaitingPartners,
  countNewStoresByPartner,
  countOpenSetupSessions,
  countPartnersByState,
  countSetupAttention,
  countSignups,
  countStores,
  searchPartners,
  searchStores,
  selectAttention,
  selectOldestAwaiting,
  selectVisiblePartner,
  type AttentionRow,
  type DashboardScope,
} from '#db/scoped/dashboard'
import { withScope } from '#db/scoped/index'
import { selectPartnerNames } from '#db/scoped/stores'
import { stuckAfterMinutes } from '#saas/provisioning/stuck'

// The Dashboard, the menu badges and the header search (ui/admin/FIRST-RELEASE.md §2, §3;
// card #35). Every number is counted in SQL and handed over finished: the console never adds
// two fields (ui/README.md §3).

export const attentionListMax = 5
export const newByPartnerMax = 5
export const searchMax = 10
const weekMs = 7 * 24 * 60 * 60 * 1000
const dayMs = 24 * 60 * 60 * 1000

export type AttentionReason =
  | { kind: 'pastDue'; daysPastDue: number }
  | { kind: 'suspended'; reason: string }
  | { kind: 'setup'; state: 'failed' | 'stuck'; step: ProvisioningStep; attempt: number }

export interface DashboardDto {
  /** The filter applied: null for every partner, including when the one asked for is unknown or not the caller's. */
  partnerId: string | null
  partnerOptions: { id: string; name: string }[]
  asOf: Date
  partners: Pick<Record<PartnerState, number>, 'live' | 'awaiting' | 'draft' | 'paused'>
  awaiting: { count: number; oldest: { id: string; name: string; submittedAt: Date; waitingSeconds: number } | null }
  stores: { total: number; newThisWeek: number; newThisWeekByPartner: { id: string; name: string; count: number }[] }
  attention: { pastDue: number; suspended: number; setupFailed: number; setupStuck: number; total: number; stores: { id: string; name: string; partnerName: string; reason: AttentionReason }[] }
  signups: { started: number; completed: number; failed: number; medianSecondsToReady: number | null }
}

export interface NavBadgesDto {
  partnersAwaitingApproval: number
  provisioningAttention: number
  /** Null to a role without `setupSessions.read` (FIRST-RELEASE §2). */
  openSessions: number | null
}

export interface SearchDto {
  partners: { id: string; name: string; state: PartnerState; host: string | null; ownerEmail: string | null }[]
  stores: { id: string; name: string; code: string; status: string; partnerName: string; ownerEmail: string | null; host: string | null }[]
}

export interface DashboardServiceDeps {
  sql: postgres.Sql
  staff: StaffMember
  now: () => Date
}

const searchTerm = z.string().trim().min(2).max(100)

const setupReason = (row: AttentionRow, state: 'failed' | 'stuck'): AttentionReason => {
  if (row.job_step === null || row.job_attempts === null) throw new Error(`attention row ${row.id} is ${state} without a job`)
  return { kind: 'setup', state, step: row.job_step, attempt: row.job_attempts }
}

const reasonOf = (row: AttentionRow, at: Date): AttentionReason => {
  if (row.job_state === 'failed') return setupReason(row, 'failed')
  if (row.stuck) return setupReason(row, 'stuck')
  if (row.status === 'suspended') return { kind: 'suspended', reason: row.suspended_reason ?? '' }
  return { kind: 'pastDue', daysPastDue: Math.max(0, Math.floor((at.getTime() - (row.past_due_since ?? at).getTime()) / dayMs)) }
}

export const createDashboardService = (deps: DashboardServiceDeps) => {
  const { sql, staff, now } = deps
  const context: StaffContext = { caller: { kind: 'staff', staffId: staff.id } }
  const assignedTo = partnerScopedRoles.includes(staff.role) ? staff.id : undefined

  const dashboard = async (partnerId: string | null | undefined): Promise<DashboardDto> => {
    const at = now()
    const weekAgo = new Date(at.getTime() - weekMs)
    return withScope(sql, context, async (tx) => {
      // A partner the caller cannot see is treated as no filter, never as a refusal.
      const known = partnerId && z.guid().safeParse(partnerId).success ? await selectVisiblePartner(tx, partnerId, assignedTo) : null
      const scope: DashboardScope = { partnerId: known?.id, assignedTo }
      const [partnerOptions, byState, oldest, storeCounts, newByPartner, attention, signups] = await Promise.all([
        selectPartnerNames(tx, assignedTo),
        countPartnersByState(tx, scope),
        selectOldestAwaiting(tx, scope),
        countStores(tx, scope, weekAgo),
        countNewStoresByPartner(tx, scope, weekAgo, newByPartnerMax),
        selectAttention(tx, scope, stuckAfterMinutes, at, attentionListMax),
        countSignups(tx, scope, weekAgo),
      ])
      return {
        partnerId: known?.id ?? null,
        partnerOptions,
        asOf: at,
        partners: { live: byState.live, awaiting: byState.awaiting, draft: byState.draft, paused: byState.paused },
        awaiting: {
          count: byState.awaiting,
          oldest: oldest ? { id: oldest.id, name: oldest.name, submittedAt: oldest.submitted_at, waitingSeconds: Math.max(0, Math.floor((at.getTime() - oldest.submitted_at.getTime()) / 1000)) } : null,
        },
        stores: { total: storeCounts.total, newThisWeek: storeCounts.new_since, newThisWeekByPartner: newByPartner },
        attention: {
          pastDue: attention.counts.past_due,
          suspended: attention.counts.suspended,
          setupFailed: attention.counts.setup_failed,
          setupStuck: attention.counts.setup_stuck,
          total: attention.counts.total,
          stores: attention.rows.map((row) => ({ id: row.id, name: row.name, partnerName: row.partner_name, reason: reasonOf(row, at) })),
        },
        signups: {
          started: signups.started,
          completed: signups.completed,
          failed: signups.failed,
          medianSecondsToReady: signups.median_seconds === null ? null : Math.round(Number(signups.median_seconds)),
        },
      }
    })
  }

  // FIRST-RELEASE §2: which badge a role sees is the console's choice; the API gives the counts.
  const navBadges = async (): Promise<NavBadgesDto> => {
    const at = now()
    const scope: DashboardScope = { assignedTo }
    return withScope(sql, context, async (tx) => {
      const [awaiting, setup, sessions] = await Promise.all([
        countAwaitingPartners(tx, scope),
        countSetupAttention(tx, scope, stuckAfterMinutes, at),
        roleHas(staff.role, 'setupSessions.read') ? countOpenSetupSessions(tx, scope, at) : null,
      ])
      return { partnersAwaitingApproval: awaiting, provisioningAttention: setup, openSessions: sessions }
    })
  }

  const search = async (query: unknown): Promise<SearchDto | null> => {
    const parsed = searchTerm.safeParse(query)
    if (!parsed.success) return null
    const scope: DashboardScope = { assignedTo }
    return withScope(sql, context, async (tx) => {
      const [partners, stores] = await Promise.all([searchPartners(tx, parsed.data, scope, searchMax), searchStores(tx, parsed.data, scope, searchMax)])
      return {
        partners: partners.map((p) => ({ id: p.id, name: p.name, state: p.state, host: p.host, ownerEmail: p.owner_email })),
        stores: stores.map((s) => ({ id: s.id, name: s.name, code: s.code, status: s.status, partnerName: s.partner_name, ownerEmail: s.owner_email, host: s.host })),
      }
    })
  }

  return { dashboard, navBadges, search }
}

export type DashboardService = ReturnType<typeof createDashboardService>
