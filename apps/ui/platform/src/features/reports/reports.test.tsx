import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Report } from '../../api/reports'
import { messages } from '../../messages'
import { Reports } from './Reports'
import { reports } from './reportsTestData'

const words = messages.reports
const noop = () => undefined
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '’').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => (match[1] ?? '').replace(/&amp;/g, '&'))
const render = async (element: ReactNode) => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: ['/reports'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}
const view = (report: Report, props: Partial<Parameters<typeof Reports>[0]> = {}) =>
  render(<Reports report={report} filter={{}} plans={[{ id: 'p1', name: 'Growth' }]} countries={[{ code: 'US', name: 'United States' }]} forced={null} exportJob={null} onFilter={noop} onExport={noop} onRetry={noop} {...props} />)

describe('Reports', () => {
  it('draws the six tabs, the filters and Export CSV', async () => {
    const text = textOf(await view(reports.growth))
    for (const tab of Object.values(words.tabs)) expect(text).toContain(tab)
    for (const filter of [words.filters.range, words.filters.plan, words.filters.country]) expect(text).toContain(filter)
    expect(text).toContain(words.export.button)
  })

  it('shows every figure and sentence as the API gave it, computing nothing', async () => {
    const growth = textOf(await view(reports.growth))
    expect(growth).toContain(reports.growth.data.summary)
    expect(growth).toContain('34%')
    expect(growth).toContain('Sep 2026')
    expect(growth).toContain('—')
    const revenue = textOf(await view(reports.revenue))
    expect(revenue).toContain(reports.revenue.data.summary)
    expect(revenue).toContain('$3,988.40')
    expect(revenue).toContain('$3,448.40')
    expect(revenue).toContain('All amounts in USD')
    expect(revenue).toContain('2 payments failed · 1 was recovered')
    const plans = textOf(await view(reports.plans))
    expect(plans).toContain('Starter → Growth')
    expect(plans).toContain('3 stores')
    expect(plans).toMatch(/Growth\s+44/)
  })

  it('lists stores by their totals only, linking each, with its change against the month before', async () => {
    const html = await view(reports.stores)
    const text = textOf(html)
    expect(text).toContain('$18,420.00')
    expect(text).toContain('+12.5%')
    expect(text).toContain('-8.2%')
    expect(text).toContain(words.noPlan)
    expect(textOf(await view({ ...reports.stores, data: { ...reports.stores.data, rows: reports.stores.data.rows.map((row) => ({ ...row, changeBps: null })) } }))).toContain(words.stores.noPrior)
    expect(text).toContain('Totals only.')
    expect(hrefs(html)).toEqual(expect.arrayContaining(['/stores/s1', '/stores/s2']))
    expect(text).not.toMatch(/order #|customer:|SKU/i)
  })

  it('links a store near a limit to its Plan and limits tab, and a setup problem to its tab', async () => {
    const usage = await view(reports.usage)
    expect(hrefs(usage)).toContain('/stores/s1?tab=plan')
    expect(textOf(usage)).toContain(words.usage.at)
    expect(textOf(usage)).toContain(words.usage.near)
    expect(textOf(usage)).toContain('100 of 100')
    expect(textOf(usage)).toContain('AI design prompts')
    const setup = await view(reports.setup)
    expect(hrefs(setup)).toEqual(expect.arrayContaining(['/stores/s3?tab=setup', '/stores/s4?tab=domains']))
    expect(textOf(setup)).toContain('Setup stuck at building the storefront since Oct 3, 2026')
    expect(textOf(setup)).toContain('shop.cobalt.example waiting for DNS since Oct 1, 2026')
  })

  it('reads each bar to a screen reader as its label and the API’s value', async () => {
    const html = await view(reports.growth)
    expect(textOf(html)).toMatch(/Aug : 12\s+Sep : 15|Aug: 12 Sep: 15/)
    expect(html).toContain('class="df-visually-hidden"')
    expect(html).toMatch(/class="df-report-bars" aria-hidden="true"/)
  })

  it('gives Setup health its three figures', async () => {
    const text = textOf(await view(reports.setup))
    for (const label of [words.setup.median, words.setup.failed, words.setup.domains]) expect(text).toContain(label)
  })

  it('shows the report export it is given, with its wording', async () => {
    const job = { id: 'x1', state: 'ready' as const, entries: 6, url: 'blob:x', expiresAt: null, truncated: false }
    expect(textOf(await view(reports.growth, { exportJob: job }))).toContain('Your export of 6 rows is ready.')
  })

  it('tells a new partner reports fill in, and loads and fails in its own words', async () => {
    for (const report of Object.values(reports)) {
      const fresh = { ...report, data: { ...report.data, fresh: true } } as typeof report
      expect(textOf(await view(fresh)), report.tab).toContain(words.fresh)
    }
    expect(await view(reports.growth, { forced: 'loading' })).toContain('df-skeleton')
    expect(textOf(await view(reports.growth, { forced: 'error' }))).toContain(words.error.title)
  })
})
