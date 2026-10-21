// @vitest-environment happy-dom
import { exportJob } from '@dripfunnel/shared/ui'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityEntry, ActivityPage } from '../../api/activity'
import type { Acting, Me, StoreChoice } from '../../api/shell'
import { messages } from '../../messages'
import type { Seat } from '../../nav'
import { AppHeader } from '../shell/AppHeader'
import { settingsSearch } from '../settings/settingsSearch'
import { ActivityPage as Page } from './ActivityPage'
import { activitySearch } from './activitySearch'
import { actorOf, doneOf, nameOf } from './activityText'

// The store's activity log as the Owner (Settings, with export) and a Manager (Store activity, export disabled with the
// reason) read it: filter by person, what and words, open an entry, page older, export; nobody else reads anything.

const w = messages.activity

const api = vi.hoisted(() => ({ loadActivity: vi.fn(), requestActivityExport: vi.fn(), loadActivityExport: vi.fn() }))
vi.mock('../../api/activity', async (actual) => ({ ...(await actual<typeof import('../../api/activity')>()), ...api }))

const { SettingsPage } = await import('../settings/SettingsPage')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['settings', 'activity.read', 'activity.export', 'catalog.read'] }
const manager: Acting = { ...owner, role: 'manager', permissions: ['activity.read', 'catalog.read'] }
const staff: Acting = { ...owner, role: 'staff', permissions: ['catalog.read', 'orders.read'] }
const supplier: Acting = { ...owner, role: 'vendor', tier: 'vendor-catalogue', seller: { id: 'v1', name: 'Northwind' }, permissions: ['catalog.read'] }

const entry = (e: Pick<ActivityEntry, 'id' | 'action'> & Partial<ActivityEntry>): ActivityEntry => ({
  at: '2026-10-10T10:00:00Z',
  category: 'store',
  result: 'success',
  actor: { kind: 'person', id: 'p-farhan', label: 'Farhan Ali <farhan@example.com>' },
  onBehalfOf: null,
  through: null,
  target: null,
  changes: [],
  reason: null,
  ...e,
})
const entries: ActivityEntry[] = [
  entry({ id: 'e1', action: 'product.updated', actor: { kind: 'support_session', id: 'ss1', label: 'Farhan Ali' }, onBehalfOf: { kind: 'partner_user', id: 'pu1', label: 'Ravi Kumar <ravi@x.example>' }, through: { kind: 'support_session', id: 'ss1' }, target: { type: 'product', id: 'prod-1', label: 'Organic Tee' }, changes: [{ field: 'Main photo', before: 'a.jpg', after: 'b.jpg' }], reason: 'Ticket #4821' }),
  entry({ id: 'e2', action: 'order.refunded', actor: { kind: 'person', id: 'p-priya', label: 'Priya Shah <priya@example.com>' }, target: { type: 'order', id: 'ord-1', label: 'KT-1031' } }),
  entry({ id: 'e3', action: 'person.sign_in_refused', result: 'denied', actor: { kind: 'person', id: 'p-tom', label: 'Tom Okafor' } }),
]

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

const routerFor = (acting: Acting, path: string, readOnly = false) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const activity = createRoute({ getParentRoute: () => app, path: '/activity', validateSearch: activitySearch, component: Page })
  const settings = createRoute({ getParentRoute: () => app, path: '/settings', validateSearch: settingsSearch, component: SettingsPage })
  return createRouter({ routeTree: root.addChildren([app.addChildren([activity, settings])]), history: createMemoryHistory({ initialEntries: [path] }) })
}

const show = async (acting: Acting, path = '/activity', readOnly = false) => {
  const router = routerFor(acting, path, readOnly)
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  await settle()
  return router
}

const page = (list: ActivityEntry[], next: string | null = null): ActivityPage => ({ entries: list, next })

beforeEach(() => {
  api.loadActivity.mockResolvedValue(page(entries))
  api.requestActivityExport.mockResolvedValue({ id: 'x1', state: 'preparing', entries: null, url: null, expiresAt: null })
  api.loadActivityExport.mockResolvedValue(null)
})

