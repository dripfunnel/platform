// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Offer, OfferAction } from '../../api/offers'
import type { Acting } from '../../api/shell'
import { messages } from '../../messages'

// The offer editor driven as the Owner, a Manager, Staff and a supplier would (FIRST-RELEASE §8, OfferEditor): Save asks
// Start now / Schedule / Keep off, a new offer combines with nothing, and each refusal lands where it was asked.

const words = messages.offers.editor

const api = vi.hoisted(() => ({ loadOffer: vi.fn(), loadOfferFacts: vi.fn(), loadProductNames: vi.fn(), loadCustomerNames: vi.fn(), saveOffer: vi.fn(), generateCodes: vi.fn() }))
vi.mock('../../api/offers', async (actual) => ({ ...(await actual<typeof import('../../api/offers')>()), ...api }))
const lists = vi.hoisted(() => ({ loadFilters: vi.fn(), loadCollections: vi.fn(), loadCustomerGroups: vi.fn(), createGroup: vi.fn(), loadAllMarkets: vi.fn(), loadProducts: vi.fn(), loadCustomers: vi.fn() }))
vi.mock('../../api/filters', async (actual) => ({ ...(await actual<typeof import('../../api/filters')>()), loadFilters: lists.loadFilters }))
vi.mock('../../api/collections', async (actual) => ({ ...(await actual<typeof import('../../api/collections')>()), loadCollections: lists.loadCollections }))
vi.mock('../../api/customers', async (actual) => ({ ...(await actual<typeof import('../../api/customers')>()), loadCustomerGroups: lists.loadCustomerGroups, createGroup: lists.createGroup, loadCustomers: lists.loadCustomers }))
vi.mock('../../api/markets', async (actual) => ({ ...(await actual<typeof import('../../api/markets')>()), loadAllMarkets: lists.loadAllMarkets }))
vi.mock('../../api/products', async (actual) => ({ ...(await actual<typeof import('../../api/products')>()), loadProducts: lists.loadProducts }))

const { OfferEditor } = await import('./OfferEditor')

const action = (a: Partial<OfferAction> & Pick<OfferAction, 'operation'>): OfferAction => ({ percent: null, amounts: [], cap: [], targets: null, exclude: null, buy: null, get: null, oncePerOrder: false, kind: null, tiers: [], ...a })
const welcome: Offer = {
  id: 'o1',
  name: 'Welcome 10% off',
  internalName: null,
  trigger: 'code',
  code: 'WELCOME10',
  status: 'live',
  enabled: true,
  startsAt: null,
  endsAt: null,
  totalUsesLimit: null,
  perCustomerLimit: 1,
  usesCount: 3,
  combines: { product: false, order: false, shipping: false },
  conditions: [],
  action: action({ operation: 'order_percentage_discount', percent: 10 }),
  revision: 3,
}
const owner: Acting = { store: { id: 's1', name: 'Kesari Threads' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['offers.read', 'offers.write', 'offers.export', 'billing'] }
const manager: Acting = { ...owner, role: 'manager', permissions: ['offers.read', 'offers.write', 'offers.export'] }
const staff: Acting = { ...owner, role: 'staff', permissions: ['offers.read'] }
const supplier: Acting = { ...owner, role: 'supplier-member', tier: 'vendor-catalogue', seller: { id: 'v1', name: 'Northwind' }, permissions: ['catalog.read'] }

const show = async (acting: Acting, entry: string, { readOnly = false } = {}) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const list = createRoute({ getParentRoute: () => app, path: '/offers', component: () => <p>the list</p> })
  const create = createRoute({ getParentRoute: () => app, path: '/offers/new', validateSearch: z.looseObject({}), component: OfferEditor })
  const one = createRoute({ getParentRoute: () => app, path: '/offers/$offerId', component: () => <p>the offer</p> })
  const edit = createRoute({ getParentRoute: () => app, path: '/offers/$offerId/edit', component: OfferEditor })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([list, create, one, edit])]), history: createMemoryHistory({ initialEntries: [entry] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  return router
}
const settle = (ms = 0) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)))
const saveButton = (name: RegExp | string = /^Save$/) => screen.getByRole('button', { name })
const dialog = () => screen.getByRole('dialog')

beforeEach(() => {
  api.loadOfferFacts.mockResolvedValue({ timeZone: 'Asia/Kolkata', country: 'IN', main: 'INR', others: [], perEuro: {} })
  api.loadOffer.mockResolvedValue(welcome)
  api.loadProductNames.mockResolvedValue(new Map())
  api.loadCustomerNames.mockResolvedValue(new Map())
  api.saveOffer.mockResolvedValue({ id: 'o9', revision: 1 })
  lists.loadFilters.mockResolvedValue([])
  lists.loadCollections.mockResolvedValue([])
  lists.loadCustomerGroups.mockResolvedValue([{ id: 'g1', name: 'VIP', description: null, members: 12 }])
  lists.loadAllMarkets.mockResolvedValue([])
  lists.loadProducts.mockResolvedValue({ rows: [{ id: 'p1', name: 'Linen kurta', versionCount: 3, minPrice: { amount: '149900', currency: 'INR' } }], next: null, previous: null })
  window.confirm = vi.fn(() => true)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  sessionStorage.clear()
})

