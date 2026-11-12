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
  loadImportCurrencies: vi.fn(),
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
// Connect Shopify is switched off for now (importFlags.ts); its own tests switch it on.
const flags = vi.hoisted(() => ({ connect: false }))
vi.mock('./importFlags', () => ({
  get connectShopifyEnabled() {
    return flags.connect
  },
}))
const stock = vi.hoisted(() => ({ loadPlaces: vi.fn() }))
vi.mock('../../api/stock', async (actual) => ({ ...(await actual<typeof import('../../api/stock')>()), ...stock }))
const excel = vi.hoisted(() => ({ readSheet: vi.fn() }))
vi.mock('read-excel-file/browser', () => excel)
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
  locations: [],
  conversion: null,
  stockCounted: true,
  problems: [
    { line: 14, column: 'price', code: 'BAD_PRICE', message: 'Price is empty.', file: null },
    { line: 22, column: 'barcode', code: 'BAD_NUMBER', message: 'The barcode isn’t a number.', file: null },
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
  api.loadImportCurrencies.mockResolvedValue({ pricing: 'INR', others: [] })
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
  flags.connect = false
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
    api.loadImport.mockResolvedValueOnce(job({ state: 'unreadable', problems: [{ line: 0, column: null, code: 'EMPTY', message: 'x', file: null }] }))
    await upload(csv('blank.csv'))
    expect(screen.getByRole('alert').textContent).toContain(fill(words.fileErrors.empty.body, { name: 'blank.csv' }))
    api.loadImport.mockResolvedValueOnce(job({ state: 'unreadable', problems: [{ line: 0, column: null, code: 'NO_NAME_COLUMN', message: 'x', file: null }] }))
    await upload(csv('old-template.csv'))
    expect(screen.getByRole('alert').textContent).toContain(words.fileErrors.cols.title)
    expect(screen.getByRole('button', { name: words.fileErrors.chooseAnother })).toBeTruthy()
  })
})

describe('checking and importing a file', () => {
  it('shows what’s ready and what needs fixing, then imports into the chosen location', async () => {
    await show()
    await upload(csv())
    expect(api.startFileImport).toHaveBeenCalledWith('name,price\nTee,10\n', 'csv', null, null)
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
    expect(api.confirmImport).toHaveBeenCalledWith('i1', 'skip', 'w2', null)
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
    // The problems are listed here; the file is offered only because more were found than are listed.
    expect(screen.getByRole('button', { name: words.done.downloadAll })).toBeTruthy()
    const listed = within(screen.getByRole('region', { name: words.done.listTitle }))
    expect(listed.getByText('Price is empty.')).toBeTruthy()
    expect(listed.getByText(fill(words.check.row, { line: '14' }))).toBeTruthy()
    expect(listed.getByText(fill(words.check.moreProblems.one, { count: '1' }))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.done.another }))
    expect(importRun.get()).toBeNull()
    expect(screen.getByRole('button', { name: new RegExp(words.sources.file.title) })).toBeTruthy()
  })

  it('says the run stopped, in the API’s words, when the server ended it', async () => {
    importRun.set(job({ state: 'failed', problems: [{ line: 0, column: null, code: 'SHOPIFY_EXPIRED', message: 'Your Shopify connection has expired.', file: null }] }))
    await show()
    expect(screen.getByRole('alert').textContent).toContain('Your Shopify connection has expired.')
  })
})

