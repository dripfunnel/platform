// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogImport } from '../../api/imports'
import type { Acting } from '../../api/shell'
import { fill, messages } from '../../messages'

// Import & export (designs/CatImport.dc.html): every state of Choose → Check → Import → Done, Shopify's connect and
// pick, the read-only store, the seat that can't import, and the exports.

const words = messages.imports

const api = vi.hoisted(() => ({
  loadImport: vi.fn(),
  loadImports: vi.fn(),
  startFileImport: vi.fn(),
  confirmImport: vi.fn(),
  loadImportTemplate: vi.fn(),
  loadShopifyConnection: vi.fn(),
  loadShopifyProducts: vi.fn(),
  connectShopify: vi.fn(),
  finishShopifyConnect: vi.fn(),
  startShopifyImport: vi.fn(),
  loadCatalogExports: vi.fn(),
  loadCatalogExport: vi.fn(),
  requestProductExport: vi.fn(),
}))
vi.mock('../../api/imports', async (actual) => ({ ...(await actual<typeof import('../../api/imports')>()), ...api }))
const stock = vi.hoisted(() => ({ loadPlaces: vi.fn() }))
vi.mock('../../api/stock', async (actual) => ({ ...(await actual<typeof import('../../api/stock')>()), ...stock }))
const products = vi.hoisted(() => ({ loadProductCounts: vi.fn() }))
vi.mock('../../api/products', async (actual) => ({ ...(await actual<typeof import('../../api/products')>()), ...products }))

const { ImportPage } = await import('./ImportPage')
const { importRun } = await import('./importRun')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['catalog.read', 'catalog.write', 'catalog.import'] }

const job = (patch: Partial<CatalogImport> = {}): CatalogImport => ({
  id: 'i1',
  state: 'ready',
  source: 'csv',
  products: 10,
  ready: 8,
  matched: 2,
  done: 0,
  created: 0,
  updated: 0,
  skipped: 0,
  failed: 0,
  photosPending: 0,
  problemCount: 3,
  problems: [
    { line: 14, column: 'price', code: 'BAD_PRICE', message: 'Price is empty.' },
    { line: 22, column: 'barcode', code: 'BAD_NUMBER', message: 'The barcode isn’t a number.' },
  ],
  problemsCsv: null,
  ...patch,
})

const show = async (acting: Acting = owner, { readOnly = false, at = '/products/import' } = {}) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const list = createRoute({ getParentRoute: () => app, path: '/products', component: () => <p>The list</p> })
  const page = createRoute({ getParentRoute: () => app, path: '/products/import', component: ImportPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([list, page])]), history: createMemoryHistory({ initialEntries: [at] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
}
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const upload = async (file: File) => {
  fireEvent.change(screen.getByLabelText(words.sources.file.cta), { target: { files: [file] } })
  await settle()
  await settle()
}
const csv = (name = 'spring-range.csv', text = 'name,price\nTee,10\n') => new File([text], name, { type: 'text/csv' })

beforeEach(() => {
  importRun.set(null)
  api.loadCatalogExports.mockResolvedValue([])
  api.loadImports.mockResolvedValue([])
  api.startFileImport.mockResolvedValue('i1')
  api.loadImport.mockResolvedValue(job())
  api.confirmImport.mockResolvedValue(undefined)
  api.loadShopifyConnection.mockResolvedValue({ available: true, status: 'none', shop: null })
  stock.loadPlaces.mockResolvedValue([
    { id: 'w1', name: 'Workshop', isDefault: true, units: 0, revision: 1, address: null, supplierId: null, supplierName: null },
    { id: 'w2', name: 'Shop floor', isDefault: false, units: 0, revision: 1, address: null, supplierId: null, supplierName: null },
    { id: 'w9', name: 'Anand’s depot', isDefault: true, units: 0, revision: 1, address: null, supplierId: 'v1', supplierName: 'Anand' },
  ])
  products.loadProductCounts.mockResolvedValue({ all: 42, visible: 40, hidden: 2, pending: 0, sentBack: 0, lowStock: 0, missingInfo: 0, fromSuppliers: 0, outOfStock: 0 })
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('choosing what to import', () => {
  it('offers a spreadsheet, Shopify and the template, on step one of four', async () => {
    await show()
    expect(screen.getByRole('heading', { level: 1, name: words.title })).toBeTruthy()
    const steps = within(screen.getByRole('list', { name: words.steps.label }))
    expect(steps.getAllByRole('listitem')).toHaveLength(4)
    expect(steps.getByText(fill(words.steps.current, { step: words.steps.choose }))).toBeTruthy()
    for (const source of [words.sources.file.title, words.sources.shopify.title, words.sources.template.title]) expect(screen.getByRole('button', { name: new RegExp(source) })).toBeTruthy()
  })

  it('downloads the API’s template', async () => {
    api.loadImportTemplate.mockResolvedValue('handle,name\n')
    const made = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:t')
    await show()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(words.sources.template.title) }))
    await settle()
    expect(api.loadImportTemplate).toHaveBeenCalled()
    expect(made).toHaveBeenCalled()
    made.mockRestore()
  })

  it('refuses a file that isn’t a CSV or is too big without sending it', async () => {
    await show()
    await upload(new File(['x'], 'product-photos.zip', { type: 'application/zip' }))
    expect(screen.getByRole('alert').textContent).toContain(words.fileErrors.type.title)
    await upload(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'full-catalogue.csv', { type: 'text/csv' }))
    expect(screen.getByRole('alert').textContent).toContain(words.fileErrors.big.title)
    expect(api.startFileImport).not.toHaveBeenCalled()
  })

  it('says why the check couldn’t read the file, in CatImport’s words for an empty file or missing columns', async () => {
    await show()
    api.loadImport.mockResolvedValueOnce(job({ state: 'unreadable', problems: [{ line: 0, column: null, code: 'EMPTY', message: 'x' }] }))
    await upload(csv('blank.csv'))
    expect(screen.getByRole('alert').textContent).toContain(fill(words.fileErrors.empty.body, { name: 'blank.csv' }))
    api.loadImport.mockResolvedValueOnce(job({ state: 'unreadable', problems: [{ line: 0, column: null, code: 'NO_NAME_COLUMN', message: 'x' }] }))
    await upload(csv('old-template.csv'))
    expect(screen.getByRole('alert').textContent).toContain(words.fileErrors.cols.title)
    expect(screen.getByRole('button', { name: words.fileErrors.chooseAnother })).toBeTruthy()
  })
})

