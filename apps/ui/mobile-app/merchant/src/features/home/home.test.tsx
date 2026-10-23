import { act, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { fakeApi } from '../../testing/fakeApi'
import { actingAs, hasText, press, pressableNamed, pressablesNamed, renderShell, texts } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { HomeScreen } from './HomeScreen'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockPush = jest.fn()
const mockSession: { client: ApiClient | null } = { client: null }
const mockNet: { listener: ((state: { isConnected: boolean; isInternetReachable: boolean }) => void) | null } = { listener: null }

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), navigate: jest.fn() }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  }
})
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: (state: { isConnected: boolean; isInternetReachable: boolean }) => void) => {
      mockNet.listener = listener
      return () => undefined
    },
  },
}))
jest.mock('../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))

const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

type Handlers = Record<string, (variables: Record<string, unknown>, headers: Record<string, string>) => unknown>

const owner = ['orders.read', 'reports.read', 'catalog.write', 'settings', 'stock.read', 'approve']
const manager = ['orders.read', 'reports.read', 'catalog.write', 'stock.read', 'approve']
const staff = ['orders.read', 'stock.read']
const access = (permissions: string[]) => ({ me: { acting: { permissions, seller: null } } })

const inr = (amount: string) => ({ amount, currency: 'INR' })
const order = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  number: `KT-${id}`,
  state: 'placed',
  paymentState: 'paid',
  fulfilmentState: 'unfulfilled',
  customerName: `Customer ${id}`,
  items: 3,
  total: inr('489700'),
  ...over,
})

const homeOf = (over: Record<string, unknown> = {}) => ({
  timeZone: 'Asia/Kolkata',
  hasOrders: true,
  toShip: 4,
  partlyShipped: 1,
  oldestToShipAt: '2026-10-17T05:00:00.000Z',
  awaitingApproval: 2,
  lowStock: { count: 2, names: ['Linen kurta', 'Silk saree'] },
  ordersToday: 3,
  ordersYesterday: 5,
  sales: [{ yesterday: inr('425000') }],
  latestOrders: [order('1'), order('2', { fulfilmentState: 'fulfilled' }), order('3')],
  setup: null,
  ...over,
})

const newStore = (setup: Record<string, boolean | null>, over: Record<string, unknown> = {}) =>
  homeOf({ hasOrders: false, toShip: 0, awaitingApproval: null, lowStock: null, ordersToday: 0, ordersYesterday: 0, sales: [], latestOrders: [], setup, ...over })

const show = async (handlers: Handlers, permissions: string[] = owner, role = 'owner') => {
  const { client } = fakeApi({
    'acting { permissions': () => access(permissions),
    '{ storeInfo { country } storeLocale': () => ({ storeInfo: { country: 'IN' }, storeLocale: { pricingCurrency: 'INR', mainLanguage: 'en' } }),
    ...handlers,
  })
  mockSession.client = client
  const renderer = await renderShell(<HomeScreen />, { acting: actingAs(role) })
  await settle()
  return renderer
}

const asHome = (home: unknown): Handlers => ({ '{ home {': () => ({ home }) })
const hasMoney = (renderer: ReactTestRenderer) => texts(renderer).some((text) => text.includes('₹'))

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
})

