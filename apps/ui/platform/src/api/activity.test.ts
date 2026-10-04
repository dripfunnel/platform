import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadActivity, loadActivityExport, loadPersonTimeline, startActivityExport } from './activity'

// What a partner may read is the Platform API's (apps/api tests/platform-activity); these check the client.
const answer = vi.fn<(body: { query: string; variables?: Record<string, unknown> }) => unknown>()
beforeEach(() => {
  answer.mockReset()
  vi.stubGlobal('fetch', (_: string, init: RequestInit) => Promise.resolve(new Response(JSON.stringify(answer(JSON.parse(String(init.body)) as { query: string })))))
})
afterEach(() => void vi.unstubAllGlobals())

const pageInfo = { startCursor: null, endCursor: 'c1', hasPreviousPage: false, hasNextPage: true }
const raw = { id: 'e1', at: '2026-10-04T09:00:00.000Z', category: 'write', action: 'plan.updated', result: 'success', actor: { kind: 'staff', id: 'st1', label: 'Priya <p@x>' }, onBehalfOf: null, through: 'setup_session', storeId: null, storeName: null, target: { type: 'plan', id: null, label: null }, changes: null, reason: null }

describe('the activity log', () => {
  it('sends only the declared chips, and reads an entry with no target label or changes', async () => {
    answer.mockReturnValue({ data: { activityLog: { items: [raw], pageInfo } } })
    const page = await loadActivity({ who: 'setup', ...({ state: 'empty' } as object) }, { after: 'c0' })
    expect(answer.mock.calls[0]?.[0].variables).toEqual({ filter: { who: 'setup' }, after: 'c0' })
    expect(page.items[0]).toMatchObject({ through: 'setup_session', target: null, changes: [] })
  })

  it('asks a person’s timeline by the API’s own reference', async () => {
    answer.mockReturnValue({ data: { personTimeline: { items: [], pageInfo } } })
    await loadPersonTimeline('team:pu1', { result: 'failed' }, {})
    expect(answer.mock.calls[0]?.[0].variables).toMatchObject({ person: 'team:pu1', filter: { result: 'failed' } })
  })
})

describe('the export', () => {
  it('starts a job, and reads it ready with its link, or capped', async () => {
    vi.stubGlobal('URL', Object.assign(Object.create(URL) as typeof URL, { createObjectURL: () => 'blob:activity', revokeObjectURL: () => undefined }))
    answer.mockReturnValueOnce({ data: { exportActivity: { ok: true, jobId: 'x1', reason: null } } })
    expect(await startActivityExport({})).toMatchObject({ id: 'x1', state: 'preparing' })
    answer.mockReturnValueOnce({ data: { activityExport: { id: 'x1', state: 'done', rows: 10000, truncated: true, csv: 'a', expiresAt: null } } })
    expect(await loadActivityExport('x1')).toMatchObject({ state: 'ready', url: 'blob:activity', entries: 10000, truncated: true })
    answer.mockReturnValueOnce({ data: { exportActivity: { ok: false, jobId: null, reason: 'OWNERS_AND_ADMINS_ONLY' } } })
    await expect(startActivityExport({})).rejects.toMatchObject({ code: 'OWNERS_AND_ADMINS_ONLY' })
  })
})
