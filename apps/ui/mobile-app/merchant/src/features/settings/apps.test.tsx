import type { ReactElement } from 'react'
import { Linking } from 'react-native'
import { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '../../graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { fakeClient, hasText, press, pressableNamed, pressablesNamed, renderShell } from '../../testing/harness'
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
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))

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
const clickLast = async (renderer: ReactTestRenderer, label: string) => {
  await press(pressablesNamed(renderer, label).at(-1) as ReactTestInstance)
  await settle()
}
const type = async (renderer: ReactTestRenderer, label: string, value: string) => {
  const found = renderer.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function')[0]
  if (!found) throw new Error(`no field labelled "${label}"`)
  await act(async () => found.props.onChangeText(value))
}
const asked = (calls: Call[], text: string) => calls.filter((call) => call.query.includes(text))

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
})

const page = <T,>(nodes: T[], next: string | null = null) => ({ nodes, pageInfo: { hasNextPage: next !== null, hasPreviousPage: false, startCursor: null, endCursor: next } })
const zone = { '{ storeInfo { timeZone } }': () => ({ storeInfo: { timeZone: 'Asia/Kolkata' } }) }

const appId = 'c0a80101-1234-4abc-8def-0123456789ab'
const appOf = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  appId,
  name: 'Ledger Sync',
  developer: 'Tally Bridges Pvt Ltd',
  siteUrl: 'https://ledgersync.app',
  scopes: ['orders.read', 'catalog.read'],
  suspended: false,
  installedByName: 'Farhan Ali',
  installedAt: '2026-10-05T10:00:00Z',
  lastUsedAt: null,
  connection: 'sent',
  ...over,
})
const installable = (over: Record<string, unknown> = {}) => ({ id: appId, name: 'Ledger Sync', developer: 'Tally Bridges Pvt Ltd', siteUrl: 'https://ledgersync.app', scopes: ['orders.read', 'catalog.read'], ...over })
const apps = (over: Handlers = {}): Handlers => ({ 'query Apps': () => ({ apps: page([appOf()]) }), ...zone, ...over })

