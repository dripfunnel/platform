import { describe, expect, it } from 'vitest'
import { reportCsv } from './csv'
import type { ReportDto } from './index'

const report = (r: object) => r as ReportDto

describe('reportCsv', () => {
  it('writes the header of a tab with no rows', () => {
    expect(reportCsv(report({ tab: 'growth', rows: [] }))).toBe('month,signups,newStores,trialToPaidBps,churned,netStores')
    expect(reportCsv(report({ tab: 'storePerformance', rows: [], truncated: false }))).toBe('storeId,store,plan,sales (minor units),sales currency,orders,changeBps,declining')
  })

  it('says when the rows were cut off', () => {
    const row = { kind: 'stuck', storeId: 's1', store: 'Shop', detail: null, since: new Date('2026-10-01T00:00:00Z') }
    const lines = reportCsv(report({ tab: 'setupHealth', rows: [row], truncated: true })).split('\n')
    expect(lines[1]).toBe('stuck,s1,Shop,,2026-10-01T00:00:00.000Z')
    expect(lines[2]).toBe('Only the first 1 rows are included; narrow the filter to see the rest.')
  })
})
