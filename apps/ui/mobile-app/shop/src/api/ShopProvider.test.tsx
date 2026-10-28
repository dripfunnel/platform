import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { secureStorage } from '@dripfunnel/mobile-shared/storage'
import { loadTokens } from '../session/tokens'
import { ShopProvider } from './ShopProvider'
import { useShop, type Shop } from './ShopContext'

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))
jest.mock('../graphql/storeHost', () => ({ storeHost: () => 'acme.my-store.one' }))
const mockUnregister = jest.fn(() => Promise.resolve())
jest.mock('../push/push', () => ({ unregisterThisPhone: () => mockUnregister() }))

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

const host = 'acme.my-store.one'
let shop!: Shop
const Probe = () => {
  shop = useShop()
  return null
}

const mount = async (): Promise<ReactTestRenderer> => {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(
      <ShopProvider>
        <Probe />
      </ShopProvider>,
    )
  })
  await act(async () => void (await Promise.resolve()))
  return renderer
}

const fetchSpy = jest.fn()
const sent = () => fetchSpy.mock.calls.map(([, init]) => (init as { headers: Record<string, string> }).headers)

beforeEach(() => {
  mockKeystore.clear()
  mockUnregister.mockClear()
  fetchSpy.mockReset().mockResolvedValue({ json: () => Promise.resolve({ data: { signOut: true } }) })
  global.fetch = fetchSpy as unknown as typeof fetch
})

describe('the shopper’s session', () => {
  it('is none for a shopper who has not signed in', async () => {
    await mount()
    expect(shop.signedIn).toBe(false)
  })

  it('starts when a sign-in answers a token: held in secure storage, signed in, carried on the next call, and the guest cart token dropped', async () => {
    await secureStorage<null>(`${host}.cart`, () => null).writeToken('guest-cart')
    await mount()
    await act(async () => shop.startSession('sess-1'))
    expect(shop.signedIn).toBe(true)
    expect(await loadTokens(host)).toEqual({ session: 'sess-1', cart: null })
    await shop.client.request('{ account { name } }')
    expect(sent().at(-1)).toMatchObject({ 'x-shop-session': 'sess-1' })
    expect(sent().at(-1)?.['x-shop-cart']).toBeUndefined()
  })

  it('is found again when the app starts', async () => {
    await secureStorage<null>(host, () => null).writeToken('sess-1')
    await mount()
    expect(shop.signedIn).toBe(true)
  })

  it('ends on sign-out: the token is gone from secure storage and from every later call', async () => {
    await mount()
    await act(async () => shop.startSession('sess-1'))
    await act(async () => shop.endSession())
    expect(shop.signedIn).toBe(false)
    expect(await loadTokens(host)).toEqual({ session: null, cart: null })
    expect([...mockKeystore.keys()].filter((key) => key.includes('token'))).toEqual([])
    await shop.client.request('{ account { name } }')
    expect(sent().at(-1)?.['x-shop-session']).toBeUndefined()
  })

  it('tells the server it ended, with the token still on the call, and still ends when the server cannot be reached', async () => {
    await mount()
    await act(async () => shop.startSession('sess-1'))
    await act(async () => shop.endSession())
    expect(JSON.stringify(fetchSpy.mock.calls[0]?.[1])).toContain('signOut')
    expect(sent()[0]).toMatchObject({ 'x-shop-session': 'sess-1' })

    await act(async () => shop.startSession('sess-2'))
    fetchSpy.mockRejectedValue(new Error('offline'))
    await act(async () => shop.endSession())
    expect(shop.signedIn).toBe(false)
    expect(await loadTokens(host)).toEqual({ session: null, cart: null })
  })

  it('never logs the token', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    await mount()
    await act(async () => shop.startSession('sess-secret'))
    await act(async () => shop.endSession())
    expect(JSON.stringify([...log.mock.calls, ...warn.mock.calls])).not.toContain('sess-secret')
  })
})

describe('signing out', () => {
  it('stops the phone’s pushes first, before the session ends on the server and is removed', async () => {
    await mount()
    await act(async () => shop.startSession('sess-1'))
    await act(async () => shop.endSession())
    expect(mockUnregister).toHaveBeenCalledTimes(1)
    expect(mockUnregister.mock.invocationCallOrder[0]).toBeLessThan(fetchSpy.mock.invocationCallOrder[0] ?? 0)
  })

  it('still signs out when the phone cannot be unregistered', async () => {
    mockUnregister.mockRejectedValueOnce(new Error('offline'))
    await mount()
    await act(async () => shop.startSession('sess-1'))
    await act(async () => shop.endSession())
    expect(shop.signedIn).toBe(false)
    expect(await loadTokens(host)).toEqual({ session: null, cart: null })
  })
})

describe('a guest’s order', () => {
  it('is read by the cart token that placed it, even after the next cart replaces the cart token', async () => {
    await mount()
    await act(async () => shop.saveCartToken('cart-1'))
    await act(async () => shop.keepOrderToken('order-1'))
    await act(async () => shop.saveCartToken('cart-2'))

    const kept = await shop.orderAccess('order-1')
    expect(kept.headers).toEqual({ 'x-shop-cart': 'cart-1' })
    await kept.client.request('{ order(id: "order-1") { id } }')
    expect(sent().at(-1)).toMatchObject({ 'x-shop-cart': 'cart-1' })

    const other = await shop.orderAccess('order-2')
    expect(other.headers).toEqual({ 'x-shop-cart': 'cart-2' })
  })

  it('is read by the session when no token was kept for it, and a signed-in customer keeps none', async () => {
    await mount()
    await act(async () => shop.startSession('sess-1'))
    await act(async () => shop.keepOrderToken('order-1'))
    expect((await shop.orderAccess('order-1')).headers).toEqual({ 'x-shop-session': 'sess-1' })
  })

  it('never logs the kept token', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    await mount()
    await act(async () => shop.saveCartToken('cart-secret'))
    await act(async () => shop.keepOrderToken('order-1'))
    await shop.orderAccess('order-1')
    expect(JSON.stringify(log.mock.calls)).not.toContain('cart-secret')
  })
})
