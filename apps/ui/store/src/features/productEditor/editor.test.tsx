// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorProduct } from '../../api/productEditor'
import type { Acting } from '../../api/shell'
import { fill, messages } from '../../messages'
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
  uploadVideo: vi.fn(),
}))
const lengthApi = vi.hoisted(() => ({ videoSeconds: vi.fn() }))
const listApi = vi.hoisted(() => ({ deleteProducts: vi.fn(), duplicateProduct: vi.fn(), loadHandPicked: vi.fn(), loadProducts: vi.fn() }))
const translationApi = vi.hoisted(() => ({ loadProductTranslation: vi.fn(), saveProductTranslation: vi.fn() }))
const kindApi = vi.hoisted(() => ({ loadProductKind: vi.fn(), saveProductKind: vi.fn(), addLicenceKeys: vi.fn(), uploadDownload: vi.fn(), loadGiftCards: vi.fn(), issueGiftCard: vi.fn() }))
const stockApi = vi.hoisted(() => ({ loadProductStock: vi.fn(), loadWarehouses: vi.fn(), loadStockHistory: vi.fn(), adjustStock: vi.fn(), setStock: vi.fn() }))

vi.mock('../../api/productEditor', async (actual) => ({ ...(await actual<typeof import('../../api/productEditor')>()), ...api }))
vi.mock('../common/videoLength', async (actual) => ({ ...(await actual<typeof import('../common/videoLength')>()), ...lengthApi }))
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
  pricingCurrency: 'INR', listing: { specs: [], highlights: [], faqs: [], relatedIds: [], related: [], badgeIds: [], compliance: [], ageRestricted: null, hazardous: null }, filterValues: [], sizeChartId: null, questions: [], 
  photos: [],
  options: [],
  versions: [{ id: 'ver-1', choices: [], name: null, sku: null, barcode: null, visible: true, prices: [{ currency: 'INR', amount: '129900', compareAtAmount: null }], cost: null, weightGrams: null, lengthMm: null, widthMm: null, heightMm: null, hsCode: null, taxClassId: null, photoAssetId: null, trackStock: true, continueSelling: false }],
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
    fireEvent.change(field(words.name.label), { target: { value: 'Kurta' } })
    fireEvent.click(screen.getAllByRole('button', { name: words.saveNew })[0] as HTMLElement)
    await settle()
    expect(screen.getByText(words.price.missing)).toBeTruthy()
    expect(api.saveProduct).not.toHaveBeenCalled()
    fireEvent.change(field(words.name.label), { target: { value: '' } })
    fireEvent.change(field(words.price.price), { target: { value: '1299.5' } })
    fireEvent.click(screen.getAllByRole('button', { name: words.saveNew })[0] as HTMLElement)
    await settle()
    expect(screen.getByText(words.name.missing)).toBeTruthy()
    expect(api.saveProduct).not.toHaveBeenCalled()
    fireEvent.change(field(words.name.label), { target: { value: 'Kurta' } })
    fireEvent.click(within(screen.getByRole('region', { name: words.bar.unsaved })).getByRole('button', { name: words.saveNew }))
    await settle()
    expect(api.saveProduct).toHaveBeenCalledWith(null, null, expect.objectContaining({ name: 'Kurta', productType: 'physical', visible: true, versions: [expect.objectContaining({ choices: [], prices: [{ currency: 'INR', amount: '129950' }], taxClassId: null, photoAssetId: null })] }), false)
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

  describe('the line beside Create versions (#1451)', () => {
    const type = (label: string, entries: string[]) => {
      const input = screen.getByLabelText(`${label}: ${words.choices.valuePlaceholder}`)
      for (const entry of entries) {
        fireEvent.change(input, { target: { value: entry } })
        fireEvent.keyDown(input, { key: 'Enter' })
      }
    }
    const line = (count: string, from: string) => {
      const strong = screen.getByText(count, { selector: 'strong' })
      expect(strong.parentElement?.textContent).toBe(`${count} from ${from}`)
      expect(screen.getByRole('button', { name: `Create ${count}` })).toBeTruthy()
    }

    it('puts the number of versions first, then each choice as “Name (count)”, for one, two and three kinds, and for the merchant’s own name', async () => {
      await show(owner)
      fireEvent.click(screen.getByRole('button', { name: words.choices.add }))
      type('Size', ['0–3 m', '3–6 m', '6–12 m'])
      line('3 versions', 'Size (3)')
      fireEvent.click(screen.getByRole('button', { name: '+ Colour' }))
      type('Colour', ['Sky blue', 'Oatmeal'])
      line('6 versions', 'Size (3) × Colour (2)')
      fireEvent.click(screen.getByRole('button', { name: words.choices.custom }))
      fireEvent.change(within(document.querySelector('dialog') as HTMLElement).getByLabelText(words.choices.customLabel), { target: { value: 'Pack of' } })
      fireEvent.click(within(document.querySelector('dialog') as HTMLElement).getByRole('button', { name: words.apply }))
      type('Pack of', ['1', '3'])
      line('12 versions', 'Size (3) × Colour (2) × Pack of (2)')
    })

    it('says “1 version” for one, and keeps the line’s number the same as the button’s', async () => {
      await show(owner)
      fireEvent.click(screen.getByRole('button', { name: words.choices.add }))
      type('Size', ['One size'])
      line('1 version', 'Size (1)')
    })
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
    expect(screen.getByText('2 versions', { selector: 'strong' }).parentElement?.textContent).toBe('2 versions from Size (2)')
    fireEvent.click(screen.getByRole('button', { name: 'Create 2 versions' }))
    fireEvent.click(within(document.querySelector('dialog') as HTMLElement).getByRole('button', { name: words.choices.createConfirm }))
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

  describe('the window before the first versions are made (#1450)', () => {
    const sizes = (names: string[]) => {
      fireEvent.click(screen.getByRole('button', { name: words.choices.add }))
      const values = screen.getByLabelText(`Size: ${words.choices.valuePlaceholder}`)
      for (const size of names) {
        fireEvent.change(values, { target: { value: size } })
        fireEvent.keyDown(values, { key: 'Enter' })
      }
    }
    const dialog = () => document.querySelector('dialog') as HTMLElement

    it('warns about the price and the stock that won’t carry over, and makes nothing on Cancel', async () => {
      await show(owner)
      fireEvent.change(field('Stock at Jaipur studio'), { target: { value: '10' } })
      sizes(['S', 'M', 'L'])
      fireEvent.click(screen.getByRole('button', { name: 'Create 3 versions' }))
      const text = within(dialog())
      expect(text.getByText('Create 3 versions?')).toBeTruthy()
      expect(dialog().textContent).toContain(`${fill(words.choices.createBody, { price: '₹1,299.00' })} ${fill(words.choices.createStockLost, { count: '10' })}`)
      fireEvent.click(text.getByRole('button', { name: messages.editor.cancel }))
      expect(screen.queryByLabelText('Price of S')).toBeNull()
      expect(screen.getByRole('button', { name: 'Create 3 versions' })).toBeTruthy()
      expect(field('Stock at Jaipur studio').value).toBe('10')
    })

    it('makes the versions on Create versions, as before', async () => {
      await show(owner)
      sizes(['S', 'M'])
      fireEvent.click(screen.getByRole('button', { name: 'Create 2 versions' }))
      fireEvent.click(within(dialog()).getByRole('button', { name: words.choices.createConfirm }))
      expect(field('Price of S').value).toBe('1299.00')
      expect(field('Price of M').value).toBe('1299.00')
    })

    it('leaves the stock sentence out when there is no stock, and says “1 version” for one', async () => {
      await show(owner)
      fireEvent.change(field('Stock at Jaipur studio'), { target: { value: '0' } })
      sizes(['One size'])
      fireEvent.click(screen.getByRole('button', { name: 'Create 1 version' }))
      expect(within(dialog()).getByText('Create 1 version?')).toBeTruthy()
      expect(dialog().textContent).toContain(fill(words.choices.createBody, { price: '₹1,299.00' }))
      expect(dialog().textContent).not.toContain('in stock now')
    })

    it('doesn’t ask again for Update versions', async () => {
      await show(owner)
      sizes(['S', 'M'])
      fireEvent.click(screen.getByRole('button', { name: 'Create 2 versions' }))
      fireEvent.click(within(dialog()).getByRole('button', { name: words.choices.createConfirm }))
      const values = screen.getByLabelText(`Size: ${words.choices.valuePlaceholder}`)
      fireEvent.change(values, { target: { value: 'L' } })
      fireEvent.keyDown(values, { key: 'Enter' })
      fireEvent.click(screen.getByRole('button', { name: words.choices.update }))
      expect(document.querySelector('dialog[open]')).toBeNull()
      expect(screen.getByLabelText('Price of L')).toBeTruthy()
    })
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

  describe('the HS code', () => {
    const save = async () => {
      fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
      await settle()
    }
    const typeCode = async (code: string) => {
      api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: null })
      await show(owner)
      fireEvent.click(screen.getByRole('button', { name: new RegExp(words.sections.ship) }))
      fireEvent.change(field(words.sections.code), { target: { value: code } })
      await save()
    }

    it.each(['7113', 'ABC-necklace'])('says under the field that %s isn’t 6 to 10 digits, and sends nothing', async (code) => {
      await typeCode(code)
      expect(api.saveProduct).not.toHaveBeenCalled()
      expect(screen.getByText(words.sections.hsCodeInvalid)).toBeTruthy()
      expect(field(words.sections.code).getAttribute('aria-invalid')).toBe('true')
      expect(screen.queryByText(words.refused.other)).toBeNull()
    })

    it.each(['711319', '71131900'])('saves %s', async (code) => {
      await typeCode(code)
      expect(api.saveProduct).toHaveBeenCalledTimes(1)
      expect(screen.queryByText(words.sections.hsCodeInvalid)).toBeNull()
    })

    it('saves with the code left empty', async () => {
      api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: null })
      await show(owner)
      fireEvent.change(field(words.name.label), { target: { value: 'Renamed cushion' } })
      await save()
      expect(api.saveProduct).toHaveBeenCalledTimes(1)
    })

    it('suggests a code that is itself valid', () => {
      expect(words.sections.codePlaceholder).toBe('e.g. 610910')
    })
  })

  it('says which field a refused save is about, opens it, and highlights it until it changes', async () => {
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    api.saveProduct.mockRejectedValue(new ApiError('INVALID_INPUT', 'Something in this product isn’t valid.', { field: 'hsCode' }))
    await show(owner)
    expect(screen.queryByLabelText(words.sections.code)).toBeNull()
    fireEvent.change(field(words.name.label), { target: { value: 'Renamed cushion' } })
    fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
    await settle()
    expect(within(screen.getByRole('region', { name: words.bar.failed })).getByText(words.sections.hsCodeInvalid)).toBeTruthy()
    expect(screen.queryByText(words.refused.other)).toBeNull()
    expect(field(words.sections.code).getAttribute('aria-invalid')).toBe('true')
    expect(scrolled.mock.contexts[0]).toBe(field(words.sections.code))
    fireEvent.change(field(words.sections.code), { target: { value: '711319' } })
    expect(field(words.sections.code).getAttribute('aria-invalid')).not.toBe('true')
  })

  it('has a message for every refusal a product save can answer, and keeps the catch-all for anything else', () => {
    const codes = [
      'NAME_REQUIRED', 'INVALID_INPUT', 'CATEGORY_REFUSED', 'TOO_MANY_OPTIONS', 'TOO_MANY_VERSIONS', 'OPTION_VALUES_REQUIRED', 'DUPLICATE_OPTION', 'DUPLICATE_VALUE',
      'VERSION_CHOICES', 'DUPLICATE_VERSION', 'VERSION_REQUIRED', 'PRICE_REQUIRED', 'INVALID_PRICE', 'INVALID_BARCODE', 'DUPLICATE_SKU', 'TOO_MANY_PHOTOS', 'INVALID_PHOTO',
      'INVALID_VIDEO', 'INVALID_FILTER', 'INVALID_LISTING', 'LISTING_REFUSED', 'NOT_FOUND', 'CURRENCY_REQUIRED', 'SUPPLIER_FIELD', 'FILE_REFUSED', 'NOT_SHOWABLE',
      'VIDEO_LIMIT', 'STALE_REVISION', 'PLAN_LIMIT', 'READ_ONLY', 'FORBIDDEN',
    ]
    const refused: Record<string, string> = words.refused
    expect(codes.filter((code) => !refused[code])).toEqual([])
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

  describe('Duplicate (#1446)', () => {
    const menu = () => screen.queryByRole('button', { name: /^More actions for/ }) as HTMLButtonElement | null
    const duplicate = () => {
      const button = menu()
      if (button && button.getAttribute('aria-expanded') !== 'true') fireEvent.click(button)
      return screen.queryByRole('menuitem', { name: messages.products.duplicate }) as HTMLButtonElement | null
    }

    it('makes one copy from an open product, and opens it with the message', async () => {
      listApi.duplicateProduct.mockResolvedValue('p2')
      const router = await show(owner)
      expect(duplicate()).toBeTruthy()
      fireEvent.click(duplicate() as HTMLElement)
      fireEvent.click(duplicate() as HTMLElement)
      await settle()
      expect(listApi.duplicateProduct).toHaveBeenCalledTimes(1)
      expect(listApi.duplicateProduct).toHaveBeenCalledWith('p1')
      expect(router.state.location.pathname).toBe('/products/p2')
      expect(screen.getByText(messages.products.duplicated)).toBeTruthy()
    })

    it('asks first when there are unsaved changes: Cancel makes no copy, and confirming copies what is saved and opens it without a second prompt', async () => {
      listApi.duplicateProduct.mockResolvedValue('p2')
      const leave = vi.spyOn(window, 'confirm').mockReturnValue(false)
      const router = await show(owner)
      fireEvent.change(field(words.name.label), { target: { value: 'Changed name' } })
      fireEvent.click(duplicate() as HTMLElement)
      const dialog = () => within(document.querySelector('dialog') as HTMLElement)
      expect(dialog().getByText(words.duplicateUnsaved)).toBeTruthy()
      fireEvent.click(dialog().getByRole('button', { name: words.cancel }))
      expect(listApi.duplicateProduct).not.toHaveBeenCalled()
      expect(router.state.location.pathname).toBe('/products/p1')
      expect(duplicate()?.disabled).toBe(false)
      fireEvent.click(duplicate() as HTMLElement)
      fireEvent.click(dialog().getByRole('button', { name: words.duplicateConfirm }))
      await settle()
      expect(listApi.duplicateProduct).toHaveBeenCalledTimes(1)
      expect(router.state.location.pathname).toBe('/products/p2')
      expect(leave).not.toHaveBeenCalled()
      leave.mockRestore()
    })

    it('copies at once, with no question, when nothing is unsaved', async () => {
      listApi.duplicateProduct.mockResolvedValue('p2')
      await show(owner)
      fireEvent.click(duplicate() as HTMLElement)
      expect(document.querySelector('dialog')).toBeNull()
      await settle()
      expect(listApi.duplicateProduct).toHaveBeenCalledTimes(1)
    })

    it('is in a ⋮ menu beside Delete, not a button of its own, and is not there on a new product, for Staff, for a seat that can only propose, or in a read-only store', async () => {
      await show(owner)
      expect(screen.queryByRole('button', { name: messages.products.duplicate })).toBeNull()
      expect(menu()?.getAttribute('aria-haspopup')).toBe('menu')
      expect(duplicate()).toBeTruthy()
      cleanup()
      await show(owner, '/products/new')
      expect(duplicate()).toBeNull()
      cleanup()
      await show(staff)
      expect(duplicate()).toBeNull()
      cleanup()
      await show({ ...supplier, permissions: ['catalog.read', 'catalog.propose', 'stock.write'] })
      expect(duplicate()).toBeNull()
      cleanup()
      await show(owner, '/products/p1', true)
      expect(duplicate()).toBeNull()
    })

    it('is offered to a supplier on its own product, which stays its own', async () => {
      await show(supplier)
      expect(duplicate()).toBeTruthy()
    })

    it('says so at the plan’s product limit, and makes no copy', async () => {
      listApi.duplicateProduct.mockRejectedValue(new ApiError('PLAN_LIMIT', 'No room'))
      const router = await show(owner)
      fireEvent.click(duplicate() as HTMLElement)
      await settle()
      expect(screen.getByText(messages.products.duplicateLimit)).toBeTruthy()
      expect(router.state.location.pathname).toBe('/products/p1')
      expect(duplicate()?.disabled).toBe(false)
    })

    it('says the copy couldn’t be made on any other error, and lets the merchant try again', async () => {
      listApi.duplicateProduct.mockRejectedValueOnce(new Error('offline')).mockResolvedValue('p2')
      const router = await show(owner)
      fireEvent.click(duplicate() as HTMLElement)
      await settle()
      expect(screen.getByText(messages.products.duplicateFailed)).toBeTruthy()
      fireEvent.click(duplicate() as HTMLElement)
      await settle()
      expect(router.state.location.pathname).toBe('/products/p2')
    })
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
    kindApi.saveProductKind.mockResolvedValue({ productId: 'p1', productType: 'service', revision: 4, download: null, service: { duration: null, location: null } })
    kindApi.loadProductKind.mockResolvedValue(kindView({ productType: 'service', service: { duration: null, location: null } }))
    await show(owner, '/products/new')
    fireEvent.change(field(words.name.label), { target: { value: 'Tailoring' } })
    fireEvent.change(field(words.price.price), { target: { value: '499' } })
    fireEvent.change(field('Stock at Jaipur studio'), { target: { value: 'many' } })
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(words.kind.service) }))
    api.loadProduct.mockResolvedValue(cushion({ productType: 'service' }))
    fireEvent.click(screen.getAllByRole('button', { name: words.saveNew })[0] as HTMLElement)
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
const version = (id: string, choices: string[], amount: string) => ({ id, choices, name: null, sku: null, barcode: null, visible: true, prices: [{ currency: 'INR', amount, compareAtAmount: null }], cost: null, weightGrams: null, lengthMm: null, widthMm: null, heightMm: null, hsCode: null, taxClassId: null, photoAssetId: null, trackStock: null, continueSelling: null })
const kindView = (over: Record<string, unknown>) => ({ productId: 'p1', productType: 'digital', revision: 2, download: null, service: null, giftCard: null, ...over })
const pool = (left: number) => ({ mode: 'keys', file: null, limit: 5, days: 30, keysLeft: left, keysSold: 4 })
const giftCard = (p: Partial<EditorProduct> = {}) =>
  cushion({ productType: 'gift_card', options: [{ id: 'o1', name: 'Amount', values: [{ id: 'va', name: '₹500' }, { id: 'vb', name: '₹1,000' }] }], versions: [version('ver-a', ['₹500'], '50000'), version('ver-b', ['₹1,000'], '100000')], ...p })
const issued = (id: string, last4: string | null) => ({ id, last4, recipientName: 'Meera Iyer', recipientEmail: 'meera@example.com', amount: { amount: '50000', currency: 'INR' }, balance: { amount: '50000', currency: 'INR' }, sendOn: null, sentAt: '2026-08-14T08:00:00Z', expiresAt: '2027-08-14T08:00:00Z', source: 'issued', status: 'active' })
const dialog = () => document.querySelector('dialog') as HTMLElement
const labelled = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement
const saveButton = () => screen.getAllByRole('button', { name: words.save })[0] as HTMLElement
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
    kindApi.uploadDownload.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ok: false, code: 'TOO_LARGE' }).mockResolvedValueOnce({ ok: false, code: 'READ_ONLY' }).mockResolvedValueOnce({ ok: true, file: { id: 'f2', mime: 'application/zip', bytes: 1024 * 1024 } })
    await show(owner)
    const input = () => document.querySelector('input[accept^="application/pdf"]') as HTMLInputElement
    const file = new File(['x'], 'a.zip', { type: 'application/zip' })
    fireEvent.change(input(), { target: { files: [file] } })
    fireEvent.change(input(), { target: { files: [file] } })
    await settle()
    expect(screen.getByText('That file is too big. Use one under 30 MB.')).toBeTruthy()
    fireEvent.change(input(), { target: { files: [file] } })
    await settle()
    expect(screen.getByText(kinds.download.refused.READ_ONLY)).toBeTruthy()
    expect(screen.queryByText('That file is too big. Use one under 30 MB.')).toBeNull()
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

  it('keeps what the shopper gets on the page when it is refused after an existing product saved, and adds the same keys again', async () => {
    api.loadProduct.mockResolvedValue(cushion({ productType: 'digital' }))
    kindApi.loadProductKind.mockResolvedValue(kindView({ download: { mode: 'file', file: { id: 'f1', mime: 'application/pdf', bytes: 1024 * 1024 }, limit: 5, days: 30, keysLeft: 0, keysSold: 0 } }))
    api.saveProduct.mockResolvedValueOnce({ id: 'p1', revision: 3, approval: null }).mockResolvedValueOnce({ id: 'p1', revision: 4, approval: null }).mockResolvedValueOnce({ id: 'p1', revision: 6, approval: null })
    kindApi.saveProductKind.mockRejectedValueOnce(new ApiError('STALE_REVISION', 'stale')).mockResolvedValueOnce(kindView({ revision: 5, download: { ...pool(0), limit: 10 } }))
    kindApi.addLicenceKeys.mockRejectedValueOnce(new ApiError('NOT_CONNECTED', 'offline')).mockResolvedValueOnce(kindView({ revision: 7, download: pool(2) }))
    await show(owner)
    fireEvent.change(field(kinds.download.limit), { target: { value: '10' } })
    fireEvent.click(saveButton())
    await settle()
    expect(kindApi.saveProductKind).toHaveBeenLastCalledWith('p1', 3, { download: { mode: 'file', fileId: 'f1', limit: 10, days: 30 } })
    expect(within(screen.getByRole('region', { name: words.bar.failed })).getByText(kinds.refused.STALE_REVISION)).toBeTruthy()
    expect((field(kinds.download.limit) as unknown as HTMLSelectElement).value).toBe('10')
    fireEvent.click(screen.getByRole('radio', { name: kinds.download.keys }))
    fireEvent.change(field(kinds.download.keysLabel), { target: { value: 'K-1\nK-2' } })
    fireEvent.click(saveButton())
    await settle()
    expect(kindApi.saveProductKind).toHaveBeenLastCalledWith('p1', 4, { download: { mode: 'keys', fileId: null, limit: 10, days: 30 } })
    expect(kindApi.addLicenceKeys).toHaveBeenLastCalledWith('p1', ['K-1', 'K-2'])
    expect(within(screen.getByRole('region', { name: words.bar.failed })).getByText(kinds.refused.other)).toBeTruthy()
    expect(field(kinds.download.keysLabel).value).toBe('K-1\nK-2')
    fireEvent.click(saveButton())
    await settle()
    expect(kindApi.saveProductKind).toHaveBeenCalledTimes(2)
    expect(kindApi.addLicenceKeys).toHaveBeenCalledTimes(2)
    expect(kindApi.addLicenceKeys).toHaveBeenLastCalledWith('p1', ['K-1', 'K-2'])
    expect(field(kinds.download.keysLabel).value).toBe('')
    expect(screen.getByText(/2 keys left/)).toBeTruthy()
  })

  it('moves focus to the file’s Replace once the upload answers, so a keyboard user isn’t left on the page’s body', async () => {
    api.loadProduct.mockResolvedValue(cushion({ productType: 'digital' }))
    kindApi.loadProductKind.mockResolvedValue(kindView({ download: { mode: 'file', file: null, limit: 5, days: 30, keysLeft: 0, keysSold: 0 } }))
    kindApi.uploadDownload.mockResolvedValue({ ok: true, file: { id: 'f1', mime: 'application/pdf', bytes: 1024 } })
    await show(owner)
    const dropArea = screen.getByRole('button', { name: new RegExp(kinds.download.upload) })
    dropArea.focus()
    fireEvent.change(document.querySelector('input[accept^="application/pdf"]') as HTMLInputElement, { target: { files: [new File(['%PDF-'], 'a.pdf', { type: 'application/pdf' })] } })
    expect(document.activeElement).toBe(dropArea)
    await settle()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: kinds.download.replace }))
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

  it('shows Staff and a read-only store a key pool’s count with no way to add keys or change the kind', async () => {
    api.loadProduct.mockResolvedValue(cushion({ productType: 'digital' }))
    kindApi.loadProductKind.mockResolvedValue(kindView({ download: pool(40) }))
    for (const [seat, readOnly] of [[staff, false], [owner, true]] as const) {
      await show(seat, '/products/p1', readOnly)
      expect(screen.getByText(/40 keys left/)).toBeTruthy()
      expect(screen.queryByLabelText(kinds.download.keysLabel)).toBeNull()
      expect((screen.getByRole('radio', { name: kinds.download.file }) as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByRole('radio', { name: new RegExp(words.kind.physical) }) as HTMLButtonElement).disabled).toBe(true)
      cleanup()
    }
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
    api.loadProduct.mockResolvedValue(cushion({ productType: 'service' }))
    kindApi.loadProductKind.mockResolvedValue(kindView({ productType: 'service', service: { duration: null, location: null } }))
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

  it('shows Staff and a read-only store a gift card’s cards issued with no way to issue one or change its amounts', async () => {
    api.loadProduct.mockResolvedValue(giftCard())
    kindApi.loadProductKind.mockResolvedValue(kindView({ productType: 'gift_card', giftCard: { expiryMonths: 12, shortestMonths: 12 } }))
    kindApi.loadGiftCards.mockResolvedValue({ rows: [issued('g1', '91MX')], next: null })
    for (const [seat, readOnly] of [[staff, false], [owner, true]] as const) {
      await show(seat, '/products/p1', readOnly)
      expect(screen.getByText('•••• 91MX')).toBeTruthy()
      expect(screen.queryByRole('button', { name: kinds.giftCard.issue })).toBeNull()
      expect(screen.queryByRole('button', { name: kinds.giftCard.add })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Remove ₹500' })).toBeNull()
      expect((screen.getByLabelText(kinds.giftCard.expiry) as HTMLSelectElement).disabled).toBe(true)
      cleanup()
    }
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

  it('locks a saved physical item to physical, and says why (#1459)', async () => {
    await show(owner)
    for (const kind of ['digital', 'service', 'gift_card'] as const) {
      const card = screen.getByRole('radio', { name: new RegExp(words.kind[kind]) }) as HTMLButtonElement
      expect(card.disabled).toBe(true)
      fireEvent.click(card)
    }
    expect((screen.getByRole('radio', { name: new RegExp(words.kind.physical) }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText(words.kind.locked)).toBeTruthy()
    expect(screen.queryByText(words.kind.gone)).toBeNull()
  })

  it('lets a new product pick any kind, with no lock hint (#1459)', async () => {
    await show(owner, '/products/new')
    for (const kind of ['physical', 'digital', 'service', 'gift_card'] as const) expect((screen.getByRole('radio', { name: new RegExp(words.kind[kind]) }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText(words.kind.locked)).toBeNull()
  })

  it('lets a saved download, service or gift card switch kind (#1459)', async () => {
    for (const [productType, details] of [['digital', { download: { mode: 'file', file: null, limit: 5, days: 30, keysLeft: 0, keysSold: 0 } }], ['service', { service: { duration: null, location: null } }], ['gift_card', { giftCard: { expiryMonths: 12, shortestMonths: 12 } }]] as const) {
      api.loadProduct.mockResolvedValue(cushion({ productType }))
      kindApi.loadProductKind.mockResolvedValue(kindView({ productType, ...details }))
      kindApi.loadGiftCards.mockResolvedValue({ rows: [], next: null })
      await show(owner)
      for (const kind of ['physical', 'digital', 'service', 'gift_card'] as const) expect((screen.getByRole('radio', { name: new RegExp(words.kind[kind]) }) as HTMLButtonElement).disabled).toBe(false)
      expect(screen.queryByText(words.kind.locked)).toBeNull()
      cleanup()
    }
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

describe('each version’s own compare-at price, cost and photo (#1117)', () => {
  const sizes = (p: Partial<EditorProduct> = {}) =>
    cushion({ options: [{ id: 'o1', name: 'Size', values: [{ id: 'vs', name: 'S' }, { id: 'vm', name: 'M' }, { id: 'vl', name: 'L' }] }], versions: [version('ver-s', ['S'], '129900'), version('ver-m', ['M'], '149900'), version('ver-l', ['L'], '169900')], ...p })
  const more = (name: string) => within(screen.getByRole('group', { name: `More for ${name}` }))
  // A price box's currency is written outside it, on its left, as the single-version Price field draws it (#1349).
  const currencyBeside = (box: HTMLInputElement) => {
    const wrap = box.parentElement
    const label = wrap?.firstElementChild
    return { wrapped: wrap?.classList.contains('df-editor-money') === true, text: label?.textContent, hidden: label?.getAttribute('aria-hidden'), boxIsNext: label?.nextElementSibling === box }
  }
  const sent = () => api.saveProduct.mock.calls[0]?.[2] as { versions: { choices: string[]; prices: unknown[]; cost?: unknown; photoAssetId?: string | null }[]; photos: unknown[] }

  beforeEach(() => {
    api.loadProduct.mockResolvedValue(sizes())
    api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: null })
    stockApi.loadProductStock.mockResolvedValue(new Map())
    vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }))
  })

  it('writes the store’s currency outside each version’s price box, on its left, with only the number in the box, and keeps the box’s name', async () => {
    await show(owner)
    for (const name of ['S', 'M', 'L']) {
      const box = screen.getByRole('textbox', { name: `Price of ${name}` }) as HTMLInputElement
      expect(currencyBeside(box)).toEqual({ wrapped: true, text: 'INR', hidden: 'true', boxIsNext: true })
      expect(box.value).toMatch(/^\d+\.\d\d$/)
    }
  })

  it('writes each hand-priced currency beside its own boxes, and saves what is typed without it', async () => {
    api.loadStoreCurrencies.mockResolvedValue([{ code: 'USD', mode: 'manual' }])
    await show(owner)
    const usd = screen.getByRole('textbox', { name: 'USD price of S' }) as HTMLInputElement
    expect(currencyBeside(usd)).toEqual({ wrapped: true, text: 'USD', hidden: 'true', boxIsNext: true })
    expect(currencyBeside(screen.getByRole('textbox', { name: 'Price of S' }) as HTMLInputElement).text).toBe('INR')
    fireEvent.change(usd, { target: { value: '12' } })
    fireEvent.change(field('Price of M'), { target: { value: '1499' } })
    fireEvent.click(saveButton())
    await settle()
    expect(sent().versions.map((v) => [v.choices, v.prices])).toEqual([
      [['S'], [{ currency: 'INR', amount: '129900' }, { currency: 'USD', amount: '1200' }]],
      [['M'], [{ currency: 'INR', amount: '149900' }]],
      [['L'], [{ currency: 'INR', amount: '169900' }]],
    ])
  })

  it('saves a version’s compare-at price and cost from its own row, and shows what it makes', async () => {
    await show(owner)
    expect(screen.queryByRole('group', { name: 'More for M' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More for M' }))
    expect(screen.getByRole('button', { name: 'More for M' }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.change(more('M').getByLabelText(words.price.compare), { target: { value: '1999' } })
    fireEvent.change(more('M').getByLabelText(new RegExp(words.price.cost)), { target: { value: '600' } })
    expect(more('M').getByText(/^You make .*per sale · 60% margin$/)).toBeTruthy()
    fireEvent.click(saveButton())
    await settle()
    const [s, m] = sent().versions
    expect(m).toMatchObject({ prices: [{ currency: 'INR', amount: '149900', compareAtAmount: '199900' }], cost: { currency: 'INR', amount: '60000' } })
    expect(s).toMatchObject({ prices: [{ currency: 'INR', amount: '129900' }] })
    expect(s?.cost).toBeUndefined()
  })

  it('blocks a save with a compare-at price at or below the price, opening that version’s row to say so', async () => {
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: 'More for S' }))
    fireEvent.change(more('S').getByLabelText(words.price.compare), { target: { value: '1000' } })
    fireEvent.click(screen.getByRole('button', { name: 'More for S' }))
    expect(screen.queryByRole('group', { name: 'More for S' })).toBeNull()
    fireEvent.click(saveButton())
    await settle()
    expect(api.saveProduct).not.toHaveBeenCalled()
    expect(more('S').getByText(words.price.compareLow)).toBeTruthy()
  })

  describe('the window that stops selling a version (#1453)', () => {
    const open = (name: string) => {
      fireEvent.click(screen.getByRole('button', { name: `Hide ${name}` }))
      return within(dialog())
    }

    it('asks “Stop selling {name}?”, with the line under it and each choice’s own line, and Hide first', async () => {
      await show(owner)
      const box = open('M')
      expect(box.getByRole('heading', { name: fill(words.versions.stopTitle, { name: 'M' }) })).toBeTruthy()
      expect(box.getByText(words.versions.stopLine)).toBeTruthy()
      expect((box.getByRole('radio', { name: new RegExp(words.versions.hideIt) }) as HTMLInputElement).checked).toBe(true)
      expect(box.getByText(words.versions.hideItSub)).toBeTruthy()
      expect(box.getByText(fill(words.versions.notMakeSub, { name: 'M' }))).toBeTruthy()
      const button = box.getByRole('button', { name: words.versions.hideConfirm }) as HTMLButtonElement
      expect(button.className).not.toContain('danger')
      expect(box.queryByRole('button', { name: words.apply })).toBeNull()
    })

    it('the button reads Remove once “We don’t make this” is picked', async () => {
      await show(owner)
      const box = open('M')
      fireEvent.click(box.getByRole('radio', { name: new RegExp(words.versions.notMake) }))
      expect(box.getByRole('button', { name: words.versions.notMakeConfirm })).toBeTruthy()
      expect(box.queryByRole('button', { name: words.versions.hideConfirm })).toBeNull()
      fireEvent.click(box.getByRole('radio', { name: new RegExp(words.versions.hideIt) }))
      expect(box.getByRole('button', { name: words.versions.hideConfirm })).toBeTruthy()
    })

    it('hides the version on Hide, marks it “We don’t make this” on Remove, and changes nothing on Cancel or before Save', async () => {
      await show(owner)
      fireEvent.click(open('S').getByRole('button', { name: words.cancel }))
      expect(screen.queryByText(words.versions.notMade)).toBeNull()
      expect((saveButton() as HTMLButtonElement).disabled).toBe(true)
      fireEvent.click(open('S').getByRole('button', { name: words.versions.hideConfirm }))
      expect(screen.getByRole('button', { name: 'Show S' })).toBeTruthy()
      expect(screen.queryByText(words.versions.notMade)).toBeNull()
      fireEvent.click(open('M').getByRole('radio', { name: new RegExp(words.versions.notMake) }))
      fireEvent.click(within(dialog()).getByRole('button', { name: words.versions.notMakeConfirm }))
      expect(screen.getAllByText(words.versions.notMade)).toHaveLength(1)
      expect(api.saveProduct).not.toHaveBeenCalled()
    })

    it('still opens the “hide the whole product” window for the last visible version', async () => {
      await show(owner)
      fireEvent.click(open('S').getByRole('button', { name: words.versions.hideConfirm }))
      fireEvent.click(open('M').getByRole('button', { name: words.versions.hideConfirm }))
      const box = open('L')
      expect(box.getByText(words.versions.allHidden)).toBeTruthy()
      expect(box.queryByRole('radio')).toBeNull()
      expect(box.getByRole('button', { name: words.apply })).toBeTruthy()
    })
  })

  it('sets the values filled in on every version made, keeping the rest as they are', async () => {
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: 'Hide L' }))
    fireEvent.click(within(dialog()).getByRole('radio', { name: new RegExp(words.versions.notMake) }))
    fireEvent.click(within(dialog()).getByRole('button', { name: words.versions.notMakeConfirm }))
    expect((screen.getByRole('button', { name: 'Add a photo for L' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: words.versions.setPrice }))
    const box = within(dialog())
    expect(box.getByRole('heading', { name: words.versions.setPriceTitle })).toBeTruthy()
    const apply = box.getByRole('button', { name: messages.editor.apply }) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    expect(box.getByText(words.versions.setNone)).toBeTruthy()
    fireEvent.change(box.getByLabelText(words.price.price), { target: { value: 'lots' } })
    expect(apply.disabled).toBe(true)
    expect(box.getByText(words.versions.setFix)).toBeTruthy()
    fireEvent.change(box.getByLabelText(words.price.price), { target: { value: '' } })
    fireEvent.change(box.getByLabelText(words.price.compare), { target: { value: '2500' } })
    fireEvent.change(box.getByLabelText(new RegExp(words.price.cost)), { target: { value: '500' } })
    fireEvent.click(apply)
    expect(field('Price of S').value).toBe('1299.00')
    fireEvent.click(saveButton())
    await settle()
    expect(sent().versions.map((v) => [v.choices, v.prices, v.cost])).toEqual([
      [['S'], [{ currency: 'INR', amount: '129900', compareAtAmount: '250000' }], { currency: 'INR', amount: '50000' }],
      [['M'], [{ currency: 'INR', amount: '149900', compareAtAmount: '250000' }], { currency: 'INR', amount: '50000' }],
    ])
  })

  describe('and its Stock, set for every version at once (#1182)', () => {
    const openBox = () => {
      fireEvent.click(screen.getByRole('button', { name: words.versions.setPrice }))
      return within(dialog())
    }
    const applyBox = (box: ReturnType<typeof openBox>) => box.getByRole('button', { name: words.apply }) as HTMLButtonElement
    const notMake = (name: string) => {
      fireEvent.click(screen.getByRole('button', { name: `Hide ${name}` }))
      fireEvent.click(within(dialog()).getByRole('radio', { name: new RegExp(words.versions.notMake) }))
      fireEvent.click(within(dialog()).getByRole('button', { name: words.versions.notMakeConfirm }))
    }

    it('lists Stock after what it costs you, and shows the title and the hint once each', async () => {
      await show(owner)
      const box = openBox()
      expect(box.getAllByText(words.versions.setPriceTitle).length).toBe(1)
      expect(box.getAllByText(words.versions.setKeeps).length).toBe(1)
      const cost = box.getByLabelText(new RegExp(words.price.cost))
      expect(cost.compareDocumentPosition(box.getByLabelText(words.stock.title)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(box.getByText(words.versions.setNone)).toBeTruthy()
    })

    it('sets every version’s stock to the count typed, leaving prices alone, and saves it', async () => {
      await show(owner)
      const box = openBox()
      fireEvent.change(box.getByLabelText(words.stock.title), { target: { value: '10' } })
      expect(applyBox(box).disabled).toBe(false)
      fireEvent.click(applyBox(box))
      for (const name of ['S', 'M', 'L']) expect(field(`Stock of ${name}`).value).toBe('10')
      expect(field('Price of S').value).toBe('1299.00')
      fireEvent.click(saveButton())
      await settle()
      expect(sent().versions.map((v) => v.prices)).toEqual([[{ currency: 'INR', amount: '129900' }], [{ currency: 'INR', amount: '149900' }], [{ currency: 'INR', amount: '169900' }]])
      expect(stockApi.setStock).toHaveBeenCalledWith([
        { versionId: 'ver-s', warehouseId: 'w1', quantity: 10 },
        { versionId: 'ver-m', warehouseId: 'w1', quantity: 10 },
        { versionId: 'ver-l', warehouseId: 'w1', quantity: 10 },
      ])
    })

    it('keeps each version’s own count when Stock is left empty', async () => {
      await show(owner)
      fireEvent.change(field('Stock of M'), { target: { value: '7' } })
      const box = openBox()
      fireEvent.change(box.getByLabelText(words.price.price), { target: { value: '2000' } })
      fireEvent.click(applyBox(box))
      expect(field('Stock of M').value).toBe('7')
      expect(field('Stock of S').value).toBe('')
      expect(field('Price of S').value).toBe('2000')
    })

    it('leaves a version we don’t make with its own count', async () => {
      await show(owner)
      fireEvent.change(field('Stock of L'), { target: { value: '4' } })
      notMake('L')
      const box = openBox()
      fireEvent.change(box.getByLabelText(words.stock.title), { target: { value: '10' } })
      fireEvent.click(applyBox(box))
      expect(field('Stock of S').value).toBe('10')
      expect(field('Stock of L').value).toBe('4')
    })

    it.each(['-1', '2.5', 'abc'])('blocks Apply for a count of %s, with the row’s own message', async (bad) => {
      await show(owner)
      const box = openBox()
      fireEvent.change(box.getByLabelText(words.stock.title), { target: { value: bad } })
      expect(applyBox(box).disabled).toBe(true)
      expect(box.getByText(words.stock.invalid)).toBeTruthy()
      expect(box.getByText(words.versions.setFix)).toBeTruthy()
      fireEvent.change(box.getByLabelText(words.stock.title), { target: { value: '0' } })
      expect(applyBox(box).disabled).toBe(false)
    })

    it('has no Stock field for a product with no Stock column', async () => {
      api.loadProduct.mockResolvedValue(sizes({ productType: 'digital' }))
      kindApi.loadProductKind.mockResolvedValue(kindView({}))
      await show(owner)
      expect(screen.queryByLabelText('Stock of S')).toBeNull()
      expect(openBox().queryByLabelText(words.stock.title)).toBeNull()
    })

    it('has no Stock field without a stock location, or for someone who can’t change stock', async () => {
      stockApi.loadWarehouses.mockResolvedValue([])
      await show(owner)
      expect(openBox().queryByLabelText(words.stock.title)).toBeNull()
      cleanup()
      stockApi.loadWarehouses.mockResolvedValue([home])
      await show({ ...owner, permissions: ['catalog.read', 'catalog.write', 'stock.read'] })
      expect(openBox().queryByLabelText(words.stock.title)).toBeNull()
    })
  })

  describe('and its photo, picked from the product’s own (#1460)', () => {
    const photo = (id: string, alt: string | null = null) => ({ id: `ph-${id}`, assetId: id, url: `/api/assets/${id}`, alt, versionId: null })
    const withPhotos = (versionPhotos: Record<string, string | null> = {}) =>
      sizes({ photos: [photo('a1', 'Blue – front'), photo('a2')], versions: [version('ver-s', ['S'], '129900'), version('ver-m', ['M'], '149900'), version('ver-l', ['L'], '169900')].map((v) => ({ ...v, photoAssetId: versionPhotos[v.id] ?? null })) })
    const openFor = (name: string) => {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`photo (for|of) ${name}$`) }))
      return within(dialog())
    }
    const useButton = () => within(dialog()).getByRole('button', { name: words.versions.photoUse }) as HTMLButtonElement
    const chooseFile = async (name: string) => {
      fireEvent.change(dialog().querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['x'], name, { type: 'image/png' })] } })
      await settle()
    }

    it('opens the product’s photos as tiles with how many versions use each, and Use this photo waits for a pick', async () => {
      api.loadProduct.mockResolvedValue(withPhotos({ 'ver-s': 'a1', 'ver-l': 'a1' }))
      await show(owner)
      const box = openFor('M')
      expect(box.getByRole('heading', { name: 'Photo for M' })).toBeTruthy()
      expect(box.getByText('Product photos · 2')).toBeTruthy()
      expect(box.getByRole('button', { name: /Blue – front.*Used by 2 versions/ })).toBeTruthy()
      expect(box.getByRole('button', { name: /Photo 2.*Not used yet/ })).toBeTruthy()
      expect(box.getByRole('button', { name: new RegExp(words.versions.photoUploadNew) })).toBeTruthy()
      expect(box.queryByRole('button', { name: words.versions.photoMain })).toBeNull()
      expect(box.queryByRole('radiogroup')).toBeNull()
      expect(box.getByRole('button', { name: /Blue – front/ }).getAttribute('aria-pressed')).toBe('false')
      expect(box.getByRole('button', { name: new RegExp(words.versions.photoUploadNew) }).hasAttribute('aria-pressed')).toBe(false)
      expect(useButton().disabled).toBe(true)
      fireEvent.click(box.getByRole('button', { name: /Blue – front/ }))
      expect(useButton().disabled).toBe(false)
    })

    it('shows a version’s own photo picked, and “Used by 1 version” for it', async () => {
      api.loadProduct.mockResolvedValue(withPhotos({ 'ver-m': 'a2' }))
      await show(owner)
      const box = openFor('M')
      expect(box.getByRole('button', { name: /Photo 2.*Used by 1 version$/ }).getAttribute('aria-pressed')).toBe('true')
      expect(useButton().disabled).toBe(false)
    })

    it('gives the same photo to several versions, and saves each version’s photo with the product’s photos', async () => {
      api.loadProduct.mockResolvedValue(withPhotos())
      await show(owner)
      for (const name of ['S', 'M']) {
        openFor(name)
        fireEvent.click(within(dialog()).getByRole('button', { name: /Blue – front/ }))
        fireEvent.click(useButton())
      }
      expect(screen.getByRole('button', { name: 'Change the photo of S' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Add a photo for L' })).toBeTruthy()
      fireEvent.click(saveButton())
      await settle()
      expect(sent().photos).toEqual([{ assetId: 'a1', alt: 'Blue – front' }, { assetId: 'a2' }])
      expect(sent().versions.map((v) => v.photoAssetId)).toEqual(['a1', 'a1', null])
    })

    it('changes nothing on Cancel', async () => {
      api.loadProduct.mockResolvedValue(withPhotos({ 'ver-m': 'a2' }))
      await show(owner)
      openFor('M')
      fireEvent.click(within(dialog()).getByRole('button', { name: /Blue – front/ }))
      fireEvent.click(within(dialog()).getByRole('button', { name: words.cancel }))
      expect(document.querySelector('dialog')).toBeNull()
      expect((saveButton() as HTMLButtonElement).disabled).toBe(true)
    })

    it('takes a version back to the main photo with “Use the main photo”', async () => {
      api.loadProduct.mockResolvedValue(withPhotos({ 'ver-m': 'a2' }))
      await show(owner)
      fireEvent.click(openFor('M').getByRole('button', { name: words.versions.photoMain }))
      expect(screen.getByRole('button', { name: 'Add a photo for M' })).toBeTruthy()
      fireEvent.click(saveButton())
      await settle()
      expect(sent().versions.map((v) => v.photoAssetId)).toEqual([null, null, null])
      expect(sent().photos).toEqual([{ assetId: 'a1', alt: 'Blue – front' }, { assetId: 'a2' }])
    })

    it('uploads a new photo into Photos too and picks it', async () => {
      api.uploadPhoto.mockResolvedValueOnce({ ok: true, assetId: 'a9' })
      api.loadProduct.mockResolvedValue(withPhotos())
      await show(owner)
      const box = openFor('M')
      await chooseFile('new.png')
      expect(box.getByRole('button', { name: /Photo 3.*Not used yet/ }).getAttribute('aria-pressed')).toBe('true')
      fireEvent.click(useButton())
      expect(screen.getByText('3 of 20 photos')).toBeTruthy()
      fireEvent.click(saveButton())
      await settle()
      expect(sent().photos).toEqual([{ assetId: 'a1', alt: 'Blue – front' }, { assetId: 'a2' }, { assetId: 'a9' }])
      expect(sent().versions.map((v) => v.photoAssetId)).toEqual([null, 'a9', null])
    })

    it('says why an upload didn’t work, and keeps the window and the photos as they were', async () => {
      api.uploadPhoto.mockResolvedValue({ ok: false, code: 'TOO_LARGE' })
      api.loadProduct.mockResolvedValue(withPhotos())
      await show(owner)
      openFor('S')
      await chooseFile('huge.png')
      expect(within(dialog()).getByText(words.photos.refused.TOO_LARGE)).toBeTruthy()
      expect(within(dialog()).getByText('Product photos · 2')).toBeTruthy()
    })

    it('refuses a new photo past the product’s 20', async () => {
      api.loadProduct.mockResolvedValue(sizes({ photos: Array.from({ length: 20 }, (_, n) => photo(`b${n}`)) }))
      await show(owner)
      openFor('S')
      await chooseFile('one-more.png')
      expect(api.uploadPhoto).not.toHaveBeenCalled()
      expect(within(dialog()).getByText(words.photos.limit)).toBeTruthy()
    })

    it('asks before taking a photo out of Photos that versions show, and sends them back to the main photo', async () => {
      api.loadProduct.mockResolvedValue(withPhotos({ 'ver-s': 'a1', 'ver-m': 'a1' }))
      await show(owner)
      fireEvent.click(screen.getByRole('button', { name: 'Remove Blue – front' }))
      expect(within(dialog()).getByText('2 versions show this photo. They go back to the main photo.')).toBeTruthy()
      fireEvent.click(within(dialog()).getByRole('button', { name: words.photos.dismiss }))
      expect(screen.getByRole('button', { name: 'Add a photo for S' })).toBeTruthy()
      fireEvent.click(saveButton())
      await settle()
      expect(sent().photos).toEqual([{ assetId: 'a2' }])
      expect(sent().versions.map((v) => v.photoAssetId)).toEqual([null, null, null])
    })

    it('removes a photo no version shows without asking', async () => {
      api.loadProduct.mockResolvedValue(withPhotos({ 'ver-s': 'a1' }))
      await show(owner)
      fireEvent.click(screen.getByRole('button', { name: 'Remove 2' }))
      expect(document.querySelector('dialog[open]')).toBeNull()
      expect(screen.getByText('1 of 20 photos')).toBeTruthy()
    })
  })

  it('shows staff a version’s photo, compare-at price and cost with no way to change them', async () => {
    await show(staff)
    expect((screen.getByRole('button', { name: 'Add a photo for S' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: words.versions.setPrice })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More for S' }))
    expect((more('S').getByLabelText(words.price.compare) as HTMLInputElement).readOnly).toBe(true)
    expect((more('S').getByLabelText(new RegExp(words.price.cost)) as HTMLInputElement).readOnly).toBe(true)
  })
})

describe('Save, only when there is something to save (#1223)', () => {
  const top = (name: string = words.save) => screen.getAllByRole('button', { name })[0] as HTMLButtonElement

  it('is greyed out on opening a product with no changes, turns on with a change and off again when it is undone', async () => {
    await show(owner)
    expect(top().disabled).toBe(true)
    fireEvent.change(field(words.name.label), { target: { value: 'Renamed' } })
    expect(top().disabled).toBe(false)
    fireEvent.change(field(words.name.label), { target: { value: 'Block-print Cushion' } })
    expect(top().disabled).toBe(true)
  })

  it('says how many things need fixing when Save is chosen with a problem, and scrolls to the first (#1327)', async () => {
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    await show(owner, '/products/new')
    fireEvent.change(field(words.name.label), { target: { value: 'Kurta' } })
    fireEvent.click(screen.getAllByRole('button', { name: words.saveNew })[0] as HTMLElement)
    await settle()
    expect(screen.getByText('1 thing to fix before saving')).toBeTruthy()
    expect(scrolled.mock.contexts.at(-1)).toBe(field(words.price.price))
    expect(api.saveProduct).not.toHaveBeenCalled()
    cleanup()
    scrolled.mockClear()
    await show(owner, '/products/new')
    fireEvent.change(field(words.name.label), { target: { value: '  ' } })
    fireEvent.click(screen.getAllByRole('button', { name: words.saveNew })[0] as HTMLElement)
    await settle()
    expect(screen.getByText('2 things to fix before saving')).toBeTruthy()
    expect(scrolled.mock.contexts.at(-1)).toBe(field(words.name.label))
  })

  it('shows a spinner beside Saving… on both Save buttons while it saves, and none otherwise (#1327)', async () => {
    const answer = deferred<{ id: string; revision: number; approval: null }>()
    api.saveProduct.mockReturnValue(answer.promise)
    await show(owner)
    fireEvent.change(field(words.name.label), { target: { value: 'Renamed' } })
    expect(document.querySelector('.df-editor-spinner')).toBeNull()
    api.loadProduct.mockResolvedValue(cushion({ name: 'Renamed', revision: 3 }))
    fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
    await settle()
    const saving = screen.getAllByRole('button', { name: words.saving })
    expect(saving).toHaveLength(2)
    for (const button of saving) expect(button.querySelector('.df-editor-spinner[aria-hidden="true"]')).toBeTruthy()
    answer.resolve({ id: 'p1', revision: 3, approval: null })
    await settle()
    expect(document.querySelector('.df-editor-spinner')).toBeNull()
  })

  it('is greyed out and reads Saving… while it saves, then stays greyed out with the toast until the next change', async () => {
    const answer = deferred<{ id: string; revision: number; approval: null }>()
    api.saveProduct.mockReturnValue(answer.promise)
    await show(owner)
    fireEvent.change(field(words.name.label), { target: { value: 'Renamed' } })
    api.loadProduct.mockResolvedValue(cushion({ name: 'Renamed', revision: 3 }))
    fireEvent.click(top())
    await settle()
    expect(top(words.saving).disabled).toBe(true)
    answer.resolve({ id: 'p1', revision: 3, approval: null })
    await settle()
    expect(screen.getByText(words.saved)).toBeTruthy()
    expect(top().disabled).toBe(true)
    fireEvent.change(field(words.name.label), { target: { value: 'Renamed again' } })
    expect(top().disabled).toBe(false)
  })

  it('stays on after a refused save, so it can be tried again', async () => {
    api.saveProduct.mockRejectedValue(new ApiError('NOT_CONNECTED', 'offline'))
    await show(owner)
    fireEvent.change(field(words.name.label), { target: { value: 'Renamed' } })
    fireEvent.click(top())
    await settle()
    expect(api.saveProduct).toHaveBeenCalledTimes(1)
    expect(top().disabled).toBe(false)
  })

  it('stays on when only the stock fails after the product saved, and when only the collections do', async () => {
    api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: null })
    stockApi.setStock.mockRejectedValue(new ApiError('NOT_CONNECTED', 'offline'))
    await show(owner)
    fireEvent.change(field('Stock at Jaipur studio'), { target: { value: '30' } })
    fireEvent.click(top())
    await settle()
    expect(top().disabled).toBe(false)
    cleanup()
    api.setProductCollections.mockRejectedValue(new ApiError('NOT_CONNECTED', 'offline'))
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(words.sections.coll) }))
    fireEvent.click(screen.getByRole('button', { name: 'Gifts' }))
    fireEvent.click(top())
    await settle()
    expect(screen.getByText(words.saveCollectionsFailed)).toBeTruthy()
    expect(top().disabled).toBe(false)
  })

  it('turns on for a stock count, a collection or a gift card’s details alone', async () => {
    await show(owner)
    expect(top().disabled).toBe(true)
    fireEvent.change(field('Stock at Jaipur studio'), { target: { value: '30' } })
    expect(top().disabled).toBe(false)
    cleanup()
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(words.sections.coll) }))
    fireEvent.click(screen.getByRole('button', { name: 'Gifts' }))
    expect(top().disabled).toBe(false)
    cleanup()
    api.loadProduct.mockResolvedValue(giftCard())
    kindApi.loadProductKind.mockResolvedValue(kindView({ productType: 'gift_card', giftCard: { expiryMonths: 60, shortestMonths: 60 } }))
    kindApi.loadGiftCards.mockResolvedValue({ rows: [], next: null })
    await show(owner)
    expect(top().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(kinds.giftCard.expiry), { target: { value: 'never' } })
    expect(top().disabled).toBe(false)
  })

  it('is greyed out on Add product until something is typed, and again once the product is saved', async () => {
    api.saveProduct.mockResolvedValue({ id: 'p9', revision: 1, approval: null })
    api.loadProduct.mockResolvedValue(cushion({ id: 'p9', name: 'Kurta' }))
    const router = await show(owner, '/products/new')
    expect(top(words.saveNew).disabled).toBe(true)
    fireEvent.change(field(words.name.label), { target: { value: 'Kurta' } })
    fireEvent.change(field(words.price.price), { target: { value: '1299' } })
    expect(top(words.saveNew).disabled).toBe(false)
    fireEvent.click(top(words.saveNew))
    await settle()
    await settle()
    expect(router.state.location.pathname).toBe('/products/p9')
    expect(top().disabled).toBe(true)
  })

  it('keeps a sent-back supplier product’s Submit greyed out until it is edited, as it is for any product with nothing to send', async () => {
    api.loadProduct.mockResolvedValue(cushion({ supplier: { id: 'v1', name: 'Northwind Textiles' }, approval: 'sent_back', sentBackReason: 'Sharper photo please', readiness: null }))
    await show(supplier)
    expect(top(words.submit).disabled).toBe(true)
    fireEvent.change(field(words.name.label), { target: { value: 'Cushion' } })
    expect(top(words.submit).disabled).toBe(false)
  })

  it('is greyed out for a Stock-only seat until a count is typed', async () => {
    await show({ ...stockOnly, permissions: [...stockOnly.permissions] })
    expect(top(words.stock.saveStock).disabled).toBe(true)
    fireEvent.change(field('Stock at Jaipur studio'), { target: { value: '5' } })
    expect(top(words.stock.saveStock).disabled).toBe(false)
  })
})

