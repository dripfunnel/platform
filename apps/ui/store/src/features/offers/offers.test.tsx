// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Offer, OfferAction, OfferPage as Page } from '../../api/offers'
import type { Acting } from '../../api/shell'
import { messages } from '../../messages'

// Offers driven as the Owner, a Manager, Staff and a supplier would (FIRST-RELEASE §8, OFFERS-DESIGN §4): the tabs,
// search and filters, "Check a code", and each row action and its refusals.

const words = messages.offers

const api = vi.hoisted(() => ({
  loadOffers: vi.fn(),
  loadOfferCounts: vi.fn(),
  checkCode: vi.fn(),
  setOfferOn: vi.fn(),
  endOffer: vi.fn(),
  duplicateOffer: vi.fn(),
  deleteOffer: vi.fn(),
  loadOfferPlace: vi.fn(),
  loadOfferNames: vi.fn(),
}))
vi.mock('../../api/offers', async (actual) => ({ ...(await actual<typeof import('../../api/offers')>()), ...api }))

const { OffersPage } = await import('./OffersPage')

const action = (a: Partial<OfferAction> & Pick<OfferAction, 'operation'>): OfferAction => ({ percent: null, amounts: [], cap: [], targets: null, exclude: null, buy: null, get: null, oncePerOrder: false, kind: null, tiers: [], ...a })
const welcome: Offer = {
  id: 'o1',
  name: 'Welcome 10% off',
  internalName: 'Instagram, Oct',
  trigger: 'code',
  code: 'WELCOME10',
  status: 'live',
  enabled: true,
  startsAt: null,
  endsAt: null,
  totalUsesLimit: 100,
  perCustomerLimit: 1,
  usesCount: 38,
  combines: { product: false, order: false, shipping: false },
  conditions: [],
  action: action({ operation: 'order_percentage_discount', percent: 10 }),
  revision: 3,
}
const paused: Offer = { ...welcome, id: 'o2', name: 'Socks deal', code: null, trigger: 'automatic', status: 'off', enabled: false, totalUsesLimit: null }
const page = (rows: Offer[]): Page => ({ rows, next: null, previous: null })
const counts = { live: 1, scheduled: 0, off: 1, ended: 0 }
const planLimit = (name: string) => new ApiError('PLAN_LIMIT', 'Your plan doesn’t include this.', { key: 'live_offers', limit: 3, unlockedBy: { id: 'p', name } })

const owner: Acting = { store: { id: 's1', name: 'Kesari Threads' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['offers.read', 'offers.write', 'offers.export', 'billing'] }
const manager: Acting = { ...owner, role: 'manager', permissions: ['offers.read', 'offers.write', 'offers.export'] }
const staff: Acting = { ...owner, role: 'staff', permissions: ['offers.read'] }
const supplier: Acting = { ...owner, role: 'supplier-member', tier: 'vendor-orders-fulfil', seller: { id: 'v1', name: 'Northwind Textiles' }, permissions: ['orders.read'] }

const show = async (acting: Acting, { readOnly = false, entry = '/offers' } = {}) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const list = createRoute({ getParentRoute: () => app, path: '/offers', validateSearch: z.looseObject({ status: z.enum(['live', 'scheduled', 'off', 'ended']).optional() }), component: OffersPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([list])]), history: createMemoryHistory({ initialEntries: [entry] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  return router
}

const settle = (ms = 0) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)))
const row = (name: string) => screen.getByText(name, { selector: '.df-offers-name' }).closest('[role="row"]') as HTMLElement
const openMenu = (name: string) => fireEvent.click(within(row(name)).getByRole('button', { name: /Actions/ }))
const menuItem = (name: string, item: RegExp) => within(row(name)).getByRole('button', { name: item })

