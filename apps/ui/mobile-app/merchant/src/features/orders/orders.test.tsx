import { act } from 'react-test-renderer'
import { ApiError, type ApiClient } from '../../graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { actingAs, fakeClient, hasText, press, pressableNamed, renderShell, texts } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { OrdersScreen } from './OrdersScreen'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockPush = jest.fn()
const mockShare = jest.fn<Promise<boolean>, [string, string]>(async () => true)
const mockSession: { client: ApiClient | null } = { client: null }
const mockNet: { listener: ((state: { isConnected: boolean; isInternetReachable: boolean }) => void) | null } = { listener: null }

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, navigate: jest.fn(), back: jest.fn() }) }))
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
jest.mock('../common/shareCsv', () => ({ shareCsv: (title: string, csv: string) => mockShare(title, csv) }))
jest.mock('../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))

// The fake network answers over several promise turns; jest-expo runs timers faked, so wait on promises, not on a timer.
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

const row = (id: string, number: string, over: Record<string, unknown> = {}) => ({
  id,
  number,
  placedAt: '2026-10-10T09:30:00Z',
  state: 'placed',
  paymentState: 'paid',
  fulfilmentState: 'unfulfilled',
  paymentMethod: 'razorpay',
  total: { amount: '489700', currency: 'INR' },
  test: false,
  customerName: 'Ananya Rao',
  city: 'Bengaluru',
  items: 3,
  ...over,
})

const counts = (over: Record<string, number> = {}) => ({ all: 0, toShip: 0, partlyShipped: 0, shipped: 0, cancelledRefunded: 0, paymentPending: 0, ...over })
const page = (nodes: unknown[], next: string | null = null) => ({ orders: { nodes, pageInfo: { hasNextPage: next !== null, hasPreviousPage: false, startCursor: null, endCursor: next } } })
const access = (permissions: string[], seller: { id: string } | null = null) => ({ me: { acting: { permissions, seller } } })
const zone = { storeInfo: { timeZone: 'Asia/Kolkata' } }

const staff = ['orders.read', 'orders.write', 'orders.fulfil', 'exports', 'customers.read']
const owner = [...staff, 'orders.refund', 'orders.mark_paid', 'shipping.configure']
const readOnlyState = { readOnly: true, status: null, trialEndsAt: null, pastDueSince: null, provisioning: null, support: null }

type Handlers = Record<string, (variables: Record<string, unknown>, headers: Record<string, string>) => unknown>

const show = async (handlers: Handlers, options: Parameters<typeof renderShell>[1] = {}) => {
  const { client, calls } = fakeApi({ storeInfo: () => zone, ...handlers })
  mockSession.client = client
  const renderer = await renderShell(<OrdersScreen />, options)
  await settle()
  return { renderer, calls }
}

const listCalls = (calls: Call[]) => calls.filter((call) => call.query.includes('orders(filter'))

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
})

