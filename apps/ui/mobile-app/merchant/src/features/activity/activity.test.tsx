import type { ReactElement } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { actingAs, fakeClient, hasText, press, pressableNamed, pressablesNamed, renderShell } from '../../testing/harness'
import { shareCsv } from '../common/shareCsv'
import { SettingsTabScreen } from '../settings/SettingsTabScreen'
import { resetScenario } from '../states/scenario'
import { ActivityScreen } from './ActivityScreen'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockSession: { client: ApiClient | null } = { client: null }
const mockPush = jest.fn()

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), navigate: jest.fn() }),
    useNavigation: () => ({ dispatch: jest.fn() }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  }
})
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))
jest.mock('../common/shareCsv', () => ({ shareCsv: jest.fn(async () => true) }))

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

const page = (items: unknown[], next: string | null = null) => ({ items, pageInfo: { hasNextPage: next !== null, endCursor: next } })
const entry = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  at: '2026-10-10T10:49:00Z',
  category: 'orders',
  action: 'order.refunded',
  result: 'success',
  actor: { kind: 'person', id: 'm-priya', label: 'Priya Shah <priya@kesarithreads.in>' },
  onBehalfOf: null,
  through: null,
  target: { type: 'order', id: 'o-1031', label: 'KT-1031' },
  changes: [{ field: 'Refunded', before: '₹0', after: '₹30' }],
  reason: 'Arrived damaged',
  ...over,
})

const manager = ['activity.read']
const owner = ['activity.read', 'activity.export']
const log = (permissions: string[], entries: unknown[] = [entry()], over: Handlers = {}): Handlers => ({
  'acting { permissions': () => ({ me: { acting: { permissions, seller: null } } }),
  '{ storeInfo { timeZone } }': () => ({ storeInfo: { timeZone: 'Asia/Kolkata' } }),
  'query Activity(': () => ({ activityLog: page(entries) }),
  ...over,
})

