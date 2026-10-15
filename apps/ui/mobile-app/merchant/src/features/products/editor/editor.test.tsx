import { act, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '../../../graphql'
import { fakeApi, type Call } from '../../../testing/fakeApi'
import { actingAs, fakeClient, hasText, press, pressableNamed, pressablesNamed, renderShell, texts } from '../../../testing/harness'
import { resetScenario } from '../../states/scenario'
import { ProductEditorScreen } from './ProductEditorScreen'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockReplace = jest.fn()
const mockPush = jest.fn()
const mockPick = jest.fn()
const mockSession: { client: ApiClient | null } = { client: null }

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: mockReplace, navigate: jest.fn(), back: jest.fn() }), useNavigation: () => ({ dispatch: jest.fn() }) }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }))
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...args: unknown[]) => mockPick('library', ...args),
  launchCameraAsync: (...args: unknown[]) => mockPick('camera', ...args),
  requestCameraPermissionsAsync: async () => ({ granted: true }),
}))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../files', () => ({ fileDeps: () => ({ domain: 'shop.test', headers: () => ({ authorization: 'Bearer token' }) }) }))
jest.mock('../../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))

const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

type Handlers = Record<string, (variables: Record<string, unknown>, headers: Record<string, string>) => unknown>

const version = (size: string, over: Record<string, unknown> = {}) => ({
  id: `ver-${size}`,
  choices: [size],
  name: null,
  sku: `MARA-${size}`,
  barcode: null,
  visible: true,
  prices: [{ amount: '249900', compareAtAmount: null, currency: 'INR' }],
  cost: null,
  weightGrams: 400,
  lengthMm: null,
  widthMm: null,
  heightMm: null,
  hsCode: '6205',
  customsDescription: null,
  taxClassId: 'tc-18',
  trackStock: true,
  continueSelling: false,
  ...over,
})

const apiProduct = (over: Record<string, unknown> = {}) => ({
  id: 'p-1',
  revision: 4,
  name: 'Mara Linen Shirt',
  description: 'Soft washed linen.',
  productType: 'physical',
  visible: true,
  approval: null,
  sentBackReason: null,
  supplier: null,
  shared: false,
  slug: 'mara-linen-shirt',
  sizeChartId: null,
  category: 'Shirts',
  warrantyText: null,
  returnsText: null,
  seoTitle: null,
  seoDescription: null,
  pricingCurrency: 'INR',
  photos: [],
  options: [],
  versions: [{ ...version('x'), choices: [], id: 'ver-1' }],
  readiness: [{ marketId: 'm-in', marketName: 'India', ready: true, missing: [] }, { marketId: 'm-us', marketName: 'United States', ready: false, missing: ['fibre', 'care'] }],
  ...over,
})

const owner = ['catalog.read', 'catalog.write', 'stock.read', 'stock.write', 'approve']
const stockLevels = { productStock: { nodes: [{ versionId: 'ver-1', levels: [{ warehouseId: 'w-1', warehouseName: 'Jaipur studio', isDefault: true, onHand: 12, reserved: 2 }] }], pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } } }

const base = (over: { product?: unknown; permissions?: string[]; seller?: { id: string } | null; approval?: boolean; features?: unknown[] } = {}): Handlers => ({
  'acting { permissions': () => ({ me: { acting: { permissions: over.permissions ?? owner, seller: over.seller ?? null } } }),
  catalogueSettings: () => ({ catalogueSettings: { pricingCurrency: 'INR', features: over.features ?? [{ key: 'aplus', enabled: true, inPlan: true }] } }),
  supplierApprovalRequired: () => ({ supplierApprovalRequired: over.approval ?? false }),
  'warehouses(first': () => ({ warehouses: { nodes: [{ id: 'w-1', name: 'Jaipur studio', isDefault: true, supplierId: null }, { id: 'w-s', name: 'Northwind godown', isDefault: false, supplierId: 's-1' }], pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } } }),
  'productStock(productId': () => stockLevels,
  'product(id': () => ({ product: 'product' in over ? over.product : apiProduct() }),
})

const open = async (id: string | null, handlers: Handlers, options: Parameters<typeof renderShell>[1] & { supplier?: string } = {}) => {
  const { client, calls } = fakeApi(handlers, { supplier: options.supplier ?? null })
  mockSession.client = client
  const renderer = await renderShell(<ProductEditorScreen id={id} />, options)
  await settle()
  return { renderer, calls }
}

