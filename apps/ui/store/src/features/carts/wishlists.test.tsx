// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Acting } from '../../api/shell'
import type { WishlistPage, WishlistReminderSettings, WishlistShopper, WishlistShopperDetail } from '../../api/wishlists'
import { messages } from '../../messages'
import { moneyText } from '../orders/orderView'
import { agoText } from './cartView'

// The Carts screen's Wishlists tab (FIRST-RELEASE §9): who saved what, and its Reminders, for Owner, Manager and Staff (Staff read only).

const words = messages.carts
const w = words.wishlists

const carts = vi.hoisted(() => ({ loadCarts: vi.fn(), loadCartCounts: vi.fn(), loadCartSummary: vi.fn(), loadReminderSending: vi.fn() }))
vi.mock('../../api/carts', async (actual) => ({ ...(await actual<typeof import('../../api/carts')>()), ...carts }))
const offersApi = vi.hoisted(() => ({ loadOfferPlace: vi.fn() }))
vi.mock('../../api/offers', async (actual) => ({ ...(await actual<typeof import('../../api/offers')>()), ...offersApi }))
const api = vi.hoisted(() => ({ loadWishlistShoppers: vi.fn(), loadWishlistCounts: vi.fn(), loadWishlistSummary: vi.fn(), loadWishlistShopper: vi.fn(), loadWishlistReminderSettings: vi.fn(), saveWishlistReminderSettings: vi.fn(), remindWishlistNow: vi.fn(), stopWishlistReminders: vi.fn(), resumeWishlistReminders: vi.fn() }))
vi.mock('../../api/wishlists', async (actual) => ({ ...(await actual<typeof import('../../api/wishlists')>()), ...api }))

const { CartsPage } = await import('./CartsPage')
const { WishlistShopperPage } = await import('./WishlistShopperPage')

const asha: WishlistShopper = { customerId: 'c1', name: 'Asha Rao', email: 'asha@mail.com', items: 3, lastSavedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), firstProduct: 'Chanderi stole', remindersSent: 2, lastSentAt: new Date(Date.now() - 3_600_000).toISOString(), stoppedAt: null, stoppedBy: null, stoppedNote: null }
const dev: WishlistShopper = { customerId: 'c2', name: null, email: null, items: 1, lastSavedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), firstProduct: null, remindersSent: 0, lastSentAt: null, stoppedAt: null, stoppedBy: null, stoppedNote: null }
const page = (rows: WishlistShopper[], next: string | null = null): WishlistPage => ({ rows, next, previous: null })
const detail: WishlistShopperDetail = {
  shopper: { ...asha, firstProduct: null },
  items: [
    { productId: 'p1', name: 'Chanderi stole', photoUrl: '/api/assets/a1', inStock: true, price: { amount: '129900', currency: 'INR' } },
    { productId: 'p2', name: 'Block-print dupatta', photoUrl: null, inStock: false, price: { amount: '168100', currency: 'INR' } },
  ],
  reminders: [
    { id: 'r2', position: null, state: 'sent', skipReason: null, sentBy: 'Farhan Ali', queuedAt: new Date(Date.now() - 3_600_000).toISOString(), sentAt: new Date(Date.now() - 3_600_000).toISOString() },
    { id: 'r1', position: 1, state: 'skipped', skipReason: 'weekly_cap', sentBy: null, queuedAt: new Date(Date.now() - 86_400_000).toISOString(), sentAt: null },
  ],
}
const settings: WishlistReminderSettings = {
  enabled: true,
  skipOutOfStock: true,
  quietHours: true,
  weeklyCap: true,
  revision: 2,
  level: 'automatic',
  steps: [
    { position: 1, enabled: true, delayMinutes: 1440, subject: 'Still thinking?', body: 'You saved these.' },
    { position: 2, enabled: true, delayMinutes: 2880, subject: 'Your wishlist is waiting', body: 'Take another look.' },
    { position: 3, enabled: false, delayMinutes: 4320, subject: 'Last look', body: 'Still saved.' },
  ],
}