describe('the Orders list', () => {
  it('lists each order as a card with what the API said, in the store’s zone, and opens one', async () => {
    const { renderer } = await show({
      'acting { permissions': () => access(owner),
      orderCounts: () => ({ orderCounts: counts({ all: 2, toShip: 1 }) }),
      'orders(filter': () => page([row('o-1', 'KT-1042'), row('o-2', 'KT-1041', { customerName: null, city: null, paymentState: 'pending', total: { amount: '249900', currency: 'INR' }, items: 1, fulfilmentState: 'fulfilled' })]),
    })

    expect(texts(renderer)).toEqual(expect.arrayContaining(['KT-1042', 'Ananya Rao · Bengaluru', '3 items', '₹4,897.00', 'paid', 'To ship', 'KT-1041', 'Guest', '1 item', '₹2,499.00', 'payment pending', 'Shipped']))
    expect(hasText(renderer, 'Oct 10, 2026, 15:00 GMT+5:30')).toBe(true)
    expect(hasText(renderer, '2 orders · 1 to ship')).toBe(true)
    await press(pressableNamed(renderer, 'Open order KT-1042'))
    expect(mockPush).toHaveBeenCalledWith('/orders/o-1')
  })

  it('shows the status chips with the API’s counts, and asks the API again when one is chosen', async () => {
    const { renderer, calls } = await show({
      'acting { permissions': () => access(owner),
      orderCounts: () => ({ orderCounts: counts({ all: 9, toShip: 4, partlyShipped: 1, shipped: 3, cancelledRefunded: 1, paymentPending: 2 }) }),
      'orders(filter': () => page([row('o-1', 'KT-1042')]),
    })

    expect(texts(renderer)).toEqual(expect.arrayContaining(['✓ All', '9', 'To ship', '4', 'Partly shipped', '1', 'Shipped', '3', 'Cancelled & refunded', 'Payment pending', '2']))
    expect(listCalls(calls).at(-1)?.variables).toMatchObject({ filter: 'ALL', search: null })
    await press(pressableNamed(renderer, 'To ship4'))
    await settle()
    expect(listCalls(calls).at(-1)?.variables.filter).toBe('TO_SHIP')
    await press(pressableNamed(renderer, 'Payment pending2'))
    await settle()
    expect(listCalls(calls).at(-1)?.variables.filter).toBe('PAYMENT_PENDING')
  })

  it('opens on the chip it was sent to', async () => {
    const { client, calls } = fakeApi({ storeInfo: () => zone, 'acting { permissions': () => access(owner), orderCounts: () => ({ orderCounts: counts({ all: 2, toShip: 2 }) }), 'orders(filter': () => page([row('o-1', 'KT-1042')]) })
    mockSession.client = client
    await renderShell(<OrdersScreen initialFilter="TO_SHIP" />)
    await settle()
    expect(listCalls(calls)[0]?.variables.filter).toBe('TO_SHIP')
  })

  it('searches the API after typing stops, never in the app', async () => {
    jest.useFakeTimers()
    try {
      const { renderer, calls } = await show({
        'acting { permissions': () => access(owner),
        orderCounts: () => ({ orderCounts: counts({ all: 1 }) }),
        'orders(filter': () => page([row('o-1', 'KT-1042')]),
      })
      const field = renderer.root.findByProps({ accessibilityLabel: 'Search orders' })
      await act(async () => field.props.onChangeText('rohan'))
      expect(listCalls(calls).every((call) => call.variables.search === null)).toBe(true)
      await act(async () => void jest.advanceTimersByTime(400))
      await settle()
      expect(listCalls(calls).at(-1)?.variables.search).toBe('rohan')
    } finally {
      jest.useRealTimers()
    }
  })

  it('pages with Show more from the API’s cursor and keeps the first page', async () => {
    const seen: Array<string | null> = []
    const { renderer } = await show({
      'acting { permissions': () => access(owner),
      orderCounts: () => ({ orderCounts: counts({ all: 2 }) }),
      'orders(filter': (variables) => {
        seen.push(variables.after as string | null)
        return variables.after ? page([row('o-2', 'KT-1041')]) : page([row('o-1', 'KT-1042')], 'cursor-1')
      },
    })

    await press(pressableNamed(renderer, 'Show more'))
    await settle()
    expect(seen).toEqual([null, 'cursor-1'])
    expect(hasText(renderer, 'KT-1042')).toBe(true)
    expect(hasText(renderer, 'KT-1041')).toBe(true)
    expect(hasText(renderer, 'Show more')).toBe(false)
  })
})