const input = (renderer: ReactTestRenderer, label: string) => {
  const found = renderer.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function')[0]
  if (!found) throw new Error(`no field named "${label}"`)
  return found
}
const type = async (renderer: ReactTestRenderer, label: string, value: string) => {
  await act(async () => input(renderer, label).props.onChangeText(value))
}
const calledWith = (calls: Call[], text: string) => calls.filter((call) => call.query.includes(text))

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
})

describe('saving a product writes minor units and what the form didn’t touch', () => {
  it('creates a new product from a name and a price typed in rupees, and moves to its own page', async () => {
    const saved = { id: 'p-new', revision: 1, approval: null, reviewed: [] }
    const { renderer, calls } = await open(null, {
      ...base({ product: null }),
      'mutation Save': () => ({ saveProduct: saved }),
    })

    expect(hasText(renderer, 'New product')).toBe(true)
    await type(renderer, 'Product name', 'Organic Cotton Tee')
    await type(renderer, 'Price', '499.50')
    await press(pressableNamed(renderer, 'Save product'))
    await settle()

    const sent = calledWith(calls, 'mutation Save')[0]
    expect(sent?.variables).toMatchObject({ id: null, revision: null, input: { name: 'Organic Cotton Tee', productType: 'physical', visible: true } })
    expect((sent?.variables.input as { versions: unknown[] }).versions).toEqual([expect.objectContaining({ choices: [], prices: [{ currency: 'INR', amount: '49950' }], trackStock: true })])
    expect(hasText(renderer, '“Organic Cotton Tee” added')).toBe(true)
    expect(mockReplace).toHaveBeenCalledWith('/catalogue/p-new')
  })

  it('edits a saved product at its revision, keeping its address, category and every version field it has no control for', async () => {
    const { renderer, calls } = await open('p-1', {
      ...base(),
      'mutation Save': () => ({ saveProduct: { id: 'p-1', revision: 5, approval: null, reviewed: [] } }),
    })

    await type(renderer, 'Price', '2599')
    await press(pressableNamed(renderer, 'Save'))
    await settle()

    const sent = calledWith(calls, 'mutation Save')[0]?.variables as { id: string; revision: number; input: Record<string, unknown> & { versions: Record<string, unknown>[] } }
    expect(sent).toMatchObject({ id: 'p-1', revision: 4 })
    expect(sent.input).toMatchObject({ slug: 'mara-linen-shirt', category: 'Shirts', visible: true })
    expect(sent.input.versions[0]).toMatchObject({ id: 'ver-1', prices: [{ currency: 'INR', amount: '259900' }], weightGrams: 400, hsCode: '6205', taxClassId: 'tc-18' })
    expect(hasText(renderer, 'Saved')).toBe(true)
  })

  it('refuses a price the currency can’t hold, before anything is sent, saying how to type it', async () => {
    const { renderer, calls } = await open(null, { ...base({ product: null }), 'mutation Save': () => ({ saveProduct: { id: 'x', revision: 1, approval: null, reviewed: [] } }) })

    await type(renderer, 'Product name', 'Tee')
    await type(renderer, 'Price', '499.999')
    await press(pressableNamed(renderer, 'Save product'))
    await settle()

    expect(calledWith(calls, 'mutation Save')).toHaveLength(0)
    expect(hasText(renderer, 'Type a price like 499.00')).toBe(true)
    expect(hasText(renderer, '1 thing needs fixing before you save:')).toBe(true)
  })

  it('asks "Selling for free?" before saving a price of nothing', async () => {
    const { renderer, calls } = await open(null, { ...base({ product: null }), 'mutation Save': () => ({ saveProduct: { id: 'p-free', revision: 1, approval: null, reviewed: [] } }) })

    await type(renderer, 'Product name', 'Sticker')
    await type(renderer, 'Price', '0')
    await press(pressableNamed(renderer, 'Save product'))

    expect(hasText(renderer, 'Selling for free?')).toBe(true)
    expect(calledWith(calls, 'mutation Save')).toHaveLength(0)
    await press(pressableNamed(renderer, 'Yes, it’s free'))
    await settle()
    expect((calledWith(calls, 'mutation Save')[0]?.variables.input as { versions: { prices: unknown[] }[] }).versions[0]?.prices).toEqual([{ currency: 'INR', amount: '0' }])
  })
})

