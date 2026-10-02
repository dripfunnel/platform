import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { dashboardRanges, loadDashboard, type DashboardData } from '../../api/dashboard'
import type { Me } from '../../api/me'
import { messages } from '../../messages'
import { Dashboard } from './Dashboard'
import { dashboardStates } from '@dripfunnel/shared/ui'

const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, '’').replace(/&amp;/g, '&')
const render = async (element: ReactNode) => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: ['/dashboard'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}
const me: Me = { id: 'pu-1', name: 'Maya Ortiz', email: 'maya@northstar.com', role: 'partner-owner', partner: { id: 'p-1', name: 'Northstar Commerce', product: 'Northstar Shops', host: 'store.northstar.com', state: 'live' } }
const noop = () => undefined
const dashboard = (data: DashboardData, forced: (typeof dashboardStates)[number] | null = null) => render(<Dashboard me={me} data={data} forced={forced} onRangeChange={noop} onReload={noop} />)
const words = messages.dashboard

describe('the partner Dashboard', () => {
  it('draws the six cards of FIRST-RELEASE §5 with every number linking to the filtered Stores list', async () => {
    const html = await dashboard(await loadDashboard('month', 'partner-owner'))
    const text = textOf(html)
    for (const title of [words.stores.title, words.revenue.title, words.attention.title, words.signups.title, words.usage.title, words.top.title]) expect(text).toContain(title)
    for (const href of ['/stores?status=active', '/stores?status=trial', '/stores?status=pastdue', '/stores?status=suspended', '/stores?created=month', '/stores?near=yes', '/billing', '/billing?tab=payouts', '/reports?tab=stores', '/stores?store=st-juniper']) {
      expect(html).toContain(`href="${href.replace(/&/g, '&amp;')}`)
    }
    expect(text).toContain('86 in total')
    expect(text).toContain('$18,420.00')
    expect(text).toContain('CA$9,880.00')
  })

  it.each(dashboardRanges)('shows the %s range’s comparisons exactly as the API words them', async (range) => {
    const data = await loadDashboard(range, 'partner-owner')
    const text = textOf(await dashboard(data))
    expect(text).toContain(data.revenue.comparison)
    expect(text).toContain(data.signups.comparison)
    expect(text).toContain(data.signups.conversion ?? '')
    expect(text).toContain(words.range[range])
    expect(await dashboard(data)).toContain(`href="/stores?created=${{ month: 'month', last: '30d', q: '90d' }[range]}"`)
  })

  it('disables an attention action the role cannot take, with the reason and who can', async () => {
    const owner = textOf(await dashboard(await loadDashboard('month', 'partner-owner')))
    expect(owner).not.toContain(words.attention.refused.OWNERS_AND_ADMINS_ONLY)
    const support = await dashboard(await loadDashboard('month', 'partner-support'))
    expect(textOf(support)).toContain(words.attention.refused.OWNERS_AND_ADMINS_ONLY)
    expect(textOf(support)).toContain(words.attention.refused.FINANCE_TRIAL_ONLY)
    expect(support).toMatch(/<button[^>]*disabled=""[^>]*>Retry setup<\/button>/)
    const finance = textOf(await dashboard(await loadDashboard('month', 'partner-finance')))
    expect(finance).not.toContain(words.attention.refused.FINANCE_TRIAL_ONLY)
  })

  it('shows a brand-new Live partner zeros and the words that say so', async () => {
    const text = textOf(await dashboard(await loadDashboard('month', 'partner-owner', 'fresh')))
    expect(text).toContain('Create your first store, or share your sign-up link: store.northstar.com/signup')
    expect(text).toContain(words.revenue.fresh)
    expect(text).toContain(words.signups.fresh)
    expect(text).toContain(words.attention.none)
    expect(text).toContain(words.usage.none)
    expect(text).toContain(words.top.none)
  })

  it.each(dashboardStates)('renders the %s state through ?state=', async (state) => {
    const html = await dashboard(await loadDashboard('month', 'partner-owner'), state)
    expect(html).not.toBe('')
    const text = textOf(html)
    if (state === 'loading') expect(html).toContain('df-skeleton')
    if (state === 'error') expect(text).toContain(words.error.title)
    if (state === 'empty') expect(text).toContain(words.empty.title)
    if (state === 'stale') expect(text).toContain('Some numbers are from')
    if (state === 'offline') expect(text).toContain(words.offline.title)
  })

  it('shows the stale notice when the API says so', async () => {
    const text = textOf(await dashboard(await loadDashboard('month', 'partner-owner', 'stale')))
    expect(text).toContain('Some numbers are from')
    expect(text).toContain(words.refresh)
  })
})
