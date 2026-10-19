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

const sessionOf = (over: Record<string, unknown> = {}) => ({
  id: 'ss1',
  agentName: 'Ravi Kumar',
  partnerName: 'Northstar',
  actingAs: { name: 'Farhan Ali', role: 'owner', supplier: null },
  reason: 'Product photos look blurry',
  ticket: '#4821',
  startedAt: '2026-10-10T10:42:00Z',
  expiresAt: '2026-10-10T11:12:00Z',
  endedAt: '2026-10-10T11:10:00Z',
  endedBy: 'agent',
  access: 'write',
  allowedBy: 'Farhan Ali',
  writeRequest: { state: 'allowed' },
  ...over,
})
const support = (over: Handlers = {}, sessions: unknown[] = [sessionOf()], allowed = true): Handlers => ({
  'query SupportAccess': () => ({ supportAccess: { allowed, sessions: page(sessions) } }),
  ...zone,
  ...over,
})

describe('Support access', () => {
  it('shows the switch, how a session works and who looked, why, when and whether they could change things', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="support" />, support())

    expect(hasText(renderer, 'On. Support can open a read-only session when you ask for help.')).toBe(true)
    expect(hasText(renderer, 'It’s read-only and ends after 30 minutes.')).toBe(true)
    expect(hasText(renderer, 'Support access log')).toBe(true)
    expect(hasText(renderer, 'Ravi Kumar')).toBe(true)
    expect(hasText(renderer, 'Northstar support · as Farhan Ali')).toBe(true)
    expect(hasText(renderer, 'Ticket #4821: Product photos look blurry')).toBe(true)
    expect(hasText(renderer, 'Oct 10, 2026, 16:12 GMT+5:30 · 28 min')).toBe(true)
    expect(hasText(renderer, 'Allowed by Farhan Ali')).toBe(true)
  })

  it('words each way a session can end and whether changes were asked for', async () => {
    const sessions = [
      sessionOf({ id: 'a', access: 'read', allowedBy: null, writeRequest: null, endedBy: 'agent' }),
      sessionOf({ id: 'b', access: 'read', allowedBy: null, writeRequest: { state: 'denied' } }),
      sessionOf({ id: 'c', access: 'read', allowedBy: null, writeRequest: null, endedAt: null, expiresAt: '2000-01-01T00:00:00Z' }),
      sessionOf({ id: 'd', access: 'read', allowedBy: null, writeRequest: { state: 'pending' }, endedAt: null, expiresAt: '2999-01-01T00:00:00Z' }),
    ]
    const { renderer } = await show(<SettingsTabScreen tab="support" />, support({}, sessions))

    expect(hasText(renderer, 'Read-only')).toBe(true)
    expect(hasText(renderer, 'Asked to make changes · denied')).toBe(true)
    expect(hasText(renderer, 'timed out')).toBe(true)
    expect(hasText(renderer, 'Asking to make changes')).toBe(true)
    expect(hasText(renderer, 'Open now · ')).toBe(true)
  })

  it('turns support access off only after saying open sessions end, and says how many did', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="support" />, support({ 'mutation SetSupportAccess': () => ({ setSupportAccess: { allowed: false, ended: 2 } }) }))

    await click(renderer, 'On')
    expect(hasText(renderer, 'Turn off support access?')).toBe(true)
    expect(hasText(renderer, 'Any support session open now ends straight away.')).toBe(true)
    expect(asked(calls, 'mutation SetSupportAccess')).toHaveLength(0)
    await clickLast(renderer, 'Turn off')

    expect(asked(calls, 'mutation SetSupportAccess')[0]?.variables).toEqual({ a: false })
    expect(hasText(renderer, 'Support access is off. 2 open sessions ended.')).toBe(true)
    expect(asked(calls, 'query SupportAccess')).toHaveLength(2)
  })

  it('turns it back on at once, with no question', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="support" />, support({ 'mutation SetSupportAccess': () => ({ setSupportAccess: { allowed: true, ended: 0 } }) }, [], false))

    expect(hasText(renderer, 'Off. Support can only ask you to switch this on.')).toBe(true)
    await click(renderer, 'Off')

    expect(asked(calls, 'mutation SetSupportAccess')[0]?.variables).toEqual({ a: true })
    expect(hasText(renderer, 'Support access is on')).toBe(true)
  })

  it('keeps the switch usable in a store that is read-only, since it is a privacy control', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="support" />, support({ 'mutation SetSupportAccess': () => ({ setSupportAccess: { allowed: true, ended: 0 } }) }, [], false), { client: fakeClient({ state: readOnlyState }) })

    await click(renderer, 'Off')

    expect(asked(calls, 'mutation SetSupportAccess')).toHaveLength(1)
  })

  it('shows a refusal by its code, and keeps the sheet', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="support" />, support({ 'mutation SetSupportAccess': () => { throw new ApiError('FORBIDDEN', 'x') } }))

    await click(renderer, 'On')
    await clickLast(renderer, 'Turn off')

    expect(hasText(renderer, 'Only the store owner can change this.')).toBe(true)
  })

  it('says when no session has been opened yet', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="support" />, support({}, []))

    expect(hasText(renderer, 'No support sessions yet.')).toBe(true)
  })

  it('shows older sessions below the newest, 25 at a time', async () => {
    const { renderer, calls } = await show(
      <SettingsTabScreen tab="support" />,
      support({
        'query SupportAccess': (variables) =>
          variables.after === 'c1' ? { supportAccess: { allowed: true, sessions: page([sessionOf({ id: 'old', agentName: 'Anita Shah' })]) } } : { supportAccess: { allowed: true, sessions: page([sessionOf()], 'c1') } },
      }),
    )

    expect(hasText(renderer, 'Anita Shah')).toBe(false)
    await click(renderer, 'Show older')

    expect(asked(calls, 'query SupportAccess')[1]?.variables).toEqual({ after: 'c1' })
    expect(hasText(renderer, 'Ravi Kumar')).toBe(true)
    expect(hasText(renderer, 'Anita Shah')).toBe(true)
    expect(pressablesNamed(renderer, 'Show older')).toHaveLength(0)
  })
})
