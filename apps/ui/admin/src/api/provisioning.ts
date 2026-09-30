// The Provisioning operations on the Admin API (FIRST-RELEASE.md §7, §12): the only place this
// app talks to the API about signup jobs, from the Provisioning list and the store's
// Provisioning tab alike (decided on #43). What is stuck, and whether an action is allowed, is
// the API's answer; the screens only render it.
import { harnessEnabled } from '../features/common/useScreenState'
import type { StaffRole } from '../features/shell/staffRoles'
import type { PageInfo, PageRequest } from './pageInfo'
import type { ActionPermission } from './permissions'
import { provisioningServer, type Pace } from './provisioningSample'
import type { ProvisioningStep } from './provisioningSteps'

// `cleaning` is Undo and clean up running its compensations in reverse (SAAS.md §5).
export const jobStates = ['running', 'stuck', 'failed'] as const
export type JobState = (typeof jobStates)[number] | 'cleaning'

export const jobActions = ['retry', 'undo'] as const
export type JobAction = (typeof jobActions)[number]

export type JobRefusal = 'RETRIERS_ONLY' | 'CLEANERS_ONLY' | 'JOB_RUNNING'

export type JobPermissions = Partial<Record<JobAction, ActionPermission<JobRefusal>>>

// `error` is in plain words; `details` is the raw error, which never carries a secret: the
// API guarantees that (decided on #43), the screen doesn't filter it.
export interface ProvisioningJob {
  id: string
  store: { id: string; name: string; code: string }
  partner: { id: string; name: string }
  owner: { name: string; email: string }
  state: JobState
  steps: readonly ProvisioningStep[]
  step: ProvisioningStep
  startedAt: string
  attempts: number
  error: string | null
  details: string | null
  actions: JobPermissions
}

// Where one job has got to, whatever the list on screen is filtered to. Null once it has
// finished: set up, or cleaned up.
export interface JobProgress {
  id: string
  state: JobState
  step: ProvisioningStep
}

export interface JobFilter {
  partner?: string | undefined
  status?: (typeof jobStates)[number] | undefined
  step?: ProvisioningStep | undefined
  q?: string | undefined
}

export interface JobPage {
  items: readonly ProvisioningJob[]
  pageInfo: PageInfo
  partners: readonly { id: string; name: string }[]
}

// Who may open Provisioning (FIRST-RELEASE.md §2); anyone else gets no jobs back.
export const provisioningRoles: readonly StaffRole[] = ['staff-super-admin', 'staff-support', 'staff-engineer']

// The API's cap on a page; it answers with fewer when there are fewer.
export const jobPageSize = 25

const notConnected = () => Promise.reject(new Error('The Admin API has no provisioning queries yet (#37).'))

// Seam: replace the sample with the Admin API's `provisioningJobs(filter, after, before)` and
// `provisioningJob(id)` queries and the `retryJob` and `undoJob` mutations through
// createApiClient from @dripfunnel/shared/graphql once #37 lands
// (https://github.com/dripfunnel/platform/issues/37). Both mutations start a Cloudflare Workflow
// and return before it ends; the job reports its progress on the next query. `caller` and `pace` stand in for the session and the Workflow's real timing, and go
// with the sample. The sample is invented, so it appears only where the ?state= harness does.
export const loadProvisioningJobs = (filter: JobFilter, page: PageRequest, caller: StaffRole): Promise<JobPage | null> =>
  harnessEnabled ? Promise.resolve(provisioningServer.list(filter, page, jobPageSize, caller)) : notConnected()

export const loadJobProgress = (jobId: string): Promise<JobProgress | null> =>
  harnessEnabled ? Promise.resolve(provisioningServer.progress(jobId)) : notConnected()

export const retryJob = (jobId: string, pace: Pace): Promise<void> =>
  harnessEnabled ? Promise.resolve(provisioningServer.retry(jobId, pace)) : notConnected()

// Every console write is audited with a reason (AGENTS.md), so Undo asks for one (decided on #20).
export const undoJob = (jobId: string, reason: string, pace: Pace): Promise<void> =>
  harnessEnabled ? Promise.resolve(provisioningServer.undo(jobId, reason, pace)) : notConnected()
