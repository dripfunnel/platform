import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { NavBadges } from '../../api/navBadges'
import { messages } from '../../messages'
import { navFor } from '../../nav'
import { SideNav } from './SideNav'
import { staffRoles, type StaffRole } from './staffRoles'

const render = async (role: StaffRole, badges: NavBadges = { partnersAwaitingApproval: 3, provisioningAttention: 2, openSessions: 1 }, path = '/partners') => {
  const rootRoute = createRootRoute({
    component: () => <SideNav rows={navFor(role)} badges={badges} variant="bar" />,
  })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: [path] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

const absentPaths = (role: StaffRole) => [
  ...(role === 'staff-super-admin' || role === 'staff-support' ? [] : ['/impersonate']),
  ...(role === 'staff-super-admin' ? [] : ['/staff']),
]

describe('SideNav', () => {
  it.each(staffRoles)('renders the menus every role has for %s', async (role) => {
    const html = await render(role)
    for (const path of ['/dashboard', '/partners', '/stores', '/customers', '/activity']) expect(html).toContain(`href="${path}"`)
  })

  it.each(staffRoles)('leaves the other menus out of the markup for %s, rather than disabling them', async (role) => {
    const html = await render(role)
    for (const path of absentPaths(role)) expect(html).not.toContain(`href="${path}"`)
    expect(html).not.toContain('disabled')
    expect(html).not.toContain('aria-disabled')
  })

  it('shows Approvals to the approvers and Provisioning to the roles that work signups', async () => {
    expect(await render('staff-partner-manager')).toContain('href="/approvals"')
    expect(await render('staff-partner-manager')).not.toContain('href="/provisioning"')
    expect(await render('staff-engineer')).toContain('href="/provisioning"')
    expect(await render('staff-engineer')).not.toContain('href="/approvals"')
    const readOnly = await render('staff-read-only')
    expect(readOnly).not.toContain('href="/approvals"')
    expect(readOnly).not.toContain('href="/provisioning"')
  })

  it.each(staffRoles)('shows Staff to Super admin only, for %s', async (role) => {
    expect((await render(role)).includes('href="/staff"')).toBe(role === 'staff-super-admin')
  })

  it('shows the awaiting-approval count once, on the nearest menu the role can reach', async () => {
    const between = (html: string, from: string, to: string) => html.slice(html.indexOf(`href="${from}"`), html.indexOf(`href="${to}"`))
    const approver = await render('staff-super-admin')
    expect(approver.match(/3 awaiting approval/g)).toHaveLength(1)
    expect(between(approver, '/approvals', '/provisioning')).toContain('3 awaiting approval')
    const finance = await render('staff-finance')
    expect(finance.match(/3 awaiting approval/g)).toHaveLength(1)
    expect(between(finance, '/partners', '/stores')).toContain('3 awaiting approval')
  })

  it('counts failed and stuck signups on Provisioning', async () => {
    expect(await render('staff-support')).toContain('2 failed or stuck')
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
    const html = await render('staff-super-admin', { partnersAwaitingApproval: 0, provisioningAttention: 0, openSessions: 0 })
    expect(html).not.toContain('df-nav-badge')
    for (const badge of Object.values(messages.shell.badges)) expect(html).not.toContain(badge.replace('{count} ', ''))
  })
})
