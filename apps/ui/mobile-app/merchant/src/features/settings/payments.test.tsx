import type { ReactElement } from 'react'
import { AppState, Linking } from 'react-native'
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

  it('leaves the country out of the note about several live providers when the store’s country could not be read', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="payments" />, payments({ '{ storeInfo {': () => { throw new ApiError('NO_RESPONSE', 'x') } }))

    expect(hasText(renderer, 'With more than one live, shoppers pick at checkout.')).toBe(true)
    expect(hasText(renderer, 'Suggested for')).toBe(false)
    expect(hasText(renderer, 'Razorpay')).toBe(true)
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

