// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorProduct } from '../../api/productEditor'
import type { Acting } from '../../api/shell'
import { messages } from '../../messages'
import { editorAccessOf } from '../common/access'

// CatEditor driven as each seat would (FIRST-RELEASE §11): what loads, what a save sends, what each refusal says.

const words = messages.editor

const api = vi.hoisted(() => ({
  loadProduct: vi.fn(),
  loadProductBasics: vi.fn(),
  loadFacets: vi.fn(),
  loadStoreCurrencies: vi.fn(),
  loadPricing: vi.fn(),
  loadMarkets: vi.fn(),
  loadSizeCharts: vi.fn(),
  loadProductCollections: vi.fn(),
  setProductCollections: vi.fn(),
  loadTaxSetup: vi.fn(),
  loadApprovalRequired: vi.fn(),
  saveProduct: vi.fn(),
  uploadPhoto: vi.fn(),
}))
const listApi = vi.hoisted(() => ({ deleteProducts: vi.fn(), loadHandPicked: vi.fn(), loadProducts: vi.fn() }))
const translationApi = vi.hoisted(() => ({ loadProductTranslation: vi.fn(), saveProductTranslation: vi.fn() }))
const kindApi = vi.hoisted(() => ({ loadProductKind: vi.fn(), saveProductKind: vi.fn(), addLicenceKeys: vi.fn(), uploadDownload: vi.fn(), loadGiftCards: vi.fn(), issueGiftCard: vi.fn() }))
const stockApi = vi.hoisted(() => ({ loadProductStock: vi.fn(), loadWarehouses: vi.fn(), loadStockHistory: vi.fn(), adjustStock: vi.fn(), setStock: vi.fn() }))

vi.mock('../../api/productEditor', async (actual) => ({ ...(await actual<typeof import('../../api/productEditor')>()), ...api }))
vi.mock('../../api/products', async (actual) => ({ ...(await actual<typeof import('../../api/products')>()), ...listApi }))
vi.mock('../../api/translations', async (actual) => ({ ...(await actual<typeof import('../../api/translations')>()), ...translationApi }))
vi.mock('../../api/productKinds', async (actual) => ({ ...(await actual<typeof import('../../api/productKinds')>()), ...kindApi }))
vi.mock('../../api/stock', async (actual) => ({ ...(await actual<typeof import('../../api/stock')>()), ...stockApi }))

const { ProductEditor } = await import('./ProductEditor')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['catalog.read', 'catalog.write', 'stock.read', 'stock.write', 'approve', 'tax.configure'] }
const staff: Acting = { ...owner, role: 'staff', permissions: ['catalog.read', 'stock.read'] }
const supplier: Acting = { ...owner, role: 'supplier-member', tier: 'vendor-catalogue', seller: { id: 'v1', name: 'Northwind Textiles' }, permissions: ['catalog.read', 'catalog.write', 'stock.write'] }
const stockOnly: Acting = { ...supplier, tier: 'vendor-stock', permissions: ['catalog.read', 'stock.write', 'catalog.propose'] }

const cushion = (p: Partial<EditorProduct> = {}): EditorProduct => ({
  id: 'p1',
  revision: 2,
  name: 'Block-print Cushion',
  description: '',
  productType: 'physical',
  visible: true,
  approval: null,
  sentBackReason: null,
  supplier: null,
  slug: 'block-print-cushion',
  seoTitle: null,
  seoDescription: null,
  pricingCurrency: 'INR', listing: { specs: [], highlights: [], faqs: [], relatedIds: [], related: [], badgeIds: [], compliance: [], ageRestricted: null, hazardous: null }, filterValues: [], sizeChartId: null, 
  photos: [],
  options: [],
  versions: [{ id: 'ver-1', choices: [], name: null, sku: null, barcode: null, visible: true, prices: [{ currency: 'INR', amount: '129900', compareAtAmount: null }], cost: null, weightGrams: null, lengthMm: null, widthMm: null, heightMm: null, hsCode: null, taxClassId: null, trackStock: true, continueSelling: false }],
  readiness: [{ marketId: 'm1', marketName: 'India', ready: true, missing: [] }],
  ...p,
})

const home = { id: 'w1', name: 'Jaipur studio', isDefault: true }

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

