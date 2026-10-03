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
import type { PartnerFacts } from '../../api/partnerState'
import { PartnerBanners } from './PartnerBanners'

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
  it('says who you are signed in for, labels the console Partners and offers the stores search with its shortcut', async () => {
    const html = await render(<AppHeader me={me} menuOpen={false} onOpenMenu={() => undefined} />)
    expect(html).toContain('title="Signed in for Northstar Commerce"')
    expect(html).toContain('>NC</span>')
    expect(html).toContain(`<span class="df-product-label">${messages.shell.productLabel}</span>`)
    expect(html).toMatch(/<button[^>]*class="df-search-button"(?![^>]*disabled)/)
    expect(html).toContain(messages.shell.search.button)
    expect(html).toContain(`<kbd>${messages.shell.search.shortcut}</kbd>`)
    expect(html).toContain('Account: Maya Ortiz, Owner')
  })
})

describe('the menu’s badges', () => {
  it('speaks each count in the right number', async () => {
    const html = await nav('partner-owner', { ...quiet, storesAttention: 1, brandingSetupLeft: 2, billingFailedPayments: 1 })
    expect(html).toContain('1 needs attention')
    expect(html).toContain('2 setup items left')
    expect(html).toContain('1 failed payment')
    expect(html).not.toContain('failed payments')
  })
})

describe('the shell’s banners', () => {
  const live: PartnerFacts = { state: 'live', sentBackReason: null, pausedAt: null, pauseReason: null, storeCount: 86, brokenHosts: [], setupSession: null }
  const banners = (facts: Partial<PartnerFacts>) => render(<PartnerBanners me={me} facts={{ ...live, ...facts }} />)
  const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, '’').replace(/&amp;/g, '&')

  it('shows nothing for a Live partner with nothing wrong', async () => {
    expect(await banners({})).toBe('')
  })

  it.each([
    ['draft', 'info'],
    ['awaiting', 'warning'],
    ['sentback', 'danger'],
  ] as const)('words the %s strip from messages, never from the server', async (state, tone) => {
    const html = await banners({ state })
    expect(html).toContain(`df-partner-strip--${tone}`)
    expect(textOf(html)).toContain(messages.shell.partnerState[state].text)
    expect(html).toContain('href="/dashboard"')
  })

  it('says a paused partner’s stores keep running, with DripFunnel’s reason', async () => {
    const text = textOf(await banners({ state: 'paused', pauseReason: 'KYC documents need renewing.' }))
    expect(text).toContain('DripFunnel paused Northstar Shops.')
    expect(text).toContain('New merchants can’t sign up at store.northstar.com')
    expect(text).toContain('Your 86 stores keep running.')
    expect(text).toContain('Reason: KYC documents need renewing.')
    expect(textOf(await banners({ state: 'paused', storeCount: 1 }))).toContain('Your 1 store keeps running.')
  })

  it('names an offboarding partner, the hosts that stopped pointing at DripFunnel, and a staff setup session', async () => {
    expect(textOf(await banners({ state: 'offboarding' }))).toContain('Northstar Commerce is offboarding.')
    const broken = await banners({ brokenHosts: ['store.northstar.com', 'mail.northstar.com'] })
    expect(textOf(broken)).toContain('store.northstar.com and mail.northstar.com stopped pointing at DripFunnel.')
    expect(broken).toContain('href="/domains"')
    expect(textOf(await banners({ setupSession: { staffName: 'Priya', endsAt: '2026-10-04T16:30:00.000Z' } }))).toContain('DripFunnel is setting up your console: Priya, until')
  })
})
