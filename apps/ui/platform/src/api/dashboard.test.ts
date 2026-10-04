import { afterEach, describe, expect, it, vi } from 'vitest'
import { dashboardAs } from '../features/dashboard/dashboardTestData'
import { asVariant, loadDashboard } from './dashboard'

afterEach(() => void vi.unstubAllGlobals())

describe('loadDashboard', () => {
  it('asks for the range and reads the answer, an attention row’s refusal by its code', async () => {
    const month = dashboardAs('month', 'partner-support')
    const wire = { ...month, attention: month.attention.map((row) => ({ ...row, action: row.action.allowed ? { allowed: true, code: null } : { allowed: false, code: row.action.code } })) }
    const sent: unknown[] = []
    vi.stubGlobal('fetch', (_: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)))
      return Promise.resolve(new Response(JSON.stringify({ data: { dashboard: wire } })))
    })
    expect(await loadDashboard('month')).toEqual(month)
    expect(sent[0]).toMatchObject({ variables: { range: 'month' } })
  })
})

describe('the ?view= harness over a real answer', () => {
  it('zeroes the numbers for fresh, keeping the range and currencies, and marks stale from the answer’s own time', () => {
    const month = dashboardAs('month')
    const fresh = asVariant(month, 'fresh')
    expect(fresh).toMatchObject({ fresh: true, range: 'month', attention: [], top: [], stores: { total: 0 } })
    expect(fresh.revenue.collected).toEqual({ amount: 0, currency: month.revenue.collected.currency })
    expect(asVariant(month, 'stale').staleSince).toBe(month.asOf)
    expect(asVariant(month, null)).toBe(month)
  })
})
