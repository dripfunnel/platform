import type { ReactElement } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '../../graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { actingAs, fakeClient, hasText, press, pressableNamed, pressablesNamed, renderShell, texts } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { SettingsScreen } from './SettingsScreen'
import { SettingsTabScreen } from './SettingsTabScreen'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockPush = jest.fn()
const mockSession: { client: ApiClient | null } = { client: null }

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), navigate: jest.fn() }),
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

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
})


const info = {
  name: 'Kesari Threads',
  legalName: null,
  description: null,
  logoAssetId: null,
  address: { street: '14 Johari Bazaar', city: 'Jaipur', postal: '302003', region: 'Rajasthan' },
  contactEmail: 'hello@kesarithreads.in',
  contactPhone: null,
  country: 'IN',
  taxId: null,
  timeZone: 'Asia/Kolkata',
  unitSystem: 'metric',
  orderPrefix: 'KT-',
  nextOrderNumber: '1042',
}
const locale = {
  pricingCurrency: 'INR',
  mainLanguage: 'en-IN',
  offeredLanguages: ['en-IN', 'hi-IN'],
  currencies: [{ code: 'USD', mode: 'convert', rounding: 'ends-99', status: 'active' }],
  languages: [{ code: 'en-IN', status: 'active' }],
  examples: [{ currency: 'USD', publishedOn: '2026-10-05', from: { amount: '10000', currency: 'INR' }, none: { amount: '120' }, nearest: { amount: '100' }, ends99: { amount: '199' } }],
}


