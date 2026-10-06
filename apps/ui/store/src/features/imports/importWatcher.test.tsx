// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CatalogImport } from '../../api/imports'
import { fill, messages } from '../../messages'

// The shell's follower of an import: it picks a run back up after a reload and says when it's finished.

const api = vi.hoisted(() => ({ loadImport: vi.fn(), loadImports: vi.fn() }))
vi.mock('../../api/imports', async (actual) => ({ ...(await actual<typeof import('../../api/imports')>()), ...api }))

const { ImportWatcher, importPollMs } = await import('./ImportWatcher')
const { importRun } = await import('./importRun')

const job = (patch: Partial<CatalogImport>): CatalogImport => ({ id: 'i1', state: 'running', source: 'csv', products: 8, ready: 8, matched: 0, done: 2, created: 0, updated: 0, skipped: 0, failed: 0, photosPending: 0, problemCount: 0, problems: [], problemsCsv: null, ...patch })

afterEach(() => {
  cleanup()
  importRun.set(null)
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe('the import watcher', () => {
  it('picks up a run still going, follows it, and says what went in when it ends', async () => {
    vi.useFakeTimers()
    api.loadImports.mockResolvedValue([job({ id: 'i0', state: 'done' }), job({})])
    api.loadImport.mockResolvedValueOnce(job({ done: 5 })).mockResolvedValueOnce(job({ state: 'done', done: 8, created: 6, updated: 2 }))
    render(<ImportWatcher />)
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(importRun.get()?.id).toBe('i1')
    await act(async () => vi.advanceTimersByTimeAsync(importPollMs))
    expect(importRun.get()?.done).toBe(5)
    await act(async () => vi.advanceTimersByTimeAsync(importPollMs))
    expect(importRun.get()?.state).toBe('done')
    expect(screen.getByRole('status').textContent).toBe(fill(messages.imports.banner.finished, { added: '6', updated: '2' }))
    expect(api.loadImport).toHaveBeenCalledTimes(2)
  })

  it('keeps looking while the API can’t be reached, since the run carries on on the server', async () => {
    vi.useFakeTimers()
    api.loadImports.mockResolvedValue([])
    importRun.set(job({}))
    api.loadImport.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(job({ done: 4 }))
    render(<ImportWatcher />)
    await act(async () => vi.advanceTimersByTimeAsync(importPollMs * 2))
    expect(importRun.get()?.done).toBe(4)
  })
})
