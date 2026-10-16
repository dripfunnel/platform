import type { ReactElement } from 'react'
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


const usStore: Handlers = { '{ storeInfo {': () => ({ storeInfo: { ...info, country: 'US' } }) }

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
