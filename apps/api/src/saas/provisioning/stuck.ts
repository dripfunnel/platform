import type { JobRow, ProvisioningStep } from '#db/schema/saas'

// Whether a signup step is stuck is a limit per step, not one clock for the whole signup
// (decided on #43): a database write and a first live build cannot share one.
export const stuckAfterMinutes: Readonly<Record<ProvisioningStep, number>> = {
  accountAndStore: 1,
  defaults: 1,
  hostnames: 2,
  repo: 5,
  storeConfig: 2,
  hostingTarget: 5,
  firstBuild: 15,
  done: 1,
}

/** SAAS.md §5: the first three steps make a usable store; the rest make the storefront. */
export const stepsFor = (storefrontKind: 'ai' | 'own'): readonly ProvisioningStep[] =>
  storefrontKind === 'own' ? ['accountAndStore', 'defaults', 'hostnames'] : ['accountAndStore', 'defaults', 'hostnames', 'repo', 'storeConfig', 'hostingTarget', 'firstBuild', 'done']

export type SetupState = 'done' | 'running' | 'stuck' | 'failed' | 'cleaning'

export const setupStateOf = (job: Pick<JobRow, 'state' | 'step' | 'step_started_at'> | null, now: Date): SetupState => {
  if (!job || job.state === 'done' || job.state === 'undone') return 'done'
  if (job.state === 'failed' || job.state === 'cleaning') return job.state
  const minutes = (now.getTime() - job.step_started_at.getTime()) / 60_000
  return minutes > stuckAfterMinutes[job.step] ? 'stuck' : 'running'
}
