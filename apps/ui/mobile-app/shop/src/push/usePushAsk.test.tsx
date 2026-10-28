import * as Notifications from 'expo-notifications'
import { Text } from 'react-native'
import { t } from '../messages'
import { fakeShop, hasText, press, render } from '../testing/harness'
import { PushOffer } from './PushOffer'
import { hasAsked } from './push'
import { usePushAsk } from './usePushAsk'

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))
jest.mock('@dripfunnel/mobile-shared/brand', () => ({ ...jest.requireActual('@dripfunnel/mobile-shared/brand'), storeHost: () => 'acme.my-store.one' }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'x',
  getItemAsync: () => Promise.resolve(null),
  setItemAsync: () => Promise.resolve(),
  deleteItemAsync: () => Promise.resolve(),
}))

const mockConfig: { extra: Record<string, unknown> } = { extra: {} }
jest.mock('expo-constants', () => ({ __esModule: true, default: { get expoConfig() { return { name: 'Dev Shop', extra: mockConfig.extra } } } }))
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
}))

const permissions = jest.mocked(Notifications.getPermissionsAsync)
const request = jest.mocked(Notifications.requestPermissionsAsync)
const tokenOf = jest.mocked(Notifications.getExpoPushTokenAsync)
const status = (value: 'granted' | 'denied' | 'undetermined') => ({ status: value }) as Notifications.NotificationPermissionsStatus
const projectId = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

function Offer({ orderId, guest }: { orderId: string; guest: boolean }) {
  const ask = usePushAsk(orderId, guest)
  return ask.show ? <PushOffer ask={ask} /> : <Text>hidden</Text>
}

beforeEach(async () => {
  jest.clearAllMocks()
  mockConfig.extra = { eas: { projectId } }
  permissions.mockResolvedValue(status('undetermined'))
  request.mockResolvedValue(status('granted'))
  tokenOf.mockResolvedValue({ type: 'expo', data: 'ExponentPushToken[abc]' })
  await jest.requireMock<{ clear: () => Promise<void> }>('@react-native-async-storage/async-storage').clear()
})

describe('the offer to turn notifications on, after an order', () => {
  it('is made once, in plain words about what is and is not in a notification', async () => {
    const screen = await render(<Offer orderId="o-1" guest={false} />, fakeShop(() => ({ registerPushDevice: true }), { signedIn: true }))
    expect(hasText(screen, t('push.title'))).toBe(true)
    expect(hasText(screen, 'handover code, address or amounts')).toBe(true)
    expect(request).not.toHaveBeenCalled()
  })

  it('registers the customer’s phone, naming no order, when it is accepted, and is not made again', async () => {
    const shop = fakeShop(() => ({ registerPushDevice: true }), { signedIn: true })
    const screen = await render(<Offer orderId="o-1" guest={false} />, shop)
    await press(screen, t('push.allow'))
    expect(request).toHaveBeenCalledTimes(1)
    expect(shop.requests.map((r) => r.variables)).toEqual([{ token: 'ExponentPushToken[abc]', platform: 'ios' }])
    expect(hasText(screen, 'hidden')).toBe(true)
    expect(await hasAsked()).toBe(true)
    const again = await render(<Offer orderId="o-2" guest={false} />, fakeShop(() => ({}), { signedIn: true }))
    expect(hasText(again, 'hidden')).toBe(true)
  })

  it('registers a guest’s phone for the order, read with the token kept for it', async () => {
    const shop = fakeShop(() => ({ registerPushDevice: true }), { signedIn: false })
    const screen = await render(<Offer orderId="o-1" guest />, shop)
    await press(screen, t('push.allow'))
    expect(shop.requests[0]?.variables).toEqual({ token: 'ExponentPushToken[abc]', platform: 'ios', orderId: 'o-1' })
  })

  it('goes away, and is not made again, when the shopper says not now', async () => {
    const screen = await render(<Offer orderId="o-1" guest={false} />, fakeShop(() => ({}), { signedIn: true }))
    await press(screen, t('push.later'))
    expect(hasText(screen, 'hidden')).toBe(true)
    expect(request).not.toHaveBeenCalled()
    expect(await hasAsked()).toBe(true)
  })

  it('goes away when the shopper refuses the system’s prompt, with nothing registered', async () => {
    request.mockResolvedValue(status('denied'))
    const shop = fakeShop(() => ({}), { signedIn: true })
    const screen = await render(<Offer orderId="o-1" guest={false} />, shop)
    await press(screen, t('push.allow'))
    expect(hasText(screen, 'hidden')).toBe(true)
    expect(shop.requests).toHaveLength(0)
  })

  it('stays, saying it could not, when the registration fails, so the shopper can try again', async () => {
    tokenOf.mockRejectedValueOnce(new Error('no Firebase'))
    const screen = await render(<Offer orderId="o-1" guest={false} />, fakeShop(() => ({}), { signedIn: true }))
    await press(screen, t('push.allow'))
    expect(hasText(screen, t('push.failed'))).toBe(true)
    expect(await hasAsked()).toBe(false)
  })

  it('is not made to a shopper who has refused notifications already, or been asked before', async () => {
    permissions.mockResolvedValue(status('denied'))
    expect(hasText(await render(<Offer orderId="o-1" guest={false} />, fakeShop(() => ({}), { signedIn: true })), 'hidden')).toBe(true)
    permissions.mockResolvedValue(status('undetermined'))
    await jest.requireMock<{ setItem: (k: string, v: string) => Promise<void> }>('@react-native-async-storage/async-storage').setItem('df.push.asked.acme.my-store.one', '1')
    expect(hasText(await render(<Offer orderId="o-1" guest={false} />, fakeShop(() => ({}), { signedIn: true })), 'hidden')).toBe(true)
  })

  it('registers a guest’s phone for a new order without asking, when notifications are already allowed', async () => {
    permissions.mockResolvedValue(status('granted'))
    const shop = fakeShop(() => ({ registerPushDevice: true }), { signedIn: false })
    const screen = await render(<Offer orderId="o-3" guest />, shop)
    expect(hasText(screen, 'hidden')).toBe(true)
    expect(request).not.toHaveBeenCalled()
    expect(shop.requests[0]?.variables).toMatchObject({ orderId: 'o-3' })
  })

  it('registers nothing for a signed-in customer who has already allowed them: their phone is theirs for every order', async () => {
    permissions.mockResolvedValue(status('granted'))
    const shop = fakeShop(() => ({}), { signedIn: true })
    await render(<Offer orderId="o-3" guest={false} />, shop)
    expect(shop.requests).toHaveLength(0)
  })

  it('is never made, and touches nothing, for a store that sets up no push', async () => {
    mockConfig.extra = {}
    const screen = await render(<Offer orderId="o-1" guest={false} />, fakeShop(() => ({}), { signedIn: true }))
    expect(hasText(screen, 'hidden')).toBe(true)
    expect(permissions).not.toHaveBeenCalled()
  })
})