describe('Store activity (the Manager’s)', () => {
  it('shows each entry in words: who, what, Done or Refused, and when', async () => {
    const refused = entry({ id: 'e2', action: 'settings.opened', result: 'denied', actor: { kind: 'person', id: 'm-tom', label: 'Tom Okafor <tom@kesarithreads.in>' }, target: null, changes: [], reason: null })
    const { renderer } = await show(<ActivityScreen />, log(manager, [entry(), refused]))

    expect(hasText(renderer, 'Store activity')).toBe(true)
    expect(hasText(renderer, 'Priya Shah refunded order KT-1031')).toBe(true)
    expect(hasText(renderer, 'Done')).toBe(true)
    expect(hasText(renderer, 'Refused')).toBe(true)
    expect(hasText(renderer, 'Oct 10, 2026, 16:19 GMT+5:30')).toBe(true)
  })

  it('never shows a person’s email, a code the app has no words for names itself, and an address-only label is “Someone without a name”', async () => {
    const odd = entry({ id: 'e2', action: 'gizmo.turned', actor: { kind: 'customer', id: 'c1', label: 'ananya@example.com' }, target: null })
    const { renderer } = await show(<ActivityScreen />, log(manager, [entry(), odd]))

    expect(hasText(renderer, 'priya@kesarithreads.in')).toBe(false)
    expect(hasText(renderer, 'ananya@example.com')).toBe(false)
    expect(hasText(renderer, 'Someone without a name gizmo.turned')).toBe(true)
  })

  it('reads the same log as the Owner but has no export: the button is off, and says why', async () => {
    const { renderer, calls } = await show(<ActivityScreen />, log(manager))

    expect(pressableNamed(renderer, 'Export CSV').props.disabled).toBe(true)
    expect(hasText(renderer, 'Only the store owner can export')).toBe(true)
    await press(pressableNamed(renderer, 'Export CSV'))
    await settle()
    expect(asked(calls, 'ExportActivity')).toHaveLength(0)
  })

  it('opens an entry to show its changes, reason and the support session it came through', async () => {
    const viaSupport = entry({ through: { kind: 'support_session', id: 's1' } })
    const { renderer } = await show(<ActivityScreen />, log(manager, [viaSupport]))

    expect(hasText(renderer, 'Reason: Arrived damaged')).toBe(false)
    await click(renderer, 'Details of: Priya Shah refunded order KT-1031')

    expect(hasText(renderer, 'Refunded: ₹0 → ₹30')).toBe(true)
    expect(hasText(renderer, 'Reason: Arrived damaged')).toBe(true)
    expect(hasText(renderer, 'During a DripFunnel support session')).toBe(true)
  })

  it('names the agent behind a support session, and shows everything in that session', async () => {
    const support = entry({
      action: 'support_session.viewed',
      actor: { kind: 'support_session', id: 'sess-1', label: 'Support session' },
      onBehalfOf: { kind: 'partner_user', id: 'pu-1', label: 'Ravi Kumar <ravi@northstar.example>' },
      target: { type: 'page', id: null, label: 'Products' },
      changes: [],
      reason: null,
    })
    const { renderer, calls } = await show(<ActivityScreen />, log(manager, [support]))

    expect(hasText(renderer, 'Ravi Kumar looked at Products')).toBe(true)
    await click(renderer, 'Details of: Ravi Kumar looked at Products')
    await click(renderer, 'Everything in this support session')

    expect(asked(calls, 'query Activity(').at(-1)?.variables).toEqual({ f: { personKind: 'support_session', personId: 'sess-1' }, after: null })
  })

  it('follows one person from an entry, says whose, and goes back to everyone', async () => {
    const { renderer, calls } = await show(<ActivityScreen />, log(manager))

    await click(renderer, 'Details of: Priya Shah refunded order KT-1031')
    await click(renderer, 'Everything by Priya Shah')
    expect(asked(calls, 'query Activity(').at(-1)?.variables).toEqual({ f: { personKind: 'person', personId: 'm-priya' }, after: null })
    expect(hasText(renderer, 'Showing everything by Priya Shah · Team member in this store.')).toBe(true)

    await click(renderer, 'Everyone')
    expect(asked(calls, 'query Activity(').at(-1)?.variables).toEqual({ f: {}, after: null })
  })

  it('filters by what was done, and by words after typing settles', async () => {
    const { renderer, calls } = await show(<ActivityScreen />, log(manager))

    await click(renderer, 'Orders and refunds')
    expect(asked(calls, 'query Activity(').at(-1)?.variables).toEqual({ f: { what: 'orders' }, after: null })

    const before = asked(calls, 'query Activity(').length
    await type(renderer, 'Search', 'priya')
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 100))))
    expect(asked(calls, 'query Activity(')).toHaveLength(before)
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 400))))
    await settle()
    expect(asked(calls, 'query Activity(').at(-1)?.variables).toEqual({ f: { what: 'orders', search: 'priya' }, after: null })
  })

  it('drops a slow answer to an earlier filter, so the log never shows entries for a filter that is no longer chosen', async () => {
    let release = () => {}
    const slow = new Promise<void>((resolve) => (release = resolve))
    const { renderer } = await show(
      <ActivityScreen />,
      log(manager, [], {
        'query Activity(': async (variables) => {
          if ((variables.f as Record<string, unknown>).what === undefined) {
            await slow
            return { activityLog: page([entry({ id: 'old', action: 'product.created', target: { type: 'product', id: 'p9', label: 'Slow Dress' } })]) }
          }
          return { activityLog: page([entry({ id: 'new' })]) }
        },
      }),
    )

    await click(renderer, 'Orders and refunds')
    expect(hasText(renderer, 'Priya Shah refunded order KT-1031')).toBe(true)
    release()
    await settle()

    expect(hasText(renderer, 'Slow Dress')).toBe(false)
    expect(hasText(renderer, 'Priya Shah refunded order KT-1031')).toBe(true)
  })

  it('drops older entries that arrive after the filter changed, rather than adding them to the new log', async () => {
    let release = () => {}
    const slow = new Promise<void>((resolve) => (release = resolve))
    const { renderer } = await show(
      <ActivityScreen />,
      log(manager, [], {
        'query Activity(': async (variables) => {
          if (variables.after === 'c1') {
            await slow
            return { activityLog: page([entry({ id: 'late', action: 'product.created', target: { type: 'product', id: 'p9', label: 'Late Dress' } })]) }
          }
          return (variables.f as Record<string, unknown>).what === undefined ? { activityLog: page([entry()], 'c1') } : { activityLog: page([entry({ id: 'fresh', action: 'product.created', target: { type: 'product', id: 'p8', label: 'Fresh Tee' } })]) }
        },
      }),
    )

    await click(renderer, 'Show older')
    await click(renderer, 'Orders and refunds')
    expect(hasText(renderer, 'Priya Shah added Fresh Tee')).toBe(true)
    release()
    await settle()

    expect(hasText(renderer, 'Late Dress')).toBe(false)
    expect(hasText(renderer, 'Priya Shah added Fresh Tee')).toBe(true)
  })

  it('shows 50 at a time, with older entries below', async () => {
    const { renderer, calls } = await show(
      <ActivityScreen />,
      log(manager, [], { 'query Activity(': (variables) => (variables.after === 'c1' ? { activityLog: page([entry({ id: 'e2', action: 'product.created', target: { type: 'product', id: 'p1', label: 'Linen Midi Dress' } })]) } : { activityLog: page([entry()], 'c1') }) }),
    )

    expect(hasText(renderer, 'Linen Midi Dress')).toBe(false)
    await click(renderer, 'Show older')

    expect(asked(calls, 'query Activity(')[1]?.variables).toMatchObject({ after: 'c1' })
    expect(hasText(renderer, 'Priya Shah added Linen Midi Dress')).toBe(true)
    expect(hasText(renderer, 'Searchable for 13 months.')).toBe(true)
  })

  it('opens a product or an order from its entry, and offers no link for anything else', async () => {
    const product = entry({ id: 'e2', action: 'product.updated', target: { type: 'product', id: 'p1', label: 'Organic Cotton Tee' } })
    const market = entry({ id: 'e3', action: 'market.saved', target: { type: 'market', id: 'mk1', label: 'Europe' } })
    const { renderer } = await show(<ActivityScreen />, log(manager, [entry(), product, market]))

    await click(renderer, 'Details of: Priya Shah refunded order KT-1031')
    await click(renderer, 'Open KT-1031')
    expect(mockPush).toHaveBeenCalledWith('/orders/o-1031')

    await click(renderer, 'Details of: Priya Shah changed Organic Cotton Tee')
    await click(renderer, 'Open Organic Cotton Tee')
    expect(mockPush).toHaveBeenCalledWith('/catalogue/p1')

    await click(renderer, 'Details of: Priya Shah saved market Europe')
    expect(pressablesNamed(renderer, 'Open Europe')).toHaveLength(0)
  })

  it('says nothing has happened yet, and that nothing matches a filter', async () => {
    const empty = await show(<ActivityScreen />, log(manager, []))
    expect(hasText(empty.renderer, 'Nothing has happened in this store yet.')).toBe(true)

    await click(empty.renderer, 'Orders and refunds')
    expect(hasText(empty.renderer, 'Nothing matches.')).toBe(true)
  })

  it('says it could not load, and tries again', async () => {
    let fails = true
    const { renderer } = await show(
      <ActivityScreen />,
      log(manager, [], {
        'query Activity(': () => {
          if (fails) throw new ApiError('NO_RESPONSE', 'x')
          return { activityLog: page([entry()]) }
        },
      }),
    )
    expect(hasText(renderer, 'The activity log didn’t load')).toBe(true)

    fails = false
    await click(renderer, 'Try again')
    expect(hasText(renderer, 'Priya Shah refunded order KT-1031')).toBe(true)
  })

  it('says older entries did not load, and keeps the ones shown', async () => {
    const { renderer } = await show(
      <ActivityScreen />,
      log(manager, [], { 'query Activity(': (variables) => { if (variables.after === 'c1') throw new ApiError('NO_RESPONSE', 'x'); return { activityLog: page([entry()], 'c1') } } }),
    )

    await click(renderer, 'Show older')

    expect(hasText(renderer, 'Older entries didn’t load. Try again.')).toBe(true)
    expect(hasText(renderer, 'Priya Shah refunded order KT-1031')).toBe(true)
  })

  it('tells Staff it has no access, before the log is asked for', async () => {
    const { renderer, calls } = await show(<ActivityScreen />, log([]), { acting: actingAs('staff') })

    expect(hasText(renderer, 'You don’t have access to Store activity')).toBe(true)
    expect(asked(calls, 'query Activity(')).toHaveLength(0)
    expect(hasText(renderer, 'Export CSV')).toBe(false)
  })

  it('tells a supplier it has no access too, even with the permission listed', async () => {
    const handlers = log(manager, [entry()], { 'acting { permissions': () => ({ me: { acting: { permissions: manager, seller: { id: 'supplier-1' } } } }) })
    const { renderer, calls } = await show(<ActivityScreen />, handlers, { acting: actingAs('supplier-member', 'vendor-orders-fulfil') })

    expect(hasText(renderer, 'You don’t have access to Store activity')).toBe(true)
    expect(asked(calls, 'query Activity(')).toHaveLength(0)
  })

  it('shows what the API refuses as no access, in the log’s own words', async () => {
    const { renderer } = await show(<ActivityScreen />, log(manager, [], { 'query Activity(': () => { throw new ApiError('FORBIDDEN', 'x') } }))

    expect(hasText(renderer, 'Store activity is for the store’s owner and managers')).toBe(true)
  })

  it('says the store is read-only and still shows the log', async () => {
    const { renderer } = await show(<ActivityScreen />, log(manager), { client: fakeClient({ state: readOnlyState }) })

    expect(hasText(renderer, 'The log and its export still work.')).toBe(true)
    expect(hasText(renderer, 'Priya Shah refunded order KT-1031')).toBe(true)
  })
})