afterEach(() => {
  cleanup()
  // The running export is the shell's, kept outside any screen.
  exportJob.set(null)
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe('the words of an entry', () => {
  it('names the person without their email, the agent behind a support session, and a code it doesn’t word', () => {
    expect(nameOf('Priya Shah <priya@example.com>')).toBe('Priya Shah')
    expect(nameOf(null)).toBe(w.system)
    expect(nameOf('ananya@example.com')).toBe(w.unnamed)
    expect(nameOf('ananya@example.com <ananya@example.com>')).toBe(w.unnamed)
    expect(actorOf(entries[0] as ActivityEntry)).toBe('Ravi Kumar')
    expect(doneOf(entries[1] as ActivityEntry)).toBe('refunded order KT-1031')
    expect(doneOf(entry({ id: 'x', action: 'store.something_new' }))).toBe('store.something_new')
  })
})

describe('Store activity, for a Manager', () => {
  it('reads the whole log and shows the export disabled with the reason', async () => {
    await show(manager)
    expect(screen.getByRole('heading', { level: 1, name: w.managerTitle })).toBeTruthy()
    expect(screen.getByText('Ravi Kumar')).toBeTruthy()
    expect(screen.getByText(w.results.denied)).toBeTruthy()
    expect((screen.getByRole('button', { name: w.export }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(w.exportOwner)).toBeTruthy()
  })

  it('opens an entry with its changes, reason and how it was done, and filters by its person', async () => {
    const router = await show(manager)
    fireEvent.click(screen.getByRole('button', { name: /Ravi Kumar changed Organic Tee/ }))
    expect(screen.getByText('Main photo: a.jpg → b.jpg')).toBeTruthy()
    expect(screen.getByText('Reason: Ticket #4821')).toBeTruthy()
    expect((screen.getByRole('link', { name: 'Open Organic Tee' }) as HTMLAnchorElement).getAttribute('href')).toBe('/products/prod-1')
    fireEvent.click(screen.getByRole('button', { name: w.bySession }))
    await settle()
    expect(router.state.location.search).toMatchObject({ who: 'support_session:ss1' })
    expect(router.state.location.search).not.toHaveProperty('whoName')
    expect(api.loadActivity).toHaveBeenLastCalledWith({ person: { kind: 'support_session', id: 'ss1' }, what: null, search: '' }, null)
    // The filter is the session, so the line says so rather than naming the agent alone.
    expect(screen.getByText('Showing everything by Ravi Kumar’s support session in this store.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: w.clearPerson }))
    await settle()
    expect(router.state.location.search).not.toHaveProperty('who')
  })

  it('keeps typing that goes on while the last search reaches the address', async () => {
    const router = await show(manager)
    const field = screen.getByLabelText(w.search) as HTMLInputElement
    fireEvent.change(field, { target: { value: 'KT' } })
    await act(async () => new Promise((resolve) => setTimeout(resolve, 320)))
    // The search for "KT" is on its way; more is typed before it lands.
    fireEvent.change(field, { target: { value: 'KT-10' } })
    await settle()
    expect(router.state.location.search).toMatchObject({ q: 'KT' })
    expect(field.value).toBe('KT-10')
    await act(async () => new Promise((resolve) => setTimeout(resolve, 350)))
    await settle()
    expect(router.state.location.search).toMatchObject({ q: 'KT-10' })
    expect(field.value).toBe('KT-10')
  })

  it('names a person by their whole name, as the Person list does', async () => {
    await show(manager)
    fireEvent.click(screen.getByRole('button', { name: /Priya Shah refunded/ }))
    expect(screen.getByRole('button', { name: 'Everything by Priya Shah' })).toBeTruthy()
  })

  it('keeps the filter in the address and searches once typing settles', async () => {
    const router = await show(manager, '/activity?what=orders')
    expect(api.loadActivity).toHaveBeenCalledWith({ person: null, what: 'orders', search: '' }, null)
    fireEvent.change(screen.getByLabelText(w.search), { target: { value: 'KT-10' } })
    expect(api.loadActivity).toHaveBeenCalledTimes(1)
    await act(async () => new Promise((resolve) => setTimeout(resolve, 350)))
    await settle()
    expect(router.state.location.search).toMatchObject({ what: 'orders', q: 'KT-10' })
    expect(api.loadActivity).toHaveBeenLastCalledWith({ person: null, what: 'orders', search: 'KT-10' }, null)
  })

  it('never shows an earlier filter’s late answer over the newer one', async () => {
    let late: (p: ActivityPage) => void = () => undefined
    api.loadActivity.mockReturnValueOnce(new Promise((resolve) => (late = resolve))).mockResolvedValue(page([entries[2] as ActivityEntry]))
    await show(manager)
    fireEvent.change(screen.getByLabelText(w.what), { target: { value: 'signins' } })
    await settle()
    await act(async () => late(page(entries)))
    await settle()
    expect(screen.getByText('Tom Okafor')).toBeTruthy()
    expect(screen.queryByText('Ravi Kumar')).toBeNull()
  })

  it('pages older entries, and says when they didn’t load', async () => {
    api.loadActivity.mockResolvedValueOnce(page([entries[0] as ActivityEntry], 'c1')).mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(page([entries[1] as ActivityEntry]))
    await show(manager)
    fireEvent.click(screen.getByRole('button', { name: w.more }))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(w.moreFailed)
    fireEvent.click(screen.getByRole('button', { name: w.more }))
    await settle()
    expect(api.loadActivity).toHaveBeenLastCalledWith({ person: null, what: null, search: '' }, 'c1')
    expect(screen.getByText('Priya Shah')).toBeTruthy()
    expect(screen.queryByRole('button', { name: w.more })).toBeNull()
  })

  it('says when nothing matches a filter, and when the store has no activity', async () => {
    api.loadActivity.mockResolvedValue(page([]))
    await show(manager, '/activity?q=zzz')
    expect(screen.getByText(w.none)).toBeTruthy()
    cleanup()
    await show(manager)
    expect(screen.getByText(w.empty)).toBeTruthy()
  })

  it('says when the log didn’t load', async () => {
    api.loadActivity.mockRejectedValue(new Error('down'))
    await show(manager)
    expect(screen.getByText(w.error.title)).toBeTruthy()
  })
})

describe('the Owner', () => {
  it('keeps the pages it loaded when Settings draws again for something else', async () => {
    api.loadActivity.mockResolvedValueOnce(page([entries[0] as ActivityEntry], 'c1')).mockResolvedValueOnce(page([entries[1] as ActivityEntry]))
    const router = await show(owner, '/settings?tab=activity')
    fireEvent.click(screen.getByRole('button', { name: w.more }))
    await settle()
    // An address change that isn't the filter draws the tab again; the log isn't read again.
    await act(async () => router.navigate({ to: '/settings', search: { tab: 'activity', note: 'x' } as never }))
    await settle()
    expect(api.loadActivity).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Priya Shah')).toBeTruthy()
  })

  it('names a picked person from the entries, never from the address', async () => {
    api.loadActivity.mockResolvedValue(page([]))
    await show(owner, '/settings?tab=activity&who=person:p-x&whoName=Anyone%20At%20All')
    expect(screen.queryByText(/Anyone At All/)).toBeNull()
    expect(screen.getByText(`Showing everything by ${w.thisPerson} in this store.`)).toBeTruthy()
  })

  it('reads the log as a Settings tab and exports it as filtered', async () => {
    await show(owner, '/settings?tab=activity&what=team')
    expect(screen.getByRole('heading', { level: 2, name: w.title })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: w.export }))
    await settle()
    expect(api.requestActivityExport).toHaveBeenCalledWith({ person: null, what: 'team', search: '' })
    expect(screen.getByText(w.exportWords.preparing)).toBeTruthy()
    expect(screen.queryByText(w.exportOwner)).toBeNull()
  })

  it('still reads and exports in a read-only store, saying so', async () => {
    await show(owner, '/activity', true)
    expect(screen.getByText(w.readOnly)).toBeTruthy()
    expect((screen.getByRole('button', { name: w.export }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('who reads nothing', () => {
  it.each<[string, Acting]>([
    ['Staff', staff],
    ['a supplier', supplier],
  ])('%s, without activity.read, is told so and nothing is read', async (_, acting) => {
    await show(acting)
    expect(screen.getByText(w.denied.title)).toBeTruthy()
    expect(api.loadActivity).not.toHaveBeenCalled()
  })

  it('a Manager has no Settings tab of it', async () => {
    await show(manager, '/settings?tab=activity')
    expect(screen.getByText(messages.settings.denied.title)).toBeTruthy()
    expect(api.loadActivity).not.toHaveBeenCalled()
  })
})

describe('the user menu', () => {
  const me: Me = { id: 'm1', name: 'Meera Iyer', email: 'meera@example.com', acting: manager }
  const current: StoreChoice = { membershipId: 'm1', store: owner.store, role: 'manager', tier: null, seller: null }
  const header = async (seat: Seat) => {
    const root = createRootRoute({ component: () => <AppHeader me={me} seat={seat} current={current} stores={[current]} brand={null} menuOpen={false} onOpenMenu={() => undefined} /> })
    const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/'] }) })
    await act(async () => {
      render(<RouterProvider router={router} />)
    })
    fireEvent.click(screen.getByRole('button', { name: /Account:/ }))
    return within(document.body)
  }

  it('offers a Manager Store activity', async () => {
    const menu = await header({ side: 'merchant', role: 'manager' })
    expect(menu.getByText(messages.shell.userMenu.activity)).toBeTruthy()
  })

  it('doesn’t offer it to the Owner, who has it in Settings, or to Staff', async () => {
    const menu = await header({ side: 'merchant', role: 'owner' })
    expect(menu.queryByText(messages.shell.userMenu.activity)).toBeNull()
    cleanup()
    const staffMenu = await header({ side: 'merchant', role: 'staff' })
    expect(staffMenu.queryByText(messages.shell.userMenu.activity)).toBeNull()
  })
})
