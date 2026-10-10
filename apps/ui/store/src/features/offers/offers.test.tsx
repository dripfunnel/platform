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
// search and filters, "Check a code", each row action and its refusals, and one offer's page with results and codes.

const words = messages.offers

const api = vi.hoisted(() => ({
  loadOffers: vi.fn(),
  loadOfferCounts: vi.fn(),
  loadOffer: vi.fn(),
  loadOfferResults: vi.fn(),
  loadCodeBatches: vi.fn(),
  checkCode: vi.fn(),
  setOfferOn: vi.fn(),
  endOffer: vi.fn(),
  duplicateOffer: vi.fn(),
  deleteOffer: vi.fn(),
  generateCodes: vi.fn(),
  requestCodesExport: vi.fn(),
  loadCodesExport: vi.fn(),
  loadOfferPlace: vi.fn(),
  loadOfferNames: vi.fn(),
}))
vi.mock('../../api/offers', async (actual) => ({ ...(await actual<typeof import('../../api/offers')>()), ...api }))

const { OffersPage } = await import('./OffersPage')
const { OfferPage } = await import('./OfferPage')

const action = (a: Partial<OfferAction> & Pick<OfferAction, 'operation'>): OfferAction => ({ percent: null, amounts: [], cap: [], targets: null, exclude: null, buy: null, get: null, oncePerOrder: false, kind: null, tiers: [], ...a })
const welcome: Offer = {
  id: 'o1',
  name: 'Welcome 10% off',
  internalName: 'Instagram, Oct',
  description: null,
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
const single: Offer = { ...welcome, id: 'o3', name: 'Influencer 15%', code: null }
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
  const one = createRoute({ getParentRoute: () => app, path: '/offers/$offerId', component: OfferPage })
  const billing = createRoute({ getParentRoute: () => app, path: '/billing', component: () => null })
  const create = createRoute({ getParentRoute: () => app, path: '/offers/new', validateSearch: z.looseObject({}), component: () => null })
  const edit = createRoute({ getParentRoute: () => app, path: '/offers/$offerId/edit', component: () => null })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([list, one, billing, create, edit])]), history: createMemoryHistory({ initialEntries: [entry] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  return router
}

const settle = (ms = 0) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)))
const row = (name: string) => screen.getByRole('link', { name }).closest('[role="row"]') as HTMLElement
const openMenu = (name: string) => fireEvent.click(within(row(name)).getByRole('button', { name: /Actions/ }))
const menuItem = (name: string, item: RegExp) => within(row(name)).getByRole('button', { name: item })

