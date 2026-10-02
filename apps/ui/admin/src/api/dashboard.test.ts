import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubApi } from '../testing/apiStub'
import { loadDashboard } from './dashboard'

const answer = {
  partnerId: null,
  partnerOptions: [{ id: 'p1', name: 'DripFunnel' }],
  asOf: '2026-10-02T12:00:00.000Z',
  partners: { live: 4, awaiting: 1, draft: 2, paused: 1 },
  awaiting: { count: 1, oldest: { id: 'p2', name: 'Kaufladen Digital', submittedAt: '2026-09-26T12:00:00.000Z', waitingSeconds: 518400 } },
  stores: { total: 103, newThisWeek: 5, newThisWeekByPartner: [{ id: 'p1', name: 'DripFunnel', count: 2 }] },
  attention: {
    pastDue: 11,
    suspended: 1,
    setupFailed: 1,
    setupStuck: 1,
    total: 14,
    stores: [
      { id: 's1', name: 'Peak Supply Co.', partnerName: 'DripFunnel', reason: { kind: 'setup', daysPastDue: null, reason: null, state: 'failed', step: 'repo', attempt: 2 } },
      { id: 's2', name: 'Kiko Kids', partnerName: 'Bazaar Cloud', reason: { kind: 'pastDue', daysPastDue: 9, reason: null, state: null, step: null, attempt: null } },
      { id: 's3', name: 'Redline', partnerName: 'Northstar', reason: { kind: 'suspended', daysPastDue: null, reason: 'Chargeback', state: null, step: null, attempt: null } },
    ],
  },
  signups: { started: 5, completed: 2, failed: 1, medianSecondsToReady: 102 },
}

afterEach(() => void vi.unstubAllGlobals())

describe('loadDashboard', () => {
  it('asks dashboard(partnerId) and hands the five cards over as the API counted them', async () => {
    const stub = stubApi({ data: { dashboard: answer } })
    const data = await loadDashboard('p1')
    expect(stub.calls[0]?.variables).toEqual({ partnerId: 'p1' })
    expect(stub.calls[0]?.query).toContain('dashboard(partnerId: $partnerId)')
    expect(data.stores.total).toBe(103)
    expect(data.attention.stores.map((s) => s.reason)).toEqual([
      { kind: 'setup', state: 'failed', step: 'repo', attempt: 2 },
      { kind: 'pastDue', daysPastDue: 9 },
      { kind: 'suspended', reason: 'Chargeback' },
    ])
    expect(data.signups.medianSecondsToReady).toBe(102)
  })

  it('sends no partner as null, so the API answers for every partner', async () => {
    const stub = stubApi({ data: { dashboard: answer } })
    await loadDashboard(undefined)
    expect(stub.calls[0]?.variables).toEqual({ partnerId: null })
  })

  it('refuses an answer in a shape it does not know, with a code and never the raw body', async () => {
    stubApi({ data: { dashboard: { ...answer, partners: { live: 'four' } } } })
    await expect(loadDashboard(undefined)).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })

  it('surfaces the API error code when the query is refused', async () => {
    stubApi({ errors: [{ message: 'Not signed in.', extensions: { code: 'UNAUTHENTICATED' } }] })
    await expect(loadDashboard(undefined)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })
})
