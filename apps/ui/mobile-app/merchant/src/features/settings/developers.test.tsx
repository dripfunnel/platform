import type { ReactElement } from 'react'
import { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '../../graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { actingAs, fakeClient, hasText, press, pressableNamed, pressablesNamed, renderShell } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { SettingsTabScreen } from './SettingsTabScreen'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockSession: { client: ApiClient | null } = { client: null }
const mockCopy = jest.fn<Promise<boolean>, [string]>(async () => true)

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() }),
    useNavigation: () => ({ dispatch: jest.fn() }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  }
})
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('expo-clipboard', () => ({ setStringAsync: (text: string) => mockCopy(text) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
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
// The last button of that name is the one in the sheet that opened over the screen.
const clickLast = async (renderer: ReactTestRenderer, label: string) => {
  await press(pressablesNamed(renderer, label).at(-1) as ReactTestInstance)
  await settle()
}
const textIn = (node: ReactTestInstance): string => node.children.map((child) => (typeof child === 'string' ? child : textIn(child))).join('')
const pick = async (renderer: ReactTestRenderer, label: string) => {
  const row = renderer.root.findAll((node) => node.props.accessibilityRole === 'radio' && typeof node.props.onPress === 'function' && textIn(node).startsWith(label))[0]
  if (!row) throw new Error(`no choice named "${label}"`)
  await press(row)
  await settle()
}
const input = (renderer: ReactTestRenderer, label: string): ReactTestInstance => {
  const found = renderer.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function')[0]
  if (!found) throw new Error(`no field labelled "${label}"`)
  return found
}
const type = async (renderer: ReactTestRenderer, label: string, value: string) => {
  await act(async () => input(renderer, label).props.onChangeText(value))
}
const asked = (calls: Call[], text: string) => calls.filter((call) => call.query.includes(text))

beforeEach(() => {
  jest.clearAllMocks()
  mockCopy.mockImplementation(async () => true)
  resetScenario()
})

const secret = 'dfk_live_7Hq2LmX9Rt4vWp8Zk3NcYb6Ds1'
const page = <T,>(nodes: T[]) => ({ nodes, pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } })
const keyOf = (over: Record<string, unknown> = {}) => ({
  id: 'k1',
  name: 'Warehouse stock sync',
  prefix: 'dfk_7Hq2',
  scopes: ['catalog.read', 'stock.read'],
  supplier: null,
  createdByName: 'Farhan Ali',
  createdByHere: true,
  createdAt: '2026-10-01T10:00:00Z',
  expiresAt: null,
  lastUsedAt: null,
  previousWorksUntil: null,
  ...over,
})
const hookOf = (over: Record<string, unknown> = {}) => ({ id: 'h1', url: 'https://api.kesarithreads.in/dripfunnel', events: ['order.placed', 'order.paid'], status: 'active', failingSince: null, disabledAt: null, createdAt: '2026-10-01T10:00:00Z', ...over })
const deliveryOf = (over: Record<string, unknown> = {}) => ({ id: 'd1', event: 'order.placed', status: 'delivered', attempts: 1, responseCode: 200, error: null, durationMs: 182, createdAt: '2026-10-10T10:44:00Z', ...over })

const developers = (over: Handlers = {}): Handlers => ({
  'query ApiKeys': () => ({ apiKeys: page([keyOf()]) }),
  '{ apiKeyChoices': () => ({ apiKeyChoices: { scopes: ['catalog.read', 'stock.read', 'orders.read', 'customers.read'], expiresInDays: [30, 90, 365], requestsPerMinute: 600, requestsPerMonth: 5000000 } }),
  'query Webhooks': () => ({ webhooks: page([hookOf()]) }),
  '{ webhookEvents }': () => ({ webhookEvents: ['order.placed', 'order.paid', 'order.shipped'] }),
  'query Suppliers': () => ({ suppliers: page([{ id: 's1', name: 'Northwind Textiles', accessLevel: 'vendor-orders-fulfil', shippingMode: 'to-shopper', labelAccount: 'own', status: 'active', users: 2, products: 14 }]) }),
  '{ storeInfo { timeZone } }': () => ({ storeInfo: { timeZone: 'Asia/Kolkata' } }),
  ...over,
})

const createKey = async (renderer: ReactTestRenderer) => {
  await click(renderer, 'Create API key')
  await type(renderer, 'Name', 'Ledger export')
  await click(renderer, 'See orders')
  await clickLast(renderer, 'Create key')
}

describe('Developers › API keys', () => {
  it('lists each key by its prefix with what it can do, when it was used and who made it, and never a secret', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="developers" />, developers())

    expect(hasText(renderer, 'Warehouse stock sync')).toBe(true)
    expect(hasText(renderer, 'dfk_7Hq2…')).toBe(true)
    expect(hasText(renderer, 'See products, See stock · The whole store')).toBe(false)
    expect(hasText(renderer, 'See products, See stock · Whole store')).toBe(true)
    expect(hasText(renderer, 'Never used · Never expires')).toBe(true)
    expect(hasText(renderer, 'Created by Farhan Ali')).toBe(true)
    expect(hasText(renderer, 'Your plan: 600 requests a minute, 5,000,000 a month.')).toBe(true)
  })

  it('says when a key’s maker is no longer here, when it expired, and until when a rotated-from key works', async () => {
    const gone = keyOf({ createdByHere: false, expiresAt: '2020-01-01T00:00:00Z', previousWorksUntil: '2999-01-01T00:00:00Z' })
    const { renderer } = await show(<SettingsTabScreen tab="developers" />, developers({ 'query ApiKeys': () => ({ apiKeys: page([gone]) }) }))

    expect(hasText(renderer, 'Created by Farhan Ali — no longer here')).toBe(true)
    expect(hasText(renderer, 'Expired Jan 1, 2020, 05:30 GMT+5:30')).toBe(true)
    expect(hasText(renderer, 'The old key works until')).toBe(true)
  })

  it('shows the empty state', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="developers" />, developers({ 'query ApiKeys': () => ({ apiKeys: page([]) }), 'query Webhooks': () => ({ webhooks: page([]) }) }))

    expect(hasText(renderer, 'No API keys. Create one when a developer asks for access.')).toBe(true)
    expect(hasText(renderer, 'No endpoints. Add one when a developer gives you an address.')).toBe(true)
  })

  it('asks for a name and something it can do before it sends anything', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="developers" />, developers())

    await click(renderer, 'Create API key')
    await clickLast(renderer, 'Create key')
    expect(hasText(renderer, 'Give it a name you’ll recognise later.')).toBe(true)
    await type(renderer, 'Name', 'Ledger export')
    await clickLast(renderer, 'Create key')
    expect(hasText(renderer, 'Tick at least one thing it can do.')).toBe(true)
    expect(asked(calls, 'mutation CreateApiKey')).toHaveLength(0)
  })

  it('creates a key and shows its secret once, with Copy, then reads the list again', async () => {
    let keys = [keyOf()]
    const { renderer, calls } = await show(
      <SettingsTabScreen tab="developers" />,
      developers({
        'query ApiKeys': () => ({ apiKeys: page(keys) }),
        'mutation CreateApiKey': () => {
          keys = [keyOf({ id: 'k2', name: 'Ledger export', prefix: 'dfk_Rt4v', scopes: ['orders.read'] }), ...keys]
          return { createApiKey: { id: 'k2', prefix: 'dfk_Rt4v', secret } }
        },
      }),
    )

    await createKey(renderer)

    expect(asked(calls, 'mutation CreateApiKey')[0]?.variables).toEqual({ n: 'Ledger export', s: ['orders.read'], v: null, e: 90 })
    expect(hasText(renderer, 'Copy your key now')).toBe(true)
    expect(hasText(renderer, 'This is the only time we show it.')).toBe(true)
    expect(hasText(renderer, secret)).toBe(true)
    expect(hasText(renderer, 'Ledger export')).toBe(true)
    expect(asked(calls, 'query ApiKeys')).toHaveLength(2)

    await click(renderer, 'Copy')
    expect(mockCopy).toHaveBeenCalledWith(secret)
    expect(hasText(renderer, 'Copied')).toBe(true)
  })

  it('shows the secret once: it is gone after “I’ve stored it”, and after leaving the screen', async () => {
    const handlers = developers({ 'mutation CreateApiKey': () => ({ createApiKey: { id: 'k2', prefix: 'dfk_Rt4v', secret } }) })
    const { renderer } = await show(<SettingsTabScreen tab="developers" />, handlers)
    await createKey(renderer)
    expect(hasText(renderer, secret)).toBe(true)

    await click(renderer, 'I’ve stored it')
    expect(hasText(renderer, secret)).toBe(false)

    await createKey(renderer)
    expect(hasText(renderer, secret)).toBe(true)
    await act(async () => renderer.unmount())

    const again = await show(<SettingsTabScreen tab="developers" />, handlers)
    expect(hasText(again.renderer, secret)).toBe(false)
    expect(hasText(again.renderer, 'Copy your key now')).toBe(false)
  })

  it('never reads a secret back: the list asks for no secret field', async () => {
    const { calls } = await show(<SettingsTabScreen tab="developers" />, developers())

    for (const call of asked(calls, 'query ApiKeys')) expect(call.query).not.toMatch(/secret/i)
  })

  it('asks the key to be stored before another is made or rotated', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="developers" />, developers({ 'mutation CreateApiKey': () => ({ createApiKey: { id: 'k2', prefix: 'dfk_Rt4v', secret } }) }))
    await createKey(renderer)

    await click(renderer, 'Create API key')
    expect(hasText(renderer, 'Store the key below before making or rotating another.')).toBe(true)
    expect(asked(calls, 'mutation CreateApiKey')).toHaveLength(1)
  })

  it('binds a key to one active supplier and lets it never expire', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="developers" />, developers({ 'mutation CreateApiKey': () => ({ createApiKey: { id: 'k2', prefix: 'dfk_Rt4v', secret } }) }))

    await click(renderer, 'Create API key')
    await type(renderer, 'Name', 'Northwind feed')
    await click(renderer, 'See stock')
    await pick(renderer, 'Only supplier Northwind Textiles')
    await pick(renderer, 'Never')
    await clickLast(renderer, 'Create key')

    expect(asked(calls, 'mutation CreateApiKey')[0]?.variables).toEqual({ n: 'Northwind feed', s: ['stock.read'], v: 's1', e: null })
  })

  it('keeps the form, with what was typed, and says why when the store has as many keys as it can hold', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="developers" />, developers({ 'mutation CreateApiKey': () => { throw new ApiError('TOO_MANY_KEYS', 'x') } }))

    await createKey(renderer)

    expect(hasText(renderer, 'Your store has as many keys as it can hold. Revoke one first.')).toBe(true)
    expect(input(renderer, 'Name').props.value).toBe('Ledger export')
    expect(hasText(renderer, secret)).toBe(false)
  })

  it('rotates a key after saying the old one keeps working for 24 hours, and shows the new secret once', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="developers" />, developers({ 'mutation RotateApiKey': () => ({ rotateApiKey: { id: 'k1', prefix: 'dfk_New1', secret } }) }))

    await click(renderer, 'Manage Warehouse stock sync')
    await click(renderer, 'Rotate')
    expect(hasText(renderer, 'Rotate Warehouse stock sync?')).toBe(true)
    expect(hasText(renderer, 'The old one keeps working for 24 hours')).toBe(true)
    expect(asked(calls, 'mutation RotateApiKey')).toHaveLength(0)
    await clickLast(renderer, 'Rotate key')

    expect(asked(calls, 'mutation RotateApiKey')[0]?.variables).toEqual({ id: 'k1' })
    expect(hasText(renderer, secret)).toBe(true)
  })

  it('revokes a key only after saying it stops working at once', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="developers" />, developers({ 'mutation RevokeApiKey': () => ({ revokeApiKey: true }) }))

    await click(renderer, 'Manage Warehouse stock sync')
    await click(renderer, 'Revoke')
    expect(hasText(renderer, 'It stops working straight away.')).toBe(true)
    expect(asked(calls, 'mutation RevokeApiKey')).toHaveLength(0)
    await clickLast(renderer, 'Revoke key')

    expect(asked(calls, 'mutation RevokeApiKey')[0]?.variables).toEqual({ id: 'k1' })
    expect(hasText(renderer, 'Warehouse stock sync revoked')).toBe(true)
  })

  it('says so when the phone will not copy', async () => {
    mockCopy.mockImplementation(async () => false)
    const { renderer } = await show(<SettingsTabScreen tab="developers" />, developers({ 'mutation CreateApiKey': () => ({ createApiKey: { id: 'k2', prefix: 'dfk_Rt4v', secret } }) }))
    await createKey(renderer)

    await click(renderer, 'Copy')

    expect(hasText(renderer, 'The phone wouldn’t copy it.')).toBe(true)
  })

  it('can look but not change in a store that is read-only', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="developers" />, developers(), { client: fakeClient({ state: readOnlyState }) })

    expect(hasText(renderer, 'Warehouse stock sync')).toBe(true)
    expect(pressablesNamed(renderer, 'Create API key')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Add endpoint')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Manage Warehouse stock sync')).toHaveLength(0)
  })

  it('says it could not load and tries again', async () => {
    let fails = true
    const { renderer } = await show(
      <SettingsTabScreen tab="developers" />,
      developers({
        'query ApiKeys': () => {
          if (fails) throw new ApiError('NO_RESPONSE', 'x')
          return { apiKeys: page([keyOf()]) }
        },
      }),
    )
    expect(hasText(renderer, 'We couldn’t load Developers')).toBe(true)

    fails = false
    await click(renderer, 'Try again')
    expect(hasText(renderer, 'Warehouse stock sync')).toBe(true)
  })
})

