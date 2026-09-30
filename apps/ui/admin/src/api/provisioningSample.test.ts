import { describe, expect, it } from 'vitest'
import { redacted } from './jobSample'
import { createProvisioningServer } from './provisioningSample'
import { createStoresServer, sampleStores } from './storesSample'

// A Workflow that moves only when the test says so, one step per tick.
const setup = () => {
  const stores = createStoresServer(sampleStores, () => '2026-09-30T00:00:00Z')
  const queue: (() => void)[] = []
  const jobs = createProvisioningServer(stores.signups, (_ms, then) => void queue.push(then))
  const tick = () => queue.shift()?.()
  const settle = () => {
    while (queue.length > 0) tick()
  }
  return { stores, jobs, tick, settle }
}

const all = { after: undefined, before: undefined }

describe('provisioning sample server', () => {
  it('lists the running, stuck and failed signups, newest first, with each job own steps', () => {
    const { jobs } = setup()
    const page = jobs.list({}, all, 25, 'staff-super-admin')
    expect(page?.items.map((job) => [job.store.id, job.state])).toEqual([
      ['s14', 'running'],
      ['s5', 'stuck'],
      ['s13', 'failed'],
    ])
    expect(page?.items.find((job) => job.store.id === 's14')?.steps).toHaveLength(3)
    expect(page?.items.find((job) => job.store.id === 's5')?.steps).toHaveLength(8)
  })

  it('filters by partner, state, step and search', () => {
    const { jobs } = setup()
    const ids = (filter: Parameters<typeof jobs.list>[0]) => jobs.list(filter, all, 25, 'staff-super-admin')?.items.map((job) => job.store.id)
    expect(ids({ partner: 'ns' })).toEqual(['s14'])
    expect(ids({ status: 'stuck' })).toEqual(['s5'])
    expect(ids({ step: 'repo' })).toEqual(['s13'])
    expect(ids({ q: 'OWEN@' })).toEqual(['s13'])
  })

  it('answers no jobs to a role without Provisioning', () => {
    const { jobs } = setup()
    for (const role of ['staff-partner-manager', 'staff-finance', 'staff-read-only'] as const) expect(jobs.list({}, all, 25, role)).toBeNull()
  })

  it('lets Support retry but not undo, and the Engineer on call do both', () => {
    const { jobs } = setup()
    const failed = (role: 'staff-support' | 'staff-engineer') => jobs.list({ status: 'failed' }, all, 25, role)?.items[0]?.actions
    expect(failed('staff-support')).toEqual({ retry: { allowed: true }, undo: { allowed: false, reason: 'CLEANERS_ONLY' } })
    expect(failed('staff-engineer')).toEqual({ retry: { allowed: true }, undo: { allowed: true } })
  })

  it('counts failed and stuck for the badge, never running', () => {
    expect(setup().jobs.needingAttention()).toBe(2)
  })

  it('runs a Retry a step at a time until the store is set up', () => {
    const { stores, jobs, tick, settle } = setup()
    jobs.retry('job-s5', 'fast')
    const running = jobs.list({}, all, 25, 'staff-super-admin')?.items.find((job) => job.id === 'job-s5')
    expect(running).toMatchObject({ state: 'running', attempts: 3, error: null, actions: { retry: { allowed: false, reason: 'JOB_RUNNING' } } })
    expect(jobs.needingAttention()).toBe(1)
    tick()
    expect(jobs.list({}, all, 25, 'staff-super-admin')?.items.find((job) => job.id === 'job-s5')?.step).toBe('done')
    settle()
    expect(jobs.list({}, all, 25, 'staff-super-admin')?.items.map((job) => job.id)).not.toContain('job-s5')
    expect(stores.get('s5', 'staff-super-admin')).toMatchObject({ storefront: 'live', setup: { state: 'done' } })
  })

  it('fails a Retry again at the same step when the provider is still down', () => {
    const { jobs, settle } = setup()
    jobs.retry('job-s13', 'fast')
    settle()
    expect(jobs.list({}, all, 25, 'staff-super-admin')?.items.find((job) => job.id === 'job-s13')).toMatchObject({
      state: 'failed',
      step: 'repo',
      attempts: 3,
      error: 'GitHub didn’t respond while creating the storefront.',
    })
  })

  it('cleans a failed signup up in reverse, then removes the store', () => {
    const { stores, jobs, tick, settle } = setup()
    expect(() => jobs.undo('job-s13', '  ', 'fast')).toThrow()
    jobs.undo('job-s13', 'Retries failed', 'fast')
    expect(jobs.list({}, all, 25, 'staff-super-admin')?.items.find((job) => job.id === 'job-s13')).toMatchObject({ state: 'cleaning', actions: {} })
    tick()
    expect(jobs.list({}, all, 25, 'staff-super-admin')?.items.find((job) => job.id === 'job-s13')?.step).toBe('hostnames')
    settle()
    expect(stores.get('s13', 'staff-super-admin')).toBeNull()
  })

  it('reports one job progress whatever the list is filtered to, and nothing once it finished', () => {
    const { jobs, settle } = setup()
    jobs.retry('job-s13', 'fast')
    expect(jobs.list({ status: 'failed' }, all, 25, 'staff-super-admin')?.items).toHaveLength(0)
    expect(jobs.progress('job-s13')).toEqual({ id: 'job-s13', state: 'running', step: 'repo' })
    jobs.retry('job-s5', 'fast')
    settle()
    expect(jobs.progress('job-s13')).toMatchObject({ state: 'failed' })
    expect(jobs.progress('job-s5')).toBeNull()
  })

  it('refuses to undo a signup that is only stuck', () => {
    expect(() => setup().jobs.undo('job-s5', 'x', 'fast')).toThrow()
  })

  it('redacts anything secret-like as a second line', () => {
    expect(redacted('push failed: token abc.def and ghp_Secret123')).toBe('push failed: [redacted] and [redacted]')
  })
})
