// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstallableApp, InstalledApp } from '../../api/apps'
import type { Acting } from '../../api/shell'
import type { SupportAccess, SupportSession } from '../../api/support'
import { messages } from '../../messages'
import { appIdOf } from './AppsTab'
import { settingsSearch } from './settingsSearch'
import { changesLine, whenLine } from './SupportAccessTab'

// Settings › Apps and Support access driven as the Owner would (SetDev "apps", SetAccess "support"): install after
// consent, open on the app's own site, remove saying what stops; the support switch, and the support access log.

const a = messages.settings.apps
const s = messages.settings.support

const apps = vi.hoisted(() => ({ loadApps: vi.fn(), loadInstallableApp: vi.fn(), installApp: vi.fn(), uninstallApp: vi.fn() }))
vi.mock('../../api/apps', () => apps)
const support = vi.hoisted(() => ({ loadSupportAccess: vi.fn(), setSupportAccess: vi.fn() }))
vi.mock('../../api/support', () => support)

const { SettingsPage } = await import('./SettingsPage')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['settings'] }
const manager: Acting = { ...owner, role: 'manager', permissions: ['orders.read', 'activity.read', 'support.allow_write'] }

const appId = '3f2a9c10-1111-4222-8333-944445555666'
const installed = (over: Partial<InstalledApp> & Pick<InstalledApp, 'id' | 'name'>): InstalledApp => ({
  appId: 'x',
  developer: 'Tally Bridges',
  siteUrl: 'https://ledgersync.app',
  scopes: ['orders.read'],
  suspended: false,
  installedByName: 'Farhan Ali',
  installedAt: '2026-09-12T10:00:00Z',
  lastUsedAt: null,
  connection: 'sent',
  ...over,
})
const ledger: InstallableApp = { id: appId, name: 'Ledger Sync', developer: 'Tally Bridges', siteUrl: 'https://ledgersync.app', scopes: ['orders.read', 'catalog.read'] }

const session = (over: Partial<SupportSession> & Pick<SupportSession, 'id'>): SupportSession => ({
  agentName: 'Ravi Kumar',
  partnerName: 'Juniper',
  actingAs: { name: 'Farhan Ali', role: 'owner', supplier: null },
  reason: 'photos look blurry',
  ticket: null,
  startedAt: '2026-10-02T16:00:00Z',
  expiresAt: '2026-10-02T16:30:00Z',
  endedAt: '2026-10-02T16:12:00Z',
  endedBy: 'agent',
  access: 'read',
  allowedBy: null,
  writeRequest: null,
  ...over,
})
const page = (nodes: SupportSession[], allowed = true, endCursor: string | null = null): SupportAccess => ({ allowed, sessions: { nodes, pageInfo: { hasNextPage: endCursor !== null, endCursor } } })

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const dialog = () => within(document.querySelector('dialog[open]') as HTMLElement)