const owner: Acting = { store: { id: 's1', name: 'Kesari Threads' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['carts.read', 'carts.write', 'billing'] }
const staff: Acting = { ...owner, role: 'staff', permissions: ['carts.read'] }
const supplier: Acting = { ...owner, role: 'supplier-member', tier: 'vendor-orders-fulfil', seller: { id: 'v1', name: 'Northwind' }, permissions: ['orders.read'] }

const show = async (acting: Acting, entry = '/carts?pane=wishlists', readOnly = false) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly }, me: { id: 'u1', name: 'Farhan Ali', email: 'farhan@kesari.in', acting } }), component: Outlet })
  const list = createRoute({ getParentRoute: () => app, path: '/carts', validateSearch: z.looseObject({ status: z.enum(['open', 'recovered', 'lost']).optional(), pane: z.enum(['reminders', 'wishlists', 'wishlist-reminders']).optional() }), component: CartsPage })
  const one = createRoute({ getParentRoute: () => app, path: '/carts/wishlist/$customerId', component: WishlistShopperPage })
  const customers = createRoute({ getParentRoute: () => app, path: '/customers', validateSearch: z.looseObject({}), component: () => null })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([list, one, customers])]), history: createMemoryHistory({ initialEntries: [entry] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  return router
}
const settle = (ms = 0) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)))