const show = async (acting: Acting, path = '/products/p1', readOnly = false) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const list = createRoute({ getParentRoute: () => app, path: '/products', component: () => <p>The list</p> })
  const editor = createRoute({ getParentRoute: () => app, path: '/products/$productId', component: ProductEditor })
  const story = createRoute({ getParentRoute: () => app, path: '/products/$productId/story', component: () => <p>The A+ editor</p> })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([list, editor, story])]), history: createMemoryHistory({ initialEntries: [path] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  return router
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement

beforeEach(() => {
  api.loadProduct.mockResolvedValue(cushion())
  api.loadProductBasics.mockResolvedValue({ pricingCurrency: 'INR', unitSystem: 'metric', features: ['specs', 'highlights', 'faqs', 'badges'].map((key) => ({ key, enabled: true, inPlan: true })), badges: [{ id: 'b1', label: 'Handmade', rule: 'manual' }] })
  api.loadFacets.mockResolvedValue([{ id: 'f1', name: 'Fabric', shopperVisible: true, values: [{ id: 'fv1', name: 'Linen' }] }])
  api.loadSizeCharts.mockResolvedValue([])
  api.loadStoreCurrencies.mockResolvedValue([])
  api.loadPricing.mockResolvedValue([])
  api.loadProductCollections.mockResolvedValue([{ id: 'c1', name: 'Summer edit', kind: 'manual' }])
  listApi.loadHandPicked.mockResolvedValue([{ id: 'c1', name: 'Summer edit' }, { id: 'c2', name: 'Gifts' }])
  api.loadTaxSetup.mockResolvedValue({ pricesIncludeTax: true, classes: [{ id: 'tc-18', name: 'GST 18%', isDefault: true }] })
  api.loadApprovalRequired.mockResolvedValue(true)
  stockApi.loadWarehouses.mockResolvedValue([home])
  stockApi.loadProductStock.mockResolvedValue(new Map([['ver-1', [{ warehouseId: 'w1', warehouseName: 'Jaipur studio', isDefault: true, onHand: 12, reserved: 2 }]]]))
  stockApi.setStock.mockResolvedValue(undefined)
  vi.stubGlobal('confirm', () => true)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('who may do what in the editor', () => {
  it('lets the merchant edit and set the store’s fields; a supplier edits its own; a Stock-only one only proposes new ones', () => {
    expect(editorAccessOf(owner, false, false)).toMatchObject({ side: 'merchant', canEdit: true, storeFields: true, proposes: false })
    expect(editorAccessOf(supplier, false, false)).toMatchObject({ side: 'supplier', canEdit: true, storeFields: false })
    expect(editorAccessOf(stockOnly, false, true)).toMatchObject({ canEdit: true, proposes: true })
    expect(editorAccessOf(stockOnly, false, false)).toMatchObject({ canEdit: false, viewOnly: true })
    expect(editorAccessOf(staff, false, false)).toMatchObject({ canEdit: false, viewOnly: true })
    expect(editorAccessOf(owner, true, false)).toMatchObject({ canEdit: false, readOnlyStore: true, viewOnly: false })
  })
})

describe('the product editor', () => {
  it('adds a product: asks for a name and a price first, then saves it in minor units and opens it', async () => {
    api.saveProduct.mockResolvedValue({ id: 'p9', revision: 1, approval: null })
    api.loadProduct.mockResolvedValue(cushion({ id: 'p9', name: 'Kurta' }))
    const router = await show(owner, '/products/new')
    expect(screen.getByRole('heading', { level: 1, name: words.newProduct })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.saveNew }))
    await settle()
    expect(screen.getByText(words.name.missing)).toBeTruthy()
    expect(screen.getByText(words.price.missing)).toBeTruthy()
    expect(api.saveProduct).not.toHaveBeenCalled()
    fireEvent.change(field(words.name.label), { target: { value: 'Kurta' } })
    fireEvent.change(field(words.price.price), { target: { value: '1299.5' } })
    fireEvent.click(within(screen.getByRole('region', { name: words.bar.unsaved })).getByRole('button', { name: words.saveNew }))
    await settle()
    expect(api.saveProduct).toHaveBeenCalledWith(null, null, expect.objectContaining({ name: 'Kurta', productType: 'physical', visible: true, versions: [expect.objectContaining({ choices: [], prices: [{ currency: 'INR', amount: '129950' }], taxClassId: null })] }), false)
    await settle()
    expect(router.state.location.pathname).toBe('/products/p9')
  })

  it('never offers to save a new product twice when reading it back fails: it opens its page instead', async () => {
    api.saveProduct.mockResolvedValue({ id: 'p9', revision: 1, approval: null })
    api.loadProduct.mockRejectedValue(new ApiError('NOT_CONNECTED', 'offline'))
    const router = await show(owner, '/products/new')
    fireEvent.change(field(words.name.label), { target: { value: 'Kurta' } })
    fireEvent.change(field(words.price.price), { target: { value: '1299' } })
    fireEvent.click(screen.getAllByRole('button', { name: words.saveNew })[0] as HTMLElement)
    await settle()
    expect(api.saveProduct).toHaveBeenCalledTimes(1)
    expect(router.state.location.pathname).toBe('/products/p9')
  })

  it('keeps an existing product saved at its new revision when reading it back fails', async () => {
    api.saveProduct.mockResolvedValueOnce({ id: 'p1', revision: 3, approval: null }).mockResolvedValueOnce({ id: 'p1', revision: 4, approval: null })
    await show(owner)
    api.loadProduct.mockRejectedValue(new ApiError('NOT_CONNECTED', 'offline'))
    fireEvent.change(field(words.name.label), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
    await settle()
    expect(screen.queryByRole('region', { name: words.bar.unsaved })).toBeNull()
    fireEvent.change(field(words.name.label), { target: { value: 'Renamed again' } })
    fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
    await settle()
    expect(api.saveProduct.mock.calls.map((c) => [c[0], c[1]])).toEqual([['p1', 2], ['p1', 3]])
  })

  it('makes versions from the choices and saves each with its own price', async () => {
    api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: null })
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: words.choices.add }))
    const values = screen.getByLabelText(`Size: ${words.choices.valuePlaceholder}`)
    for (const size of ['S', 'M']) {
      fireEvent.change(values, { target: { value: size } })
      fireEvent.keyDown(values, { key: 'Enter' })
    }
    expect(screen.getByText('2 size makes 2 versions.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create 2 versions' }))
    expect(field('Price of S').value).toBe('1299.00')
    fireEvent.change(field('Price of M'), { target: { value: '1499' } })
    fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
    await settle()
    const input = api.saveProduct.mock.calls[0]?.[2] as { options: unknown; versions: { id?: string; choices: string[]; prices: unknown }[] }
    expect(input.options).toEqual([{ name: 'Size', values: [{ name: 'S' }, { name: 'M' }] }])
    expect(input.versions.map((v) => [v.choices, v.prices])).toEqual([
      [['S'], [{ currency: 'INR', amount: '129900' }]],
      [['M'], [{ currency: 'INR', amount: '149900' }]],
    ])
    expect(api.saveProduct.mock.calls[0]?.[1]).toBe(2)
  })

  it('blocks a save while choices changed and the versions weren’t updated', async () => {
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: words.choices.add }))
    const values = screen.getByLabelText(`Size: ${words.choices.valuePlaceholder}`)
    fireEvent.change(values, { target: { value: 'S' } })
    fireEvent.keyDown(values, { key: 'Enter' })
    fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
    await settle()
    expect(api.saveProduct).not.toHaveBeenCalled()
  })

  it('says when someone else saved first, and keeps the changes on the page', async () => {
    api.saveProduct.mockRejectedValue(new ApiError('STALE_REVISION', 'stale'))
    await show(owner)
    fireEvent.change(field(words.name.label), { target: { value: 'Renamed cushion' } })
    fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
    await settle()
    expect(screen.getByText(words.banner.stale)).toBeTruthy()
    expect(screen.getByText(words.refused.STALE_REVISION)).toBeTruthy()
    expect(field(words.name.label).value).toBe('Renamed cushion')
  })

  it('adds an uploaded photo, and says why one didn’t upload', async () => {
    api.uploadPhoto.mockResolvedValueOnce({ ok: true, assetId: 'a1' }).mockResolvedValueOnce({ ok: false, code: 'TOO_LARGE' })
    api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: null })
    vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }))
    await show(owner)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = (name: string) => new File(['x'], name, { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file('a.png'), file('b.png')] } })
    await settle()
    expect(screen.getByText(words.photos.refused.TOO_LARGE)).toBeTruthy()
    expect(screen.getByText(words.photos.main)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
    await settle()
    expect((api.saveProduct.mock.calls[0]?.[2] as { photos: unknown }).photos).toEqual([{ assetId: 'a1' }])
  })

  it('names a supplier’s product to the merchant, and deletes only after confirming', async () => {
    api.loadProduct.mockResolvedValue(cushion({ supplier: { id: 'v1', name: 'Northwind Textiles' } }))
    listApi.deleteProducts.mockResolvedValue(1)
    const router = await show(owner)
    expect(screen.getByText('This is Northwind Textiles’s product.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.delete }))
    expect(listApi.deleteProducts).not.toHaveBeenCalled()
    fireEvent.click(within(document.querySelector('dialog') as HTMLElement).getByRole('button', { name: words.deleteConfirm }))
    await settle()
    expect(listApi.deleteProducts).toHaveBeenCalledWith(['p1'])
    expect(router.state.location.pathname).toBe('/products')
  })

  it('gives a supplier its own form: no visibility or tax category, sent-back reason shown, changes submitted', async () => {
    api.loadProduct.mockResolvedValue(cushion({ supplier: { id: 'v1', name: 'Northwind Textiles' }, approval: 'sent_back', sentBackReason: 'Sharper photo please', readiness: null }))
    api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: 'pending' })
    await show(supplier)
    expect(screen.getByText('“Sharper photo please” Fix it and send it again.')).toBeTruthy()
    expect(screen.queryByText(words.side.onStore)).toBeNull()
    expect(screen.queryByText(words.sections.tax)).toBeNull()
    expect(api.loadTaxSetup).not.toHaveBeenCalled()
    fireEvent.change(field(words.name.label), { target: { value: 'Cushion' } })
    fireEvent.click(screen.getAllByRole('button', { name: words.submit })[0] as HTMLElement)
    await settle()
    const input = api.saveProduct.mock.calls[0]?.[2] as Record<string, unknown> & { versions: Record<string, unknown>[] }
    expect('visible' in input).toBe(false)
    expect(input.versions.every((v) => !('taxClassId' in v))).toBe(true)
    expect(screen.getByText(words.submitted)).toBeTruthy()
  })

  it('lets a Stock-only supplier propose a new product, and only look at an existing one', async () => {
    api.saveProduct.mockResolvedValue({ id: 'p9', revision: 1, approval: 'pending' })
    await show(stockOnly, '/products/new')
    fireEvent.change(field(words.name.label), { target: { value: 'Lamp' } })
    fireEvent.change(field(words.price.price), { target: { value: '50' } })
    fireEvent.click(screen.getAllByRole('button', { name: words.submit })[0] as HTMLElement)
    await settle()
    expect(api.saveProduct.mock.calls[0]?.[3]).toBe(true)
    cleanup()
    await show(stockOnly)
    expect(screen.getByText(words.banner.stockOnly)).toBeTruthy()
    expect(field(words.name.label).readOnly).toBe(true)
    expect(screen.queryByRole('button', { name: words.save })).toBeNull()
    expect(screen.getByRole('button', { name: words.stock.saveStock })).toBeTruthy()
  })

  it('shows staff and a read-only store the product without a way to change it', async () => {
    await show(staff)
    expect(screen.getByText(words.banner.viewOnly)).toBeTruthy()
    expect(field(words.name.label).readOnly).toBe(true)
    cleanup()
    await show(owner, '/products/p1', true)
    expect(screen.getByText(words.banner.readOnly)).toBeTruthy()
    expect(screen.queryByRole('button', { name: words.save })).toBeNull()
  })

  it('says a product that isn’t there isn’t there, and offers to try again when loading fails', async () => {
    api.loadProduct.mockResolvedValue(null)
    await show(owner)
    expect(screen.getByRole('heading', { name: words.notFound.title })).toBeTruthy()
    cleanup()
    api.loadProduct.mockRejectedValue(new Error('offline'))
    await show(owner)
    expect(screen.getByRole('heading', { name: words.error.title })).toBeTruthy()
  })

  it('saves typed stock after the product, by the version’s id, and says what is reserved', async () => {
    api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: null })
    await show(owner)
    expect(screen.getByText('2 reserved for orders · sold, not shipped yet. You can sell 10 more.')).toBeTruthy()
    const count = field('Stock at Jaipur studio')
    expect(count.value).toBe('12')
    fireEvent.click(screen.getByRole('button', { name: words.stock.more }))
    expect(count.value).toBe('13')
    fireEvent.change(count, { target: { value: 'many' } })
    fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
    await settle()
    expect(api.saveProduct).not.toHaveBeenCalled()
    expect(screen.getByText(words.stock.invalid)).toBeTruthy()
    fireEvent.change(count, { target: { value: '30' } })
    fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
    await settle()
    expect(stockApi.setStock).toHaveBeenCalledWith([{ versionId: 'ver-1', warehouseId: 'w1', quantity: 30 }])
  })

  it('saves no counts for a product that is no longer physical', async () => {
    api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: null })
    kindApi.saveProductKind.mockResolvedValue({ productId: 'p1', productType: 'service', revision: 4, download: null, service: { duration: null, location: null }, giftCard: null })
    await show(owner)
    fireEvent.change(field('Stock at Jaipur studio'), { target: { value: 'many' } })
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(words.kind.service) }))
    api.loadProduct.mockResolvedValue(cushion({ productType: 'service' }))
    fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
    await settle()
    expect(api.saveProduct).toHaveBeenCalled()
    expect(stockApi.setStock).not.toHaveBeenCalled()
  })

  it('keeps the product saved and the counts typed when only the stock fails', async () => {
    api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: null })
    stockApi.setStock.mockRejectedValue(new ApiError('NOT_CONNECTED', 'offline'))
    await show(owner)
    fireEvent.change(field('Stock at Jaipur studio'), { target: { value: '30' } })
    fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
    await settle()
    expect(screen.getByText(words.stock.failed)).toBeTruthy()
    expect(field('Stock at Jaipur studio').value).toBe('30')
  })

  it('changes stock with a reason at once, and shows it in the history', async () => {
    stockApi.adjustStock.mockResolvedValue(32)
    stockApi.loadStockHistory.mockResolvedValue({ rows: [{ id: 'm1', versionId: 'ver-1', delta: 20, reason: 'received', resultingQuantity: 32, warehouseName: 'Jaipur studio', actorName: 'Farhan', actorKind: 'person', occurredAt: '2026-10-05T10:00:00Z' }], more: false })
    await show(owner)
    stockApi.loadProductStock.mockResolvedValue(new Map([['ver-1', [{ warehouseId: 'w1', warehouseName: 'Jaipur studio', isDefault: true, onHand: 32, reserved: 2 }]]]))
    fireEvent.click(screen.getByRole('button', { name: words.stock.adjust }))
    const dialog = within(document.querySelector('dialog') as HTMLElement)
    fireEvent.change(dialog.getByLabelText(words.stock.adjustCount), { target: { value: '+20' } })
    fireEvent.click(dialog.getByRole('button', { name: words.apply }))
    await settle()
    expect(stockApi.adjustStock).toHaveBeenCalledWith('ver-1', 'w1', 20, 'received')
    expect(field('Stock at Jaipur studio').value).toBe('32')
    // Stored already, so not an unsaved change.
    expect(screen.queryByRole('region', { name: words.bar.unsaved })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: words.stock.history }))
    await settle()
    expect(screen.getByText(words.stock.reasons.received)).toBeTruthy()
    expect(screen.getByText('Jaipur studio · by Farhan · now 32')).toBeTruthy()
  })

  it('lets a Stock-only supplier save the counts of a product it can’t otherwise change', async () => {
    await show({ ...stockOnly, permissions: [...stockOnly.permissions] })
    expect(field(words.name.label).readOnly).toBe(true)
    fireEvent.change(field('Stock at Jaipur studio'), { target: { value: '5' } })
    fireEvent.click(screen.getAllByRole('button', { name: words.stock.saveStock })[0] as HTMLElement)
    await settle()
    expect(api.saveProduct).not.toHaveBeenCalled()
    expect(stockApi.setStock).toHaveBeenCalledWith([{ versionId: 'ver-1', warehouseId: 'w1', quantity: 5 }])
  })

  it('files the product under filters and collections: the filters with the product, the collections by their own call after it', async () => {
    api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: null })
    api.setProductCollections.mockResolvedValue([{ id: 'c2', name: 'Gifts', kind: 'manual' }])
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(words.sections.coll) }))
    fireEvent.click(screen.getByRole('button', { name: 'Summer edit', pressed: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Gifts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Linen' }))
    fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
    await settle()
    expect((api.saveProduct.mock.calls[0]?.[2] as { filterValues: unknown }).filterValues).toEqual([{ valueId: 'fv1' }])
    expect(api.setProductCollections).toHaveBeenCalledWith('p1', ['c2'])
  })

  it('keeps the collections picked and says so when only they fail to save', async () => {
    api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: null })
    api.setProductCollections.mockRejectedValue(new ApiError('NOT_CONNECTED', 'offline'))
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(words.sections.coll) }))
    fireEvent.click(screen.getByRole('button', { name: 'Gifts' }))
    fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
    await settle()
    expect(screen.getByText(words.saveCollectionsFailed)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Gifts', pressed: true })).toBeTruthy()
  })

  it('says when the collections didn’t load, offers none, and saves without touching them', async () => {
    api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: null })
    api.loadProductCollections.mockRejectedValue(new ApiError('NOT_CONNECTED', 'offline'))
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(words.sections.coll) }))
    expect(screen.getByText(words.sections.collFailed)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Gifts' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Linen' }))
    fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
    await settle()
    expect(api.saveProduct).toHaveBeenCalled()
    expect(api.setProductCollections).not.toHaveBeenCalled()
  })

  it('says when the hand-picked collections, filters or size charts didn’t load, rather than that there are none', async () => {
    api.loadProductBasics.mockResolvedValue({ pricingCurrency: 'INR', unitSystem: 'metric', features: [{ key: 'sizeCharts', enabled: true }], badges: [] })
    listApi.loadHandPicked.mockRejectedValue(new ApiError('NOT_CONNECTED', 'offline'))
    api.loadFacets.mockRejectedValue(new ApiError('NOT_CONNECTED', 'offline'))
    api.loadSizeCharts.mockRejectedValue(new ApiError('NOT_CONNECTED', 'offline'))
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(words.sections.coll) }))
    expect(screen.getByText(words.sections.collFailed)).toBeTruthy()
    expect(screen.queryByText(words.sections.handPickedNone)).toBeNull()
    expect(screen.getByText(words.sections.filtersFailed)).toBeTruthy()
    expect(screen.queryByText(words.sections.filtersNone)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(words.sections.chart) }))
    expect(screen.getByText(words.sections.chartFailed)).toBeTruthy()
    expect((screen.getByLabelText(words.sections.chart) as HTMLSelectElement).disabled).toBe(true)
  })

  it('asks for the legal details a market says are missing, and gives a manual badge', async () => {
    api.loadProduct.mockResolvedValue(cushion({ readiness: [{ marketId: 'm2', marketName: 'United States', ready: false, missing: ['fibre', 'care'] }] }))
    api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: null })
    await show(owner)
    const fibre = screen.getByLabelText(new RegExp(`^${words.sections.legalFields.fibre}`))
    expect(screen.getAllByText('Needed for United States', { exact: false })).toHaveLength(2)
    expect(screen.queryByLabelText(new RegExp(`^${words.sections.legalFields.origin}`))).toBeNull()
    fireEvent.change(fibre, { target: { value: '100% cotton' } })
    fireEvent.click(screen.getByRole('button', { name: 'Handmade' }))
    fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
    await settle()
    const listing = (api.saveProduct.mock.calls[0]?.[2] as { listing: { compliance: unknown; badgeIds: unknown } }).listing
    expect(listing.compliance).toEqual([{ region: 'ALL', field: 'fibre', value: '100% cotton' }])
    expect(listing.badgeIds).toEqual(['b1'])
  })

  it('says why it waits while a photo is still uploading', async () => {
    api.uploadPhoto.mockReturnValue(new Promise(() => undefined))
    await show(owner)
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } })
    fireEvent.change(field(words.name.label), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
    await settle()
    expect(screen.getByText(words.photos.waitUpload)).toBeTruthy()
    expect(api.saveProduct).not.toHaveBeenCalled()
  })

  it('carries a new product’s counts to its own page when only they fail, to save again there', async () => {
    api.saveProduct.mockResolvedValue({ id: 'p9', revision: 1, approval: null })
    api.loadProduct.mockResolvedValue(cushion({ id: 'p9', name: 'Kurta' }))
    stockApi.loadProductStock.mockResolvedValue(new Map())
    stockApi.setStock.mockRejectedValueOnce(new ApiError('NOT_CONNECTED', 'offline'))
    const router = await show(owner, '/products/new')
    fireEvent.change(field(words.name.label), { target: { value: 'Kurta' } })
    fireEvent.change(field(words.price.price), { target: { value: '1299' } })
    fireEvent.change(field('Stock at Jaipur studio'), { target: { value: '7' } })
    fireEvent.click(screen.getAllByRole('button', { name: words.saveNew })[0] as HTMLElement)
    await settle()
    await settle()
    expect(router.state.location.pathname).toBe('/products/p9')
    expect(screen.getByText(words.stock.newFailed)).toBeTruthy()
    expect(field('Stock at Jaipur studio').value).toBe('7')
    // Carried by that one navigation, then gone: a reload or a later visit shows what is stored.
    await settle()
    expect(router.state.location.state.unsavedCounts).toBeUndefined()
    fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
    await settle()
    expect(stockApi.setStock).toHaveBeenLastCalledWith([{ versionId: 'ver-1', warehouseId: 'w1', quantity: 7 }])
  })

  it('carries a new product’s collection picks to its own page when only they fail, to save again there', async () => {
    api.saveProduct.mockResolvedValue({ id: 'p9', revision: 1, approval: null })
    api.loadProduct.mockResolvedValue(cushion({ id: 'p9', name: 'Kurta' }))
    api.setProductCollections.mockRejectedValueOnce(new ApiError('NOT_CONNECTED', 'offline')).mockResolvedValue([{ id: 'c2', name: 'Gifts', kind: 'manual' }])
    const router = await show(owner, '/products/new')
    fireEvent.change(field(words.name.label), { target: { value: 'Kurta' } })
    fireEvent.change(field(words.price.price), { target: { value: '1299' } })
    fireEvent.click(screen.getByRole('button', { name: new RegExp(words.sections.coll) }))
    fireEvent.click(screen.getByRole('button', { name: 'Gifts' }))
    fireEvent.click(screen.getAllByRole('button', { name: words.saveNew })[0] as HTMLElement)
    await settle()
    await settle()
    expect(router.state.location.pathname).toBe('/products/p9')
    expect(screen.getByText(words.saveCollectionsFailed)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Gifts', pressed: true })).toBeTruthy()
    await settle()
    expect(router.state.location.state.unsavedCollections).toBeUndefined()
    fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
    await settle()
    expect(api.setProductCollections).toHaveBeenLastCalledWith('p9', ['c2'])
  })

  it('changes only the location a reason names, leaving a count typed elsewhere as typed', async () => {
    const two = [{ id: 'w1', name: 'Jaipur studio', isDefault: true }, { id: 'w2', name: 'Delhi godown', isDefault: false }]
    stockApi.loadWarehouses.mockResolvedValue(two)
    const levels = (jaipur: number) => new Map([['ver-1', [{ warehouseId: 'w1', warehouseName: 'Jaipur studio', isDefault: true, onHand: jaipur, reserved: 0 }, { warehouseId: 'w2', warehouseName: 'Delhi godown', isDefault: false, onHand: 6, reserved: 0 }]]])
    stockApi.loadProductStock.mockResolvedValue(levels(12))
    stockApi.adjustStock.mockResolvedValue(17)
    await show(owner)
    fireEvent.change(field('Stock at Delhi godown'), { target: { value: '40' } })
    stockApi.loadProductStock.mockResolvedValue(levels(17))
    fireEvent.click(screen.getByRole('button', { name: words.stock.adjust }))
    const dialog = within(document.querySelector('dialog') as HTMLElement)
    fireEvent.change(dialog.getByLabelText(words.stock.adjustCount), { target: { value: '+5' } })
    fireEvent.click(dialog.getByRole('button', { name: words.apply }))
    await settle()
    expect(field('Stock at Jaipur studio').value).toBe('17')
    expect(field('Stock at Delhi godown').value).toBe('40')
    expect(screen.getByRole('region', { name: words.bar.unsaved })).toBeTruthy()
  })

  it('finds related products by name, saying when nothing matches or the search fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.loadProductBasics.mockResolvedValue({ pricingCurrency: 'INR', unitSystem: 'metric', features: [{ key: 'related', enabled: true, inPlan: true }], badges: [] })
    api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: null })
    listApi.loadProducts.mockResolvedValueOnce({ rows: [], next: null, previous: null }).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ rows: [{ id: 'p2', name: 'Kurta' }], next: null, previous: null })
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(words.sections.related) }))
    const find = screen.getByLabelText(words.sections.relatedSearch)
    for (const [typed, expected] of [['zz', 'No products match “zz”'], ['ku', messages.productSearch.failed]] as const) {
      fireEvent.change(find, { target: { value: typed } })
      await act(async () => vi.advanceTimersByTimeAsync(350))
      expect(screen.getByText(expected)).toBeTruthy()
    }
    fireEvent.change(find, { target: { value: 'kur' } })
    await act(async () => vi.advanceTimersByTimeAsync(350))
    fireEvent.click(screen.getByRole('button', { name: 'Kurta' }))
    expect(screen.getByText('Kurta')).toBeTruthy()
    vi.useRealTimers()
    fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
    await settle()
    expect((api.saveProduct.mock.calls[0]?.[2] as { listing: { relatedIds: unknown } }).listing.relatedIds).toEqual(['p2'])
  })

  it('opens A+ content for a saved product, asks a new one to save first, and says when the plan lacks it', async () => {
    api.loadProductBasics.mockResolvedValue({ pricingCurrency: 'INR', unitSystem: 'metric', features: [{ key: 'aplus', enabled: true, inPlan: true }], badges: [] })
    const router = await show(owner)
    fireEvent.click(screen.getByRole('button', { name: (n) => n.startsWith(words.sections.aplus) }))
    fireEvent.click(screen.getByRole('link', { name: words.sections.aplusOpen }))
    await settle()
    expect(router.state.location.pathname).toBe('/products/p1/story')
    cleanup()
    await show(owner, '/products/new')
    fireEvent.click(screen.getByRole('button', { name: (n) => n.startsWith(words.sections.aplus) }))
    expect(screen.getByText(words.sections.aplusSaveFirst)).toBeTruthy()
    cleanup()
    api.loadProductBasics.mockResolvedValue({ pricingCurrency: 'INR', unitSystem: 'metric', features: [{ key: 'aplus', enabled: true, inPlan: false }], badges: [] })
    await show(owner)
    expect(screen.getAllByText(words.sections.aplusPlan).length).toBeGreaterThan(0)
  })

  it('translates the product into the store’s other languages, saving only what changed', async () => {
    api.loadProductBasics.mockResolvedValue({ pricingCurrency: 'INR', unitSystem: 'metric', features: [], badges: [], mainLanguage: 'en-IN', translationLanguages: ['hi-IN'] })
    const missing = [
      { entity: 'product', entityId: 'p1', field: 'name', main: 'Block-print Cushion', text: null, status: 'missing' },
      { entity: 'product', entityId: 'p1', field: 'description', main: '', text: null, status: 'missing' },
    ]
    translationApi.loadProductTranslation.mockResolvedValue(missing)
    translationApi.saveProductTranslation.mockResolvedValue([{ ...missing[0], text: 'Chhapai takiya', status: 'translated' }, missing[1]])
    await show(owner)
    const hindi = screen.getByRole('tab', { name: /Hindi/ })
    fireEvent.click(hindi)
    await settle()
    expect(translationApi.loadProductTranslation).toHaveBeenCalledWith('p1', 'hi-IN')
    expect(screen.getByRole('tab', { name: /1 to do/ })).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Chhapai takiya' } })
    fireEvent.click(screen.getByRole('button', { name: words.translate.save }))
    await settle()
    expect(translationApi.saveProductTranslation).toHaveBeenCalledWith('p1', 'hi-IN', { name: 'Chhapai takiya' })
    expect(screen.getByRole('tab', { name: /done/ })).toBeTruthy()
    expect(api.saveProduct).not.toHaveBeenCalled()
  })

  it('moves between the language tabs with the arrow keys, one tab stop, labelling the panel it shows', async () => {
    api.loadProductBasics.mockResolvedValue({ pricingCurrency: 'INR', unitSystem: 'metric', features: [], badges: [], mainLanguage: 'en-IN', translationLanguages: ['hi-IN'] })
    translationApi.loadProductTranslation.mockResolvedValue([])
    await show(owner)
    const list = screen.getByRole('tablist', { name: words.translate.tabs })
    const [main, hindi] = screen.getAllByRole('tab') as [HTMLElement, HTMLElement]
    expect([main.tabIndex, hindi.tabIndex]).toEqual([0, -1])
    expect(screen.getByRole('tabpanel', { name: main.textContent ?? '' }).id).toBe(main.getAttribute('aria-controls'))
    fireEvent.keyDown(list, { key: 'ArrowRight' })
    await settle()
    expect(hindi.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(hindi)
    expect([main.tabIndex, hindi.tabIndex]).toEqual([-1, 0])
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(hindi.id)
    fireEvent.keyDown(list, { key: 'ArrowRight' })
    expect(main.getAttribute('aria-selected')).toBe('true')
  })

  it('says the prices in other currencies didn’t load, rather than showing none or unsaved ones', async () => {
    api.loadStoreCurrencies.mockResolvedValue([{ code: 'USD', mode: 'auto' }])
    api.loadPricing.mockRejectedValue(new ApiError('NOT_CONNECTED', 'offline'))
    await show(owner)
    expect(screen.getByText(words.price.abroadFailed)).toBeTruthy()
    expect(screen.queryByText(words.price.autoNone)).toBeNull()
    cleanup()
    api.loadStoreCurrencies.mockRejectedValue(new ApiError('NOT_CONNECTED', 'offline'))
    await show(owner)
    expect(screen.getByText(words.price.abroadFailed)).toBeTruthy()
  })

  it('prices each hand-priced currency, and shows the converted ones as saved', async () => {
    api.loadStoreCurrencies.mockResolvedValue([{ code: 'USD', mode: 'auto' }, { code: 'AED', mode: 'manual' }])
    api.loadPricing.mockResolvedValue([{ versionId: 'ver-1', prices: [{ currency: 'USD', amount: '1599', compareAtAmount: null, source: 'converted' }], inMarket: null }])
    api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: null })
    await show(owner)
    expect(screen.getByText(/15\.99 · set automatically/)).toBeTruthy()
    expect(screen.getByText('Not for sale in AED until you add a price.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Price in AED'), { target: { value: '55' } })
    fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
    await settle()
    expect((api.saveProduct.mock.calls[0]?.[2] as { versions: { prices: unknown }[] }).versions[0]?.prices).toEqual([{ currency: 'INR', amount: '129900' }, { currency: 'AED', amount: '5500' }])
  })

  it('leaves the product unchanged when a related product is picked and then removed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.loadProductBasics.mockResolvedValue({ pricingCurrency: 'INR', unitSystem: 'metric', features: [{ key: 'related', enabled: true, inPlan: true }], badges: [] })
    listApi.loadProducts.mockResolvedValue({ rows: [{ id: 'p2', name: 'Kurta' }], next: null, previous: null })
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(words.sections.related) }))
    fireEvent.change(screen.getByLabelText(words.sections.relatedSearch), { target: { value: 'kur' } })
    await act(async () => vi.advanceTimersByTimeAsync(350))
    vi.useRealTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Kurta' }))
    expect(screen.getByRole('region', { name: words.bar.unsaved })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Kurta' }))
    expect(screen.queryByRole('region', { name: words.bar.unsaved })).toBeNull()
  })
})