describe('a refused save', () => {
  it.each([
    ['DUPLICATE_SKU', 'You already use that product code on another product.'],
    ['PRICE_REQUIRED', 'Every version needs a price.'],
    ['VERSION_CHOICES', 'Press “Update versions” so every version has one value for each kind of choice.'],
    ['TOO_MANY_PHOTOS', 'A product can have up to 20 photos.'],
    ['NOT_SHOWABLE', 'This product is waiting for approval, so it can’t be shown yet.'],
    ['SUPPLIER_FIELD', 'That’s the store’s to set.'],
    ['PLAN_LIMIT', 'Your plan has no room for more products.'],
    ['READ_ONLY', 'Your store is read-only until the bill is paid.'],
  ])('shows %s in the prototype’s words, keeps what was typed, and offers no upgrade', async (code, words) => {
    const { renderer } = await open('p-1', {
      ...base(),
      'mutation Save': () => {
        throw new ApiError(code, 'API words that are never shown')
      },
    })

    await type(renderer, 'Price', '2599')
    await press(pressableNamed(renderer, 'Save'))
    await settle()

    expect(hasText(renderer, 'Couldn’t save — your changes are still here.')).toBe(true)
    expect(hasText(renderer, words)).toBe(true)
    expect(hasText(renderer, 'API words that are never shown')).toBe(false)
    expect(hasText(renderer, 'Upgrade')).toBe(false)
    expect((input(renderer, 'Price').props as { value: string }).value).toBe('2599')
  })

  it('says someone else saved it, and reloads on request', async () => {
    let revision = 4
    const { renderer, calls } = await open('p-1', {
      ...base(),
      'product(id': () => ({ product: apiProduct({ revision }) }),
      'mutation Save': () => {
        throw new ApiError('STALE_REVISION', 'x', { revision: 5 })
      },
    })

    await type(renderer, 'Price', '2599')
    await press(pressableNamed(renderer, 'Save'))
    await settle()
    expect(hasText(renderer, 'Someone else saved this product.')).toBe(true)

    revision = 5
    await press(pressableNamed(renderer, 'Reload'))
    await settle()
    expect(calledWith(calls, 'query Product').length).toBeGreaterThan(1)
    expect(hasText(renderer, 'Someone else saved this product.')).toBe(false)
  })
})

describe('stock', () => {
  it('shows the count per location, what is reserved for orders, and counts typed numbers with the product', async () => {
    const { renderer, calls } = await open('p-1', {
      ...base(),
      'mutation Save': () => ({ saveProduct: { id: 'p-1', revision: 5, approval: null, reviewed: [] } }),
      'mutation SetStock': () => ({ setStock: [{ versionId: 'ver-1' }] }),
    })

    expect(hasText(renderer, '2 reserved for orders · sold, not shipped yet.')).toBe(true)
    expect((input(renderer, 'Stock of this product at Jaipur studio').props as { value: string }).value).toBe('12')
    expect(hasText(renderer, 'Northwind godown')).toBe(false)

    await type(renderer, 'Stock of this product at Jaipur studio', '20')
    await press(pressableNamed(renderer, 'Save'))
    await settle()
    expect(calledWith(calls, 'mutation SetStock')[0]?.variables).toEqual({ e: [{ versionId: 'ver-1', warehouseId: 'w-1', quantity: 20 }] })
  })

  it('changes stock with a reason at once, and says so before it does', async () => {
    const { renderer, calls } = await open('p-1', {
      ...base(),
      'mutation Adjust': () => ({ adjustStock: 17 }),
    })

    await press(pressableNamed(renderer, 'Change with a reason…'))
    expect(hasText(renderer, 'It is saved right away, apart from the rest of the product.')).toBe(true)
    await press(pressableNamed(renderer, 'Received new stock'))
    await act(async () => renderer.root.findByProps({ accessibilityLabel: 'How many? Use − to remove, e.g. −2' }).props.onChangeText('+5'))
    await press(pressableNamed(renderer, 'Apply'))
    await settle()

    expect(calledWith(calls, 'mutation Adjust')[0]?.variables).toEqual({ v: 'ver-1', w: 'w-1', d: 5, r: 'received' })
    expect(hasText(renderer, 'Stock +5 · Received new stock')).toBe(true)
    expect((input(renderer, 'Stock of this product at Jaipur studio').props as { value: string }).value).toBe('17')
  })

  it('shows the history of changes with each one’s reason, who and where', async () => {
    const { renderer } = await open('p-1', {
      ...base(),
      'stockHistory(': () => ({
        stockHistory: {
          nodes: [
            { id: 'h-1', versionId: 'ver-1', delta: 5, reason: 'received', resultingQuantity: 17, warehouseName: 'Jaipur studio', actorName: 'Priya', actorKind: 'user', occurredAt: '2026-10-12T08:30:00Z' },
            { id: 'h-2', versionId: 'ver-1', delta: -1, reason: 'order', resultingQuantity: 12, warehouseName: 'Jaipur studio', actorName: null, actorKind: 'system', occurredAt: '2026-10-11T08:30:00Z' },
          ],
          pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null },
        },
      }),
    })

    await press(pressableNamed(renderer, 'Stock history'))
    await settle()
    expect(texts(renderer)).toEqual(expect.arrayContaining(['+5', 'Received new stock', '−1', 'Order']))
    expect(hasText(renderer, 'Jaipur studio · by Priya · now 17')).toBe(true)
    expect(hasText(renderer, 'Jaipur studio · automatically · now 12')).toBe(true)
  })
})