describe('checking and importing a file', () => {
  it('shows what’s ready and what needs fixing, then imports into the chosen location', async () => {
    await show()
    await upload(csv())
    expect(api.startFileImport).toHaveBeenCalledWith('name,price\nTee,10\n')
    expect(screen.getByText(fill(words.check.ready, { count: '8' }))).toBeTruthy()
    expect(screen.getByText(fill(words.check.readyNote, { new: '6', matched: '2' }))).toBeTruthy()
    expect(screen.getByText(fill(words.check.problems, { count: '2' }))).toBeTruthy()
    expect(screen.getByText('Price is empty.')).toBeTruthy()
    expect(screen.getByText(fill(words.check.moreProblems.one, { count: '1' }))).toBeTruthy()
    // Only the store's own locations, the default first chosen; a supplier's isn't the merchant's to fill.
    const place = screen.getByLabelText(words.check.stockIn) as HTMLSelectElement
    expect([...place.options].map((o) => o.textContent)).toEqual([fill(words.check.isDefault, { name: 'Workshop' }), 'Shop floor'])
    fireEvent.change(place, { target: { value: 'w2' } })
    // Skipping the ones already here imports the new ones only.
    fireEvent.click(screen.getByLabelText(words.check.skip))
    fireEvent.click(screen.getByRole('button', { name: fill(words.check.run.other, { count: '6' }) }))
    await settle()
    expect(api.confirmImport).toHaveBeenCalledWith('i1', 'skip', 'w2')
    expect(screen.getByRole('heading', { name: fill(words.running.title.other, { count: '8' }) })).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0')
  })

  it('says what a refused confirm means, and lets it be tried again', async () => {
    api.confirmImport.mockRejectedValueOnce(new ApiError('WAREHOUSE_NOT_FOUND', 'Choose one of your locations.'))
    await show()
    await upload(csv())
    fireEvent.click(screen.getByRole('button', { name: fill(words.check.run.other, { count: '8' }) }))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe('Choose one of your locations.')
    expect((screen.getByRole('button', { name: fill(words.check.run.other, { count: '8' }) }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('follows the run, paused while offline, then says what went in with the file of what didn’t', async () => {
    importRun.set(job({ state: 'running', done: 3 }))
    await show()
    expect(screen.getByText(fill(words.running.progress, { done: '3', total: '8' }))).toBeTruthy()
    await act(async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.getByText(words.running.pausedTitle)).toBeTruthy()
    await act(async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
      window.dispatchEvent(new Event('online'))
      importRun.set(job({ state: 'done', done: 8, created: 5, updated: 2, failed: 1, problemsCsv: 'row,problem\n' }))
    })
    expect(screen.getByRole('heading', { name: fill(words.done.title, { added: '5', updated: '2' }) })).toBeTruthy()
    expect(screen.getByText(new RegExp(fill(words.done.skipped.other, { count: '2' })))).toBeTruthy()
    expect(screen.getByRole('button', { name: words.done.download })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.done.another }))
    expect(importRun.get()).toBeNull()
    expect(screen.getByRole('button', { name: new RegExp(words.sources.file.title) })).toBeTruthy()
  })

  it('says the run stopped, in the API’s words, when the server ended it', async () => {
    importRun.set(job({ state: 'failed', problems: [{ line: 0, column: null, code: 'SHOPIFY_EXPIRED', message: 'Your Shopify connection has expired.' }] }))
    await show()
    expect(screen.getByRole('alert').textContent).toContain('Your Shopify connection has expired.')
  })
})

describe('a store that can’t import', () => {
  it('keeps a read-only store to exports: the sources and Import are off, and it says why', async () => {
    await show(owner, { readOnly: true })
    expect(screen.getByText(words.readOnly)).toBeTruthy()
    expect((screen.getByRole('button', { name: new RegExp(words.sources.file.title) }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: new RegExp(words.sources.template.title) }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByRole('button', { name: fill(words.export.all, { count: '42' }) })).toBeTruthy()
  })

  it('tells a seat without catalog.import it has no access, and asks the API nothing', async () => {
    await show({ ...owner, role: 'staff', permissions: ['catalog.read'] })
    expect(screen.getByRole('heading', { name: words.denied.title })).toBeTruthy()
    expect(api.loadCatalogExports).not.toHaveBeenCalled()
  })
})

describe('bringing products from Shopify', () => {
  const shopRows = [
    { id: 'gid://shopify/Product/1', title: 'Linen shirt', status: 'ACTIVE', versions: 3, imageUrl: null },
    { id: 'gid://shopify/Product/2', title: 'Cap', status: 'DRAFT', versions: 1, imageUrl: null },
  ]

  it('asks for the shop, says when it can’t be found, and sends the person to Shopify to approve', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined)
    await show()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(words.sources.shopify.title) }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: words.shopify.connect }))
    expect(screen.getByRole('alert').textContent).toBe(words.shopify.required)
    fireEvent.change(screen.getByLabelText(words.shopify.address), { target: { value: 'nope' } })
    api.connectShopify.mockRejectedValueOnce(new ApiError('INVALID_SHOP', 'x'))
    fireEvent.click(screen.getByRole('button', { name: words.shopify.connect }))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(fill(words.shopify.notFound, { shop: 'nope' }))
    api.connectShopify.mockResolvedValueOnce('https://kesari.myshopify.com/admin/oauth/authorize?state=s')
    fireEvent.change(screen.getByLabelText(words.shopify.address), { target: { value: 'kesari.myshopify.com' } })
    fireEvent.click(screen.getByRole('button', { name: words.shopify.connect }))
    await settle()
    expect(api.connectShopify).toHaveBeenLastCalledWith('kesari.myshopify.com')
    expect(assign).toHaveBeenCalledWith('https://kesari.myshopify.com/admin/oauth/authorize?state=s')
    assign.mockRestore()
  })

  it('says a lapsed connection expired, and that Shopify isn’t set up where it isn’t', async () => {
    api.loadShopifyConnection.mockResolvedValueOnce({ available: true, status: 'expired', shop: 'kesari.myshopify.com' })
    await show()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(words.sources.shopify.title) }))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(words.shopify.expired)
    expect(screen.getByRole('button', { name: words.shopify.again })).toBeTruthy()
    cleanup()
    api.loadShopifyConnection.mockResolvedValueOnce({ available: false, status: 'none', shop: null })
    await show()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(words.sources.shopify.title) }))
    await settle()
    expect(screen.getByText(words.shopify.unavailable)).toBeTruthy()
  })

  it('finishes the connection on the way back, then checks the picked products, or all of them', async () => {
    api.finishShopifyConnect.mockResolvedValue('kesari.myshopify.com')
    api.loadShopifyProducts.mockResolvedValue({ nodes: shopRows, next: null })
    api.startShopifyImport.mockResolvedValue('i2')
    api.loadImport.mockResolvedValue(job({ id: 'i2', source: 'shopify' }))
    await show(owner, { at: '/products/import?shopify=finish&key=k1' })
    await settle()
    expect(api.finishShopifyConnect).toHaveBeenCalledWith('k1')
    expect(screen.getByRole('heading', { name: fill(words.pick.title, { shop: 'kesari.myshopify.com' }) })).toBeTruthy()
    expect(screen.getByText(`${words.pick.draft} · ${fill(words.pick.versions.one, { count: '1' })}`)).toBeTruthy()
    // The first page comes ticked; unticking both leaves nothing to check.
    fireEvent.click(screen.getByLabelText(/Linen shirt/))
    fireEvent.click(screen.getByLabelText(/Cap/))
    fireEvent.click(screen.getByRole('button', { name: fill(words.pick.check.other, { count: '0' }) }))
    expect(screen.getByRole('alert').textContent).toBe(words.pick.none)
    fireEvent.click(screen.getByLabelText(/Linen shirt/))
    fireEvent.click(screen.getByRole('button', { name: fill(words.pick.check.one, { count: '1' }) }))
    await settle()
    await settle()
    expect(api.startShopifyImport).toHaveBeenCalledWith(['gid://shopify/Product/1'])
    expect(screen.getByText(fill(words.check.ready, { count: '8' }))).toBeTruthy()
    expect(screen.getByText('kesari.myshopify.com')).toBeTruthy()
  })

  it('checks every product when all are selected, and says a failed connection on the way back', async () => {
    api.finishShopifyConnect.mockResolvedValue('kesari.myshopify.com')
    api.loadShopifyProducts.mockResolvedValue({ nodes: shopRows, next: 'c1' })
    api.startShopifyImport.mockResolvedValue('i2')
    await show(owner, { at: '/products/import?shopify=finish&key=k1' })
    await settle()
    fireEvent.click(screen.getByRole('button', { name: words.pick.selectAll }))
    expect(screen.getByText(words.pick.allChosen)).toBeTruthy()
    // With more pages to come, unticking one would drop every product not loaded yet: it's refused, still "all".
    fireEvent.click(screen.getByLabelText(/Cap/))
    expect(screen.getByRole('alert').textContent).toBe(words.pick.loadAll)
    fireEvent.click(screen.getByRole('button', { name: words.pick.checkAll }))
    await settle()
    expect(api.startShopifyImport).toHaveBeenCalledWith(null)
    cleanup()
    await show(owner, { at: '/products/import?shopify=failed' })
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(words.shopify.failed)
  })
})

