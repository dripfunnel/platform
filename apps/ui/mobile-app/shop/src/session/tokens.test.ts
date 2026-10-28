import { secureStorage } from '@dripfunnel/mobile-shared/storage'
import { keepOrderToken, loadOrderToken, loadTokens, shopHeaders } from './tokens'

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

describe('the token kept for a guest’s order', () => {
  beforeEach(() => mockKeystore.clear())

  it('is the cart token that placed it, kept apart from the cart token the next cart replaces', async () => {
    await save('acme.my-store.one.cart', 'c4rt')
    await keepOrderToken('acme.my-store.one', 'order-1')
    await save('acme.my-store.one.cart', 'n3w')
    await expect(loadOrderToken('acme.my-store.one', 'order-1')).resolves.toBe('c4rt')
    await expect(loadOrderToken('acme.my-store.one', 'order-2')).resolves.toBeNull()
  })

  it('is none to keep when the shopper has no cart token, and never another store’s', async () => {
    await keepOrderToken('acme.my-store.one', 'order-1')
    await expect(loadOrderToken('acme.my-store.one', 'order-1')).resolves.toBeNull()
    await save('acme.my-store.one.cart', 'c4rt')
    await keepOrderToken('acme.my-store.one', 'order-1')
    await expect(loadOrderToken('other.my-store.one', 'order-1')).resolves.toBeNull()
  })
})

describe('how long a guest’s order token is kept', () => {
  const host = 'acme.my-store.one'
  const day = 86_400_000
  const t0 = Date.UTC(2026, 9, 27)

  beforeEach(async () => {
    mockKeystore.clear()
    await jest.requireMock<{ clear: () => Promise<void> }>('@react-native-async-storage/async-storage').clear()
    await save(`${host}.cart`, 'c4rt')
  })

  it('is 30 days, after which the token reads nothing and is removed from the phone', async () => {
    await keepOrderToken(host, 'order-1', t0)
    await expect(loadOrderToken(host, 'order-1', t0 + 29 * day)).resolves.toBe('c4rt')
    await expect(loadOrderToken(host, 'order-1', t0 + 31 * day)).resolves.toBeNull()
    expect([...mockKeystore.keys()].filter((key) => key.includes('.order.'))).toEqual([])
    await expect(loadOrderToken(host, 'order-1', t0 + 31 * day)).resolves.toBeNull()
  })

  it('starts again when the same order is kept again, rather than listing it twice', async () => {
    await keepOrderToken(host, 'order-1', t0)
    await keepOrderToken(host, 'order-1', t0 + 20 * day)
    await expect(loadOrderToken(host, 'order-1', t0 + 40 * day)).resolves.toBe('c4rt')
  })

  it('is the 20 newest orders: a 21st removes the oldest token, and the next removes the next', async () => {
    for (let n = 0; n < 22; n += 1) await keepOrderToken(host, `order-${n}`, t0 + n * 1000)
    await expect(loadOrderToken(host, 'order-0', t0 + 30_000)).resolves.toBeNull()
    await expect(loadOrderToken(host, 'order-1', t0 + 30_000)).resolves.toBeNull()
    await expect(loadOrderToken(host, 'order-2', t0 + 30_000)).resolves.toBe('c4rt')
    await expect(loadOrderToken(host, 'order-21', t0 + 30_000)).resolves.toBe('c4rt')
    expect([...mockKeystore.keys()].filter((key) => key.includes('.order.'))).toHaveLength(20)
  })

  it('prunes the tokens that have expired whenever another order is kept', async () => {
    await keepOrderToken(host, 'old', t0)
    await keepOrderToken(host, 'new', t0 + 40 * day)
    expect([...mockKeystore.keys()].some((key) => key.endsWith('.order.old.token'))).toBe(false)
    expect([...mockKeystore.keys()].some((key) => key.endsWith('.order.new.token'))).toBe(true)
  })

  it('lists only the orders’ ids and times, never a token', async () => {
    await keepOrderToken(host, 'order-1', t0)
    const AsyncStorage = jest.requireMock<{ getItem: (key: string) => Promise<string | null> }>('@react-native-async-storage/async-storage')
    const list = await AsyncStorage.getItem(`df.orders.kept.${host}`)
    expect(list).toContain('order-1')
    expect(list).not.toContain('c4rt')
  })
})
