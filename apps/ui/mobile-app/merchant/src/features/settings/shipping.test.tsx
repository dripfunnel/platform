import type { ReactElement } from 'react'
import { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { fakeClient, hasText, press, pressableNamed, pressablesNamed, renderShell, texts } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { SettingsTabScreen } from './SettingsTabScreen'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockSession: { client: ApiClient | null } = { client: null }

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() }),
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
const textIn = (node: ReactTestInstance): string => node.children.map((child) => (typeof child === 'string' ? child : textIn(child))).join('')
// A choice row is its label and what it means; this presses the one whose label is `label`.
const pick = async (renderer: ReactTestRenderer, label: string) => {
  const row = renderer.root.findAll((node) => node.props.accessibilityRole === 'radio' && typeof node.props.onPress === 'function' && textIn(node).startsWith(label))[0]
  if (!row) throw new Error(`no choice named "${label}"`)
  await press(row)
  await settle()
}
// The last button of that name is the one in the sheet that opened over the screen.
const clickLast = async (renderer: ReactTestRenderer, label: string) => {
  await press(pressablesNamed(renderer, label).at(-1) as ReactTestInstance)
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


const courier = (over: Record<string, unknown> = {}) => ({ provider: 'shiprocket', status: 'pricing', offered: true, pickupMode: 'scheduled', labelSize: 'a6', trackingEmails: true, lastTestedAt: null, lastTestResult: null, ...over })
const shippingOf = (over: Record<string, unknown> = {}) => ({
  revision: 7,
  savedAt: null,
  currency: 'INR',
  courierRate: true,
  flatRate: true,
  flatAmount: '4900',
  pickup: false,
  pickupHours: null,
  pickupAddress: '14 Johari Bazaar, Jaipur',
  freeMode: 'never',
  freeThresholdAmount: null,
  areaMode: 'everywhere',
  areaFileName: null,
  areaCount: 0,
  areaSample: [],
  labelSizes: ['a6', 'a4'],
  couriers: [courier(), courier({ provider: 'fedex', status: 'off' })],
  ...over,
})

describe('Shipping', () => {
  const ship = (over: Handlers = {}, settings: unknown = shippingOf()): Handlers => ({
    '{ shippingSettings {': () => ({ shippingSettings: settings }),
    '{ storeInfo {': () => ({ storeInfo: info }),
    ...over,
  })
  const withCouriers = (couriers: unknown[]) => shippingOf({ couriers })

  it('shows what is saved: the flat rate in major units, who quotes, and each courier’s state', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="shipping" />, ship())

    expect(input(renderer, 'Flat rate (INR)').props.value).toBe('49.00')
    expect(texts(renderer)).toEqual(expect.arrayContaining(['Pricing orders', 'Not connected']))
    expect(hasText(renderer, 'Quoted at checkout by Shiprocket, from address and weight.')).toBe(true)
    expect(hasText(renderer, 'Saving changes what shoppers pay for delivery at checkout, from now on.')).toBe(true)
  })

  it('adds collection in person and delivery free over an amount, and saves them in minor units over the revision read', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="shipping" />, ship({ 'mutation SaveShipping': () => ({ saveShipping: 8 }) }))

    await click(renderer, 'Nothing — collect in person')
    await type(renderer, 'Days and hours', 'Mon–Sat, 10 am – 6 pm')
    await pick(renderer, 'On orders over an amount')
    await type(renderer, 'Free over (INR)', '999')
    expect(hasText(renderer, 'or more ship free.')).toBe(true)
    await click(renderer, 'Save shipping')

    expect(asked(calls, 'mutation SaveShipping')[0]?.variables).toEqual({
      r: 7,
      i: { courierRate: true, flatRate: true, flatAmount: '4900', pickup: true, pickupHours: 'Mon–Sat, 10 am – 6 pm', freeMode: 'over', freeThresholdAmount: '99900', areaMode: 'everywhere' },
    })
    expect(hasText(renderer, 'Shipping saved — checkout uses it now')).toBe(true)
  })

  it('sends a typed flat rate as minor units, including a comma keyboard’s decimal', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="shipping" />, ship({ 'mutation SaveShipping': () => ({ saveShipping: 8 }) }))

    await type(renderer, 'Flat rate (INR)', '60,5')
    await click(renderer, 'Save shipping')

    expect(asked(calls, 'mutation SaveShipping')[0]?.variables).toMatchObject({ i: { flatAmount: '6050' } })
  })

  it('says what is missing before it sends anything', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="shipping" />, ship())

    await type(renderer, 'Flat rate (INR)', '')
    await click(renderer, 'Save shipping')
    expect(hasText(renderer, 'Type a flat rate.')).toBe(true)
    await type(renderer, 'Flat rate (INR)', 'abc')
    await click(renderer, 'Save shipping')
    expect(hasText(renderer, 'Type an amount like 49.00.')).toBe(true)
    await type(renderer, 'Flat rate (INR)', '49')
    await click(renderer, 'Nothing — collect in person')
    await click(renderer, 'Save shipping')
    expect(hasText(renderer, 'Set your collection hours first')).toBe(true)
    await pick(renderer, 'Only PIN codes I paste')
    await type(renderer, 'Days and hours', 'Mon–Sat')
    await click(renderer, 'Save shipping')
    expect(hasText(renderer, 'Paste your PIN code list, or choose “Everywhere”.')).toBe(true)
    expect(asked(calls, 'mutation SaveShipping')).toHaveLength(0)
  })

  it('reads it again when someone else saved first, keeping what was typed, and says so', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="shipping" />, ship({ 'mutation SaveShipping': () => { throw new ApiError('STALE', 'x') } }))

    await type(renderer, 'Flat rate (INR)', '60')
    await click(renderer, 'Save shipping')

    expect(hasText(renderer, 'Someone else saved shipping first.')).toBe(true)
    expect(asked(calls, '{ shippingSettings {')).toHaveLength(2)
    expect(input(renderer, 'Flat rate (INR)').props.value).toBe('60')
  })

  it('shows the API’s refusal by its code', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="shipping" />, ship({ 'mutation SaveShipping': () => { throw new ApiError('NO_ADDRESS', 'x') } }))

    await type(renderer, 'Flat rate (INR)', '60')
    await click(renderer, 'Save shipping')

    expect(hasText(renderer, 'Add your store’s address and postcode in Store info first')).toBe(true)
  })

  it('connects a courier on the partner’s account after saying so, then reads the couriers again', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="shipping" />, ship({ 'mutation ConnectCourier': () => ({ connectCourier: 'standby' }) }))

    await click(renderer, 'Connect FedEx')
    expect(hasText(renderer, 'there’s no key to enter')).toBe(true)
    expect(asked(calls, 'mutation ConnectCourier')).toHaveLength(0)
    await clickLast(renderer, 'Connect')

    expect(asked(calls, 'mutation ConnectCourier')[0]?.variables).toEqual({ p: 'fedex' })
    expect(hasText(renderer, 'FedEx connected, on standby')).toBe(true)
    expect(asked(calls, '{ shippingSettings {')).toHaveLength(2)
  })

  it('shows a courier that was disconnected elsewhere as not connected, and says nothing changed', async () => {
    let gone = false
    const settings = () => ({ shippingSettings: withCouriers([courier(), courier({ provider: 'fedex', status: gone ? 'off' : 'standby' })]) })
    const { renderer } = await show(<SettingsTabScreen tab="shipping" />, ship({
      '{ shippingSettings {': settings,
      'mutation MakePricingCourier': () => {
        gone = true
        throw new ApiError('NOT_CONNECTED', 'x')
      },
    }))
    expect(hasText(renderer, 'Standby')).toBe(true)

    await click(renderer, 'Manage FedEx')
    await click(renderer, 'Use for pricing')
    await clickLast(renderer, 'Use for pricing')

    expect(hasText(renderer, 'That courier isn’t connected, so nothing changed.')).toBe(true)
    expect(hasText(renderer, 'Standby')).toBe(false)
    expect(hasText(renderer, 'Not connected')).toBe(true)
  })

  it('says which courier takes over before one is disconnected', async () => {
    const two = withCouriers([courier(), courier({ provider: 'fedex', status: 'standby' })])
    const { renderer, calls } = await show(<SettingsTabScreen tab="shipping" />, ship({ 'mutation DisconnectCourier': () => ({ disconnectCourier: 'fedex' }) }, two))

    await click(renderer, 'Manage Shiprocket')
    await click(renderer, 'Disconnect')
    expect(hasText(renderer, 'FedEx takes over pricing orders.')).toBe(true)
    await clickLast(renderer, 'Disconnect')

    expect(asked(calls, 'mutation DisconnectCourier')[0]?.variables).toEqual({ p: 'shiprocket' })
    expect(hasText(renderer, 'Shiprocket disconnected — FedEx prices orders now')).toBe(true)
  })

  it('saves a courier’s pickups, label size and tracking emails', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="shipping" />, ship({ 'mutation SaveCourierOptions': () => ({ saveCourierOptions: true }) }))

    await click(renderer, 'Manage Shiprocket')
    await click(renderer, 'Manage')
    await pick(renderer, 'You book each one from the order')
    await pick(renderer, 'A4')
    await pick(renderer, 'Off')
    await clickLast(renderer, 'Save')

    expect(asked(calls, 'mutation SaveCourierOptions')[0]?.variables).toEqual({ p: 'shiprocket', i: { pickupMode: 'on_request', labelSize: 'a4', trackingEmails: false } })
    expect(hasText(renderer, 'Shiprocket: pickups, labels and tracking saved')).toBe(true)
  })

  it('tests the couriers and says which did not answer', async () => {
    const two = withCouriers([courier(), courier({ provider: 'fedex', status: 'standby' })])
    const { renderer } = await show(<SettingsTabScreen tab="shipping" />, ship({ 'mutation TestCouriers': () => ({ testCouriers: [{ provider: 'shiprocket', result: 'ok', ms: 1200 }, { provider: 'fedex', result: 'unavailable', ms: 400 }] }) }, two))

    await click(renderer, 'Test all')

    expect(hasText(renderer, '1 of 2 didn’t answer')).toBe(true)
    expect(hasText(renderer, 'Shiprocket — quoted a test parcel to your own address in 1.2 s')).toBe(true)
    expect(hasText(renderer, 'FedEx — didn’t answer. Try again in a minute.')).toBe(true)
  })

  it('still says a courier change was made when reading the couriers again fails', async () => {
    let reads = 0
    const { renderer } = await show(<SettingsTabScreen tab="shipping" />, ship({
      '{ shippingSettings {': () => {
        reads += 1
        if (reads > 1) throw new ApiError('NO_RESPONSE', 'x')
        return { shippingSettings: shippingOf() }
      },
      'mutation ConnectCourier': () => ({ connectCourier: 'standby' }),
    }))

    await click(renderer, 'Connect FedEx')
    await clickLast(renderer, 'Connect')

    expect(hasText(renderer, 'FedEx connected, on standby')).toBe(true)
    expect(hasText(renderer, 'We couldn’t reach the server')).toBe(false)
    expect(pressablesNamed(renderer, 'Connect')).toHaveLength(0)
  })

  it('still shows the courier test results when reading the couriers again fails', async () => {
    let reads = 0
    const two = withCouriers([courier(), courier({ provider: 'fedex', status: 'standby' })])
    const { renderer } = await show(<SettingsTabScreen tab="shipping" />, ship({
      '{ shippingSettings {': () => {
        reads += 1
        if (reads > 1) throw new ApiError('NO_RESPONSE', 'x')
        return { shippingSettings: two }
      },
      'mutation TestCouriers': () => ({ testCouriers: [{ provider: 'shiprocket', result: 'ok', ms: 1200 }, { provider: 'fedex', result: 'ok', ms: 900 }] }),
    }))

    await click(renderer, 'Test all')

    expect(hasText(renderer, 'All 2 answered')).toBe(true)
    expect(hasText(renderer, 'We couldn’t reach the server')).toBe(false)
  })

  it('still says the pasted list was kept, and closes the sheet, when reading the settings again fails', async () => {
    let reads = 0
    const { renderer, calls } = await show(<SettingsTabScreen tab="shipping" />, ship({
      '{ shippingSettings {': () => {
        reads += 1
        if (reads > 1) throw new ApiError('NO_RESPONSE', 'x')
        return { shippingSettings: shippingOf() }
      },
      'mutation ReplaceDeliveryArea': () => ({ replaceDeliveryArea: 2 }),
    }))

    await pick(renderer, 'Only PIN codes I paste')
    await click(renderer, 'Paste a list')
    await type(renderer, 'The PIN codes you deliver to', '302003, 302004')
    await clickLast(renderer, 'Use this list')

    expect(asked(calls, 'mutation ReplaceDeliveryArea')).toHaveLength(1)
    expect(hasText(renderer, '2 PIN codes kept. Save shipping to deliver only there.')).toBe(true)
    expect(hasText(renderer, 'We couldn’t reach the server')).toBe(false)
    expect(pressablesNamed(renderer, 'Use this list')).toHaveLength(0)
  })

  it('takes a pasted list of codes in the country’s shape, and says when none are', async () => {
    let area = { areaCount: 0, areaFileName: null as string | null, areaSample: [] as string[] }
    const { renderer, calls } = await show(<SettingsTabScreen tab="shipping" />, ship({
      '{ shippingSettings {': () => ({ shippingSettings: shippingOf(area) }),
      'mutation ReplaceDeliveryArea': () => {
        area = { areaCount: 2, areaFileName: 'Pasted in the app', areaSample: ['302003', '302004'] }
        return { replaceDeliveryArea: 2 }
      },
    }))

    await pick(renderer, 'Only PIN codes I paste')
    await click(renderer, 'Paste a list')
    await type(renderer, 'The PIN codes you deliver to', 'Jaipur')
    await clickLast(renderer, 'Use this list')
    expect(hasText(renderer, 'We couldn’t find any PIN codes in what you pasted.')).toBe(true)
    expect(asked(calls, 'mutation ReplaceDeliveryArea')).toHaveLength(0)

    await type(renderer, 'The PIN codes you deliver to', '302003, 302004 302003 12345')
    await clickLast(renderer, 'Use this list')

    expect(asked(calls, 'mutation ReplaceDeliveryArea')[0]?.variables).toEqual({ f: 'Pasted in the app', c: ['302003', '302004'] })
    expect(hasText(renderer, '2 PIN codes kept. Save shipping to deliver only there.')).toBe(true)
    expect(hasText(renderer, 'Pasted in the app · 2 codes, e.g. 302003, 302004')).toBe(true)
  })

  it('can look but not change in a store that is read-only', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="shipping" />, ship(), { client: fakeClient({ state: readOnlyState }) })

    expect(hasText(renderer, 'Your store is read-only until the bill is paid.')).toBe(true)
    expect(pressablesNamed(renderer, 'Save shipping')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Connect FedEx')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Test all')).toHaveLength(0)
    expect(input(renderer, 'Flat rate (INR)').props.editable).toBe(false)
  })
})

