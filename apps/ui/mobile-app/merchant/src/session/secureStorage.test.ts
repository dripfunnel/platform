import AsyncStorage from '@react-native-async-storage/async-storage'
import { secureStorage, within } from './secureStorage'

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))

// The phone's keystore, in memory, and a way to make it fail the way the Android emulator's does.
const mockKeystore = new Map<string, string>()
const mockFailures = { deletes: 0, writes: 0, reads: 0 }

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  getItemAsync: (key: string) => (mockFailures.reads > 0 ? Promise.reject(new Error('KeyStoreException')) : Promise.resolve(mockKeystore.get(key) ?? null)),
  setItemAsync: (key: string, value: string) => {
    if (mockFailures.writes > 0) return Promise.reject(new Error('KeyStoreException'))
    mockKeystore.set(key, value)
    return Promise.resolve()
  },
  deleteItemAsync: (key: string) => {
    if (mockFailures.deletes > 0) {
      mockFailures.deletes -= 1
      return Promise.reject(new Error('KeyStoreException'))
    }
    mockKeystore.delete(key)
    return Promise.resolve()
  },
}))

describe('a storage that may fail', () => {
  it('gives the answer when the keystore answers', async () => {
    await expect(within(Promise.resolve('t0ken'), null)).resolves.toBe('t0ken')
  })

  it('gives the fallback, not an error, when the keystore fails', async () => {
    await expect(within(Promise.reject(new Error('KeyStoreException')), null)).resolves.toBeNull()
  })

  it('gives the fallback when the keystore never answers', async () => {
    jest.useFakeTimers()
    try {
      const result = within(new Promise<string | null>(() => undefined), null, 1000)
      await jest.advanceTimersByTimeAsync(1000)
      await expect(result).resolves.toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('the saved session', () => {
  const storage = secureStorage('store.example.com')

  beforeEach(async () => {
    mockKeystore.clear()
    mockFailures.deletes = 0
    mockFailures.writes = 0
    mockFailures.reads = 0
    await AsyncStorage.clear()
  })

  it('is read back after it was saved, with the last store', async () => {
    await storage.writeToken('t0ken')
    await storage.writeLast({ storeId: 'a', supplierId: null, storeName: 'Juniper & Co.' })
    await expect(storage.read()).resolves.toEqual({ token: 't0ken', last: { storeId: 'a', supplierId: null, storeName: 'Juniper & Co.' } })
  })

  it('is gone after a sign-out', async () => {
    await storage.writeToken('t0ken')
    await storage.wipe()
    await expect(storage.read()).resolves.toEqual({ token: null, last: null })
    expect(mockKeystore.size).toBe(0)
  })

  it('tries the removal again when the keystore fails once', async () => {
    await storage.writeToken('t0ken')
    mockFailures.deletes = 1

    await storage.wipe()

    expect(mockKeystore.has('df.session.store.example.com.token')).toBe(false)
    expect(await AsyncStorage.getItem('df.session.store.example.com.revoked')).toBeNull()
  })

  it('stays signed out when the keystore cannot remove the token, and never uses the token it left behind', async () => {
    await storage.writeToken('t0ken')
    mockFailures.deletes = 100

    await storage.wipe()

    expect(mockKeystore.get('df.session.store.example.com.token')).toBe('t0ken')
    await expect(storage.read()).resolves.toEqual({ token: null, last: null })
  })

  it('removes the left-behind token once the keystore works again, and signs in as normal after that', async () => {
    await storage.writeToken('t0ken')
    mockFailures.deletes = 100
    await storage.wipe()
    mockFailures.deletes = 0

    await expect(storage.read()).resolves.toEqual({ token: null, last: null })

    expect(mockKeystore.has('df.session.store.example.com.token')).toBe(false)
    expect(await AsyncStorage.getItem('df.session.store.example.com.revoked')).toBeNull()
  })

  it('lets a new sign-in replace the left-behind token and clears the sign-out mark', async () => {
    await storage.writeToken('old-token')
    mockFailures.deletes = 100
    await storage.wipe()

    await storage.writeToken('new-token')

    await expect(storage.read()).resolves.toMatchObject({ token: 'new-token' })
  })

  it('treats an unreadable keystore as no saved session', async () => {
    await storage.writeToken('t0ken')
    mockFailures.reads = 1
    await expect(storage.read()).resolves.toEqual({ token: null, last: null })
  })
})