beforeEach(() => {
  api.loadOffers.mockImplementation(({ tab }: { tab: string }) => Promise.resolve(page(tab === 'off' ? [paused] : [welcome])))
  api.loadOfferCounts.mockResolvedValue(counts)
  api.loadOfferPlace.mockResolvedValue({ timeZone: 'Asia/Kolkata', country: 'IN' })
  api.loadOfferNames.mockResolvedValue({ collections: new Map(), filterValues: new Map(), groups: new Map() })
  api.setOfferOn.mockResolvedValue(undefined)
  api.endOffer.mockResolvedValue(undefined)
  api.deleteOffer.mockResolvedValue(undefined)
  api.duplicateOffer.mockResolvedValue('o9')
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('the Offers list', () => {
  it('reads the Live tab with every tab’s count, then another tab, the search and the filters', async () => {
    const router = await show(owner)
    expect(api.loadOffers).toHaveBeenLastCalledWith({ tab: 'live', kind: null, trigger: null, search: '' }, {})
    expect(screen.getByRole('tab', { name: 'Live 1' }).getAttribute('aria-selected')).toBe('true')
    expect(within(row('Welcome 10% off')).getByText('10% off the order')).toBeTruthy()
    expect(within(row('Welcome 10% off')).getByText('38 / 100')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Off 1' }))
    await settle()
    expect(router.state.location.search).toMatchObject({ status: 'off' })
    expect(api.loadOffers).toHaveBeenLastCalledWith({ tab: 'off', kind: null, trigger: null, search: '' }, {})
    expect(row('Socks deal')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: words.filters.type }), { target: { value: 'bxgy' } })
    fireEvent.change(screen.getByRole('combobox', { name: words.filters.how }), { target: { value: 'automatic' } })
    await settle()
    expect(api.loadOffers).toHaveBeenLastCalledWith({ tab: 'off', kind: 'bxgy', trigger: 'automatic', search: '' }, {})
  })

  it('shows loading, never the last tab’s rows and actions, while another tab is read', async () => {
    let answerOff: (p: Page) => void = () => undefined
    api.loadOffers.mockImplementation(({ tab }: { tab: string }) => (tab === 'off' ? new Promise<Page>((resolve) => (answerOff = resolve)) : Promise.resolve(page([welcome]))))
    await show(owner)
    fireEvent.click(screen.getByRole('tab', { name: 'Off 1' }))
    await settle()
    expect(screen.queryByText('Welcome 10% off')).toBeNull()
    expect(screen.getByText(words.loading)).toBeTruthy()
    answerOff(page([paused]))
    await settle()
    expect(row('Socks deal')).toBeTruthy()
  })

  it('pages 25 at a time: Next asks after, Previous asks before, and says which rows it shows', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ ...welcome, id: `o${i}`, name: `Offer ${i}` }))
    api.loadOffers.mockImplementation((_: unknown, cursor: { after?: string; before?: string }) => Promise.resolve(cursor.after ? { rows: [paused], next: null, previous: 'c26' } : { rows: many, next: 'c25', previous: null }))
    await show(owner)
    expect(screen.getByText('Showing 1–25')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.pages.next }))
    await settle()
    expect(api.loadOffers).toHaveBeenLastCalledWith({ tab: 'live', kind: null, trigger: null, search: '' }, { after: 'c25' })
    expect(screen.getByText('Showing 26–26')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.pages.previous }))
    await settle()
    expect(api.loadOffers).toHaveBeenLastCalledWith({ tab: 'live', kind: null, trigger: null, search: '' }, { before: 'c26' })
    expect(screen.getByText('Showing 1–25')).toBeTruthy()
  })

  it('starts a tab reached through the address, or a new filter, on its first page', async () => {
    api.loadOffers.mockImplementation((_: unknown, cursor: { after?: string }) => Promise.resolve(cursor.after ? { rows: [paused], next: null, previous: 'c26' } : { rows: [welcome], next: 'c25', previous: null }))
    const router = await show(owner)
    fireEvent.click(screen.getByRole('button', { name: words.pages.next }))
    await settle()
    await act(() => router.navigate({ to: '/offers', search: { status: 'off' } }))
    await settle()
    expect(api.loadOffers).toHaveBeenLastCalledWith({ tab: 'off', kind: null, trigger: null, search: '' }, {})
    expect(screen.getByText('Showing 1–1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.pages.next }))
    await settle()
    fireEvent.change(screen.getByRole('combobox', { name: words.filters.how }), { target: { value: 'code' } })
    await settle()
    expect(api.loadOffers).toHaveBeenLastCalledWith({ tab: 'off', kind: null, trigger: 'code', search: '' }, {})
  })

  it('moves between tabs with the arrow keys, Home and End, keeping one tab stop', async () => {
    await show(owner)
    const live = screen.getByRole('tab', { name: 'Live 1' })
    expect(screen.getAllByRole('tab').filter((t) => t.tabIndex === 0)).toEqual([live])
    fireEvent.keyDown(live, { key: 'End' })
    await settle()
    expect(screen.getByRole('tab', { name: 'Ended 0' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Ended 0' }), { key: 'ArrowRight' })
    await settle()
    expect(screen.getByRole('tab', { name: 'Live 1' }).getAttribute('aria-selected')).toBe('true')
  })

  it('shows only the latest read: a slow answer for an earlier tab never replaces the one asked for after', async () => {
    let answerLive: (p: Page) => void = () => undefined
    api.loadOffers.mockImplementation(({ tab }: { tab: string }) => (tab === 'live' ? new Promise<Page>((resolve) => (answerLive = resolve)) : Promise.resolve(page([paused]))))
    await show(owner)
    fireEvent.click(screen.getByRole('tab', { name: 'Off 1' }))
    await settle()
    answerLive(page([welcome]))
    await settle()
    expect(row('Socks deal')).toBeTruthy()
    expect(screen.queryByText('Welcome 10% off')).toBeNull()
  })

  it('turns an offer off after saying what happens to carts, and keeps a refusal in its dialog only', async () => {
    api.setOfferOn.mockRejectedValueOnce(new ApiError('READ_ONLY', 'no'))
    await show(owner)
    openMenu('Welcome 10% off')
    fireEvent.click(menuItem('Welcome 10% off', /^Turn off/))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(words.act.offBody)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: words.act.off }))
    await settle()
    expect(within(screen.getByRole('dialog')).getByText(words.refused.READ_ONLY)).toBeTruthy()
    expect(document.querySelector('.df-offers-note--danger')).toBeNull()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: words.act.cancel }))
    openMenu('Welcome 10% off')
    fireEvent.click(menuItem('Welcome 10% off', /^Turn off/))
    expect(within(screen.getByRole('dialog')).queryByText(words.refused.READ_ONLY)).toBeNull()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: words.act.off }))
    await settle()
    expect(api.setOfferOn).toHaveBeenLastCalledWith('o1', false)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Welcome 10% off is off.')).toBeTruthy()
    expect(api.loadOfferCounts).toHaveBeenCalledTimes(2)
  })

  it('names the plan that lifts the live-offer limit to the Owner, and tells a Manager to ask', async () => {
    api.setOfferOn.mockRejectedValue(planLimit('Growth Pro'))
    await show(owner, { entry: '/offers?status=off' })
    openMenu('Socks deal')
    fireEvent.click(menuItem('Socks deal', /^Turn on/))
    await settle()
    expect(api.setOfferOn).toHaveBeenCalledWith('o2', true)
    expect(screen.getByRole('alert').textContent).toBe('Your plan allows 3 live offers. Growth Pro has more. See plans in Billing.')
    cleanup()
    await show(manager, { entry: '/offers?status=off' })
    openMenu('Socks deal')
    fireEvent.click(menuItem('Socks deal', /^Turn on/))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe('Your plan allows 3 live offers. Ask your store owner to upgrade.')
  })

  it('ends and deletes only after restating the consequence, naming a code that stays reserved', async () => {
    await show(owner)
    openMenu('Welcome 10% off')
    fireEvent.click(menuItem('Welcome 10% off', /^End now/))
    expect(within(screen.getByRole('dialog')).getByText(/Off is a pause you can undo; ending is meant to be final/)).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: words.act.end }))
    await settle()
    expect(api.endOffer).toHaveBeenCalledWith('o1')
    openMenu('Welcome 10% off')
    fireEvent.click(menuItem('Welcome 10% off', /^Delete/))
    expect(within(screen.getByRole('dialog')).getByText(/The code WELCOME10 stays reserved/)).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: words.act.delete }))
    await settle()
    expect(api.deleteOffer).toHaveBeenCalledWith('o1')
  })

  it('makes a copy that is off, and says so', async () => {
    await show(owner)
    openMenu('Welcome 10% off')
    fireEvent.click(menuItem('Welcome 10% off', /^Duplicate/))
    await settle()
    expect(api.duplicateOffer).toHaveBeenCalledWith('o1')
    expect(screen.getByText(words.act.duplicated)).toBeTruthy()
  })

  it('copies a code, and says so where the browser gives no clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await show(owner)
    openMenu('Welcome 10% off')
    fireEvent.click(menuItem('Welcome 10% off', /^Copy code/))
    await settle()
    expect(writeText).toHaveBeenCalledWith('WELCOME10')
    expect(screen.getByText('WELCOME10 copied.')).toBeTruthy()
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    openMenu('Welcome 10% off')
    fireEvent.click(menuItem('Welcome 10% off', /^Copy code/))
    await settle()
    expect(screen.getByText(words.copyFailed)).toBeTruthy()
  })

  it('lets Staff read offers and check codes, with no action that changes one', async () => {
    await show(staff)
    expect(screen.getByText(words.notes.staff)).toBeTruthy()
    openMenu('Welcome 10% off')
    expect(menuItem('Welcome 10% off', /^Copy code/)).toBeTruthy()
    expect(within(row('Welcome 10% off')).queryByRole('button', { name: /^(Turn off|End now|Duplicate|Delete)/ })).toBeNull()
  })

  it('changes nothing while the store is view-only, and says so', async () => {
    await show(owner, { readOnly: true })
    expect(screen.getByText(words.notes.readOnly)).toBeTruthy()
    openMenu('Welcome 10% off')
    expect(within(row('Welcome 10% off')).queryByRole('button', { name: /^(Turn off|End now|Duplicate|Delete)/ })).toBeNull()
  })

  it('shows a supplier “not found” and reads nothing', async () => {
    await show(supplier)
    expect(screen.getByText(words.denied.title)).toBeTruthy()
    expect(api.loadOffers).not.toHaveBeenCalled()
    expect(api.loadOfferCounts).not.toHaveBeenCalled()
  })

  it('explains offers on a store that has none yet', async () => {
    api.loadOfferCounts.mockResolvedValue({ live: 0, scheduled: 0, off: 0, ended: 0 })
    api.loadOffers.mockResolvedValue(page([]))
    await show(owner)
    expect(screen.getByText(words.firstTime.title)).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('says when no offer matches and clears the filters', async () => {
    await show(owner)
    api.loadOffers.mockResolvedValue(page([]))
    fireEvent.change(screen.getByRole('searchbox', { name: words.search.label }), { target: { value: 'zzz' } })
    await settle(350)
    expect(screen.getByText(words.noMatch.title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.noMatch.clear }))
    await settle()
    expect(api.loadOffers).toHaveBeenLastCalledWith({ tab: 'live', kind: null, trigger: null, search: '' }, {})
  })
})

