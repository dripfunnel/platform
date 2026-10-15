import type { ReactElement } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '../../graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { actingAs, fakeClient, hasText, press, pressableNamed, pressablesNamed, renderShell, texts } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { MarketEditorScreen } from './markets/MarketEditorScreen'
import { SettingsTabScreen } from './SettingsTabScreen'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockPush = jest.fn()
const mockBack = jest.fn()
const mockSession: { client: ApiClient | null } = { client: null }

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => ({ push: mockPush, replace: jest.fn(), back: mockBack, navigate: jest.fn() }),
    useNavigation: () => ({ dispatch: jest.fn() }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  }
})
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }))
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), launchCameraAsync: jest.fn(), requestCameraPermissionsAsync: async () => ({ granted: true }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../products/files', () => ({ fileDeps: () => ({ domain: 'shop.test', headers: () => ({ authorization: 'Bearer token' }) }) }))
jest.mock('../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))

// The fake network answers over several promise turns; jest-expo runs timers faked, so wait on promises, not on a timer.
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

type Handlers = Record<string, (variables: Record<string, unknown>, headers: Record<string, string>) => unknown>
type Options = Parameters<typeof renderShell>[1]

const paged = <T,>(nodes: T[]) => ({ nodes, pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } })
const readOnlyState = { readOnly: true, status: null, trialEndsAt: null, pastDueSince: null, provisioning: null, support: null }

const show = async (element: ReactElement, handlers: Handlers, options: Options = {}) => {
  const { client, calls } = fakeApi(handlers)
  mockSession.client = client
  const renderer = await renderShell(element, options)
  await settle()
  return { renderer, calls }
}

const input = (renderer: ReactTestRenderer, label: string) => {
  const found = renderer.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function')[0]
  if (!found) throw new Error(`no field named "${label}"`)
  return found
}
const type = async (renderer: ReactTestRenderer, label: string, value: string) => {
  await act(async () => input(renderer, label).props.onChangeText(value))
}
const click = async (renderer: ReactTestRenderer, label: string) => {
  await press(pressableNamed(renderer, label))
  await settle()
}
const asked = (calls: Call[], text: string) => calls.filter((call) => call.query.includes(text))
const total = (calls: Call[]) => calls.map((call) => call.query)

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
})

const locale = {
  pricingCurrency: 'INR',
  mainLanguage: 'en-IN',
  offeredLanguages: ['en-IN', 'hi-IN'],
  currencies: [{ code: 'USD', mode: 'convert', rounding: 'ends-99', status: 'active' }],
  languages: [{ code: 'en-IN', status: 'active' }],
  examples: [{ currency: 'USD', publishedOn: '2026-10-05', from: { amount: '10000', currency: 'INR' }, none: { amount: '120' }, nearest: { amount: '100' }, ends99: { amount: '199' } }],
}

describe('Settings is the Owner’s', () => {
  it.each(['markets'])('opening %s by a deep link as a Manager is access denied, and reads and writes nothing', async (tab) => {
    const { renderer, calls } = await show(<SettingsTabScreen tab={tab} />, {}, { acting: actingAs('manager') })

    expect(hasText(renderer, 'You don’t have access to Settings')).toBe(true)
    expect(calls).toHaveLength(0)
  })
})

const market = (over: Record<string, unknown>) => ({
  id: 'mk-in',
  name: 'India',
  parentId: null,
  primary: true,
  everywhereElse: false,
  active: true,
  countries: ['IN'],
  currency: 'INR',
  language: 'en-IN',
  priceAdjustmentBps: 0,
  webMode: 'main',
  pathPrefix: null,
  products: 'all',
  excludedProductIds: [],
  excludedProducts: [],
  duties: { mode: 'none', rateBps: null, thresholdAmount: null },
  revision: 1,
  ...over,
})
const markets = [
  market({}),
  market({ id: 'mk-us', name: 'United States', primary: false, everywhereElse: true, countries: ['US'], currency: 'USD', language: 'en-US', priceAdjustmentBps: 1000, webMode: 'path', pathPrefix: 'us', revision: 4 }),
  market({ id: 'mk-ae', name: 'UAE', primary: false, active: false, countries: ['AE'], currency: 'AED' }),
]
const marketLocale = { ...locale, currencies: [{ code: 'USD', mode: 'convert', rounding: 'ends-99', status: 'active' }, { code: 'AED', mode: 'manual', rounding: 'none', status: 'active' }], languages: [{ code: 'en-IN', status: 'active' }, { code: 'en-US', status: 'active' }] }

