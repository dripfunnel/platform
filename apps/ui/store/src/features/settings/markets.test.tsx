// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { optionalParam } from '@dripfunnel/shared/search'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Market } from '../../api/markets'
import type { StoreLocale } from '../../api/settings'
import type { Acting } from '../../api/shell'
import { fill, messages } from '../../messages'

// Settings › Markets driven as the Owner would (SetMarkets).

const w = messages.settings.markets

const api = vi.hoisted(() => ({ loadAllMarkets: vi.fn(), saveMarket: vi.fn(), deleteMarket: vi.fn(), setEverywhereElse: vi.fn() }))
vi.mock('../../api/markets', () => api)
const settings = vi.hoisted(() => ({ loadStoreInfo: vi.fn(), loadLocale: vi.fn() }))
vi.mock('../../api/settings', () => settings)
const products = vi.hoisted(() => ({ loadProducts: vi.fn() }))
vi.mock('../../api/products', async (actual) => ({ ...(await actual<typeof import('../../api/products')>()), ...products }))

const { SettingsPage } = await import('./SettingsPage')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['catalog.read', 'settings'] }

const market = (m: Partial<Market> & Pick<Market, 'id' | 'name' | 'countries' | 'currency'>): Market => ({
  parentId: null,
  primary: false,
  everywhereElse: false,
  active: true,
  language: 'en-IN',
  priceAdjustmentBps: 0,
  webMode: 'main',
  pathPrefix: null,
  products: 'all',
  excludedProductIds: [],
  excludedProducts: [],
  duties: { mode: 'none', rateBps: null, thresholdAmount: null },
  revision: 1,
  ...m,
})
const india = market({ id: 'in', name: 'India', countries: ['IN'], currency: 'INR', primary: true })
const us = market({ id: 'us', name: 'United States', countries: ['US'], currency: 'USD', language: 'en-US', priceAdjustmentBps: 1000, everywhereElse: true, revision: 3 })
const gulf = market({ id: 'ae', name: 'UAE', countries: ['AE'], currency: 'AED', active: false })
const loc: StoreLocale = {
  pricingCurrency: 'INR',
  mainLanguage: 'en-IN',
  offeredLanguages: ['en-IN', 'en-US', 'hi-IN'],
  currencies: [
    { code: 'USD', mode: 'convert', rounding: 'ends-99', status: 'active' },
    { code: 'AED', mode: 'manual', rounding: 'none', status: 'active' },
  ],
  languages: [
    { code: 'en-IN', status: 'active' },
    { code: 'en-US', status: 'active' },
  ],
  rates: [],
  examples: [],
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const dialog = () => within(document.querySelector('dialog') as HTMLElement)

const show = async (readOnly = false) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting: owner, state: { readOnly } }), component: Outlet })
  const page = createRoute({ getParentRoute: () => app, path: '/settings', validateSearch: z.looseObject({ tab: optionalParam(z.enum(['store', 'people', 'supplier', 'warehouse', 'tax', 'markets'])) }), component: SettingsPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page])]), history: createMemoryHistory({ initialEntries: ['/settings?tab=markets'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  await settle()
}

const list = () => within(screen.getByRole('list', { name: w.title }))
const open = (name: string) => fireEvent.click(list().getByRole('button', { name: new RegExp(`^${name}`) }))
const save = () => fireEvent.click(screen.getByRole('button', { name: w.save }))

beforeEach(() => {
  api.loadAllMarkets.mockResolvedValue([india, us, gulf])
  settings.loadLocale.mockResolvedValue(loc)
  api.saveMarket.mockImplementation(async (id: string | null, revision: number | null, input: Record<string, unknown>) => market({ ...(input as Partial<Market>), id: id ?? 'new', revision: (revision ?? 0) + 1, name: String(input['name']), countries: input['countries'] as string[], currency: String(input['currency']), excludedProducts: [] }))
  api.setEverywhereElse.mockResolvedValue(undefined)
  api.deleteMarket.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('markets', () => {
  it('say when they didn’t load, and read them again on retry', async () => {
    api.loadAllMarkets.mockRejectedValueOnce(new Error('offline'))
    await show()
    expect(screen.getByText(messages.settings.error.title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: messages.settings.error.retry }))
    await settle()
    expect(list().getByText('India · INR')).toBeTruthy()
  })

  it('let a read-only store look without changing anything', async () => {
    await show(true)
    expect(screen.queryByRole('button', { name: w.add })).toBeNull()
    expect(screen.queryByRole('button', { name: w.save })).toBeNull()
    expect(screen.queryByRole('button', { name: w.delete })).toBeNull()
    expect((screen.getByLabelText(w.elseTitle) as HTMLSelectElement).disabled).toBe(true)
    expect(within(screen.getByRole('group', { name: w.countries })).getAllByRole('button').every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
    expect((screen.getByLabelText(w.name) as HTMLInputElement).readOnly).toBe(true)
    expect(screen.queryByRole('combobox', { name: w.anotherCountry })).toBeNull()
    expect(screen.queryByRole('searchbox', { name: w.findProduct })).toBeNull()
  })

  it('keep a market’s unsaved edits when the “Everywhere else” choice is refused as stale', async () => {
    await show()
    open('United States')
    fireEvent.change(screen.getByLabelText(w.name), { target: { value: 'America' } })
    api.setEverywhereElse.mockRejectedValueOnce(new ApiError('STALE_REVISION', 'stale'))
    fireEvent.change(screen.getByLabelText(w.elseTitle), { target: { value: 'ae' } })
    await settle()
    expect(api.loadAllMarkets.mock.calls.length).toBeGreaterThan(1)
    expect((screen.getByLabelText(w.name) as HTMLInputElement).value).toBe('America')
  })

  it('keep a new market’s draft when its save is refused because something it named went meanwhile', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: w.add }))
    fireEvent.change(dialog().getByLabelText(w.name), { target: { value: 'Europe' } })
    fireEvent.click(dialog().getByRole('button', { name: w.create }))
    fireEvent.click(within(screen.getByRole('group', { name: w.countries })).getByRole('button', { name: /Germany/ }))
    api.saveMarket.mockRejectedValueOnce(new ApiError('NOT_FOUND', 'gone'))
    save()
    await settle()
    expect((screen.getByLabelText(w.name) as HTMLInputElement).value).toBe('Europe')
    expect(within(screen.getByRole('group', { name: w.countries })).getByRole('button', { name: /Germany/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('alert').textContent).toBe(fill(w.reread, { refusal: w.refused.NOT_FOUND }))
  })

  it('offer the primary market no delete, and never switch it off', async () => {
    await show()
    open('India')
    expect(screen.queryByRole('button', { name: w.delete })).toBeNull()
    const selling = screen.getByRole('switch', { name: new RegExp(w.selling) }) as HTMLButtonElement
    expect([selling.getAttribute('aria-checked'), selling.disabled]).toEqual(['true', true])
  })

  it('read the markets again after a save from an old read, so the next save is at what’s stored', async () => {
    await show()
    api.saveMarket.mockRejectedValueOnce(new ApiError('STALE_REVISION', 'stale'))
    api.loadAllMarkets.mockResolvedValueOnce([india, { ...us, name: 'USA', revision: 4 }, gulf])
    open('United States')
    fireEvent.change(screen.getByLabelText(w.name), { target: { value: 'America' } })
    save()
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(fill(w.reread, { refusal: w.refused.STALE_REVISION }))
    // Their change is what the form shows now; saving again goes at their revision.
    expect((screen.getByLabelText(w.name) as HTMLInputElement).value).toBe('USA')
    fireEvent.change(screen.getByLabelText(w.name), { target: { value: 'USA and territories' } })
    save()
    await settle()
    expect(api.saveMarket).toHaveBeenLastCalledWith('us', 4, expect.objectContaining({ name: 'USA and territories' }))
  })

  it('show a left-out product deleted since, saying the save drops it, and save the rest', async () => {
    api.loadAllMarkets.mockResolvedValue([india, { ...us, products: 'some', excludedProductIds: ['p1', 'p9'], excludedProducts: [{ id: 'p1', name: 'Silk scarf' }] }, gulf])
    await show()
    open('United States')
    expect(screen.getByRole('button', { name: fill(w.sellAgain, { name: w.deletedProduct }) })).toBeTruthy()
    fireEvent.change(screen.getByLabelText(w.name), { target: { value: 'United States and Canada' } })
    save()
    await settle()
    // The API refuses an id it can't find, so the deleted one is dropped, as the screen said it would be.
    expect(api.saveMarket).toHaveBeenLastCalledWith('us', 3, expect.objectContaining({ excludedProductIds: ['p1'] }))
  })

  it('list each with its countries, currency and state, open the primary, and say what a shopper there sees', async () => {
    await show()
    expect(list().getByText('India · INR')).toBeTruthy()
    expect(list().getByText(w.primary)).toBeTruthy()
    expect(list().getByText(w.off)).toBeTruthy()
    expect((screen.getByLabelText(w.name) as HTMLInputElement).value).toBe('India')
    expect(screen.getByRole('switch', { name: w.selling }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/A shopper in India sees INR, .*at your shop’s main address/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: w.delete })).toBeNull()
  })

  it('save a change at the revision read, a country in another market can’t be picked, and the list shows what’s stored', async () => {
    await show()
    open('United States')
    expect((screen.getByRole('button', { name: /India · in India/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Canada' }))
    fireEvent.change(screen.getByLabelText(w.adjust), { target: { value: '15' } })
    fireEvent.change(screen.getByLabelText(w.web), { target: { value: 'path' } })
    fireEvent.change(screen.getByLabelText(w.path), { target: { value: 'na' } })
    fireEvent.change(screen.getByLabelText(w.name), { target: { value: 'North America' } })
    save()
    await settle()
    expect(api.saveMarket).toHaveBeenCalledWith('us', 3, expect.objectContaining({ name: 'North America', countries: ['US', 'CA'], priceAdjustmentBps: 1500, webMode: 'path', pathPrefix: 'na', currency: 'USD', language: 'en-US' }))
    expect(list().getByText('North America')).toBeTruthy()
    expect(screen.getByText('North America saved — shoppers there see it within a minute')).toBeTruthy()
  })

  it('start a new one by name, refuse to save it without a country, and add it to the list once saved', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: w.add }))
    fireEvent.change(dialog().getByLabelText(w.name), { target: { value: 'Europe' } })
    fireEvent.click(dialog().getByRole('button', { name: w.create }))
    // Nothing exists until it's saved, so nothing says it was made.
    expect(screen.queryByText(fill(w.created, { name: 'Europe' }))).toBeNull()
    save()
    expect(api.saveMarket).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe(w.problems.countries)
    fireEvent.click(screen.getByRole('button', { name: 'Germany' }))
    fireEvent.click(screen.getByRole('button', { name: 'France' }))
    fireEvent.change(screen.getByLabelText(w.currency), { target: { value: 'USD' } })
    save()
    await settle()
    expect(api.saveMarket).toHaveBeenCalledWith(null, null, expect.objectContaining({ name: 'Europe', countries: ['DE', 'FR'], currency: 'USD', active: true }))
    expect(list().getByText('Europe')).toBeTruthy()
    expect(screen.getByText(fill(w.created, { name: 'Europe' }))).toBeTruthy()
  })

  it('ask before a new market replaces unsaved changes', async () => {
    await show()
    fireEvent.change(screen.getByLabelText(w.name), { target: { value: 'India and Nepal' } })
    fireEvent.click(screen.getByRole('button', { name: w.add }))
    expect(dialog().getByText(w.leaveBody)).toBeTruthy()
    fireEvent.click(dialog().getByRole('button', { name: w.cancel }))
    expect((screen.getByLabelText(w.name) as HTMLInputElement).value).toBe('India and Nepal')
    fireEvent.click(screen.getByRole('button', { name: w.add }))
    fireEvent.click(dialog().getByRole('button', { name: w.discard }))
    expect(dialog().getByLabelText(w.name)).toBeTruthy()
  })

  it('collect duties as a flat rate above a threshold in the market’s currency, and leave some products out', async () => {
    products.loadProducts.mockResolvedValue({ rows: [{ id: 'p1', name: 'Mara Linen Shirt' }], next: null, previous: null })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await show()
    open('United States')
    fireEvent.click(screen.getByRole('switch', { name: new RegExp(w.duties) }))
    fireEvent.change(screen.getByLabelText(w.dutyMode), { target: { value: 'flat' } })
    save()
    expect(screen.getByRole('alert').textContent).toBe(w.problems.dutyRate)
    fireEvent.change(screen.getByLabelText(w.dutyRate), { target: { value: '12.5' } })
    fireEvent.change(screen.getByLabelText('Don’t charge below (USD)'), { target: { value: '800' } })
    fireEvent.click(screen.getByRole('radio', { name: w.allExcept }))
    fireEvent.change(screen.getByLabelText(w.findProduct), { target: { value: 'mara' } })
    await act(async () => vi.advanceTimersByTimeAsync(350))
    vi.useRealTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Mara Linen Shirt' }))
    expect(screen.getByRole('button', { name: 'Sell Mara Linen Shirt here again' })).toBeTruthy()
    save()
    await settle()
    expect(api.saveMarket).toHaveBeenCalledWith('us', 3, expect.objectContaining({ dutiesMode: 'flat', dutiesRateBps: 1250, dutiesThresholdAmount: '80000', products: 'some', excludedProductIds: ['p1'] }))
  })

  it('copy a parent’s currency and language, offer only its countries, ask before leaving unsaved changes, and say why a save was refused', async () => {
    api.saveMarket.mockRejectedValueOnce(new ApiError('DUPLICATE_NAME', 'name'))
    await show()
    open('UAE')
    fireEvent.change(screen.getByLabelText(w.parent), { target: { value: 'us' } })
    expect((screen.getByLabelText(w.currency) as HTMLSelectElement).value).toBe('USD')
    expect((screen.getByLabelText(w.language) as HTMLSelectElement).value).toBe('en-US')
    // UAE isn't one of the United States' countries: marked, and said before anything is sent.
    const countries = () => within(screen.getByRole('group', { name: w.countries }))
    expect(countries().getByRole('button', { name: /United Arab Emirates/ }).getAttribute('aria-invalid')).toBe('true')
    expect(within(screen.getByRole('combobox', { name: w.anotherCountry })).queryByRole('option', { name: 'India' })).toBeNull()
    save()
    expect(api.saveMarket).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe(w.problems.parentCountries)
    fireEvent.click(countries().getByRole('button', { name: /United Arab Emirates/ }))
    fireEvent.click(countries().getByRole('button', { name: /United States/ }))
    save()
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(w.refused.DUPLICATE_NAME)
    open('India')
    expect(dialog().getByText(w.leaveBody)).toBeTruthy()
    fireEvent.click(dialog().getByRole('button', { name: w.discard }))
    expect((screen.getByLabelText(w.name) as HTMLInputElement).value).toBe('India')
  })

  it('set where everyone else goes, and delete a market saying who it leaves', async () => {
    await show()
    fireEvent.change(screen.getByLabelText(w.elseTitle), { target: { value: '' } })
    await settle()
    expect(api.setEverywhereElse).toHaveBeenCalledWith(null)
    open('UAE')
    fireEvent.click(screen.getByRole('button', { name: w.delete }))
    expect(dialog().getByText(/Shoppers in United Arab Emirates get your “Everywhere else” settings instead/)).toBeTruthy()
    fireEvent.click(dialog().getByRole('button', { name: w.delete }))
    await settle()
    expect(api.deleteMarket).toHaveBeenCalledWith('ae')
    expect(list().queryByText('UAE')).toBeNull()
  })

  it('saves a sub-market after its parent is deleted at the revision the API moved it to', async () => {
    const texas = market({ id: 'tx', name: 'Texas', parentId: 'us', countries: ['US'], currency: 'USD', language: 'en-US', revision: 2 })
    api.loadAllMarkets.mockResolvedValue([india, { ...us, everywhereElse: false }, texas, gulf])
    await show()
    open('United States')
    fireEvent.click(screen.getByRole('button', { name: w.delete }))
    fireEvent.click(dialog().getByRole('button', { name: w.delete }))
    await settle()
    open('Texas')
    fireEvent.change(screen.getByLabelText(w.name), { target: { value: 'Texas and nearby' } })
    save()
    await settle()
    // The API moved Texas to the top and its revision with it (2 → 3), so the save is at 3, not refused as stale.
    expect(api.saveMarket).toHaveBeenLastCalledWith('tx', 3, expect.objectContaining({ name: 'Texas and nearby', parentId: null }))
  })
})
