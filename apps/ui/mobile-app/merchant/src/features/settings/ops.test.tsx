import type { ReactElement } from 'react'
import { AppState, Linking } from 'react-native'
import { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '../../graphql'
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
jest.mock('../../graphql/partnerDomain', () => ({ partnerDomain: () => 'shop.test' }))
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
const total = (calls: Call[]) => calls.map((call) => call.query)

const appStateListeners: ((state: string) => void)[] = []
const mockOpenUrl = jest.spyOn(Linking, 'openURL')

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
  appStateListeners.length = 0
  mockOpenUrl.mockResolvedValue(true)
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, listener: (state: string) => void) => {
    appStateListeners.push(listener)
    return { remove: jest.fn() }
  }) as never)
})

// The phone comes back to the app, as from the browser where a provider was connected.
const comeBack = async () => {
  await act(async () => appStateListeners.forEach((listener) => listener('active')))
  await settle()
}

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

const gateway = (over: Record<string, unknown> = {}) => ({ provider: 'razorpay', label: 'Razorpay', kind: 'gateway', live: false, bankDetails: null, connectable: true, connections: [], ...over })
const liveConnection = (webhookUrl: string | null = null) => ({ mode: 'live', live: true, webhookUrl })
const indiaGateways = [
  gateway(),
  gateway({ provider: 'cashfree', label: 'Cashfree', live: true, connections: [liveConnection('https://hooks.shop.test/cashfree/acc-1')] }),
  gateway({ provider: 'phonepe', label: 'PhonePe', connectable: false }),
  gateway({ provider: 'cod', label: 'Cash on delivery', kind: 'other' }),
  gateway({ provider: 'bank_transfer', label: 'Bank transfer', kind: 'other' }),
]
const usStore: Handlers = { '{ storeInfo {': () => ({ storeInfo: { ...info, country: 'US' } }) }