describe('the description (#1216)', () => {
  const content = () => document.querySelector<HTMLElement>('.ProseMirror') as HTMLElement
  const editorOf = () => (content() as HTMLElement & { editor: import('@tiptap/react').Editor }).editor
  const top = (name: string = words.save) => screen.getAllByRole('button', { name })[0] as HTMLButtonElement

  it('is edited with the toolbar and saved as the formatting it was given', async () => {
    api.loadProduct.mockResolvedValue(cushion({ description: '<p>Soft cotton</p>' }))
    api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: null })
    await show(owner)
    expect(screen.getByRole('textbox', { name: /^Description/ })).toBe(content())
    act(() => {
      editorOf().commands.selectAll()
    })
    fireEvent.click(screen.getByRole('button', { name: words.description.tools.bold.label }))
    fireEvent.click(top())
    await settle()
    expect(api.saveProduct.mock.calls[0]?.[2]).toMatchObject({ description: '<p><strong>Soft cotton</strong></p>' })
  })

  it('is not a change to open a description with formatting, or one typed as plain text', async () => {
    api.loadProduct.mockResolvedValue(cushion({ description: '<p>Soft</p><ul><li>One</li><li>Two</li></ul>' }))
    await show(owner)
    expect(top().disabled).toBe(true)
    cleanup()
    api.loadProduct.mockResolvedValue(cushion({ description: 'Soft cotton.\nHand wash.\n\nMade in India' }))
    await show(owner)
    expect([...content().querySelectorAll('p')].length).toBe(2)
    expect(top().disabled).toBe(true)
  })

  it('shows the formatting and can’t be changed by a seat that can’t edit', async () => {
    api.loadProduct.mockResolvedValue(cushion({ description: '<p>Soft <strong>cotton</strong></p><ul><li>One</li></ul>' }))
    await show(staff)
    expect(content().getAttribute('contenteditable')).toBe('false')
    expect(content().querySelector('strong')?.textContent).toBe('cotton')
    expect(content().querySelector('li')?.textContent).toBe('One')
    expect((screen.getByRole('button', { name: words.description.tools.bold.label }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the search listing’s placeholder as the description’s words, without its tags', async () => {
    api.loadProduct.mockResolvedValue(cushion({ description: '<p>Soft <strong>cotton</strong> &amp; linen</p><ul><li>Hand wash</li></ul>' }))
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: (n) => n.startsWith(words.sections.seo) }))
    expect((screen.getByLabelText(words.sections.seoDescription) as HTMLTextAreaElement).placeholder).toBe('Soft cotton & linen Hand wash')
  })

  describe('the search listing’s line', () => {
    const line = () => screen.getByRole('button', { name: (n) => n.startsWith(words.sections.seo) }).textContent ?? ''
    const own = 'Organic Cotton Block-print Cushion | Home'

    it.each([
      ['both of its own', { seoTitle: own, seoDescription: 'Soft and warm.' }, `${own} — your own title and description`],
      ['neither', { seoTitle: null, seoDescription: null }, 'Block-print Cushion — uses the product’s name and description'],
      ['only the title', { seoTitle: own, seoDescription: null }, `${own} — your own title, description from the product`],
      ['only the description', { seoTitle: null, seoDescription: 'Soft and warm.' }, 'Block-print Cushion — title from the product name, your own description'],
      ['spaces alone, which the server saves as empty', { seoTitle: '   ', seoDescription: '  ' }, 'Block-print Cushion — uses the product’s name and description'],
    ])('says where the listing comes from with %s', async (_, saved, expected) => {
      api.loadProduct.mockResolvedValue(cushion(saved))
      await show(owner)
      expect(line()).toContain(expected)
      expect(line()).not.toContain('from the name and description')
    })

    it('follows the two boxes as they are filled and emptied, and says under them that empty ones use the product’s', async () => {
      api.loadProduct.mockResolvedValue(cushion())
      await show(owner)
      fireEvent.click(screen.getByRole('button', { name: (n) => n.startsWith(words.sections.seo) }))
      expect(screen.getByText(words.sections.seoHint).textContent).toBe('Leave these empty to use the product’s name and description.')
      fireEvent.change(screen.getByLabelText(words.sections.seoTitle), { target: { value: own } })
      expect(line()).toContain(`${own} — your own title, description from the product`)
      fireEvent.change(screen.getByLabelText(words.sections.seoDescription), { target: { value: 'Soft and warm.' } })
      expect(line()).toContain(`${own} — your own title and description`)
      fireEvent.change(screen.getByLabelText(words.sections.seoTitle), { target: { value: '' } })
      expect(line()).toContain('Block-print Cushion — title from the product name, your own description')
      fireEvent.change(screen.getByLabelText(words.sections.seoDescription), { target: { value: '' } })
      expect(line()).toContain('Block-print Cushion — uses the product’s name and description')
    })

    it('still sends the boxes’ own words, trimmed, and nothing for an empty one', async () => {
      api.loadProduct.mockResolvedValue(cushion({ seoTitle: own, seoDescription: 'Soft and warm.' }))
      api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: null })
      await show(owner)
      fireEvent.click(screen.getByRole('button', { name: (n) => n.startsWith(words.sections.seo) }))
      fireEvent.change(screen.getByLabelText(words.sections.seoTitle), { target: { value: '  A new title  ' } })
      fireEvent.change(screen.getByLabelText(words.sections.seoDescription), { target: { value: '' } })
      fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
      await settle()
      expect(api.saveProduct.mock.calls[0]?.[2]).toMatchObject({ seoTitle: 'A new title', seoDescription: '' })
    })
  })

  it('is the same editor for a translation, and saves its formatting', async () => {
    api.loadProductBasics.mockResolvedValue({ pricingCurrency: 'INR', unitSystem: 'metric', features: [], badges: [], mainLanguage: 'en-IN', translationLanguages: ['hi-IN'] })
    const rows = [{ entity: 'product', entityId: 'p1', field: 'description', main: '<p>Soft <strong>cotton</strong></p>', text: null, status: 'missing' }]
    translationApi.loadProductTranslation.mockResolvedValue(rows)
    translationApi.saveProductTranslation.mockResolvedValue([{ ...rows[0], text: '<p>Mulayam</p>', status: 'translated' }])
    await show(owner)
    fireEvent.click(screen.getByRole('tab', { name: /Hindi/ }))
    await settle()
    expect(screen.getByText(/Soft cotton/)).toBeTruthy()
    act(() => {
      editorOf().chain().focus('end').insertContent('Mulayam').run()
    })
    fireEvent.click(screen.getByRole('button', { name: words.translate.save }))
    await settle()
    expect(translationApi.saveProductTranslation).toHaveBeenCalledWith('p1', 'hi-IN', { description: '<p>Mulayam</p>' })
  })
})