beforeEach(() => {
  carts.loadCarts.mockResolvedValue({ rows: [], next: null, previous: null })
  carts.loadCartCounts.mockResolvedValue({ open: 1, recovered: 0, lost: 0 })
  carts.loadCartSummary.mockResolvedValue(null)
  carts.loadReminderSending.mockResolvedValue({ enabled: true, level: 'automatic' })
  offersApi.loadOfferPlace.mockResolvedValue({ timeZone: 'Asia/Kolkata', country: 'IN' })
  api.loadWishlistShoppers.mockResolvedValue(page([asha, dev]))
  api.loadWishlistCounts.mockResolvedValue({ waiting: 1, reminded: 1, stopped: 0 })
  api.loadWishlistSummary.mockResolvedValue({ days: 14, shoppers: 2, products: 4, reachable: 1, remindersSent: 2, reminded: 1 })
  api.loadWishlistShopper.mockResolvedValue(detail)
  api.loadWishlistReminderSettings.mockResolvedValue(settings)
  api.saveWishlistReminderSettings.mockResolvedValue(3)
  api.remindWishlistNow.mockResolvedValue(undefined)
  api.stopWishlistReminders.mockResolvedValue(undefined)
  api.resumeWishlistReminders.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('the Wishlists tab', () => {
  it('sits beside Carts and Reminders and lists each shopper with how many they saved, the newest product and when', async () => {
    const router = await show(owner, '/carts')
    expect(screen.getAllByRole('button', { name: /^(Carts|Wishlists)$/ }).map((b) => b.textContent)).toEqual([words.panes.carts, words.panes.wishlists])
    expect(screen.getAllByRole('button', { name: /^(List|Reminders)$/ }).map((b) => b.textContent)).toEqual([words.panes.list, words.panes.reminders])
    expect(api.loadWishlistShoppers).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: words.panes.wishlists }))
    await settle()
    expect(router.state.location.search).toMatchObject({ pane: 'wishlists' })
    expect(screen.getAllByRole('button', { name: /^(List|Reminders)$/ })).toHaveLength(2)
    const tiles = within(document.querySelector('.df-carts-tiles') as HTMLElement)
    expect([w.tiles.shoppers, w.tiles.sent, w.tiles.reminded, w.tiles.stopped].every((t) => tiles.getByText(t))).toBe(true)
    expect(tiles.getByText('4 products saved')).toBeTruthy()
    expect(tiles.getByText('1 shopper reachable')).toBeTruthy()
    expect(tiles.getByText('100% of reachable shoppers')).toBeTruthy()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([`${w.tabs.waiting}1`, `${w.tabs.reminded}1`, `${w.tabs.stopped}0`])
    const row = within(screen.getByRole('link', { name: 'Asha Rao' }).closest('[role="row"]') as HTMLElement)
    expect(row.getAllByText('asha@mail.com').length).toBeGreaterThan(0)
    expect(row.getByText('3 products')).toBeTruthy()
    expect(row.getByText(w.pill.reminded)).toBeTruthy()
    expect(row.getByText('Chanderi stole')).toBeTruthy()
    expect(row.getByText(`2 sent · last ${agoText(asha.lastSentAt ?? '', new Date())}`)).toBeTruthy()
    expect(within(screen.getByRole('link', { name: words.guest }).closest('[role="row"]') as HTMLElement).getByText(w.status.none)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Asha Rao' }).getAttribute('href')).toBe('/carts/wishlist/c1')
    expect(screen.getByRole('link', { name: words.guest }).getAttribute('href')).toBe('/carts/wishlist/c2')
    expect(api.loadWishlistShoppers).toHaveBeenCalledWith('waiting', '', {})
  })

  it('searches, says when nothing matches, and says when no one has a wishlist', async () => {
    await show(owner)
    fireEvent.change(screen.getByRole('searchbox', { name: w.search.label }), { target: { value: 'stole' } })
    await settle(350)
    expect(api.loadWishlistShoppers).toHaveBeenLastCalledWith('waiting', 'stole', {})
    api.loadWishlistShoppers.mockResolvedValue(page([]))
    fireEvent.change(screen.getByRole('searchbox', { name: w.search.label }), { target: { value: 'zzz' } })
    await settle(350)
    expect(screen.getByText(w.noMatch.title)).toBeTruthy()
    cleanup()
    api.loadWishlistShoppers.mockResolvedValue(page([]))
    api.loadWishlistCounts.mockResolvedValue({ waiting: 0, reminded: 0, stopped: 0 })
    await show(owner)
    expect(screen.getByText(w.empty.title)).toBeTruthy()
  })

  it('pages with Next and Previous, and says when the list can’t be read, with a retry', async () => {
    api.loadWishlistShoppers.mockImplementation((_: string, __: string, cursor: { after?: string; before?: string }) => Promise.resolve(cursor.after ? { rows: [dev], next: null, previous: 'c26' } : page([asha], 'c25')))
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: words.pages.next }))
    await settle()
    expect(api.loadWishlistShoppers).toHaveBeenLastCalledWith('waiting', '', { after: 'c25' })
    expect(screen.getByText('Showing 26–26')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.pages.previous }))
    await settle()
    expect(api.loadWishlistShoppers).toHaveBeenLastCalledWith('waiting', '', { before: 'c26' })
    cleanup()
    api.loadWishlistShoppers.mockReset()
    api.loadWishlistShoppers.mockRejectedValueOnce(new Error('down')).mockResolvedValue(page([asha]))
    await show(owner)
    expect(screen.getByText(words.error.title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.error.retry }))
    await settle()
    expect(screen.getByRole('link', { name: 'Asha Rao' })).toBeTruthy()
  })

  it('is the same, read only, for Staff, and a seat without carts.read meets "not found" and reads nothing', async () => {
    await show(staff)
    expect(screen.getByRole('link', { name: 'Asha Rao' })).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: /send reminder|stop reminders|resume reminders/i })).toHaveLength(0)
    cleanup()
    api.loadWishlistShoppers.mockClear()
    api.loadWishlistCounts.mockClear()
    api.loadWishlistSummary.mockClear()
    await show(supplier)
    expect(screen.getByText(words.denied.title)).toBeTruthy()
    expect(api.loadWishlistShoppers).not.toHaveBeenCalled()
    expect(api.loadWishlistCounts).not.toHaveBeenCalled()
    expect(api.loadWishlistSummary).not.toHaveBeenCalled()
  })
})