describe('a new offer', () => {
  it('starts from the type picker, then fills the form from the type chosen', async () => {
    await show(owner, '/offers/new')
    expect(screen.getByRole('heading', { name: words.pickTitle })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Free delivery Free/ }))
    await settle()
    expect(screen.getByRole('radio', { name: /Automatic at checkout/ })).toHaveProperty('checked', true)
    expect((screen.getByRole('textbox', { name: words.name }) as HTMLInputElement).value).toBe('Free delivery')
  })

  it('asks Start now, Schedule or Keep off, and saves a code offer that combines with nothing (#337)', async () => {
    await show(owner, '/offers/new?recipe=welcome')
    fireEvent.click(saveButton())
    expect(within(dialog()).getByText(/10% off the whole order · code WELCOME10 · first order only/)).toBeTruthy()
    fireEvent.click(within(dialog()).getByRole('button', { name: words.ask.confirm }))
    await settle()
    expect(api.saveOffer).toHaveBeenCalledWith(null, null, expect.objectContaining({ enabled: true, startsAt: null, code: 'WELCOME10', combines: { product: false, order: false, shipping: false }, conditions: [{ operation: 'first_order' }], perCustomerLimit: 1 }))
    expect(within(dialog()).getByText('Your code WELCOME10 is live')).toBeTruthy()
  })

  it('keeps an offer off when asked, and won’t schedule one without a start date', async () => {
    await show(owner, '/offers/new?recipe=welcome')
    fireEvent.click(saveButton())
    const when = within(dialog()).getByRole('combobox')
    fireEvent.change(when, { target: { value: 'schedule' } })
    expect(within(dialog()).getByText(words.ask.needsDate)).toBeTruthy()
    fireEvent.change(when, { target: { value: 'off' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: words.ask.confirm }))
    await settle()
    expect(api.saveOffer).toHaveBeenCalledWith(null, null, expect.objectContaining({ enabled: false }))
    expect(within(dialog()).getByText(words.done.off)).toBeTruthy()
  })

  it('schedules an offer with a start date ahead, in the store’s time zone', async () => {
    await show(owner, '/offers/new?recipe=welcome')
    fireEvent.change(screen.getAllByRole('combobox').find((c) => (c as HTMLSelectElement).value === 'now') as HTMLElement, { target: { value: 'date' } })
    fireEvent.change(screen.getByLabelText(words.startAt), { target: { value: '2099-11-27T09:00' } })
    expect(saveButton(words.schedule)).toBeTruthy()
    fireEvent.click(saveButton(words.schedule))
    fireEvent.click(within(dialog()).getByRole('button', { name: words.ask.confirm }))
    await settle()
    expect(api.saveOffer).toHaveBeenCalledWith(null, null, expect.objectContaining({ enabled: true, startsAt: '2099-11-27T03:30:00.000Z' }))
  })

  it('says what is missing instead of saving, and a taken code where the code is typed', async () => {
    await show(owner, '/offers/new?type=products')
    fireEvent.click(saveButton())
    expect(screen.getByText('Fix 2 things to save:')).toBeTruthy()
    expect(api.saveOffer).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: words.chooseProducts }))
    await settle(300)
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: /Linen kurta/ }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Done · 1 chosen' }))
    fireEvent.change(screen.getByRole('textbox', { name: words.codeLabel }), { target: { value: 'summer20' } })
    api.saveOffer.mockRejectedValueOnce(new ApiError('CODE_TAKEN', 'taken', { offerId: 'o5', name: 'Summer 2025', status: 'ended' }))
    fireEvent.click(saveButton())
    fireEvent.click(within(dialog()).getByRole('button', { name: words.ask.confirm }))
    await settle()
    expect(api.saveOffer).toHaveBeenCalledWith(null, null, expect.objectContaining({ code: 'SUMMER20', action: expect.objectContaining({ targets: expect.objectContaining({ productIds: ['p1'] }) }) }))
    expect(screen.getAllByText('SUMMER20 was used by “Summer 2025”, which has ended. Codes can’t be reused, even after an offer ends.').length).toBeGreaterThan(0)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('makes the single-use codes after saving, and names the plan when the API refuses', async () => {
    api.generateCodes.mockResolvedValue({ id: 'b1', prefix: 'INSTA-', length: 8, count: 200, used: 0, createdAt: '' })
    await show(owner, '/offers/new?type=order')
    fireEvent.click(screen.getByRole('checkbox', { name: words.singleUse }))
    fireEvent.change(screen.getByRole('textbox', { name: words.batchCount }), { target: { value: '200' } })
    fireEvent.change(screen.getByRole('textbox', { name: words.batchPrefix }), { target: { value: 'insta-' } })
    fireEvent.click(saveButton())
    fireEvent.click(within(dialog()).getByRole('button', { name: words.ask.confirm }))
    await settle()
    expect(api.saveOffer).toHaveBeenCalledWith(null, null, expect.objectContaining({ trigger: 'code', code: null }))
    expect(api.generateCodes).toHaveBeenCalledWith('o9', { count: 200, prefix: 'INSTA-', length: 8 })
    expect(within(dialog()).getByText(/200 single-use codes are made/)).toBeTruthy()
  })

  it('keeps a refusal in the Save dialog: the live-offer limit, with the plan for the Owner and “ask” for a Manager', async () => {
    const limit = new ApiError('PLAN_LIMIT', 'no', { key: 'live_offers', limit: 3, unlockedBy: { id: 'p', name: 'Growth Pro' } })
    api.saveOffer.mockRejectedValue(limit)
    await show(owner, '/offers/new?recipe=welcome')
    fireEvent.click(saveButton())
    fireEvent.click(within(dialog()).getByRole('button', { name: words.ask.confirm }))
    await settle()
    expect(within(dialog()).getByText('Your plan allows 3 live offers. Growth Pro has more. See plans in Billing.')).toBeTruthy()
    cleanup()
    await show(manager, '/offers/new?recipe=welcome')
    fireEvent.click(saveButton())
    fireEvent.click(within(dialog()).getByRole('button', { name: words.ask.confirm }))
    await settle()
    expect(within(dialog()).getByText('Your plan allows 3 live offers. Ask your store owner to upgrade.')).toBeTruthy()
  })

  it('brings unsaved work back after a reload, and lets the merchant discard it', async () => {
    await show(owner, '/offers/new?recipe=welcome')
    fireEvent.change(screen.getByRole('textbox', { name: words.name }), { target: { value: 'Welcome gift' } })
    await settle()
    cleanup()
    await show(owner, '/offers/new?recipe=welcome')
    expect(screen.getByText(words.kept.title)).toBeTruthy()
    expect((screen.getByRole('textbox', { name: words.name }) as HTMLInputElement).value).toBe('Welcome gift')
    fireEvent.click(screen.getByRole('button', { name: words.kept.discard }))
    expect((screen.getByRole('textbox', { name: words.name }) as HTMLInputElement).value).toBe('Welcome 10% off')
  })
})

