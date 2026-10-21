import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readExportJob } from './exportJob'

const revoked: string[] = []
let made = 0
beforeEach(() => {
  revoked.length = 0
  made = 0
  vi.useFakeTimers({ now: Date.parse('2026-10-04T10:00:00Z') })
  vi.stubGlobal('URL', Object.assign(Object.create(URL) as typeof URL, { createObjectURL: () => `blob:${++made}`, revokeObjectURL: (url: string) => revoked.push(url) }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const job = (state: 'queued' | 'done' | 'failed' | 'too_large' | 'expired', extra: object = {}) => ({ id: 'x1', state, rows: 3, truncated: false, csv: null, expiresAt: '2026-10-04T11:00:00.000Z', ...extra })

describe('an export job', () => {
  it('becomes one download link while ready, revoked when its link expires', () => {
    expect(readExportJob(job('done', { csv: 'a,b' }))).toMatchObject({ state: 'ready', url: 'blob:1', entries: 3 })
    expect(readExportJob(job('done', { csv: 'a,b' }))?.url).toBe('blob:1')
    vi.advanceTimersByTime(60 * 60_000)
    expect(revoked).toEqual(['blob:1'])
  })

  it('drops its link once expired or failed, and reads a done job with no CSV as failed', () => {
    readExportJob(job('done', { id: 'x2', csv: 'a' }))
    expect(readExportJob(job('expired', { id: 'x2' }))).toMatchObject({ state: 'expired', url: null })
    expect(revoked).toEqual(['blob:1'])
    expect(readExportJob(job('done'))).toMatchObject({ state: 'failed', url: null })
    expect(readExportJob(job('too_large'))?.state).toBe('tooLarge')
    expect(readExportJob(job('queued'))?.state).toBe('preparing')
    expect(readExportJob(null)).toBeNull()
  })
})