describe('a supplier’s import', () => {
  it('puts stock only in the supplier’s own locations, the ones the API answers its seat', async () => {
    const supplier: Acting = { ...owner, role: 'supplier-admin', tier: 'vendor-catalogue', seller: { id: 'v1', name: 'Northwind' }, permissions: ['catalog.read', 'catalog.write', 'catalog.import'] }
    // The API answers a supplier seat its own locations only; the screen never adds the store's.
    stock.loadPlaces.mockResolvedValue([{ id: 'w9', name: 'Anand’s depot', isDefault: true, units: 0, revision: 1, address: null, supplierId: 'v1', supplierName: 'Northwind' }])
    await show(supplier)
    await upload(csv())
    const place = screen.getByLabelText(words.check.stockIn) as HTMLSelectElement
    expect([...place.options].map((o) => o.value)).toEqual(['w9'])
    fireEvent.click(screen.getByRole('button', { name: fill(words.check.run.other, { count: '8' }) }))
    await settle()
    expect(api.confirmImport).toHaveBeenCalledWith('i1', 'update', 'w9', null)
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

  beforeEach(() => {
    flags.connect = true
  })

  const openConnect = async () => {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(words.sources.shopify.title) }))
    await settle()
    fireEvent.click(screen.getByRole('tab', { name: words.shopifyTabs.connect }))
    await settle()
  }

  it('asks for the shop, says when it can’t be found, and sends the person to Shopify to approve', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined)
    await show()
    await openConnect()
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
    await openConnect()
    expect(screen.getByRole('alert').textContent).toBe(words.shopify.expired)
    expect(screen.getByRole('button', { name: words.shopify.again })).toBeTruthy()
    cleanup()
    api.loadShopifyConnection.mockResolvedValueOnce({ available: false, status: 'none', shop: null })
    await show()
    await openConnect()
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

describe('importing Shopify’s CSV files (#1178)', () => {
  const productsFile = () => new File(['Handle,Title\nshirt,Shirt\n'], 'products_export_1.csv', { type: 'text/csv' })
  const inventoryFile = () => new File(['Handle,Location\nshirt,Indiranagar\n'], 'inventory_export_1.csv', { type: 'text/csv' })
  const openCsv = async (acting: Acting = owner) => {
    await show(acting)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(words.sources.shopify.title) }))
    await settle()
  }
  const pick = (label: string, file: File) => fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } })
  const check = async () => {
    fireEvent.click(screen.getByRole('button', { name: words.shopifyCsv.check }))
    await settle()
    await settle()
  }

  it('opens straight to the CSV import while Connect Shopify is off, and the spreadsheet option says it is ours only', async () => {
    await openCsv()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('button', { name: words.shopify.connect })).toBeNull()
    expect(screen.getByRole('heading', { name: words.shopifyCsv.title })).toBeTruthy()
    expect(words.sources.shopify.cta).toBe('Import from Shopify')
    expect(screen.getByText(words.sources.file.body)).toBeTruthy()
  })

  it('shows Connect Shopify beside it as a tab when it is on', async () => {
    flags.connect = true
    await openCsv()
    const tabs = within(screen.getByRole('tablist', { name: words.shopifyTabs.label }))
    expect(tabs.getAllByRole('tab').map((t) => t.textContent)).toEqual([words.shopifyTabs.connect, words.shopifyTabs.csv])
    expect(tabs.getByRole('tab', { name: words.shopifyTabs.csv }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(tabs.getByRole('tab', { name: words.shopifyTabs.connect }))
    await settle()
    expect(screen.getByLabelText(words.shopify.address)).toBeTruthy()
  })

  it('moves between the tabs with the arrow keys, Home and End, so the inactive one is reachable by keyboard', async () => {
    flags.connect = true
    await openCsv()
    const connect = screen.getByRole('tab', { name: words.shopifyTabs.connect })
    const csv = screen.getByRole('tab', { name: words.shopifyTabs.csv })
    expect(screen.getAllByRole('tab').filter((t) => t.tabIndex === 0)).toEqual([csv])
    fireEvent.keyDown(csv, { key: 'ArrowLeft' })
    await settle()
    expect(connect.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(connect)
    fireEvent.keyDown(connect, { key: 'End' })
    await settle()
    expect(csv.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(csv)
    fireEvent.keyDown(csv, { key: 'Home' })
    await settle()
    expect(connect.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(connect, { key: 'ArrowRight' })
    await settle()
    expect(csv.getAttribute('aria-selected')).toBe('true')
  })

  it('needs the products file; the inventory file is optional and goes with it', async () => {
    api.loadImport.mockResolvedValue(job({ source: 'shopify' }))
    await openCsv()
    const button = screen.getByRole('button', { name: words.shopifyCsv.check }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    pick(words.shopifyCsv.products.label, productsFile())
    await settle()
    expect(button.disabled).toBe(false)
    await check()
    expect(api.startFileImport).toHaveBeenLastCalledWith('Handle,Title\nshirt,Shirt\n', 'shopify', null, null)
    cleanup()
    await openCsv()
    pick(words.shopifyCsv.products.label, productsFile())
    pick(words.shopifyCsv.inventory.label, inventoryFile())
    await settle()
    await check()
    expect(api.startFileImport).toHaveBeenLastCalledWith('Handle,Title\nshirt,Shirt\n', 'shopify', 'Handle,Location\nshirt,Indiranagar\n', null)
  })

  it('says a file that is not a CSV or too big is refused without sending either', async () => {
    await openCsv()
    pick(words.shopifyCsv.products.label, productsFile())
    pick(words.shopifyCsv.inventory.label, new File(['x'], 'inventory.txt', { type: 'text/plain' }))
    await settle()
    await check()
    expect(screen.getByRole('alert').textContent).toContain(words.fileErrors.type.title)
    expect(api.startFileImport).not.toHaveBeenCalled()
  })

  it('says the API’s refusal when the file is the other kind, pointing to the other option', async () => {
    api.loadImport.mockResolvedValueOnce(job({ state: 'unreadable', problems: [{ line: 0, column: null, code: 'NOT_SHOPIFY_FILE', message: 'This isn’t a Shopify product export. Use Import from a spreadsheet instead.', file: null }] }))
    await openCsv()
    pick(words.shopifyCsv.products.label, productsFile())
    await settle()
    await check()
    expect(screen.getByRole('alert').textContent).toContain('Use Import from a spreadsheet instead.')
    expect(screen.queryByRole('button', { name: words.fileErrors.chooseAnother })).toBeNull()
  })

  it('matches each Shopify location to a warehouse or leaves it out, and sends the list', async () => {
    api.startFileImport.mockResolvedValue('i3')
    api.loadImport.mockResolvedValue(
      job({ id: 'i3', source: 'shopify', locations: ['Workshop', 'Indiranagar'], problemCount: 1, problems: [{ line: 6, column: 'Handle', code: 'INVENTORY_UNMATCHED', message: 'No product matches.', file: 'inventory' }] }),
    )
    await openCsv()
    pick(words.shopifyCsv.products.label, productsFile())
    pick(words.shopifyCsv.inventory.label, inventoryFile())
    await settle()
    await check()
    expect(screen.queryByLabelText(words.check.stockIn)).toBeNull()
    expect(screen.getByText(fill(words.check.inventoryRow, { line: '6' }))).toBeTruthy()
    // A location starts on the warehouse of the same name, else left out.
    const workshop = screen.getByLabelText(fill(words.check.locationFor, { location: 'Workshop' })) as HTMLSelectElement
    const indiranagar = screen.getByLabelText(fill(words.check.locationFor, { location: 'Indiranagar' })) as HTMLSelectElement
    expect([...workshop.options].map((o) => o.textContent)).toEqual([words.check.skipLocation, 'Workshop', 'Shop floor', 'Anand’s depot'].filter((n) => n !== 'Anand’s depot'))
    expect(workshop.value).toBe('w1')
    expect(indiranagar.value).toBe('')
    fireEvent.change(indiranagar, { target: { value: 'w2' } })
    fireEvent.change(workshop, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: fill(words.check.run.other, { count: '8' }) }))
    await settle()
    expect(api.confirmImport).toHaveBeenCalledWith('i3', 'update', null, [
      { location: 'Workshop', warehouseId: null },
      { location: 'Indiranagar', warehouseId: 'w2' },
    ])
  })

  it('says new products come in at 0 when no stock count came with the files, and keeps the one warehouse', async () => {
    api.startFileImport.mockResolvedValue('i4')
    api.loadImport.mockResolvedValue(job({ id: 'i4', source: 'shopify', stockCounted: false }))
    await openCsv()
    pick(words.shopifyCsv.products.label, productsFile())
    await settle()
    await check()
    expect(screen.getByText(words.check.noStock)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: fill(words.check.run.other, { count: '8' }) }))
    await settle()
    expect(api.confirmImport).toHaveBeenCalledWith('i4', 'update', 'w1', null)
  })

  it('reads Excel files into CSV text before sending, and refuses one it can’t read', async () => {
    api.loadImport.mockResolvedValue(job({ source: 'shopify' }))
    excel.readSheet.mockResolvedValueOnce([['Handle', 'Title', 'Variant Grams'], ['shirt', 'Shirt, "red"', 0]])
    await openCsv()
    pick(words.shopifyCsv.products.label, new File(['x'], 'products_export_1.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    await settle()
    await check()
    expect(api.startFileImport).toHaveBeenLastCalledWith('Handle,Title,Variant Grams\nshirt,"Shirt, ""red""",0', 'shopify', null, null)
    cleanup()
    excel.readSheet.mockRejectedValueOnce(new Error('not a zip'))
    await openCsv()
    pick(words.shopifyCsv.products.label, new File(['x'], 'broken.xlsx'))
    await settle()
    await check()
    expect(screen.getByRole('alert').textContent).toContain(fill(words.fileErrors.excelUnreadable, { name: 'broken.xlsx' }))
    expect(api.startFileImport).toHaveBeenCalledTimes(1)
  })

  const openSheet = async () => {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(words.sources.file.title) }))
    await settle()
  }

  it('shows one currency dropdown at a time: the spreadsheet’s panel, or Shopify’s own panel’s', async () => {
    api.loadImportCurrencies.mockResolvedValue({ pricing: 'INR', others: ['USD'] })
    await show()
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
    await openSheet()
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
    expect(screen.getByLabelText(words.sources.file.currency.label)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(words.sources.shopify.title) }))
    await settle()
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
    expect(screen.getByLabelText(words.shopifyCsv.currency.label)).toBeTruthy()
  })

  it('opens a panel under the cards instead of the file picker, and the picker opens from its button', async () => {
    const picked = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)
    await show()
    await openSheet()
    expect(picked).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: new RegExp(words.sources.file.title) }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: words.sources.file.choose }))
    expect(picked).toHaveBeenCalledTimes(1)
    picked.mockRestore()
  })

  it('says why a spreadsheet can’t be imported inside its panel, above the options', async () => {
    api.startFileImport.mockRejectedValue(new ApiError('INVALID_INPUT', 'This is a Shopify export.', {}))
    await show()
    await openSheet()
    await upload(csv())
    const panel = screen.getByRole('heading', { name: words.sources.file.title, level: 2 }).parentElement as HTMLElement
    expect(within(panel).getByRole('alert').textContent).toContain('This is a Shopify export.')
  })

  it('asks which currency the spreadsheet’s prices are in once the store has rates, and sends a choice other than its own', async () => {
    await show()
    await openSheet()
    expect(screen.queryByLabelText(words.sources.file.currency.label)).toBeNull()
    cleanup()
    api.loadImportCurrencies.mockResolvedValue({ pricing: 'INR', others: ['USD'] })
    await show()
    await openSheet()
    const select = screen.getByLabelText(words.sources.file.currency.label) as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual([fill(words.shopifyCsv.currency.own, { code: 'INR' }), 'USD'])
    await upload(csv())
    expect(api.startFileImport).toHaveBeenLastCalledWith('name,price\nTee,10\n', 'csv', null, null)
    cleanup()
    await show()
    await openSheet()
    fireEvent.change(screen.getByLabelText(words.sources.file.currency.label), { target: { value: 'USD' } })
    await upload(csv())
    expect(api.startFileImport).toHaveBeenLastCalledWith('name,price\nTee,10\n', 'csv', null, 'USD')
  })

  it('takes an Excel sheet on the spreadsheet option too, read into CSV text, and refuses one it can’t read', async () => {
    excel.readSheet.mockResolvedValueOnce([['name', 'price'], ['Tee', 10]])
    await show()
    await upload(new File(['x'], 'products.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    expect(api.startFileImport).toHaveBeenLastCalledWith('name,price\nTee,10', 'csv', null, null)
    excel.readSheet.mockRejectedValueOnce(new Error('not a zip'))
    cleanup()
    await show()
    await upload(new File(['x'], 'broken.xlsx'))
    expect(screen.getByRole('alert').textContent).toContain(fill(words.fileErrors.excelUnreadable, { name: 'broken.xlsx' }))
    await upload(new File(['x'], 'photos.zip', { type: 'application/zip' }))
    expect(screen.getByRole('alert').textContent).toContain(words.fileErrors.type.title)
  })

  it('asks which currency the prices are in once the store has rates, and sends a choice other than its own', async () => {
    api.loadImport.mockResolvedValue(job({ source: 'shopify' }))
    await openCsv()
    expect(screen.queryByLabelText(words.shopifyCsv.currency.label)).toBeNull()
    cleanup()
    api.loadImportCurrencies.mockResolvedValue({ pricing: 'INR', others: ['USD'] })
    await openCsv()
    pick(words.shopifyCsv.products.label, productsFile())
    await settle()
    const select = screen.getByLabelText(words.shopifyCsv.currency.label) as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual([fill(words.shopifyCsv.currency.own, { code: 'INR' }), 'USD'])
    await check()
    expect(api.startFileImport).toHaveBeenLastCalledWith('Handle,Title\nshirt,Shirt\n', 'shopify', null, null)
    cleanup()
    await openCsv()
    pick(words.shopifyCsv.products.label, productsFile())
    fireEvent.change(screen.getByLabelText(words.shopifyCsv.currency.label), { target: { value: 'USD' } })
    await settle()
    await check()
    expect(api.startFileImport).toHaveBeenLastCalledWith('Handle,Title\nshirt,Shirt\n', 'shopify', null, 'USD')
  })

  it('says on the check what the prices were converted from and to, and at which day’s rates', async () => {
    api.loadImport.mockResolvedValue(job({ source: 'shopify', conversion: { from: 'INR', to: 'USD', on: '2026-11-02' } }))
    await openCsv()
    pick(words.shopifyCsv.products.label, productsFile())
    await settle()
    await check()
    expect(screen.getByText(fill(words.check.converted, { from: 'INR', to: 'USD', date: '2026-11-02' }))).toBeTruthy()
  })

  it('locks the tab with the upgrade prompt on a plan without it, and asks a Manager to ask the Owner', async () => {
    api.startFileImport.mockRejectedValue(new ApiError('PLAN_LIMIT', 'Not on your plan.', { unlockedBy: { name: 'Growth' } }))
    await openCsv({ ...owner, permissions: [...owner.permissions, 'billing'] })
    pick(words.shopifyCsv.products.label, productsFile())
    await settle()
    await check()
    expect(screen.getByRole('status').textContent).toBe(fill(words.shopifyCsv.locked, { plan: 'Growth' }))
    expect(screen.queryByRole('button', { name: words.shopifyCsv.check })).toBeNull()
    cleanup()
    await openCsv({ ...owner, role: 'manager' })
    pick(words.shopifyCsv.products.label, productsFile())
    await settle()
    await check()
    expect(screen.getByRole('status').textContent).toBe(`${words.shopifyCsv.lockedAnyPlan} ${words.shopifyCsv.askOwner}`)
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

  const listed = (id: string, state: 'ready' | 'failed' | 'preparing', url: string | null = null) => ({ id, state, entries: state === 'ready' ? 42 : null, url, expiresAt: null, kind: 'products' as const, requestedAt: '2026-10-06T10:00:00Z' })

  it('fetches a finished export by its id for its file, and shows Download', async () => {
    api.loadCatalogExports.mockResolvedValue([listed('e1', 'ready'), listed('e0', 'ready', 'blob:e0')])
    api.loadCatalogExport.mockResolvedValue(listed('e1', 'ready', 'blob:e1'))
    await show()
    const card = within(screen.getByRole('region', { name: words.export.title }))
    expect(card.getAllByRole('link', { name: words.export.download }).map((a) => a.getAttribute('href'))).toEqual(['blob:e1', 'blob:e0'])
    expect(api.loadCatalogExport).toHaveBeenCalledTimes(1)
    expect(api.loadCatalogExport).toHaveBeenCalledWith('e1')
    expect(card.queryByText(words.export.failed)).toBeNull()
  })

  it('shows Couldn’t be made only for an export that failed, and fetches nothing for it', async () => {
    api.loadCatalogExports.mockResolvedValue([listed('e1', 'failed')])
    await show()
    const card = within(screen.getByRole('region', { name: words.export.title }))
    expect(card.getByText(words.export.failed)).toBeTruthy()
    expect(card.queryByRole('link', { name: words.export.download })).toBeNull()
    expect(api.loadCatalogExport).not.toHaveBeenCalled()
  })

  it('turns Preparing… into Download without reloading the page', async () => {
    api.loadCatalogExports.mockResolvedValueOnce([listed('e1', 'preparing')]).mockResolvedValue([listed('e1', 'ready')])
    api.loadCatalogExport.mockResolvedValue(listed('e1', 'ready', 'blob:e1'))
    await show()
    const card = within(screen.getByRole('region', { name: words.export.title }))
    expect(card.getByText(words.export.preparing)).toBeTruthy()
    await act(async () => new Promise((resolve) => setTimeout(resolve, 1700)))
    await settle()
    expect(card.getByRole('link', { name: words.export.download }).getAttribute('href')).toBe('blob:e1')
    expect(card.queryByText(words.export.preparing)).toBeNull()
  })
})

describe('while a file is being checked (#1195)', () => {
  const sourceButton = (title: string) => screen.getByRole('button', { name: new RegExp(title) }) as HTMLButtonElement
  const choose = (file: File) => fireEvent.change(screen.getByLabelText(words.sources.file.cta), { target: { files: [file] } })

  it('fades and disables the two cards the moment a CSV is chosen, with the loader on the spreadsheet card only', async () => {
    api.startFileImport.mockReturnValue(new Promise(() => undefined))
    await show()
    choose(csv())
    // Before the file is even read.
    expect(sourceButton(words.sources.file.title).disabled).toBe(true)
    expect(sourceButton(words.sources.shopify.title).disabled).toBe(true)
    await settle()
    expect(sourceButton(words.sources.file.title).textContent).toContain(words.checking.file)
    expect(sourceButton(words.sources.shopify.title).textContent).not.toContain(words.checking.file)
    expect(sourceButton(words.sources.template.title).disabled).toBe(false)
    expect(screen.getAllByRole('status').filter((s) => s.textContent === words.checking.file)).toHaveLength(1)
  })

  it('leaves the template working while the file loads', async () => {
    api.startFileImport.mockReturnValue(new Promise(() => undefined))
    api.loadImportTemplate.mockResolvedValue('handle,name\n')
    const made = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:t')
    await show()
    choose(csv())
    await settle()
    fireEvent.click(sourceButton(words.sources.template.title))
    await settle()
    expect(api.loadImportTemplate).toHaveBeenCalled()
    made.mockRestore()
  })

  it('does the same for Shopify’s CSV files: the cards, both pickers and the button are held, with the loader on the Shopify card', async () => {
    api.startFileImport.mockReturnValue(new Promise(() => undefined))
    await show()
    fireEvent.click(sourceButton(words.sources.shopify.title))
    await settle()
    fireEvent.change(screen.getByLabelText(words.shopifyCsv.products.label), { target: { files: [new File(['Handle,Title\nshirt,Shirt\n'], 'products_export_1.csv', { type: 'text/csv' })] } })
    fireEvent.click(screen.getByRole('button', { name: words.shopifyCsv.check }))
    await settle()
    expect(sourceButton(words.sources.file.title).disabled).toBe(true)
    expect(sourceButton(words.sources.shopify.title).disabled).toBe(true)
    expect(sourceButton(words.sources.shopify.title).textContent).toContain(words.checking.file)
    expect((screen.getByLabelText(words.shopifyCsv.products.label) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText(words.shopifyCsv.inventory.label) as HTMLInputElement).disabled).toBe(true)
    const panel = within(screen.getByRole('heading', { name: words.shopifyCsv.title }).parentElement as HTMLElement)
    const held = panel.getByRole('button', { name: new RegExp(words.checking.file) }) as HTMLButtonElement
    expect(held.disabled).toBe(true)
    expect(sourceButton(words.sources.template.title).disabled).toBe(false)
  })

  it('brings the cards back with the error when the upload is refused', async () => {
    api.startFileImport.mockRejectedValue(new ApiError('INVALID_INPUT', 'Choose a CSV file to import.', {}))
    await show()
    await upload(csv())
    expect(sourceButton(words.sources.file.title).disabled).toBe(false)
    expect(sourceButton(words.sources.shopify.title).disabled).toBe(false)
    expect(sourceButton(words.sources.file.title).textContent).toContain(words.sources.file.cta)
    expect(screen.getByRole('alert').textContent).toContain('Choose a CSV file to import.')
  })

  it('brings the cards back when the check finds the file unreadable, and when the file is the wrong type', async () => {
    api.loadImport.mockResolvedValueOnce(job({ state: 'unreadable', problems: [{ line: 0, column: null, code: 'EMPTY', message: 'x', file: null }] }))
    await show()
    await upload(csv('blank.csv'))
    expect(sourceButton(words.sources.file.title).disabled).toBe(false)
    expect(screen.getByRole('alert').textContent).toContain(words.fileErrors.empty.title)
    await upload(new File(['x'], 'photos.zip', { type: 'application/zip' }))
    expect(sourceButton(words.sources.file.title).disabled).toBe(false)
    expect(sourceButton(words.sources.shopify.title).disabled).toBe(false)
    expect(screen.getByRole('alert').textContent).toContain(words.fileErrors.type.title)
  })

  const checkShopify = async (file: File) => {
    fireEvent.click(sourceButton(words.sources.shopify.title))
    await settle()
    fireEvent.change(screen.getByLabelText(words.shopifyCsv.products.label), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: words.shopifyCsv.check }))
    await settle()
    await settle()
  }

  it('brings the cards back when an Excel file can’t be read', async () => {
    excel.readSheet.mockRejectedValueOnce(new Error('not a zip'))
    await show()
    await checkShopify(new File(['x'], 'broken.xlsx'))
    expect(sourceButton(words.sources.file.title).disabled).toBe(false)
    expect(sourceButton(words.sources.shopify.title).disabled).toBe(false)
    expect(screen.getByRole('alert').textContent).toContain(fill(words.fileErrors.excelUnreadable, { name: 'broken.xlsx' }))
  })

  it('brings the cards back when the plan doesn’t include the Shopify file import', async () => {
    api.startFileImport.mockRejectedValue(new ApiError('PLAN_LIMIT', 'Not on your plan.', { unlockedBy: { name: 'Growth' } }))
    await show()
    await checkShopify(new File(['Handle,Title\nshirt,Shirt\n'], 'products_export_1.csv', { type: 'text/csv' }))
    expect(sourceButton(words.sources.file.title).disabled).toBe(false)
    expect(sourceButton(words.sources.shopify.title).disabled).toBe(false)
    expect(screen.getByRole('status').textContent).toContain(words.shopifyCsv.lockedAnyPlan)
  })

  it('moves focus to the loading notice when the card in use is disabled', async () => {
    api.startFileImport.mockReturnValue(new Promise(() => undefined))
    await show()
    sourceButton(words.sources.file.title).focus()
    choose(csv())
    await settle()
    const notice = screen.getAllByRole('status').find((s) => s.textContent === words.checking.file)
    expect(document.activeElement).toBe(notice?.closest('.df-import-loading'))
  })
})
