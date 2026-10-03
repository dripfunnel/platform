// The Provisioning operations on the Admin API (FIRST-RELEASE.md §7, §12): the only place this
// app talks to the API about signup jobs, from the Provisioning list and the store's
// Provisioning tab alike (decided on #43). What is stuck, and whether an action is allowed, is
// the API's answer; the screens only render it.
import type { PageInfo, PageRequest } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import type { StaffRole } from '../features/shell/staffRoles'
import { mutate, query } from './client'
import { compactActions, filterOf, isoString, pageInfoSchema, permissionSchema, refSchema } from './decode'
import type { ActionPermission } from './permissions'
import { provisioningSteps, type ProvisioningStep } from './provisioningSteps'

// `cleaning` is Undo and clean up running its compensations in reverse (SAAS.md §5).
export const jobStates = ['running', 'stuck', 'failed'] as const
export type JobState = (typeof jobStates)[number] | 'cleaning'

export const jobActions = ['retry', 'undo'] as const
export type JobAction = (typeof jobActions)[number]

export const jobRefusals = ['RETRIERS_ONLY', 'CLEANERS_ONLY', 'JOB_RUNNING'] as const
export type JobRefusal = (typeof jobRefusals)[number]

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

const step = z.enum(provisioningSteps)
const state = z.enum([...jobStates, 'cleaning'])
const permission = permissionSchema(jobRefusals).nullable()

const jobSchema = z
  .object({
    id: z.string(),
    store: z.object({ id: z.string(), name: z.string(), code: z.string() }),
    partner: refSchema,
    owner: z.object({ name: z.string(), email: z.string() }),
    state,
    steps: z.array(step),
    step,
    startedAt: isoString,
    attempts: z.number().int().nonnegative(),
    error: z.string().nullable(),
    details: z.string().nullable(),
    actions: z.object({ retry: permission, undo: permission }),
  })
  .transform((job): ProvisioningJob => ({ ...job, actions: compactActions(job.actions) }))

const pageSchema = z.object({ provisioningJobs: z.object({ items: z.array(jobSchema), pageInfo: pageInfoSchema, partners: z.array(refSchema) }) })
const progressSchema = z.object({ provisioningJob: z.object({ id: z.string(), state, step }).nullable() })

// `caller` only spares a role the API would refuse the round trip: it gets the page's no-access view.
export const loadProvisioningJobs = async (filter: JobFilter, page: PageRequest, caller: StaffRole): Promise<JobPage | null> => {
  if (!provisioningRoles.includes(caller)) return null
  const { provisioningJobs } = await query(
    `query Jobs($filter: ProvisioningFilter, $after: String, $before: String) {
      provisioningJobs(filter: $filter, after: $after, before: $before) {
        items {
          id store { id name code } partner { id name } owner { name email } state steps step startedAt attempts error details
          actions { retry { allowed reason failingChecks } undo { allowed reason failingChecks } }
        }
        pageInfo { startCursor endCursor hasPreviousPage hasNextPage } partners { id name }
      }
    }`,
    pageSchema,
    { filter: filterOf(filter, ['partner', 'status', 'step', 'q']), after: page.after, before: page.before },
  )
  return provisioningJobs
}

export const loadJobProgress = async (jobId: string): Promise<JobProgress | null> =>
  (await query(`query Job($id: ID!) { provisioningJob(id: $id) { id state step } }`, progressSchema, { id: jobId })).provisioningJob

// Both start the signup Workflow and return before it ends; the job reports on the next query.
// Until that Workflow exists they refuse with NO_EXECUTOR (apps/api src/saas/provisioning/jobs.ts).
export const retryJob = (jobId: string): Promise<void> => mutate('retryJob', 'retryJob(id: $id)', '($id: ID!)', { id: jobId })

// Every console write is audited with a reason (AGENTS.md), so Undo asks for one (decided on #20).
export const undoJob = (jobId: string, reason: string): Promise<void> =>
  mutate('undoJob', 'undoJob(id: $id, reason: $reason)', '($id: ID!, $reason: String!)', { id: jobId, reason })

// The codes Retry and Undo can refuse with, each worded by the screens.
export const jobFailureCodes = ['NO_EXECUTOR', 'JOB_RUNNING', 'NOT_FOUND', 'NOT_FAILED', 'REASON_REQUIRED', 'FORBIDDEN'] as const
