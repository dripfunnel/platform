import { afterEach, describe, expect, it, vi } from 'vitest'

// Which query reads an export back: its own kind's, or, for a job this tab didn't start, whichever kind answers.

const readers = vi.hoisted(() => ({ loadCatalogExport: vi.fn(), loadOrderExport: vi.fn() }))
vi.mock('../../api/imports', () => ({ loadCatalogExport: readers.loadCatalogExport }))
vi.mock('../../api/orders', () => ({ loadOrderExport: readers.loadOrderExport }))

const { loadAnyExport, startListExport } = await import('./listExport')

const job = (id: string) => ({ id, state: 'preparing' as const, entries: null, url: null, expiresAt: null })

afterEach(() => vi.resetAllMocks())

describe('loadAnyExport', () => {
  it('reads a job this tab started with its own kind’s query', async () => {
    readers.loadOrderExport.mockResolvedValue(job('o1'))
    await startListExport('orders', Promise.resolve(job('o1')))
    expect(await loadAnyExport('o1')).toEqual(job('o1'))
    expect(readers.loadCatalogExport).not.toHaveBeenCalled()
  })

  it('asks each kind for a job it doesn’t know, and remembers the one that answers', async () => {
    readers.loadCatalogExport.mockResolvedValue(null)
    readers.loadOrderExport.mockResolvedValue(job('o2'))
    expect(await loadAnyExport('o2')).toEqual(job('o2'))
    readers.loadCatalogExport.mockClear()
    await loadAnyExport('o2')
    expect(readers.loadCatalogExport).not.toHaveBeenCalled()
    readers.loadOrderExport.mockResolvedValue(null)
    expect(await loadAnyExport('gone')).toBeNull()
  })
})
