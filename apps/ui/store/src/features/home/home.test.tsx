// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreHome } from '../../api/home'
import type { Acting } from '../../api/shell'
import { fill, messages } from '../../messages'
import { numbersOf, tasksOf } from './homeView'

// Home driven per seat (FIRST-RELEASE §5): what each seat is shown is what the API answered it, every task opens its
// filtered list, and a new store sees the checklist its seat can work through.

const words = messages.home

const api = vi.hoisted(() => ({ loadHome: vi.fn(), loadLocaleFacts: vi.fn(), skipSetupStep: vi.fn() }))
vi.mock('../../api/home', () => api)
const categories = vi.hoisted(() => ({ loadShopCategory: vi.fn(), chooseShopCategory: vi.fn(), addSampleCatalog: vi.fn() }))
vi.mock('../../api/shopCategory', () => categories)
const importsApi = vi.hoisted(() => ({ loadImport: vi.fn() }))
vi.mock('../../api/imports', async (actual) => ({ ...(await actual<typeof import('../../api/imports')>()), ...importsApi }))
const brandApi = vi.hoisted(() => ({ loadBrand: vi.fn(), saveBrand: vi.fn() }))
vi.mock('../../api/storefront', async (actual) => ({ ...(await actual<typeof import('../../api/storefront')>()), ...brandApi }))
const editorApi = vi.hoisted(() => ({ uploadPhoto: vi.fn() }))
vi.mock('../../api/productEditor', async (actual) => ({ ...(await actual<typeof import('../../api/productEditor')>()), ...editorApi }))

const { Home } = await import('./Home')

const inr = (amount: string) => ({ amount, currency: 'INR' })

const busy: StoreHome = {
  timeZone: 'Asia/Kolkata',
  hasOrders: true,
  toShip: 3,
  partlyShipped: 1,
  oldestToShipAt: '2026-10-08T05:10:00.000Z',
  paymentsToCollect: { count: 2, firstOrderId: 'o1040' },
  awaitingApproval: 2,
  lowStock: { count: 4, names: ['Saree', 'Throw', 'Kurta'] },
  rejectedCouriers: ['Delhivery'],
  ordersToday: 4,
  ordersYesterday: 6,
  sales: [{ yesterday: inr('2184000'), dayBefore: inr('1950000'), averageWeek: inr('412500') }],
  returningCustomers: 12,
  latestOrders: [{ id: 'o1042', number: 'KT-1042', placedAt: '2026-10-10T07:30:00.000Z', state: 'placed', paymentState: 'paid', fulfilmentState: 'unfulfilled', customerName: 'Ananya Rao', items: 3, total: inr('579600'), test: false }],
  setup: null,
}

// What the API answers a Manager and Staff (§5): withheld figures are null.
const forManager: StoreHome = { ...busy, awaitingApproval: null, rejectedCouriers: null }
const forStaff: StoreHome = { ...forManager, paymentsToCollect: null, sales: null, returningCustomers: null, latestOrders: busy.latestOrders.map((o) => ({ ...o, total: null })) }
const fresh: StoreHome = {
  ...busy,
  hasOrders: false,
  toShip: 0,
  partlyShipped: 0,
  oldestToShipAt: null,
  paymentsToCollect: { count: 0, firstOrderId: null },
  awaitingApproval: 0,
  lowStock: { count: 0, names: [] },
  rejectedCouriers: [],
  ordersToday: 0,
  ordersYesterday: 0,
  sales: [],
  returningCustomers: 0,
  latestOrders: [],
  setup: { category: null, products: true, collections: false, payments: false, shipping: false, paymentsSkipped: false, shippingSkipped: false, brand: null, brandSkipped: null },
}

