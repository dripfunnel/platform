import { act } from 'react-test-renderer'
import { ApiError, type ApiClient } from '../../graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { actingAs, fakeClient, hasText, press, pressableNamed, pressablesNamed, renderShell, texts } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { ProductsScreen } from './ProductsScreen'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockPush = jest.fn()
const mockSession: { client: ApiClient | null } = { client: null }

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, navigate: jest.fn(), back: jest.fn() }) }))
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('./files', () => ({ fileDeps: () => ({ domain: 'shop.test', headers: () => ({}) }) }))
jest.mock('../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))

// The fake network answers over several promise turns; jest-expo runs timers faked, so wait on promises, not on a timer.
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

const row = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  visible: true,
  approval: null,
  productType: 'physical',
  supplier: null,
  supplierRemoved: false,
  versionCount: 1,
  minPrice: { amount: '49900', currency: 'INR' },
  maxPrice: { amount: '49900', currency: 'INR' },
  photoUrl: null,
  stock: 12,
  lowStock: false,
  readiness: [{ marketName: 'India', ready: true, missing: [] }],
  ...over,
})

const counts = (over: Record<string, number> = {}) => ({ all: 0, visible: 0, hidden: 0, pending: 0, sentBack: 0, lowStock: 0, missingInfo: 0, fromSuppliers: 0, outOfStock: 0, ...over })
const page = (nodes: unknown[], next: string | null = null) => ({ products: { nodes, pageInfo: { hasNextPage: next !== null, hasPreviousPage: false, startCursor: null, endCursor: next } } })
const access = (permissions: string[], seller: { id: string } | null = null) => ({ me: { acting: { permissions, seller } } })

const owner = ['catalog.read', 'catalog.write', 'stock.write', 'approve']
const readOnlyState = { readOnly: true, status: null, trialEndsAt: null, pastDueSince: null, provisioning: null, support: null }

const show = async (handlers: Record<string, (variables: Record<string, unknown>, headers: Record<string, string>) => unknown>, options: Parameters<typeof renderShell>[1] & { supplier?: string } = {}) => {
  const { client, calls } = fakeApi(handlers, { supplier: options.supplier ?? null })
  mockSession.client = client
  const renderer = await renderShell(<ProductsScreen />, options)
  await settle()
  return { renderer, calls }
}

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
})

