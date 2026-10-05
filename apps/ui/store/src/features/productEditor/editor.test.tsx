// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorProduct } from '../../api/productEditor'
import type { Acting } from '../../api/shell'
import { messages } from '../../messages'
import { editorAccessOf } from './access'

// CatEditor driven as each seat would (FIRST-RELEASE §11): what loads, what a save sends, what each refusal says.

const words = messages.editor

const api = vi.hoisted(() => ({
  loadProduct: vi.fn(),
  loadProductBasics: vi.fn(),
  loadTaxSetup: vi.fn(),
  loadApprovalRequired: vi.fn(),
  saveProduct: vi.fn(),
  uploadPhoto: vi.fn(),
}))
const listApi = vi.hoisted(() => ({ deleteProducts: vi.fn() }))

vi.mock('../../api/productEditor', async (actual) => ({ ...(await actual<typeof import('../../api/productEditor')>()), ...api }))
vi.mock('../../api/products', async (actual) => ({ ...(await actual<typeof import('../../api/products')>()), ...listApi }))

const { ProductEditor } = await import('./ProductEditor')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['catalog.read', 'catalog.write', 'approve', 'tax.configure'] }
const staff: Acting = { ...owner, role: 'staff', permissions: ['catalog.read'] }
const supplier: Acting = { ...owner, role: 'supplier-member', tier: 'vendor-catalogue', seller: { id: 'v1', name: 'Northwind Textiles' }, permissions: ['catalog.read', 'catalog.write'] }
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
  pricingCurrency: 'INR',
  photos: [],
  options: [],
  versions: [{ id: 'ver-1', choices: [], name: null, sku: null, barcode: null, visible: true, prices: [{ currency: 'INR', amount: '129900', compareAtAmount: null }], cost: null, weightGrams: null, lengthMm: null, widthMm: null, heightMm: null, hsCode: null, taxClassId: null, trackStock: true }],
  readiness: [{ marketId: 'm1', marketName: 'India', ready: true, missing: [] }],
  ...p,
})

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

const show = async (acting: Acting, path = '/products/p1', readOnly = false) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const list = createRoute({ getParentRoute: () => app, path: '/products', component: () => <p>The list</p> })
  const editor = createRoute({ getParentRoute: () => app, path: '/products/$productId', component: ProductEditor })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([list, editor])]), history: createMemoryHistory({ initialEntries: [path] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  return router
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement

beforeEach(() => {
  api.loadProduct.mockResolvedValue(cushion())
  api.loadProductBasics.mockResolvedValue({ pricingCurrency: 'INR', unitSystem: 'metric' })
  api.loadTaxSetup.mockResolvedValue({ pricesIncludeTax: true, classes: [{ id: 'tc-18', name: 'GST 18%', isDefault: true }] })
  api.loadApprovalRequired.mockResolvedValue(true)
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
})
