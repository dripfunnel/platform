// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { optionalParam } from '@dripfunnel/shared/search'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Acting } from '../../api/shell'
import type { Rider } from '../../api/riders'
import { messages } from '../../messages'
import { isMobile, toE164 } from './riderPhone'

// Settings › Riders driven as the Owner would (SetRiders, #844).

const w = messages.settings.riders

const api = vi.hoisted(() => ({
  loadRiders: vi.fn(),
  loadRiderPlan: vi.fn(),
  inviteRider: vi.fn(),
  resendRiderInvitation: vi.fn(),
  suspendRider: vi.fn(),
  restoreRider: vi.fn(),
  removeRider: vi.fn(),
}))
vi.mock('../../api/riders', async (actual) => ({ ...(await actual<typeof import('../../api/riders')>()), ...api }))
vi.mock('../../api/settings', () => ({ loadStoreInfo: vi.fn(), loadLocale: vi.fn() }))

const { SettingsPage } = await import('./SettingsPage')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['catalog.read', 'settings'] }

const rider = (r: Partial<Rider> & Pick<Rider, 'id' | 'name'>): Rider => ({ phone: '+919829011111', status: 'active', online: false, currentDeliveryId: null, deliveriesDone: 0, ...r })
const riders = [
  rider({ id: 'r1', name: 'Ravi Kumar', online: true, currentDeliveryId: 'd1', deliveriesDone: 42 }),
  rider({ id: 'r2', name: 'Deepak Meena', status: 'suspended', phone: '+919829033333' }),
  rider({ id: 'r3', name: 'Sunil Yadav', status: 'invited', phone: '+919829044444' }),
]
const page = (nodes: Rider[], hasNextPage = false) => ({ nodes, pageInfo: { hasNextPage, endCursor: hasNextPage ? 'c1' : null } })

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const dialog = () => within(document.querySelector('dialog') as HTMLElement)
const pick = (value: string) => fireEvent.change(dialog().getAllByRole('combobox')[0] as HTMLElement, { target: { value } })
const confirm = (name: string) => fireEvent.click(dialog().getByRole('button', { name }))

const manager: Acting = { ...owner, role: 'manager' }

