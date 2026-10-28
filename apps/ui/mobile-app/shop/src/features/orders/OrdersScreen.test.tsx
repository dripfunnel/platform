import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { fakeShop, hasText, press, render } from '../../testing/harness'
import { summary } from '../../testing/orders'
import { OrdersScreen } from './OrdersScreen'

jest.setTimeout(60_000)

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))
const mockPush = jest.fn()
const mockReplace = jest.fn()
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => ({ push: mockPush, back: jest.fn(), replace: mockReplace, canGoBack: () => true }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  }
})
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))

const page = (nodes: object[], next: string | null = null) => ({ orderHistory: { nodes, pageInfo: { hasNextPage: next !== null, endCursor: next } }, store: { timeZone: 'Asia/Kolkata' } })

beforeEach(() => {
  mockPush.mockClear()
  mockReplace.mockClear()
})

describe('the orders list', () => {
  it('lists each order newest first with its number, date, items, status and total', async () => {
    const screen = await render(<OrdersScreen />, fakeShop(() => page([summary('1'), summary('2', { itemCount: 1, paymentState: 'pending', paymentMethod: 'cod' }), summary('3', { state: 'cancelled' })]), { signedIn: true }))
    expect(hasText(screen, t('orders.order', { number: 'ORD-1' }))).toBe(true)
    expect(hasText(screen, `Oct 27, 2026 · ${t('orders.items.other', { count: 2 })}`)).toBe(true)
    expect(hasText(screen, `Oct 27, 2026 · ${t('orders.items.one', { count: 1 })}`)).toBe(true)
    expect(hasText(screen, t('orders.status.paid'))).toBe(true)
    expect(hasText(screen, t('orders.status.payOnDelivery'))).toBe(true)
    expect(hasText(screen, t('orders.status.cancelled'))).toBe(true)
    expect(hasText(screen, '₹1,946.00')).toBe(true)
  })

  it('opens an order when it is pressed', async () => {
    const screen = await render(<OrdersScreen />, fakeShop(() => page([summary('1')]), { signedIn: true }))
    const label = [t('orders.order', { number: 'ORD-1' }), `Oct 27, 2026 · ${t('orders.items.other', { count: 2 })}`, t('orders.status.paid'), '₹1,946.00'].join(', ')
    await press(screen, label)
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/orders/[id]', params: { id: '1' } })
  })

  it('shows more orders by the cursor, adds them below, and offers no more after the last', async () => {
    const shop = fakeShop(({ variables }) => (variables?.['after'] ? page([summary('2')]) : page([summary('1')], 'cursor-2')), { signedIn: true })
    const screen = await render(<OrdersScreen />, shop)
    expect(hasText(screen, 'ORD-2')).toBe(false)
    await press(screen, t('orders.more'))
    expect(shop.requests.at(-1)?.variables).toEqual({ first: 20, after: 'cursor-2' })
    expect(hasText(screen, 'ORD-1')).toBe(true)
    expect(hasText(screen, 'ORD-2')).toBe(true)
    expect(hasText(screen, t('orders.more'))).toBe(false)
  })

  it('says so when there are none, with a way to start shopping', async () => {
    const screen = await render(<OrdersScreen />, fakeShop(() => page([]), { signedIn: true }))
    expect(hasText(screen, t('orders.empty.title'))).toBe(true)
    await press(screen, t('orders.empty.action'))
    expect(mockPush).toHaveBeenCalledWith('/home')
  })

  it('asks a guest to sign in, and asks the API for nothing', async () => {
    const shop = fakeShop(() => page([]), { signedIn: false })
    const screen = await render(<OrdersScreen />, shop)
    expect(hasText(screen, t('orders.guest.title'))).toBe(true)
    await press(screen, t('orders.guest.action'))
    expect(mockPush).toHaveBeenCalledWith('/sign-in')
    expect(shop.requests).toHaveLength(0)
  })

  it('has its error and offline states, each with a way to try again', async () => {
    const failing = await render(<OrdersScreen />, fakeShop(() => { throw new ApiError('SERVER', 'x') }, { signedIn: true }))
    expect(hasText(failing, t('states.error.title'))).toBe(true)
    expect(hasText(failing, t('states.retry'))).toBe(true)

    const offline = await render(<OrdersScreen />, fakeShop(() => { throw new ApiError('NO_RESPONSE', 'x') }, { signedIn: true }))
    expect(hasText(offline, t('states.offline.title'))).toBe(true)
  })

  it('keeps nothing for offline: a list of orders holds the shopper’s details', async () => {
    const shop = fakeShop(() => page([summary('1')]), { signedIn: true })
    await render(<OrdersScreen />, shop)
    const AsyncStorage = jest.requireMock<{ getAllKeys: () => Promise<string[]> }>('@react-native-async-storage/async-storage')
    expect((await AsyncStorage.getAllKeys()).filter((key) => key.includes('order'))).toEqual([])
  })
})