describe('the size chart a product uses (CATALOG-DESIGN.md R6)', () => {
  const charts = [{ id: 'sc-shirts', name: 'Men’s shirts', unit: 'cm', products: 4, supplierId: null }, { id: 'sc-kurtas', name: 'Kurtas', unit: 'cm', products: 1, supplierId: null }]
  const withCharts = (over: Handlers = {}, product: unknown = apiProduct()): Handlers => ({
    ...base({ product, features: [{ key: 'aplus', enabled: true, inPlan: true }, { key: 'sizeCharts', enabled: true, inPlan: true }] }),
    'sizeCharts(first': () => ({ sizeCharts: { limit: 200, nodes: charts, pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } } }),
    ...over,
  })

  it('attaches one of the store’s charts, sending it with the save, and nothing else of the listing', async () => {
    const { renderer, calls } = await open('p-1', withCharts({ 'mutation Save': () => ({ saveProduct: { id: 'p-1', revision: 5, approval: null, reviewed: [] } }) }))

    expect(hasText(renderer, 'Shoppers return fewer orders when there’s a size chart.')).toBe(true)
    await press(pressableNamed(renderer, 'Size chart: No size chart'))
    await press(pressableNamed(renderer, 'Men’s shirts'))
    expect(pressablesNamed(renderer, 'Size chart: Men’s shirts')).toHaveLength(1)
    await press(pressableNamed(renderer, 'Save'))
    await settle()

    const sent = calledWith(calls, 'mutation Save')[0]?.variables.input as Record<string, unknown>
    expect(sent).toMatchObject({ sizeChartId: 'sc-shirts', slug: 'mara-linen-shirt', category: 'Shirts' })
  })

  it('takes the chart off with null, and leaves it out of a save that didn’t change it', async () => {
    const attached = apiProduct({ sizeChartId: 'sc-kurtas' })
    const { renderer, calls } = await open('p-1', withCharts({ 'mutation Save': () => ({ saveProduct: { id: 'p-1', revision: 5, approval: null, reviewed: [] } }) }, attached))

    expect(pressablesNamed(renderer, 'Size chart: Kurtas')).toHaveLength(1)
    await type(renderer, 'Price', '2599')
    await press(pressableNamed(renderer, 'Save'))
    await settle()
    expect(calledWith(calls, 'mutation Save')[0]?.variables.input).not.toHaveProperty('sizeChartId')

    await press(pressableNamed(renderer, 'Size chart: Kurtas'))
    await press(pressableNamed(renderer, 'No size chart'))
    await type(renderer, 'Price', '2699')
    await press(pressableNamed(renderer, 'Save'))
    await settle()
    expect(calledWith(calls, 'mutation Save').at(-1)?.variables.input).toMatchObject({ sizeChartId: null })
  })

  it('shows nothing where the store has size charts off, and never reads them for a supplier', async () => {
    const off = await open('p-1', base())
    expect(hasText(off.renderer, 'Size chart')).toBe(false)
    expect(calledWith(off.calls, 'sizeCharts(first')).toHaveLength(0)

    const { renderer, calls } = await open('p-1', withCharts({ 'acting { permissions': () => ({ me: { acting: { permissions: ['catalog.read', 'catalog.write'], seller: { id: 's-1' } } } }) }, apiProduct({ supplier: { id: 's-1', name: 'Northwind Textiles' }, readiness: null })), { acting: actingAs('supplier-member', 'vendor-catalogue'), supplier: 's-1' })
    expect(hasText(renderer, 'Size chart')).toBe(false)
    expect(calledWith(calls, 'sizeCharts(first')).toHaveLength(0)
  })

  it('says the charts didn’t load and leaves the product’s chart as it is', async () => {
    const { renderer } = await open('p-1', withCharts({ 'sizeCharts(first': () => { throw new ApiError('NO_RESPONSE', 'x') } }, apiProduct({ sizeChartId: 'sc-kurtas' })))

    expect(hasText(renderer, 'Size charts didn’t load, so the chart can’t be changed here. Reload to try again.')).toBe(true)
    expect((pressableNamed(renderer, 'Size chart: A size chart').props as { disabled: boolean }).disabled).toBe(true)
  })

  it('lets Staff see which chart a product uses but not change it', async () => {
    const { renderer } = await open('p-1', withCharts({ 'acting { permissions': () => ({ me: { acting: { permissions: ['catalog.read'], seller: null } } }) }, apiProduct({ sizeChartId: 'sc-kurtas' })), { acting: actingAs('staff') })

    expect((pressableNamed(renderer, 'Size chart: Kurtas').props as { disabled: boolean }).disabled).toBe(true)
  })

  it('shows a refusal for a store that has the section off by its code', async () => {
    const { renderer } = await open('p-1', withCharts({ 'mutation Save': () => { throw new ApiError('FEATURE_UNAVAILABLE', 'API words that are never shown') } }))

    await press(pressableNamed(renderer, 'Size chart: No size chart'))
    await press(pressableNamed(renderer, 'Kurtas'))
    await press(pressableNamed(renderer, 'Save'))
    await settle()

    expect(hasText(renderer, 'Size charts aren’t switched on in this store.')).toBe(true)
    expect(hasText(renderer, 'API words that are never shown')).toBe(false)
  })
})