describe('one shopper’s wishlist', () => {
  it('lists what they saved with photo, name and price, marks a sold-out product, and links to the customer', async () => {
    await show(owner, '/carts/wishlist/c1')
    expect(api.loadWishlistShopper).toHaveBeenCalledWith('c1')
    expect(screen.getByRole('heading', { level: 1, name: 'Asha Rao' })).toBeTruthy()
    const list = within(screen.getByRole('region', { name: w.page.heading }))
    expect(list.getAllByRole('listitem').map((li) => li.textContent)).toEqual([`Chanderi stole${moneyText({ amount: '129900', currency: 'INR' })}`, `Block-print dupatta${w.page.outOfStock}${moneyText({ amount: '168100', currency: 'INR' })}`])
    expect([...screen.getByRole('region', { name: w.page.heading }).querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(['/api/assets/a1'])
    expect(screen.getByRole('link', { name: w.page.customer }).getAttribute('href')).toBe('/customers?customer=c1')
    expect(screen.getByRole('link', { name: words.title }).getAttribute('href')).toBe('/carts?pane=wishlists')
  })

  it('shows another shopper as loading, never the last one, and says when it can’t be read or isn’t there', async () => {
    api.loadWishlistShopper.mockRejectedValueOnce(new Error('down')).mockResolvedValue(detail)
    await show(owner, '/carts/wishlist/c1')
    expect(screen.getByText(w.page.errorTitle)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.error.retry }))
    await settle()
    expect(screen.getByRole('heading', { level: 1, name: 'Asha Rao' })).toBeTruthy()
    cleanup()
    api.loadWishlistShopper.mockResolvedValue(null)
    await show(owner, '/carts/wishlist/c9')
    expect(screen.getByText(w.page.missing)).toBeTruthy()
  })

  it('shows a seat without carts.read “not found”, reading nothing', async () => {
    await show(supplier, '/carts/wishlist/c1')
    expect(screen.getByText(words.denied.title)).toBeTruthy()
    expect(api.loadWishlistShopper).not.toHaveBeenCalled()
  })
})

describe('the Wishlists Reminders tab', () => {
  it('is the Reminders half of the Wishlists tab: the sequence as saved, with its preview, and nothing of carts', async () => {
    const router = await show(owner, '/carts?pane=wishlists')
    fireEvent.click(screen.getByRole('button', { name: words.panes.reminders }))
    await settle()
    expect(router.state.location.search).toMatchObject({ pane: 'wishlist-reminders' })
    expect(api.loadWishlistReminderSettings).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('switch', { name: w.reminders.auto }).getAttribute('aria-checked')).toBe('true')
    expect((screen.getAllByLabelText(words.reminders.subject)[0] as HTMLInputElement).value).toBe('Still thinking?')
    expect(screen.getByText(w.reminders.cta)).toBeTruthy()
    expect(screen.queryByText(words.reminders.minimum)).toBeNull()
    expect(screen.queryByText(words.reminders.discount)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: words.panes.list }))
    await settle()
    expect(router.state.location.search).toMatchObject({ pane: 'wishlists' })
    fireEvent.click(screen.getByRole('button', { name: words.panes.carts }))
    await settle()
    expect(router.state.location.search.pane).toBeUndefined()
  })

  it('saves what changed at the revision it read, and says so', async () => {
    await show(owner, '/carts?pane=wishlist-reminders')
    fireEvent.change(screen.getAllByLabelText(words.reminders.subject)[0] as HTMLInputElement, { target: { value: 'Come back' } })
    fireEvent.click(screen.getByRole('button', { name: words.reminders.save }))
    await settle()
    expect(api.saveWishlistReminderSettings).toHaveBeenCalledTimes(1)
    const [input, revision] = api.saveWishlistReminderSettings.mock.calls[0] as [{ enabled: boolean; steps: { subject: string }[] }, number]
    expect([revision, input.enabled, input.steps[0]?.subject]).toEqual([2, true, 'Come back'])
    expect(screen.getByText(w.reminders.savedTimings)).toBeTruthy()
  })

  it('will not save a step that goes no later than the one before it', async () => {
    await show(owner, '/carts?pane=wishlist-reminders')
    fireEvent.change(screen.getAllByLabelText(w.reminders.delay)[1] as HTMLSelectElement, { target: { value: '1440' } })
    fireEvent.click(screen.getByRole('button', { name: words.reminders.save }))
    await settle()
    expect(screen.getByText(words.reminders.errors.later)).toBeTruthy()
    expect(api.saveWishlistReminderSettings).not.toHaveBeenCalled()
  })

  it('asks to reload when someone else saved first', async () => {
    api.saveWishlistReminderSettings.mockRejectedValueOnce(new ApiError('STALE_REVISION', 'stale'))
    await show(owner, '/carts?pane=wishlist-reminders')
    fireEvent.change(screen.getAllByLabelText(words.reminders.subject)[0] as HTMLInputElement, { target: { value: 'Come back' } })
    fireEvent.click(screen.getByRole('button', { name: words.reminders.save }))
    await settle()
    expect(screen.getByText(words.reminders.stale)).toBeTruthy()
  })

  it('is read only for Staff, and says when it can’t be read, with a retry', async () => {
    await show(staff, '/carts?pane=wishlist-reminders')
    expect((screen.getByRole('switch', { name: w.reminders.auto }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: words.reminders.save })).toBeNull()
    cleanup()
    api.loadWishlistReminderSettings.mockRejectedValueOnce(new Error('down')).mockResolvedValue(settings)
    await show(owner, '/carts?pane=wishlist-reminders')
    expect(screen.getByText(w.reminders.error)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.error.retry }))
    await settle()
    expect(screen.getByRole('switch', { name: w.reminders.auto })).toBeTruthy()
  })

  it('on a you-send plan offers the plans instead of a switch', async () => {
    api.loadWishlistReminderSettings.mockResolvedValue({ ...settings, level: 'youSend', enabled: false })
    await show(owner, '/carts?pane=wishlist-reminders')
    expect(screen.queryByRole('switch', { name: w.reminders.auto })).toBeNull()
    expect(screen.getByText(w.reminders.autoYouSend)).toBeTruthy()
  })
})