describe('Developers › Webhooks', () => {
  it('shows each endpoint with its events and whether it is working', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="developers" />, developers())

    expect(hasText(renderer, 'https://api.kesarithreads.in/dripfunnel')).toBe(true)
    expect(hasText(renderer, 'order.placed · order.paid')).toBe(true)
    expect(hasText(renderer, 'Working')).toBe(true)
  })

  it('says since when an endpoint is failing, and that a turned-off one lost nothing, with a way to turn it back on', async () => {
    const hooks = [hookOf({ id: 'h1', status: 'failing', failingSince: '2026-10-08T09:00:00Z' }), hookOf({ id: 'h2', url: 'https://old.example.com/hook', status: 'disabled', disabledAt: '2026-10-03T09:12:00Z' })]
    const { renderer, calls } = await show(<SettingsTabScreen tab="developers" />, developers({ 'query Webhooks': () => ({ webhooks: page(hooks) }), 'mutation TurnOnWebhook': () => ({ turnOnWebhook: 3 }) }))

    expect(hasText(renderer, 'Failing since Oct 8, 2026, 14:30 GMT+5:30')).toBe(true)
    expect(hasText(renderer, 'Nothing was lost: events wait for 7 days.')).toBe(true)
    await click(renderer, 'Turn back on')

    expect(asked(calls, 'mutation TurnOnWebhook')[0]?.variables).toEqual({ id: 'h2' })
    expect(hasText(renderer, 'Turned back on. 3 waiting events are being sent.')).toBe(true)
  })

  it('adds an endpoint for an https address and some events, and shows its signing secret once', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="developers" />, developers({ 'mutation AddWebhook': () => ({ saveWebhook: { id: 'h2', secret: 'whsec_abc123' } }) }))

    await click(renderer, 'Add endpoint')
    await type(renderer, 'Endpoint URL', 'http://insecure.example.com')
    await clickLast(renderer, 'Add endpoint')
    expect(hasText(renderer, 'Use an address that starts with https://')).toBe(true)
    await type(renderer, 'Endpoint URL', 'https://api.example.com/df')
    await clickLast(renderer, 'Add endpoint')
    expect(hasText(renderer, 'Pick at least one event.')).toBe(true)
    await click(renderer, 'order.shipped')
    await clickLast(renderer, 'Add endpoint')

    expect(asked(calls, 'mutation AddWebhook')[0]?.variables).toEqual({ u: 'https://api.example.com/df', e: ['order.shipped'] })
    expect(hasText(renderer, 'Copy the signing secret now')).toBe(true)
    expect(hasText(renderer, 'whsec_abc123')).toBe(true)
  })

  it('keeps the form and says so when the address points inside a private network', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="developers" />, developers({ 'mutation AddWebhook': () => { throw new ApiError('PRIVATE_ADDRESS', 'x') } }))

    await click(renderer, 'Add endpoint')
    await type(renderer, 'Endpoint URL', 'https://intranet.example.com/df')
    await click(renderer, 'order.placed')
    await clickLast(renderer, 'Add endpoint')

    expect(hasText(renderer, 'That address points inside a private network.')).toBe(true)
    expect(input(renderer, 'Endpoint URL').props.value).toBe('https://intranet.example.com/df')
  })

  it('opens the latest deliveries with the server’s code and how long each took, and sends one again', async () => {
    const rows = [deliveryOf(), deliveryOf({ id: 'd2', event: 'order.paid', status: 'failed', responseCode: null, error: 'timeout', durationMs: 10000 })]
    const { renderer, calls } = await show(
      <SettingsTabScreen tab="developers" />,
      developers({ 'query Deliveries': () => ({ webhookDeliveries: page(rows) }), 'mutation ReplayDelivery': () => ({ replayDelivery: 'd3' }) }),
    )

    await click(renderer, 'Recent deliveries')
    expect(asked(calls, 'query Deliveries')[0]?.variables).toEqual({ id: 'h1', n: 10 })
    expect(hasText(renderer, '200 · 182 ms')).toBe(true)
    expect(hasText(renderer, 'Timed out · 10 s')).toBe(true)

    await click(renderer, 'Send order.paid again')
    expect(asked(calls, 'mutation ReplayDelivery')[0]?.variables).toEqual({ id: 'd2' })
    expect(hasText(renderer, 'Sent again: order.paid')).toBe(true)
  })

  it('says when there is nothing sent yet, and when the deliveries did not load', async () => {
    const empty = await show(<SettingsTabScreen tab="developers" />, developers({ 'query Deliveries': () => ({ webhookDeliveries: page([]) }) }))
    await click(empty.renderer, 'Recent deliveries')
    expect(hasText(empty.renderer, 'Nothing sent yet.')).toBe(true)

    const failed = await show(<SettingsTabScreen tab="developers" />, developers({ 'query Deliveries': () => { throw new ApiError('NO_RESPONSE', 'x') } }))
    await click(failed.renderer, 'Recent deliveries')
    expect(hasText(failed.renderer, 'The deliveries didn’t load. Try again.')).toBe(true)
  })

  it('shows a refusal to send again on the endpoint’s card', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="developers" />, developers({ 'query Deliveries': () => ({ webhookDeliveries: page([deliveryOf()]) }), 'mutation ReplayDelivery': () => { throw new ApiError('TOO_OLD', 'x') } }))

    await click(renderer, 'Recent deliveries')
    await click(renderer, 'Send order.placed again')

    expect(hasText(renderer, 'Events can be sent again for 7 days.')).toBe(true)
  })
})

describe('the Developers tab’s gate', () => {
  it.each(['manager', 'staff'])('tells %s it has no access, and reads nothing', async (role) => {
    for (const tab of ['developers', 'apps', 'support', 'activity']) {
      const { renderer, calls } = await show(<SettingsTabScreen tab={tab} />, developers(), { acting: actingAs(role) })
      expect(hasText(renderer, 'You don’t have access to Settings')).toBe(true)
      expect(calls).toHaveLength(0)
    }
  })
})