const show = async (tab: string, readOnly = false, acting: Acting = owner) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const settings = createRoute({ getParentRoute: () => app, path: '/settings', validateSearch: z.looseObject({ tab: optionalParam(z.enum(['store', 'riders'])) }), component: SettingsPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([settings])]), history: createMemoryHistory({ initialEntries: [`/settings?tab=${tab}`] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  await settle()
}

const manage = (name: string) => fireEvent.click(screen.getByRole('button', { name: `Manage ${name}` }))
const ridersTabLink = () => document.querySelector('a[href*="tab=riders"]')

beforeEach(() => {
  api.loadRiderPlan.mockResolvedValue({ ownDelivery: true })
  api.loadRiders.mockResolvedValue(page(riders))
  for (const fn of [api.inviteRider, api.resendRiderInvitation, api.suspendRider, api.restoreRider, api.removeRider]) fn.mockResolvedValue(undefined)
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
    await show('store', false, manager)
    expect(ridersTabLink()).toBeNull()
    cleanup()
    await show('riders', false, manager)
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

  it('is empty with an invite button when there are no riders', async () => {
    api.loadRiders.mockResolvedValue(page([]))
    await show('riders')
    expect(screen.getByText(w.emptyTitle)).toBeTruthy()
    expect(screen.getByRole('button', { name: w.invite })).toBeTruthy()
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

  it('shows the error state with a retry', async () => {
    api.loadRiders.mockRejectedValueOnce(new Error('down'))
    await show('riders')
    expect(screen.getByRole('button', { name: messages.settings.error.retry })).toBeTruthy()
  })

  it('has no controls when the store is read-only', async () => {
    await show('riders', true)
    expect(screen.queryByRole('button', { name: w.invite })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Manage Ravi Kumar' })).toBeNull()
  })
})

describe('invite', () => {
  const start = async () => {
    await show('riders')
    fireEvent.click(screen.getByRole('button', { name: w.invite }))
    fireEvent.change(dialog().getByLabelText(w.name), { target: { value: 'Asha Rao' } })
    confirm(w.next)
  }

  it('asks the name, then the mobile starting with +, and sends it as E.164', async () => {
    await start()
    const mobile = dialog().getByLabelText(w.mobile) as HTMLInputElement
    expect(mobile.value).toBe('+')
    fireEvent.change(mobile, { target: { value: '+91 98765 43210' } })
    confirm(w.send)
    await settle()
    expect(api.inviteRider).toHaveBeenCalledWith('Asha Rao', '+919876543210')
    expect(screen.getByText('Invitation texted to +919876543210')).toBeTruthy()
    expect(api.loadRiders).toHaveBeenCalledTimes(2)
  })

  it('refuses a number that isn’t E.164 before asking the API', async () => {
    await start()
    fireEvent.change(dialog().getByLabelText(w.mobile), { target: { value: '+91 123' } })
    expect(dialog().getByText(w.mobileInvalid)).toBeTruthy()
    expect((dialog().getByRole('button', { name: w.send }) as HTMLButtonElement).disabled).toBe(true)
    expect(api.inviteRider).not.toHaveBeenCalled()
  })

  it('sends a fast double click once', async () => {
    await start()
    fireEvent.change(dialog().getByLabelText(w.mobile), { target: { value: '+91 98765 43210' } })
    confirm(w.send)
    confirm(w.send)
    await settle()
    expect(api.inviteRider).toHaveBeenCalledTimes(1)
  })

  it('keeps the dialog and the number when the API refuses it', async () => {
    api.inviteRider.mockRejectedValue(new ApiError('PHONE_TAKEN', 'taken'))
    await start()
    fireEvent.change(dialog().getByLabelText(w.mobile), { target: { value: '+91 98765 43210' } })
    confirm(w.send)
    await settle()
    expect(dialog().getByText(w.refused.PHONE_TAKEN)).toBeTruthy()
    expect((dialog().getByLabelText(w.mobile) as HTMLInputElement).value).toBe('+91 98765 43210')
  })
})

describe('the number as typed', () => {
  it.each([
    ['+91 98765 43210', '+919876543210'],
    ['0091 98765 43210', '+919876543210'],
    ['+44 (7700) 900-123', '+447700900123'],
  ])('%s is sent as %s', (typed, sent) => {
    expect(toE164(typed)).toBe(sent)
  })

  it('never guesses a country code', () => {
    expect(isMobile('98765 43210')).toBe(false)
    expect(isMobile('+91 98765 43210')).toBe(true)
  })
})

describe('suspend, restore, remove and resend', () => {
  it('suspends only after its consequence is confirmed', async () => {
    await show('riders')
    manage('Ravi Kumar')
    pick('suspend')
    confirm(w.continue)
    expect(dialog().getByText(w.suspendBody)).toBeTruthy()
    expect(api.suspendRider).not.toHaveBeenCalled()
    confirm(w.suspend)
    await settle()
    expect(api.suspendRider).toHaveBeenCalledWith('r1')
    expect(screen.getByText('Ravi Kumar suspended')).toBeTruthy()
  })

  it('removes only after its consequence is confirmed', async () => {
    await show('riders')
    manage('Ravi Kumar')
    pick('remove')
    confirm(w.continue)
    expect(dialog().getByText(w.removeBody)).toBeTruthy()
    expect(api.removeRider).not.toHaveBeenCalled()
    confirm(w.remove)
    await settle()
    expect(api.removeRider).toHaveBeenCalledWith('r1')
  })

  it('restores a suspended rider', async () => {
    await show('riders')
    manage('Deepak Meena')
    pick('restore')
    confirm(w.continue)
    await settle()
    expect(api.restoreRider).toHaveBeenCalledWith('r2')
  })

  it('resends an invitation', async () => {
    await show('riders')
    manage('Sunil Yadav')
    pick('resend')
    confirm(w.continue)
    await settle()
    expect(api.resendRiderInvitation).toHaveBeenCalledWith('r3')
  })
})

describe('refusals', () => {
  const refuse = async (error: unknown, expected: string) => {
    api.suspendRider.mockRejectedValue(error)
    await show('riders')
    manage('Ravi Kumar')
    pick('suspend')
    confirm(w.continue)
    confirm(w.suspend)
    await settle()
    expect(screen.getByText(expected)).toBeTruthy()
  }

  it('words a rider carrying a parcel', () => refuse(new ApiError('RIDER_HAS_PARCEL', 'x'), w.refused.RIDER_HAS_PARCEL))
  it('words a number already taken', () => refuse(new ApiError('PHONE_TAKEN', 'x'), w.refused.PHONE_TAKEN))
  it('words the text limit', () => refuse(new ApiError('RATE_LIMITED', 'x'), w.refused.RATE_LIMITED))
  it('words a plan without own delivery', () => refuse(new ApiError('PLAN_LIMIT', 'x', { key: 'own_delivery', limit: null }), w.refused.notInPlan))
  it('words the rider limit with its figure', () => refuse(new ApiError('PLAN_LIMIT', 'x', { key: 'riders', limit: 3 }), 'Your plan allows 3 riders. Remove a rider, or ask DripFunnel to raise your limit.'))
  it('words anything else', () => refuse(new Error('boom'), w.refused.other))
})
