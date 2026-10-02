import { navView, SideNav } from '@dripfunnel/shared/ui'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Me } from '../../api/me'
import type { NavBadges } from '../../api/navBadges'
import { messages } from '../../messages'
import { navFor } from '../../nav'
import { AppHeader } from './AppHeader'
import { navWords } from './navWords'
import { partnerRoles, type PartnerRole } from './partnerRoles'
import { PartnerStrip } from './PartnerStrip'

const me: Me = { id: 'pu-1', name: 'Maya Ortiz', email: 'maya@northstar.com', role: 'partner-owner', partner: { id: 'p-1', name: 'Northstar Commerce', product: 'Northstar Shops', host: 'store.northstar.com', state: 'live' } }
const waiting: NavBadges = { storesAttention: 2, brandingSetupLeft: 1, domainsWaiting: 1, billingFailedPayments: 1, supportOpenSessions: 1 }
const quiet: NavBadges = { storesAttention: 0, brandingSetupLeft: 0, domainsWaiting: 0, billingFailedPayments: 0, supportOpenSessions: 0 }

const render = async (element: ReactNode, path = '/dashboard') => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: [path] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}
const nav = (role: PartnerRole, badges = waiting, path?: string) =>
  render(<SideNav rows={navView(navFor(role), badges, navWords)} variant="bar" label={messages.shell.navLabel} footer="" />, path)

describe('the partner console menu', () => {
  it.each(partnerRoles)('renders exactly the rows FIRST-RELEASE §2.1 gives %s, with absent rows out of the markup', async (role) => {
    const html = await nav(role)
    for (const row of navFor(role)) expect(html).toContain(`href="${row.to}"`)
    expect(html.includes('href="/billing"')).toBe(role !== 'partner-support')
    expect(html.includes('href="/support"')).toBe(role === 'partner-owner' || role === 'partner-admin' || role === 'partner-support')
    expect(html).not.toContain('disabled')
  })

  it('gives every badge a spoken label and shows none when nothing is waiting', async () => {
    const html = await nav('partner-owner')
    expect(html).toContain('<span aria-hidden="true">2</span>')
    expect(html).toContain('<span class="df-visually-hidden">2 need attention</span>')
    expect(html).toContain('1 open now')
    expect(await nav('partner-owner', quiet)).not.toContain('df-nav-badge')
  })

  it('marks the current location with aria-current', async () => {
    const html = await nav('partner-finance', waiting, '/plans')
    expect(html).toMatch(/<a[^>]*href="\/plans"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="\/plans"/)
    expect(html).not.toMatch(/<a[^>]*href="\/stores"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="\/stores"/)
  })
})

describe('the partner console header', () => {
  it('says who you are signed in for, labels the console Partners and keeps search disabled with a note', async () => {
    const html = await render(<AppHeader me={me} menuOpen={false} onOpenMenu={() => undefined} />)
    expect(html).toContain('title="Signed in for Northstar Commerce"')
    expect(html).toContain('>NC</span>')
    expect(html).toContain(`<span class="df-product-label">${messages.shell.productLabel}</span>`)
    expect(html).toMatch(/<button[^>]*class="df-search-button"[^>]*disabled=""/)
    expect(html).toContain(messages.shell.search.notYet)
    expect(html).toContain('Account: Maya Ortiz, Owner')
  })
})

describe('the partner-state strip', () => {
  it('shows nothing while Live and the right words otherwise', async () => {
    expect(await render(<PartnerStrip state="live" />)).toBe('')
    for (const state of ['draft', 'awaiting', 'sentback'] as const) {
      const html = await render(<PartnerStrip state={state} />)
      expect(html).toContain(`df-partner-strip--${state}`)
      expect(html).toContain(messages.shell.partnerState[state].link)
    }
  })
})
