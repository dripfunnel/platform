import type { ReactElement } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '../../graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { actingAs, fakeClient, hasText, press, pressableNamed, pressablesNamed, renderShell, texts } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { CartScreen } from './CartScreen'
import { CartsScreen } from './CartsScreen'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockPush = jest.fn()
const mockPrevent = jest.fn()
const mockNet: { emit: (state: { isConnected: boolean; isInternetReachable: boolean }) => void } = { emit: () => undefined }
const mockSession: { client: ApiClient | null } = { client: null }

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), navigate: jest.fn() }),
    useNavigation: () => ({ dispatch: jest.fn() }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  }
})
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: (...args: unknown[]) => mockPrevent(...args) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: (state: { isConnected: boolean; isInternetReachable: boolean }) => void) => {
      mockNet.emit = listener
      return () => undefined
    },
  },
}))
jest.mock('../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))

// The fake network answers over several promise turns; jest-expo runs timers faked, so wait on promises, not on a timer.
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

type Handlers = Record<string, (variables: Record<string, unknown>, headers: Record<string, string>) => unknown>
type Options = Parameters<typeof renderShell>[1]

const owner = ['carts.read', 'carts.write', 'orders.read', 'customers.read']
const staff = ['carts.read', 'orders.read', 'customers.read']
const access = (permissions: string[], seller: { id: string } | null = null) => ({ me: { acting: { permissions, seller } } })
const paged = <T,>(nodes: T[], next: string | null = null) => ({ abandonedCarts: { nodes, pageInfo: { hasNextPage: next !== null, hasPreviousPage: false, startCursor: null, endCursor: next } } })
const readOnlyState = { readOnly: true, status: null, trialEndsAt: null, pastDueSince: null, provisioning: null, support: null }

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
const inr = (amount: string) => ({ amount, currency: 'INR' })

const cart = (id: string, name: string | null, over: Record<string, unknown> = {}) => ({
  id,
  name,
  email: name ? `${id}@example.in` : null,
  phone: null,
  customerId: null,
  value: inr('249900'),
  step: 'pay',
  abandonedAt: ago(25),
  status: 'waiting',
  skipReason: null,
  firstItem: 'Silk saree',
  lineCount: 1,
  remindersSent: 0,
  lastSentAt: null,
  stoppedAt: null,
  stoppedBy: null,
  stoppedNote: null,
  recoveredOrderId: null,
  recoveredOrderNumber: null,
  recoveredWithCode: false,
  ...over,
})

const step = (position: number, over: Record<string, unknown> = {}) => ({ position, enabled: true, delayMinutes: [60, 1440, 4320][position - 1], channel: 'email', subject: `Subject ${position}`, body: `Body ${position}`, discountPercent: null, ...over })
const settingsOf = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  minimum: inr('200000'),
  skipOutOfStock: true,
  quietHours: true,
  weeklyCap: true,
  steps: [step(1), step(2), step(3)],
  revision: 4,
  level: 'automatic',
  ...over,
})

const detailOf = (over: Record<string, unknown> = {}) => ({
  cart: cart('ab-2', 'Ananya Rao', { status: 'reminded', customerId: 'c-1', remindersSent: 1, lastSentAt: ago(120), lineCount: 2, step: 'ship' }),
  lines: [
    { versionId: 'v-1', name: 'Linen kurta', versionName: 'M', quantity: 1, lineTotal: inr('249900'), available: 3, outOfStock: false },
    { versionId: 'v-2', name: 'Block-print dupatta', versionName: null, quantity: 2, lineTotal: inr('168100'), available: 0, outOfStock: true },
  ],
  reminders: [{ id: 'r-1', position: 1, channel: 'email', state: 'sent', skipReason: null, sentBy: null, code: null, queuedAt: ago(121), sentAt: ago(120), clickedAt: ago(100) }],
  ...over,
})

const list = (over: Handlers = {}): Handlers => ({
  'acting { permissions': () => access(owner),
  'query Carts(': () => paged([cart('ab-1', 'Vikram Shah'), cart('ab-2', 'Ananya Rao', { status: 'reminded', remindersSent: 1, lastSentAt: ago(120), lineCount: 2 })]),
  abandonedCartCounts: () => ({ abandonedCartCounts: { open: 2, recovered: 1, lost: 3 } }),
  cartSummary: () => ({ cartSummary: { days: 14, abandoned: 7, leftBehind: [inr('1544500')], remindersSent: 5, reachable: 6, recovered: 1, recoveredSales: [inr('358000')], recoveredWithCode: 1 } }),
  'reminderSettings { enabled level }': () => ({ reminderSettings: { enabled: true, level: 'automatic' } }),
  '{ storeInfo { country }': () => ({ storeInfo: { country: 'IN' } }),
  '{ storeLocale { pricingCurrency }': () => ({ storeLocale: { pricingCurrency: 'INR' } }),
  ...over,
})

