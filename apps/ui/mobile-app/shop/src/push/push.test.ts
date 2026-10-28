import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { t } from '../messages'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { askAndRegister, hasAsked, markAsked, orderOfPush, pushIsSetUp, pushPermission, registerIfGranted, registerThisPhone, unregisterThisPhone } from './push'

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))
jest.mock('@dripfunnel/mobile-shared/brand', () => ({ storeHost: () => 'acme.my-store.one' }))

// The phone's keystore, in memory.
const mockKeystore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  getItemAsync: (key: string) => Promise.resolve(mockKeystore.get(key) ?? null),
  setItemAsync: (key: string, value: string) => {
    mockKeystore.set(key, value)
    return Promise.resolve()
  },
  deleteItemAsync: (key: string) => {
    mockKeystore.delete(key)
    return Promise.resolve()
  },
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
const ask = jest.mocked(Notifications.requestPermissionsAsync)
const tokenOf = jest.mocked(Notifications.getExpoPushTokenAsync)
const channel = jest.mocked(Notifications.setNotificationChannelAsync)

type Sent = { query: string; variables: Record<string, unknown> | undefined }
const client = (): ApiClient & { sent: Sent[] } => {
  const sent: Sent[] = []
  return {
    sent,
    request: async <T,>(query: string, variables?: Record<string, unknown>): Promise<T> => {
      sent.push({ query, variables })
      return { registerPushDevice: true, unregisterPushDevice: true } as T
    },
  }
}

const status = (value: 'granted' | 'denied' | 'undetermined') => ({ status: value }) as Notifications.NotificationPermissionsStatus
const projectId = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

beforeEach(async () => {
  mockKeystore.clear()
  mockConfig.extra = { eas: { projectId } }
  jest.clearAllMocks()
  permissions.mockResolvedValue(status('undetermined'))
  ask.mockResolvedValue(status('granted'))
  tokenOf.mockResolvedValue({ type: 'expo', data: 'ExponentPushToken[abc]' })
  Platform.OS = 'ios'
  await jest.requireMock<{ clear: () => Promise<void> }>('@react-native-async-storage/async-storage').clear()
})

describe('a store that sets up no push', () => {
  beforeEach(() => {
    mockConfig.extra = {}
  })

  it('never asks for permission, registers a phone or touches the notifications SDK', async () => {
    const api = client()
    expect(pushIsSetUp()).toBe(false)
    expect(await pushPermission()).toBe('unavailable')
    expect(await askAndRegister(api, null)).toBe('unavailable')
    await registerIfGranted(api, null)
    await unregisterThisPhone(api)
    expect(api.sent).toHaveLength(0)
    expect(permissions).not.toHaveBeenCalled()
    expect(ask).not.toHaveBeenCalled()
    expect(tokenOf).not.toHaveBeenCalled()
  })
})

describe('turning notifications on', () => {
  it('asks the system, makes the Expo token for the store’s project, and registers the phone for the signed-in customer, naming no order', async () => {
    const api = client()
    expect(await askAndRegister(api, null)).toBe('registered')
    expect(ask).toHaveBeenCalledTimes(1)
    expect(tokenOf).toHaveBeenCalledWith({ projectId })
    expect(api.sent[0]?.variables).toEqual({ token: 'ExponentPushToken[abc]', platform: 'ios' })
  })

  it('registers a guest’s phone for the order, and keeps no token to remove at sign-out', async () => {
    const api = client()
    expect(await askAndRegister(api, 'o-1')).toBe('registered')
    expect(api.sent[0]?.variables).toEqual({ token: 'ExponentPushToken[abc]', platform: 'ios', orderId: 'o-1' })
    const out = client()
    await unregisterThisPhone(out)
    expect(out.sent).toHaveLength(0)
  })

  it('does not ask again for a permission already given', async () => {
    permissions.mockResolvedValue(status('granted'))
    expect(await askAndRegister(client(), null)).toBe('registered')
    expect(ask).not.toHaveBeenCalled()
  })

  it('registers nothing when the shopper says no', async () => {
    ask.mockResolvedValue(status('denied'))
    const api = client()
    expect(await askAndRegister(api, null)).toBe('denied')
    expect(api.sent).toHaveLength(0)
    expect(tokenOf).not.toHaveBeenCalled()
  })

  it('says it failed, rather than that it worked, when no token can be made or the API cannot be reached', async () => {
    tokenOf.mockRejectedValueOnce(new Error('no Firebase'))
    expect(await askAndRegister(client(), null)).toBe('failed')
    const api: ApiClient = { request: () => Promise.reject(new Error('offline')) }
    expect(await askAndRegister(api, null)).toBe('failed')
  })

  it('opens Android’s notification channel first, and says it is Android', async () => {
    Platform.OS = 'android'
    const api = client()
    await askAndRegister(api, null)
    expect(channel).toHaveBeenCalledWith('default', expect.objectContaining({ name: t('push.channel') }))
    expect(api.sent[0]?.variables).toMatchObject({ platform: 'android' })
  })

  it('is registered again quietly, never asked, only when permission is already given', async () => {
    const api = client()
    await registerIfGranted(api, null)
    expect(api.sent).toHaveLength(0)
    expect(ask).not.toHaveBeenCalled()
    permissions.mockResolvedValue(status('granted'))
    await registerIfGranted(api, null)
    expect(api.sent).toHaveLength(1)
  })

  it('never puts the token in a log', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    await registerThisPhone(client(), null)
    expect(JSON.stringify(log.mock.calls)).not.toContain('ExponentPushToken')
    log.mockRestore()
  })
})

