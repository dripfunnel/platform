// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { AbandonedCart, CartDetail, CartPage as Page } from '../../api/carts'
import type { Acting } from '../../api/shell'
import { messages } from '../../messages'
import { eventsOf, itemsText, statusLine, stepText } from './cartView'

// Abandoned carts driven as the Owner, a Manager, Staff and a supplier would (FIRST-RELEASE §9): the tiles and tabs,
// search and pages, each cart's actions and their refusals, and one cart's page.

const words = messages.carts

const api = vi.hoisted(() => ({ loadCarts: vi.fn(), loadCartCounts: vi.fn(), loadCartSummary: vi.fn(), loadCart: vi.fn(), loadReminderSending: vi.fn(), remindNow: vi.fn(), stopReminders: vi.fn(), resumeReminders: vi.fn() }))
vi.mock('../../api/carts', async (actual) => ({ ...(await actual<typeof import('../../api/carts')>()), ...api }))
const offersApi = vi.hoisted(() => ({ loadOfferPlace: vi.fn() }))
vi.mock('../../api/offers', async (actual) => ({ ...(await actual<typeof import('../../api/offers')>()), ...offersApi }))

const { CartsPage } = await import('./CartsPage')
const { CartPage } = await import('./CartPage')

const now = new Date('2026-10-10T12:00:00.000Z')
const base = { phone: null, customerId: null, skipReason: null, lastSentAt: null, stoppedAt: null, stoppedBy: null, stoppedNote: null, recoveredOrderId: null, recoveredOrderNumber: null, recoveredWithCode: false, remindersSent: 0, lineCount: 1 }
const vikram: AbandonedCart = { ...base, id: 'ab1', name: 'Vikram Shah', email: 'vikram@mail.com', value: { amount: '249900', currency: 'INR' }, step: 'pay', abandonedAt: '2026-10-10T11:35:00.000Z', status: 'waiting', firstItem: 'Silk saree' }
const meera: AbandonedCart = { ...base, id: 'ab9', name: 'Meera Iyer', email: 'meera@mail.com', value: { amount: '189000', currency: 'INR' }, step: 'ship', abandonedAt: '2026-10-08T12:00:00.000Z', status: 'stopped', firstItem: 'Silk stole', lineCount: 3, stoppedAt: '2026-10-09T12:00:00.000Z', stoppedBy: 'Farhan Ali', stoppedNote: 'Ordering by phone' }
const rohan: AbandonedCart = { ...base, id: 'ab4', name: 'Rohan Mehta', email: 'rohan@mail.com', value: { amount: '358000', currency: 'INR' }, step: 'pay', abandonedAt: '2026-10-08T12:00:00.000Z', status: 'recovered', firstItem: 'Linen kurta', remindersSent: 1, recoveredOrderId: 'o2848', recoveredOrderNumber: 'KT-2848', recoveredWithCode: true }
const page = (rows: AbandonedCart[], next: string | null = null): Page => ({ rows, next, previous: null })
const summary = { days: 14, abandoned: 7, leftBehind: [{ amount: '1544500', currency: 'INR' }], remindersSent: 5, reachable: 4, recovered: 1, recoveredSales: [{ amount: '358000', currency: 'INR' }], recoveredWithCode: 1 }
const planLimit = new ApiError('PLAN_LIMIT', 'no', { key: 'cart_reminders', limit: 0, unlockedBy: { id: 'p', name: 'Growth Pro' } })

const owner: Acting = { store: { id: 's1', name: 'Kesari Threads' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['carts.read', 'carts.write', 'billing'] }
const manager: Acting = { ...owner, role: 'manager', permissions: ['carts.read', 'carts.write'] }
const staff: Acting = { ...owner, role: 'staff', permissions: ['carts.read'] }
const supplier: Acting = { ...owner, role: 'supplier-member', tier: 'vendor-orders-fulfil', seller: { id: 'v1', name: 'Northwind' }, permissions: ['orders.read'] }

const show = async (acting: Acting, { readOnly = false, entry = '/carts' } = {}) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const list = createRoute({ getParentRoute: () => app, path: '/carts', validateSearch: z.looseObject({ status: z.enum(['open', 'recovered', 'lost']).optional() }), component: CartsPage })
  const one = createRoute({ getParentRoute: () => app, path: '/carts/$cartId', component: CartPage })
  const order = createRoute({ getParentRoute: () => app, path: '/orders/$orderId', component: () => null })
  const customers = createRoute({ getParentRoute: () => app, path: '/customers', validateSearch: z.looseObject({}), component: () => null })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([list, one, order, customers])]), history: createMemoryHistory({ initialEntries: [entry] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  return router
}
const settle = (ms = 0) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)))
const row = (name: string) => screen.getByRole('link', { name }).closest('[role="row"]') as HTMLElement
const menu = (name: string, item: RegExp) => {
  fireEvent.click(within(row(name)).getByRole('button', { name: /Actions/ }))
  return within(row(name)).getByRole('button', { name: item })
}

