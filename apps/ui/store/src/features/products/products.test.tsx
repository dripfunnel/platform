// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductCounts, ProductRow } from '../../api/products'
import type { Acting } from '../../api/shell'
import { messages } from '../../messages'
import { accessOf } from './productView'

// CatList driven as a merchant would (FIRST-RELEASE §11): what each seat sees, and what each action sends.

const words = messages.products

const api = vi.hoisted(() => ({
  loadProducts: vi.fn(),
  loadProductCounts: vi.fn(),
  loadSupplierChoices: vi.fn(),
  loadHandPicked: vi.fn(),
  loadTaxClasses: vi.fn(),
  setProductsVisible: vi.fn(),
  deleteProducts: vi.fn(),
  addToCollection: vi.fn(),
  setTaxClass: vi.fn(),
  approveProduct: vi.fn(),
  sendBackProduct: vi.fn(),
}))

vi.mock('../../api/products', async (actual) => ({ ...(await actual<typeof import('../../api/products')>()), ...api }))

const editorApi = vi.hoisted(() => ({ loadProduct: vi.fn(), loadProductBasics: vi.fn(), saveProduct: vi.fn() }))
const stockApi = vi.hoisted(() => ({ loadProductStock: vi.fn(), loadWarehouses: vi.fn(), setStock: vi.fn() }))
vi.mock('../../api/productEditor', async (actual) => ({ ...(await actual<typeof import('../../api/productEditor')>()), ...editorApi }))
vi.mock('../../api/stock', async (actual) => ({ ...(await actual<typeof import('../../api/stock')>()), ...stockApi }))

const { ProductList } = await import('./ProductList')

const row = (r: Partial<ProductRow> & Pick<ProductRow, 'id' | 'name'>): ProductRow => ({
  visible: true,
  approval: null,
  productType: 'physical',
  supplier: null,
  supplierRemoved: false,
  versionCount: 1,
  minPrice: { amount: '129900', currency: 'INR' },
  maxPrice: { amount: '129900', currency: 'INR' },
  photoUrl: null,
  stock: 24,
  lowStock: false,
  readiness: [{ marketName: 'India', ready: true, missing: [] }],
  ...r,
})

const counts = (c: Partial<ProductCounts> = {}): ProductCounts => ({ all: 2, visible: 1, hidden: 1, pending: 1, sentBack: 0, lowStock: 0, missingInfo: 0, fromSuppliers: 1, outOfStock: 0, ...c })

const kurta = row({ id: 'p1', name: 'Mara Linen Shirt' })
const dupatta = row({ id: 'p2', name: 'Handloom Dupatta', approval: 'pending', visible: false, supplier: { id: 'v1', name: 'Northwind Textiles' } })

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['catalog.read', 'catalog.write', 'approve', 'manage-vendors'] }
const staff: Acting = { ...owner, role: 'staff', permissions: ['catalog.read'] }
const supplier: Acting = { ...owner, role: 'supplier-member', tier: 'vendor-catalogue', seller: { id: 'v1', name: 'Northwind Textiles' }, permissions: ['catalog.read', 'catalog.propose'] }