describe('Payment setup', () => {
  const payments = (over: Handlers = {}, list: unknown[] = indiaGateways): Handlers => ({
    '{ gateways {': () => ({ gateways: list }),
    '{ storeInfo {': () => ({ storeInfo: info }),
    ...over,
  })
  const typeKeys = async (renderer: ReactTestRenderer) => {
    await type(renderer, 'Key id', ' rzp_live_1 ')
    await type(renderer, 'Key secret', 's3cret')
    await type(renderer, 'Webhook secret', 'whsec_1')
  }

  it('lists the region’s ways to pay by what each is, shows a webhook address and no key or secret', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="payments" />, payments())

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Razorpay', 'Cashfree', 'PhonePe', 'Cash on delivery', 'Bank transfer', 'Live', 'Not connected', 'Not set up here yet']))
    expect(hasText(renderer, 'Suggested for India.')).toBe(true)
    expect(hasText(renderer, 'https://hooks.shop.test/cashfree/acc-1')).toBe(true)
    expect(renderer.root.findAll((node) => node.props.secureTextEntry !== undefined)).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Connect PhonePe')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Manage PhonePe')).toHaveLength(0)
  })

  it('says a provider that is not connected is not connected, and a store with no providers says so', async () => {
    const one = await show(<SettingsTabScreen tab="payments" />, payments({}, [gateway()]))
    expect(hasText(one.renderer, 'Not connected')).toBe(true)
    const none = await show(<SettingsTabScreen tab="payments" />, payments({}, []))
    expect(hasText(none.renderer, 'No ways to get paid here yet')).toBe(true)
  })

  it('says it could not load, and loads again on request', async () => {
    let fail = true
    const { renderer, calls } = await show(<SettingsTabScreen tab="payments" />, {
      '{ gateways {': () => {
        if (fail) throw new ApiError('NO_RESPONSE', 'x')
        return { gateways: indiaGateways }
      },
      '{ storeInfo {': () => ({ storeInfo: info }),
    })

    expect(hasText(renderer, 'We couldn’t load Payment setup')).toBe(true)
    fail = false
    await click(renderer, 'Try again')
    expect(asked(calls, '{ gateways {')).toHaveLength(2)
    expect(hasText(renderer, 'Razorpay')).toBe(true)
  })

  it('opens the portal’s Payment setup page in the browser to connect Stripe, after saying what happens, and calls no Stripe operation', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="payments" />, payments(usStore, [gateway({ provider: 'stripe', label: 'Stripe' })]))

    await click(renderer, 'Connect Stripe')
    expect(hasText(renderer, 'Stripe connects on the web portal')).toBe(true)
    expect(mockOpenUrl).not.toHaveBeenCalled()
    await click(renderer, 'Open in browser')

    expect(mockOpenUrl).toHaveBeenCalledTimes(1)
    expect(mockOpenUrl).toHaveBeenCalledWith('https://shop.test/settings/payments')
    expect(total(calls).some((query) => query.includes('connectStripe') || query.includes('finishStripeConnect'))).toBe(false)
    expect(hasText(renderer, 'Opened the web portal in your browser')).toBe(true)
  })

  it('reads the ways to pay again when the person returns to the app, and shows Stripe connected', async () => {
    let connected = false
    const stripe = () => ({ gateways: [gateway({ provider: 'stripe', label: 'Stripe', live: connected, connections: connected ? [liveConnection()] : [] })] })
    const { renderer, calls } = await show(<SettingsTabScreen tab="payments" />, payments({ ...usStore, '{ gateways {': stripe }))
    expect(hasText(renderer, 'Not connected')).toBe(true)

    connected = true
    await comeBack()

    expect(asked(calls, '{ gateways {')).toHaveLength(2)
    expect(hasText(renderer, 'Live')).toBe(true)
    expect(hasText(renderer, 'Not connected')).toBe(false)
  })

  it('connects a provider by its own named keys, masked and trimmed, and never shows them again', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="payments" />, payments({ 'mutation ConnectKeys': () => ({ connectGateway: true }) }))

    await click(renderer, 'Connect Razorpay')
    expect(input(renderer, 'Key secret').props.secureTextEntry).toBe(true)
    expect(input(renderer, 'Webhook secret').props.secureTextEntry).toBe(true)
    expect(input(renderer, 'Key id').props.secureTextEntry).toBe(false)
    await clickLast(renderer, 'Connect')
    expect(hasText(renderer, 'Paste every key to connect.')).toBe(true)
    expect(asked(calls, 'mutation ConnectKeys')).toHaveLength(0)

    await typeKeys(renderer)
    await clickLast(renderer, 'Connect')

    expect(asked(calls, 'mutation ConnectKeys')[0]?.variables).toEqual({ p: 'razorpay', m: 'LIVE', k: { keyId: 'rzp_live_1', keySecret: 's3cret', webhookSecret: 'whsec_1' } })
    expect(hasText(renderer, 'Razorpay connected — shoppers can pay with it now')).toBe(true)
    expect(hasText(renderer, 's3cret')).toBe(false)
    expect(asked(calls, '{ gateways {')).toHaveLength(2)
  })

  it('saves test keys for the preview storefront when that is chosen', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="payments" />, payments({ 'mutation ConnectKeys': () => ({ connectGateway: true }) }))

    await click(renderer, 'Connect Razorpay')
    await pick(renderer, 'Your preview storefront')
    await typeKeys(renderer)
    await clickLast(renderer, 'Connect')

    expect(asked(calls, 'mutation ConnectKeys')[0]?.variables).toMatchObject({ m: 'TEST' })
    expect(hasText(renderer, 'Razorpay test keys saved')).toBe(true)
  })

  it('keeps what was typed and says nothing changed when the provider cannot be reached or refuses the keys', async () => {
    let code = 'PROVIDER_UNAVAILABLE'
    const { renderer } = await show(<SettingsTabScreen tab="payments" />, payments({ 'mutation ConnectKeys': () => { throw new ApiError(code, 'x') } }))

    await click(renderer, 'Connect Razorpay')
    await typeKeys(renderer)
    await clickLast(renderer, 'Connect')
    expect(hasText(renderer, 'We couldn’t reach the provider to check those keys, so nothing changed. Try again in a minute.')).toBe(true)
    expect(input(renderer, 'Key id').props.value).toBe(' rzp_live_1 ')

    code = 'KEYS_REFUSED'
    await clickLast(renderer, 'Connect')
    expect(hasText(renderer, 'The provider didn’t accept those keys.')).toBe(true)
    expect(input(renderer, 'Key secret').props.value).toBe('s3cret')
  })

  it('turns on cash on delivery only after saying what it means', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="payments" />, payments({ 'mutation TurnOnMethod': () => ({ connectGateway: true }) }))

    await click(renderer, 'Set up Cash on delivery')
    expect(hasText(renderer, 'Your courier collects the money.')).toBe(true)
    expect(asked(calls, 'mutation TurnOnMethod')).toHaveLength(0)
    await clickLast(renderer, 'Turn on')

    expect(asked(calls, 'mutation TurnOnMethod')[0]?.variables).toEqual({ p: 'cod', b: null })
    expect(hasText(renderer, 'Cash on delivery is on at checkout')).toBe(true)
  })

  it('needs the bank details a bank transfer shows shoppers, and sends them trimmed', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="payments" />, payments({ 'mutation TurnOnMethod': () => ({ connectGateway: true }) }))

    await click(renderer, 'Set up Bank transfer')
    await clickLast(renderer, 'Turn on')
    expect(hasText(renderer, 'Type the details shoppers pay to.')).toBe(true)
    expect(asked(calls, 'mutation TurnOnMethod')).toHaveLength(0)

    await type(renderer, 'Your bank details', '  Kesari Threads, 1234567890, HDFC0001234 ')
    await clickLast(renderer, 'Turn on')

    expect(asked(calls, 'mutation TurnOnMethod')[0]?.variables).toEqual({ p: 'bank_transfer', b: 'Kesari Threads, 1234567890, HDFC0001234' })
  })

  it('changes a live bank transfer’s details, starting from what shoppers see now', async () => {
    const list = [gateway({ provider: 'bank_transfer', label: 'Bank transfer', kind: 'other', live: true, bankDetails: 'Old details' })]
    const { renderer, calls } = await show(<SettingsTabScreen tab="payments" />, payments({ 'mutation TurnOnMethod': () => ({ connectGateway: true }) }, list))

    expect(hasText(renderer, 'Shoppers see: Old details')).toBe(true)
    await click(renderer, 'Manage Bank transfer')
    await click(renderer, 'Change details')
    expect(input(renderer, 'Your bank details').props.value).toBe('Old details')
    await type(renderer, 'Your bank details', 'New details')
    await clickLast(renderer, 'Change details')

    expect(asked(calls, 'mutation TurnOnMethod')[0]?.variables).toEqual({ p: 'bank_transfer', b: 'New details' })
    expect(hasText(renderer, 'Bank transfer: shoppers see the new details')).toBe(true)
  })

  it('disconnects only after saying shoppers stop seeing it and its keys go', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="payments" />, payments({ 'mutation DisconnectGateway': () => ({ disconnectGateway: true }) }))

    await click(renderer, 'Manage Cashfree')
    await click(renderer, 'Disconnect')
    expect(hasText(renderer, 'Disconnect Cashfree?')).toBe(true)
    expect(hasText(renderer, 'its keys are removed')).toBe(true)
    expect(asked(calls, 'mutation DisconnectGateway')).toHaveLength(0)
    await clickLast(renderer, 'Disconnect')

    expect(asked(calls, 'mutation DisconnectGateway')[0]?.variables).toEqual({ p: 'cashfree' })
    expect(hasText(renderer, 'Cashfree disconnected')).toBe(true)
  })

  it('will not turn off the only live way to get paid, and says so', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="payments" />, payments({ 'mutation DisconnectGateway': () => { throw new ApiError('LAST_METHOD', 'x') } }))

    await click(renderer, 'Manage Cashfree')
    await click(renderer, 'Disconnect')
    await clickLast(renderer, 'Disconnect')

    expect(hasText(renderer, 'You can’t turn off your only way to get paid')).toBe(true)
  })

  it('offers no controls in a store that is read-only', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="payments" />, payments(), { client: fakeClient({ state: readOnlyState }) })

    expect(hasText(renderer, 'Your store is read-only until the bill is paid.')).toBe(true)
    expect(pressablesNamed(renderer, 'Connect Razorpay')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Manage Cashfree')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Set up Cash on delivery')).toHaveLength(0)
  })
})

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