describe('the Wishlists tabs', () => {
  it('shows Reminded and Stopped by asking for them, each starting on its first page, and says what an empty one holds', async () => {
    await show(owner)
    fireEvent.click(screen.getByRole('tab', { name: new RegExp(w.tabs.reminded) }))
    await settle()
    expect(api.loadWishlistShoppers).toHaveBeenLastCalledWith('reminded', '', {})
    api.loadWishlistShoppers.mockResolvedValue(page([]))
    fireEvent.click(screen.getByRole('tab', { name: new RegExp(w.tabs.stopped) }))
    await settle()
    expect(api.loadWishlistShoppers).toHaveBeenLastCalledWith('stopped', '', {})
    expect(screen.getByText(w.emptyTab.stopped.title)).toBeTruthy()
    expect(screen.getByRole('tab', { name: new RegExp(w.tabs.stopped) }).getAttribute('aria-selected')).toBe('true')
  })

  it('leaves the tiles out when they can’t be read, and the list still works', async () => {
    api.loadWishlistSummary.mockRejectedValue(new Error('down'))
    api.loadWishlistCounts.mockRejectedValue(new Error('down'))
    await show(owner)
    expect(document.querySelector('.df-carts-tiles')).toBeNull()
    expect(screen.getByRole('link', { name: 'Asha Rao' })).toBeTruthy()
  })
})

describe('reminding from the list', () => {
  const rowOf = (name: string) => within(screen.getByRole('link', { name }).closest('[role="row"]') as HTMLElement)

  it('gives each row a pill and a menu like a cart’s: view, send now and stop', async () => {
    await show(owner)
    expect(rowOf(words.guest).getByText(w.pill.noEmail)).toBeTruthy()
    const menu = within(rowOf('Asha Rao').getByRole('button', { name: words.row.actions }).closest('.df-more') as HTMLElement)
    fireEvent.click(rowOf('Asha Rao').getByRole('button', { name: words.row.actions }))
    expect(menu.getByRole('link', { name: new RegExp(w.menu.view) }).getAttribute('href')).toBe('/carts/wishlist/c1')
    fireEvent.click(menu.getByRole('button', { name: new RegExp(words.menu.send) }))
    fireEvent.click(screen.getByRole('button', { name: w.act.sendConfirm }))
    await settle()
    expect(api.remindWishlistNow).toHaveBeenCalledWith('c1')
    expect(screen.getByText('Reminder sent to asha@mail.com.')).toBeTruthy()
  })

  it('gives Staff the view link only', async () => {
    await show(staff)
    fireEvent.click(rowOf('Asha Rao').getByRole('button', { name: words.row.actions }))
    expect(screen.queryByRole('button', { name: new RegExp(words.menu.send) })).toBeNull()
    expect(screen.queryByRole('button', { name: new RegExp(words.menu.stop) })).toBeNull()
  })
})