describe('Home picks homeApp or PortalHome from the API’s answer', () => {
  it('draws homeApp for a store with orders: sales, Needs you with counts, Add a product and the three latest orders', async () => {
    const renderer = await show(asHome(homeOf()))

    expect(texts(renderer)).toEqual(
      expect.arrayContaining(['Sales yesterday', '₹4,250.00', '3 orders today', 'Needs you', 'Orders to ship', 'Products to approve', 'Low on stock', 'Latest orders', 'See all', 'Customer 1', 'Customer 2', 'Customer 3', 'KT-1']),
    )
    expect(hasText(renderer, '1 partly shipped')).toBe(true)
    expect(hasText(renderer, 'Linen kurta and Silk saree')).toBe(true)
    expect(pressablesNamed(renderer, 'Add a product')).toHaveLength(1)
    expect(hasText(renderer, 'Get your shop ready')).toBe(false)
  })

  it('opens the list that holds each count, and an order on its own screen', async () => {
    const renderer = await show(asHome(homeOf()))

    await press(pressableNamed(renderer, 'Orders to ship: 4'))
    await press(pressableNamed(renderer, 'Products to approve: 2'))
    await press(pressableNamed(renderer, 'Low on stock: 2'))
    await press(pressableNamed(renderer, 'Open order KT-2'))
    await press(pressableNamed(renderer, 'See all'))
    await press(pressableNamed(renderer, 'Add a product'))

    // Each Needs you press is a new visit, so a list open on its tab starts on the chip again.
    expect(mockPush.mock.calls.map(([href]) => href)).toEqual([
      expect.stringMatching(/^\/orders\?filter=TO_SHIP&visit=\d+$/),
      expect.stringMatching(/^\/catalogue\?filter=pending&visit=\d+$/),
      expect.stringMatching(/^\/catalogue\?filter=low_stock&visit=\d+$/),
      '/orders/2',
      '/orders',
      '/catalogue/new',
    ])
  })

  it('draws PortalHome for a new store: the greeting and the checklist, not the sales', async () => {
    const renderer = await show(asHome(newStore({ products: false, collections: false, payments: false, shipping: false })))

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Get your shop ready for its first order', '1 of 5', 'Confirm your country, currency and language', 'India · INR · English', 'Add your first product', 'Choose how you ship']))
    expect(hasText(renderer, 'Good ')).toBe(true)
    expect(hasText(renderer, 'Sales yesterday')).toBe(false)
    expect(hasText(renderer, 'Latest orders')).toBe(false)

    await press(pressableNamed(renderer, 'Add your first product: Add'))
    await press(pressableNamed(renderer, 'Choose how shoppers pay: Set up'))
    expect(mockPush.mock.calls.map(([href]) => href)).toEqual(['/catalogue/new', '/more/settings/payments'])
  })

  it('draws homeApp once the seat is told a product exists, though nothing has been ordered', async () => {
    const renderer = await show(asHome(newStore({ products: true, collections: false, payments: false, shipping: false })))

    expect(hasText(renderer, 'Sales yesterday')).toBe(true)
    expect(hasText(renderer, 'Get your shop ready')).toBe(false)
    expect(hasText(renderer, 'All caught up.')).toBe(true)
  })

  it('tells Staff of a new store it is still being set up, and a Manager that payments are the owner’s', async () => {
    const staffHome = await show(asHome(newStore({ products: null, collections: null, payments: null, shipping: null })), staff, 'staff')
    expect(hasText(staffHome, 'No orders yet')).toBe(true)
    expect(hasText(staffHome, 'Get your shop ready')).toBe(false)

    const managerHome = await show(asHome(newStore({ products: false, collections: false, payments: null, shipping: null })), manager, 'manager')
    expect(hasText(managerHome, 'Get your shop ready for its first order')).toBe(true)
    expect(hasText(managerHome, 'set by the store owner')).toBe(true)
    expect(hasText(managerHome, 'Confirm your country')).toBe(false)
    expect(hasText(managerHome, 'Choose how shoppers pay')).toBe(false)
  })

  it('draws a skeleton while it loads', async () => {
    let release: () => void = () => undefined
    const pending = new Promise<unknown>((resolve) => (release = () => resolve({ home: homeOf() })))
    const renderer = await show({ '{ home {': () => pending })

    expect(renderer.root.findAll((node) => node.props.accessibilityRole === 'progressbar').length).toBeGreaterThan(0)
    release()
    await settle()
    expect(hasText(renderer, 'Needs you')).toBe(true)
  })
})

describe('Home’s designed states', () => {
  it('says it could not load, quotes no reference of its own, and tries again', async () => {
    let failing = true
    const renderer = await show({
      '{ home {': () => {
        if (failing) throw new ApiError('NO_RESPONSE', 'down')
        return { home: homeOf() }
      },
    })

    expect(hasText(renderer, 'We couldn’t load Home')).toBe(true)
    expect(hasText(renderer, 'Ref ')).toBe(false)
    failing = false
    await press(pressableNamed(renderer, 'Try again'))
    await settle()
    expect(hasText(renderer, 'Needs you')).toBe(true)
  })

  it('says the page isn’t here when the API answers no home', async () => {
    const renderer = await show(asHome(null))

    expect(hasText(renderer, 'This page isn’t here any more')).toBe(true)
    expect(hasText(renderer, 'Needs you')).toBe(false)
  })

  it('says it is offline, not that it could not load, when there is no answer and no connection', async () => {
    const renderer = await show({
      '{ home {': () => {
        throw new ApiError('NO_RESPONSE', 'down')
      },
    })
    expect(hasText(renderer, 'We couldn’t load Home')).toBe(true)

    await act(async () => mockNet.listener?.({ isConnected: false, isInternetReachable: false }))
    try {
      expect(hasText(renderer, 'Check your connection')).toBe(true)
      expect(hasText(renderer, 'We couldn’t load Home')).toBe(false)
    } finally {
      await act(async () => mockNet.listener?.({ isConnected: true, isInternetReachable: true }))
    }
  })
})

describe('Home withholds what the API withholds', () => {
  it('shows Staff no sales figure: today’s orders where the sales would be, and the items where a total would be', async () => {
    const renderer = await show(asHome(homeOf({ sales: null, awaitingApproval: null, latestOrders: [order('1', { total: null })] })), staff, 'staff')

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Orders today', '3', '5 yesterday', '3 items']))
    expect(hasText(renderer, 'Sales yesterday')).toBe(false)
    expect(hasMoney(renderer)).toBe(false)
    expect(hasText(renderer, 'Products to approve')).toBe(false)
    expect(pressablesNamed(renderer, 'Add a product')).toHaveLength(0)
  })

  it('shows a figure a currency when the store sold in more than one', async () => {
    const renderer = await show(asHome(homeOf({ sales: [{ yesterday: inr('425000') }, { yesterday: { amount: '1250', currency: 'USD' } }] })))

    expect(texts(renderer)).toEqual(expect.arrayContaining(['₹4,250.00', '$12.50']))
  })
})

describe('Needs you', () => {
  it('says "All caught up" when nothing waits, and leaves the list out', async () => {
    const renderer = await show(asHome(homeOf({ toShip: 0, awaitingApproval: 0, lowStock: { count: 0, names: [] } })))

    expect(hasText(renderer, 'All caught up.')).toBe(true)
    expect(hasText(renderer, 'Nothing to ship or approve right now.')).toBe(true)
    expect(hasText(renderer, 'Needs you')).toBe(false)
  })
})