// A product's one video (#1401): Add more takes an MP4 or WebM of at most 30 seconds and 4 MB, counted apart from the 20 photos.
describe('a product video', () => {
  const withVideo = (extra: Partial<{ enabled: boolean; inPlan: boolean }> = {}) =>
    api.loadProductBasics.mockResolvedValue({ pricingCurrency: 'INR', unitSystem: 'metric', features: ['specs', 'highlights', 'faqs', 'badges', 'video'].map((key) => ({ key, enabled: true, inPlan: true, ...(key === 'video' ? extra : {}) })), badges: [] })
  const film = (name = 'clip.mp4', type = 'video/mp4', bytes = 3 * 1024 * 1024) => new File([new Uint8Array(bytes)], name, { type })
  const choose = (...files: File[]) => fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files } })
  const meter = () => document.querySelector('.df-editor-meter')?.textContent
  const tile = () => document.querySelector('.df-editor-photo--video')
  const photosOf = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `ph${i}`, assetId: `a${i}`, url: `/api/assets/a${i}`, alt: null, versionId: null }))
  const saved = async () => {
    fireEvent.click(screen.getAllByRole('button', { name: words.save })[0] as HTMLElement)
    await settle()
    return api.saveProduct.mock.calls[0]?.[2] as { photos: unknown[]; video?: unknown }
  }

  beforeEach(() => {
    withVideo()
    lengthApi.videoSeconds.mockResolvedValue(20)
    api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: null })
    vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }))
  })

  it('takes a short MP4 without "All Files": the picker lists MP4 and WebM, and the video is set as the product’s video, not a photo', async () => {
    api.uploadVideo.mockResolvedValue({ ok: true, assetId: 'v1' })
    await show(owner)
    expect((document.querySelector('input[type="file"]') as HTMLInputElement).accept).toContain('video/mp4,video/webm')
    expect(screen.getByText(words.photos.videoHint)).toBeTruthy()
    choose(film())
    await settle()
    expect(api.uploadVideo).toHaveBeenCalledTimes(1)
    expect(api.uploadPhoto).not.toHaveBeenCalled()
    expect(tile()?.textContent).toContain('▶')
    expect(meter()).toBe('0 of 20 photos · 1 of 1 video')
    expect(await saved()).toMatchObject({ photos: [], video: { assetId: 'v1' } })
  })

  it('takes a WebM the same way', async () => {
    api.uploadVideo.mockResolvedValue({ ok: true, assetId: 'v2' })
    await show(owner)
    choose(film('clip.webm', 'video/webm'))
    await settle()
    expect(tile()).not.toBeNull()
    expect(await saved()).toMatchObject({ video: { assetId: 'v2' } })
  })

  it('refuses a video longer than 30 seconds, naming the limit, without uploading it', async () => {
    lengthApi.videoSeconds.mockResolvedValue(31)
    await show(owner)
    choose(film())
    await settle()
    expect(screen.getByText('That video is longer than 30 seconds.')).toBeTruthy()
    expect(api.uploadVideo).not.toHaveBeenCalled()
    expect(tile()).toBeNull()
    expect(meter()).toBe('0 of 20 photos · 0 of 1 video')
  })

  it('refuses a video bigger than 4 MB, naming the limit, without uploading it or reading its length; 4 MB itself is allowed', async () => {
    await show(owner)
    choose(film('big.mp4', 'video/mp4', 4 * 1024 * 1024 + 1))
    await settle()
    expect(screen.getByText('That video is bigger than 4 MB.')).toBeTruthy()
    expect(api.uploadVideo).not.toHaveBeenCalled()
    expect(lengthApi.videoSeconds).not.toHaveBeenCalled()
    api.uploadVideo.mockResolvedValue({ ok: true, assetId: 'v3' })
    choose(film('edge.mp4', 'video/mp4', 4 * 1024 * 1024))
    await settle()
    expect(api.uploadVideo).toHaveBeenCalledTimes(1)
  })

  it('says what the server refused a video for, and lets the person try again', async () => {
    api.uploadVideo.mockResolvedValueOnce({ ok: false, code: 'TOO_LONG' }).mockResolvedValueOnce({ ok: true, assetId: 'v4' })
    await show(owner)
    choose(film())
    await settle()
    expect(screen.getByText(words.photos.videoRefused.TOO_LONG)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.photos.retry }))
    await settle()
    expect(tile()).not.toBeNull()
    expect(api.uploadVideo).toHaveBeenCalledTimes(2)
  })

  it('says the plan or the Settings switch refuses a video, not "check your connection"', async () => {
    api.uploadVideo.mockResolvedValueOnce({ ok: false, code: 'PLAN_LIMIT' }).mockResolvedValueOnce({ ok: false, code: 'FEATURE_UNAVAILABLE' })
    await show(owner)
    choose(film())
    await settle()
    expect(screen.getByText(words.photos.videoRefused.PLAN_LIMIT)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.photos.retry }))
    await settle()
    expect(screen.getByText(words.photos.videoRefused.FEATURE_UNAVAILABLE)).toBeTruthy()
    expect(screen.queryByText(words.photos.videoRefused.NOT_CONNECTED)).toBeNull()
  })

  it('holds one video: a second, chosen with the first or after it, is refused with the card’s words', async () => {
    api.uploadVideo.mockResolvedValue({ ok: true, assetId: 'v1' })
    await show(owner)
    choose(film('a.mp4'), film('b.mp4'))
    await settle()
    expect(api.uploadVideo).toHaveBeenCalledTimes(1)
    expect(screen.getByText('A product can have one video. Remove the current one first.')).toBeTruthy()
    choose(film('c.mp4'))
    await settle()
    expect(api.uploadVideo).toHaveBeenCalledTimes(1)
    expect(screen.getAllByText(words.photos.videoSecond)).toHaveLength(2)
  })

  it('counts the video apart from the photos: 9 photos and a video read "9 of 20 photos · 1 of 1 video", and 20 photos still leave room for the video', async () => {
    api.loadProduct.mockResolvedValue(cushion({ photos: photosOf(9), video: { assetId: 'v1', uploaded: true, url: '/api/assets/v1' } }))
    await show(owner)
    expect(meter()).toBe('9 of 20 photos · 1 of 1 video')
    cleanup()
    api.loadProduct.mockResolvedValue(cushion({ photos: photosOf(20) }))
    await show(owner)
    expect(meter()).toBe('20 of 20 photos · 0 of 1 video')
    expect(screen.getByRole('button', { name: words.photos.addMore })).toBeTruthy()
    api.uploadVideo.mockResolvedValue({ ok: true, assetId: 'v5' })
    choose(film())
    await settle()
    expect(meter()).toBe('20 of 20 photos · 1 of 1 video')
    expect(screen.queryByRole('button', { name: words.photos.addMore })).toBeNull()
  })

  it('never makes the video the main photo: it has Remove and no star, and the first photo stays the main one', async () => {
    api.loadProduct.mockResolvedValue(cushion({ photos: photosOf(2), video: { assetId: 'v1', uploaded: true, url: '/api/assets/v1' } }))
    await show(owner)
    const buttons = within(tile() as HTMLElement).getAllByRole('button')
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([words.photos.removeVideo])
    expect(screen.getAllByRole('button', { name: words.photos.makeMain })).toHaveLength(1)
    expect(screen.getByText(words.photos.main)).toBeTruthy()
    fireEvent.click(buttons[0] as HTMLElement)
    expect(tile()).toBeNull()
    expect(await saved()).toMatchObject({ video: null })
  })

  it('shows a video link set elsewhere, keeps it when nothing about it changes, and replaces it with an uploaded video', async () => {
    api.loadProduct.mockResolvedValue(cushion({ video: { assetId: null, uploaded: false, url: 'https://www.youtube.com/watch?v=x' } }))
    api.uploadVideo.mockResolvedValue({ ok: true, assetId: 'v6' })
    await show(owner)
    expect(tile()?.textContent).toContain('https://www.youtube.com/watch?v=x')
    expect(meter()).toBe('0 of 20 photos · 1 of 1 video')
    fireEvent.change(field(words.name.label), { target: { value: 'Cushion' } })
    expect((await saved()).video).toEqual({ url: 'https://www.youtube.com/watch?v=x' })
    api.saveProduct.mockClear()
    choose(film())
    await settle()
    expect(screen.queryByText(words.photos.videoSecond)).toBeNull()
    expect(tile()?.textContent).not.toContain('youtube')
    expect((await saved()).video).toEqual({ assetId: 'v6' })
  })

  it('writes nothing about a video for a product that never had one', async () => {
    await show(owner)
    fireEvent.change(field(words.name.label), { target: { value: 'Cushion' } })
    expect('video' in (await saved())).toBe(false)
  })

  it('offers no video when the plan lacks it or Settings › Catalogue has it off, only photos', async () => {
    withVideo({ inPlan: false })
    await show(owner)
    expect((document.querySelector('input[type="file"]') as HTMLInputElement).accept).not.toContain('video')
    expect(screen.queryByText(words.photos.videoHint)).toBeNull()
    expect(meter()).toBe('0 of 20 photos')
    cleanup()
    withVideo({ enabled: false })
    await show(owner)
    expect((document.querySelector('input[type="file"]') as HTMLInputElement).accept).not.toContain('video')
  })
})