describe('reminding one shopper', () => {
  it('shows their reminders: the one sent by hand, the one skipped and why', async () => {
    await show(owner, '/carts/wishlist/c1')
    const history = within(screen.getByRole('list', { name: w.page.history }))
    expect(history.getAllByRole('listitem').map((li) => li.textContent)).toEqual([`Sent by Farhan AliSent${agoText(detail.reminders[0]?.sentAt ?? '', new Date())}`, `Reminder 1Skipped · ${w.page.skips.weekly_cap}${agoText(detail.reminders[1]?.queuedAt ?? '', new Date())}`])
  })

  it('sends one now after saying what it does, and then reloads the page', async () => {
    await show(owner, '/carts/wishlist/c1')
    fireEvent.click(screen.getByRole('button', { name: w.act.send }))
    expect(within(screen.getByRole('dialog')).getByText(/right away/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: w.act.sendConfirm }))
    await settle()
    expect(api.remindWishlistNow).toHaveBeenCalledWith('c1')
    expect(api.loadWishlistShopper).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Reminder sent to asha@mail.com.')).toBeTruthy()
  })

  it('stops theirs with a note, and resumes them', async () => {
    await show(owner, '/carts/wishlist/c1')
    fireEvent.click(screen.getByRole('button', { name: w.act.stop }))
    fireEvent.change(screen.getByLabelText(words.act.noteLabel), { target: { value: ' Ordering by phone ' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: w.act.stop }))
    await settle()
    expect(api.stopWishlistReminders).toHaveBeenCalledWith('c1', 'Ordering by phone')
    cleanup()
    api.loadWishlistShopper.mockResolvedValue({ ...detail, shopper: { ...detail.shopper, stoppedAt: new Date().toISOString(), stoppedBy: 'Farhan Ali', stoppedNote: 'Ordering by phone' } })
    await show(owner, '/carts/wishlist/c1')
    expect(screen.getByText(/Stopped by Farhan Ali/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: w.act.send })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: w.act.resume }))
    await settle()
    expect(api.resumeWishlistReminders).toHaveBeenCalledWith('c1')
  })

  it('shows the API’s refusal in the dialog, and gives Staff no actions', async () => {
    api.remindWishlistNow.mockRejectedValueOnce(new ApiError('CANT_REMIND', 'no'))
    await show(owner, '/carts/wishlist/c1')
    fireEvent.click(screen.getByRole('button', { name: w.act.send }))
    fireEvent.click(screen.getByRole('button', { name: w.act.sendConfirm }))
    await settle()
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toBeTruthy()
    cleanup()
    await show(staff, '/carts/wishlist/c1')
    for (const name of [w.act.send, w.act.stop, w.act.resume]) expect(screen.queryByRole('button', { name })).toBeNull()
  })
})

describe('a read-only support session', () => {
  it('can open the list and a shopper’s page but is offered no send, stop or resume, and cannot change the reminders', async () => {
    await show(owner, '/carts?pane=wishlists', true)
    expect(screen.getByText(words.notes.readOnly)).toBeTruthy()
    fireEvent.click(within(screen.getByRole('link', { name: 'Asha Rao' }).closest('[role="row"]') as HTMLElement).getByRole('button', { name: words.row.actions }))
    expect(screen.getByRole('link', { name: new RegExp(w.menu.view) })).toBeTruthy()
    for (const name of [words.menu.send, words.menu.stop, words.menu.resume]) expect(screen.queryByRole('button', { name: new RegExp(name) })).toBeNull()
    cleanup()
    await show(owner, '/carts/wishlist/c1', true)
    expect(screen.getByRole('heading', { level: 1, name: 'Asha Rao' })).toBeTruthy()
    for (const name of [w.act.send, w.act.stop, w.act.resume]) expect(screen.queryByRole('button', { name })).toBeNull()
    cleanup()
    await show(owner, '/carts?pane=wishlist-reminders', true)
    expect((screen.getByRole('switch', { name: w.reminders.auto }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getAllByLabelText(words.reminders.subject)[0] as HTMLInputElement).readOnly).toBe(true)
    expect(screen.queryByRole('button', { name: words.reminders.save })).toBeNull()
  })
})