describe('picking from a big shop', () => {
  it('loads the next page once however often Show more is pressed, and keeps the ticks when it fails', async () => {
    const rows = (from: number) => [0, 1].map((i) => ({ id: `gid://shopify/Product/${from + i}`, title: `Item ${from + i}`, status: 'ACTIVE', versions: 1, imageUrl: null }))
    api.finishShopifyConnect.mockResolvedValue('kesari.myshopify.com')
    let release: (v: unknown) => void = () => undefined
    api.loadShopifyProducts.mockResolvedValueOnce({ nodes: rows(1), next: 'c1' }).mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
    await show(owner, { at: '/products/import?shopify=finish&key=k1' })
    await settle()
    fireEvent.click(screen.getByLabelText(/Item 2/))
    const moreButton = screen.getByRole('button', { name: words.pick.more }) as HTMLButtonElement
    fireEvent.click(moreButton)
    expect(moreButton.disabled).toBe(true)
    fireEvent.click(moreButton)
    expect(api.loadShopifyProducts).toHaveBeenCalledTimes(2)
    await act(async () => release(Promise.reject(new Error('offline'))))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(words.pick.moreFailed)
    // The rows and what was unticked stay; trying again asks for the same page.
    expect((screen.getByLabelText(/Item 1/) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText(/Item 2/) as HTMLInputElement).checked).toBe(false)
    api.loadShopifyProducts.mockResolvedValueOnce({ nodes: rows(3), next: null })
    fireEvent.click(screen.getByRole('button', { name: words.pick.more }))
    await settle()
    expect(api.loadShopifyProducts).toHaveBeenLastCalledWith('c1')
    expect(screen.getAllByRole('checkbox')).toHaveLength(4)
  })
})

describe('exports', () => {
  it('lists the caller’s recent files and starts one for the hidden products', async () => {
    api.loadCatalogExports.mockResolvedValue([
      { id: 'e1', state: 'ready', entries: 42, url: 'blob:e1', expiresAt: '2026-10-06T11:00:00Z', kind: 'products', requestedAt: '2026-10-06T10:00:00Z' },
      { id: 'e0', state: 'expired', entries: 40, url: null, expiresAt: null, kind: 'products', requestedAt: '2026-10-05T10:00:00Z' },
    ])
    api.requestProductExport.mockResolvedValue({ id: 'e2', state: 'preparing', entries: null, url: null, expiresAt: null, kind: 'products', requestedAt: '2026-10-06T10:05:00Z' })
    await show()
    const card = within(screen.getByRole('region', { name: words.export.title }))
    expect(card.getByRole('link', { name: words.export.download }).getAttribute('href')).toBe('blob:e1')
    expect(card.getByText(words.export.expired)).toBeTruthy()
    fireEvent.click(card.getByRole('button', { name: words.export.hidden }))
    await settle()
    expect(api.requestProductExport).toHaveBeenCalledWith({ filter: 'hidden' })
    expect(card.getByText(words.export.preparing)).toBeTruthy()
  })
})
