import { describe, expect, it } from 'vitest'
import { exportKindById, exportKindOf, reportExportFor, startedExport } from './exports'

describe('an export’s kind', () => {
  it('is tagged on the job a start gives, and on the failed job a refused start becomes', async () => {
    const job = { id: 'x1', state: 'preparing' as const, entries: null, url: null, expiresAt: null }
    await startedExport('activity', Promise.resolve(job))
    expect(exportKindOf(job)).toBe('activity')
    await expect(startedExport('stores', Promise.reject(new Error('refused')))).rejects.toThrow('refused')
    expect(exportKindById('failed')).toBe('stores')
    // One job at a time: the failed job in the store is the latest start's, and so is its tag.
    await expect(startedExport('activity', Promise.reject(new Error('refused')))).rejects.toThrow('refused')
    expect(exportKindById('failed')).toBe('activity')
    expect(exportKindOf(null)).toBeNull()
  })
})

describe('a report export', () => {
  it('shows only on the tab it was started from, and never a stores or activity export', async () => {
    const growth = { id: 'r1', state: 'preparing' as const, entries: null, url: null, expiresAt: null }
    await startedExport('report', Promise.resolve(growth), 'growth')
    expect(reportExportFor(growth, 'growth')).toBe(growth)
    expect(reportExportFor(growth, 'revenue')).toBeNull()
    const stores = { ...growth, id: 's9' }
    await startedExport('stores', Promise.resolve(stores))
    expect(reportExportFor(stores, 'growth')).toBeNull()
    expect(reportExportFor(null, 'growth')).toBeNull()
  })
})