describe('Settings is the Owner’s', () => {
  it('lists the tabs as rows that each open on their own screen, Customer accounts among them', async () => {
    const { renderer } = await show(<SettingsScreen />, {})

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Store info', 'Name, contact, address, currencies and languages', 'Customer accounts']))
    expect(hasText(renderer, 'Payment setup')).toBe(false)
    await press(pressableNamed(renderer, 'Store info'))
    expect(mockPush).toHaveBeenCalledWith('/more/settings/store')
    await press(pressableNamed(renderer, 'Customer accounts'))
    expect(mockPush).toHaveBeenCalledWith('/more/settings/accounts')
  })

  it('tells a Manager the list is the owner’s, without reading anything', async () => {
    const { renderer, calls } = await show(<SettingsScreen />, {}, { acting: actingAs('manager') })

    expect(hasText(renderer, 'You don’t have access to Settings')).toBe(true)
    expect(hasText(renderer, 'Store info')).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it.each(['store', 'accounts'])('opening %s by a deep link as a Manager is access denied, and reads and writes nothing', async (tab) => {
    const { renderer, calls } = await show(<SettingsTabScreen tab={tab} />, {}, { acting: actingAs('manager') })

    expect(hasText(renderer, 'You don’t have access to Settings')).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('says Staff and a supplier have no access either, and a tab that does not exist is a 404 for the Owner only', async () => {
    const staff = await show(<SettingsTabScreen tab="store" />, {}, { acting: actingAs('staff') })
    expect(hasText(staff.renderer, 'You don’t have access to Settings')).toBe(true)
    expect(staff.calls).toHaveLength(0)
    const supplier = await show(<SettingsTabScreen tab="store" />, {}, { acting: actingAs('supplier-admin', 'vendor-catalogue') })
    expect(hasText(supplier.renderer, 'You don’t have access to Settings')).toBe(true)
    expect(supplier.calls).toHaveLength(0)
    const missing = await show(<SettingsTabScreen tab="payments" />, {})
    expect(hasText(missing.renderer, 'This page isn’t here any more')).toBe(true)
    expect(missing.calls).toHaveLength(0)
    const hidden = await show(<SettingsTabScreen tab="payments" />, {}, { acting: actingAs('manager') })
    expect(hasText(hidden.renderer, 'You don’t have access to Settings')).toBe(true)
    expect(hidden.calls).toHaveLength(0)
  })

  it('says it could not load, and loads again on request', async () => {
    let fail = true
    const { renderer, calls } = await show(<SettingsTabScreen tab="store" />, {
      '{ storeInfo {': () => {
        if (fail) throw new ApiError('NO_RESPONSE', 'x')
        return { storeInfo: info }
      },
      '{ storeLocale {': () => ({ storeLocale: locale }),
      'query Progress': () => ({}),
    })

    expect(hasText(renderer, 'We couldn’t load Store info')).toBe(true)
    fail = false
    await click(renderer, 'Try again')
    expect(asked(calls, '{ storeInfo {')).toHaveLength(2)
    expect(hasText(renderer, 'Your store')).toBe(true)
  })
})

describe('Store info', () => {
  const store = (over: Handlers = {}): Handlers => ({
    '{ storeInfo {': () => ({ storeInfo: info }),
    '{ storeLocale {': () => ({ storeLocale: locale }),
    'query Progress': () => ({}),
    ...over,
  })

  it('saves the details card in the API’s input shape and says so', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="store" />, store({ 'mutation SaveStoreInfo': () => ({ saveStoreInfo: true }) }))

    await type(renderer, 'Store name', 'Kesari Threads Jaipur')
    await type(renderer, 'Prefix', 'kj-')
    await type(renderer, 'Next number', '2000')
    await click(renderer, 'Save store info')

    expect(asked(calls, 'mutation SaveStoreInfo')[0]?.variables).toEqual({
      input: {
        name: 'Kesari Threads Jaipur',
        legalName: '',
        description: '',
        logoAssetId: null,
        address: { street: '14 Johari Bazaar', city: 'Jaipur', postal: '302003', region: 'Rajasthan' },
        contactEmail: 'hello@kesarithreads.in',
        contactPhone: '',
        taxId: '',
        timeZone: 'Asia/Kolkata',
        unitSystem: 'metric',
        orderPrefix: 'KJ-',
        nextOrderNumber: 2000,
      },
    })
    expect(hasText(renderer, 'Store info saved')).toBe(true)
  })

  it('words the address and tax number in the home country’s terms', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="store" />, store())

    expect(texts(renderer)).toEqual(expect.arrayContaining(['PIN code', 'GSTIN']))
  })

  it('does not send a store with no name or an order number below 1, and says what to fix', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="store" />, store())

    await type(renderer, 'Store name', ' ')
    await click(renderer, 'Save store info')
    expect(hasText(renderer, 'Your store needs a name')).toBe(true)
    await type(renderer, 'Store name', 'Kesari')
    await type(renderer, 'Next number', '0')
    await click(renderer, 'Save store info')
    expect(hasText(renderer, 'Type the next order number')).toBe(true)
    expect(asked(calls, 'mutation SaveStoreInfo')).toHaveLength(0)
  })

  it('shows a refusal by its code and keeps what was typed', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="store" />, store({ 'mutation SaveStoreInfo': () => { throw new ApiError('ORDER_NUMBER_DOWN', 'x') } }))

    await type(renderer, 'Next number', '5')
    await click(renderer, 'Save store info')

    expect(hasText(renderer, 'The next order number can only go up, so no number is used twice.')).toBe(true)
    expect((input(renderer, 'Next number').props as { value: string }).value).toBe('5')
  })

  it('saves currencies on their own, asking first before a currency stops converting', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="store" />, store({ 'mutation SaveCurrencies': () => ({ saveCurrencies: true }) }))

    expect(hasText(renderer, '₹100.00 → $1.99 · reference rates from the European Central Bank, published Oct 5, 2026')).toBe(true)
    await click(renderer, 'Convert automatically')
    expect(hasText(renderer, 'Stop converting USD automatically?')).toBe(true)
    await click(renderer, 'Set prices myself')
    await click(renderer, 'Save currencies')

    expect(asked(calls, 'mutation SaveCurrencies')[0]?.variables).toEqual({ c: [{ code: 'USD', mode: 'manual', rounding: 'ends-99' }] })
    expect(asked(calls, 'mutation SaveStoreInfo')).toHaveLength(0)
    expect(hasText(renderer, 'Currencies saved')).toBe(true)
  })

  it('saves languages with the main one, and asks before removing one', async () => {
    const two = { ...locale, languages: [{ code: 'en-IN', status: 'active' }, { code: 'hi-IN', status: 'active' }] }
    const { renderer, calls } = await show(
      <SettingsTabScreen tab="store" />,
      store({ '{ storeLocale {': () => ({ storeLocale: two }), 'query Progress': () => ({ l0: { products: 20, untranslated: 5 } }), 'mutation SaveLanguages': () => ({ saveLanguages: true }) }),
    )

    expect(hasText(renderer, '15 of 20 products translated')).toBe(true)
    await click(renderer, 'Remove Hindi (India)')
    expect(hasText(renderer, 'Your translations are kept but won’t show.')).toBe(true)
    await click(renderer, 'Remove')
    await click(renderer, 'Save languages')

    expect(asked(calls, 'mutation SaveLanguages')[0]?.variables).toEqual({ l: ['en-IN'], m: 'en-IN' })
  })

  it('can look but not change in a store that is read-only', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="store" />, store(), { client: fakeClient({ state: readOnlyState }) })

    expect(hasText(renderer, 'Your store is read-only until the bill is paid.')).toBe(true)
    expect(pressablesNamed(renderer, 'Save store info')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Save currencies')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Save languages')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Convert automatically')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Add a currency')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Add a language')).toHaveLength(0)
  })
})