describe('the Products list', () => {
  it('lists each product as a card with what the API said: price, versions, stock and status', async () => {
    const { renderer } = await show({
      'acting { permissions': () => access(owner),
      productCounts: () => ({ productCounts: counts({ all: 2, visible: 1, hidden: 1, outOfStock: 1 }) }),
      'products(filter': () => page([row('p-1', 'Mara Linen Shirt', { versionCount: 4, minPrice: { amount: '249900', currency: 'INR' }, maxPrice: { amount: '279900', currency: 'INR' } }), row('p-2', 'Canvas Tote', { visible: false, stock: 0 })]),
    })

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Mara Linen Shirt', '₹2,499.00 – ₹2,799.00', '4 versions', '12 in stock', 'Canvas Tote', 'Out of stock']))
    expect(hasText(renderer, '2 products · 1 out of stock')).toBe(true)
    await press(pressableNamed(renderer, 'Open Mara Linen Shirt'))
    expect(mockPush).toHaveBeenCalledWith('/catalogue/p-1')
  })

  it('asks for a page of the API’s list and shows Show more while there is another', async () => {
    const seen: Array<string | null> = []
    const { renderer } = await show({
      'acting { permissions': () => access(owner),
      productCounts: () => ({ productCounts: counts({ all: 2 }) }),
      'products(filter': (variables) => {
        seen.push(variables.after as string | null)
        return variables.after ? page([row('p-2', 'Second page product')]) : page([row('p-1', 'First page product')], 'cursor-1')
      },
    })

    expect(hasText(renderer, 'First page product')).toBe(true)
    await press(pressableNamed(renderer, 'Show more'))
    await settle()

    expect(seen).toEqual([null, 'cursor-1'])
    expect(hasText(renderer, 'First page product')).toBe(true)
    expect(hasText(renderer, 'Second page product')).toBe(true)
  })

  it('shows filter chips with the API’s counts, and asks again when one is chosen', async () => {
    const { renderer, calls } = await show({
      'acting { permissions': () => access(owner),
      productCounts: () => ({ productCounts: counts({ all: 5, visible: 3, hidden: 2, lowStock: 1 }) }),
      'products(filter': () => page([row('p-1', 'Mara Linen Shirt')]),
    })

    expect(texts(renderer)).toEqual(expect.arrayContaining(['All', '5', 'Visible', '3', 'Hidden', '2', 'Low stock', '1']))
    expect(hasText(renderer, 'Sent back')).toBe(false)
    await press(pressableNamed(renderer, 'Low stock1'))
    await settle()
    const asked = calls.filter((call: Call) => call.query.includes('products(filter'))
    expect(asked.at(-1)?.variables.filter).toBe('low_stock')
  })

  it('searches the API after typing stops, never in the app', async () => {
    jest.useFakeTimers()
    try {
      const { renderer, calls } = await show({
        'acting { permissions': () => access(owner),
        productCounts: () => ({ productCounts: counts({ all: 1 }) }),
        'products(filter': () => page([row('p-1', 'Mara Linen Shirt')]),
      })
      const field = renderer.root.findByProps({ accessibilityLabel: 'Search products' })
      await act(async () => field.props.onChangeText('linen'))
      expect(calls.filter((call) => call.query.includes('products(filter')).every((call) => call.variables.search === null)).toBe(true)
      await act(async () => void jest.advanceTimersByTime(400))
      await act(async () => void (await Promise.resolve()))
      expect(calls.filter((call) => call.query.includes('products(filter')).at(-1)?.variables.search).toBe('linen')
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('what a seat sees and may do', () => {
  it('shows an Owner a new store’s first-product state with Add a product', async () => {
    const { renderer } = await show({
      'acting { permissions': () => access(owner),
      productCounts: () => ({ productCounts: counts() }),
      'products(filter': () => page([]),
    })

    expect(hasText(renderer, 'Add your first product')).toBe(true)
    await press(pressableNamed(renderer, 'Add a product'))
    expect(mockPush).toHaveBeenCalledWith('/catalogue/new')
  })

  it('titles Staff’s list view only and offers no Add', async () => {
    const { renderer } = await show(
      {
        'acting { permissions': () => access(['catalog.read', 'stock.read']),
        productCounts: () => ({ productCounts: counts({ all: 1 }) }),
        'products(filter': () => page([row('p-1', 'Mara Linen Shirt', { readiness: null })]),
      },
      { acting: actingAs('staff') },
    )

    expect(hasText(renderer, 'Products (view only)')).toBe(true)
    expect(hasText(renderer, '+ Add product')).toBe(false)
    expect(hasText(renderer, 'Approve')).toBe(false)
  })

  it('offers no Add, and no Approve, while the store is read-only (past due)', async () => {
    const { renderer } = await show(
      {
        'acting { permissions': () => access(owner),
        productCounts: () => ({ productCounts: counts({ all: 1, pending: 1 }) }),
        'products(filter': () => page([row('p-1', 'Northwind Tee', { approval: 'pending', supplier: { id: 's-1', name: 'Northwind Textiles' } })]),
      },
      { client: fakeClient({ state: readOnlyState }) },
    )

    expect(hasText(renderer, 'Northwind Tee')).toBe(true)
    expect(hasText(renderer, '+ Add product')).toBe(false)
    expect(hasText(renderer, 'Approve')).toBe(false)
  })

  it('shows a waiting supplier product to an approver with Approve and Send back, and approves it on the API', async () => {
    const approved: string[] = []
    const { renderer } = await show({
      'acting { permissions': () => access(owner),
      productCounts: () => ({ productCounts: counts({ all: 1, pending: 1 }) }),
      'products(filter': () => page([row('p-9', 'Northwind Tee', { approval: 'pending', visible: false, supplier: { id: 's-1', name: 'Northwind Textiles' } })]),
      approveProduct: (variables) => (approved.push(variables.id as string), { approveProduct: true }),
    })

    expect(hasText(renderer, '1 supplier product is waiting for your approval.')).toBe(true)
    expect(hasText(renderer, 'Waiting for approval')).toBe(true)
    await press(pressableNamed(renderer, 'Approve'))
    await settle()
    expect(approved).toEqual(['p-9'])
    expect(hasText(renderer, '“Northwind Tee” approved and live. Northwind Textiles has been told.')).toBe(true)
  })

  it('sends a product back only with a reason the supplier will see', async () => {
    const sent: Array<Record<string, unknown>> = []
    const { renderer } = await show({
      'acting { permissions': () => access(owner),
      productCounts: () => ({ productCounts: counts({ all: 1, pending: 1 }) }),
      'products(filter': () => page([row('p-9', 'Northwind Tee', { approval: 'pending', visible: false, supplier: { id: 's-1', name: 'Northwind Textiles' } })]),
      sendBackProduct: (variables) => (sent.push(variables), { sendBackProduct: true }),
    })

    await press(pressableNamed(renderer, 'Send back'))
    expect(hasText(renderer, 'Send back to Northwind Textiles')).toBe(true)
    expect(hasText(renderer, 'Say what needs changing. They’ll see exactly what you write.')).toBe(true)
    await press(pressablesNamed(renderer, 'Send back').at(-1) as never)
    expect(sent).toEqual([])
    expect(hasText(renderer, 'Add a reason so they know what to fix')).toBe(true)
  })
})

describe('a supplier’s list', () => {
  const northwind = row('p-n', 'Northwind Tee', { supplier: { id: 's-1', name: 'Northwind Textiles' } })
  const storeOwn = row('p-s', 'Store-owned Scarf')
  // The API scopes by the X-Supplier header, as it does in `app_supplier` (DATA-MODEL §5.3); the app narrows nothing itself.
  const scoped = (headers: Record<string, string>) => (headers['x-supplier'] ? [northwind] : [northwind, storeOwn])

  it('shows only what the API answered for its seat, and never asks for another supplier’s or the store’s', async () => {
    const { renderer, calls } = await show(
      {
        'acting { permissions': () => access(['catalog.read', 'catalog.write', 'stock.write'], { id: 's-1' }),
        productCounts: (_variables, headers) => ({ productCounts: counts({ all: scoped(headers).length }) }),
        'products(filter': (_variables, headers) => page(scoped(headers)),
      },
      { acting: actingAs('supplier-member', 'vendor-catalogue'), supplier: 's-1' },
    )

    expect(hasText(renderer, 'Your products')).toBe(true)
    expect(hasText(renderer, 'Northwind Tee')).toBe(true)
    expect(hasText(renderer, 'Store-owned Scarf')).toBe(false)
    expect(hasText(renderer, '1 product · 0 waiting for approval · 0 sent back')).toBe(true)
    const asked = calls.filter((call) => call.query.includes('products(filter'))
    expect(asked.every((call) => call.headers['x-supplier'] === 's-1' && !('supplier' in call.variables))).toBe(true)
  })

  it('draws exactly what the API answered, so a store-owned row the API let through would show: nothing is filtered in the app', async () => {
    const { renderer } = await show(
      {
        'acting { permissions': () => access(['catalog.read', 'catalog.write', 'stock.write'], { id: 's-1' }),
        productCounts: () => ({ productCounts: counts({ all: 2 }) }),
        'products(filter': () => page([northwind, storeOwn]),
      },
      { acting: actingAs('supplier-member', 'vendor-catalogue'), supplier: 's-1' },
    )

    expect(hasText(renderer, 'Store-owned Scarf')).toBe(true)
  })

  it('says a supplier has no products yet, as its own state, and offers Add', async () => {
    const { renderer } = await show(
      {
        'acting { permissions': () => access(['catalog.read', 'catalog.write', 'stock.write'], { id: 's-1' }),
        productCounts: () => ({ productCounts: counts() }),
        'products(filter': () => page([]),
      },
      { acting: actingAs('supplier-member', 'vendor-catalogue'), supplier: 's-1' },
    )

    expect(hasText(renderer, 'No products yet')).toBe(true)
    await press(pressableNamed(renderer, 'Add a product'))
    expect(mockPush).toHaveBeenCalledWith('/products/new')
  })
})

describe('the states', () => {
  it('says nothing matches a search or filter, and clears them', async () => {
    const { renderer } = await show({
      'acting { permissions': () => access(owner),
      productCounts: () => ({ productCounts: counts({ all: 3, hidden: 1 }) }),
      'products(filter': (variables) => page(variables.filter === 'hidden' ? [] : [row('p-1', 'Mara Linen Shirt')]),
    })

    await press(pressableNamed(renderer, 'Hidden1'))
    await settle()
    expect(hasText(renderer, 'No products match these filters')).toBe(true)
    await press(pressableNamed(renderer, 'Clear search and filters'))
    await settle()
    expect(hasText(renderer, 'Mara Linen Shirt')).toBe(true)
  })

  it('draws a skeleton while the list is on its way', async () => {
    let release: (value: unknown) => void = () => undefined
    const { renderer } = await show({
      'acting { permissions': () => access(owner),
      productCounts: () => ({ productCounts: counts({ all: 1 }) }),
      'products(filter': () => new Promise((resolve) => (release = resolve)),
    })

    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === 'Loading').length).toBeGreaterThan(0)
    await act(async () => release(page([row('p-1', 'Mara Linen Shirt')])))
    await settle()
    expect(hasText(renderer, 'Mara Linen Shirt')).toBe(true)
  })

  it('says it could not load, with a way to try again, when the network fails', async () => {
    let failing = true
    const { renderer } = await show({
      'acting { permissions': () => access(owner),
      productCounts: () => ({ productCounts: counts({ all: 1 }) }),
      'products(filter': () => {
        if (failing) throw new ApiError('NO_RESPONSE', 'down')
        return page([row('p-1', 'Mara Linen Shirt')])
      },
    })

    expect(hasText(renderer, 'We couldn’t load Products')).toBe(true)
    failing = false
    await press(pressableNamed(renderer, 'Try again'))
    await settle()
    expect(hasText(renderer, 'Mara Linen Shirt')).toBe(true)
  })

  it('says the seat has no access when the API refuses the list', async () => {
    const { renderer } = await show({
      'acting { permissions': () => access([]),
      productCounts: () => ({ productCounts: counts() }),
      'products(filter': () => {
        throw new ApiError('FORBIDDEN', 'no')
      },
    })

    expect(hasText(renderer, 'You don’t have access to Products')).toBe(true)
  })
})