const detail = (over: Handlers = {}): Handlers => ({ ...list(), 'query Cart(': () => ({ abandonedCart: detailOf() }), ...over })

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
// The last button of that name is the one in the sheet that opened over the screen.
const clickLast = async (renderer: ReactTestRenderer, label: string) => {
  const found = pressablesNamed(renderer, label).at(-1)
  if (!found) throw new Error(`nothing to press named "${label}"`)
  await press(found)
  await settle()
}
const asked = (calls: Call[], text: string) => calls.filter((call) => call.query.includes(text))
const hasButton = (renderer: ReactTestRenderer, label: string) => pressablesNamed(renderer, label).length > 0
const hasField = (renderer: ReactTestRenderer, label: string) => renderer.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function').length > 0
// A control's own pressable says whether it is off, whatever made it so (a prop, a busy write, or no connection for a button that saves).
const disabled = (renderer: ReactTestRenderer, label: string) =>
  pressableNamed(renderer, label).findAll((node) => typeof node.props.accessibilityState?.disabled === 'boolean')[0]?.props.accessibilityState.disabled === true

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
})

describe('the Carts list', () => {
  it('shows the last 14 days, the tabs with the API’s counts, and each cart with its status and line', async () => {
    const { renderer } = await show(<CartsScreen />, list())

    expect(texts(renderer)).toEqual(
      expect.arrayContaining([
        'Abandoned checkouts',
        '7',
        '₹15,445.00 left behind',
        'Recovered sales',
        '₹3,580.00',
        '17% of reachable carts',
        'Vikram Shah',
        'ab-1@example.in',
        'Silk saree',
        'Reminder due',
        '₹2,499.00',
        'Payment · 25 min ago · Goes by itself on your schedule',
        'Reminded',
        'Silk saree + 1 more',
        'Payment · 25 min ago · Last sent 2 hr ago',
      ]),
    )
    expect(hasButton(renderer, 'In progress, 2')).toBe(true)
    expect(hasButton(renderer, 'Recovered, 1')).toBe(true)
    expect(hasButton(renderer, 'Not recovered, 3')).toBe(true)
    await press(pressableNamed(renderer, 'Open the cart of Vikram Shah'))
    expect(mockPush).toHaveBeenCalledWith('/more/carts/ab-1')
  })

  it('reads "Reminder due" while the schedule sends and "Not contacted" while the merchant does', async () => {
    const scheduled = await show(<CartsScreen />, list())
    expect(hasText(scheduled.renderer, 'Reminder due')).toBe(true)

    const byHand = await show(<CartsScreen />, list({ 'reminderSettings { enabled level }': () => ({ reminderSettings: { enabled: true, level: 'youSend' } }) }))
    expect(hasText(byHand.renderer, 'Not contacted')).toBe(true)
    expect(hasText(byHand.renderer, 'Send a reminder yourself')).toBe(true)
    expect(hasText(byHand.renderer, 'You send reminders yourself on your plan')).toBe(true)
  })

  it('draws a skeleton while it loads', async () => {
    let release: () => void = () => undefined
    const pending = new Promise<unknown>((resolve) => (release = () => resolve(paged([]))))
    const { renderer } = await show(<CartsScreen />, list({ 'query Carts(': () => pending }))

    expect(renderer.root.findAll((node) => node.props.accessibilityRole === 'progressbar').length).toBeGreaterThan(0)
    expect(hasText(renderer, 'Vikram Shah')).toBe(false)
    await act(async () => release())
    await settle()
  })

  it('says it could not load, and asks again on request', async () => {
    let fail = true
    const { renderer, calls } = await show(
      <CartsScreen />,
      list({
        'query Carts(': () => {
          if (fail) throw new ApiError('NO_RESPONSE', 'x')
          return paged([cart('ab-1', 'Vikram Shah')])
        },
      }),
    )

    expect(hasText(renderer, 'We couldn’t load Abandoned carts')).toBe(true)
    fail = false
    await click(renderer, 'Try again')
    expect(asked(calls, 'query Carts(')).toHaveLength(2)
    expect(hasText(renderer, 'Vikram Shah')).toBe(true)
  })

  it('still lists the carts when the counts and tiles can’t be read', async () => {
    const refuse = () => {
      throw new ApiError('NO_RESPONSE', 'x')
    }
    const { renderer } = await show(<CartsScreen />, list({ abandonedCartCounts: refuse, cartSummary: refuse }))

    expect(hasText(renderer, 'Vikram Shah')).toBe(true)
    expect(hasText(renderer, 'Abandoned checkouts')).toBe(false)
    expect(hasButton(renderer, 'In progress')).toBe(true)
  })

  it('is access denied to a supplier, and reads nothing but its own permissions', async () => {
    const { renderer, calls } = await show(<CartsScreen />, list({ 'acting { permissions': () => access([], { id: 'supplier-1' }) }), { acting: actingAs('supplier-admin', 'vendor-orders-fulfil') })

    expect(hasText(renderer, 'You don’t have access to Abandoned carts')).toBe(true)
    expect(calls.map((call) => call.query).filter((query) => /[Cc]art/.test(query))).toEqual([])
  })

  it('is access denied to a seat without carts.read, before any cart is asked for', async () => {
    const { renderer, calls } = await show(<CartsScreen />, list({ 'acting { permissions': () => access(['orders.read']) }))

    expect(hasText(renderer, 'You don’t have access to Abandoned carts')).toBe(true)
    expect(asked(calls, 'query Carts(')).toHaveLength(0)
  })

  it('shows a store with no carts how it works, with Set up reminders that opens the settings', async () => {
    const { renderer } = await show(
      <CartsScreen />,
      list({
        'query Carts(': () => paged([]),
        abandonedCartCounts: () => ({ abandonedCartCounts: { open: 0, recovered: 0, lost: 0 } }),
        'reminderSettings { enabled minimum': () => ({ reminderSettings: settingsOf() }),
      }),
    )

    expect(hasText(renderer, 'No abandoned carts yet')).toBe(true)
    expect(hasText(renderer, 'You can remind each shopper yourself.')).toBe(false)
    expect(hasText(renderer, 'Reminders go out on their schedule.')).toBe(true)
    expect(hasField(renderer, 'Search carts')).toBe(false)
    await click(renderer, 'Set up reminders')
    expect(hasText(renderer, 'Send reminders automatically')).toBe(true)
  })

  it('offers Staff the same first-time explanation without a way to set up', async () => {
    const { renderer } = await show(
      <CartsScreen />,
      list({ 'acting { permissions': () => access(staff), 'query Carts(': () => paged([]), abandonedCartCounts: () => ({ abandonedCartCounts: { open: 0, recovered: 0, lost: 0 } }) }),
    )

    expect(hasText(renderer, 'No abandoned carts yet')).toBe(true)
    expect(hasButton(renderer, 'Set up reminders')).toBe(false)
  })

  it('says a tab is empty, and that nothing matches a search', async () => {
    const empty = await show(<CartsScreen />, list({ 'query Carts(': () => paged([]) }))
    expect(hasText(empty.renderer, 'Nothing in progress')).toBe(true)

    await click(empty.renderer, 'Recovered, 1')
    expect(hasText(empty.renderer, 'No recovered carts yet')).toBe(true)

    jest.useFakeTimers()
    try {
      await act(async () => input(empty.renderer, 'Search carts').props.onChangeText('zzz'))
      await act(async () => void jest.advanceTimersByTime(400))
      await settle()
      expect(hasText(empty.renderer, 'No carts match. Try another name, email or product.')).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })

  it('asks the API for the tab, and for the search after typing stops', async () => {
    jest.useFakeTimers()
    try {
      const { renderer, calls } = await show(<CartsScreen />, list())
      expect(asked(calls, 'query Carts(')[0]?.variables).toMatchObject({ tab: 'open', search: null, first: 25, after: null })

      await click(renderer, 'Not recovered, 3')
      expect(asked(calls, 'query Carts(').at(-1)?.variables).toMatchObject({ tab: 'lost', search: null })

      await act(async () => input(renderer, 'Search carts').props.onChangeText('saree'))
      expect(asked(calls, 'query Carts(').every((call) => call.variables.search === null)).toBe(true)
      await act(async () => void jest.advanceTimersByTime(400))
      await settle()
      expect(asked(calls, 'query Carts(').at(-1)?.variables).toMatchObject({ tab: 'lost', search: 'saree' })
    } finally {
      jest.useRealTimers()
    }
  })

  it('pages with Show more, 25 at a time', async () => {
    const seen: Array<string | null> = []
    const { renderer } = await show(
      <CartsScreen />,
      list({
        'query Carts(': (variables) => {
          seen.push(variables.after as string | null)
          return variables.after ? paged([cart('ab-2', 'Second page shopper')]) : paged([cart('ab-1', 'First page shopper')], 'cursor-1')
        },
      }),
    )

    await click(renderer, 'Show more')
    expect(seen).toEqual([null, 'cursor-1'])
    expect(texts(renderer)).toEqual(expect.arrayContaining(['First page shopper', 'Second page shopper']))
    expect(hasButton(renderer, 'Show more')).toBe(false)
  })
})

describe('what a seat may do on the list', () => {
  it('gives Staff everything to read, a note, and no write control at all', async () => {
    const { renderer } = await show(<CartsScreen />, list({ 'acting { permissions': () => access(staff) }))

    expect(hasText(renderer, 'View only. You can see carts; only the owner or a manager can send reminders.')).toBe(true)
    expect(hasText(renderer, 'Vikram Shah')).toBe(true)
    expect(hasButton(renderer, 'Send reminder now')).toBe(false)
    expect(hasButton(renderer, 'Stop reminders')).toBe(false)
    expect(hasButton(renderer, 'Resume reminders')).toBe(false)
    expect(hasButton(renderer, 'Reminders')).toBe(true)
  })

  it('looks only when the store is read-only: it says why, and offers no write', async () => {
    const { renderer } = await show(<CartsScreen />, list(), { client: fakeClient({ state: readOnlyState }) })

    expect(hasText(renderer, 'Your store is read-only until the bill is paid. You can look, but reminders can’t be sent or changed until then.')).toBe(true)
    expect(hasText(renderer, 'Vikram Shah')).toBe(true)
    expect(hasText(renderer, 'Reminders paused')).toBe(true)
    expect(hasButton(renderer, 'Send reminder now')).toBe(false)
    expect(hasButton(renderer, 'Stop reminders')).toBe(false)
  })

  it('offers Send and Stop on a cart that can be reminded, and Resume on a stopped one, nothing on a recovered one', async () => {
    const { renderer } = await show(
      <CartsScreen />,
      list({
        'query Carts(': () =>
          paged([
            cart('ab-1', 'Waiting Wendy'),
            cart('ab-3', 'Stopped Stan', { status: 'stopped', stoppedBy: 'Farhan Ali' }),
            cart('ab-4', 'Recovered Rita', { status: 'recovered', recoveredOrderNumber: 'KT-1', recoveredOrderId: 'o-1' }),
          ]),
      }),
    )

    expect(pressablesNamed(renderer, 'Send reminder now')).toHaveLength(1)
    expect(pressablesNamed(renderer, 'Stop reminders')).toHaveLength(1)
    expect(pressablesNamed(renderer, 'Resume reminders')).toHaveLength(1)
  })

  it('turns Send and Stop off while the phone is offline', async () => {
    const { renderer } = await show(<CartsScreen />, list())
    expect(disabled(renderer, 'Send reminder now')).toBe(false)

    try {
      await act(async () => mockNet.emit({ isConnected: false, isInternetReachable: false }))
      expect(disabled(renderer, 'Send reminder now')).toBe(true)
      expect(disabled(renderer, 'Stop reminders')).toBe(true)
    } finally {
      await act(async () => mockNet.emit({ isConnected: true, isInternetReachable: true }))
    }
  })
})

describe('Send reminder now', () => {
  const open = async (handlers: Handlers = {}, level = 'automatic') => {
    const shown = await show(<CartsScreen />, list({ 'reminderSettings { enabled level }': () => ({ reminderSettings: { enabled: true, level } }), ...handlers }))
    await click(shown.renderer, 'Send reminder now')
    return shown
  }

  it('says what it does first, and sends with no code unless one is chosen', async () => {
    const { renderer, calls } = await open({ 'mutation RemindNow': () => ({ remindNow: 'rem-1' }) })

    expect(hasText(renderer, 'Remind Vikram Shah now?')).toBe(true)
    expect(hasText(renderer, 'Sends to ab-1@example.in right away, even in quiet hours. The next automatic reminder still goes as planned.')).toBe(true)
    expect(asked(calls, 'mutation RemindNow')).toHaveLength(0)

    await clickLast(renderer, 'Send reminder')
    expect(asked(calls, 'mutation RemindNow')[0]?.variables).toEqual({ id: 'ab-1', p: null })
    expect(hasText(renderer, 'Reminder sent to ab-1@example.in.')).toBe(true)
  })

  it('sends a single-use 10% code when it is chosen, on the plan that allows one', async () => {
    const { renderer, calls } = await open({ 'mutation RemindNow': () => ({ remindNow: 'rem-1' }) })

    await click(renderer, '10% off with a single-use code (one use, 48 hours)')
    await clickLast(renderer, 'Send reminder')

    expect(asked(calls, 'mutation RemindNow')[0]?.variables).toEqual({ id: 'ab-1', p: 10 })
    expect(hasText(renderer, 'Reminder sent to ab-1@example.in with a 10% code.')).toBe(true)
  })

  it('offers no code below the plan’s automatic, and does not say the schedule goes on when the merchant sends', async () => {
    const { renderer, calls } = await open({ 'mutation RemindNow': () => ({ remindNow: 'rem-1' }) }, 'youSend')

    expect(hasButton(renderer, '10% off with a single-use code (one use, 48 hours)')).toBe(false)
    expect(hasText(renderer, 'Sends to ab-1@example.in right away, even in quiet hours.')).toBe(true)
    expect(hasText(renderer, 'The next automatic reminder still goes as planned.')).toBe(false)
    await clickLast(renderer, 'Send reminder')
    expect(asked(calls, 'mutation RemindNow')[0]?.variables).toEqual({ id: 'ab-1', p: null })
  })

  it('keeps a refusal in the sheet by its code, and the sheet open', async () => {
    const { renderer } = await open({
      'mutation RemindNow': () => {
        throw new ApiError('PLAN_LIMIT', 'x')
      },
    })

    await clickLast(renderer, 'Send reminder')

    expect(hasText(renderer, 'Your plan doesn’t include this: it sends one reminder per cart, without a code.')).toBe(true)
    expect(hasText(renderer, 'Remind Vikram Shah now?')).toBe(true)
  })

  it('says a cart can’t be reminded when the API says so', async () => {
    const { renderer } = await open({
      'mutation RemindNow': () => {
        throw new ApiError('CANT_REMIND', 'x')
      },
    })

    await clickLast(renderer, 'Send reminder')

    expect(hasText(renderer, 'This cart can’t be reminded: it was bought, its reminders are stopped, it has no email, or it has expired.')).toBe(true)
  })

  it('reads the carts again once it is sent', async () => {
    const { renderer, calls } = await open({ 'mutation RemindNow': () => ({ remindNow: 'rem-1' }) })

    await clickLast(renderer, 'Send reminder')

    expect(asked(calls, 'query Carts(')).toHaveLength(2)
  })
})

describe('Stop reminders', () => {
  const open = async (handlers: Handlers = {}) => {
    const shown = await show(<CartsScreen />, list(handlers))
    await click(shown.renderer, 'Stop reminders')
    return shown
  }

  it('says what it does, then stops with the team’s note trimmed', async () => {
    const { renderer, calls } = await open({ 'mutation StopReminders': () => ({ stopCartReminders: true }) })

    expect(hasText(renderer, 'Stop reminders for Vikram Shah?')).toBe(true)
    expect(hasText(renderer, 'No more reminders go out for this cart.')).toBe(true)
    expect(asked(calls, 'mutation StopReminders')).toHaveLength(0)

    await type(renderer, 'Note for your team (optional)', '  She called, ordering by phone  ')
    await clickLast(renderer, 'Stop reminders')

    expect(asked(calls, 'mutation StopReminders')[0]?.variables).toEqual({ id: 'ab-1', note: 'She called, ordering by phone' })
    expect(hasText(renderer, 'Reminders stopped for Vikram Shah.')).toBe(true)
  })

  it('sends no note when none was typed', async () => {
    const { renderer, calls } = await open({ 'mutation StopReminders': () => ({ stopCartReminders: true }) })

    await clickLast(renderer, 'Stop reminders')

    expect(asked(calls, 'mutation StopReminders')[0]?.variables).toEqual({ id: 'ab-1', note: null })
  })

  it('refuses a note past 200 characters before sending anything', async () => {
    const { renderer, calls } = await open({ 'mutation StopReminders': () => ({ stopCartReminders: true }) })

    await type(renderer, 'Note for your team (optional)', 'x'.repeat(201))
    await clickLast(renderer, 'Stop reminders')

    expect(hasText(renderer, 'Keep the note to 200 characters.')).toBe(true)
    expect(asked(calls, 'mutation StopReminders')).toHaveLength(0)
  })

  it('keeps a refusal in the sheet with what was typed', async () => {
    const { renderer } = await open({
      'mutation StopReminders': () => {
        throw new ApiError('READ_ONLY', 'x')
      },
    })

    await type(renderer, 'Note for your team (optional)', 'Keep me')
    await clickLast(renderer, 'Stop reminders')

    expect(hasText(renderer, 'Your store is read-only until the bill is paid.')).toBe(true)
    expect(input(renderer, 'Note for your team (optional)').props.value).toBe('Keep me')
  })
})

describe('Resume reminders', () => {
  const open = async (handlers: Handlers = {}) => {
    const shown = await show(<CartsScreen />, list({ 'query Carts(': () => paged([cart('ab-3', 'Stopped Stan', { status: 'stopped', stoppedBy: 'Farhan Ali' })]), ...handlers }))
    await click(shown.renderer, 'Resume reminders')
    return shown
  }

  it('says what it does first, and resumes only on confirm', async () => {
    const { renderer, calls } = await open({ 'mutation ResumeReminders': () => ({ resumeCartReminders: true }) })

    expect(hasText(renderer, 'Resume reminders for Stopped Stan?')).toBe(true)
    expect(asked(calls, 'mutation ResumeReminders')).toHaveLength(0)

    await clickLast(renderer, 'Resume reminders')

    expect(asked(calls, 'mutation ResumeReminders')[0]?.variables).toEqual({ id: 'ab-3' })
    expect(hasText(renderer, 'Reminders back on for Stopped Stan.')).toBe(true)
  })

  it('keeps a refusal in the sheet by its code', async () => {
    const { renderer } = await open({
      'mutation ResumeReminders': () => {
        throw new ApiError('NOT_FOUND', 'x')
      },
    })

    await clickLast(renderer, 'Resume reminders')

    expect(hasText(renderer, 'That cart isn’t here any more.')).toBe(true)
    expect(hasText(renderer, 'Resume reminders for Stopped Stan?')).toBe(true)
  })
})

describe('a cart', () => {
  const page = (handlers: Handlers = {}, options: Options = {}) => show(<CartScreen id="ab-2" />, detail(handlers), options)

  it('shows its lines as they would be bought now, with out-of-stock marked, what happened, and the shopper', async () => {
    const { renderer } = await page()

    expect(texts(renderer)).toEqual(
      expect.arrayContaining([
        'Ananya Rao',
        'Reminded',
        'Qty 1 · Only 3 left',
        'Linen kurta · M',
        'Qty 2 · Out of stock now',
        'Block-print dupatta',
        '₹1,681.00',
        'Cart value',
        'Before delivery and tax, as the cart would be bought now.',
        'Left checkout at Delivery',
        'Reminder 1 sent by email',
        'Came back to the cart',
        'ab-2@example.in',
      ]),
    )
    expect(hasText(renderer, 'Block-print dupatta is out of stock now. Reminders leave it out.')).toBe(true)
  })

  it('opens the customer, and the order of a recovered cart', async () => {
    const recovered = await page()
    await click(recovered.renderer, 'View customer')
    expect(mockPush).toHaveBeenCalledWith('/more/customers/c-1')

    const bought = await page({ 'query Cart(': () => ({ abandonedCart: detailOf({ cart: cart('ab-2', 'Ananya Rao', { status: 'recovered', recoveredOrderId: 'o-9', recoveredOrderNumber: 'KT-2848' }) }) }) })
    await click(bought.renderer, 'View order KT-2848')
    expect(mockPush).toHaveBeenCalledWith('/orders/o-9')
    expect(hasText(bought.renderer, 'Paid · order KT-2848')).toBe(true)
  })

  it('is access denied to a supplier before the cart is asked for', async () => {
    const { renderer, calls } = await page({ 'acting { permissions': () => access([], { id: 'supplier-1' }) }, { acting: actingAs('supplier-admin', 'vendor-orders-fulfil') })

    expect(hasText(renderer, 'You don’t have access to this cart')).toBe(true)
    expect(asked(calls, 'query Cart(')).toHaveLength(0)
  })

  it('is "not found" for a cart that isn’t here', async () => {
    const { renderer } = await page({ 'query Cart(': () => ({ abandonedCart: null }) })

    expect(hasText(renderer, 'This page isn’t here any more')).toBe(true)
  })

  it('says it could not load, and asks again on request', async () => {
    let fail = true
    const { renderer, calls } = await page({
      'query Cart(': () => {
        if (fail) throw new ApiError('NO_RESPONSE', 'x')
        return { abandonedCart: detailOf() }
      },
    })

    expect(hasText(renderer, 'We couldn’t load this cart')).toBe(true)
    fail = false
    await click(renderer, 'Try again')
    expect(asked(calls, 'query Cart(')).toHaveLength(2)
    expect(hasText(renderer, 'Ananya Rao')).toBe(true)
  })

  it('gives Staff the whole cart and no write control, only the links', async () => {
    const { renderer } = await page({ 'acting { permissions': () => access(staff) })

    expect(hasText(renderer, 'Linen kurta · M')).toBe(true)
    expect(hasButton(renderer, 'Send reminder now')).toBe(false)
    expect(hasButton(renderer, 'Stop reminders')).toBe(false)
    expect(hasButton(renderer, 'View customer')).toBe(true)
  })

  it('leaves out the link to a customer or an order the seat can’t read', async () => {
    const { renderer } = await page({ 'acting { permissions': () => access(['carts.read', 'carts.write']) })

    expect(hasButton(renderer, 'View customer')).toBe(false)
    expect(hasButton(renderer, 'Send reminder now')).toBe(true)
  })

  it('sends a reminder from the page and reads the cart again', async () => {
    const { renderer, calls } = await page({ 'mutation RemindNow': () => ({ remindNow: 'rem-1' }) })

    await click(renderer, 'Send reminder now')
    await clickLast(renderer, 'Send reminder')

    expect(asked(calls, 'mutation RemindNow')[0]?.variables).toEqual({ id: 'ab-2', p: null })
    expect(asked(calls, 'query Cart(')).toHaveLength(2)
  })

  it('stops reminders from the page, and resumes a stopped cart', async () => {
    const stopped = detailOf({ cart: cart('ab-2', 'Ananya Rao', { status: 'stopped', stoppedBy: 'Farhan Ali', stoppedNote: 'She called', stoppedAt: ago(10) }) })
    const { renderer, calls } = await page({ 'query Cart(': () => ({ abandonedCart: stopped }), 'mutation ResumeReminders': () => ({ resumeCartReminders: true }) })

    expect(hasButton(renderer, 'Stop reminders')).toBe(false)
    expect(hasText(renderer, 'Reminders stopped by Farhan Ali — She called')).toBe(true)
    await click(renderer, 'Resume reminders')
    await clickLast(renderer, 'Resume reminders')
    expect(asked(calls, 'mutation ResumeReminders')[0]?.variables).toEqual({ id: 'ab-2' })
  })

  it('looks only when the store is read-only', async () => {
    const { renderer } = await page({}, { client: fakeClient({ state: readOnlyState }) })

    expect(hasText(renderer, 'Your store is read-only until the bill is paid. You can look, but reminders can’t be sent or changed until then.')).toBe(true)
    expect(hasButton(renderer, 'Send reminder now')).toBe(false)
  })
})

describe('the reminder settings', () => {
  const reminders = (over: Handlers = {}): Handlers => ({ 'reminderSettings { enabled minimum': () => ({ reminderSettings: settingsOf() }), ...over })
  const open = async (handlers: Handlers = {}, options: Options = {}) => {
    const shown = await show(<CartsScreen />, list(reminders(handlers)), options)
    await click(shown.renderer, 'Reminders')
    return shown
  }
  const dirty = async (renderer: ReactTestRenderer) => type(renderer, 'Subject line, reminder 1', 'A new subject')

  it('shows the switch, the three steps, who gets reminded, and the region’s consent note', async () => {
    const { renderer } = await open()

    expect(texts(renderer)).toEqual(
      expect.arrayContaining([
        'Send reminders automatically',
        'Up to 3 reminders per cart, sent on the schedule below.',
        'Reminder 1',
        '1 hour after they leave · Email',
        'Reminder 2',
        '1 day after they leave · Email',
        'Reminder 3',
        '3 days after they leave · Email',
        'Who gets reminded',
        'Only carts worth at least (INR)',
        'Stop as soon as they buy',
        'WhatsApp needs opt-in:',
      ]),
    )
    expect(input(renderer, 'Only carts worth at least (INR)').props.value).toBe('2000.00')
    expect(input(renderer, 'Subject line, reminder 2').props.value).toBe('Subject 2')
    expect(hasButton(renderer, 'Save reminders')).toBe(false)
  })

  it('offers WhatsApp and a code only in an Indian store on automatic', async () => {
    const india = await open()
    expect(hasButton(india.renderer, 'Send by: Email')).toBe(true)
    expect(hasButton(india.renderer, 'Discount: No discount')).toBe(true)

    const us = await show(<CartsScreen />, list(reminders({ '{ storeInfo { country }': () => ({ storeInfo: { country: 'US' } }) })))
    await click(us.renderer, 'Reminders')
    expect(hasButton(us.renderer, 'Send by: Email')).toBe(false)
    expect(hasButton(us.renderer, 'Discount: No discount')).toBe(true)
    expect(hasText(us.renderer, 'Unsubscribe link in every email.')).toBe(true)
  })

  it('says which plan sends by itself, and locks steps 2 and 3 with no code and no way to upgrade', async () => {
    const { renderer } = await open({
      'reminderSettings { enabled level }': () => ({ reminderSettings: { enabled: true, level: 'youSend' } }),
      'reminderSettings { enabled minimum': () => ({ reminderSettings: settingsOf({ level: 'youSend' }) }),
    })

    expect(hasText(renderer, 'On your plan you remind shoppers yourself, one reminder per cart. A bigger plan sends them for you.')).toBe(true)
    expect(pressablesNamed(renderer, 'Send reminders automatically').length).toBe(0)
    expect(texts(renderer).filter((text) => text === 'Automatic follow-ups are on a bigger plan')).toHaveLength(2)
    expect(hasText(renderer, 'Used when you send a reminder yourself')).toBe(true)
    expect(hasButton(renderer, 'Discount: No discount')).toBe(false)
    expect(hasField(renderer, 'Subject line, reminder 2')).toBe(false)
    expect(hasField(renderer, 'Subject line, reminder 1')).toBe(true)
    expect(hasButton(renderer, 'See plans')).toBe(false)
  })

  it('shows Staff every value read-only, with no Save and no test', async () => {
    const { renderer } = await open({ 'acting { permissions': () => access(staff) })

    expect(hasText(renderer, 'View only. You can see carts; only the owner or a manager can send reminders.')).toBe(true)
    expect(input(renderer, 'Subject line, reminder 1').props.editable).toBe(false)
    expect(input(renderer, 'Message, reminder 1').props.editable).toBe(false)
    expect(input(renderer, 'Only carts worth at least (INR)').props.editable).toBe(false)
    expect(disabled(renderer, 'Send reminders automatically')).toBe(true)
    expect(hasButton(renderer, 'Send me a test')).toBe(false)
    expect(hasButton(renderer, 'Save reminders')).toBe(false)
  })

  it('shows a read-only store its settings without a Save', async () => {
    const { renderer } = await open({}, { client: fakeClient({ state: readOnlyState }) })

    expect(hasText(renderer, 'Your store is read-only until the bill is paid. You can look, but reminders can’t be sent or changed until then.')).toBe(true)
    expect(input(renderer, 'Subject line, reminder 1').props.editable).toBe(false)
    expect(hasButton(renderer, 'Send me a test')).toBe(false)
  })

  it('says it could not load, and asks again on request', async () => {
    let fail = true
    const { renderer, calls } = await open({
      'reminderSettings { enabled minimum': () => {
        if (fail) throw new ApiError('NO_RESPONSE', 'x')
        return { reminderSettings: settingsOf() }
      },
    })

    expect(hasText(renderer, 'We couldn’t load Cart reminders')).toBe(true)
    fail = false
    await click(renderer, 'Try again')
    expect(asked(calls, 'reminderSettings { enabled minimum')).toHaveLength(2)
    expect(hasText(renderer, 'Reminder 1')).toBe(true)
  })

  it('saves everything as one, at the revision read, with the minimum in minor units', async () => {
    const { renderer, calls } = await open({ 'mutation SaveReminders': () => ({ saveReminderSettings: 5 }) })

    await dirty(renderer)
    await type(renderer, 'Only carts worth at least (INR)', '1500.50')
    await click(renderer, 'Save reminders')

    const [call] = asked(calls, 'mutation SaveReminders')
    expect(call?.variables.revision).toBe(4)
    expect(call?.variables.input).toEqual({
      enabled: true,
      minimum: { amount: '150050', currency: 'INR' },
      skipOutOfStock: true,
      quietHours: true,
      weeklyCap: true,
      steps: [step(1, { subject: 'A new subject' }), step(2), step(3)],
    })
    expect(hasText(renderer, 'Reminders saved. Carts waiting for a reminder follow the new timings.')).toBe(true)
    expect(hasButton(renderer, 'Save reminders')).toBe(false)
  })

  it('sends the next save at the new revision', async () => {
    const { renderer, calls } = await open({ 'mutation SaveReminders': () => ({ saveReminderSettings: 5 }) })

    await dirty(renderer)
    await click(renderer, 'Save reminders')
    await type(renderer, 'Subject line, reminder 1', 'Again')
    await click(renderer, 'Save reminders')

    expect(asked(calls, 'mutation SaveReminders').map((call) => call.variables.revision)).toEqual([4, 5])
  })

  it('turns automatic sending off and saves that', async () => {
    const { renderer, calls } = await open({ 'mutation SaveReminders': () => ({ saveReminderSettings: 5 }) })

    await click(renderer, 'Send reminders automatically')
    await click(renderer, 'Save reminders')

    expect(asked(calls, 'mutation SaveReminders')[0]?.variables.input).toMatchObject({ enabled: false })
    expect(hasText(renderer, 'Reminders saved.')).toBe(true)
  })

  it('wants a later step to go later, and sends nothing until it does', async () => {
    const { renderer, calls } = await open({ 'reminderSettings { enabled minimum': () => ({ reminderSettings: settingsOf({ steps: [step(1, { delayMinutes: 1440 }), step(2, { delayMinutes: 1440 }), step(3)] }) }) })

    await dirty(renderer)
    await click(renderer, 'Save reminders')

    expect(hasText(renderer, 'Reminder 2 must go later than the reminder before it.')).toBe(true)
    expect(asked(calls, 'mutation SaveReminders')).toHaveLength(0)
  })

  it('wants a subject for an email', async () => {
    const { renderer, calls } = await open()

    await type(renderer, 'Subject line, reminder 1', '   ')
    await click(renderer, 'Save reminders')

    expect(hasText(renderer, 'Add a subject line to reminder 1.')).toBe(true)
    expect(asked(calls, 'mutation SaveReminders')).toHaveLength(0)
  })

  it('wants a minimum above zero, or none', async () => {
    const { renderer, calls } = await open()

    await type(renderer, 'Only carts worth at least (INR)', '0')
    await click(renderer, 'Save reminders')

    expect(hasText(renderer, 'Enter a cart value above zero, or leave it empty for every cart.')).toBe(true)
    expect(asked(calls, 'mutation SaveReminders')).toHaveLength(0)
  })

  it('says someone else saved first, keeps what was typed, and reloads on request', async () => {
    const { renderer, calls } = await open({
      'mutation SaveReminders': () => {
        throw new ApiError('STALE_REVISION', 'x')
      },
    })

    await dirty(renderer)
    await click(renderer, 'Save reminders')

    expect(hasText(renderer, 'Someone else saved your reminders. Reload to see their changes.')).toBe(true)
    expect(input(renderer, 'Subject line, reminder 1').props.value).toBe('A new subject')
    await click(renderer, 'Reload')
    expect(asked(calls, 'reminderSettings { enabled minimum')).toHaveLength(2)
    expect(input(renderer, 'Subject line, reminder 1').props.value).toBe('Subject 1')
  })

  it('keeps a refusal by its code, with what was typed', async () => {
    const { renderer } = await open({
      'mutation SaveReminders': () => {
        throw new ApiError('PLAN_LIMIT', 'x')
      },
    })

    await dirty(renderer)
    await click(renderer, 'Save reminders')

    expect(hasText(renderer, 'Your plan doesn’t include this: it sends one reminder per cart, without a code.')).toBe(true)
    expect(input(renderer, 'Subject line, reminder 1').props.value).toBe('A new subject')
  })

  it('asks before leaving with changes not saved, by the other part or by going back', async () => {
    const { renderer } = await open()
    await dirty(renderer)
    expect(mockPrevent).toHaveBeenLastCalledWith(true, expect.any(Function))

    await click(renderer, 'Carts')
    expect(hasText(renderer, 'Leave without saving?')).toBe(true)
    await click(renderer, 'Keep editing')
    expect(hasText(renderer, 'Reminder 1')).toBe(true)

    await click(renderer, 'Carts')
    await click(renderer, 'Discard changes')
    expect(hasText(renderer, 'Vikram Shah')).toBe(true)
  })

  it('discards what was typed', async () => {
    const { renderer } = await open()

    await dirty(renderer)
    await click(renderer, 'Discard')

    expect(input(renderer, 'Subject line, reminder 1').props.value).toBe('Subject 1')
    expect(hasButton(renderer, 'Save reminders')).toBe(false)
  })

  it('sends a test of a saved step to the person’s own email, and only when nothing is unsaved', async () => {
    const { renderer, calls } = await open({ 'mutation SendTest': () => ({ sendTestReminder: true }) })

    await dirty(renderer)
    expect(disabled(renderer, 'Send me a test')).toBe(true)
    expect(hasText(renderer, 'Save first: a test sends the saved reminder.')).toBe(true)
    await click(renderer, 'Discard')
    expect(disabled(renderer, 'Send me a test')).toBe(false)

    await press(pressablesNamed(renderer, 'Send me a test')[1] as never)
    await settle()
    expect(hasText(renderer, 'Send a test of reminder 2')).toBe(true)
    expect(asked(calls, 'mutation SendTest')).toHaveLength(0)

    await clickLast(renderer, 'Send test')
    expect(asked(calls, 'mutation SendTest')[0]?.variables).toEqual({ p: 2 })
    expect(hasText(renderer, 'Test sent. Check your email, and your spam folder if it isn’t there in a minute.')).toBe(true)
  })

  it('says when too many tests were sent, in the sheet', async () => {
    const { renderer } = await open({
      'mutation SendTest': () => {
        throw new ApiError('RATE_LIMITED', 'x')
      },
    })

    await press(pressablesNamed(renderer, 'Send me a test')[0] as never)
    await settle()
    await clickLast(renderer, 'Send test')

    expect(hasText(renderer, 'Too many tests. Wait a minute and try again.')).toBe(true)
    expect(hasText(renderer, 'Send a test of reminder 1')).toBe(true)
  })
})