describe('who sees what', () => {
  it('lets Staff look at a product but not change it', async () => {
    const { renderer } = await open('p-1', base({ permissions: ['catalog.read', 'stock.read'] }), { acting: actingAs('staff') })

    expect(hasText(renderer, 'You can view this product.')).toBe(true)
    expect(pressablesNamed(renderer, 'Save')).toHaveLength(0)
    expect((input(renderer, 'Product name').props as { editable: boolean }).editable).toBe(false)
  })

  it('tells a store that is read-only (past due) that nothing can be changed', async () => {
    const { renderer } = await open('p-1', base(), { client: fakeClient({ state: { readOnly: true, status: null, trialEndsAt: null, pastDueSince: null, provisioning: null, support: null } }) })

    expect(hasText(renderer, 'Your store is read-only until the bill is paid.')).toBe(true)
    expect((input(renderer, 'Product name').props as { editable: boolean }).editable).toBe(false)
  })

  it('shows a supplier why its product was sent back, and never offers it the store’s visibility', async () => {
    const { renderer, calls } = await open(
      'p-1',
      {
        ...base({ permissions: ['catalog.read', 'catalog.write', 'stock.write'], seller: { id: 's-1' }, product: apiProduct({ supplier: { id: 's-1', name: 'Northwind Textiles' }, approval: 'sent_back', visible: false, sentBackReason: 'The main photo is blurry.', readiness: null }), approval: true }),
        'mutation Save': () => ({ saveProduct: { id: 'p-1', revision: 5, approval: 'pending', reviewed: ['price'] } }),
      },
      { acting: actingAs('supplier-member', 'vendor-catalogue'), supplier: 's-1' },
    )

    expect(hasText(renderer, 'Sent back by your store owner:')).toBe(true)
    expect(hasText(renderer, '“The main photo is blurry.” Fix it and send it again.')).toBe(true)
    expect(hasText(renderer, 'Shoppers can find and buy it')).toBe(false)
    expect(hasText(renderer, 'Ready to sell in')).toBe(false)

    await type(renderer, 'Price', '2599')
    await press(pressableNamed(renderer, 'Submit for approval'))
    await settle()
    const sent = calledWith(calls, 'mutation Save')[0]?.variables.input as Record<string, unknown> & { versions: Record<string, unknown>[] }
    expect(sent).not.toHaveProperty('visible')
    expect(sent.versions[0]).not.toHaveProperty('taxClassId')
    expect(hasText(renderer, 'Your price, title or photo change needs approval')).toBe(true)
  })

  it('shows a Stock-only supplier its stock and nothing else to change', async () => {
    const { renderer } = await open('p-1', base({ permissions: ['catalog.read', 'stock.write', 'catalog.propose'], seller: { id: 's-1' }, product: apiProduct({ supplier: { id: 's-1', name: 'Northwind Textiles' }, readiness: null }) }), {
      acting: actingAs('supplier-member', 'vendor-stock'),
      supplier: 's-1',
    })

    expect(hasText(renderer, 'You can update stock.')).toBe(true)
    expect((input(renderer, 'Product name').props as { editable: boolean }).editable).toBe(false)
    expect((input(renderer, 'Stock of this product at Jaipur studio').props as { editable: boolean }).editable).toBe(true)
  })

  it('shows an approver a supplier’s waiting product with Approve and Send back above the form', async () => {
    const { renderer, calls } = await open('p-1', {
      ...base({ product: apiProduct({ supplier: { id: 's-1', name: 'Northwind Textiles' }, approval: 'pending', visible: false }) }),
      approveProduct: () => ({ approveProduct: true }),
    })

    expect(hasText(renderer, 'Review · from Northwind Textiles')).toBe(true)
    expect(hasText(renderer, 'This is Northwind Textiles’s product.')).toBe(true)
    await press(pressableNamed(renderer, 'Approve & publish'))
    await settle()
    expect(calledWith(calls, 'approveProduct')).toHaveLength(1)
  })

  it('says what is missing for each market, and that some details are added on the web', async () => {
    const { renderer } = await open('p-1', base())

    expect(hasText(renderer, 'Ready to sell in')).toBe(true)
    expect(hasText(renderer, 'Add: fibre content, care instructions')).toBe(true)
    expect(hasText(renderer, 'Details like fibre content and care are added on the web for now.')).toBe(true)
  })

  it('opens a download, a service or a gift card for looking only, since product kinds come with their own card', async () => {
    const { renderer } = await open('p-1', base({ product: apiProduct({ productType: 'digital' }) }))

    expect(hasText(renderer, 'This kind of product is edited on the web for now.')).toBe(true)
    expect((input(renderer, 'Product name').props as { editable: boolean }).editable).toBe(false)
  })
})