const show = async (tab: string, { acting = owner, readOnly = false } = {}) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const settings = createRoute({ getParentRoute: () => app, path: '/settings', validateSearch: settingsSearch, component: SettingsPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([settings])]), history: createMemoryHistory({ initialEntries: [`/settings?tab=${tab}`] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  await settle()
}

beforeEach(() => {
  apps.loadApps.mockResolvedValue([installed({ id: 'g1', name: 'Ledger Sync' })])
  apps.loadInstallableApp.mockResolvedValue(ledger)
  apps.installApp.mockResolvedValue(undefined)
  apps.uninstallApp.mockResolvedValue(undefined)
  support.loadSupportAccess.mockResolvedValue(page([session({ id: 'ss1' })]))
  support.setSupportAccess.mockResolvedValue(0)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('apps', () => {
  it('takes the app’s id from an https install link, wherever the link carries it', () => {
    expect(appIdOf(`https://ledgersync.app/install/${appId}`)).toBe(appId)
    expect(appIdOf(`https://ledgersync.app/install?app=${appId.toUpperCase()}`)).toBe(appId)
    expect(appIdOf(`http://ledgersync.app/install/${appId}`)).toBeNull()
    expect(appIdOf('https://ledgersync.app/install')).toBeNull()
  })

  it('lists each app with its access, and opens it only on an https site of its own', async () => {
    apps.loadApps.mockResolvedValue([installed({ id: 'g1', name: 'Ledger Sync' }), installed({ id: 'g2', name: 'Odd App', siteUrl: 'javascript:alert(1)', connection: 'failed' })])
    await show('apps')
    const link = screen.getByRole('link', { name: 'Open Ledger Sync on its own site' }) as HTMLAnchorElement
    expect(link.href).toBe('https://ledgersync.app/')
    expect(link.rel).toContain('noopener')
    expect(screen.queryByRole('link', { name: 'Open Odd App on its own site' })).toBeNull()
    expect(screen.getByText(a.failed)).toBeTruthy()
  })

  it('installs after saying what it can and can’t do, with the scopes it showed', async () => {
    await show('apps')
    fireEvent.click(screen.getByRole('button', { name: a.add }))
    fireEvent.change(dialog().getByLabelText(a.link), { target: { value: 'https://ledgersync.app/install' } })
    fireEvent.click(dialog().getByRole('button', { name: a.next }))
    await settle()
    expect(dialog().getByText(a.noApp)).toBeTruthy()
    fireEvent.change(dialog().getByLabelText(a.link), { target: { value: `https://ledgersync.app/install/${appId}` } })
    fireEvent.click(dialog().getByRole('button', { name: a.next }))
    await settle()
    expect(apps.loadInstallableApp).toHaveBeenCalledWith(appId)
    const consent = within(screen.getByRole('region', { name: 'Install Ledger Sync?' }))
    expect(consent.getByText(a.scopes['orders.read'])).toBeTruthy()
    // What it wasn't given is said among what it won't do.
    expect(consent.getByText(a.scopes['customers.read'])).toBeTruthy()
    expect(consent.getByText(a.never[0] ?? '')).toBeTruthy()
    fireEvent.click(consent.getByRole('button', { name: a.install }))
    await settle()
    expect(apps.installApp).toHaveBeenCalledWith(appId, ['orders.read', 'catalog.read'])
    expect(screen.getByText('Ledger Sync installed. Open it to finish setting it up.')).toBeTruthy()
    expect(apps.loadApps).toHaveBeenCalledTimes(2)
  })

  it('says an app no link names isn’t available, in the dialog', async () => {
    apps.loadInstallableApp.mockResolvedValue(null)
    await show('apps')
    fireEvent.click(screen.getByRole('button', { name: a.add }))
    fireEvent.change(dialog().getByLabelText(a.link), { target: { value: `https://x.app/i/${appId}` } })
    fireEvent.click(dialog().getByRole('button', { name: a.next }))
    await settle()
    expect(dialog().getByText(a.refused.NOT_FOUND)).toBeTruthy()
  })

  it('shows what the app asks now when it changed its access since the screen was read', async () => {
    apps.installApp.mockRejectedValueOnce(new ApiError('SCOPES_CHANGED', 'changed'))
    apps.loadInstallableApp.mockResolvedValueOnce(ledger).mockResolvedValueOnce({ ...ledger, scopes: ['orders.read', 'customers.read'] })
    await show('apps')
    fireEvent.click(screen.getByRole('button', { name: a.add }))
    fireEvent.change(dialog().getByLabelText(a.link), { target: { value: `https://ledgersync.app/install/${appId}` } })
    fireEvent.click(dialog().getByRole('button', { name: a.next }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: a.install }))
    await settle()
    const consent = within(screen.getByRole('region', { name: 'Install Ledger Sync?' }))
    expect(consent.getByRole('alert').textContent).toBe(a.refused.SCOPES_CHANGED)
    expect(consent.getAllByText(a.scopes['customers.read'])).toHaveLength(1)
    fireEvent.click(consent.getByRole('button', { name: a.install }))
    await settle()
    expect(apps.installApp).toHaveBeenLastCalledWith(appId, ['orders.read', 'customers.read'])
  })

  it('removes an app after saying its access ends and what it copied stays with it', async () => {
    await show('apps')
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ledger Sync' }))
    expect(dialog().getByText(a.removeBody)).toBeTruthy()
    fireEvent.click(dialog().getByRole('button', { name: a.removeGo }))
    await settle()
    expect(apps.uninstallApp).toHaveBeenCalledWith('g1')
    expect(screen.getByText('Ledger Sync removed')).toBeTruthy()
  })

  it('lets a read-only store open its apps but not add or remove one', async () => {
    await show('apps', { readOnly: true })
    expect((screen.getByRole('button', { name: a.add }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Remove Ledger Sync' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('link', { name: 'Open Ledger Sync on its own site' })).toBeTruthy()
  })

  it('says when there are no apps', async () => {
    apps.loadApps.mockResolvedValue([])
    await show('apps')
    expect(screen.getByText(a.empty)).toBeTruthy()
  })
})

describe('support access', () => {
  it('turns support off only after saying open sessions end, and says how many did', async () => {
    support.setSupportAccess.mockResolvedValue(1)
    support.loadSupportAccess.mockResolvedValueOnce(page([session({ id: 'ss1' })])).mockResolvedValue(page([session({ id: 'ss1' })], false))
    await show('support')
    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    expect(dialog().getByText(/Any support session open now ends straight away/)).toBeTruthy()
    fireEvent.click(dialog().getByRole('button', { name: s.offGo }))
    await settle()
    expect(support.setSupportAccess).toHaveBeenCalledWith(false)
    expect(screen.getByText('Support access is off. 1 open session ended.')).toBeTruthy()
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  })

  it('turns support on without asking', async () => {
    support.loadSupportAccess.mockResolvedValue(page([], false))
    await show('support')
    fireEvent.click(screen.getByRole('switch'))
    await settle()
    expect(support.setSupportAccess).toHaveBeenCalledWith(true)
    expect(screen.getByText(s.turnedOn)).toBeTruthy()
  })

  it('lets a read-only store still switch it, as the API does for a privacy control', async () => {
    await show('support', { readOnly: true })
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(false)
  })

  it('says a refused switch on the tab', async () => {
    support.setSupportAccess.mockRejectedValueOnce(new ApiError('BLOCKED_FOR_SUPPORT', 'no'))
    support.loadSupportAccess.mockResolvedValue(page([], false))
    await show('support')
    fireEvent.click(screen.getByRole('switch'))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(s.refused.BLOCKED_FOR_SUPPORT)
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  })

  it('lists who opened a session, why, when and whether they could change things, and loads older ones', async () => {
    support.loadSupportAccess
      .mockResolvedValueOnce(page([session({ id: 'ss1', ticket: '4821', access: 'write', allowedBy: 'Farhan Ali' })], true, 'c1'))
      .mockResolvedValueOnce(page([session({ id: 'ss2', agentName: 'Anita Shah', writeRequest: { state: 'denied' } })]))
    await show('support')
    expect(screen.getByText('Ticket 4821: photos look blurry')).toBeTruthy()
    expect(screen.getByText('Allowed by Farhan Ali')).toBeTruthy()
    expect(screen.getByText('Juniper support · as Farhan Ali')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: s.more }))
    await settle()
    expect(support.loadSupportAccess).toHaveBeenLastCalledWith('c1')
    expect(screen.getByText('Anita Shah')).toBeTruthy()
    expect(screen.getByText(s.denied)).toBeTruthy()
    expect(screen.queryByRole('button', { name: s.more })).toBeNull()
  })

  it('words how a session went', () => {
    const now = Date.parse('2026-10-11T12:00:00Z')
    expect(whenLine(session({ id: 'a' }), now)).toBe('12 min')
    expect(whenLine(session({ id: 'b', endedAt: '2026-10-02T16:30:00Z', endedBy: 'expired' }), now)).toBe('30 min · timed out')
    expect(whenLine(session({ id: 'c', endedAt: null, endedBy: null }), now)).toBe('30 min · timed out')
    expect(whenLine(session({ id: 'd', endedAt: null, endedBy: null, expiresAt: '2026-10-11T12:20:00Z' }), now)).toMatch(/^Open now · ends /)
    expect(changesLine(session({ id: 'e' }), now)).toEqual({ text: s.readOnly, wrote: false })
    expect(changesLine(session({ id: 'f', access: 'write', allowedBy: null }), now)).toEqual({ text: s.allowedNoName, wrote: true })
    const asking = { writeRequest: { state: 'pending' as const }, endedAt: null, endedBy: null }
    expect(changesLine(session({ id: 'g', ...asking, expiresAt: '2026-10-11T12:20:00Z' }), now)).toEqual({ text: s.asking, wrote: false })
    // Past its end, nothing is still asking.
    expect(changesLine(session({ id: 'h', ...asking }), now)).toEqual({ text: s.readOnly, wrote: false })
    expect(changesLine(session({ id: 'i', writeRequest: { state: 'pending' } }), now)).toEqual({ text: s.readOnly, wrote: false })
  })

  it('never leaves Show older stuck: the switch waits for an older page, and Show older for a log read again', async () => {
    let olderPage: (p: SupportAccess) => void = () => undefined
    let fresh: (p: SupportAccess) => void = () => undefined
    support.loadSupportAccess
      .mockResolvedValueOnce(page([session({ id: 'ss1' })], true, 'c1'))
      .mockReturnValueOnce(new Promise((resolve) => (olderPage = resolve)))
      .mockReturnValueOnce(new Promise((_, reject) => (fresh = () => reject(new Error('down')))))
    await show('support')
    fireEvent.click(screen.getByRole('button', { name: s.more }))
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true)
    await act(async () => olderPage(page([session({ id: 'ss2', agentName: 'Anita Shah' })], true, 'c2')))
    await settle()
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(dialog().getByRole('button', { name: s.offGo }))
    await settle()
    expect((screen.getByRole('button', { name: s.more }) as HTMLButtonElement).disabled).toBe(true)
    // The log read again fails: the switch's answer stands and Show older works again.
    await act(async () => fresh(page([])))
    await settle()
    expect((screen.getByRole('button', { name: s.more }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText('Anita Shah')).toBeTruthy()
  })

  it('says when no session has been opened', async () => {
    support.loadSupportAccess.mockResolvedValue(page([]))
    await show('support')
    expect(screen.getByText(/No support sessions yet/)).toBeTruthy()
  })
})

describe('who reads these tabs', () => {
  it.each([
    ['apps', () => apps.loadApps],
    ['support', () => support.loadSupportAccess],
  ] as const)('reads nothing on %s for a Manager, who has no Settings', async (tab, read) => {
    await show(tab, { acting: manager })
    expect(screen.getByText(messages.settings.denied.title)).toBeTruthy()
    expect(read()).not.toHaveBeenCalled()
  })

  it('says when the support log didn’t load', async () => {
    support.loadSupportAccess.mockRejectedValue(new Error('down'))
    await show('support')
    expect(screen.getByText(messages.settings.error.title)).toBeTruthy()
  })
})
