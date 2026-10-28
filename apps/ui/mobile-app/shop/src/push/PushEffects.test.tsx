import * as Notifications from 'expo-notifications'
import { act } from 'react-test-renderer'
import { fakeShop, render } from '../testing/harness'
import { PushEffects } from './PushEffects'

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))
jest.mock('../graphql/storeHost', () => ({ storeHost: () => 'acme.my-store.one' }))
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'x',
  getItemAsync: () => Promise.resolve(null),
  setItemAsync: () => Promise.resolve(),
  deleteItemAsync: () => Promise.resolve(),
}))

const mockPush = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }))

const mockConfig: { extra: Record<string, unknown> } = { extra: {} }
jest.mock('expo-constants', () => ({ __esModule: true, default: { get expoConfig() { return { name: 'Dev Shop', extra: mockConfig.extra } } } }))
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  getPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
  getLastNotificationResponse: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
}))

const permissions = jest.mocked(Notifications.getPermissionsAsync)
const handler = jest.mocked(Notifications.setNotificationHandler)
const lastResponse = jest.mocked(Notifications.getLastNotificationResponse)
const listen = jest.mocked(Notifications.addNotificationResponseReceivedListener)
const tokenOf = jest.mocked(Notifications.getExpoPushTokenAsync)
const remove = jest.fn()
let tapped: ((response: Notifications.NotificationResponse) => void) | null = null

const tap = (data: unknown, identifier = 'n-1') => ({ notification: { request: { identifier, content: { data } } } }) as unknown as Notifications.NotificationResponse
const projectId = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

beforeEach(() => {
  jest.clearAllMocks()
  mockConfig.extra = { eas: { projectId } }
  tapped = null
  remove.mockClear()
  lastResponse.mockReturnValue(null)
  listen.mockImplementation((listener) => {
    tapped = listener
    return { remove } as never
  })
  permissions.mockResolvedValue({ status: 'undetermined' } as Notifications.NotificationPermissionsStatus)
  tokenOf.mockResolvedValue({ type: 'expo', data: 'ExponentPushToken[abc]' })
})

describe('a push tapped', () => {
  it('opens that order’s tracking, for the customer’s message about it', async () => {
    await render(<PushEffects />, fakeShop(() => ({}), { signedIn: true }))
    await act(async () => tapped?.(tap({ kind: 'order.picked_up', orderId: 'o-1' })))
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/orders/[id]/track', params: { id: 'o-1' } })
  })

  it('opens the order the app was launched from, once', async () => {
    lastResponse.mockReturnValue(tap({ kind: 'order.delivered', orderId: 'o-7' }, 'launch-1'))
    await render(<PushEffects />, fakeShop(() => ({}), { signedIn: true }))
    await render(<PushEffects />, fakeShop(() => ({}), { signedIn: true }))
    expect(mockPush).toHaveBeenCalledTimes(1)
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/orders/[id]/track', params: { id: 'o-7' } })
  })

  it('opens nothing for a message that names no order, or is not a customer’s', async () => {
    await render(<PushEffects />, fakeShop(() => ({}), { signedIn: true }))
    await act(async () => tapped?.(tap({ kind: 'rider.offer', orderId: 'o-1' }, 'n-2')))
    await act(async () => tapped?.(tap({ kind: 'order.delivered' }, 'n-3')))
    await act(async () => tapped?.(tap(null, 'n-4')))
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('stops listening when the app’s root goes away, and shows pushes while the app is open', async () => {
    const screen = await render(<PushEffects />, fakeShop(() => ({}), { signedIn: true }))
    expect(handler).toHaveBeenCalledTimes(1)
    await act(async () => screen.unmount())
    expect(remove).toHaveBeenCalled()
  })
})

describe('the phone’s registration at start', () => {
  it('is made again quietly for a signed-in customer who has already allowed notifications', async () => {
    permissions.mockResolvedValue({ status: 'granted' } as Notifications.NotificationPermissionsStatus)
    const shop = fakeShop(() => ({ registerPushDevice: true }), { signedIn: true })
    await render(<PushEffects />, shop)
    expect(shop.requests.map((r) => r.variables)).toEqual([{ token: 'ExponentPushToken[abc]', platform: 'ios' }])
  })

  it('asks for nothing, and registers nothing, for a customer who has not allowed them', async () => {
    const shop = fakeShop(() => ({}), { signedIn: true })
    await render(<PushEffects />, shop)
    expect(shop.requests).toHaveLength(0)
    expect(tokenOf).not.toHaveBeenCalled()
  })

  it('is left to each order for a guest, so nothing is registered at start', async () => {
    permissions.mockResolvedValue({ status: 'granted' } as Notifications.NotificationPermissionsStatus)
    const shop = fakeShop(() => ({}), { signedIn: false })
    await render(<PushEffects />, shop)
    expect(shop.requests).toHaveLength(0)
  })
})

describe('a store that sets up no push', () => {
  it('leaves the notifications SDK alone at launch', async () => {
    mockConfig.extra = {}
    await render(<PushEffects />, fakeShop(() => ({}), { signedIn: true }))
    expect(handler).not.toHaveBeenCalled()
    expect(listen).not.toHaveBeenCalled()
    expect(lastResponse).not.toHaveBeenCalled()
    expect(permissions).not.toHaveBeenCalled()
  })
})
