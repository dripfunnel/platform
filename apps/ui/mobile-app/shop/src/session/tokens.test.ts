import { secureStorage } from '@dripfunnel/mobile-shared/storage'
import { loadTokens, shopHeaders } from './tokens'

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))

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

const save = (host: string, token: string) => secureStorage<null>(host, () => null).writeToken(token)

describe('the tokens kept on the phone', () => {
  beforeEach(() => mockKeystore.clear())

  it('are none for a shopper who has not signed in or added to a cart', async () => {
    await expect(loadTokens('acme.my-store.one')).resolves.toEqual({ session: null, cart: null })
  })

  it("read the session and the guest's cart, each from its own place", async () => {
    await save('acme.my-store.one', 's3ssion')
    await save('acme.my-store.one.cart', 'c4rt')
    await expect(loadTokens('acme.my-store.one')).resolves.toEqual({ session: 's3ssion', cart: 'c4rt' })
  })

  it("never read another store's tokens", async () => {
    await save('acme.my-store.one', 's3ssion')
    await expect(loadTokens('other.my-store.one')).resolves.toEqual({ session: null, cart: null })
  })

  it('go out as the Shop API reads them, each only when there is one', () => {
    expect(shopHeaders({ session: null, cart: null })).toEqual({})
    expect(shopHeaders({ session: 's3ssion', cart: null })).toEqual({ 'x-shop-session': 's3ssion' })
    expect(shopHeaders({ session: 's3ssion', cart: 'c4rt' })).toEqual({ 'x-shop-session': 's3ssion', 'x-shop-cart': 'c4rt' })
  })
})