describe('editing an offer', () => {
  it('confirms a change to a live offer, says the old code stops working, and saves at the revision read', async () => {
    await show(owner, '/offers/o1/edit')
    expect(screen.getByText(words.bar.live)).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: words.codeLabel }), { target: { value: 'HELLO10' } })
    expect(screen.getByText('Shoppers who already have WELCOME10 won’t be able to use it once you save.')).toBeTruthy()
    fireEvent.click(saveButton(words.saveChanges))
    expect(within(dialog()).getByText(/The old code WELCOME10 stops working/)).toBeTruthy()
    fireEvent.click(within(dialog()).getByRole('button', { name: words.live.confirm }))
    await settle()
    expect(api.saveOffer).toHaveBeenCalledWith('o1', 3, expect.objectContaining({ enabled: true, code: 'HELLO10' }))
  })

  it('says when someone else saved first, and saves over them only when asked', async () => {
    api.loadOffer.mockResolvedValue({ ...welcome, status: 'off', enabled: false })
    api.saveOffer.mockRejectedValueOnce(new ApiError('STALE_REVISION', 'stale', { revision: 5 }))
    await show(owner, '/offers/o1/edit')
    fireEvent.change(screen.getByRole('textbox', { name: words.name }), { target: { value: 'Welcome back' } })
    fireEvent.click(saveButton(words.saveChanges))
    await settle()
    expect(screen.getByText(words.stale.title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.stale.keep }))
    fireEvent.click(saveButton(words.saveChanges))
    await settle()
    expect(api.saveOffer).toHaveBeenLastCalledWith('o1', 5, expect.objectContaining({ name: 'Welcome back', enabled: false }))
  })

  it('shows Staff they can’t edit, a supplier “not found”, and a view-only store no Save', async () => {
    await show(staff, '/offers/o1/edit')
    expect(screen.getByText(words.staff.title)).toBeTruthy()
    expect(api.loadOffer).not.toHaveBeenCalled()
    cleanup()
    await show(supplier, '/offers/o1/edit')
    expect(screen.getByText(messages.offers.denied.title)).toBeTruthy()
    cleanup()
    await show(owner, '/offers/o1/edit', { readOnly: true })
    expect(screen.getByText(words.readOnly.body)).toBeTruthy()
    expect(screen.queryByRole('button', { name: words.saveChanges })).toBeNull()
  })

  it('shows an offer that isn’t there as not found', async () => {
    api.loadOffer.mockResolvedValue(null)
    await show(owner, '/offers/nope/edit')
    expect(screen.getByText(words.missing)).toBeTruthy()
  })
})
