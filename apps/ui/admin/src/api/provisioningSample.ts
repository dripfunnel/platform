// The signup jobs of the sample stores, served and run the way the Admin API and its Cloudflare
// Workflow would: Retry and Undo return at once and the job then moves a step at a time, so a
// screen has to show it running until it reports back (decided on #43). It works on the stores
// sample's own records and stands in for the server until #37, and goes with it.
import type { StaffRole } from '../features/shell/staffRoles'
import { jobPermissionsFor, redacted, stateOf } from './jobSample'
import { pageByCursor, type PageRequest } from '@dripfunnel/shared/graphql'
import { provisioningRoles, type JobFilter, type JobPage, type JobProgress, type JobState, type ProvisioningJob } from './provisioning'
import { storesServer, type SampleStore } from './storesSample'

// How long each simulated step takes. The harness picks it (?pace=), so whoever checks the screen needn't
// wait through a run and the in-progress state can still be watched (decided on #43).
export const paces = ['fast', 'normal', 'slow'] as const
export type Pace = (typeof paces)[number]

const stepMs: Record<Pace, number> = { fast: 300, normal: 3000, slow: 10_000 }

type Signups = (typeof storesServer)['signups']

const jobOf = (store: SampleStore, caller: StaffRole): ProvisioningJob => {
  const { setup } = store
  const state = stateOf(setup) as JobState
  return {
    id: setup.jobId ?? store.id,
    store: { id: store.id, name: store.name, code: store.code },
    partner: store.partner,
    owner: { name: store.owner.name ?? '', email: store.owner.email ?? '' },
    state,
    steps: setup.steps,
    step: setup.step,
    startedAt: setup.startedAt ?? store.createdAt,
    attempts: setup.attempts,
    error: store.provisioning.error,
    details: setup.details && redacted(setup.details),
    actions: jobPermissionsFor(state, caller),
  }
}

const matches = (job: ProvisioningJob, filter: JobFilter) => {
  const q = filter.q?.trim().toLowerCase()
  return (
    (!filter.partner || job.partner.id === filter.partner) &&
    (!filter.status || job.state === filter.status) &&
    (!filter.step || job.step === filter.step) &&
    (!q || [job.store.name, job.store.code, job.owner.email].some((value) => value.toLowerCase().includes(q)))
  )
}

const newestFirst = (a: ProvisioningJob, b: ProvisioningJob) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id)

export const createProvisioningServer = (signups: Signups, wait: (ms: number, then: () => void) => void = (ms, then) => void setTimeout(then, ms)) => {
  const inFlight = () => signups.all().filter((store) => stateOf(store.setup) !== 'done')

  const find = (jobId: string) => {
    const store = inFlight().find((candidate) => candidate.setup.jobId === jobId)
    if (!store) throw new Error('No such job.')
    return store
  }

  const list = (filter: JobFilter, page: PageRequest, size: number, caller: StaffRole): JobPage | null => {
    if (!provisioningRoles.includes(caller)) return null
    const all = inFlight()
      .map((store) => jobOf(store, caller))
      .filter((job) => matches(job, filter))
      .sort(newestFirst)
    const { items, pageInfo } = pageByCursor(all, page, size)
    const partners = [...new Map(inFlight().map((store) => [store.partner.id, store.partner])).values()]
    return { items, pageInfo, partners }
  }

  const progress = (jobId: string): JobProgress | null => {
    const store = inFlight().find((candidate) => candidate.setup.jobId === jobId)
    return store ? { id: jobId, state: stateOf(store.setup) as JobState, step: store.setup.step } : null
  }

  // What the menu badge counts: failed and stuck, never running (decided on #43).
  const needingAttention = () => inFlight().filter((store) => ['failed', 'stuck'].includes(stateOf(store.setup))).length

  const setSetup = (id: string, change: Partial<SampleStore['setup']>, extra: Partial<SampleStore> = {}) =>
    signups.update(id, (store) => ({ ...store, ...extra, setup: { ...store.setup, ...change } }))

  // Runs the remaining steps forward. A job flagged `failsAgain` fails at the step it failed at
  // before, with the same error, and keeps the attempt it used.
  const retry = (jobId: string, pace: Pace) => {
    const store = find(jobId)
    const { setup } = store
    const state = stateOf(setup)
    if (state !== 'failed' && state !== 'stuck') throw new Error('Only a failed or stuck signup can be retried.')
    const failedAt = setup.step
    const failure = { error: store.provisioning.error, details: setup.details }
    setSetup(store.id, { state: 'running', attempts: setup.attempts + 1, stepMinutes: 0, details: null }, { provisioning: { error: null } })
    const step = () =>
      wait(stepMs[pace], () => {
        const current = signups.all().find((candidate) => candidate.id === store.id)
        if (!current || current.setup.state !== 'running') return
        const { steps } = current.setup
        if (current.setup.failsAgain && current.setup.step === failedAt) {
          setSetup(current.id, { state: 'failed', details: failure.details }, { provisioning: { error: failure.error } })
          return
        }
        const next = steps[steps.indexOf(current.setup.step) + 1]
        if (!next) {
          setSetup(current.id, { state: 'done' }, current.storefront === 'own' ? {} : { storefront: 'live' })
          return
        }
        setSetup(current.id, { step: next, stepMinutes: 0 })
        step()
      })
    step()
  }

  // Runs each finished step's compensation in reverse (SAAS.md §5), then the store is gone.
  const undo = (jobId: string, reason: string, pace: Pace) => {
    const store = find(jobId)
    if (stateOf(store.setup) !== 'failed') throw new Error('Only a failed signup can be cleaned up.')
    if (!reason.trim()) throw new Error('Undo needs a reason.')
    setSetup(store.id, { state: 'cleaning' })
    const step = () =>
      wait(stepMs[pace], () => {
        const current = signups.all().find((candidate) => candidate.id === store.id)
        if (!current) return
        const previous = current.setup.steps[current.setup.steps.indexOf(current.setup.step) - 1]
        if (!previous) {
          signups.remove(current.id)
          return
        }
        setSetup(current.id, { step: previous })
        step()
      })
    step()
  }

  return { list, progress, needingAttention, retry, undo }
}

export const provisioningServer = createProvisioningServer(storesServer.signups)