beforeEach(() => {
  api.loadCarts.mockImplementation((tab: string) => Promise.resolve(page(tab === 'lost' ? [meera] : tab === 'recovered' ? [rohan] : [vikram])))
  api.loadCartCounts.mockResolvedValue({ open: 1, recovered: 1, lost: 1 })
  api.loadCartSummary.mockResolvedValue(summary)
  api.loadReminderSending.mockResolvedValue({ enabled: true, level: 'automatic' })
  api.remindNow.mockResolvedValue(undefined)
  api.stopReminders.mockResolvedValue(undefined)
  api.resumeReminders.mockResolvedValue(undefined)
  offersApi.loadOfferPlace.mockResolvedValue({ timeZone: 'Asia/Kolkata', country: 'IN' })
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('how a cart is worded', () => {
  it('says where it stands and what happened, newest first', () => {
    expect(statusLine(meera, now, 'schedule')).toBe('By Farhan Ali · Ordering by phone')
    expect(statusLine(rohan, now, 'schedule')).toBe('Paid · order KT-2848 · with a reminder code')
    expect(statusLine({ ...vikram, status: 'skipped', skipReason: 'under_minimum' }, now, 'schedule')).toBe(words.skip.under_minimum)
    expect(statusLine(vikram, now, 'merchant')).toBe(words.line.yourself)
    expect(statusLine(vikram, now, 'unknown')).toBe(words.line.waiting)
    expect(statusLine({ ...vikram, status: 'not_recovered', remindersSent: 3 }, now, 'schedule')).toBe('3 reminders sent')
    expect(itemsText(meera)).toBe('Silk stole + 2 more')
    expect([stepText('ship', 'US'), stepText('ship', 'IN'), stepText('pay', 'US')]).toEqual([words.step.shipping, words.step.delivery, words.step.pay])
    const detail: CartDetail = {
      cart: { ...rohan, stoppedAt: null },
      lines: [],
      reminders: [{ id: 'r1', position: 1, channel: 'whatsapp', state: 'sent', skipReason: null, sentBy: 'Farhan Ali', code: 'BACK-7KQ2', queuedAt: '2026-10-08T13:00:00.000Z', sentAt: '2026-10-08T13:00:00.000Z', clickedAt: '2026-10-08T14:00:00.000Z' }],
    }
    expect(eventsOf(detail, 'IN').map((e) => e.what)).toEqual(['Paid · order KT-2848 with a reminder code', 'Came back to the cart', 'Reminder 1 sent by WhatsApp (by Farhan Ali) · code BACK-7KQ2', 'Left checkout at Payment'])
  })
})

describe('the Abandoned carts list', () => {
  it('shows the last 14 days and the In progress tab, then another tab and a search', async () => {
    const router = await show(owner)
    expect(screen.getByText('₹15,445.00 left behind')).toBeTruthy()
    expect(screen.getByText('25% of reachable carts')).toBeTruthy()
    expect(api.loadCarts).toHaveBeenLastCalledWith('open', '', {})
    expect(within(row('Vikram Shah')).getByText(words.status.due)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Not recovered 1' }))
    await settle()
    expect(router.state.location.search).toMatchObject({ status: 'lost' })
    expect(api.loadCarts).toHaveBeenLastCalledWith('lost', '', {})
    fireEvent.change(screen.getByRole('searchbox', { name: words.search.label }), { target: { value: 'stole' } })
    await settle(350)
    expect(api.loadCarts).toHaveBeenLastCalledWith('lost', 'stole', {})
  })

  it('shows only the latest read, and starts each tab and search on its first page, coming back too', async () => {
    let slow: (p: Page) => void = () => undefined
    api.loadCarts.mockImplementation((tab: string, _: string, cursor: { after?: string }) => (tab === 'open' && !cursor.after ? new Promise<Page>((r) => (slow = r)) : Promise.resolve(page(tab === 'lost' ? [meera] : [vikram], tab === 'open' ? null : 'c25'))))
    const router = await show(owner)
    fireEvent.click(screen.getByRole('tab', { name: 'Not recovered 1' }))
    await settle()
    slow(page([vikram]))
    await settle()
    expect(screen.queryByRole('link', { name: 'Vikram Shah' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: words.pages.next }))
    await settle()
    expect(api.loadCarts).toHaveBeenLastCalledWith('lost', '', { after: 'c25' })
    await act(() => router.navigate({ to: '/carts', search: { status: 'recovered' } }))
    await settle()
    expect(api.loadCarts).toHaveBeenLastCalledWith('recovered', '', {})
    await act(() => router.navigate({ to: '/carts', search: { status: 'lost' } }))
    await settle()
    expect(api.loadCarts).toHaveBeenLastCalledWith('lost', '', {})
    fireEvent.click(screen.getByRole('button', { name: words.pages.next }))
    await settle()
    const box = screen.getByRole('searchbox', { name: words.search.label })
    fireEvent.change(box, { target: { value: 'stole' } })
    await settle(350)
    fireEvent.change(box, { target: { value: '' } })
    await settle(350)
    expect(api.loadCarts).toHaveBeenLastCalledWith('lost', '', {})
  })

  it('shows loading, never the last tab’s carts and their actions, while another tab is read', async () => {
    let answerLost: (p: Page) => void = () => undefined
    api.loadCarts.mockImplementation((tab: string) => (tab === 'lost' ? new Promise<Page>((resolve) => (answerLost = resolve)) : Promise.resolve(page([vikram]))))
    await show(owner)
    fireEvent.click(screen.getByRole('tab', { name: 'Not recovered 1' }))
    await settle()
    expect(screen.queryByRole('link', { name: 'Vikram Shah' })).toBeNull()
    expect(screen.getByText(words.loading)).toBeTruthy()
    answerLost(page([meera]))
    await settle()
    expect(screen.getByRole('link', { name: 'Meera Iyer' })).toBeTruthy()
  })

  it('moves between tabs with the arrow keys, Home and End, keeping one tab stop', async () => {
    await show(owner)
    const open = screen.getByRole('tab', { name: 'In progress 1' })
    expect(screen.getAllByRole('tab').filter((t) => t.tabIndex === 0)).toEqual([open])
    fireEvent.keyDown(open, { key: 'End' })
    await settle()
    expect(screen.getByRole('tab', { name: 'Not recovered 1' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Not recovered 1' }), { key: 'ArrowRight' })
    await settle()
    expect(screen.getByRole('tab', { name: 'In progress 1' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'In progress 1' }), { key: 'ArrowLeft' })
    await settle()
    expect(screen.getByRole('tab', { name: 'Not recovered 1' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Not recovered 1' }), { key: 'Home' })
    await settle()
    expect(api.loadCarts).toHaveBeenLastCalledWith('open', '', {})
  })

  it('pages back with Previous, and says when the list can’t be read, with a retry', async () => {
    api.loadCarts.mockImplementation((_: string, __: string, cursor: { after?: string; before?: string }) => Promise.resolve(cursor.after ? { rows: [meera], next: null, previous: 'c26' } : { rows: [vikram], next: 'c25', previous: null }))
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: words.pages.next }))
    await settle()
    expect(screen.getByText('Showing 26–26')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.pages.previous }))
    await settle()
    expect(api.loadCarts).toHaveBeenLastCalledWith('open', '', { before: 'c26' })
    expect(screen.getByText('Showing 1–1')).toBeTruthy()
    cleanup()
    api.loadCarts.mockRejectedValueOnce(new Error('down')).mockResolvedValue(page([vikram]))
    await show(owner)
    expect(screen.getByText(words.error.title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.error.retry }))
    await settle()
    expect(screen.getByRole('link', { name: 'Vikram Shah' })).toBeTruthy()
  })

  it('won’t stop reminders with a note longer than the API keeps', async () => {
    await show(owner)
    fireEvent.click(menu('Vikram Shah', /^Stop reminders/))
    fireEvent.change(within(screen.getByRole('dialog')).getByRole('textbox'), { target: { value: 'x'.repeat(201) } })
    expect(within(screen.getByRole('dialog')).getByText('Keep the note to 200 characters.')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: words.act.stop }))
    await settle()
    expect(api.stopReminders).not.toHaveBeenCalled()
  })

  it('claims nothing about who sends while the reminder settings are unread', async () => {
    api.loadReminderSending.mockRejectedValue(new Error('down'))
    await show(owner)
    expect(within(row('Vikram Shah')).getByText(words.line.waiting)).toBeTruthy()
    expect(within(row('Vikram Shah')).queryByText(words.line.yourself)).toBeNull()
  })

  it('sends a reminder with a code on the plan’s automatic, and says what was sent', async () => {
    await show(owner)
    fireEvent.click(menu('Vikram Shah', /^Send reminder now/))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Sends to vikram@mail.com right away, even in quiet hours. The next automatic reminder still goes as planned./)).toBeTruthy()
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: '10' } })
    fireEvent.click(within(dialog).getByRole('button', { name: words.act.send }))
    await settle()
    expect(api.remindNow).toHaveBeenCalledWith('ab1', 10)
    expect(screen.getByText('Reminder sent to vikram@mail.com with a 10% code.')).toBeTruthy()
  })

  it('offers no code where the merchant sends, and keeps the plan’s refusal in its dialog: plans for the Owner, “ask” for a Manager', async () => {
    api.loadReminderSending.mockResolvedValue({ enabled: false, level: 'youSend' })
    api.remindNow.mockRejectedValue(planLimit)
    await show(owner)
    expect(screen.getByText(words.notes.youSend)).toBeTruthy()
    fireEvent.click(menu('Vikram Shah', /^Send reminder now/))
    expect(within(screen.getByRole('dialog')).queryByRole('combobox')).toBeNull()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: words.act.send }))
    await settle()
    expect(api.remindNow).toHaveBeenCalledWith('ab1', null)
    expect(within(screen.getByRole('dialog')).getByText('Your plan sends one reminder per cart, without a code. Growth Pro sends more. See plans in Billing.')).toBeTruthy()
    expect(document.querySelector('.df-carts-note--danger')).toBeNull()
    cleanup()
    await show(manager)
    fireEvent.click(menu('Vikram Shah', /^Send reminder now/))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: words.act.send }))
    await settle()
    expect(within(screen.getByRole('dialog')).getByText('Your plan sends one reminder per cart, without a code. Ask your store owner to upgrade.')).toBeTruthy()
  })

  it('stops reminders with the team’s note, and resumes a stopped cart', async () => {
    await show(owner)
    fireEvent.click(menu('Vikram Shah', /^Stop reminders/))
    fireEvent.change(within(screen.getByRole('dialog')).getByRole('textbox'), { target: { value: 'Called us' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: words.act.stop }))
    await settle()
    expect(api.stopReminders).toHaveBeenCalledWith('ab1', 'Called us')
    fireEvent.click(screen.getByRole('tab', { name: 'Not recovered 1' }))
    await settle()
    fireEvent.click(menu('Meera Iyer', /^Resume reminders/))
    await settle()
    expect(api.resumeReminders).toHaveBeenCalledWith('ab9')
    expect(screen.getByText('Reminders back on for Meera Iyer.')).toBeTruthy()
  })

  it('lets Staff read carts with nothing that sends, and a view-only store says reminders are paused', async () => {
    await show(staff)
    expect(screen.getByText(words.notes.staff)).toBeTruthy()
    fireEvent.click(within(row('Vikram Shah')).getByRole('button', { name: /Actions/ }))
    expect(within(row('Vikram Shah')).queryByRole('button', { name: /^(Send reminder now|Stop reminders)/ })).toBeNull()
    cleanup()
    await show(owner, { readOnly: true })
    expect(screen.getByText(words.notes.readOnly)).toBeTruthy()
    expect(within(row('Vikram Shah')).getByText(words.line.paused)).toBeTruthy()
    fireEvent.click(within(row('Vikram Shah')).getByRole('button', { name: /Actions/ }))
    expect(within(row('Vikram Shah')).queryByRole('button', { name: /^Send reminder now/ })).toBeNull()
  })

  it('shows a supplier “not found” and reads nothing, and a new store how it works', async () => {
    await show(supplier)
    expect(screen.getByText(words.denied.title)).toBeTruthy()
    expect(api.loadCarts).not.toHaveBeenCalled()
    cleanup()
    api.loadCartCounts.mockResolvedValue({ open: 0, recovered: 0, lost: 0 })
    await show(owner)
    expect(screen.getByRole('heading', { name: words.first.title })).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()
  })
})