describe('the states', () => {
  it('says a product that is not here, or is another supplier’s, is not found', async () => {
    const { renderer } = await open('p-other', base({ product: null }))

    expect(hasText(renderer, 'This page isn’t here any more')).toBe(true)
  })

  it('says it could not load, with a way to try again', async () => {
    let failing = true
    const { renderer } = await open('p-1', {
      ...base(),
      'product(id': () => {
        if (failing) throw new ApiError('NO_RESPONSE', 'down')
        return { product: apiProduct() }
      },
    })

    expect(hasText(renderer, 'We couldn’t load Products')).toBe(true)
    failing = false
    await press(pressableNamed(renderer, 'Try again'))
    await settle()
    expect((input(renderer, 'Product name').props as { value: string }).value).toBe('Mara Linen Shirt')
  })

  it('says the seat has no access when the API refuses', async () => {
    const { renderer } = await open('p-1', {
      ...base(),
      'product(id': () => {
        throw new ApiError('FORBIDDEN', 'no')
      },
    })

    expect(hasText(renderer, 'You don’t have access to Products')).toBe(true)
  })
})

describe('photos', () => {
  const upload = (answer: unknown) => {
    const fetchMock = jest.fn(async (url: string) => (url.startsWith('file:') ? { blob: async () => ({ type: 'image/jpeg' }) } : { json: async () => answer }))
    global.fetch = fetchMock as unknown as typeof fetch
    return fetchMock
  }

  it('uploads a photo from the library to the API as it is picked, and saves it with the product', async () => {
    const fetchMock = upload({ ok: true, asset: { id: 'asset-1', kind: 'image', mime: 'image/jpeg', bytes: 10 } })
    mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///photo.jpg', mimeType: 'image/jpeg' }] })
    const { renderer, calls } = await open('p-1', { ...base(), 'mutation Save': () => ({ saveProduct: { id: 'p-1', revision: 5, approval: null, reviewed: [] } }) })

    await press(pressableNamed(renderer, 'Choose from your photos'))
    await settle()

    expect(mockPick).toHaveBeenCalledWith('library', expect.objectContaining({ mediaTypes: ['images'] }))
    const post = fetchMock.mock.calls.find(([url]) => url === 'https://shop.test/api/assets') as unknown as [string, { method: string; headers: Record<string, string> }]
    expect(post[1]).toMatchObject({ method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer token', 'content-type': 'image/jpeg' }) })

    await press(pressableNamed(renderer, 'Save'))
    await settle()
    expect((calledWith(calls, 'mutation Save')[0]?.variables.input as { photos: unknown[] }).photos).toEqual([{ assetId: 'asset-1' }])
  })

  it('takes a photo with the camera', async () => {
    upload({ ok: true, asset: { id: 'asset-2', kind: 'image', mime: 'image/jpeg', bytes: 10 } })
    mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///camera.jpg', mimeType: 'image/jpeg' }] })
    const { renderer } = await open('p-1', base())

    await press(pressableNamed(renderer, 'Take a photo'))
    await settle()

    expect(mockPick).toHaveBeenCalledWith('camera', expect.anything())
    expect(hasText(renderer, 'Main photo')).toBe(true)
  })

  it('says why a photo did not upload, in the prototype’s words, and tries again', async () => {
    upload({ ok: false, code: 'TOO_LARGE' })
    mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///huge.jpg', mimeType: 'image/jpeg' }] })
    const { renderer } = await open('p-1', base())

    await press(pressableNamed(renderer, 'Choose from your photos'))
    await settle()
    expect(hasText(renderer, 'Didn’t upload')).toBe(true)
    expect(hasText(renderer, 'That photo is too big. Use one under 20 MB.')).toBe(true)

    upload({ ok: true, asset: { id: 'asset-3', kind: 'image', mime: 'image/jpeg', bytes: 10 } })
    await press(pressableNamed(renderer, 'Try again'))
    await settle()
    expect(hasText(renderer, 'Didn’t upload')).toBe(false)
    expect(hasText(renderer, 'Main photo')).toBe(true)
  })

  it('won’t save while a photo is still uploading', async () => {
    upload(new Promise(() => undefined))
    mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///slow.jpg', mimeType: 'image/jpeg' }] })
    const { renderer, calls } = await open('p-1', { ...base(), 'mutation Save': () => ({ saveProduct: { id: 'p-1', revision: 5, approval: null, reviewed: [] } }) })

    await press(pressableNamed(renderer, 'Choose from your photos'))
    await settle()
    await press(pressableNamed(renderer, 'Save'))

    expect(calledWith(calls, 'mutation Save')).toHaveLength(0)
    expect(hasText(renderer, 'A photo is still uploading. Save again once it’s in.')).toBe(true)
  })
})

describe('choices and versions', () => {
  it('makes a version for each combination from the choices typed, and sends them with their prices', async () => {
    const { renderer, calls } = await open(null, { ...base({ product: null }), 'mutation Save': () => ({ saveProduct: { id: 'p-new', revision: 1, approval: null, reviewed: [] } }) })

    await type(renderer, 'Product name', 'Linen Shirt')
    await type(renderer, 'Price', '2499')
    await press(pressableNamed(renderer, 'Add choices'))
    await press(pressableNamed(renderer, 'Size'))
    await type(renderer, 'Add a choice to Size', 'S, M, L')
    await press(pressablesNamed(renderer, 'Add').at(-1) as never)

    expect(hasText(renderer, '3 size makes 3 versions.')).toBe(true)
    await press(pressableNamed(renderer, 'Create 3 versions'))
    expect(hasText(renderer, 'Versions · 3')).toBe(true)

    await press(pressableNamed(renderer, 'Save product'))
    await settle()
    const versions = (calledWith(calls, 'mutation Save')[0]?.variables.input as { versions: { choices: string[]; prices: unknown[] }[]; options: { name: string }[] }).versions
    expect(versions.map((v) => v.choices)).toEqual([['S'], ['M'], ['L']])
    expect(versions.every((v) => JSON.stringify(v.prices) === JSON.stringify([{ currency: 'INR', amount: '249900' }]))).toBe(true)
  })

  it('refuses to save choices that have no versions yet, and says to create them', async () => {
    const { renderer, calls } = await open(null, { ...base({ product: null }), 'mutation Save': () => ({ saveProduct: { id: 'x', revision: 1, approval: null, reviewed: [] } }) })

    await type(renderer, 'Product name', 'Linen Shirt')
    await type(renderer, 'Price', '2499')
    await press(pressableNamed(renderer, 'Add choices'))
    await press(pressableNamed(renderer, 'Size'))
    await type(renderer, 'Add a choice to Size', 'S, M')
    await press(pressablesNamed(renderer, 'Add').at(-1) as never)
    await press(pressableNamed(renderer, 'Save product'))

    expect(calledWith(calls, 'mutation Save')).toHaveLength(0)
    expect(hasText(renderer, 'Press “Create versions” or “Update versions” so each combination has its own version.')).toBe(true)
  })

  it('says what removing a choice takes with it before it does, and that past orders keep their record', async () => {
    const product = apiProduct({
      options: [{ id: 'o-size', name: 'Size', values: [{ id: 'v-s', name: 'S' }, { id: 'v-m', name: 'M' }] }],
      versions: [version('S'), version('M')],
    })
    const { renderer } = await open('p-1', base({ product }))

    await press(pressableNamed(renderer, 'Remove S'))
    expect(hasText(renderer, 'Remove “S”?')).toBe(true)
    expect(hasText(renderer, '1 version goes with it: S.')).toBe(true)
    expect(hasText(renderer, 'This can’t be undone. Past orders keep their record.')).toBe(true)
    await press(pressablesNamed(renderer, 'Remove S').at(-1) as never)
    await settle()
    expect(hasText(renderer, 'Versions · 1')).toBe(true)
  })

  it('asks before hiding the last visible version, and offers to hide the whole product instead', async () => {
    const product = apiProduct({
      options: [{ id: 'o-size', name: 'Size', values: [{ id: 'v-s', name: 'S' }, { id: 'v-m', name: 'M' }] }],
      versions: [version('S'), version('M', { visible: false })],
    })
    const { renderer } = await open('p-1', base({ product }))

    await press(pressableNamed(renderer, 'S: Visible'))
    expect(hasText(renderer, 'This would hide every version')).toBe(true)
    expect(pressablesNamed(renderer, 'Hide product').length).toBeGreaterThan(0)
  })
})

describe('never losing typed counts', () => {
  it('keeps the typed stock, and says so, when the product saved but could not be read back', async () => {
    let saves = 0
    const { renderer, calls } = await open('p-1', {
      ...base(),
      'product(id': () => {
        if (saves === 1) throw new ApiError('NO_RESPONSE', 'down')
        return { product: apiProduct() }
      },
      'mutation Save': () => ((saves += 1), { saveProduct: { id: 'p-1', revision: 5, approval: null, reviewed: [] } }),
      'mutation SetStock': () => ({ setStock: [{ versionId: 'ver-1' }] }),
    })

    await type(renderer, 'Product name', 'Mara Linen Shirt II')
    await type(renderer, 'Stock of this product at Jaipur studio', '20')
    await press(pressableNamed(renderer, 'Save'))
    await settle()

    expect(calledWith(calls, 'mutation SetStock')).toHaveLength(0)
    expect(hasText(renderer, 'The product saved, but the counts didn’t. Try saving again.')).toBe(true)
    expect((input(renderer, 'Stock of this product at Jaipur studio').props as { value: string }).value).toBe('20')
    expect((input(renderer, 'Product name').props as { value: string }).value).toBe('Mara Linen Shirt II')

    await press(pressableNamed(renderer, 'Save'))
    await settle()
    expect(calledWith(calls, 'mutation Save').at(-1)?.variables).toMatchObject({ revision: 5 })
    expect(calledWith(calls, 'mutation SetStock')[0]?.variables).toEqual({ e: [{ versionId: 'ver-1', warehouseId: 'w-1', quantity: 20 }] })
  })
})