beforeEach(() => {
  api.loadOffers.mockImplementation(({ tab }: { tab: string }) => Promise.resolve(page(tab === 'off' ? [paused] : [welcome])))
  api.loadOfferCounts.mockResolvedValue(counts)
  api.loadOfferPlace.mockResolvedValue({ timeZone: 'Asia/Kolkata', country: 'IN' })
  api.loadOfferNames.mockResolvedValue({ collections: new Map(), filterValues: new Map(), groups: new Map() })
  api.loadOffer.mockImplementation((id: string) => Promise.resolve([welcome, paused, single].find((o) => o.id === id) ?? null))
  api.loadOfferResults.mockResolvedValue({ uses: 38, discountGiven: [{ amount: '41200', currency: 'INR' }], salesWithOffer: [], averageOrder: [], byDay: [] })
  api.loadCodeBatches.mockResolvedValue({ rows: [{ id: 'b1', prefix: 'INSTA-', length: 8, count: 500, used: 37, createdAt: '2026-10-01T00:00:00.000Z' }], next: null })
  api.setOfferOn.mockResolvedValue(undefined)
  api.endOffer.mockResolvedValue(undefined)
  api.deleteOffer.mockResolvedValue(undefined)
  api.duplicateOffer.mockResolvedValue('o9')
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.useRealTimers()
  sessionStorage.clear()
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

  it('waits for the store’s time zone before showing times, and says so when it can’t be read', async () => {
    let answerPlace: (p: { timeZone: string; country: string }) => void = () => undefined
    api.loadOfferPlace.mockImplementation(() => new Promise((resolve) => (answerPlace = resolve)))
    await show(owner)
    expect(screen.queryByText('Welcome 10% off')).toBeNull()
    expect(screen.getByText(words.loading)).toBeTruthy()
    answerPlace({ timeZone: 'Asia/Kolkata', country: 'IN' })
    await settle()
    expect(row('Welcome 10% off')).toBeTruthy()
    cleanup()
    api.loadOfferPlace.mockRejectedValueOnce(new Error('down')).mockResolvedValue({ timeZone: 'Asia/Kolkata', country: 'IN' })
    await show(owner)
    expect(screen.getByText(words.error.title)).toBeTruthy()
    expect(screen.queryByText('Welcome 10% off')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: words.error.retry }))
    await settle()
    expect(row('Welcome 10% off')).toBeTruthy()
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
    expect(screen.getByRole('link', { name: 'Socks deal' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Welcome 10% off' })).toBeNull()
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

  it('opens the copy a Duplicate makes, saying so', async () => {
    api.loadOffer.mockResolvedValue({ ...welcome, id: 'o9', name: 'Copy of Welcome 10% off', status: 'off', enabled: false, code: null })
    const router = await show(owner)
    openMenu('Welcome 10% off')
    fireEvent.click(menuItem('Welcome 10% off', /^Duplicate/))
    await settle()
    expect(api.duplicateOffer).toHaveBeenCalledWith('o1')
    expect(router.state.location.pathname).toBe('/offers/o9')
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
    expect(within(row('Welcome 10% off')).getByRole('link', { name: /^View/ })).toBeTruthy()
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
    expect(screen.getByRole('heading', { name: words.firstTime.heading })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Buy X, get Y/ }).getAttribute('href')).toBe('/offers/new?type=bxgy')
    expect(screen.getByRole('link', { name: /Welcome code/ }).getAttribute('href')).toBe('/offers/new?recipe=welcome')
    expect(screen.queryByRole('tablist')).toBeNull()
    cleanup()
    await show(staff)
    expect(screen.getByText(words.firstTime.title)).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Welcome code/ })).toBeNull()
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

describe('one offer’s page', () => {
  it('words the offer and its details, with the store’s time zone named', async () => {
    await show(owner, { entry: '/offers/o1' })
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome 10% off' })).toBeTruthy()
    expect(screen.getByText(/10% off the whole order · code WELCOME10/)).toBeTruthy()
    expect(screen.getByText('No end date · India Standard Time')).toBeTruthy()
    expect(screen.getByText('Instagram, Oct')).toBeTruthy()
    expect(screen.getByText('₹412.00')).toBeTruthy()
    expect(screen.getByText('38 of 100')).toBeTruthy()
  })

  it('shows results on a plan without them as locked: plans for the Owner, “ask” for a Manager', async () => {
    api.loadOfferResults.mockRejectedValue(new ApiError('PLAN_LIMIT', 'no', { key: 'offer_results', limit: null, unlockedBy: { id: 'p', name: 'Growth Pro' } }))
    await show(owner, { entry: '/offers/o1' })
    expect(screen.getByText('Results are on Growth Pro')).toBeTruthy()
    expect(screen.getByRole('link', { name: words.results.seePlans }).getAttribute('href')).toBe('/billing')
    cleanup()
    await show(manager, { entry: '/offers/o1' })
    expect(screen.queryByRole('link', { name: words.results.seePlans })).toBeNull()
    expect(screen.getByText(words.results.askOwner)).toBeTruthy()
  })

  it('goes back to the list once the offer is deleted', async () => {
    const router = await show(owner, { entry: '/offers/o1' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: words.act.delete }))
    await settle()
    expect(router.state.location.pathname).toBe('/offers')
    expect(screen.getByText('Welcome 10% off deleted.')).toBeTruthy()
  })

  it('opens a copy from the page without showing the original under its address while it loads', async () => {
    let answerCopy: (o: Offer) => void = () => undefined
    api.loadOffer.mockImplementation((id: string) => (id === 'o9' ? new Promise<Offer>((resolve) => (answerCopy = resolve)) : Promise.resolve(welcome)))
    const router = await show(owner, { entry: '/offers/o1' })
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    await settle()
    expect(router.state.location.pathname).toBe('/offers/o9')
    expect(screen.queryByRole('heading', { level: 1, name: 'Welcome 10% off' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    answerCopy({ ...welcome, id: 'o9', name: 'Copy of Welcome 10% off', status: 'off', enabled: false, code: null })
    await settle()
    expect(screen.getByRole('heading', { level: 1, name: 'Copy of Welcome 10% off' })).toBeTruthy()
    expect(screen.getByText(words.act.duplicated)).toBeTruthy()
  })

  it('waits for the store’s time zone before showing any date, and offers a retry when it can’t be read', async () => {
    let answerPlace: (p: { timeZone: string; country: string }) => void = () => undefined
    api.loadOfferPlace.mockImplementation(() => new Promise((resolve) => (answerPlace = resolve)))
    await show(owner, { entry: '/offers/o1' })
    expect(screen.queryByRole('heading', { level: 1, name: 'Welcome 10% off' })).toBeNull()
    expect(screen.getByText(words.page.loading)).toBeTruthy()
    answerPlace({ timeZone: 'Asia/Kolkata', country: 'IN' })
    await settle()
    expect(screen.getByText('No end date · India Standard Time')).toBeTruthy()
    cleanup()
    api.loadOfferPlace.mockRejectedValueOnce(new Error('down')).mockResolvedValue({ timeZone: 'Asia/Kolkata', country: 'IN' })
    await show(owner, { entry: '/offers/o1' })
    expect(screen.getByText(words.error.title)).toBeTruthy()
    expect(screen.queryByText(/Coordinated Universal Time/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: words.error.retry }))
    await settle()
    expect(screen.getByText('No end date · India Standard Time')).toBeTruthy()
  })

  it('shows a seat without offers.read “not found”, reading nothing and naming no offer', async () => {
    await show(supplier, { entry: '/offers/o1' })
    expect(screen.getByText(words.denied.title)).toBeTruthy()
    expect(screen.getByText(words.denied.body)).toBeTruthy()
    expect(screen.queryByText('Welcome 10% off')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(api.loadOffer).not.toHaveBeenCalled()
    expect(api.loadOfferResults).not.toHaveBeenCalled()
    expect(api.loadCodeBatches).not.toHaveBeenCalled()
    expect(api.loadOfferNames).not.toHaveBeenCalled()
  })

  it('says a code couldn’t be copied where the browser gives no clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    await show(owner, { entry: '/offers/o1' })
    fireEvent.click(screen.getByRole('button', { name: words.menu.copy }))
    await settle()
    expect(screen.getByText(words.copyFailed)).toBeTruthy()
  })

  it('shows an offer that isn’t the store’s as not found, and Staff no actions', async () => {
    await show(owner, { entry: '/offers/nope' })
    expect(screen.getByText(words.page.missing)).toBeTruthy()
    cleanup()
    await show(staff, { entry: '/offers/o1' })
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull()
    expect(screen.getByRole('button', { name: words.menu.copy })).toBeTruthy()
  })

  it('makes single-use codes within the API’s limits and fetches a run’s file', async () => {
    api.generateCodes.mockResolvedValue({ id: 'b2', prefix: 'VIP-', length: 8, count: 200, used: 0, createdAt: '2026-10-10T00:00:00.000Z' })
    api.requestCodesExport.mockResolvedValue('x1')
    api.loadCodesExport.mockResolvedValueOnce({ id: 'x1', state: 'queued', rows: null, csv: null }).mockResolvedValueOnce({ id: 'x1', state: 'done', rows: 500, csv: 'Code\nINSTA-AAAA' })
    URL.createObjectURL = vi.fn(() => 'blob:codes')
    URL.revokeObjectURL = vi.fn()
    await show(owner, { entry: '/offers/o3' })
    expect(screen.getByText('500 codes · 37 used · 463 unused · start with INSTA-')).toBeTruthy()
    const count = screen.getByRole('textbox', { name: words.codes.count })
    fireEvent.change(count, { target: { value: '9000' } })
    fireEvent.click(screen.getByRole('button', { name: words.codes.make }))
    expect(screen.getByText('Make between 1 and 5,000 codes at a time.')).toBeTruthy()
    expect(api.generateCodes).not.toHaveBeenCalled()
    fireEvent.change(count, { target: { value: '200' } })
    fireEvent.change(screen.getByRole('textbox', { name: words.codes.prefix }), { target: { value: 'vip-' } })
    fireEvent.click(screen.getByRole('button', { name: words.codes.make }))
    await settle()
    expect(api.generateCodes).toHaveBeenCalledWith('o3', { count: 200, prefix: 'VIP-', length: 8 })
    expect(screen.getByText('200 codes made.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.codes.makeFile }))
    await settle()
    expect(sessionStorage.getItem('df-offer-codes:b1')).toBe('x1')
    await settle(1600)
    expect(screen.getByRole('link', { name: 'Download 500 codes (CSV)' }).getAttribute('href')).toBe('blob:codes')
    expect(sessionStorage.getItem('df-offer-codes:b1')).toBeNull()
  })

  it('reads more runs a page at a time, so no run is out of reach', async () => {
    const run = (i: number) => ({ id: `b${i}`, prefix: `R${i}-`, length: 8, count: 100, used: 0, createdAt: '2026-10-01T00:00:00.000Z' })
    api.loadCodeBatches.mockImplementation((_: string, after: string | null) => Promise.resolve(after ? { rows: [run(26)], next: null } : { rows: Array.from({ length: 25 }, (_, i) => run(i + 1)), next: 'c25' }))
    await show(owner, { entry: '/offers/o3' })
    expect(screen.queryByText(/start with R26-$/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: words.codes.more }))
    await settle()
    expect(api.loadCodeBatches).toHaveBeenLastCalledWith('o3', 'c25')
    expect(screen.getByText(/start with R1-$/)).toBeTruthy()
    expect(screen.getByText(/start with R26-$/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: words.codes.more })).toBeNull()
  })

  it('never offers a codes file to a seat without offers.export', async () => {
    await show(staff, { entry: '/offers/o3' })
    expect(screen.getByText('500 codes · 37 used · 463 unused · start with INSTA-')).toBeTruthy()
    expect(screen.queryByRole('button', { name: words.codes.makeFile })).toBeNull()
    expect(screen.queryByRole('button', { name: words.codes.make })).toBeNull()
  })
})
