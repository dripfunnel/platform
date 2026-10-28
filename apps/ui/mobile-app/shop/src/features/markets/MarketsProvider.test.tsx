import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { ShopProvider } from '../../api/ShopProvider'
import { useShop, type Shop } from '../../api/ShopContext'
import { locale, setLanguage } from '../../messages'
import { MarketsProvider, useMarkets } from './MarketsProvider'
import type { Markets } from './MarketsContext'
import { readChoice, saveChoice, saveOffers } from './storage'

jest.setTimeout(120_000)

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))
jest.mock('../../graphql/storeHost', () => ({ storeHost: () => 'acme.my-store.one' }))
jest.mock('../../brand/BrandProvider', () => ({ brandTimeoutMs: 5000 }))
jest.mock('../../push/push', () => ({ unregisterThisPhone: () => Promise.resolve() }))
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  getItemAsync: () => Promise.resolve(null),
  setItemAsync: () => Promise.resolve(),
  deleteItemAsync: () => Promise.resolve(),
}))

const host = 'acme.my-store.one'
const offered = { store: { mainLanguage: 'en', languages: ['hi'], pricingCurrency: 'INR', currencies: [{ code: 'AED' }] } }

let shop!: Shop
let markets!: Markets
let mounts = 0
const Probe = () => {
  shop = useShop()
  markets = useMarkets()
  useEffect(() => {
    mounts += 1
  }, [])
  return null
}

const fetchSpy = jest.fn()
const headersOf = (call: unknown[]) => (call[1] as { headers: Record<string, string> }).headers

// A request the screens would make, and the headers it went with.
const askAndRead = async (): Promise<Record<string, string>> => {
  fetchSpy.mockClear()
  await act(async () => void (await shop.client.request('{ probe }')))
  return headersOf(fetchSpy.mock.calls[0] ?? [])
}

const mount = async (): Promise<ReactTestRenderer> => {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(
      <MarketsProvider>
        <ShopProvider>
          <Probe />
        </ShopProvider>
      </MarketsProvider>,
    )
  })
  for (let i = 0; i < 6; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
  return renderer
}

beforeEach(async () => {
  mounts = 0
  await AsyncStorage.clear()
  setLanguage('en')
  fetchSpy.mockReset().mockResolvedValue({ json: () => Promise.resolve({ data: { ...offered, probe: true } }) })
  global.fetch = fetchSpy as unknown as typeof fetch
})

afterEach(() => jest.restoreAllMocks())

describe('the shopper’s language and currency', () => {
  it('go with every request, as the Shop API’s headers', async () => {
    await saveChoice(host, { language: 'hi', currency: 'AED' })
    await saveOffers(host, { languages: ['en', 'hi'], currencies: ['INR', 'AED'] })
    await mount()
    expect(await askAndRead()).toMatchObject({ 'x-shop-language': 'hi', 'x-shop-currency': 'AED' })
  })

  it('follow the phone’s language when the store offers it, and send no currency until one is picked', async () => {
    jest.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ locale: 'hi-IN' } as Intl.ResolvedDateTimeFormatOptions)
    await mount()
    const headers = await askAndRead()
    expect(headers['x-shop-language']).toBe('hi')
    expect(headers).not.toHaveProperty('x-shop-currency')
  })

  it('are the store’s main language when it offers none of the phone’s', async () => {
    jest.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ locale: 'fr-FR' } as Intl.ResolvedDateTimeFormatOptions)
    await mount()
    expect((await askAndRead())['x-shop-language']).toBe('en')
  })

  it('are kept when the shopper picks, and carried by every request after', async () => {
    await saveOffers(host, { languages: ['en', 'hi'], currencies: ['INR', 'AED'] })
    await mount()
    await act(async () => markets.choose({ currency: 'AED' }))
    for (let i = 0; i < 3; i += 1) await act(async () => void (await Promise.resolve()))
    expect(await readChoice(host)).toEqual({ language: null, currency: 'AED' })
    expect(await askAndRead()).toMatchObject({ 'x-shop-currency': 'AED' })
  })

  it('speak the app’s own words in English for a language the app has no words for, while still asking the API in that language', async () => {
    await saveChoice(host, { language: 'hi', currency: null })
    await saveOffers(host, { languages: ['en', 'hi'], currencies: ['INR'] })
    await mount()
    expect(locale).toBe('en')
    expect((await askAndRead())['x-shop-language']).toBe('hi')
  })

  it('start the screens over for a new pick, so every one asks again, and not for the same pick twice', async () => {
    await saveOffers(host, { languages: ['en', 'hi'], currencies: ['INR', 'AED'] })
    await mount()
    expect(mounts).toBe(1)
    await act(async () => markets.choose({ currency: 'AED' }))
    expect(mounts).toBe(2)
    await act(async () => markets.choose({ currency: 'AED' }))
    expect(mounts).toBe(2)
  })

  it('are unknown with no signal and nothing saved: nothing is offered, and nothing is sent', async () => {
    fetchSpy.mockReset().mockRejectedValue(new TypeError('Network request failed'))
    await mount()
    expect(markets.offers).toBeNull()
    expect(markets.choice).toEqual({ language: null, currency: null })
  })
})
