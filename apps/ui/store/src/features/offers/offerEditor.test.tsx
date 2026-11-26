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
const lists = vi.hoisted(() => ({ loadFilters: vi.fn(), loadCollections: vi.fn(), loadCustomerGroups: vi.fn(), createGroup: vi.fn(), loadAllMarkets: vi.fn(), loadProducts: vi.fn(), findCustomers: vi.fn() }))
vi.mock('../../api/filters', async (actual) => ({ ...(await actual<typeof import('../../api/filters')>()), loadFilters: lists.loadFilters }))
vi.mock('../../api/collections', async (actual) => ({ ...(await actual<typeof import('../../api/collections')>()), loadCollections: lists.loadCollections }))
vi.mock('../../api/customers', async (actual) => ({ ...(await actual<typeof import('../../api/customers')>()), loadCustomerGroups: lists.loadCustomerGroups, createGroup: lists.createGroup, findCustomers: lists.findCustomers }))
vi.mock('../../api/markets', async (actual) => ({ ...(await actual<typeof import('../../api/markets')>()), loadAllMarkets: lists.loadAllMarkets }))
vi.mock('../../api/products', async (actual) => ({ ...(await actual<typeof import('../../api/products')>()), loadProducts: lists.loadProducts }))

const { OfferEditor } = await import('./OfferEditor')

const action = (a: Partial<OfferAction> & Pick<OfferAction, 'operation'>): OfferAction => ({ percent: null, amounts: [], cap: [], targets: null, exclude: null, buy: null, get: null, oncePerOrder: false, kind: null, tiers: [], ...a })
const welcome: Offer = {
  id: 'o1',
  name: 'Welcome 10% off',
  internalName: null,
  description: null,
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
// Save stays disabled until the form differs from how it opened (#1661), so a test that saves types a team note first.
const touch = () => fireEvent.change(screen.getByRole('textbox', { name: /^Note for your team/ }), { target: { value: 'checked' } })

beforeEach(() => {
  api.loadOfferFacts.mockResolvedValue({ timeZone: 'Asia/Kolkata', country: 'IN', main: 'INR', others: [], perEuro: {}, hasCustomisation: false })
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
  vi.useRealTimers()
})

// Only the clock's date is frozen, so the quick picks' dates don't depend on the day a test runs (#1663).
const today = (iso: string) => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}
const pill = (name: string) => screen.getByRole('button', { name })
const pressed = () => [words.quick.weekend, words.quick.week, words.quick.month].filter((name) => pill(name).getAttribute('aria-pressed') === 'true')

