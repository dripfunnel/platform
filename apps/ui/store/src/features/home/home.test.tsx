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

const api = vi.hoisted(() => ({ loadHome: vi.fn(), loadLocaleFacts: vi.fn() }))
vi.mock('../../api/home', () => api)
const categories = vi.hoisted(() => ({ loadShopCategory: vi.fn(), chooseShopCategory: vi.fn(), addSampleCatalog: vi.fn() }))
vi.mock('../../api/shopCategory', () => categories)
const importsApi = vi.hoisted(() => ({ loadImport: vi.fn() }))
vi.mock('../../api/imports', async (actual) => ({ ...(await actual<typeof import('../../api/imports')>()), ...importsApi }))
const brandApi = vi.hoisted(() => ({ loadBrand: vi.fn(), saveBrand: vi.fn(), loadOverview: vi.fn(), loadTemplates: vi.fn(), chooseTemplate: vi.fn(), loadDomains: vi.fn(), previewLink: vi.fn() }))
vi.mock('../../api/storefront', async (actual) => ({ ...(await actual<typeof import('../../api/storefront')>()), ...brandApi }))
const studioApi = vi.hoisted(() => ({ publishDesign: vi.fn(), loadPublishRun: vi.fn() }))
vi.mock('../../api/studio', async (actual) => ({ ...(await actual<typeof import('../../api/studio')>()), ...studioApi }))
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
  setup: { category: null, products: true, collections: false, brand: null },
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
  const others = ['/orders', '/orders/$orderId', '/products', '/products/$productId', '/products/import', '/settings', '/collections', '/customers', '/reports', '/storefront'].map(blank)
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

const savedBrand = { brandReady: true, shopName: 'Kesari Threads', logoAssetId: 'logo1', faviconAssetId: 'fav1', primaryColour: '#112233', secondaryColour: null, tagline: 'Hand-woven', description: null, social: { instagram: null, facebook: null, x: null, youtube: null, tiktok: null, whatsapp: null }, contactEmail: null, contactPhone: null, contactAddress: null, voice: null }