describe('signing out', () => {
  it('removes the customer’s phone by its token, once, before the session goes', async () => {
    await registerThisPhone(client(), null)
    const api = client()
    await unregisterThisPhone(api)
    expect(api.sent[0]?.variables).toEqual({ token: 'ExponentPushToken[abc]' })
    const again = client()
    await unregisterThisPhone(again)
    expect(again.sent).toHaveLength(0)
  })
})

describe('signing out with no signal', () => {
  const failing = (): ApiClient & { attempts: number } => {
    const api = { attempts: 0, request: <T,>(): Promise<T> => { api.attempts += 1; return Promise.reject(new Error('offline')) } }
    return api
  }

  it('tries twice, keeps the token, and says it failed, so the next registration of this phone can move it', async () => {
    await registerThisPhone(client(), null)
    const offline = failing()
    await expect(unregisterThisPhone(offline)).rejects.toThrow('offline')
    expect(offline.attempts).toBe(2)
    const later = client()
    await unregisterThisPhone(later)
    expect(later.sent[0]?.variables).toEqual({ token: 'ExponentPushToken[abc]' })
  })

  it('is done by the second try when the first one failed', async () => {
    await registerThisPhone(client(), null)
    let tries = 0
    const flaky: ApiClient = { request: async <T,>(): Promise<T> => { tries += 1; if (tries === 1) throw new Error('blip'); return { unregisterPushDevice: true } as T } }
    await unregisterThisPhone(flaky)
    expect(tries).toBe(2)
    const again = client()
    await unregisterThisPhone(again)
    expect(again.sent).toHaveLength(0)
  })

  it('is replaced by the next sign-in’s own registration of this phone', async () => {
    await registerThisPhone(client(), null)
    tokenOf.mockResolvedValue({ type: 'expo', data: 'ExponentPushToken[new]' })
    await registerThisPhone(client(), null)
    const out = client()
    await unregisterThisPhone(out)
    expect(out.sent[0]?.variables).toEqual({ token: 'ExponentPushToken[new]' })
  })
})

describe('being asked', () => {
  it('is remembered once it has happened, so the shopper is asked once', async () => {
    expect(await hasAsked()).toBe(false)
    await markAsked()
    expect(await hasAsked()).toBe(true)
  })
})

describe('the order a push names', () => {
  it('is read from a customer message’s data, which holds only its kind and the order', () => {
    expect(orderOfPush({ kind: 'order.picked_up', orderId: 'o-1' })).toBe('o-1')
    expect(orderOfPush({ kind: 'order.rider_assigned', orderId: 'o-2' })).toBe('o-2')
  })

  it('is none for anything else: a rider’s message, no order, or data of another shape', () => {
    expect(orderOfPush({ kind: 'rider.offer', orderId: 'o-1' })).toBeNull()
    expect(orderOfPush({ kind: 'order.delivered' })).toBeNull()
    expect(orderOfPush({ kind: 'order.delivered', orderId: '' })).toBeNull()
    expect(orderOfPush('o-1')).toBeNull()
    expect(orderOfPush(undefined)).toBeNull()
  })
})