describe('a new offer', () => {
  it('starts from the type picker, then fills the form from the type chosen', async () => {
    await show(owner, '/offers/new')
    expect(screen.getByRole('heading', { name: words.pickTitle })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Free delivery Free/ }))
    await settle()
    expect(screen.getByRole('radio', { name: /Automatic at checkout/ })).toHaveProperty('checked', true)
    expect((screen.getByRole('textbox', { name: words.name }) as HTMLInputElement).value).toBe('Free delivery')
  })

  it('keeps Save and Save as Off disabled on the form as it opened, for a type and for a recipe, until something changes (#1661)', async () => {
    await show(owner, '/offers/new?type=order')
    expect(saveButton()).toHaveProperty('disabled', true)
    expect(saveButton(words.saveOff)).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByRole('textbox', { name: words.name }), { target: { value: 'Spring sale' } })
    expect(saveButton()).toHaveProperty('disabled', false)
    expect(saveButton(words.saveOff)).toHaveProperty('disabled', false)
    cleanup()
    sessionStorage.clear()
    await show(owner, '/offers/new?recipe=welcome')
    expect(saveButton()).toHaveProperty('disabled', true)
    expect(saveButton(words.saveOff)).toHaveProperty('disabled', true)
  })

  it('shows which quick pick is in effect, one at a time, and none once a date is typed that matches no pick (#1663)', async () => {
    today('2026-11-10T06:00:00Z')
    await show(owner, '/offers/new?type=order')
    expect(pressed()).toEqual([])
    fireEvent.click(pill(words.quick.weekend))
    expect(pressed()).toEqual([words.quick.weekend])
    fireEvent.click(pill(words.quick.month))
    expect(pressed()).toEqual([words.quick.month])
    fireEvent.change(screen.getByLabelText(words.endAt), { target: { value: '2099-01-02T10:00' } })
    expect(pressed()).toEqual([])
  })

  it('shows the pick that was clicked when the 7th day from now is the month’s last, and two picks hold the same dates (#1663)', async () => {
    today('2026-11-23T06:00:00Z')
    await show(owner, '/offers/new?type=order')
    fireEvent.click(pill(words.quick.month))
    expect(pressed()).toEqual([words.quick.month])
    fireEvent.click(pill(words.quick.week))
    expect(pressed()).toEqual([words.quick.week])
  })

  it('asks Start now, Schedule or Keep off, and saves a code offer that combines with nothing (#337)', async () => {
    await show(owner, '/offers/new?recipe=welcome')
    touch()
    fireEvent.click(saveButton())
    expect(within(dialog()).getByText(/10% off the whole order · code WELCOME10 · first order only/)).toBeTruthy()
    fireEvent.click(within(dialog()).getByRole('button', { name: words.ask.confirm }))
    await settle()
    expect(api.saveOffer).toHaveBeenCalledWith(null, null, expect.objectContaining({ enabled: true, startsAt: null, code: 'WELCOME10', combines: { product: false, order: false, shipping: false }, conditions: [{ operation: 'first_order' }], perCustomerLimit: 1 }))
    expect(within(dialog()).getByText('Your code WELCOME10 is live')).toBeTruthy()
  })

  it('keeps an offer off when asked, and won’t schedule one without a start date', async () => {
    await show(owner, '/offers/new?recipe=welcome')
    touch()
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

  describe('Total uses (#1580)', () => {
    const totalSelect = () => within(screen.getByText('Total uses').closest('label') as HTMLElement).getByRole('combobox') as HTMLSelectElement
    const totalBox = () => screen.getByLabelText('Total uses') as HTMLInputElement
    const limitTo = (value: string) => {
      fireEvent.change(totalSelect(), { target: { value: 'n' } })
      fireEvent.change(totalBox(), { target: { value } })
    }
    const saveNow = async () => {
      fireEvent.click(saveButton())
      fireEvent.click(within(dialog()).getByRole('button', { name: words.ask.confirm }))
      await settle()
    }
    const message = 'Enter 1 or more, or choose Unlimited.'

    it('lets the Limit to box be emptied while Limit to stays chosen, and typing gives just the number', async () => {
      await show(owner, '/offers/new?recipe=welcome')
      fireEvent.change(totalSelect(), { target: { value: 'n' } })
      expect(totalBox().value).toBe('100')
      expect(screen.getByText('Stops after 100 uses across your whole store.')).toBeTruthy()
      fireEvent.change(totalBox(), { target: { value: '' } })
      expect(totalBox().value).toBe('')
      expect(totalSelect().value).toBe('n')
      expect(screen.queryByText(/Stops after/)).toBeNull()
      fireEvent.change(totalBox(), { target: { value: '5' } })
      expect(totalBox().value).toBe('5')
      expect(screen.getByText('Stops after 5 uses across your whole store.')).toBeTruthy()
    })

    it.each(['', '0'])('refuses Limit to with %j in the box on Save, with the box’s message', async (typed) => {
      await show(owner, '/offers/new?recipe=welcome')
      limitTo(typed)
      fireEvent.click(saveButton())
      expect(screen.getAllByText(message).length).toBeGreaterThan(0)
      expect(totalBox().getAttribute('aria-invalid')).toBe('true')
      expect(api.saveOffer).not.toHaveBeenCalled()
    })

    it('saves the number typed, and Unlimited removes the limit again', async () => {
      await show(owner, '/offers/new?recipe=welcome')
      limitTo('5')
      await saveNow()
      expect(api.saveOffer).toHaveBeenLastCalledWith(null, null, expect.objectContaining({ totalUsesLimit: 5 }))
      cleanup()
      api.saveOffer.mockClear()
      await show(owner, '/offers/new?recipe=welcome')
      limitTo('5')
      fireEvent.change(totalSelect(), { target: { value: 'none' } })
      expect(screen.queryByLabelText('Total uses')).toBeNull()
      touch()
      await saveNow()
      expect(api.saveOffer).toHaveBeenLastCalledWith(null, null, expect.objectContaining({ totalUsesLimit: null }))
    })

    it('does not warn that a code has no limits once Limit to is chosen, even while its box is empty', async () => {
      await show(owner, '/offers/new?recipe=welcome')
      const perCustomer = within(screen.getByText('Uses per customer').closest('label') as HTMLElement).getByRole('combobox')
      fireEvent.change(perCustomer, { target: { value: '' } })
      expect(screen.getByText(words.warns.openCode)).toBeTruthy()
      fireEvent.change(totalSelect(), { target: { value: 'n' } })
      expect(screen.queryByText(words.warns.openCode)).toBeNull()
      fireEvent.change(totalBox(), { target: { value: '' } })
      expect(screen.queryByText(words.warns.openCode)).toBeNull()
      fireEvent.change(totalSelect(), { target: { value: 'none' } })
      expect(screen.getByText(words.warns.openCode)).toBeTruthy()
    })

    it('shows an existing offer’s limit when it is edited', async () => {
      api.loadOffer.mockResolvedValue({ ...welcome, totalUsesLimit: 250 })
      await show(owner, '/offers/o1/edit')
      expect(totalSelect().value).toBe('n')
      expect(totalBox().value).toBe('250')
    })
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
    fireEvent.change(screen.getByRole('textbox', { name: /^Note for your team/ }), { target: { value: 'n'.repeat(121) } })
    fireEvent.click(saveButton())
    expect(screen.getByText('Fix 3 things to save:')).toBeTruthy()
    expect(screen.getAllByText('Keep the internal note to 120 characters.').length).toBeGreaterThan(0)
    expect(api.saveOffer).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: /^Note for your team/ }), { target: { value: '' } })
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

  it('words money in the warnings as the sentence does, formatted for the currency', async () => {
    await show(owner, '/offers/new?type=order')
    fireEvent.click(screen.getByRole('radio', { name: words.fixed }))
    fireEvent.change(screen.getByRole('textbox', { name: /^Amount/ }), { target: { value: '100' } })
    expect(screen.getByText('₹100.00 off with no minimum means a ₹100.00 product is free. Add a minimum order total.')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /Automatic at checkout/ }))
    expect(screen.getByText('This gives ₹100.00 off every order on your store, starting now.')).toBeTruthy()
  })

  it('stops the product picker at the most one offer can name', async () => {
    const draft = { ...(await import('./offerDraft')).blankDraft('products', null, { facts: { timeZone: 'Asia/Kolkata', country: 'IN', main: 'INR', others: [], perEuro: {}, hasCustomisation: false }, now: new Date(), ship: 'delivery', season: null }), productIds: Array.from({ length: 250 }, (_, i) => `x${i}`) }
    sessionStorage.setItem('df-draft:offer:s1:new', JSON.stringify({ revision: null, draft }))
    await show(owner, '/offers/new?type=products')
    fireEvent.click(screen.getByRole('button', { name: words.chooseProducts }))
    await settle(300)
    expect(within(screen.getByRole('dialog')).getByText('That’s the most one offer can name (250). Remove one to add another.')).toBeTruthy()
    expect(within(screen.getByRole('dialog')).getByRole('checkbox', { name: /Linen kurta/ })).toHaveProperty('disabled', true)
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

  it('says the offer is saved but its single-use codes weren’t made when that second step is refused', async () => {
    api.generateCodes.mockRejectedValue(new ApiError('PLAN_LIMIT', 'no', { key: 'group_offers', limit: null, unlockedBy: { id: 'p', name: 'Growth Pro' } }))
    await show(owner, '/offers/new?type=order')
    fireEvent.click(screen.getByRole('checkbox', { name: words.singleUse }))
    fireEvent.click(saveButton())
    fireEvent.click(within(dialog()).getByRole('button', { name: words.ask.confirm }))
    await settle()
    expect(api.saveOffer).toHaveBeenCalled()
    expect(within(dialog()).getByText(/The single-use codes weren’t made: Your plan doesn’t include this. Growth Pro has more. See plans in Billing. Make them on the offer’s page./)).toBeTruthy()
  })

  it('keeps a refusal in the Save dialog: the live-offer limit, with the plan for the Owner and “ask” for a Manager', async () => {
    const limit = new ApiError('PLAN_LIMIT', 'no', { key: 'live_offers', limit: 3, unlockedBy: { id: 'p', name: 'Growth Pro' } })
    api.saveOffer.mockRejectedValue(limit)
    await show(owner, '/offers/new?recipe=welcome')
    touch()
    fireEvent.click(saveButton())
    fireEvent.click(within(dialog()).getByRole('button', { name: words.ask.confirm }))
    await settle()
    expect(within(dialog()).getByText('Your plan allows 3 live offers. Growth Pro has more. See plans in Billing.')).toBeTruthy()
    cleanup()
    await show(manager, '/offers/new?recipe=welcome')
    touch()
    fireEvent.click(saveButton())
    fireEvent.click(within(dialog()).getByRole('button', { name: words.ask.confirm }))
    await settle()
    expect(within(dialog()).getByText('Your plan allows 3 live offers. Ask your store owner to upgrade.')).toBeTruthy()
  })

  it('drops unsaved work kept from an older revision of the offer', async () => {
    api.loadOffer.mockResolvedValue({ ...welcome, status: 'off', enabled: false })
    await show(owner, '/offers/o1/edit')
    fireEvent.change(screen.getByRole('textbox', { name: words.name }), { target: { value: 'Welcome back' } })
    await settle()
    cleanup()
    api.loadOffer.mockResolvedValue({ ...welcome, status: 'off', enabled: false, revision: 4 })
    await show(owner, '/offers/o1/edit')
    expect(screen.queryByText(words.kept.title)).toBeNull()
    expect((screen.getByRole('textbox', { name: words.name }) as HTMLInputElement).value).toBe('Welcome 10% off')
  })

  it('opens the error with a retry when the store’s zone or currency can’t be read, never a guessed zone', async () => {
    api.loadOfferFacts.mockRejectedValueOnce(new Error('no store info'))
    await show(owner, '/offers/new?recipe=welcome')
    expect(screen.getByText(messages.offers.error.title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: messages.offers.error.retry }))
    await settle()
    expect((screen.getByRole('textbox', { name: words.name }) as HTMLInputElement).value).toBe('Welcome 10% off')
  })

  it('drops unsaved work kept by an older form, rather than opening it broken', async () => {
    sessionStorage.setItem('df-draft:offer:s1:new', JSON.stringify({ revision: null, draft: { type: 'order', name: 'Old shape' } }))
    await show(owner, '/offers/new?recipe=welcome')
    expect(screen.queryByText(words.kept.title)).toBeNull()
    expect((screen.getByRole('textbox', { name: words.name }) as HTMLInputElement).value).toBe('Welcome 10% off')
    expect(sessionStorage.getItem('df-draft:offer:s1:new')).toBeNull()
  })

  it('shows the error with a retry when a list the form needs can’t be read, never an empty choice', async () => {
    lists.loadCustomerGroups.mockRejectedValueOnce(new Error('down'))
    await show(owner, '/offers/new?recipe=vip')
    expect(screen.getByText(messages.offers.error.title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: messages.offers.error.retry }))
    await settle()
    expect(screen.getByRole('button', { name: 'VIP · 12' })).toBeTruthy()
  })

  it('shows the error with a retry when the names of what an offer names can’t be read, never unnamed chips', async () => {
    api.loadOffer.mockResolvedValue({ ...welcome, action: action({ operation: 'products_percentage_discount', percent: 10, targets: { productIds: ['p1'], collectionIds: [], filterValueIds: [] } }) })
    api.loadProductNames.mockRejectedValueOnce(new Error('down')).mockResolvedValue(new Map([['p1', 'Linen kurta']]))
    await show(owner, '/offers/o1/edit')
    expect(screen.getByText(messages.offers.error.title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: messages.offers.error.retry }))
    await settle()
    expect(screen.getByText('Linen kurta')).toBeTruthy()
  })

  it('shows a chosen product that’s gone, and won’t save until it’s removed', async () => {
    api.loadOffer.mockResolvedValue({ ...welcome, status: 'off', enabled: false, action: action({ operation: 'products_percentage_discount', percent: 10, targets: { productIds: ['p1', 'p2'], collectionIds: [], filterValueIds: [] } }) })
    api.loadProductNames.mockResolvedValue(new Map([['p1', 'Linen kurta']]))
    await show(owner, '/offers/o1/edit')
    expect(screen.getByText(words.gone)).toBeTruthy()
    touch()
    fireEvent.click(saveButton(words.saveChanges))
    expect(screen.getAllByText(words.errors.gone).length).toBeGreaterThan(0)
    expect(api.saveOffer).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: `Remove ${words.gone}` }))
    expect(screen.queryByText(words.errors.gone)).toBeNull()
    expect(screen.getByText('Linen kurta')).toBeTruthy()
  })

  it('names a taken code’s holder without guessing a state it didn’t give', async () => {
    api.saveOffer.mockRejectedValueOnce(new ApiError('CODE_TAKEN', 'taken', { offerId: 'o5', name: 'Summer 2025', status: 'archived' }))
    await show(owner, '/offers/new?recipe=welcome')
    touch()
    fireEvent.click(saveButton())
    fireEvent.click(within(dialog()).getByRole('button', { name: words.ask.confirm }))
    await settle()
    expect(screen.getAllByText('WELCOME10 is already used by “Summer 2025”. Pick another.').length).toBeGreaterThan(0)
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

  it('never offers one store’s unsaved work in another store in the same tab', async () => {
    await show(owner, '/offers/new?recipe=welcome')
    fireEvent.change(screen.getByRole('textbox', { name: words.name }), { target: { value: 'Welcome gift' } })
    await settle()
    cleanup()
    await show({ ...owner, store: { id: 's2', name: 'Aurelia Home' } }, '/offers/new?recipe=welcome')
    expect(screen.queryByText(words.kept.title)).toBeNull()
    expect((screen.getByRole('textbox', { name: words.name }) as HTMLInputElement).value).toBe('Welcome 10% off')
  })
})

