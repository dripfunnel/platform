// What the Admin API decides about a signup job, in one place for the stores and provisioning
// samples, which both show it. It stands in for the server until #37, and goes with it.
import type { StaffRole } from '../features/shell/staffRoles'
import type { ActionPermission } from './permissions'
import type { JobPermissions, JobRefusal, JobState } from './provisioning'
import { provisioningSteps, type ProvisioningStep } from './provisioningSteps'

// A store with its own frontend skips steps 4 to 8 (SAAS.md §5).
export const stepsFor = (ownFrontend: boolean): readonly ProvisioningStep[] => (ownFrontend ? provisioningSteps.slice(0, 3) : provisioningSteps)

// How the Workflow last reported a signup. `stepMinutes` is how long the current step had run
// then; `failsAgain` makes a Retry fail at the same step, as a provider still down would.
export interface SampleSetup {
  jobId: string | null
  state: JobState | 'done'
  steps: readonly ProvisioningStep[]
  step: ProvisioningStep
  attempts: number
  startedAt: string | null
  stepMinutes: number
  details: string | null
  failsAgain: boolean
}

// Stuck is per step, because a database write and a first live build can't share one clock
// (decided on #43). #37 owns the real limits; these only model them.
const stuckAfterMinutes: Record<ProvisioningStep, number> = {
  accountAndStore: 1,
  defaults: 1,
  hostnames: 2,
  repo: 5,
  storeConfig: 2,
  hostingTarget: 5,
  firstBuild: 15,
  done: 1,
}

export const stateOf = (setup: SampleSetup): SampleSetup['state'] =>
  setup.state === 'running' && setup.stepMinutes > stuckAfterMinutes[setup.step] ? 'stuck' : setup.state

const retriers: readonly StaffRole[] = ['staff-super-admin', 'staff-support', 'staff-engineer']
const cleaners: readonly StaffRole[] = ['staff-super-admin', 'staff-engineer']

const onlyFor = (caller: StaffRole, roles: readonly StaffRole[], reason: JobRefusal): ActionPermission<JobRefusal> =>
  roles.includes(caller) ? { allowed: true } : { allowed: false, reason }

const running: ActionPermission<JobRefusal> = { allowed: false, reason: 'JOB_RUNNING' }

// FIRST-RELEASE.md §7 with the #20 decisions: Retry while setup failed or is stuck, Undo and
// clean up only for a failed signup, and both held back while a step is still running.
export const jobPermissionsFor = (state: SampleSetup['state'], caller: StaffRole): JobPermissions => {
  switch (state) {
    case 'running':
      return { retry: running, undo: running }
    case 'stuck':
      return { retry: onlyFor(caller, retriers, 'RETRIERS_ONLY') }
    case 'failed':
      return { retry: onlyFor(caller, retriers, 'RETRIERS_ONLY'), undo: onlyFor(caller, cleaners, 'CLEANERS_ONLY') }
    case 'cleaning':
    case 'done':
      return {}
  }
}

// A second line only: the API must never send a secret in an error (decided on #43).
export const redacted = (details: string) => details.replace(/\b(gh[pousr]_|sk_(live|test)_|xox[bp]-)[A-Za-z0-9_-]+|(Bearer|token)\s+[A-Za-z0-9._-]+/gi, '[redacted]')
