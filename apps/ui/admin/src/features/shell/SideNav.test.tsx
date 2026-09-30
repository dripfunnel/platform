import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { NavBadges } from '../../api/navBadges'
import { messages } from '../../messages'
import { navFor } from '../../nav'
import { SideNav } from './SideNav'
import { staffRoles, type StaffRole } from './staffRoles'

const render = async (role: StaffRole, badges: NavBadges = { partnersAwaitingApproval: 3 }, path = '/partners') => {
  const rootRoute = createRootRoute({
    component: () => <SideNav rows={navFor(role)} badges={badges} variant="bar" />,
  })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: [path] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

const absentPaths = ['/approvals', '/provisioning', '/impersonate', '/activity', '/staff']

describe('SideNav', () => {
  it.each(staffRoles)('renders the first-release rows built so far for %s', async (role) => {
    const html = await render(role)
    for (const path of ['/dashboard', '/partners', '/stores', '/customers']) expect(html).toContain(`href="${path}"`)
  })

  it.each(staffRoles)('leaves the other menus out of the markup for %s, rather than disabling them', async (role) => {
    const html = await render(role)
    for (const path of absentPaths) expect(html).not.toContain(`href="${path}"`)
    expect(html).not.toContain('disabled')
    expect(html).not.toContain('aria-disabled')
  })

  it('marks the current location with aria-current', async () => {
    const html = await render('staff-support', undefined, '/stores')
    expect(html).toMatch(/<a[^>]*href="\/stores"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="\/stores"/)
    expect(html).not.toMatch(/<a[^>]*href="\/partners"[^>]*aria-current="page"/)
  })

  it('gives every badge a spoken label and hides the bare number from screen readers', async () => {
    const html = await render('staff-finance')
    expect(html).toContain('<span aria-hidden="true">3</span>')
    expect(html).toContain(`<span class="df-visually-hidden">3 awaiting approval</span>`)
  })

  it('shows no badge when nothing is waiting', async () => {
    const html = await render('staff-super-admin', { partnersAwaitingApproval: 0 })
    expect(html).not.toContain('df-nav-badge')
    expect(html).not.toContain(messages.shell.badges.partnersAwaitingApproval.replace('{count} ', ''))
  })
})