describe('Activity log (the Owner’s Settings tab)', () => {
  const csv = 'when,who,what\n2026-10-10,Priya Shah,refunded'
  const exportJob = (job: Record<string, unknown>): Handlers => ({
    'mutation ExportActivity': () => ({ exportActivity: 'x1' }),
    'query ActivityExport': () => ({ activityExport: { id: 'x1', rows: null, truncated: null, csv: null, expiresAt: null, ...job } }),
  })

  it('shows the Owner the same log in Settings, under Activity log', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="activity" />, log(owner))

    expect(hasText(renderer, 'Activity log')).toBe(true)
    expect(hasText(renderer, 'Priya Shah refunded order KT-1031')).toBe(true)
    expect(asked(calls, 'query Activity(')).toHaveLength(1)
  })

  it('has the export the Manager lacks, for the log as it is filtered, and hands the CSV to the share sheet', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="activity" />, log(owner, [entry()], exportJob({ state: 'done', rows: 1, truncated: false, csv, expiresAt: '2026-10-10T12:00:00Z' })))

    expect(hasText(renderer, 'Only the store owner can export')).toBe(false)
    await click(renderer, 'Orders and refunds')
    await click(renderer, 'Export CSV')

    expect(asked(calls, 'mutation ExportActivity')[0]?.variables).toEqual({ f: { what: 'orders' } })
    expect(shareCsv).toHaveBeenCalledWith('Activity log', csv)
    expect(hasText(renderer, '1 entry is ready.')).toBe(true)
  })

  it('says when the export is cut, too large or failed', async () => {
    const run = async (job: Record<string, unknown>) => {
      const { renderer } = await show(<SettingsTabScreen tab="activity" />, log(owner, [entry()], exportJob(job)))
      await click(renderer, 'Export CSV')
      return renderer
    }

    expect(hasText(await run({ state: 'done', rows: 10000, truncated: true, csv }), 'Only the first 10,000 entries are in it')).toBe(true)
    expect(hasText(await run({ state: 'too_large' }), 'That export is too large.')).toBe(true)
    expect(hasText(await run({ state: 'failed' }), 'The export couldn’t be made.')).toBe(true)
    expect(hasText(await run({ state: 'expired' }), 'That export’s link has expired.')).toBe(true)
  })

  it('says so when the export cannot be read back, instead of preparing for ever', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="activity" />, log(owner, [entry()], { 'mutation ExportActivity': () => ({ exportActivity: 'x1' }), 'query ActivityExport': () => { throw new ApiError('NO_RESPONSE', 'x') } }))

    await click(renderer, 'Export CSV')

    expect(hasText(renderer, 'We couldn’t reach the server. Check your connection and try again.')).toBe(true)
    expect(hasText(renderer, 'Preparing your CSV…')).toBe(false)
    expect(shareCsv).not.toHaveBeenCalled()
  })

  it('shows a refusal of the export by its code', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="activity" />, log(owner, [entry()], { 'mutation ExportActivity': () => { throw new ApiError('FORBIDDEN', 'x') } }))

    await click(renderer, 'Export CSV')

    expect(hasText(renderer, 'Only the store owner can export the activity log.')).toBe(true)
    expect(shareCsv).not.toHaveBeenCalled()
  })

  it('still reads and exports in a store that is read-only', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="activity" />, log(owner, [entry()], exportJob({ state: 'done', rows: 1, truncated: false, csv: 'when,who' })), { client: fakeClient({ state: readOnlyState }) })

    expect(hasText(renderer, 'Priya Shah refunded order KT-1031')).toBe(true)
    await click(renderer, 'Export CSV')
    expect(asked(calls, 'mutation ExportActivity')).toHaveLength(1)
  })

  it('is for the Owner alone: a Manager who opens the tab is told it has no access, and nothing is read', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="activity" />, log(manager), { acting: actingAs('manager') })

    expect(hasText(renderer, 'You don’t have access to Settings')).toBe(true)
    expect(calls).toHaveLength(0)
  })
})