const kinds = messages.editor.kinds
const version = (id: string, choices: string[], amount: string) => ({ id, choices, name: null, sku: null, barcode: null, visible: true, prices: [{ currency: 'INR', amount, compareAtAmount: null }], cost: null, weightGrams: null, lengthMm: null, widthMm: null, heightMm: null, hsCode: null, taxClassId: null, trackStock: null, continueSelling: null })
const kindView = (over: Record<string, unknown>) => ({ productId: 'p1', productType: 'digital', revision: 2, download: null, service: null, giftCard: null, ...over })
const pool = (left: number) => ({ mode: 'keys', file: null, limit: 5, days: 30, keysLeft: left, keysSold: 4 })
const giftCard = (p: Partial<EditorProduct> = {}) =>
  cushion({ productType: 'gift_card', options: [{ id: 'o1', name: 'Amount', values: [{ id: 'va', name: '₹500' }, { id: 'vb', name: '₹1,000' }] }], versions: [version('ver-a', ['₹500'], '50000'), version('ver-b', ['₹1,000'], '100000')], ...p })
const issued = (id: string, last4: string | null) => ({ id, last4, recipientName: 'Meera Iyer', recipientEmail: 'meera@example.com', amount: { amount: '50000', currency: 'INR' }, balance: { amount: '50000', currency: 'INR' }, sendOn: null, sentAt: '2026-08-14T08:00:00Z', expiresAt: '2027-08-14T08:00:00Z', source: 'issued', status: 'active' })
const labelled = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement
const saveButton = () => screen.getAllByRole('button', { name: words.save })[0] as HTMLElement
const dialog = () => document.querySelector('dialog') as HTMLElement
const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('downloads, services and gift cards in the editor', () => {
  it('creates a download: the file uploads first, and what the shopper gets saves after the product', async () => {
    api.saveProduct.mockResolvedValue({ id: 'p9', revision: 1, approval: null })
    api.loadProduct.mockResolvedValue(cushion({ id: 'p9', productType: 'digital' }))
    kindApi.uploadDownload.mockResolvedValue({ ok: true, file: { id: 'f1', mime: 'application/pdf', bytes: 2 * 1024 * 1024 } })
    kindApi.saveProductKind.mockResolvedValue(kindView({ productId: 'p9', revision: 2, download: { mode: 'file', file: { id: 'f1', mime: 'application/pdf', bytes: 2 * 1024 * 1024 }, limit: 10, days: 30, keysLeft: 0, keysSold: 0 } }))
    kindApi.loadProductKind.mockResolvedValue(kindView({ productId: 'p9' }))
    const router = await show(owner, '/products/new')
    fireEvent.change(field(words.name.label), { target: { value: 'Pattern pack' } })
    fireEvent.change(field(words.price.price), { target: { value: '499' } })
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(words.kind.digital) }))
    expect(screen.getByText(words.kind.gone)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: words.saveNew })[0] as HTMLElement)
    await settle()
    expect(screen.getByText(kinds.download.missing)).toBeTruthy()
    expect(api.saveProduct).not.toHaveBeenCalled()
    fireEvent.change(document.querySelector('input[accept^="application/pdf"]') as HTMLInputElement, { target: { files: [new File(['%PDF-'], 'patterns.pdf', { type: 'application/pdf' })] } })
    await settle()
    expect(screen.getByText('PDF file · 2 MB')).toBeTruthy()
    fireEvent.change(field(kinds.download.limit), { target: { value: '10' } })
    fireEvent.click(screen.getAllByRole('button', { name: words.saveNew })[0] as HTMLElement)
    await settle()
    expect(api.saveProduct).toHaveBeenCalledWith(null, null, expect.objectContaining({ productType: 'digital' }), false)
    expect(kindApi.saveProductKind).toHaveBeenCalledWith('p9', 1, { download: { mode: 'file', fileId: 'f1', limit: 10, days: 30 } })
    await settle()
    expect(router.state.location.pathname).toBe('/products/p9')
  })

  it('says why a file didn’t upload, and keeps the latest file chosen when an earlier upload answers late', async () => {
    const first = deferred<unknown>()
    kindApi.loadProductKind.mockResolvedValue(kindView({ download: { mode: 'file', file: null, limit: 5, days: 30, keysLeft: 0, keysSold: 0 } }))
    api.loadProduct.mockResolvedValue(cushion({ productType: 'digital' }))
    kindApi.uploadDownload.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ok: false, code: 'TOO_LARGE' }).mockResolvedValueOnce({ ok: true, file: { id: 'f2', mime: 'application/zip', bytes: 1024 * 1024 } })
    await show(owner)
    const input = () => document.querySelector('input[accept^="application/pdf"]') as HTMLInputElement
    const file = new File(['x'], 'a.zip', { type: 'application/zip' })
    fireEvent.change(input(), { target: { files: [file] } })
    fireEvent.change(input(), { target: { files: [file] } })
    await settle()
    expect(screen.getByText('That file is too big. Use one under 30 MB.')).toBeTruthy()
    fireEvent.change(input(), { target: { files: [file] } })
    await settle()
    first.resolve({ ok: true, file: { id: 'f1', mime: 'application/pdf', bytes: 1024 } })
    await settle()
    expect(screen.getByText('ZIP file · 1 MB')).toBeTruthy()
    expect(screen.queryByText(/PDF file/)).toBeNull()
  })

  it('counts a key pool and never shows a saved key again; new keys go in after the product', async () => {
    api.loadProduct.mockResolvedValue(cushion({ productType: 'digital' }))
    kindApi.loadProductKind.mockResolvedValue(kindView({ download: pool(3) }))
    api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: null })
    kindApi.addLicenceKeys.mockResolvedValue(kindView({ revision: 3, download: pool(5) }))
    await show(owner)
    expect(screen.getByText(/3 keys left · one is sent per order · Running low/)).toBeTruthy()
    fireEvent.change(field(kinds.download.keysLabel), { target: { value: 'K-1\nK-2\n\n K-1 ' } })
    expect(screen.getByText('2 new keys to add when you save')).toBeTruthy()
    fireEvent.click(saveButton())
    await settle()
    expect(kindApi.saveProductKind).not.toHaveBeenCalled()
    expect(kindApi.addLicenceKeys).toHaveBeenCalledWith('p1', ['K-1', 'K-2'])
    expect(field(kinds.download.keysLabel).value).toBe('')
    expect(screen.getByText(/5 keys left/)).toBeTruthy()
    expect(screen.queryByText(/K-1/)).toBeNull()
  })

  it('refuses more keys than a save takes, before sending any', async () => {
    api.loadProduct.mockResolvedValue(cushion({ productType: 'digital' }))
    kindApi.loadProductKind.mockResolvedValue(kindView({ download: pool(0) }))
    await show(owner)
    expect(screen.getByText(/^No keys left: the product shows as sold out until you add more\. · 4 sent so far$/)).toBeTruthy()
    fireEvent.change(field(kinds.download.keysLabel), { target: { value: 'x'.repeat(201) } })
    fireEvent.click(saveButton())
    await settle()
    expect(api.saveProduct).not.toHaveBeenCalled()
    expect(screen.getByText('Add up to 1,000 keys at a time, each up to 200 characters.')).toBeTruthy()
  })

  it('saves a service’s length and place trimmed, and nothing for one left empty', async () => {
    api.loadProduct.mockResolvedValue(cushion({ productType: 'service' }))
    kindApi.loadProductKind.mockResolvedValue(kindView({ productType: 'service', service: { duration: '2 hours', location: null } }))
    api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: null })
    kindApi.saveProductKind.mockResolvedValue(kindView({ productType: 'service', revision: 4, service: { duration: null, location: 'Our studio' } }))
    await show(owner)
    expect(labelled(new RegExp(kinds.service.duration)).value).toBe('2 hours')
    fireEvent.change(labelled(new RegExp(kinds.service.duration)), { target: { value: '  ' } })
    fireEvent.change(labelled(new RegExp(kinds.service.location)), { target: { value: ' Our studio ' } })
    fireEvent.click(saveButton())
    await settle()
    expect(kindApi.saveProductKind).toHaveBeenCalledWith('p1', 3, { service: { duration: null, location: 'Our studio' } })
    expect(screen.queryByRole('region', { name: words.bar.unsaved })).toBeNull()
  })

  it('makes a gift card’s amounts its versions, with no expiry shorter than its country allows', async () => {
    api.loadProduct.mockResolvedValue(giftCard())
    kindApi.loadProductKind.mockResolvedValue(kindView({ productType: 'gift_card', giftCard: { expiryMonths: 60, shortestMonths: 60 } }))
    kindApi.loadGiftCards.mockResolvedValue({ rows: [], next: null })
    api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: null })
    kindApi.saveProductKind.mockResolvedValue(kindView({ productType: 'gift_card', revision: 4, giftCard: { expiryMonths: null, shortestMonths: 60 } }))
    await show(owner)
    expect(screen.queryByText(words.price.title)).toBeNull()
    expect(screen.queryByRole('button', { name: words.choices.add })).toBeNull()
    const expiry = screen.getByLabelText(kinds.giftCard.expiry) as HTMLSelectElement
    expect([...expiry.options].map((o) => o.text)).toEqual(['5 years (the shortest allowed)', '7 years', '10 years', kinds.giftCard.never])
    fireEvent.click(screen.getByRole('button', { name: kinds.giftCard.add }))
    fireEvent.change(within(dialog()).getByLabelText('Amount in INR'), { target: { value: '1000' } })
    expect(within(dialog()).getByText(kinds.giftCard.addTaken)).toBeTruthy()
    fireEvent.change(within(dialog()).getByLabelText('Amount in INR'), { target: { value: '2000' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: kinds.giftCard.addConfirm }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove ₹500' }))
    fireEvent.change(expiry, { target: { value: 'never' } })
    fireEvent.click(saveButton())
    await settle()
    const input = api.saveProduct.mock.calls[0]?.[2] as { productType: string; options: unknown; versions: { id?: string; choices: string[]; prices: unknown }[] }
    expect(input.productType).toBe('gift_card')
    expect(input.options).toEqual([{ id: 'o1', name: 'Amount', values: [{ id: 'vb', name: '₹1,000' }, { name: '₹2,000' }] }])
    expect(input.versions.map((v) => [v.id, v.choices, v.prices])).toEqual([
      ['ver-b', ['₹1,000'], [{ currency: 'INR', amount: '100000' }]],
      [undefined, ['₹2,000'], [{ currency: 'INR', amount: '200000' }]],
    ])
    expect(kindApi.saveProductKind).toHaveBeenCalledWith('p1', 3, { giftCard: { expiryMonths: null } })
  })

  it('turns a product’s price into a gift card’s one amount, and keeps at least one', async () => {
    await show(owner)
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(words.kind.gift_card) }))
    expect(screen.getByText('₹1,299')).toBeTruthy()
    expect(screen.queryByText(words.price.title)).toBeNull()
    expect(screen.getByText(kinds.giftCard.ruleUnknown)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove ₹1,299' }))
    expect(screen.getByText(kinds.giftCard.keepOne)).toBeTruthy()
    expect(screen.getByText('₹1,299')).toBeTruthy()
  })

  it('lists a gift card’s cards by their last four only, and issues one card per request however often it is sent', async () => {
    api.loadProduct.mockResolvedValue(giftCard())
    kindApi.loadProductKind.mockResolvedValue(kindView({ productType: 'gift_card', giftCard: { expiryMonths: 12, shortestMonths: 12 } }))
    kindApi.loadGiftCards.mockResolvedValue({ rows: [issued('g1', '91MX'), issued('g2', null)], next: null })
    kindApi.issueGiftCard.mockRejectedValueOnce(new ApiError('NOT_CONNECTED', 'offline')).mockResolvedValueOnce('g3')
    await show(owner)
    expect(screen.getByText('•••• 91MX')).toBeTruthy()
    expect(screen.getByText(kinds.giftCard.notSent)).toBeTruthy()
    expect(screen.getAllByText('Expires Aug 14, 2027 UTC')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: kinds.giftCard.issue }))
    fireEvent.change(within(dialog()).getByLabelText(kinds.giftCard.issueAmount), { target: { value: 'ver-b' } })
    fireEvent.change(within(dialog()).getByLabelText(kinds.giftCard.issueEmail), { target: { value: 'not-an-email' } })
    expect(within(dialog()).getByText(kinds.giftCard.issueEmailInvalid)).toBeTruthy()
    fireEvent.change(within(dialog()).getByLabelText(kinds.giftCard.issueEmail), { target: { value: 'rohan@example.com' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: kinds.giftCard.issueConfirm }))
    await settle()
    expect(within(dialog()).getByText(kinds.giftCard.refused.other)).toBeTruthy()
    fireEvent.click(within(dialog()).getByRole('button', { name: kinds.giftCard.issueConfirm }))
    await settle()
    const [first, second] = kindApi.issueGiftCard.mock.calls.map((c) => c[0] as { issueKey: string })
    expect(first).toEqual({ productId: 'p1', versionId: 'ver-b', recipientEmail: 'rohan@example.com', issueKey: expect.stringMatching(/^[0-9a-f-]{36}$/) })
    expect(second?.issueKey).toBe(first?.issueKey)
    expect(screen.getByText('Gift card sent to rohan@example.com')).toBeTruthy()
    expect(kindApi.loadGiftCards).toHaveBeenCalledTimes(2)
  })

  it('names the API’s refusal of a card in its own dialog, and shows the next page under the first', async () => {
    api.loadProduct.mockResolvedValue(giftCard({ options: [], versions: [version('ver-a', [], '50000')] }))
    kindApi.loadProductKind.mockResolvedValue(kindView({ productType: 'gift_card', giftCard: { expiryMonths: null, shortestMonths: 12 } }))
    kindApi.loadGiftCards.mockResolvedValueOnce({ rows: [issued('g1', 'AAAA')], next: 'c1' }).mockResolvedValueOnce({ rows: [issued('g2', 'BBBB')], next: null })
    kindApi.issueGiftCard.mockRejectedValue(new ApiError('KEY_REUSED', 'reused'))
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: kinds.giftCard.more }))
    await settle()
    expect(screen.getByText('•••• AAAA')).toBeTruthy()
    expect(screen.getByText('•••• BBBB')).toBeTruthy()
    expect(kindApi.loadGiftCards).toHaveBeenLastCalledWith('p1', 'c1')
    fireEvent.click(screen.getByRole('button', { name: kinds.giftCard.issue }))
    expect(within(dialog()).queryByLabelText(kinds.giftCard.issueAmount)).toBeNull()
    fireEvent.change(within(dialog()).getByLabelText(kinds.giftCard.issueEmail), { target: { value: 'a@example.com' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: kinds.giftCard.issueConfirm }))
    await settle()
    expect(within(dialog()).getByText(kinds.giftCard.refused.KEY_REUSED)).toBeTruthy()
    expect(screen.queryByRole('region', { name: words.bar.failed })).toBeNull()
  })

  it('drops a page of cards that answers after the list was read again', async () => {
    const late = deferred<unknown>()
    api.loadProduct.mockResolvedValue(giftCard())
    kindApi.loadProductKind.mockResolvedValue(kindView({ productType: 'gift_card', giftCard: { expiryMonths: null, shortestMonths: 12 } }))
    kindApi.loadGiftCards.mockResolvedValueOnce({ rows: [issued('g1', 'AAAA')], next: 'c1' }).mockReturnValueOnce(late.promise).mockResolvedValueOnce({ rows: [issued('g3', 'CCCC')], next: null })
    kindApi.issueGiftCard.mockResolvedValue('g3')
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: kinds.giftCard.more }))
    fireEvent.click(screen.getByRole('button', { name: kinds.giftCard.issue }))
    fireEvent.change(within(dialog()).getByLabelText(kinds.giftCard.issueEmail), { target: { value: 'a@example.com' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: kinds.giftCard.issueConfirm }))
    await settle()
    late.resolve({ rows: [issued('g2', 'BBBB')], next: null })
    await settle()
    expect(screen.getByText('•••• CCCC')).toBeTruthy()
    expect(screen.queryByText('•••• BBBB')).toBeNull()
  })

  it('shows Staff the cards issued with no way to issue one or change the kind; a read-only store adds no keys', async () => {
    api.loadProduct.mockResolvedValue(giftCard())
    kindApi.loadProductKind.mockResolvedValue(kindView({ productType: 'gift_card', giftCard: { expiryMonths: 12, shortestMonths: 12 } }))
    kindApi.loadGiftCards.mockResolvedValue({ rows: [issued('g1', '91MX')], next: null })
    await show(staff)
    expect(screen.getByText('•••• 91MX')).toBeTruthy()
    expect(screen.queryByRole('button', { name: kinds.giftCard.issue })).toBeNull()
    expect(screen.queryByRole('button', { name: kinds.giftCard.add })).toBeNull()
    expect((screen.getByRole('radio', { name: new RegExp(words.kind.physical) }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText(kinds.giftCard.expiry) as HTMLSelectElement).disabled).toBe(true)
    cleanup()
    api.loadProduct.mockResolvedValue(cushion({ productType: 'digital' }))
    kindApi.loadProductKind.mockResolvedValue(kindView({ download: pool(40) }))
    await show(owner, '/products/p1', true)
    expect(screen.getByText(/40 keys left/)).toBeTruthy()
    expect(screen.queryByLabelText(kinds.download.keysLabel)).toBeNull()
    expect((screen.getByRole('radio', { name: kinds.download.file }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps a supplier to physical items, and never reads a kind for it', async () => {
    await show(supplier, '/products/new')
    expect(screen.getByText(words.kind.merchantOnly)).toBeTruthy()
    for (const kind of ['digital', 'service', 'gift_card'] as const) expect((screen.getByRole('radio', { name: new RegExp(words.kind[kind]) }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('radio', { name: new RegExp(words.kind.physical) }) as HTMLButtonElement).disabled).toBe(false)
    cleanup()
    api.loadProduct.mockResolvedValue(cushion({ supplier: { id: 'v1', name: 'Northwind Textiles' }, readiness: null }))
    await show(supplier)
    expect(kindApi.loadProductKind).not.toHaveBeenCalled()
  })

  it('keeps what the shopper gets on the page when it is refused after the product saved', async () => {
    api.loadProduct.mockResolvedValue(giftCard())
    kindApi.loadProductKind.mockResolvedValue(kindView({ productType: 'gift_card', giftCard: { expiryMonths: 60, shortestMonths: 60 } }))
    kindApi.loadGiftCards.mockResolvedValue({ rows: [], next: null })
    api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: null })
    kindApi.saveProductKind.mockRejectedValue(new ApiError('EXPIRY_TOO_SHORT', 'short'))
    await show(owner)
    fireEvent.change(screen.getByLabelText(kinds.giftCard.expiry), { target: { value: '84' } })
    fireEvent.click(saveButton())
    await settle()
    expect(api.saveProduct).toHaveBeenCalled()
    expect(within(screen.getByRole('region', { name: words.bar.failed })).getByText(kinds.refused.EXPIRY_TOO_SHORT)).toBeTruthy()
    expect((screen.getByLabelText(kinds.giftCard.expiry) as HTMLSelectElement).value).toBe('84')
  })

  it('carries a new product’s details that didn’t save to its page, never its licence keys', async () => {
    api.saveProduct.mockResolvedValue({ id: 'p9', revision: 1, approval: null })
    api.loadProduct.mockResolvedValue(cushion({ id: 'p9', productType: 'digital' }))
    kindApi.saveProductKind.mockRejectedValue(new ApiError('NOT_CONNECTED', 'offline'))
    kindApi.loadProductKind.mockResolvedValue(kindView({ productId: 'p9', download: { mode: 'file', file: null, limit: 5, days: 30, keysLeft: 0, keysSold: 0 } }))
    const router = await show(owner, '/products/new')
    fireEvent.change(field(words.name.label), { target: { value: 'Font licence' } })
    fireEvent.change(field(words.price.price), { target: { value: '999' } })
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(words.kind.digital) }))
    fireEvent.click(screen.getByRole('radio', { name: kinds.download.keys }))
    fireEvent.change(field(kinds.download.keysLabel), { target: { value: 'SECRET-1' } })
    fireEvent.click(screen.getAllByRole('button', { name: words.saveNew })[0] as HTMLElement)
    await settle()
    await settle()
    expect(router.state.location.pathname).toBe('/products/p9')
    expect(kindApi.addLicenceKeys).not.toHaveBeenCalled()
    expect(screen.getByText(kinds.newFailed)).toBeTruthy()
    expect(screen.getByRole('radio', { name: kinds.download.keys }).getAttribute('aria-checked')).toBe('true')
    expect(field(kinds.download.keysLabel).value).toBe('')
    expect(JSON.stringify(router.history.location.state)).not.toContain('SECRET-1')
  })

  it('shows the error state when a kind’s details don’t load, rather than a blank form', async () => {
    api.loadProduct.mockResolvedValue(cushion({ productType: 'service' }))
    kindApi.loadProductKind.mockRejectedValue(new Error('offline'))
    await show(owner)
    expect(screen.getByRole('heading', { name: words.error.title })).toBeTruthy()
  })
})
