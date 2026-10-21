import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadReport, loadReportFilters, startReportExport } from './reports'

// The figures are the Platform API's (apps/api tests/platform-reports); these check the client.
const answer = vi.fn<(body: { query: string; variables?: Record<string, unknown> }) => unknown>()
beforeEach(() => {
  answer.mockReset()
  vi.stubGlobal('fetch', (_: string, init: RequestInit) => Promise.resolve(new Response(JSON.stringify(answer(JSON.parse(String(init.body)) as { query: string })))))
})
afterEach(() => void vi.unstubAllGlobals())

describe('reports', () => {
  it('asks the tab’s own query with only the declared filters', async () => {
    answer.mockReturnValue({ data: { reportPlans: { summary: 'S', fresh: false, bars: [], rows: [{ plan: null, stores: 2 }], changes: [] } } })
    const report = await loadReport('plans', { range: '3m', ...({ state: 'fresh', tab: 'plans' } as object) })
    expect(answer.mock.calls[0]?.[0].variables).toEqual({ filter: { range: '3m' } })
    expect(report).toMatchObject({ tab: 'plans', data: { rows: [{ plan: null, stores: 2 }] } })
  })

  it('exports by the API’s tab name', async () => {
    answer.mockReturnValue({ data: { exportReport: { ok: true, jobId: 'x1', reason: null } } })
    await startReportExport('stores', {})
    expect(answer.mock.calls[0]?.[0].variables).toMatchObject({ tab: 'storePerformance' })
  })
  it('reads the filters’ choices, and lets a failure reach the page', async () => {
    answer.mockReturnValueOnce({ data: { reportFilters: { plans: [{ id: 'p1', name: 'Growth' }], countries: ['US'] } } })
    expect(await loadReportFilters()).toEqual({ plans: [{ id: 'p1', name: 'Growth' }], countries: ['US'] })
    answer.mockReturnValueOnce({ errors: [{ message: 'no', extensions: { code: 'FORBIDDEN' } }] })
    await expect(loadReportFilters()).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