describe('a new customer group in the offer editor', () => {
  const openGroups = async () => {
    await show(owner, '/offers/new?type=order')
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(`^${words.who.groups.title}`) }))
  }
  const box = () => screen.getByRole('textbox', { name: words.newGroupLabel })

  it('says a name is needed, marks the box and creates nothing, for an empty or spaces-only name (#1699)', async () => {
    await openGroups()
    for (const typed of ['', '   ']) {
      fireEvent.change(box(), { target: { value: typed } })
      fireEvent.click(screen.getByRole('button', { name: words.createGroup }))
      await settle()
      expect(screen.getByRole('alert').textContent).toBe(words.groupNameNeeded)
      expect(box().getAttribute('aria-invalid')).toBe('true')
      expect(lists.createGroup).not.toHaveBeenCalled()
    }
  })

  it('clears the message when the merchant types, and still creates a valid name (#1699)', async () => {
    lists.createGroup.mockResolvedValue('g2')
    await openGroups()
    fireEvent.click(screen.getByRole('button', { name: words.createGroup }))
    expect(screen.getByRole('alert').textContent).toBe(words.groupNameNeeded)
    fireEvent.change(box(), { target: { value: 'Wholesale' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(box().getAttribute('aria-invalid')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: words.createGroup }))
    await settle()
    expect(lists.createGroup).toHaveBeenCalledWith('Wholesale')
    expect(screen.getByText(/Group “Wholesale” created/)).toBeTruthy()
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

  it('keeps Save changes disabled until something differs from the offer as it opened, and again once it is put back (#1661)', async () => {
    api.loadOffer.mockResolvedValue({ ...welcome, status: 'off', enabled: false })
    await show(owner, '/offers/o1/edit')
    expect(saveButton(words.saveChanges)).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByRole('textbox', { name: words.name }), { target: { value: 'Welcome back' } })
    expect(saveButton(words.saveChanges)).toHaveProperty('disabled', false)
    fireEvent.change(screen.getByRole('textbox', { name: words.name }), { target: { value: 'Welcome 10% off' } })
    expect(saveButton(words.saveChanges)).toHaveProperty('disabled', true)
  })

  it('never saves a live offer that hasn’t changed, so shoppers aren’t told of a new version (#1661)', async () => {
    await show(owner, '/offers/o1/edit')
    expect(saveButton(words.saveChanges)).toHaveProperty('disabled', true)
    fireEvent.click(saveButton(words.saveChanges))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.saveOffer).not.toHaveBeenCalled()
  })

  it('opens an offer that ends at the end of the month with that quick pick shown (#1663)', async () => {
    today('2026-11-10T06:00:00Z')
    api.loadOffer.mockResolvedValue({ ...welcome, status: 'off', enabled: false, endsAt: '2026-11-30T18:29:00.000Z' })
    await show(owner, '/offers/o1/edit')
    expect(pressed()).toEqual([words.quick.month])
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