const ownerPermissions = ['orders.read', 'reports.read', 'settings', 'approve', 'shipping.configure', 'orders.mark_paid', 'catalog.read', 'catalog.import']
const owner: Acting = { store: { id: 's1', name: 'Kesari Threads' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ownerPermissions }
const manager: Acting = { ...owner, role: 'manager', permissions: ['orders.read', 'reports.read', 'orders.mark_paid', 'catalog.read'] }
const staff: Acting = { ...owner, role: 'staff', permissions: ['orders.read', 'catalog.read'] }
const supplier: Acting = { ...owner, role: 'supplier-member', tier: 'vendor-orders-fulfil', seller: { id: 'v1', name: 'Northwind' }, permissions: ['orders.read'] }

const show = async (acting: Acting | (() => Acting), { readOnly = false } = {}) => {
  const root = createRootRoute({ component: Outlet })
  const seat = () => (typeof acting === 'function' ? acting() : acting)
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ me: { id: 'p1', name: 'Farhan Ali', email: 'farhan@example.in', acting: seat() }, acting: seat(), state: { readOnly } }), component: Outlet })
  const page = createRoute({ getParentRoute: () => app, path: '/home', component: Home })
  const blank = (path: string) => createRoute({ getParentRoute: () => app, path, component: () => null })
  const others = ['/orders', '/orders/$orderId', '/products', '/products/$productId', '/products/import', '/settings', '/collections', '/customers', '/reports'].map(blank)
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page, ...others])]), history: createMemoryHistory({ initialEntries: ['/home'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  return router
}

const shoes = { id: 'c3', key: 'footwear', name: 'Footwear', sections: ['sizeCharts', 'specs'], archived: false, hasSample: true }
const food = { id: 'c15', key: 'food_grocery', name: 'Food & Grocery', sections: ['specs'], archived: false, hasSample: false }

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const href = (name: RegExp | string) => screen.getByRole('link', { name }).getAttribute('href')

beforeEach(() => {
  api.loadLocaleFacts.mockResolvedValue({ country: 'IN', currency: 'INR', language: 'en' })
  categories.loadShopCategory.mockResolvedValue({ options: [shoes, food], current: null })
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('what Home works out', () => {
  it('lists what needs the seat in the prototype’s order, with the oldest order’s day in the store’s zone', () => {
    const tasks = tasksOf(busy)
    expect(tasks.map((t) => t.kind)).toEqual(['toShip', 'collect', 'approval', 'lowStock', 'courier'])
    expect(tasks[0]).toMatchObject({ title: 'orders to pack and ship', body: '1 partly shipped · oldest from Oct 8' })
    expect(tasks[3]?.body).toBe('Saree, Throw, Kurta…')
    expect(tasks[4]?.title).toBe('Delhivery stopped working')
    expect(tasksOf({ ...busy, toShip: 1, lowStock: { count: 2, names: ['Saree', 'Throw'] } }).find((t) => t.kind === 'lowStock')?.body).toBe('Saree, Throw')
  })

  it('leaves out what the API withheld, and never invents a change from nothing', () => {
    expect(tasksOf(forStaff).map((t) => t.kind)).toEqual(['toShip', 'lowStock'])
    expect(numbersOf(forStaff).map((n) => n.key)).toEqual(['orders'])
    expect(numbersOf(busy)[0]?.figures).toEqual([{ value: '₹21,840.00', delta: { text: '▲ 12% vs the day before', tone: 'up' } }])
    expect(numbersOf({ ...busy, sales: [{ yesterday: inr('100'), dayBefore: inr('200'), averageWeek: null }] })[0]?.figures[0]?.delta).toEqual({ text: '▼ 50% vs the day before', tone: 'down' })
    // Each currency has its own change: a rise in one never reads as true of the other.
    const usd = (amount: string) => ({ amount, currency: 'USD' })
    const two = numbersOf({ ...busy, sales: [{ yesterday: inr('10000'), dayBefore: inr('8000'), averageWeek: null }, { yesterday: usd('500'), dayBefore: usd('1000'), averageWeek: null }] })
    expect(two[0]?.figures).toEqual([
      { value: '₹100.00', delta: { text: '▲ 25% vs the day before', tone: 'up' } },
      { value: '$5.00', delta: { text: '▼ 50% vs the day before', tone: 'down' } },
    ])
    const none = numbersOf({ ...busy, sales: [{ yesterday: inr('100'), dayBefore: inr('0'), averageWeek: null }] })
    expect(none[0]?.figures[0]?.delta?.text).toBe(words.numbers.nothingBefore)
    expect(none[2]?.figures).toEqual([{ value: words.numbers.none, delta: null }])
  })
})

describe('the Home screen', () => {
  it('shows the Owner every task, linked to its filtered list, then the money and the latest orders', async () => {
    api.loadHome.mockResolvedValue(busy)
    await show(owner)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^Good (morning|afternoon|evening), Farhan$/)
    const tasks = within(screen.getByRole('region', { name: words.needsYou })).getAllByRole('link')
    expect(tasks.map((t) => t.getAttribute('href'))).toEqual(['/orders?filter=TO_SHIP', '/orders/o1040', '/products?filter=pending', '/products?filter=low_stock', '/settings?tab=shipping'])
    const numbers = screen.getByRole('region', { name: words.numbers.title })
    expect(within(numbers).getByRole('link', { name: /Sales yesterday/ }).getAttribute('href')).toBe('/reports')
    expect(within(numbers).getByRole('link', { name: /Returning customers/ }).getAttribute('href')).toBe('/customers')
    const latest = within(screen.getByRole('list', { name: words.latest.label })).getAllByRole('link')
    expect(latest[0]?.textContent).toContain('₹5,796.00')
    expect(latest[0]?.textContent).toContain('To ship')
    expect(href(words.latest.all)).toBe('/orders')
    expect(api.loadLocaleFacts).toHaveBeenCalled()
  })

  it('shows a Manager no approval queue or couriers, as the API withholds them', async () => {
    api.loadHome.mockResolvedValue(forManager)
    await show(manager)
    const tasks = within(screen.getByRole('region', { name: words.needsYou })).getAllByRole('link')
    expect(tasks.map((t) => t.getAttribute('href'))).toEqual(['/orders?filter=TO_SHIP', '/orders/o1040', '/products?filter=low_stock'])
    expect(screen.getByRole('link', { name: /Average order/ })).toBeTruthy()
    expect(api.loadLocaleFacts).not.toHaveBeenCalled()
  })

  it('shows Staff today’s counts with no money: items for each order, and no link to Reports', async () => {
    api.loadHome.mockResolvedValue(forStaff)
    await show(staff)
    const numbers = screen.getByRole('region', { name: words.numbers.titleToday })
    expect(within(numbers).getByText(words.numbers.ordersToday)).toBeTruthy()
    for (const withheld of [words.numbers.salesYesterday, words.numbers.average, words.numbers.returning]) expect(within(numbers).queryByText(withheld)).toBeNull()
    expect(screen.queryByRole('link', { name: /Reports/ })).toBeNull()
    const latest = within(screen.getByRole('list', { name: words.latest.label })).getAllByRole('link')
    expect(latest[0]?.textContent).toContain('3 items')
    expect(latest[0]?.textContent).not.toContain('₹')
  })

  it('gives a new store’s Owner the whole checklist, the country, currency and language among it', async () => {
    api.loadHome.mockResolvedValue(fresh)
    await show(owner)
    const setup = screen.getByRole('region', { name: words.setup.title })
    expect(within(setup).getByText('2 of 5')).toBeTruthy()
    expect(within(setup).getByText('India · INR · English')).toBeTruthy()
    const steps = within(setup).getAllByRole('link')
    expect(steps.map((s) => s.getAttribute('href'))).toEqual(['/settings?tab=store', '/products/new', '/collections', '/settings?tab=payments', '/settings?tab=shipping'])
    expect(steps[1]?.textContent).toContain(words.setup.doneSuffix)
    expect(steps[2]?.textContent).not.toContain(words.setup.doneSuffix)
    expect(within(setup).queryByText(words.setup.ownerNote)).toBeNull()
    expect(screen.queryByRole('region', { name: words.numbers.title })).toBeNull()
  })

  it('tags payments and shipping Optional, and Skip drops a step from the count and Undo brings it back', async () => {
    api.loadHome.mockResolvedValue(fresh)
    api.skipSetupStep.mockResolvedValue(undefined)
    await show(owner)
    const setup = screen.getByRole('region', { name: words.setup.title })
    expect(within(setup).getAllByText(words.setup.optional)).toHaveLength(2)
    await act(async () => {
      fireEvent.click(within(setup).getByRole('button', { name: `Skip: ${words.setup.payments.label}` }))
    })
    expect(api.skipSetupStep).toHaveBeenCalledWith('payments', true)
    expect(within(setup).getByText('2 of 4')).toBeTruthy()
    expect(within(setup).getByText(words.setup.skipped)).toBeTruthy()
    await act(async () => {
      fireEvent.click(within(setup).getByRole('button', { name: `Undo skipping: ${words.setup.payments.label}` }))
    })
    expect(api.skipSetupStep).toHaveBeenLastCalledWith('payments', false)
    expect(within(setup).getByText('2 of 5')).toBeTruthy()
  })
  it('keeps a step as it was and says so when the skip is not saved', async () => {
    api.loadHome.mockResolvedValue(fresh)
    api.skipSetupStep.mockRejectedValue(new Error('down'))
    await show(owner)
    const setup = screen.getByRole('region', { name: words.setup.title })
    await act(async () => {
      fireEvent.click(within(setup).getByRole('button', { name: `Skip: ${words.setup.shipping.label}` }))
    })
    expect(within(setup).getByRole('alert').textContent).toBe(words.setup.skipError)
    expect(within(setup).getByText('2 of 5')).toBeTruthy()
  })
  it('offers a Manager no Skip, as the steps are not theirs', async () => {
    api.loadHome.mockResolvedValue({ ...fresh, setup: { category: null, products: true, collections: false, payments: null, shipping: null, paymentsSkipped: null, shippingSkipped: null, brand: null, brandSkipped: null } })
    await show(manager)
    expect(screen.queryByRole('button', { name: /Skip/ })).toBeNull()
  })
  it('gives a Manager only the catalogue steps, saying the rest is the owner’s', async () => {
    api.loadHome.mockResolvedValue({ ...fresh, setup: { category: null, products: true, collections: false, payments: null, shipping: null, paymentsSkipped: null, shippingSkipped: null, brand: null, brandSkipped: null } })
    await show(manager)
    const setup = screen.getByRole('region', { name: words.setup.title })
    expect(within(setup).getAllByRole('link')).toHaveLength(2)
    expect(within(setup).getByText(words.setup.ownerNote)).toBeTruthy()
  })

  it('tells Staff in a new store that the first order will show up here', async () => {
    api.loadHome.mockResolvedValue({ ...fresh, sales: null, returningCustomers: null, paymentsToCollect: null, setup: { category: null, products: null, collections: null, payments: null, shipping: null, paymentsSkipped: null, shippingSkipped: null, brand: null, brandSkipped: null } })
    await show(staff)
    expect(screen.getByRole('region', { name: words.staffWait.title })).toBeTruthy()
    expect(screen.queryByRole('region', { name: words.setup.title })).toBeNull()
  })

  it('says nothing is waiting once every task is done', async () => {
    api.loadHome.mockResolvedValue({ ...busy, toShip: 0, paymentsToCollect: { count: 0, firstOrderId: null }, awaitingApproval: 0, lowStock: { count: 0, names: [] }, rejectedCouriers: [] })
    await show(owner)
    expect(screen.getByRole('status').textContent).toContain(words.allClear.title)
    expect(screen.queryByRole('region', { name: words.needsYou })).toBeNull()
  })

  it('lets the Owner pick what the shop sells on the checklist, then offers Change', async () => {
    api.loadHome.mockResolvedValue({ ...fresh, setup: { ...fresh.setup, category: false } })
    categories.chooseShopCategory.mockResolvedValue(shoes)
    await show(owner)
    const setup = screen.getByRole('region', { name: words.setup.title })
    expect(within(setup).getByText('2 of 6')).toBeTruthy()
    await act(async () => {
      fireEvent.click(within(setup).getByRole('button', { name: new RegExp(words.setup.category.label) }))
    })
    const pick = within(setup).getByRole('combobox', { name: words.setup.category.picker })
    fireEvent.focus(pick)
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Footwear', 'Food & Grocery'])
    fireEvent.change(pick, { target: { value: 'foot' } })
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Footwear'])
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Footwear' }))
    await act(async () => {
      fireEvent.click(within(setup).getByRole('button', { name: words.setup.category.save }))
    })
    expect(categories.chooseShopCategory).toHaveBeenCalledWith('c3')
    expect(within(setup).getByText('3 of 6')).toBeTruthy()
    expect(within(setup).getByText('Footwear')).toBeTruthy()
    expect(href(new RegExp(words.setup.category.label))).toBe('/settings?tab=catalogue')
  })

  describe('the products step once the category is chosen', () => {
    const chosen = (current: typeof shoes) => {
      api.loadHome.mockResolvedValue({ ...fresh, setup: { ...fresh.setup, category: true, products: false } })
      categories.loadShopCategory.mockResolvedValue({ options: [shoes, food], current })
    }
    const p = words.setup.products
    const sampleWords = messages.sampleCatalog

    it('offers the sample, an import and adding by hand, the last only as a note', async () => {
      chosen(shoes)
      await show(owner)
      const setup = screen.getByRole('region', { name: words.setup.title })
      expect(within(setup).getByRole('button', { name: sampleWords.add })).toBeTruthy()
      expect(href(p.import)).toBe('/products/import')
      expect(within(setup).queryByText(p.manualNote)).toBeNull()
      await act(async () => {
        fireEvent.click(within(setup).getByRole('button', { name: p.manual }))
      })
      expect(within(setup).getByText(p.manualNote, { exact: false })).toBeTruthy()
      expect(within(setup).getByRole('link', { name: p.cta }).getAttribute('href')).toBe('/products/new')
    })

    it('leaves the sample out when the category has none', async () => {
      chosen(food)
      await show(owner)
      expect(screen.queryByRole('button', { name: sampleWords.add })).toBeNull()
      expect(href(p.import)).toBe('/products/import')
    })

    it('imports the sample straight away, then opens Products with it', async () => {
      chosen(shoes)
      categories.addSampleCatalog.mockResolvedValue('job-7')
      importsApi.loadImport.mockResolvedValue({ id: 'job-7', state: 'done' })
      const router = await show(owner)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: sampleWords.add }))
      })
      await settle()
      expect(categories.addSampleCatalog).toHaveBeenCalledTimes(1)
      expect(importsApi.loadImport).toHaveBeenCalledWith('job-7')
      expect(router.state.location.pathname).toBe('/products')
    })

    it('says so when the sample import fails, and stays on Home', async () => {
      chosen(shoes)
      categories.addSampleCatalog.mockResolvedValue('job-8')
      importsApi.loadImport.mockResolvedValue({ id: 'job-8', state: 'failed' })
      const router = await show(owner)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: sampleWords.add }))
      })
      await settle()
      expect(screen.getByRole('alert').textContent).toBe(sampleWords.refused.other)
      expect(router.state.location.pathname).toBe('/home')
    })

    it('says why the sample can’t be added', async () => {
      chosen(shoes)
      categories.addSampleCatalog.mockRejectedValue(new ApiError('ALREADY_ADDED', 'x'))
      await show(owner)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: sampleWords.add }))
      })
      expect(screen.getByRole('alert').textContent).toBe(sampleWords.refused.ALREADY_ADDED)
    })

    it('gives a read-only session no sample or import', async () => {
      chosen(shoes)
      await show(owner, { readOnly: true })
      expect(screen.queryByRole('button', { name: sampleWords.add })).toBeNull()
      expect(screen.queryByRole('link', { name: p.import })).toBeNull()
      expect(screen.getByRole('button', { name: p.manual })).toBeTruthy()
    })
  })

  it('keeps the step open and says so when the choice doesn’t save', async () => {
    api.loadHome.mockResolvedValue({ ...fresh, setup: { ...fresh.setup, category: false } })
    categories.chooseShopCategory.mockRejectedValue(new Error('down'))
    await show(owner)
    const setup = screen.getByRole('region', { name: words.setup.title })
    await act(async () => {
      fireEvent.click(within(setup).getByRole('button', { name: new RegExp(words.setup.category.label) }))
    })
    fireEvent.focus(within(setup).getByRole('combobox', { name: words.setup.category.picker }))
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Food & Grocery' }))
    await act(async () => {
      fireEvent.click(within(setup).getByRole('button', { name: words.setup.category.save }))
    })
    expect(within(setup).getByRole('alert').textContent).toBe(words.setup.category.error)
    expect(within(setup).getByText('2 of 6')).toBeTruthy()
  })

  it('sends a read-only session to Settings rather than picking', async () => {
    api.loadHome.mockResolvedValue({ ...fresh, setup: { ...fresh.setup, category: false } })
    await show(owner, { readOnly: true })
    expect(screen.queryByRole('combobox', { name: words.setup.category.picker })).toBeNull()
    expect(href(new RegExp(words.setup.category.label))).toBe('/settings?tab=catalogue')
  })

  it('uploads the logo then the favicon into the storefront brand from the checklist, keeping the rest of the brand', async () => {
    const b = words.setup.brand
    api.loadHome.mockResolvedValue({ ...fresh, setup: { ...fresh.setup, brand: false, brandSkipped: false } })
    editorApi.uploadPhoto.mockResolvedValueOnce({ ok: true, assetId: 'logo1' }).mockResolvedValueOnce({ ok: true, assetId: 'fav1' })
    brandApi.loadBrand.mockResolvedValue(null)
    brandApi.saveBrand.mockResolvedValue({})
    await show(owner)
    const setup = screen.getByRole('region', { name: words.setup.title })
    expect(within(setup).getByText(b.label)).toBeTruthy()
    expect((within(setup).getByLabelText(b.favicon) as HTMLInputElement).disabled).toBe(true)
    const png = new File(['x'], 'logo.png', { type: 'image/png' })
    await act(async () => {
      fireEvent.change(within(setup).getByLabelText(b.logo), { target: { files: [png] } })
    })
    await settle()
    expect(brandApi.saveBrand).toHaveBeenLastCalledWith(expect.objectContaining({ logoAssetId: 'logo1', shopName: 'Kesari Threads' }))
    expect(within(setup).getByRole('status').textContent).toContain(b.logoAdded)
    brandApi.loadBrand.mockResolvedValue({ brandReady: true, shopName: 'Kesari Threads', logoAssetId: 'logo1', faviconAssetId: null, primaryColour: '#112233', secondaryColour: null, tagline: 'Hand-woven', description: null, social: { instagram: null, facebook: null, x: null, youtube: null, tiktok: null, whatsapp: null }, contactEmail: null, contactPhone: null, contactAddress: null, voice: null })
    await act(async () => {
      fireEvent.change(within(setup).getByLabelText(b.favicon), { target: { files: [png] } })
    })
    await settle()
    expect(brandApi.saveBrand).toHaveBeenLastCalledWith(expect.objectContaining({ logoAssetId: 'logo1', faviconAssetId: 'fav1', tagline: 'Hand-woven', primaryColour: '#112233' }))
  })

  it('lets the Owner skip the logo step, and shows a store with a logo as done with Change', async () => {
    api.loadHome.mockResolvedValue({ ...fresh, setup: { ...fresh.setup, brand: false, brandSkipped: false } })
    api.skipSetupStep.mockResolvedValue(undefined)
    await show(owner)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: fill(words.setup.skipFor, { step: words.setup.brand.label }) }))
    })
    expect(api.skipSetupStep).toHaveBeenCalledWith('brand', true)
    cleanup()
    api.loadHome.mockResolvedValue({ ...fresh, setup: { ...fresh.setup, brand: true, brandSkipped: false } })
    await show(owner)
    expect(href(new RegExp(words.setup.brand.label))).toBe('/storefront?tab=settings')
  })

  it('keeps Home when the locale facts fail, leaving that step out', async () => {
    api.loadHome.mockResolvedValue(fresh)
    api.loadLocaleFacts.mockRejectedValue(new Error('down'))
    await show(owner)
    expect(within(screen.getByRole('region', { name: words.setup.title })).getByText('1 of 4')).toBeTruthy()
  })

  it('sends a supplier to its products without asking for Home', async () => {
    await show(supplier)
    expect(screen.getByRole('heading', { name: words.denied.title })).toBeTruthy()
    expect(href(words.denied.action)).toBe('/products')
    expect(api.loadHome).not.toHaveBeenCalled()
  })

  it('says a read-only store is view-only', async () => {
    api.loadHome.mockResolvedValue(busy)
    await show(owner, { readOnly: true })
    expect(screen.getByText(words.readOnly)).toBeTruthy()
  })

  it('shows the error with a retry that loads again', async () => {
    api.loadHome.mockRejectedValueOnce(new Error('down'))
    await show(owner)
    expect(screen.getByRole('heading', { name: words.error.title })).toBeTruthy()
    api.loadHome.mockResolvedValueOnce(busy)
    fireEvent.click(screen.getByRole('button', { name: words.error.retry }))
    await settle()
    expect(screen.getByText('Delhivery stopped working')).toBeTruthy()
  })

  it('never lets a slow answer for the seat before replace the latest one', async () => {
    let answerFirst: (home: StoreHome) => void = () => undefined
    api.loadHome.mockReturnValueOnce(new Promise<StoreHome>((resolve) => (answerFirst = resolve))).mockResolvedValueOnce(forManager)
    let acting = owner
    const router = await show(() => acting)
    expect(screen.getByText(words.loading)).toBeTruthy()
    acting = manager
    await act(async () => router.invalidate())
    await settle()
    expect(screen.getByRole('link', { name: /orders to pack and ship/ })).toBeTruthy()
    await act(async () => answerFirst(busy))
    expect(screen.queryByText('Delhivery stopped working')).toBeNull()
  })
})
