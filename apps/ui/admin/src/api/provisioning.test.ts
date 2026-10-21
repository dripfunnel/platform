import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubApi } from '../testing/apiStub'
import { jobFailureWords } from '../features/provisioning/useJobRuns'
import { messages } from '../messages'
import { loadJobProgress, loadProvisioningJobs, retryJob, undoJob } from './provisioning'

afterEach(() => void vi.unstubAllGlobals())

const permission = (allowed: boolean, reason: string | null = null) => ({ allowed, reason, failingChecks: null })
const job = { id: 'j1', store: { id: 's1', name: 'Tidewater', code: 'tidewater' }, partner: { id: 'p1', name: 'Northstar' }, owner: { name: 'Ann', email: 'ann@x.example' }, state: 'stuck', steps: ['accountAndStore', 'defaults', 'hostnames'], step: 'hostnames', startedAt: '2026-10-03T22:06:00.000Z', attempts: 1, error: null, details: null, actions: { retry: permission(true), undo: null } }

describe('loadProvisioningJobs', () => {
  it('sends only the declared filter keys and offers just the actions the job carries', async () => {
    const stub = stubApi({ data: { provisioningJobs: { items: [job], pageInfo: { startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: false }, partners: [] } } })
    const page = await loadProvisioningJobs({ status: 'stuck', ...({ state: 'denied' } as object) }, {}, 'staff-super-admin')
    expect(stub.calls[0]?.variables).toEqual({ filter: { status: 'stuck' } })
    expect(page?.items[0]?.actions).toEqual({ retry: { allowed: true } })
  })

  it('spares a role without Provisioning the round trip', async () => {
    const stub = stubApi({})
    expect(await loadProvisioningJobs({}, {}, 'staff-read-only')).toBeNull()
    expect(stub.calls).toHaveLength(0)
  })
})

describe('Retry and Undo', () => {
  it('reads the progress, and words NO_EXECUTOR and the other refusals by code', async () => {
    stubApi({ data: { provisioningJob: { id: 'j1', state: 'running', step: 'hostnames' } } })
    expect(await loadJobProgress('j1')).toEqual({ id: 'j1', state: 'running', step: 'hostnames' })
    stubApi({ data: { retryJob: { ok: false, code: 'NO_EXECUTOR' } } })
    const refused = await retryJob('j1').catch((error: unknown) => error)
    expect(jobFailureWords(refused)).toBe(messages.provisioning.refused.NO_EXECUTOR)
    const stub = stubApi({ data: { undoJob: { ok: true, code: null } } })
    await undoJob('j1', 'Duplicate signup')
    expect(stub.calls[0]?.variables).toEqual({ id: 'j1', reason: 'Duplicate signup' })
    expect(jobFailureWords(new Error('network'))).toBe(messages.provisioning.toasts.failed)
  })
})