describe('Check a code', () => {
  it('asks once typing pauses and shows only the latest code’s answer', async () => {
    let first: (v: null) => void = () => undefined
    api.checkCode.mockImplementationOnce(() => new Promise((resolve) => (first = resolve))).mockResolvedValueOnce({ code: 'WELCOME10', offer: welcome, deleted: false, singleUse: false, usedAt: null, expiresAt: null, answer: 'WORKS' })
    await show(owner)
    const box = screen.getByRole('textbox', { name: words.check.label })
    fireEvent.change(box, { target: { value: 'welcome1' } })
    await settle(450)
    fireEvent.change(box, { target: { value: 'welcome10' } })
    await settle(450)
    first(null)
    await settle()
    expect(api.checkCode).toHaveBeenLastCalledWith('WELCOME10')
    expect(screen.getByText('WELCOME10 works now.')).toBeTruthy()
    expect(screen.queryByText(/isn’t one of your codes/)).toBeNull()
  })

  it('says when there have been too many checks', async () => {
    api.checkCode.mockRejectedValue(new ApiError('RATE_LIMITED', 'slow down'))
    await show(staff)
    fireEvent.change(screen.getByRole('textbox', { name: words.check.label }), { target: { value: 'abc' } })
    await settle(450)
    expect(screen.getByText(words.check.tooMany)).toBeTruthy()
  })
})