// The photo meter counts photos that uploaded; the limit also allows for the ones still uploading (#1348).
describe('the photo count', () => {
  const photosOf = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `ph${i}`, assetId: `a${i}`, url: `/api/assets/a${i}`, alt: null, versionId: null }))
  const choose = (...names: string[]) => fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: names.map((n) => new File(['x'], n, { type: 'image/png' })) } })
  const meter = () => document.querySelector('.df-editor-meter')?.textContent

  beforeEach(() => {
    api.saveProduct.mockResolvedValue({ id: 'p1', revision: 3, approval: null })
    vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }))
  })

  it('leaves a photo that didn’t upload out of the count, whether it is removed or tried again', async () => {
    api.loadProduct.mockResolvedValue(cushion({ photos: photosOf(9) }))
    api.uploadPhoto.mockResolvedValueOnce({ ok: false, code: 'TOO_LARGE' }).mockResolvedValueOnce({ ok: true, assetId: 'new' })
    await show(owner)
    expect(meter()).toBe('9 of 20 photos')
    choose('bad.png')
    await settle()
    expect(screen.getByText(words.photos.failed)).toBeTruthy()
    expect(meter()).toBe('9 of 20 photos')
    fireEvent.click(screen.getByRole('button', { name: words.photos.retry }))
    await settle()
    expect(screen.queryByText(words.photos.failed)).toBeNull()
    expect(meter()).toBe('10 of 20 photos')
    api.uploadPhoto.mockResolvedValueOnce({ ok: false, code: 'TOO_LARGE' })
    choose('bad2.png')
    await settle()
    fireEvent.click(screen.getByRole('button', { name: words.photos.dismiss }))
    expect(screen.queryByText(words.photos.failed)).toBeNull()
    expect(meter()).toBe('10 of 20 photos')
  })

  it('leaves a photo that is still uploading out of the count, but never lets the product pass 20', async () => {
    api.loadProduct.mockResolvedValue(cushion({ photos: photosOf(18) }))
    api.uploadPhoto.mockReturnValue(new Promise(() => undefined))
    await show(owner)
    choose('a.png', 'b.png', 'c.png', 'd.png')
    await settle()
    expect(api.uploadPhoto).toHaveBeenCalledTimes(2)
    expect(meter()).toBe('18 of 20 photos')
    expect(screen.queryByRole('button', { name: words.photos.addMore })).toBeNull()
    expect(screen.queryByText(words.photos.limit)).toBeNull()
  })

  it('says “the most photos” only once 20 have uploaded, and won’t try a failed photo again past 20', async () => {
    api.loadProduct.mockResolvedValue(cushion({ photos: photosOf(19) }))
    api.uploadPhoto.mockResolvedValueOnce({ ok: false, code: 'TOO_LARGE' }).mockResolvedValueOnce({ ok: true, assetId: 'new' })
    await show(owner)
    choose('bad.png')
    await settle()
    choose('good.png')
    await settle()
    expect(meter()).toBe('20 of 20 photos')
    expect(screen.getAllByText(words.photos.limit).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: words.photos.retry }))
    await settle()
    expect(api.uploadPhoto).toHaveBeenCalledTimes(2)
    expect(meter()).toBe('20 of 20 photos')
  })
})
