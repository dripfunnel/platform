import type postgres from 'postgres'
import { z } from 'zod'
import { partnerScopedRoles, roleHas } from '#auth/permissions'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import type { StaffMember } from '#auth/staff'
import { redactSecretsInText } from '#core/secretText'
import { provisioningSteps } from '#db/schema/saas'
import { withScope } from '#db/scoped/index'
import { markJobCleaning, selectProvisioningJob, selectProvisioningJobs, type ProvisioningJobRow } from '#db/scoped/provisioning'
import { selectPartnerNames } from '#db/scoped/stores'
import type { PageInfo } from '#saas/activity/index'
import { queueSideEffect } from '#saas/outbox/index'
import { decodePage, pageOf, staffEntry, type PageRequest } from '#saas/staff/index'
import { retryStorefront, storefrontUndoKind } from '#saas/storefronts/index'
import { stuckAfterMinutes } from './stuck'

// Provisioning on the Admin API (ui/admin/FIRST-RELEASE.md §7, §12; card #37): signups in progress, stuck or failed, and
// Retry and Undo. Only a failed create-storefront job has an executor (#730); a provision-store job answers NO_EXECUTOR.

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
export type JobActionResult = { ok: true; code: null } | { ok: false; code: 'NOT_FOUND' | 'JOB_RUNNING' | 'NOT_FAILED' | 'REASON_REQUIRED' | 'NO_EXECUTOR' }

export interface ProvisioningDeps {
  sql: postgres.Sql
  staff: StaffMember
  facts: RequestFacts
  activity: ActivityLog
  now: () => Date
}

const stateOf = (row: ProvisioningJobRow): 'running' | 'stuck' | 'failed' | 'cleaning' =>
  row.state === 'failed' ? 'failed' : row.state === 'cleaning' ? 'cleaning' : row.stuck ? 'stuck' : 'running'

export const createProvisioningService = ({ sql, staff, facts, activity, now }: ProvisioningDeps) => {
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

  const asStaff = staffEntry(staff, facts)
  const record = (tx: Parameters<ActivityLog['record']>[0], row: ProvisioningJobRow, action: string, reason: string | null) =>
    activity.record(tx, asStaff({ action, reason, partnerId: row.partner_id, storeId: row.store_id, target: { type: 'store', id: row.store_id, label: row.store_name }, visibility: 'partner' }))

  /**
   * The job's own checks, then the executor: nothing runs a step inside a request (api/README §4), so a Retry or an Undo
   * queues what the Workflow does after commit. Only a store's newest create-storefront job is acted on (its
   * compensations name the store's folders, which a later job may own).
   */
  const act = async (id: string, kind: 'retry' | 'undo', reason: string | null): Promise<JobActionResult> => {
    if (!z.guid().safeParse(id).success) return { ok: false, code: 'NOT_FOUND' }
    const why = reason?.trim() ?? ''
    if (kind === 'undo' && !why) return { ok: false, code: 'REASON_REQUIRED' }
    return withScope(sql, context, async (tx): Promise<JobActionResult> => {
      const row = await selectProvisioningJob(tx, id, stuckAfterMinutes, now(), assignedTo)
      if (!row || row.state === 'done' || row.state === 'undone') return { ok: false, code: 'NOT_FOUND' }
      const state = stateOf(row)
      if (state === 'running' || state === 'cleaning') return { ok: false, code: 'JOB_RUNNING' }
      if (kind === 'undo' && state !== 'failed') return { ok: false, code: 'NOT_FAILED' }
      if (row.kind !== 'create-storefront' || state !== 'failed') return { ok: false, code: 'NO_EXECUTOR' }
      // A Retry asked twice: the first one's job is running, and that is the answer to both.
      if (row.latest_id !== row.id) return kind === 'retry' && row.latest_state === 'running' ? { ok: true, code: null } : { ok: false, code: 'NOT_FOUND' }
      if (kind === 'retry') {
        const started = await retryStorefront(tx, row.id, now())
        if (!started.ok) return { ok: false, code: 'NOT_FOUND' }
        await record(tx, row, jobAudit.retryJob, null)
        return { ok: true, code: null }
      }
      await markJobCleaning(tx, row.id)
      await queueSideEffect(tx, { kind: storefrontUndoKind, idempotencyKey: `${storefrontUndoKind}:${row.id}`, payload: { storeId: row.store_id, jobId: row.id }, partnerId: row.partner_id, storeId: row.store_id })
      await record(tx, row, jobAudit.undoJob, why)
      return { ok: true, code: null }
    })
  }

  return {
    provisioningJobs,
    provisioningJob,
    retryJob: (id: string) => act(id, 'retry', null),
    undoJob: (id: string, reason: string) => act(id, 'undo', reason),
  }
}

export type ProvisioningService = ReturnType<typeof createProvisioningService>
export type ProvisioningJobDto = ReturnType<ReturnType<typeof createProvisioningService>['provisioningJobs']> extends Promise<infer P> ? (P extends { items: (infer I)[] } ? I : never) : never
