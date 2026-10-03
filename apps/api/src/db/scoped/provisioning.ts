import type { JobState, ProvisioningStep } from '../schema/saas'
import type { KeysetPage } from './activity'
import type { ScopedSql } from './index'
import { stuckJobPredicate } from './stores'

// Signup jobs for the admin console's Provisioning (ui/admin/FIRST-RELEASE.md §7; card #37):
// each store's latest job while it is running, stuck, failed or cleaning up, never a finished one.

export type JobListState = 'running' | 'stuck' | 'failed'

export interface ProvisioningFilter {
  partnerId?: string | undefined
  state?: JobListState | undefined
  step?: ProvisioningStep | undefined
  q?: string | undefined
  assignedTo?: string | undefined
}

export interface ProvisioningJobRow {
  id: string
  store_id: string
  store_name: string
  store_code: string
  partner_id: string
  partner_name: string
  owner_name: string | null
  owner_email: string | null
  state: JobState
  stuck: boolean
  steps: ProvisioningStep[]
  step: ProvisioningStep
  step_started_at: Date
  started_at: Date
  attempts: number
  last_error: string | null
  details: string | null
}

const projection = (tx: ScopedSql, stuck: Readonly<Record<ProvisioningStep, number>>, now: Date) => tx`
  select j.id, j.store_id, s.name as store_name, s.code as store_code, s.partner_id, p.name as partner_name,
    o.name as owner_name, o.email as owner_email, j.state, ${stuckJobPredicate(tx, stuck, now)} as stuck,
    to_jsonb(j.steps) as steps, j.step, j.step_started_at, date_trunc('milliseconds', j.started_at) as started_at, j.attempts, j.last_error, d.details
  from job j
  join store s on s.id = j.store_id
  join partner p on p.id = s.partner_id
  left join job_detail d on d.job_id = j.id
  left join lateral (
    select u.name, u.email from membership m join "user" u on u.id = m.user_id
    where m.store_id = s.id and m.seller_id is null and m.role_key = 'owner' order by m.created_at limit 1
  ) o on true
`

const latestOnly = (tx: ScopedSql) => tx`j.id = (select id from job where store_id = j.store_id order by started_at desc limit 1)`

/** Newest started first by (started_at, id), one more row than asked; `before` reads backwards and is flipped. */
export const selectProvisioningJobs = async (
  tx: ScopedSql,
  f: ProvisioningFilter,
  page: KeysetPage,
  limit: number,
  stuck: Readonly<Record<ProvisioningStep, number>>,
  now: Date,
): Promise<ProvisioningJobRow[]> => {
  const backwards = page.before !== undefined
  const key = tx`date_trunc('milliseconds', j.started_at)`
  const isStuck = stuckJobPredicate(tx, stuck, now)
  const like = f.q ? `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null
  const rows = await tx<ProvisioningJobRow[]>`
    ${projection(tx, stuck, now)}
    where ${latestOnly(tx)} and j.state in ('running', 'failed', 'cleaning')
      ${f.state === 'failed' ? tx`and j.state = 'failed'` : tx``}
      ${f.state === 'stuck' ? tx`and ${isStuck}` : tx``}
      ${f.state === 'running' ? tx`and j.state = 'running' and not ${isStuck}` : tx``}
      ${f.partnerId !== undefined ? tx`and s.partner_id = ${f.partnerId}` : tx``}
      ${f.step !== undefined ? tx`and j.step = ${f.step}` : tx``}
      ${like ? tx`and (s.name ilike ${like} or s.code ilike ${like} or o.email ilike ${like})` : tx``}
      ${f.assignedTo !== undefined ? tx`and s.partner_id in (select partner_id from staff_partner_assignment a where a.staff_user_id = ${f.assignedTo} and a.removed_at is null)` : tx``}
      ${page.after !== undefined ? tx`and (${key}, j.id) < (${page.after.occurredAt}, ${page.after.id}::uuid)` : tx``}
      ${page.before !== undefined ? tx`and (${key}, j.id) > (${page.before.occurredAt}, ${page.before.id}::uuid)` : tx``}
    ${backwards ? tx`order by ${key} asc, j.id asc` : tx`order by ${key} desc, j.id desc`}
    limit ${limit + 1}
  `
  return backwards ? rows.reverse() : rows
}

export const selectProvisioningJob = async (tx: ScopedSql, id: string, stuck: Readonly<Record<ProvisioningStep, number>>, now: Date, assignedTo: string | undefined): Promise<ProvisioningJobRow | null> =>
  (
    await tx<ProvisioningJobRow[]>`
      ${projection(tx, stuck, now)}
      where j.id = ${id}
        ${assignedTo !== undefined ? tx`and s.partner_id in (select partner_id from staff_partner_assignment a where a.staff_user_id = ${assignedTo} and a.removed_at is null)` : tx``}
    `
  )[0] ?? null
