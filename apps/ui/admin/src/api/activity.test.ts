import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubApi } from '../testing/apiStub'
import { loadActivity, loadActivityExport, startActivityExport } from './activity'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const entry = { id: 'e1', occurredAt: '2026-10-03T22:07:00.000Z', action: 'partner.something_new', level: 'admin', result: 'success', actor: { kind: 'staff', id: 's1', label: 'Arjun' }, onBehalfOf: null, access: null, partner: null, store: null, target: { type: 'store_note', id: 'n1', label: 'Note' }, changes: [], reason: null, requestId: '', ip: null, userAgent: null }

describe('loadActivity', () => {
  it('sends only the declared filter keys, and reads any action code and target type the API records', async () => {
    const stub = stubApi({ data: { activityLog: { items: [entry], pageInfo: { startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: false }, export: { allowed: true, reason: null, failingChecks: null }, partners: [], stores: [] } } })
    const page = await loadActivity({ level: 'admin', ...({ state: 'empty' } as object) }, {})
    expect(stub.calls[0]?.variables).toEqual({ filter: { level: 'admin' } })
    expect(page.items[0]).toMatchObject({ action: 'partner.something_new', target: { type: 'store_note' } })
  })
})

describe('the export', () => {
  it('starts with the same filter and throws the refusal by its code', async () => {
    const ok = stubApi({ data: { exportActivity: { ok: true, jobId: 'x1', reason: null } } })
    expect(await startActivityExport({ level: 'admin' })).toMatchObject({ id: 'x1', state: 'preparing' })
    expect(ok.calls[0]?.variables).toEqual({ filter: { level: 'admin' } })
    stubApi({ data: { exportActivity: { ok: false, jobId: null, reason: 'EXPORTERS_ONLY' } } })
    await expect(startActivityExport({})).rejects.toMatchObject({ code: 'EXPORTERS_ONLY' })
  })

  it('makes one link per ready job and revokes it when the job expires or stops being ready', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-04T10:00:00Z') })
    const made: string[] = []
    const revoked: string[] = []
    vi.stubGlobal('URL', Object.assign(Object.create(URL) as typeof URL, { createObjectURL: () => (made.push('blob:1'), 'blob:1'), revokeObjectURL: (url: string) => revoked.push(url) }))
    const ready = { data: { activityExport: { id: 'x1', state: 'ready', entries: 3, csv: 'a,b', expiresAt: '2026-10-04T11:00:00.000Z' } } }
    stubApi(ready)
    expect((await loadActivityExport('x1'))?.url).toBe('blob:1')
    expect((await loadActivityExport('x1'))?.url).toBe('blob:1')
    expect(made).toHaveLength(1)
    vi.advanceTimersByTime(60 * 60_000)
    expect(revoked).toEqual(['blob:1'])
    stubApi(ready)
    await loadActivityExport('x1')
    stubApi({ data: { activityExport: { id: 'x1', state: 'expired', entries: 3, csv: null, expiresAt: '2026-10-04T11:00:00.000Z' } } })
    expect((await loadActivityExport('x1'))?.url).toBeNull()
    expect(revoked).toHaveLength(2)
  })
})