describe('Markets', () => {
  const store = (over: Handlers = {}): Handlers => ({ 'query Markets(': () => ({ markets: paged(markets) }), '{ storeLocale {': () => ({ storeLocale: marketLocale }), ...over })

  it('lists each market with its countries, currency and state, and opens one on its own screen', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="markets" />, store())

    expect(texts(renderer)).toEqual(expect.arrayContaining(['India', 'India · INR', 'Primary', 'United States', 'United States · USD', 'Active', 'UAE', 'Off']))
    await press(pressableNamed(renderer, 'Open United States'))
    expect(mockPush).toHaveBeenCalledWith('/more/settings/market/mk-us')
  })

  it('starts a new market by its name, and opens its editor with that name', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="markets" />, store())

    await click(renderer, 'Add market')
    await type(renderer, 'Market name', 'United Kingdom')
    await click(renderer, 'Create')

    expect(mockPush).toHaveBeenCalledWith('/more/settings/market/new?name=United%20Kingdom')
  })

  it('changes what shoppers elsewhere get only after saying so', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="markets" />, store({ 'mutation SetEverywhereElse': () => ({ setEverywhereElse: true }) }))

    await click(renderer, 'Everywhere else: United States')
    await click(renderer, 'India')
    expect(hasText(renderer, 'Change what shoppers elsewhere get?')).toBe(true)
    expect(asked(calls, 'mutation SetEverywhereElse')).toHaveLength(0)
    await click(renderer, 'Change')

    expect(asked(calls, 'mutation SetEverywhereElse')[0]?.variables).toEqual({ id: 'mk-in' })
  })

  const editor = (id: string | null, over: Handlers = {}, suggested = '', options: Options = {}) => show(<MarketEditorScreen id={id} suggested={suggested} />, store(over), options)

  it('saves a market in the API’s shape, at the revision it was read at, with the adjustment in basis points', async () => {
    const { renderer, calls } = await editor('mk-us', { 'mutation SaveMarket': () => ({ saveMarket: market({ id: 'mk-us', name: 'United States', revision: 5 }) }) })

    await type(renderer, 'Price adjustment, %', '12.5')
    await click(renderer, 'Save market')

    expect(asked(calls, 'mutation SaveMarket')[0]?.variables).toEqual({
      id: 'mk-us',
      r: 4,
      input: {
        name: 'United States',
        parentId: null,
        active: true,
        countries: ['US'],
        currency: 'USD',
        language: 'en-US',
        priceAdjustmentBps: 1250,
        webMode: 'path',
        pathPrefix: 'us',
        products: 'all',
        excludedProductIds: [],
        dutiesMode: 'none',
        dutiesRateBps: null,
        dutiesThresholdAmount: null,
      },
    })
    expect(hasText(renderer, 'United States saved')).toBe(true)
    expect(mockBack).toHaveBeenCalled()
  })

  it('keeps a comma typed as a decimal point and saves 7.5%, not 75%, with the preview showing the same', async () => {
    const { renderer, calls } = await editor('mk-us', { 'mutation SaveMarket': () => ({ saveMarket: market({ id: 'mk-us', name: 'United States', revision: 5 }) }) })

    await type(renderer, 'Price adjustment, %', '7,5')
    expect((input(renderer, 'Price adjustment, %').props as { value: string }).value).toBe('7,5')
    expect(hasText(renderer, ', prices +7.5%')).toBe(true)
    await click(renderer, 'Save market')

    expect(asked(calls, 'mutation SaveMarket')[0]?.variables).toMatchObject({ input: { priceAdjustmentBps: 750 } })
  })

  it('keeps a comma in a flat duty rate too, and refuses one above 100%', async () => {
    const flat = { duties: { mode: 'flat', rateBps: 1200, thresholdAmount: null } }
    const { renderer, calls } = await editor('mk-us', {
      'query Markets(': () => ({ markets: paged([markets[0], { ...markets[1], ...flat }, markets[2]]) }),
      'mutation SaveMarket': () => ({ saveMarket: market({ id: 'mk-us', name: 'United States', revision: 5 }) }),
    })

    await type(renderer, 'Percentage', '1000')
    await click(renderer, 'Save market')
    expect(hasText(renderer, 'Type the duty percentage')).toBe(true)
    expect(asked(calls, 'mutation SaveMarket')).toHaveLength(0)
    await type(renderer, 'Percentage', '7,5')
    expect((input(renderer, 'Percentage').props as { value: string }).value).toBe('7,5')
    await click(renderer, 'Save market')

    expect(asked(calls, 'mutation SaveMarket')[0]?.variables).toMatchObject({ input: { dutiesMode: 'flat', dutiesRateBps: 750 } })
  })

  it('creates a new market named from the list, with no countries until they are picked, and says what is missing', async () => {
    const { renderer, calls } = await editor(null, { 'mutation SaveMarket': () => ({ saveMarket: market({ id: 'mk-uk', name: 'United Kingdom', primary: false }) }) }, 'United Kingdom')

    expect((input(renderer, 'Market name').props as { value: string }).value).toBe('United Kingdom')
    await click(renderer, 'Save market')
    expect(hasText(renderer, 'Pick at least one country')).toBe(true)
    expect(asked(calls, 'mutation SaveMarket')).toHaveLength(0)
    await click(renderer, 'Add a country')
    await click(renderer, 'United Kingdom')
    await click(renderer, 'Save market')

    expect(asked(calls, 'mutation SaveMarket')[0]?.variables).toMatchObject({ id: null, r: null, input: { name: 'United Kingdom', countries: ['GB'], currency: 'INR', language: 'en-IN', active: true } })
    expect(hasText(renderer, 'United Kingdom added')).toBe(true)
  })

  it('names the market that already holds a country and will not take it twice', async () => {
    const { renderer } = await editor('mk-us')

    await click(renderer, 'Add a country')
    expect(pressablesNamed(renderer, 'India')).toHaveLength(0)
    expect(hasText(renderer, 'United States')).toBe(true)
  })

  it('shows the API’s refusal by its code, and reads the markets again when someone else saved first', async () => {
    let reads = 0
    const { renderer } = await editor('mk-us', {
      'query Markets(': () => {
        reads += 1
        return { markets: paged(reads === 1 ? markets : [markets[0], { ...markets[1], name: 'USA', revision: 5 }]) }
      },
      'mutation SaveMarket': () => {
        throw new ApiError('STALE_REVISION', 'x')
      },
    })

    await type(renderer, 'Price adjustment, %', '3')
    await click(renderer, 'Save market')

    expect(hasText(renderer, 'Someone else changed this market first.')).toBe(true)
    expect(hasText(renderer, 'It now shows what’s saved.')).toBe(true)
    expect((input(renderer, 'Market name').props as { value: string }).value).toBe('USA')
  })

  it('refuses the primary market’s deletion by offering none, and deletes another after saying where its shoppers go', async () => {
    const primary = await editor('mk-in')
    expect(pressablesNamed(primary.renderer, 'Delete market')).toHaveLength(0)

    const { renderer, calls } = await editor('mk-ae', { 'mutation DeleteMarket': () => ({ deleteMarket: true }) })
    await click(renderer, 'Delete market')
    expect(hasText(renderer, 'Shoppers in United Arab Emirates get your “Everywhere else” settings instead.')).toBe(true)
    await press(pressablesNamed(renderer, 'Delete market').at(-1) as never)
    await settle()

    expect(asked(calls, 'mutation DeleteMarket')[0]?.variables).toEqual({ id: 'mk-ae' })
    expect(mockBack).toHaveBeenCalled()
  })

  it('says a market that is not here is a 404, and one in a read-only store can only be looked at', async () => {
    const missing = await editor('nope')
    expect(hasText(missing.renderer, 'This page isn’t here any more')).toBe(true)

    const { renderer } = await editor('mk-us', {}, '', { client: fakeClient({ state: readOnlyState }) })
    expect(hasText(renderer, 'United States')).toBe(true)
    expect(pressablesNamed(renderer, 'Delete market')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Save market')).toHaveLength(0)
  })

  it('is access denied to a Manager, who reads nothing', async () => {
    const { renderer, calls } = await editor('mk-us', {}, '', { acting: actingAs('manager') })

    expect(hasText(renderer, 'You don’t have access to Markets')).toBe(true)
    expect(total(calls)).toEqual([])
  })
})