describe('the states', () => {
  it('says a new store has no orders yet, with no filters to use and no Export', async () => {
    const { renderer } = await show({ 'acting { permissions': () => access(owner), orderCounts: () => ({ orderCounts: counts() }), 'orders(filter': () => page([]) })

    expect(hasText(renderer, 'No orders yet')).toBe(true)
    expect(hasText(renderer, 'Search orders')).toBe(false)
    expect(hasText(renderer, 'Export')).toBe(false)
  })

  it('says nothing matches a filter, and clears it', async () => {
    const { renderer } = await show({
      'acting { permissions': () => access(owner),
      orderCounts: () => ({ orderCounts: counts({ all: 3, paymentPending: 1 }) }),
      'orders(filter': (variables) => page(variables.filter === 'PAYMENT_PENDING' ? [] : [row('o-1', 'KT-1042')]),
    })

    await press(pressableNamed(renderer, 'Payment pending1'))
    await settle()
    expect(hasText(renderer, 'No orders here')).toBe(true)
    await press(pressableNamed(renderer, 'Show all orders'))
    await settle()
    expect(hasText(renderer, 'KT-1042')).toBe(true)
  })

  it('draws a skeleton while the list is on its way', async () => {
    let release: (value: unknown) => void = () => undefined
    const { renderer } = await show({
      'acting { permissions': () => access(owner),
      orderCounts: () => ({ orderCounts: counts({ all: 1 }) }),
      'orders(filter': () => new Promise((resolve) => (release = resolve)),
    })

    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === 'Loading').length).toBeGreaterThan(0)
    await act(async () => release(page([row('o-1', 'KT-1042')])))
    await settle()
    expect(hasText(renderer, 'KT-1042')).toBe(true)
  })

  it('says it could not load, quotes no reference of its own, and tries again', async () => {
    let failing = true
    const { renderer } = await show({
      'acting { permissions': () => access(owner),
      orderCounts: () => ({ orderCounts: counts({ all: 1 }) }),
      'orders(filter': () => {
        if (failing) throw new ApiError('NO_RESPONSE', 'down')
        return page([row('o-1', 'KT-1042')])
      },
    })

    expect(hasText(renderer, 'We couldn’t load Orders')).toBe(true)
    expect(hasText(renderer, 'Ref ')).toBe(false)
    failing = false
    await press(pressableNamed(renderer, 'Try again'))
    await settle()
    expect(hasText(renderer, 'KT-1042')).toBe(true)
  })

  it('says it is offline, not that it could not load, when there is no answer and no connection', async () => {
    const { renderer } = await show({
      'acting { permissions': () => access(owner),
      orderCounts: () => ({ orderCounts: counts({ all: 1 }) }),
      'orders(filter': () => {
        throw new ApiError('NO_RESPONSE', 'down')
      },
    })
    expect(hasText(renderer, 'We couldn’t load Orders')).toBe(true)

    await act(async () => mockNet.listener?.({ isConnected: false, isInternetReachable: false }))
    try {
      expect(hasText(renderer, 'Check your connection')).toBe(true)
      expect(hasText(renderer, 'We couldn’t load Orders')).toBe(false)
    } finally {
      await act(async () => mockNet.listener?.({ isConnected: true, isInternetReachable: true }))
    }
  })

  it('says the seat has no access when it lacks orders.read, and asks for no orders', async () => {
    const { renderer, calls } = await show({ 'acting { permissions': () => access(['catalog.read']), orderCounts: () => ({ orderCounts: counts() }), 'orders(filter': () => page([]) })

    expect(hasText(renderer, 'You don’t have access to Orders')).toBe(true)
    expect(listCalls(calls)).toEqual([])
  })

  it('says a supplier’s seat has no access: its To ship is a later card', async () => {
    const { renderer } = await show({ 'acting { permissions': () => access(['orders.read', 'orders.fulfil'], { id: 's-1' }) }, { acting: actingAs('supplier-member', 'vendor-orders-fulfil') })
    expect(hasText(renderer, 'You don’t have access to Orders')).toBe(true)
  })

  it('says the seat has no access when the API refuses the list', async () => {
    const { renderer } = await show({
      'acting { permissions': () => access(owner),
      orderCounts: () => ({ orderCounts: counts() }),
      'orders(filter': () => {
        throw new ApiError('FORBIDDEN', 'no')
      },
    })
    expect(hasText(renderer, 'You don’t have access to Orders')).toBe(true)
  })

  it('still lists, and exports, while the store is read-only', async () => {
    const { renderer } = await show(
      { 'acting { permissions': () => access(owner), orderCounts: () => ({ orderCounts: counts({ all: 1 }) }), 'orders(filter': () => page([row('o-1', 'KT-1042')]) },
      { client: fakeClient({ state: readOnlyState }) },
    )
    expect(hasText(renderer, 'KT-1042')).toBe(true)
    expect(hasText(renderer, 'Export')).toBe(true)
  })
})