const show = async (acting: Acting, readOnly = false) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const list = createRoute({ getParentRoute: () => app, path: '/products', component: ProductList })
  const editor = createRoute({ getParentRoute: () => app, path: '/products/$productId', component: () => null })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([list, editor])]), history: createMemoryHistory({ initialEntries: ['/products'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  return router
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

beforeEach(() => {
  api.loadProducts.mockResolvedValue({ rows: [kurta, dupatta], next: 'c2', previous: null })
  api.loadProductCounts.mockResolvedValue(counts())
  api.loadSupplierChoices.mockResolvedValue([{ id: 'v1', name: 'Northwind Textiles' }])
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('who may do what on Products', () => {
  it('lets the owner edit, select, approve and filter by supplier; staff only look; a past-due store only looks', () => {
    expect(accessOf(owner, false)).toEqual({ supplier: false, canEdit: true, canSelect: true, canApprove: true, seeSuppliers: true, viewOnly: false, quickPrice: true, quickStock: false })
    expect(accessOf(staff, false)).toMatchObject({ canEdit: false, canSelect: false, canApprove: false, viewOnly: true })
    expect(accessOf(owner, true)).toMatchObject({ canEdit: false, canSelect: false, canApprove: false, viewOnly: false })
  })

  it('lets a supplier propose its own products but never select, approve or see other suppliers', () => {
    expect(accessOf(supplier, false)).toEqual({ supplier: true, canEdit: true, canSelect: false, canApprove: false, seeSuppliers: false, viewOnly: false, quickPrice: false, quickStock: false })
    expect(accessOf({ ...supplier, permissions: ['catalog.read', 'stock.write'] }, false).canEdit).toBe(false)
    // A catalogue tier writes its products outright; a Stock-only one proposes them.
    expect(accessOf({ ...supplier, permissions: ['catalog.read', 'catalog.write'] }, false)).toMatchObject({ canEdit: true, canSelect: false })
  })
})

describe('the Products list', () => {
  it('shows the owner the table, the approval banner, the chips with counts and the supplier column', async () => {
    await show(owner)
    expect(screen.getByRole('heading', { level: 1, name: words.title })).toBeTruthy()
    expect(screen.getByText('2 products · 1 from suppliers · 0 out of stock')).toBeTruthy()
    expect(screen.getByText('1 supplier product is waiting for your approval.')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: words.columns.supplier })).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(`^${words.chips.pending}\\s*1$`) }).getAttribute('aria-pressed')).toBe('false')
    // A chip with nothing in it is left out.
    expect(screen.queryByRole('button', { name: new RegExp(words.chips.sent_back) })).toBeNull()
    expect(api.loadProducts).toHaveBeenCalledWith({ filter: 'all', search: '', supplier: '', sort: 'updated' }, {})
  })

  it('filters by a chip, and pages on with the cursor it was given', async () => {
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: words.banner.waitingCta }))
    await settle()
    expect(api.loadProducts).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'pending' }), {})
    expect(screen.queryByText(words.banner.waitingBody, { exact: false })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: words.pages.next }))
    await settle()
    expect(api.loadProducts).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'pending' }), { after: 'c2' })
    expect(screen.getByText('Showing 11–12')).toBeTruthy()
  })

  it('reviews a waiting product and approves it, naming the supplier', async () => {
    api.approveProduct.mockResolvedValue(undefined)
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: words.row.review }))
    const review = screen.getByRole('region', { name: 'Review · from Northwind Textiles' })
    expect(within(review).getByText('No photo yet', { exact: false })).toBeTruthy()
    fireEvent.click(within(review).getByRole('button', { name: words.review.approve }))
    await settle()
    expect(api.approveProduct).toHaveBeenCalledWith('p2')
    expect(screen.getByText('“Handloom Dupatta” approved and live. Northwind Textiles has been told.')).toBeTruthy()
  })

  it('says how many were approved when a bulk approval fails part way', async () => {
    const second = { ...dupatta, id: 'p3', name: 'Second dupatta' }
    api.loadProducts.mockResolvedValue({ rows: [kurta, dupatta, second], next: null, previous: null })
    api.loadProductCounts.mockResolvedValue(counts({ all: 3, pending: 2 }))
    api.approveProduct.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'))
    await show(owner)
    fireEvent.click(screen.getByRole('checkbox', { name: words.columns.select }))
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Approve 2' }))
    await settle()
    expect(api.approveProduct.mock.calls).toEqual([['p2'], ['p3']])
    expect(screen.getByText('1 of 2 approved and live. The rest didn’t save. Try again.')).toBeTruthy()
  })

  it('goes back to the first page when an action empties a later one, never "No products match"', async () => {
    api.deleteProducts.mockResolvedValue(2)
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: words.pages.next }))
    await settle()
    api.loadProducts.mockImplementation(async (_q: unknown, cursor: { after?: string }) => (cursor.after ? { rows: [], next: null, previous: 'c1' } : { rows: [kurta], next: null, previous: null }))
    fireEvent.click(screen.getByRole('checkbox', { name: words.columns.select }))
    fireEvent.click(screen.getByRole('button', { name: words.bulk.delete }))
    fireEvent.click(screen.getByRole('button', { name: words.bulk.deleteConfirm }))
    await settle()
    await settle()
    expect(api.loadProducts).toHaveBeenLastCalledWith(expect.anything(), {})
    expect(screen.queryByRole('heading', { name: words.noResults.filters })).toBeNull()
    expect(screen.getByText('Showing 1–1')).toBeTruthy()
  })

  it('shows only what is not waiting, and says the waiting ones were skipped', async () => {
    api.setProductsVisible.mockResolvedValue(1)
    await show(owner)
    fireEvent.click(screen.getByRole('checkbox', { name: words.columns.select }))
    const bar = screen.getByRole('toolbar')
    expect(within(bar).getByText('All 2 on this page selected')).toBeTruthy()
    expect(within(bar).getByRole('button', { name: 'Approve 1' })).toBeTruthy()
    fireEvent.click(within(bar).getByRole('button', { name: words.bulk.show }))
    await settle()
    expect(api.setProductsVisible).toHaveBeenCalledWith(['p1'], true)
    expect(screen.getByText('1 now visible · products waiting for approval were skipped')).toBeTruthy()
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('says so when a bulk change fails, and keeps the list', async () => {
    api.setProductsVisible.mockRejectedValue(new Error('offline'))
    await show(owner)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Mara Linen Shirt' }))
    fireEvent.click(screen.getByRole('button', { name: words.bulk.hide }))
    await settle()
    expect(screen.getByText(words.failed)).toBeTruthy()
    expect(screen.getByText('Mara Linen Shirt')).toBeTruthy()
  })

  it('asks for a hand-picked collection first when the store has none', async () => {
    api.loadHandPicked.mockResolvedValue([])
    await show(owner)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Mara Linen Shirt' }))
    fireEvent.click(screen.getByRole('button', { name: words.bulk.addToCollection }))
    await settle()
    expect(screen.getByText(words.bulk.collectionNone)).toBeTruthy()
    expect(api.addToCollection).not.toHaveBeenCalled()
  })

  it('gives staff a view-only list with no selection, review or add', async () => {
    await show(staff)
    expect(screen.getByRole('heading', { level: 1, name: words.titleViewOnly })).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: words.row.review })).toBeNull()
    expect(screen.queryByRole('link', { name: words.add })).toBeNull()
    expect(screen.queryByText(words.banner.waitingBody, { exact: false })).toBeNull()
  })

  it('gives a supplier its own list, counted by its approval work, with no supplier filter', async () => {
    api.loadProducts.mockResolvedValue({ rows: [{ ...dupatta, readiness: null }], next: null, previous: null })
    api.loadProductCounts.mockResolvedValue(counts({ all: 1, sentBack: 0 }))
    await show(supplier)
    expect(screen.getByRole('heading', { level: 1, name: words.titleSupplier })).toBeTruthy()
    expect(screen.getByText('1 product · 1 waiting for approval · 0 sent back')).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: words.columns.supplier })).toBeNull()
    expect(screen.getByRole('link', { name: words.add })).toBeTruthy()
    expect(api.loadSupplierChoices).not.toHaveBeenCalled()
  })

  it('welcomes a new store with the first-product hero, and a supplier with its own empty state', async () => {
    api.loadProducts.mockResolvedValue({ rows: [], next: null, previous: null })
    api.loadProductCounts.mockResolvedValue(counts({ all: 0, visible: 0, hidden: 0, pending: 0 }))
    await show(owner)
    expect(screen.getByRole('heading', { name: words.empty.title })).toBeTruthy()
    expect(screen.getByText('0 of 4 done')).toBeTruthy()
    cleanup()
    await show(supplier)
    expect(screen.getByRole('heading', { name: words.supplierEmpty.title })).toBeTruthy()
  })

  it('offers to clear a search that matches nothing', async () => {
    await show(owner)
    api.loadProducts.mockResolvedValue({ rows: [], next: null, previous: null })
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${words.chips.hidden}\\s*1$`) }))
    await settle()
    expect(screen.getByRole('heading', { name: words.noResults.filters })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.noResults.clear }))
    await settle()
    expect(api.loadProducts).toHaveBeenLastCalledWith({ filter: 'all', search: '', supplier: '', sort: 'updated' }, {})
  })

  it('shows the error state with a retry when the list fails', async () => {
    api.loadProducts.mockRejectedValue(new Error('offline'))
    await show(owner)
    expect(screen.getByRole('heading', { name: words.error.title })).toBeTruthy()
  })

  it('quick-edits a product’s price and stock in place, as the editor saves them', async () => {
    const editable = { ...owner, permissions: [...owner.permissions, 'stock.write'] }
    editorApi.loadProductBasics.mockResolvedValue({ pricingCurrency: 'INR', unitSystem: 'metric', features: [], badges: [] })
    editorApi.loadProduct.mockResolvedValue({
      id: 'p1', revision: 5, name: 'Mara Linen Shirt', description: '', productType: 'physical', visible: true, approval: null, sentBackReason: null, supplier: null, slug: 'mara', seoTitle: null, seoDescription: null, pricingCurrency: 'INR', listing: { specs: [], highlights: [], faqs: [], relatedIds: [], related: [], badgeIds: [], compliance: [], ageRestricted: null, hazardous: null }, filterValues: [], sizeChartId: null,  photos: [], options: [], readiness: [],
      versions: [{ id: 'ver-1', choices: [], name: null, sku: null, barcode: null, visible: true, prices: [{ currency: 'INR', amount: '129900', compareAtAmount: null }], cost: null, weightGrams: null, lengthMm: null, widthMm: null, heightMm: null, hsCode: null, taxClassId: null, trackStock: true, continueSelling: false }],
    })
    editorApi.saveProduct.mockResolvedValue({ id: 'p1', revision: 6, approval: null })
    stockApi.loadWarehouses.mockResolvedValue([{ id: 'w1', name: 'Jaipur studio', isDefault: true }])
    stockApi.loadProductStock.mockResolvedValue(new Map([['ver-1', [{ warehouseId: 'w1', warehouseName: 'Jaipur studio', isDefault: true, onHand: 4, reserved: 0 }]]]))
    stockApi.setStock.mockResolvedValue(undefined)
    await show(editable)
    fireEvent.click(screen.getByRole('button', { name: 'Quick edit Mara Linen Shirt' }))
    await settle()
    const panel = within(screen.getByRole('region', { name: 'Quick edit · Mara Linen Shirt' }))
    expect(panel.getByText('Price in INR · stock in Jaipur studio')).toBeTruthy()
    fireEvent.change(panel.getByLabelText('Price of This product'), { target: { value: '1399' } })
    fireEvent.change(panel.getByLabelText('Stock of This product'), { target: { value: '9' } })
    fireEvent.click(panel.getByRole('button', { name: 'Save 2 changes' }))
    await settle()
    expect(editorApi.saveProduct).toHaveBeenCalledWith('p1', 5, expect.objectContaining({ versions: [expect.objectContaining({ id: 'ver-1', prices: [{ currency: 'INR', amount: '139900' }] })] }), false)
    expect(stockApi.setStock).toHaveBeenCalledWith([{ versionId: 'ver-1', warehouseId: 'w1', quantity: 9 }])
    expect(screen.getByText('Saved 2 changes to Mara Linen Shirt')).toBeTruthy()
  })

  it('offers no quick edit to staff, and none on a product waiting for review', async () => {
    await show(staff)
    expect(screen.queryByRole('button', { name: /^Quick edit/ })).toBeNull()
    cleanup()
    await show(owner)
    expect(screen.getByRole('button', { name: 'Quick edit Mara Linen Shirt' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Quick edit Handloom Dupatta' })).toBeNull()
  })

  it('clears a supplier filter on a phone, which has no control to show or clear it', async () => {
    const wide = { matches: false }
    const listeners: (() => void)[] = []
    vi.stubGlobal('matchMedia', () => ({ get matches() { return wide.matches }, addEventListener: (_: string, f: () => void) => listeners.push(f), removeEventListener: () => undefined }))
    await show(owner)
    fireEvent.change(screen.getByLabelText(words.supplier.label), { target: { value: 'v1' } })
    await settle()
    expect(api.loadProducts).toHaveBeenLastCalledWith(expect.objectContaining({ supplier: 'v1' }), {})
    wide.matches = true
    act(() => listeners.forEach((f) => f()))
    await settle()
    expect(api.loadProducts).toHaveBeenLastCalledWith(expect.objectContaining({ supplier: '' }), {})
    vi.unstubAllGlobals()
  })

  it('keeps saved prices when only the stock fails, and sends just the counts on retry at the new revision', async () => {
    const editable = { ...owner, permissions: [...owner.permissions, 'stock.write'] }
    editorApi.loadProductBasics.mockResolvedValue({ pricingCurrency: 'INR', unitSystem: 'metric', features: [], badges: [] })
    editorApi.loadProduct.mockResolvedValue({
      id: 'p1', revision: 5, name: 'Mara Linen Shirt', description: '', productType: 'physical', visible: true, approval: null, sentBackReason: null, supplier: null, slug: 'mara', seoTitle: null, seoDescription: null, pricingCurrency: 'INR', listing: { specs: [], highlights: [], faqs: [], relatedIds: [], related: [], badgeIds: [], compliance: [], ageRestricted: null, hazardous: null }, filterValues: [], sizeChartId: null,  photos: [], options: [], readiness: [],
      versions: [{ id: 'ver-1', choices: [], name: null, sku: null, barcode: null, visible: true, prices: [{ currency: 'INR', amount: '129900', compareAtAmount: null }], cost: null, weightGrams: null, lengthMm: null, widthMm: null, heightMm: null, hsCode: null, taxClassId: null, trackStock: true, continueSelling: false }],
    })
    editorApi.saveProduct.mockResolvedValue({ id: 'p1', revision: 6, approval: null })
    stockApi.loadWarehouses.mockResolvedValue([{ id: 'w1', name: 'Jaipur studio', isDefault: true }])
    stockApi.loadProductStock.mockResolvedValue(new Map([['ver-1', [{ warehouseId: 'w1', warehouseName: 'Jaipur studio', isDefault: true, onHand: 4, reserved: 0 }]]]))
    stockApi.setStock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined)
    await show(editable)
    fireEvent.click(screen.getByRole('button', { name: 'Quick edit Mara Linen Shirt' }))
    await settle()
    const panel = within(screen.getByRole('region', { name: 'Quick edit · Mara Linen Shirt' }))
    fireEvent.change(panel.getByLabelText('Price of This product'), { target: { value: '1399' } })
    fireEvent.change(panel.getByLabelText('Stock of This product'), { target: { value: '9' } })
    fireEvent.click(panel.getByRole('button', { name: 'Save 2 changes' }))
    await settle()
    expect(panel.getByText(words.quick.stockFailed)).toBeTruthy()
    fireEvent.click(panel.getByRole('button', { name: 'Save 1 change' }))
    await settle()
    expect(editorApi.saveProduct).toHaveBeenCalledTimes(1)
    expect(stockApi.setStock).toHaveBeenLastCalledWith([{ versionId: 'ver-1', warehouseId: 'w1', quantity: 9 }])
  })

  it('says there are no tax categories to choose instead of an empty choice', async () => {
    api.loadTaxClasses.mockResolvedValue([])
    await show(owner)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Mara Linen Shirt' }))
    fireEvent.click(screen.getByRole('button', { name: words.bulk.taxClass }))
    await settle()
    expect(screen.getByText(words.bulk.taxNone)).toBeTruthy()
    expect(document.querySelector('dialog')).toBeNull()
  })
})
