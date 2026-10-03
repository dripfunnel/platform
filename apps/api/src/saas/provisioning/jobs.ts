import type postgres from 'postgres'
import { z } from 'zod'
import { partnerScopedRoles, roleHas } from '#auth/permissions'
import type { StaffMember } from '#auth/staff'
import { redactSecretsInText } from '#core/secretText'
import { provisioningSteps } from '#db/schema/saas'
import { withScope } from '#db/scoped/index'
import { selectProvisioningJob, selectProvisioningJobs, type ProvisioningJobRow } from '#db/scoped/provisioning'
import { selectPartnerNames } from '#db/scoped/stores'
import type { PageInfo } from '#saas/activity/index'
import { decodePage, pageOf, type PageRequest } from '#saas/staff/index'
import { stuckAfterMinutes } from './stuck'

// Provisioning on the Admin API (ui/admin/FIRST-RELEASE.md §7, §12; card #37): signups in
// progress, stuck or failed, and Retry and Undo. The Workflow that runs a signup's steps is the
// Store strand's merchant-signup card, so the two actions refuse with NO_EXECUTOR until it exists.

export const jobPageSize = 25
export const jobAudit = { retryJob: 'job.retried', undoJob: 'job.undone' } as const

export const jobFilter = z.strictObject({
  partner: z.guid().optional(),
  status: z.enum(['running', 'stuck', 'failed']).optional(),
  step: z.enum(provisioningSteps).optional(),
  q: z.string().trim().min(1).max(100).optional(),
})

type Refusal = 'RETRIERS_ONLY' | 'CLEANERS_ONLY' | 'JOB_RUNNING'
type Permission = { allowed: true } | { allowed: false; reason: Refusal }
export type JobActionResult = { ok: false; code: 'NOT_FOUND' | 'JOB_RUNNING' | 'NOT_FAILED' | 'REASON_REQUIRED' | 'NO_EXECUTOR' }

export interface ProvisioningDeps {
  sql: postgres.Sql
  staff: StaffMember
  now: () => Date
}

const stateOf = (row: ProvisioningJobRow): 'running' | 'stuck' | 'failed' | 'cleaning' =>
  row.state === 'failed' ? 'failed' : row.state === 'cleaning' ? 'cleaning' : row.stuck ? 'stuck' : 'running'

export const createProvisioningService = ({ sql, staff, now }: ProvisioningDeps) => {
  const context = { caller: { kind: 'staff' as const, staffId: staff.id } }
  const assignedTo = partnerScopedRoles.includes(staff.role) ? staff.id : undefined
  const may = (permission: 'provisioning.retry' | 'provisioning.undo', refusal: Refusal): Permission =>
    roleHas(staff.role, permission) ? { allowed: true } : { allowed: false, reason: refusal }

  // FIRST-RELEASE §7 with the #20 decisions, as the store's Provisioning tab says them (#34).
  const actionsFor = (state: ReturnType<typeof stateOf>): { retry?: Permission; undo?: Permission } => {
    switch (state) {
      case 'running':
        return { retry: { allowed: false, reason: 'JOB_RUNNING' }, undo: { allowed: false, reason: 'JOB_RUNNING' } }
      case 'stuck':
        return { retry: may('provisioning.retry', 'RETRIERS_ONLY') }
      case 'failed':
        return { retry: may('provisioning.retry', 'RETRIERS_ONLY'), undo: may('provisioning.undo', 'CLEANERS_ONLY') }
      case 'cleaning':
        return {}
    }
  }

  const jobOf = (row: ProvisioningJobRow) => {
    const state = stateOf(row)
    return {
      id: row.id,
      store: { id: row.store_id, name: row.store_name, code: row.store_code },
      partner: { id: row.partner_id, name: row.partner_name },
      owner: { name: row.owner_name, email: row.owner_email },
      state,
      // The job's own list: three steps for a store with its own frontend, eight otherwise (#43).
      steps: row.steps,
      step: row.step,
      startedAt: row.started_at,
      attempts: row.attempts,
      // Never a secret, whoever reads it (decided on #43): the API redacts, not the screen.
      error: redactSecretsInText(row.last_error),
      details: redactSecretsInText(row.details),
      actions: actionsFor(state),
    }
  }

  /** Null for a filter or cursor it cannot read. */
  const provisioningJobs = async (raw: unknown, page: PageRequest) => {
    const parsed = jobFilter.safeParse(raw ?? {})
    if (!parsed.success) return null
    const decoded = decodePage(page, jobPageSize)
    if (!decoded.ok) return null
    const f = parsed.data
    return withScope(sql, context, async (tx) => {
      const rows = await selectProvisioningJobs(tx, { partnerId: f.partner, state: f.status, step: f.step, q: f.q, assignedTo }, decoded, decoded.limit, stuckAfterMinutes, now())
      const { rows: pageRows, pageInfo } = pageOf(rows, decoded, (r) => ({ occurredAt: r.started_at, id: r.id }))
      return { items: pageRows.map(jobOf), pageInfo: pageInfo as PageInfo, partners: await selectPartnerNames(tx, assignedTo) }
    })
  }

  /** Where a started job has got to, whatever the list shows; null once it has finished or for an unknown id. */
  const provisioningJob = async (id: string) => {
    if (!z.guid().safeParse(id).success) return null
    return withScope(sql, context, async (tx) => {
      const row = await selectProvisioningJob(tx, id, stuckAfterMinutes, now(), assignedTo)
      if (!row || row.state === 'done' || row.state === 'undone') return null
      return { id: row.id, state: stateOf(row), step: row.step }
    })
  }

  /** The job's own checks, then NO_EXECUTOR: nothing may half-run a signup step inside a request (api/README §4). */
  const refuseWithoutExecutor = async (id: string, kind: 'retry' | 'undo', reason: string | null): Promise<JobActionResult> => {
    if (!z.guid().safeParse(id).success) return { ok: false, code: 'NOT_FOUND' }
    if (kind === 'undo' && !reason?.trim()) return { ok: false, code: 'REASON_REQUIRED' }
    return withScope(sql, context, async (tx): Promise<JobActionResult> => {
      const row = await selectProvisioningJob(tx, id, stuckAfterMinutes, now(), assignedTo)
      if (!row || row.state === 'done' || row.state === 'undone') return { ok: false, code: 'NOT_FOUND' }
      const state = stateOf(row)
      if (state === 'running' || state === 'cleaning') return { ok: false, code: 'JOB_RUNNING' }
      if (kind === 'undo' && state !== 'failed') return { ok: false, code: 'NOT_FAILED' }
      return { ok: false, code: 'NO_EXECUTOR' }
    })
  }

  return {
    provisioningJobs,
    provisioningJob,
    retryJob: (id: string) => refuseWithoutExecutor(id, 'retry', null),
    undoJob: (id: string, reason: string) => refuseWithoutExecutor(id, 'undo', reason),
  }
}

export type ProvisioningService = ReturnType<typeof createProvisioningService>
export type ProvisioningJobDto = ReturnType<ReturnType<typeof createProvisioningService>['provisioningJobs']> extends Promise<infer P> ? (P extends { items: (infer I)[] } ? I : never) : never