describe('Export', () => {
  const exportHandlers = (jobs: Array<Record<string, unknown>>): Handlers => ({
    'acting { permissions': () => access(staff),
    orderCounts: () => ({ orderCounts: counts({ all: 2, toShip: 1 }) }),
    'orders(filter': () => page([row('o-1', 'KT-1042')]),
    exportOrders: () => ({ exportOrders: 'job-1' }),
    orderExport: () => ({ orderExport: jobs.shift() }),
  })
  const job = (state: string, over: Record<string, unknown> = {}) => ({ id: 'job-1', state, rows: null, truncated: false, csv: null, expiresAt: null, ...over })

  it('asks for the list as filtered, follows the job, and hands the file to the share sheet when it is ready', async () => {
    jest.useFakeTimers()
    try {
      const { renderer, calls } = await show(exportHandlers([job('queued'), job('done', { rows: 2, csv: 'number,total\nKT-1042,4897.00\n' })]))

      await press(pressableNamed(renderer, 'To ship1'))
      await settle()
      await press(pressableNamed(renderer, 'Export'))
      await settle()
      expect(calls.find((call) => call.query.includes('exportOrders'))?.variables).toEqual({ filter: 'TO_SHIP', search: null })
      expect(hasText(renderer, 'Preparing your export…')).toBe(true)
      expect(mockShare).not.toHaveBeenCalled()

      for (let i = 0; i < 2; i += 1) {
        await act(async () => void (await jest.advanceTimersByTimeAsync(1600)))
        await settle()
      }
      expect(mockShare).toHaveBeenCalledTimes(1)
      expect(mockShare).toHaveBeenCalledWith('Orders export', 'number,total\nKT-1042,4897.00\n')
      expect(hasText(renderer, '2 lines are ready.')).toBe(true)

      await press(pressableNamed(renderer, 'Share the file'))
      expect(mockShare).toHaveBeenCalledTimes(2)
    } finally {
      jest.useRealTimers()
    }
  })

  it('says so when the export is too large, and shares nothing', async () => {
    jest.useFakeTimers()
    try {
      const { renderer } = await show(exportHandlers([job('too_large')]))
      await press(pressableNamed(renderer, 'Export'))
      await settle()
      await act(async () => void (await jest.advanceTimersByTimeAsync(1600)))
      await settle()
      expect(hasText(renderer, 'That export is too large. Narrow the filter and try again.')).toBe(true)
      expect(mockShare).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })

  it('says why when the export is refused, by its code', async () => {
    const { renderer } = await show({ ...exportHandlers([]), exportOrders: () => { throw new ApiError('FORBIDDEN', 'no') } })
    await press(pressableNamed(renderer, 'Export'))
    await settle()
    expect(hasText(renderer, 'You can’t do that with orders. Ask the store’s owner or a manager.')).toBe(true)
  })

  it('is absent for a seat without the exports permission', async () => {
    const { renderer } = await show({ ...exportHandlers([]), 'acting { permissions': () => access(['orders.read']) })
    expect(hasText(renderer, 'KT-1042')).toBe(true)
    expect(hasText(renderer, 'Export')).toBe(false)
  })
})