describe('one cart’s page', () => {
  const detail: CartDetail = {
    cart: { ...vikram, lineCount: 2, customerId: 'c7' },
    lines: [
      { versionId: 'v1', name: 'Silk saree', versionName: 'Red', quantity: 1, lineTotal: { amount: '249900', currency: 'INR' }, available: 2, outOfStock: false },
      { versionId: 'v2', name: 'Dupatta', versionName: null, quantity: 2, lineTotal: { amount: '99800', currency: 'INR' }, available: 0, outOfStock: true },
    ],
    reminders: [],
  }

  it('shows what’s in it as it would be bought now, what’s out of stock, and the shopper', async () => {
    api.loadCart.mockResolvedValue(detail)
    await show(owner, { entry: '/carts/ab1' })
    expect(api.loadCart).toHaveBeenCalledWith('ab1')
    expect(screen.getByRole('heading', { level: 1, name: 'Vikram Shah' })).toBeTruthy()
    expect(screen.getByText('Silk saree · Red')).toBeTruthy()
    expect(screen.getByText('Qty 1 · Only 2 left')).toBeTruthy()
    expect(screen.getByText('Qty 2 · Out of stock now')).toBeTruthy()
    expect(screen.getByText('Dupatta is out of stock now. Reminders leave it out.')).toBeTruthy()
    expect(screen.getByRole('link', { name: words.page.customer }).getAttribute('href')).toBe('/customers?customer=c7')
    fireEvent.click(screen.getByRole('button', { name: words.menu.send }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: words.act.send }))
    await settle()
    expect(api.remindNow).toHaveBeenCalledWith('ab1', null)
  })

  it('shows loading, never the last cart and its actions, while another cart is read', async () => {
    let answerB: (d: CartDetail) => void = () => undefined
    api.loadCart.mockImplementation((id: string) => (id === 'ab9' ? new Promise<CartDetail>((resolve) => (answerB = resolve)) : Promise.resolve(detail)))
    const router = await show(owner, { entry: '/carts/ab1' })
    expect(screen.getByRole('heading', { level: 1, name: 'Vikram Shah' })).toBeTruthy()
    await act(() => router.navigate({ to: '/carts/$cartId', params: { cartId: 'ab9' } }))
    await settle()
    expect(screen.queryByRole('heading', { level: 1, name: 'Vikram Shah' })).toBeNull()
    expect(screen.queryByRole('button', { name: words.menu.send })).toBeNull()
    expect(screen.getByText(words.loadingCart)).toBeTruthy()
    answerB({ ...detail, cart: meera })
    await settle()
    expect(screen.getByRole('heading', { level: 1, name: 'Meera Iyer' })).toBeTruthy()
  })

  it('shows a seat without carts.read “not found”, reading nothing', async () => {
    await show(supplier, { entry: '/carts/ab1' })
    expect(screen.getByText(words.denied.title)).toBeTruthy()
    expect(screen.queryByText('Vikram Shah')).toBeNull()
    expect(api.loadCart).not.toHaveBeenCalled()
    expect(api.loadReminderSending).not.toHaveBeenCalled()
  })

  it('says when a cart can’t be read, with a retry', async () => {
    api.loadCart.mockRejectedValueOnce(new Error('down')).mockResolvedValue(detail)
    await show(owner, { entry: '/carts/ab1' })
    expect(screen.getByText(words.error.titleCart)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.error.retry }))
    await settle()
    expect(screen.getByRole('heading', { level: 1, name: 'Vikram Shah' })).toBeTruthy()
  })

  it('links a recovered cart to its order, and shows a cart that isn’t here as not found', async () => {
    api.loadCart.mockResolvedValue({ ...detail, cart: rohan })
    await show(staff, { entry: '/carts/ab4' })
    expect(screen.getByRole('link', { name: 'View order KT-2848' }).getAttribute('href')).toBe('/orders/o2848')
    expect(screen.queryByRole('button', { name: words.menu.send })).toBeNull()
    cleanup()
    api.loadCart.mockResolvedValue(null)
    await show(owner, { entry: '/carts/nope' })
    expect(screen.getByText(words.missing)).toBeTruthy()
  })
})