beforeEach(() => {
  api.loadLocaleFacts.mockResolvedValue({ country: 'IN', currency: 'INR', language: 'en' })
  categories.loadShopCategory.mockResolvedValue({ options: [shoes, food], current: null })
  brandApi.loadBrand.mockResolvedValue(null)
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
    expect(within(setup).getByText('2 of 3')).toBeTruthy()
    expect(within(setup).getByText('India · INR · English')).toBeTruthy()
    const steps = within(setup).getAllByRole('link')
    expect(steps.map((s) => s.getAttribute('href'))).toEqual(['/settings?tab=store', '/products/new', '/collections'])
    expect(steps[1]?.textContent).toContain(words.setup.doneSuffix)
    expect(steps[2]?.textContent).not.toContain(words.setup.doneSuffix)
    expect(within(setup).queryByText(words.setup.ownerNote)).toBeNull()
    expect(screen.queryByRole('region', { name: words.numbers.title })).toBeNull()
  })

  it('lists no payments or shipping step, as new stores start with Cash on delivery and a flat rate (#1406)', async () => {
    api.loadHome.mockResolvedValue({ ...fresh, setup: { ...fresh.setup, brand: false } })
    await show(owner)
    const setup = screen.getByRole('region', { name: words.setup.title })
    expect(within(setup).queryByText('Choose how shoppers pay')).toBeNull()
    expect(within(setup).queryByText('Choose how you ship')).toBeNull()
    expect(within(setup).getByText('2 of 4')).toBeTruthy()
  })
  it('gives a Manager only the catalogue steps, saying the rest is the owner’s', async () => {
    api.loadHome.mockResolvedValue({ ...fresh, setup: { category: null, products: true, collections: false, brand: null } })
    await show(manager)
    const setup = screen.getByRole('region', { name: words.setup.title })
    expect(within(setup).getAllByRole('link')).toHaveLength(2)
    expect(within(setup).getByText(words.setup.ownerNote)).toBeTruthy()
  })

  it('tells Staff in a new store that the first order will show up here', async () => {
    api.loadHome.mockResolvedValue({ ...fresh, sales: null, returningCustomers: null, paymentsToCollect: null, setup: { category: null, products: null, collections: null, brand: null } })
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
    expect(within(setup).getByText('2 of 4')).toBeTruthy()
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
    expect(within(setup).getByText('3 of 4')).toBeTruthy()
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
    expect(within(setup).getByText('2 of 4')).toBeTruthy()
  })

  it('sends a read-only session to Settings rather than picking', async () => {
    api.loadHome.mockResolvedValue({ ...fresh, setup: { ...fresh.setup, category: false } })
    await show(owner, { readOnly: true })
    expect(screen.queryByRole('combobox', { name: words.setup.category.picker })).toBeNull()
    expect(href(new RegExp(words.setup.category.label))).toBe('/settings?tab=catalogue')
  })

  it('uploads the logo then the favicon into the storefront brand from the checklist, keeping the rest of the brand', async () => {
    const b = words.setup.brand
    api.loadHome.mockResolvedValue({ ...fresh, setup: { ...fresh.setup, brand: false } })
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
    expect(within(setup).getByText('2 of 4')).toBeTruthy()
    brandApi.loadBrand.mockResolvedValue({ ...savedBrand, faviconAssetId: null })
    await act(async () => {
      fireEvent.change(within(setup).getByLabelText(b.favicon), { target: { files: [png] } })
    })
    await settle()
    expect(brandApi.saveBrand).toHaveBeenLastCalledWith(expect.objectContaining({ logoAssetId: 'logo1', faviconAssetId: 'fav1', tagline: 'Hand-woven', primaryColour: '#112233' }))
    // Done once it has both: the step reads as done and opens Site settings.
    expect(within(setup).getByText('3 of 4')).toBeTruthy()
    expect(href(new RegExp(b.label))).toBe('/storefront?tab=settings')
  })

  it('offers no Skip on the logo step, and shows a store with both as done, opening Site settings', async () => {
    api.loadHome.mockResolvedValue({ ...fresh, setup: { ...fresh.setup, brand: false } })
    await show(owner)
    expect(screen.queryByRole('button', { name: /Skip/ })).toBeNull()
    cleanup()
    api.loadHome.mockResolvedValue({ ...fresh, setup: { ...fresh.setup, brand: true } })
    await show(owner)
    expect(href(new RegExp(words.setup.brand.label))).toBe('/storefront?tab=settings')
  })

  it('lets the favicon follow at once when a logo was saved before', async () => {
    api.loadHome.mockResolvedValue({ ...fresh, setup: { ...fresh.setup, brand: false } })
    brandApi.loadBrand.mockResolvedValue({ ...savedBrand, faviconAssetId: null })
    await show(owner)
    const setup = screen.getByRole('region', { name: words.setup.title })
    expect((within(setup).getByLabelText(words.setup.brand.favicon) as HTMLInputElement).disabled).toBe(false)
    expect(within(setup).getByText('2 of 4')).toBeTruthy()
  })

  describe('the storefront step', () => {
    const sf = words.setup.storefront
    const siteOwner: Acting = { ...owner, permissions: [...ownerPermissions, 'storefront.read', 'publish'] }
    const ready = { ...fresh, setup: { category: true, products: true, collections: false, brand: true } }
    const fashion = { key: 'fashion', name: 'Thread', tag: 'Fashion & apparel', description: '', demoUrl: null, current: false, forCategory: true }
    const classic = { ...fashion, key: 'classic', name: 'Classic', tag: 'Traditional & ethnic', forCategory: false }
    const overview = (status: string, live: unknown = null, publishing: string | null = null) => ({ status, template: null, live, draft: status === 'not_published' ? { template: 'fashion', changedAt: null, previewReady: true } : null, lastPublish: null, publishing })
    const firstLive = { number: 1, publishedAt: '2026-11-19T08:00:00.000Z', template: 'fashion', portalOrigin: null }
    const freeAddress = { customDomainAllowed: false, domains: [{ host: 'kesari.my-store.one', kind: 'free', primary: true, status: 'live' }] }
    const run = (step: string, checks: unknown[] = []) => ({ id: 'r1', step, version: step === 'live' ? 1 : null, repairAttempts: 0, checks, bisectMessageId: null })
    const publishButton = () => step().getByRole('button', { name: sf.publish })
    const step = () => within(screen.getByRole('region', { name: words.setup.title }))

    it('waits for the category and the logo and favicon before it creates', async () => {
      api.loadHome.mockResolvedValue({ ...ready, setup: { ...ready.setup, brand: false } })
      brandApi.loadOverview.mockResolvedValue(overview('not_started'))
      brandApi.loadTemplates.mockResolvedValue([classic, fashion])
      await show(siteOwner)
      expect(step().getByText(sf.locked)).toBeTruthy()
      expect((step().getByRole('button', { name: sf.create }) as HTMLButtonElement).disabled).toBe(true)
      expect(step().getByText('3 of 6')).toBeTruthy()
    })

    it('creates the site from the category’s template, then offers Preview and Publish on Home once it is made', async () => {
      api.loadHome.mockResolvedValue(ready)
      brandApi.loadOverview.mockResolvedValueOnce(overview('not_started')).mockResolvedValue(overview('not_published'))
      brandApi.loadTemplates.mockResolvedValue([classic, fashion])
      brandApi.chooseTemplate.mockResolvedValue('creating')
      await show(siteOwner)
      expect(step().getByText(fill(sf.template, { name: 'Thread' }))).toBeTruthy()
      await act(async () => {
        fireEvent.click(step().getByRole('button', { name: sf.create }))
      })
      await settle()
      expect(brandApi.chooseTemplate).toHaveBeenCalledWith('fashion', true)
      expect(step().getByText(sf.ready)).toBeTruthy()
      expect(step().getByRole('button', { name: sf.preview })).toBeTruthy()
      expect(publishButton()).toBeTruthy()
      expect(step().queryAllByRole('link').some((l) => l.getAttribute('href')?.includes('view=studio'))).toBe(false)
    })

    it('says the site is being made while it is', async () => {
      api.loadHome.mockResolvedValue(ready)
      brandApi.loadOverview.mockResolvedValue(overview('creating'))
      brandApi.loadTemplates.mockResolvedValue([classic, fashion])
      await show(siteOwner)
      expect(step().getByRole('status').textContent).toBe(sf.creating)
      expect((step().getByRole('button', { name: sf.creatingCta }) as HTMLButtonElement).disabled).toBe(true)
    })

    describe('while the site is being made', () => {
      // Only the 5 s interval is faked, so the screen's own promises and settle() still run.
      beforeEach(() => void vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }))
      afterEach(() => void vi.useRealTimers())
      const tick = () => act(async () => void vi.advanceTimersByTime(5_000))

      it('reads the site again every 5 s and offers Publish once it is made', async () => {
        api.loadHome.mockResolvedValue(ready)
        brandApi.loadTemplates.mockResolvedValue([fashion])
        brandApi.loadOverview.mockResolvedValueOnce(overview('creating')).mockResolvedValueOnce(overview('creating')).mockResolvedValue(overview('not_published'))
        await show(siteOwner)
        expect(step().getByRole('status').textContent).toBe(sf.creating)
        await tick()
        await settle()
        expect(brandApi.loadOverview).toHaveBeenCalledTimes(3)
        expect(publishButton()).toBeTruthy()
      })

      it('never lets an older answer replace a newer one', async () => {
        api.loadHome.mockResolvedValue(ready)
        brandApi.loadTemplates.mockResolvedValue([fashion])
        let answerFirst: (o: ReturnType<typeof overview>) => void = () => undefined
        brandApi.loadOverview
          .mockResolvedValueOnce(overview('creating'))
          .mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)))
          .mockResolvedValue(overview('not_published'))
        await show(siteOwner)
        await tick()
        await settle()
        expect(publishButton()).toBeTruthy()
        await act(async () => answerFirst(overview('creating')))
        await settle()
        // The stale "creating" is dropped: the step stays open and no new round of reads starts.
        expect(publishButton()).toBeTruthy()
        expect(brandApi.loadOverview).toHaveBeenCalledTimes(3)
      })

      it('keeps waiting quietly when a read fails, and moves on with the next', async () => {
        api.loadHome.mockResolvedValue(ready)
        brandApi.loadTemplates.mockResolvedValue([fashion])
        brandApi.loadOverview.mockResolvedValueOnce(overview('creating')).mockRejectedValueOnce(new Error('down')).mockResolvedValue(overview('not_published'))
        await show(siteOwner)
        expect(step().getByRole('status').textContent).toBe(sf.creating)
        expect(step().queryByRole('alert')).toBeNull()
        await tick()
        await settle()
        expect(publishButton()).toBeTruthy()
      })
    })

    it('keeps the step when the site can’t be read, and Try again reads it again', async () => {
      api.loadHome.mockResolvedValue(ready)
      brandApi.loadTemplates.mockResolvedValue([fashion])
      brandApi.loadOverview.mockRejectedValueOnce(new Error('down')).mockResolvedValue(overview('not_started'))
      await show(siteOwner)
      expect(step().getByText(sf.unavailable)).toBeTruthy()
      expect(step().getByText('4 of 6')).toBeTruthy()
      await act(async () => {
        fireEvent.click(step().getByRole('button', { name: sf.retry }))
      })
      await settle()
      expect((step().getByRole('button', { name: sf.create }) as HTMLButtonElement).disabled).toBe(false)
      expect(step().queryByText(sf.unavailable)).toBeNull()
    })

    it('says so again when Try again fails too', async () => {
      api.loadHome.mockResolvedValue(ready)
      brandApi.loadTemplates.mockResolvedValue([fashion])
      brandApi.loadOverview.mockRejectedValue(new Error('down'))
      await show(siteOwner)
      await act(async () => {
        fireEvent.click(step().getByRole('button', { name: sf.retry }))
      })
      await settle()
      expect(step().getByRole('alert').textContent).toBe(sf.unavailable)
      expect(step().getByRole('button', { name: sf.retry })).toBeTruthy()
    })

    it('never reads the site once the store has an order, as the checklist is gone', async () => {
      api.loadHome.mockResolvedValue(busy)
      await show(siteOwner)
      expect(screen.queryByText(sf.label)).toBeNull()
      expect(brandApi.loadOverview).not.toHaveBeenCalled()
      expect(brandApi.loadTemplates).not.toHaveBeenCalled()
    })

    it('starts from Classic when the category has no template of its own', async () => {
      api.loadHome.mockResolvedValue(ready)
      brandApi.loadOverview.mockResolvedValue(overview('not_started'))
      brandApi.loadTemplates.mockResolvedValue([classic, { ...fashion, forCategory: false }])
      brandApi.chooseTemplate.mockResolvedValue('creating')
      await show(siteOwner)
      await act(async () => {
        fireEvent.click(step().getByRole('button', { name: sf.create }))
      })
      expect(brandApi.chooseTemplate).toHaveBeenCalledWith('classic', true)
    })

    it('says why the site can’t be made, and lets the Owner try again after a failure', async () => {
      api.loadHome.mockResolvedValue(ready)
      brandApi.loadOverview.mockResolvedValue(overview('create_failed'))
      brandApi.loadTemplates.mockResolvedValue([fashion])
      brandApi.chooseTemplate.mockRejectedValue(new ApiError('BRAND_NOT_READY', 'x'))
      await show(siteOwner)
      expect(step().getByText(sf.failed)).toBeTruthy()
      await act(async () => {
        fireEvent.click(step().getByRole('button', { name: sf.create }))
      })
      expect(step().getByRole('alert').textContent).toBe(messages.storefront.gallery.refused.BRAND_NOT_READY)
    })

    it('is done once the site is published, linking to the live site', async () => {
      api.loadHome.mockResolvedValue(ready)
      brandApi.loadOverview.mockResolvedValue(overview('same_as_live', firstLive))
      brandApi.loadTemplates.mockResolvedValue([fashion])
      brandApi.loadDomains.mockResolvedValue(freeAddress)
      await show(siteOwner)
      expect(step().getByText('5 of 6')).toBeTruthy()
      expect(step().getByText(fill(sf.live, { host: 'kesari.my-store.one' }))).toBeTruthy()
      const live = step().getByRole('link', { name: sf.viewLive })
      expect(live.getAttribute('href')).toBe('https://kesari.my-store.one')
      expect(live.getAttribute('target')).toBe('_blank')
    })

    it('is done, opening Storefront, when the live address can’t be read', async () => {
      api.loadHome.mockResolvedValue(ready)
      brandApi.loadOverview.mockResolvedValue(overview('same_as_live', firstLive))
      brandApi.loadTemplates.mockResolvedValue([fashion])
      brandApi.loadDomains.mockRejectedValue(new Error('down'))
      await show(siteOwner)
      expect(step().getByText('5 of 6')).toBeTruthy()
      expect(href(new RegExp(sf.label))).toBe('/storefront?tab=design')
    })

    describe('preview and publish on Home', () => {
      const made = async () => {
        api.loadHome.mockResolvedValue(ready)
        brandApi.loadTemplates.mockResolvedValue([fashion])
        brandApi.loadOverview.mockResolvedValue(overview('not_published'))
        await show(siteOwner)
      }
      const tab = () => ({ opener: {} as unknown, location: { href: '' }, close: vi.fn() })

      it('opens the signed preview link in a new tab that carries nothing back', async () => {
        const opened = tab()
        const open = vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window)
        brandApi.previewLink.mockResolvedValue('https://kesari-preview.my-store.one/__open?t=signed')
        await made()
        await act(async () => {
          fireEvent.click(step().getByRole('button', { name: sf.preview }))
        })
        expect(open).toHaveBeenCalledWith('', '_blank')
        expect(opened.opener).toBeNull()
        expect(opened.location.href).toBe('https://kesari-preview.my-store.one/__open?t=signed')
        open.mockRestore()
      })

      it('closes the tab and says why when the preview can’t open', async () => {
        const opened = tab()
        const open = vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window)
        brandApi.previewLink.mockRejectedValue(new ApiError('NOT_CONNECTED', 'x'))
        await made()
        await act(async () => {
          fireEvent.click(step().getByRole('button', { name: sf.preview }))
        })
        expect(opened.close).toHaveBeenCalled()
        expect(step().getByRole('alert').textContent).toBe(messages.storefront.studio.preview.refused.NOT_CONNECTED)
        open.mockRestore()
      })

      it('hides Preview until the draft has one', async () => {
        api.loadHome.mockResolvedValue(ready)
        brandApi.loadTemplates.mockResolvedValue([fashion])
        brandApi.loadOverview.mockResolvedValue({ ...overview('not_published'), draft: { template: 'fashion', changedAt: null, previewReady: false } })
        await show(siteOwner)
        expect(step().queryByRole('button', { name: sf.preview })).toBeNull()
        expect(publishButton()).toBeTruthy()
      })

      it('publishes from Home, follows the publish, then is done with the live site', async () => {
        await made()
        studioApi.publishDesign.mockResolvedValue('r1')
        studioApi.loadPublishRun.mockResolvedValue(run('live'))
        brandApi.loadOverview.mockResolvedValue(overview('same_as_live', firstLive))
        brandApi.loadDomains.mockResolvedValue(freeAddress)
        await act(async () => {
          fireEvent.click(publishButton())
        })
        await settle()
        expect(studioApi.publishDesign).toHaveBeenCalledTimes(1)
        expect(studioApi.loadPublishRun).toHaveBeenCalledWith('r1')
        expect(step().getByText('5 of 6')).toBeTruthy()
        expect(step().getByRole('link', { name: sf.viewLive }).getAttribute('href')).toBe('https://kesari.my-store.one')
      })

      it('says what failed when the publish isn’t taken live, and offers Publish again', async () => {
        await made()
        studioApi.publishDesign.mockResolvedValue('r1')
        studioApi.loadPublishRun.mockResolvedValue(run('failed', [{ name: 'links', passed: false, words: 'A link on your home page is broken.' }]))
        await act(async () => {
          fireEvent.click(publishButton())
        })
        await settle()
        expect(step().getByRole('alert').textContent).toContain('A link on your home page is broken.')
        expect((publishButton() as HTMLButtonElement).disabled).toBe(false)
      })

      it('says why a publish can’t start', async () => {
        await made()
        studioApi.publishDesign.mockRejectedValue(new ApiError('STUDIO_QUEUED', 'x'))
        await act(async () => {
          fireEvent.click(publishButton())
        })
        expect(step().getByRole('alert').textContent).toBe(messages.storefront.studio.publish.refused.STUDIO_QUEUED)
        expect(studioApi.loadPublishRun).not.toHaveBeenCalled()
      })

      it('follows a publish already under way when Home opens', async () => {
        api.loadHome.mockResolvedValue(ready)
        brandApi.loadTemplates.mockResolvedValue([fashion])
        brandApi.loadOverview.mockResolvedValue(overview('not_published', null, 'r9'))
        studioApi.loadPublishRun.mockReturnValue(new Promise(() => undefined))
        await show(siteOwner)
        expect(step().getByRole('status').textContent).toBe(sf.publishing)
        expect((step().getByRole('button', { name: sf.publishingCta }) as HTMLButtonElement).disabled).toBe(true)
        expect(studioApi.loadPublishRun).toHaveBeenCalledWith('r9')
      })
    })

    it('is not on a seat that can’t publish, which never reads the site', async () => {
      api.loadHome.mockResolvedValue(ready)
      await show(owner)
      expect(screen.queryByText(sf.label)).toBeNull()
      expect(brandApi.loadOverview).not.toHaveBeenCalled()
    })
  })

  it('keeps Home when the locale facts fail, leaving that step out', async () => {
    api.loadHome.mockResolvedValue(fresh)
    api.loadLocaleFacts.mockRejectedValue(new Error('down'))
    await show(owner)
    expect(within(screen.getByRole('region', { name: words.setup.title })).getByText('1 of 2')).toBeTruthy()
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