describe('Apps', () => {
  it('lists each app with its developer, who installed it, and what it can see', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="apps" />, apps())

    expect(hasText(renderer, 'Ledger Sync')).toBe(true)
    expect(hasText(renderer, 'By Tally Bridges Pvt Ltd · installed Oct 5, 2026, 15:30 GMT+5:30 by Farhan Ali')).toBe(true)
    expect(hasText(renderer, 'Can: See your orders, refunds and invoices, See your products and prices')).toBe(true)
  })

  it('opens an app on its own site only when that is an https address', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
    const secure = await show(<SettingsTabScreen tab="apps" />, apps())
    await click(secure.renderer, 'Open app')
    expect(open).toHaveBeenCalledWith('https://ledgersync.app')

    const plain = await show(<SettingsTabScreen tab="apps" />, apps({ 'query Apps': () => ({ apps: page([appOf({ siteUrl: 'http://ledgersync.app' })]) }) }))
    expect(pressablesNamed(plain.renderer, 'Open app')).toHaveLength(0)
  })

  it('says when an app is paused, never received its access, or is still being handed it', async () => {
    const { renderer } = await show(
      <SettingsTabScreen tab="apps" />,
      apps({ 'query Apps': () => ({ apps: page([appOf({ id: 'a1', suspended: true }), appOf({ id: 'a2', connection: 'failed' }), appOf({ id: 'a3', connection: 'waiting' })]) }) }),
    )

    expect(hasText(renderer, 'Paused by your platform')).toBe(true)
    expect(hasText(renderer, 'It never received its access. Remove it and install it again.')).toBe(true)
    expect(hasText(renderer, 'Still handing it its access.')).toBe(true)
  })

  it('shows the empty state', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="apps" />, apps({ 'query Apps': () => ({ apps: page([]) }) }))

    expect(hasText(renderer, 'No apps yet. When a developer gives you an install link, add it here.')).toBe(true)
  })

  it('reads the app’s id from an install link, shows what it will and won’t be able to do, and installs with the access it showed', async () => {
    const { renderer, calls } = await show(
      <SettingsTabScreen tab="apps" />,
      apps({ 'query Installable': () => ({ installableApp: installable() }), 'mutation InstallApp': () => ({ installApp: 'a2' }) }),
    )

    await click(renderer, 'Add an app')
    await type(renderer, 'Install link', `https://ledgersync.app/install/${appId}?ref=x`)
    await clickLast(renderer, 'Continue')

    expect(asked(calls, 'query Installable')[0]?.variables).toEqual({ id: appId })
    expect(hasText(renderer, 'Install Ledger Sync?')).toBe(true)
    expect(hasText(renderer, 'It will be able to')).toBe(true)
    expect(hasText(renderer, '• See your orders, refunds and invoices')).toBe(true)
    expect(hasText(renderer, 'It won’t be able to')).toBe(true)
    expect(hasText(renderer, '• Change anything in your store')).toBe(true)
    expect(asked(calls, 'mutation InstallApp')).toHaveLength(0)

    await clickLast(renderer, 'Install')
    expect(asked(calls, 'mutation InstallApp')[0]?.variables).toEqual({ a: appId, s: ['orders.read', 'catalog.read'] })
    expect(hasText(renderer, 'Ledger Sync installed. Open it to finish setting it up.')).toBe(true)
  })

  it('refuses a link that is not https, and one that names no app', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="apps" />, apps())

    await click(renderer, 'Add an app')
    await type(renderer, 'Install link', 'http://ledgersync.app/install/x')
    await clickLast(renderer, 'Continue')
    expect(hasText(renderer, 'Paste a link that starts with https://')).toBe(true)

    await type(renderer, 'Install link', 'https://ledgersync.app/install/ledger')
    await clickLast(renderer, 'Continue')
    expect(hasText(renderer, 'That link doesn’t name an app. Ask the developer for its install link.')).toBe(true)
    expect(asked(calls, 'query Installable')).toHaveLength(0)
  })

  it('says the same when no app has the id the link names', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="apps" />, apps({ 'query Installable': () => ({ installableApp: null }) }))

    await click(renderer, 'Add an app')
    await type(renderer, 'Install link', `https://ledgersync.app/install/${appId}`)
    await clickLast(renderer, 'Continue')

    expect(hasText(renderer, 'That link doesn’t name an app.')).toBe(true)
  })

  it('shows what an app asks for now when it asked for different access since the Owner looked', async () => {
    let scopes = ['orders.read']
    const { renderer } = await show(
      <SettingsTabScreen tab="apps" />,
      apps({
        'query Installable': () => ({ installableApp: installable({ scopes }) }),
        'mutation InstallApp': () => {
          scopes = ['orders.read', 'customers.read']
          throw new ApiError('SCOPES_CHANGED', 'x')
        },
      }),
    )

    await click(renderer, 'Add an app')
    await type(renderer, 'Install link', `https://ledgersync.app/install/${appId}`)
    await clickLast(renderer, 'Continue')
    expect(hasText(renderer, '• See your customers')).toBe(false)
    await clickLast(renderer, 'Install')

    expect(hasText(renderer, 'This app now asks for different access. Look again before installing.')).toBe(true)
    expect(hasText(renderer, '• See your customers')).toBe(true)
  })

  it('removes an app only after saying its access ends and what it copied stays with it', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="apps" />, apps({ 'mutation UninstallApp': () => ({ uninstallApp: true }) }))

    await click(renderer, 'Remove')
    expect(hasText(renderer, 'Remove Ledger Sync?')).toBe(true)
    expect(hasText(renderer, 'Its access ends now. Anything it already copied stays with it')).toBe(true)
    expect(asked(calls, 'mutation UninstallApp')).toHaveLength(0)
    await clickLast(renderer, 'Remove app')

    expect(asked(calls, 'mutation UninstallApp')[0]?.variables).toEqual({ id: 'a1' })
    expect(hasText(renderer, 'Ledger Sync removed')).toBe(true)
  })

  it('can look but not change in a store that is read-only', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="apps" />, apps(), { client: fakeClient({ state: readOnlyState }) })

    expect(hasText(renderer, 'Ledger Sync')).toBe(true)
    expect(pressablesNamed(renderer, 'Add an app')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Remove')).toHaveLength(0)
  })
})