const accountsOf = (over: Record<string, unknown> = {}) => ({ mode: 'both', customers: 1284, withEmail: 812, withPhone: 686, phoneOnly: 214, ...over })

describe('Customer accounts', () => {
  const accounts = (over: Handlers = {}, data: unknown = accountsOf()): Handlers => ({
    '{ customerAccounts {': () => ({ customerAccounts: data }),
    '{ storeInfo {': () => ({ storeInfo: info }),
    ...over,
  })

  it('shows how shoppers sign in now, what they see, who sends the codes and how many accounts each way', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="accounts" />, accounts())

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Email and password', 'Mobile number and a text code', 'Both']))
    expect(hasText(renderer, 'Most shops in India choose this.')).toBe(true)
    expect(hasText(renderer, 'Sign in shows two tabs, Email and Mobile number.')).toBe(true)
    expect(hasText(renderer, 'Codes are sent through your platform’s text-message account (MSG91).')).toBe(true)
    expect(hasText(renderer, '1,284 customer accounts · 812 with email · 686 with a mobile number')).toBe(true)
  })

  it('names Twilio outside India', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="accounts" />, accounts(usStore))

    expect(hasText(renderer, '(Twilio)')).toBe(true)
  })

  it('changes the sign-in only after saying the storefront follows it from now on', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="accounts" />, accounts({ 'mutation SaveCustomerAccounts': () => ({ saveCustomerAccounts: accountsOf({ mode: 'mobile' }) }) }))

    await pick(renderer, 'Mobile number and a text code')
    expect(hasText(renderer, 'Sign in asks for a mobile number, then a code.')).toBe(true)
    await click(renderer, 'Save')
    expect(hasText(renderer, 'Change how shoppers sign in?')).toBe(true)
    expect(hasText(renderer, 'Your storefront’s sign-in follows it from now on.')).toBe(true)
    expect(asked(calls, 'mutation SaveCustomerAccounts')).toHaveLength(0)
    await clickLast(renderer, 'Save')

    expect(asked(calls, 'mutation SaveCustomerAccounts')[0]?.variables).toEqual({ m: 'mobile' })
    expect(hasText(renderer, 'Saved. Your storefront’s sign-in follows it from now on.')).toBe(true)
  })

  it('warns, with the count, that phone-only shoppers cannot sign in while only email is taken', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="accounts" />, accounts())

    await pick(renderer, 'Email and password')
    expect(hasText(renderer, '214 customers have only a mobile number.')).toBe(true)
    await click(renderer, 'Save')
    expect(hasText(renderer, 'can’t sign in while your storefront takes email only')).toBe(true)
  })

  it('says one customer when there is one', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="accounts" />, accounts({}, accountsOf({ phoneOnly: 1 })))

    await pick(renderer, 'Email and password')
    expect(hasText(renderer, '1 customer has only a mobile number.')).toBe(true)
  })

  it('does not offer saving what has not changed, and does once it has', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="accounts" />, accounts())

    expect(pressableNamed(renderer, 'Save').props.disabled).toBe(true)
    await pick(renderer, 'Email and password')
    expect(pressableNamed(renderer, 'Save').props.disabled).toBe(false)
  })

  it('shows a refusal by its code and keeps the sheet', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="accounts" />, accounts({ 'mutation SaveCustomerAccounts': () => { throw new ApiError('INVALID_INPUT', 'x') } }))

    await pick(renderer, 'Mobile number and a text code')
    await click(renderer, 'Save')
    await clickLast(renderer, 'Save')

    expect(hasText(renderer, 'Choose email, mobile or both.')).toBe(true)
  })

  it('can look but not change in a store that is read-only', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="accounts" />, accounts(), { client: fakeClient({ state: readOnlyState }) })

    expect(hasText(renderer, 'Your store is read-only until the bill is paid.')).toBe(true)
    expect(pressablesNamed(renderer, 'Save')).toHaveLength(0)
  })
})
