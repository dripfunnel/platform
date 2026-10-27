// @vitest-environment happy-dom
import { optionalParam } from '@dripfunnel/shared/search'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Acting } from '../../api/shell'
import type { Rider } from '../../api/riders'
import { messages } from '../../messages'

// Settings › Riders, the read-only list as the Owner would see it (SetRiders, #844).

const w = messages.settings.riders

const api = vi.hoisted(() => ({
  loadRiders: vi.fn(),
  loadRiderPlan: vi.fn(),
}))
vi.mock('../../api/riders', async (actual) => ({ ...(await actual<typeof import('../../api/riders')>()), ...api }))
vi.mock('../../api/settings', () => ({ loadStoreInfo: vi.fn(), loadLocale: vi.fn() }))

const { SettingsPage } = await import('./SettingsPage')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['catalog.read', 'settings'] }
const manager: Acting = { ...owner, role: 'manager' }

const rider = (r: Partial<Rider> & Pick<Rider, 'id' | 'name'>): Rider => ({ phone: '+919829011111', status: 'active', online: false, currentDeliveryId: null, deliveriesDone: 0, ...r })
const riders = [
  rider({ id: 'r1', name: 'Ravi Kumar', online: true, currentDeliveryId: 'd1', deliveriesDone: 42 }),
  rider({ id: 'r2', name: 'Deepak Meena', status: 'suspended', phone: '+919829033333' }),
  rider({ id: 'r3', name: 'Sunil Yadav', status: 'invited', phone: '+919829044444' }),
]
const page = (nodes: Rider[], hasNextPage = false) => ({ nodes, pageInfo: { hasNextPage, endCursor: hasNextPage ? 'c1' : null } })

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

const show = async (tab: string, acting: Acting = owner) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly: false } }), component: Outlet })
  const settings = createRoute({ getParentRoute: () => app, path: '/settings', validateSearch: z.looseObject({ tab: optionalParam(z.enum(['store', 'riders'])) }), component: SettingsPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([settings])]), history: createMemoryHistory({ initialEntries: [`/settings?tab=${tab}`] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  await settle()
}

const ridersTabLink = () => document.querySelector('a[href*="tab=riders"]')

beforeEach(() => {
  api.loadRiderPlan.mockResolvedValue({ ownDelivery: true })
  api.loadRiders.mockResolvedValue(page(riders))
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('the tab', () => {
  it('is listed only when the plan has own_delivery', async () => {
    await show('store')
    expect(ridersTabLink()).not.toBeNull()
    cleanup()
    api.loadRiderPlan.mockResolvedValue({ ownDelivery: false })
    await show('store')
    expect(ridersTabLink()).toBeNull()
  })

  it('stays listed when the plan can’t be read, and the tab then shows its error', async () => {
    api.loadRiderPlan.mockRejectedValue(new Error('down'))
    await show('riders')
    expect(ridersTabLink()).not.toBeNull()
    expect(screen.getByRole('button', { name: messages.settings.error.retry })).toBeTruthy()
  })

  it('is not listed for a Manager who holds settings, and its address shows the denied state', async () => {
    await show('store', manager)
    expect(ridersTabLink()).toBeNull()
    cleanup()
    await show('riders', manager)
    expect(screen.getByText(messages.settings.denied.title)).toBeTruthy()
    expect(api.loadRiderPlan).not.toHaveBeenCalled()
    expect(api.loadRiders).not.toHaveBeenCalled()
  })

  it('reads the plan once for the tab list and the tab', async () => {
    await show('riders')
    expect(api.loadRiderPlan).toHaveBeenCalledTimes(1)
  })

  it('says so plainly, with no upsell, at an address typed by hand', async () => {
    api.loadRiderPlan.mockResolvedValue({ ownDelivery: false })
    await show('riders')
    expect(screen.getByText(w.notAvailable.title)).toBeTruthy()
    expect(api.loadRiders).not.toHaveBeenCalled()
  })
})

describe('the list', () => {
  it('shows each rider’s status, whether online, the delivery and deliveries done', async () => {
    await show('riders')
    expect(screen.getByText('Ravi Kumar')).toBeTruthy()
    expect(screen.getByText(w.online)).toBeTruthy()
    expect(screen.getByText(w.onDelivery)).toBeTruthy()
    expect(screen.getByText('42 delivered')).toBeTruthy()
    expect(screen.getByText(w.statuses.suspended)).toBeTruthy()
    expect(screen.getByText(w.statuses.invited)).toBeTruthy()
  })

  it('is empty when there are no riders', async () => {
    api.loadRiders.mockResolvedValue(page([]))
    await show('riders')
    expect(screen.getByText(w.emptyTitle)).toBeTruthy()
  })

  it('adds the next page under Show more', async () => {
    api.loadRiders.mockResolvedValueOnce(page(riders.slice(0, 1), true)).mockResolvedValueOnce(page(riders.slice(1)))
    await show('riders')
    fireEvent.click(screen.getByRole('button', { name: w.showMore }))
    await settle()
    expect(api.loadRiders).toHaveBeenLastCalledWith('c1')
    expect(screen.getByText('Sunil Yadav')).toBeTruthy()
    expect(screen.queryByRole('button', { name: w.showMore })).toBeNull()
  })

  it('says so when the next page fails, and keeps the riders it has', async () => {
    api.loadRiders.mockResolvedValueOnce(page(riders.slice(0, 1), true)).mockRejectedValueOnce(new Error('down'))
    await show('riders')
    fireEvent.click(screen.getByRole('button', { name: w.showMore }))
    await settle()
    expect(screen.getByText(w.moreFailed)).toBeTruthy()
    expect(screen.getByText('Ravi Kumar')).toBeTruthy()
  })

  it('shows the error state with a retry', async () => {
    api.loadRiders.mockRejectedValueOnce(new Error('down'))
    await show('riders')
    expect(screen.getByRole('button', { name: messages.settings.error.retry })).toBeTruthy()
  })
})
