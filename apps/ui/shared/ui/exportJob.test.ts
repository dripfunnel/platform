import { describe, expect, it } from 'vitest'
import type { ExportJob } from '../graphql/exportJob'
import { exportCheck } from './exportJob'

const job = (state: ExportJob['state'], more: Partial<ExportJob> = {}): ExportJob => ({ id: 'x1', state, entries: null, url: null, expiresAt: null, ...more })
const ready = job('ready', { entries: 12, url: 'blob:activity', expiresAt: '2026-09-30T13:00:00Z' })

describe('exportCheck', () => {
  it('checks a preparing export again until it changes', () => {
    expect(exportCheck(job('preparing'), job('preparing'))).toEqual({ kind: 'again' })
  })

  it('announces an export that has become ready', () => {
    expect(exportCheck(job('preparing'), ready)).toEqual({ kind: 'update', job: ready, announce: true })
  })

  it('keeps checking a link the server still calls ready at its expiry, until it expires', () => {
    expect(exportCheck(ready, ready)).toEqual({ kind: 'again' })
    expect(exportCheck(ready, job('expired'))).toEqual({ kind: 'update', job: job('expired'), announce: false })
  })

  it('ends as failed when the check is unanswered or the job is gone, never stuck preparing', () => {
    for (const answer of ['unreachable', null] as const) {
      expect(exportCheck(job('preparing'), answer)).toEqual({ kind: 'update', job: job('failed'), announce: false })
    }
    expect(exportCheck(ready, 'unreachable')).toMatchObject({ kind: 'update', job: { state: 'failed', url: null } })
  })
})
