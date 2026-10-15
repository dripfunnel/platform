import type { ReactElement } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '../../graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { actingAs, fakeClient, hasText, press, pressableNamed, pressablesNamed, renderShell, texts } from '../../testing/harness'
import { shareCsv } from '../common/shareCsv'
import { resetScenario } from '../states/scenario'
import { CustomerScreen } from './CustomerScreen'
import { CustomersScreen } from './CustomersScreen'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockPush = jest.fn()
const mockSession: { client: ApiClient | null } = { client: null }

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), navigate: jest.fn() }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  }
})
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))
jest.mock('../common/shareCsv', () => ({ shareCsv: jest.fn(async () => true) }))

// The fake network answers over several promise turns; jest-expo runs timers faked, so wait on promises, not on a timer.
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

type Handlers = Record<string, (variables: Record<string, unknown>, headers: Record<string, string>) => unknown>
type Options = Parameters<typeof renderShell>[1]

const everything = ['customers.read', 'customers.write', 'customers.export']
const access = (permissions: string[], seller: { id: string } | null = null) => ({ me: { acting: { permissions, seller } } })
const paged = <T,>(nodes: T[], next: string | null = null) => ({ customers: { nodes, pageInfo: { hasNextPage: next !== null, hasPreviousPage: false, startCursor: null, endCursor: next } } })
const inr = (amount: string) => [{ amount, currency: 'INR' }]
const readOnlyState = { readOnly: true, status: null, trialEndsAt: null, pastDueSince: null, provisioning: null, support: null }

const summary = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, name, email: `${id}@example.in`, phone: null, city: null, tags: [], orders: 0, spent: [], ...over })
const groups = [
  { id: 'g-1', name: 'VIP', description: null, members: 2 },
  { id: 'g-2', name: 'Wholesale', description: 'Trade prices', members: 1 },
]

const person = (over: Record<string, unknown> = {}) => ({
  id: 'c-1',
  name: 'Ananya Rao',
  email: 'ananya@example.in',
  phone: '+91 98450 12345',
  phoneVerified: false,
  tags: ['Repeat'],
  note: 'Prefers gift wrap',
  consent: { state: 'opted_in', at: '2026-09-27T04:42:00.000Z', source: 'checkout', channels: ['email'] },
  groupIds: ['g-1'],
  addresses: [{ id: 'a-1', name: 'Ananya Rao', line1: '14, 3rd Cross', line2: null, city: 'Bengaluru', region: 'Karnataka', postalCode: '560038', country: 'IN', phone: null, isDefault: true }],
  city: 'Bengaluru',
  ordersCount: 3,
  orders: [
    { id: 'o-1042', number: 'KT-1042', placedAt: '2026-10-10T07:30:00.000Z', state: 'placed', paymentState: 'paid', fulfilmentState: 'unfulfilled', total: { amount: '579600', currency: 'INR' } },
    { id: 'o-1031', number: 'KT-1031', placedAt: '2026-09-27T04:42:00.000Z', state: 'placed', paymentState: 'paid', fulfilmentState: 'fulfilled', total: { amount: '649500', currency: 'INR' } },
  ],
  spent: inr('1229100'),
  ...over,
})

// An answer that has not come yet; releasing it at the end of a test lets the client's own timeout timer clear.
const held = <T,>(answer: T) => {
  let release: () => void = () => undefined
  const promise = new Promise<T>((resolve) => (release = () => resolve(answer)))
  return { promise, release }
}

const list = (over: Handlers = {}): Handlers => ({
  'acting { permissions': () => access(everything),
  'query Customers(': () => paged([summary('c-1', 'Ananya Rao', { city: 'Bengaluru', tags: ['Repeat'], orders: 3, spent: inr('1229100') }), summary('c-2', 'Rohan Mehta', { orders: 1, spent: inr('249900') })]),
  '{ customerCount }': () => ({ customerCount: 2 }),
  '{ customerGroups': () => ({ customerGroups: groups }),
  ...over,
})

const detail = (over: Handlers = {}): Handlers => ({
  'acting { permissions': () => access(everything),
  'query Customer(': () => ({ customer: person() }),
  '{ customerGroups': () => ({ customerGroups: groups }),
  '{ storeInfo': () => ({ storeInfo: { timeZone: 'Asia/Kolkata' } }),
  ...over,
})

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
const hasField = (renderer: ReactTestRenderer, label: string) => renderer.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function').length > 0
const hasButton = (renderer: ReactTestRenderer, label: string) => pressablesNamed(renderer, label).length > 0

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
})

describe('the People list', () => {
  it('lists each person with their city and tags, what they spent and their orders, and the counts', async () => {
    const { renderer } = await show(<CustomersScreen />, list())

    expect(texts(renderer)).toEqual(expect.arrayContaining(['People · 2', 'Groups · 2', 'Ananya Rao', 'Bengaluru · Repeat', '₹12,291.00', '3 orders', 'Rohan Mehta', 'c-2@example.in', '₹2,499.00', '1 order']))
    await press(pressableNamed(renderer, 'Open Ananya Rao'))
    expect(mockPush).toHaveBeenCalledWith('/more/customers/c-1')
  })

  it('draws a skeleton while it loads', async () => {
    const pending = held(paged([]))
    const { renderer } = await show(<CustomersScreen />, list({ 'query Customers(': () => pending.promise }))

    expect(renderer.root.findAll((node) => node.props.accessibilityRole === 'progressbar').length).toBeGreaterThan(0)
    expect(hasText(renderer, 'Ananya Rao')).toBe(false)
    await act(async () => pending.release())
    await settle()
  })

  it('says it could not load, and asks again on request', async () => {
    let fail = true
    const { renderer, calls } = await show(
      <CustomersScreen />,
      list({
        'query Customers(': () => {
          if (fail) throw new ApiError('NO_RESPONSE', 'x')
          return paged([summary('c-1', 'Ananya Rao')])
        },
      }),
    )

    expect(hasText(renderer, 'We couldn’t load Customers')).toBe(true)
    fail = false
    await click(renderer, 'Try again')
    expect(asked(calls, 'query Customers(')).toHaveLength(2)
    expect(hasText(renderer, 'Ananya Rao')).toBe(true)
  })

  it('is access denied to a supplier, which reads nothing but its own permissions', async () => {
    const { renderer, calls } = await show(<CustomersScreen />, list({ 'acting { permissions': () => access([], { id: 'supplier-1' }) }), { acting: actingAs('supplier-admin', 'vendor-orders-fulfil') })

    expect(hasText(renderer, 'You don’t have access to Customers')).toBe(true)
    expect(calls.map((call) => call.query).filter((query) => query.includes('ustomer'))).toEqual([])
  })

  it('shows a first-time store the empty state, with Add a customer and no search or export', async () => {
    const { renderer } = await show(<CustomersScreen />, list({ 'query Customers(': () => paged([]), '{ customerCount }': () => ({ customerCount: 0 }), '{ customerGroups': () => ({ customerGroups: [] }) }))

    expect(hasText(renderer, 'No customers yet')).toBe(true)
    expect(hasField(renderer, 'Search customers')).toBe(false)
    expect(hasButton(renderer, 'Export')).toBe(false)
    expect(hasButton(renderer, 'Add a customer')).toBe(true)
  })

  it('says nobody matches when a search finds no one', async () => {
    const { renderer } = await show(<CustomersScreen />, list({ 'query Customers(': () => paged([]) }))

    expect(hasText(renderer, 'Nobody matches.')).toBe(true)
    expect(hasField(renderer, 'Search customers')).toBe(true)
  })

  it('asks the API for the search after typing stops, and for the group the chip names', async () => {
    jest.useFakeTimers()
    try {
      const { renderer, calls } = await show(<CustomersScreen />, list())

      await act(async () => input(renderer, 'Search customers').props.onChangeText('ananya'))
      expect(asked(calls, 'query Customers(').every((call) => call.variables.search === null)).toBe(true)
      await act(async () => void jest.advanceTimersByTime(400))
      await settle()
      expect(asked(calls, 'query Customers(').at(-1)?.variables).toMatchObject({ search: 'ananya', group: null })

      await click(renderer, 'VIP, 2')
      expect(asked(calls, 'query Customers(').at(-1)?.variables).toMatchObject({ search: 'ananya', group: 'g-1' })
    } finally {
      jest.useRealTimers()
    }
  })

  it('pages with Show more', async () => {
    const seen: Array<string | null> = []
    const { renderer } = await show(
      <CustomersScreen />,
      list({
        'query Customers(': (variables) => {
          seen.push(variables.after as string | null)
          return variables.after ? paged([summary('c-2', 'Second page person')]) : paged([summary('c-1', 'First page person')], 'cursor-1')
        },
      }),
    )

    await click(renderer, 'Show more')
    expect(seen).toEqual([null, 'cursor-1'])
    expect(texts(renderer)).toEqual(expect.arrayContaining(['First page person', 'Second page person']))
    expect(hasButton(renderer, 'Show more')).toBe(false)
  })

  it('looks only when the store is read-only: no Add a customer, and it says why', async () => {
    const { renderer } = await show(<CustomersScreen />, list(), { client: fakeClient({ state: readOnlyState }) })

    expect(hasText(renderer, 'Your store is read-only until the bill is paid. You can look, but customers can’t be changed until then.')).toBe(true)
    expect(hasButton(renderer, 'Add a customer')).toBe(false)
    expect(hasButton(renderer, 'Export')).toBe(true)
    expect(hasText(renderer, 'Ananya Rao')).toBe(true)
  })
})

describe('Add a customer', () => {
  const add = async (handlers: Handlers = {}) => {
    const shown = await show(<CustomersScreen />, list(handlers))
    await click(shown.renderer, 'Add a customer')
    return shown
  }

  it('says what is wrong with the name or email before sending anything', async () => {
    const { renderer, calls } = await add()

    await click(renderer, 'Add customer')
    expect(hasText(renderer, 'Type their name.')).toBe(true)
    await type(renderer, 'Full name', 'Alex Morgan')
    await type(renderer, 'Email', 'not an email')
    await click(renderer, 'Add customer')
    expect(hasText(renderer, 'That doesn’t look like an email address.')).toBe(true)
    expect(asked(calls, 'mutation AddCustomer')).toHaveLength(0)
  })

  it('adds them with the email in lower case and opens their page', async () => {
    const { renderer, calls } = await add({ 'mutation AddCustomer': () => ({ addCustomer: { id: 'c-9', existed: false } }) })

    await type(renderer, 'Full name', ' Alex Morgan ')
    await type(renderer, 'Email', 'Alex@Example.com')
    await click(renderer, 'Add customer')

    expect(asked(calls, 'mutation AddCustomer')[0]?.variables).toEqual({ name: 'Alex Morgan', email: 'alex@example.com', phone: null })
    expect(mockPush).toHaveBeenCalledWith('/more/customers/c-9')
    expect(hasText(renderer, 'Alex Morgan added')).toBe(true)
  })

  it('opens the customer an email already belongs to, and says so', async () => {
    const { renderer } = await add({ 'mutation AddCustomer': () => ({ addCustomer: { id: 'c-1', existed: true } }) })

    await type(renderer, 'Full name', 'Ananya')
    await type(renderer, 'Email', 'ananya@example.in')
    await click(renderer, 'Add customer')

    expect(mockPush).toHaveBeenCalledWith('/more/customers/c-1')
    expect(hasText(renderer, 'Ananya is already a customer — opened them')).toBe(true)
  })

  it('keeps a refusal in the sheet, by its code, with what was typed', async () => {
    const { renderer } = await add({
      'mutation AddCustomer': () => {
        throw new ApiError('DELETED', 'x')
      },
    })

    await type(renderer, 'Full name', 'Alex Morgan')
    await type(renderer, 'Email', 'alex@example.com')
    await click(renderer, 'Add customer')

    expect(hasText(renderer, 'That customer deleted their account, so they can’t be added again.')).toBe(true)
    expect(input(renderer, 'Full name').props.value).toBe('Alex Morgan')
    expect(mockPush).not.toHaveBeenCalled()
  })
})

describe('Groups', () => {
  const groupsTab = async (handlers: Handlers = {}, options: Options = {}) => {
    const shown = await show(<CustomersScreen />, list(handlers), options)
    await click(shown.renderer, 'Groups · 2')
    return shown
  }

  it('lists the groups with their members, and "See people" filters the list by one', async () => {
    const { renderer, calls } = await groupsTab()

    expect(texts(renderer)).toEqual(expect.arrayContaining(['VIP', '2 people', 'Wholesale', '1 person · Trade prices']))
    await click(renderer, 'Manage Wholesale')
    await click(renderer, 'See people')
    expect(asked(calls, 'query Customers(').at(-1)?.variables).toMatchObject({ group: 'g-2' })
    expect(hasField(renderer, 'Search customers')).toBe(true)
  })

  it('makes a group, and keeps a taken name in the sheet with what was typed', async () => {
    let taken = true
    const { renderer, calls } = await groupsTab({
      'mutation CreateGroup': () => {
        if (taken) throw new ApiError('NAME_TAKEN', 'x')
        return { createGroup: 'g-3' }
      },
    })

    await click(renderer, 'New group')
    await type(renderer, 'Group name', 'VIP')
    await click(renderer, 'Make group')
    expect(hasText(renderer, 'You already have a group with that name.')).toBe(true)
    expect(input(renderer, 'Group name').props.value).toBe('VIP')

    taken = false
    await type(renderer, 'Group name', 'Friends')
    await click(renderer, 'Make group')
    expect(asked(calls, 'mutation CreateGroup').at(-1)?.variables).toEqual({ name: 'Friends' })
    expect(hasText(renderer, 'Friends made — add people from their customer page')).toBe(true)
  })

  it('renames a group and keeps its description', async () => {
    const { renderer, calls } = await groupsTab({ 'mutation UpdateGroup': () => ({ updateGroup: true }) })

    await click(renderer, 'Manage Wholesale')
    await click(renderer, 'Edit')
    await type(renderer, 'Group name', 'Trade')
    await click(renderer, 'Save')

    expect(asked(calls, 'mutation UpdateGroup')[0]?.variables).toEqual({ id: 'g-2', name: 'Trade', description: 'Trade prices' })
  })

  it('says who leaves before a group is deleted, and deletes only on confirm', async () => {
    const { renderer, calls } = await groupsTab({ 'mutation DeleteGroup': () => ({ deleteGroup: true }) })

    await click(renderer, 'Manage VIP')
    await click(renderer, 'Delete')
    expect(hasText(renderer, 'Delete VIP?')).toBe(true)
    expect(hasText(renderer, '2 people leave the group. Offers for VIP stop applying to them.')).toBe(true)
    expect(asked(calls, 'mutation DeleteGroup')).toHaveLength(0)

    await click(renderer, 'Delete group')
    expect(asked(calls, 'mutation DeleteGroup')[0]?.variables).toEqual({ id: 'g-1' })
    expect(hasText(renderer, 'VIP deleted')).toBe(true)
  })

  it('offers no way to change a group to a seat without customers.write', async () => {
    const { renderer } = await groupsTab({ 'acting { permissions': () => access(['customers.read']) })

    expect(hasButton(renderer, 'New group')).toBe(false)
    expect(hasButton(renderer, 'Manage VIP')).toBe(false)
    expect(hasButton(renderer, 'See the people in VIP')).toBe(true)
  })
})

describe('Export', () => {
  const exportJob = (state: string, over: Record<string, unknown> = {}) => ({ customerExport: { id: 'e-1', state, rows: 2, truncated: false, csv: null, expiresAt: null, ...over } })

  it('asks for the list as it is filtered, follows the job and opens the share sheet with the file', async () => {
    const { renderer, calls } = await show(
      <CustomersScreen />,
      list({
        'mutation ExportCustomers': () => ({ exportCustomers: 'e-1' }),
        'query CustomerExport': () => exportJob('done', { csv: 'Name,Email\nAnanya Rao,ananya@example.in\n' }),
      }),
    )

    await click(renderer, 'Export')

    expect(asked(calls, 'mutation ExportCustomers')[0]?.variables).toEqual({ group: null, search: null })
    expect(shareCsv).toHaveBeenCalledWith(expect.stringMatching(/^customers-\d{4}-\d{2}-\d{2}\.csv$/), 'Name,Email\nAnanya Rao,ananya@example.in\n')
    expect(hasText(renderer, '2 rows are ready.')).toBe(true)

    await click(renderer, 'Share the file')
    expect(shareCsv).toHaveBeenCalledTimes(2)
  })

  it('shows the job preparing, and shares nothing yet', async () => {
    const { renderer } = await show(<CustomersScreen />, list({ 'mutation ExportCustomers': () => ({ exportCustomers: 'e-1' }), 'query CustomerExport': () => exportJob('queued') }))

    await click(renderer, 'Export')

    expect(hasText(renderer, 'Preparing your export…')).toBe(true)
    expect(shareCsv).not.toHaveBeenCalled()
  })

  it.each([
    ['too_large', 'That export is too large. Narrow the search and try again.'],
    ['failed', 'The export couldn’t be made. Try again.'],
    ['expired', 'That export has expired. Export again.'],
  ])('says a %s job in words and shares nothing', async (state, words) => {
    const { renderer } = await show(<CustomersScreen />, list({ 'mutation ExportCustomers': () => ({ exportCustomers: 'e-1' }), 'query CustomerExport': () => exportJob(state) }))

    await click(renderer, 'Export')

    expect(hasText(renderer, words)).toBe(true)
    expect(shareCsv).not.toHaveBeenCalled()
  })

  it('says why a refused request did not start', async () => {
    const { renderer } = await show(
      <CustomersScreen />,
      list({
        'mutation ExportCustomers': () => {
          throw new ApiError('FORBIDDEN', 'x')
        },
      }),
    )

    await click(renderer, 'Export')

    expect(hasText(renderer, 'You don’t have access to that.')).toBe(true)
  })
})

describe('One customer', () => {
  it('shows contact, address, spend, groups, tags, the note, consent and the newest orders', async () => {
    const { renderer } = await show(<CustomerScreen id="c-1" />, detail())

    expect(texts(renderer)).toEqual(
      expect.arrayContaining([
        'Ananya Rao',
        'ananya@example.in · +91 98450 12345',
        '14, 3rd Cross, Bengaluru, Karnataka 560038, IN',
        '3 orders',
        '₹12,291.00 spent',
        'Repeat  ×',
        'Yes to marketing emails',
        'KT-1042',
        '₹5,796.00',
      ]),
    )
    expect(input(renderer, 'Note').props.value).toBe('Prefers gift wrap')
    expect(hasText(renderer, '· To ship')).toBe(true)
    expect(hasText(renderer, '· Shipped')).toBe(true)
    expect(hasText(renderer, 'Checkout')).toBe(true)
    await press(pressableNamed(renderer, 'Open order KT-1042'))
    expect(mockPush).toHaveBeenCalledWith('/orders/o-1042')
  })

  it('says how many of their orders are shown when there are more', async () => {
    const { renderer } = await show(<CustomerScreen id="c-1" />, detail({ 'query Customer(': () => ({ customer: person({ ordersCount: 40 }) }) }))

    expect(hasText(renderer, 'The newest 2 of 40 orders')).toBe(true)
  })

  it('draws a skeleton while it loads, and a 404 for a customer that is not there', async () => {
    const pending = held({ customer: null })
    const loading = await show(<CustomerScreen id="c-1" />, detail({ 'query Customer(': () => pending.promise }))
    expect(loading.renderer.root.findAll((node) => node.props.accessibilityRole === 'progressbar').length).toBeGreaterThan(0)
    await act(async () => pending.release())
    await settle()

    const missing = await show(<CustomerScreen id="nope" />, detail({ 'query Customer(': () => ({ customer: null }) }))
    expect(hasText(missing.renderer, 'This page isn’t here any more')).toBe(true)
  })

  it('says it could not load, and loads again on request', async () => {
    let fail = true
    const { renderer, calls } = await show(
      <CustomerScreen id="c-1" />,
      detail({
        'query Customer(': () => {
          if (fail) throw new ApiError('NO_RESPONSE', 'x')
          return { customer: person() }
        },
      }),
    )

    expect(hasText(renderer, 'We couldn’t load this customer')).toBe(true)
    fail = false
    await click(renderer, 'Try again')
    expect(asked(calls, 'query Customer(')).toHaveLength(2)
    expect(hasText(renderer, 'Ananya Rao')).toBe(true)
  })

  it('is access denied to a supplier before any customer is asked for', async () => {
    const { renderer, calls } = await show(<CustomerScreen id="c-1" />, detail({ 'acting { permissions': () => access([], { id: 'supplier-1' }) }), { acting: actingAs('supplier-member', 'vendor-orders-read') })

    expect(hasText(renderer, 'You don’t have access to this customer')).toBe(true)
    expect(asked(calls, 'query Customer(')).toHaveLength(0)
  })

  it('has no write controls for a seat that only reads', async () => {
    const { renderer } = await show(<CustomerScreen id="c-1" />, detail({ 'acting { permissions': () => access(['customers.read']) }))

    expect(hasButton(renderer, 'Edit details')).toBe(false)
    expect(hasButton(renderer, '+ Tag')).toBe(false)
    expect(hasButton(renderer, 'Remove tag Repeat')).toBe(false)
    expect(hasButton(renderer, 'Record that they asked to stop')).toBe(false)
    expect(hasText(renderer, 'Repeat')).toBe(true)
  })

  it('puts them in and takes them out of a group with the whole list of groups', async () => {
    let groupIds = ['g-1']
    const { renderer, calls } = await show(
      <CustomerScreen id="c-1" />,
      detail({
        'query Customer(': () => ({ customer: person({ groupIds }) }),
        'mutation SetGroups': (variables) => {
          groupIds = variables.groups as string[]
          return { setCustomerGroups: groupIds }
        },
      }),
    )

    await click(renderer, 'Wholesale')
    expect(asked(calls, 'mutation SetGroups')[0]?.variables).toEqual({ id: 'c-1', groups: ['g-1', 'g-2'] })
    expect(hasText(renderer, 'Ananya Rao added to Wholesale — offers for this group apply to them now')).toBe(true)

    await click(renderer, 'VIP')
    expect(asked(calls, 'mutation SetGroups')[1]?.variables).toEqual({ id: 'c-1', groups: ['g-2'] })
    expect(hasText(renderer, 'Ananya Rao left VIP')).toBe(true)
  })

  it('shows a refused write above the cards, by its code', async () => {
    const { renderer } = await show(
      <CustomerScreen id="c-1" />,
      detail({
        'mutation SetGroups': () => {
          throw new ApiError('READ_ONLY', 'x')
        },
      }),
    )

    await click(renderer, 'Wholesale')

    expect(hasText(renderer, 'Your store is read-only until the bill is paid.')).toBe(true)
  })

  it('saves the team’s note, and clears it when it is emptied', async () => {
    const { renderer, calls } = await show(<CustomerScreen id="c-1" />, detail({ 'mutation SetNote': () => ({ setCustomerNote: true }) }))

    expect(hasButton(renderer, 'Save note')).toBe(false)
    await type(renderer, 'Note', '')
    await click(renderer, 'Save note')

    expect(asked(calls, 'mutation SetNote')[0]?.variables).toEqual({ id: 'c-1', note: null })
    expect(hasText(renderer, 'Note saved')).toBe(true)
  })

  describe('tags', () => {
    it('adds one to the ones they have, and removes one with its own button', async () => {
      const { renderer, calls } = await show(<CustomerScreen id="c-1" />, detail({ 'mutation SetTags': () => ({ setCustomerTags: [] }) }))

      await click(renderer, '+ Tag')
      await type(renderer, 'Tag', ' Press ')
      await click(renderer, 'Add tag')
      expect(asked(calls, 'mutation SetTags')[0]?.variables).toEqual({ id: 'c-1', tags: ['Repeat', 'Press'] })
      expect(hasText(renderer, 'Tag Press added')).toBe(true)

      await click(renderer, 'Remove tag Repeat')
      expect(asked(calls, 'mutation SetTags')[1]?.variables).toEqual({ id: 'c-1', tags: [] })
    })

    it('keeps a tag to 24 characters and says so before sending', async () => {
      const { renderer, calls } = await show(<CustomerScreen id="c-1" />, detail())

      await click(renderer, '+ Tag')
      await type(renderer, 'Tag', 'x'.repeat(25))
      await click(renderer, 'Add tag')
      expect(hasText(renderer, 'Keep a tag to 24 characters')).toBe(true)
      await type(renderer, 'Tag', 'Repeat')
      await click(renderer, 'Add tag')
      expect(hasText(renderer, 'They already have that tag.')).toBe(true)
      expect(asked(calls, 'mutation SetTags')).toHaveLength(0)
    })

    it('stops offering a new tag at 20, and says why', async () => {
      const twenty = Array.from({ length: 20 }, (_, i) => `tag${i}`)
      const { renderer } = await show(<CustomerScreen id="c-1" />, detail({ 'query Customer(': () => ({ customer: person({ tags: twenty }) }) }))

      expect(hasButton(renderer, '+ Tag')).toBe(false)
      expect(hasText(renderer, 'A customer can have up to 20 tags.')).toBe(true)
    })

    it('keeps the API’s refusal in the sheet with what was typed', async () => {
      const { renderer } = await show(
        <CustomerScreen id="c-1" />,
        detail({
          'mutation SetTags': () => {
            throw new ApiError('TOO_MANY', 'x')
          },
        }),
      )

      await click(renderer, '+ Tag')
      await type(renderer, 'Tag', 'Press')
      await click(renderer, 'Add tag')

      expect(hasText(renderer, 'That’s more than a store can keep.')).toBe(true)
      expect(input(renderer, 'Tag').props.value).toBe('Press')
    })
  })

  describe('marketing consent', () => {
    it('offers "Record that they asked to stop" only while they are opted in, and says what it does first', async () => {
      const { renderer, calls } = await show(<CustomerScreen id="c-1" />, detail({ 'mutation Stop': () => ({ recordMarketingStop: true }) }))

      await click(renderer, 'Record that they asked to stop')
      expect(hasText(renderer, 'Stop marketing to Ananya Rao?')).toBe(true)
      expect(hasText(renderer, 'Do this when they ask you directly. They still get order and delivery emails.')).toBe(true)
      expect(asked(calls, 'mutation Stop')).toHaveLength(0)

      await click(renderer, 'Record it')
      expect(asked(calls, 'mutation Stop')[0]?.variables).toEqual({ id: 'c-1' })
      expect(hasText(renderer, 'Recorded — no more marketing to Ananya Rao')).toBe(true)
    })

    it.each([
      ['stopped', 'Asked to stop marketing'],
      ['declined', 'No marketing — they didn’t tick the box'],
      ['not_asked', 'Not asked yet'],
    ])('does not offer it when they are %s, and never offers to opt them in', async (state, words) => {
      const { renderer } = await show(<CustomerScreen id="c-1" />, detail({ 'query Customer(': () => ({ customer: person({ consent: { state, at: '2026-09-27T04:42:00.000Z', source: 'checkout', channels: [] } }) }) }))

      expect(hasText(renderer, words)).toBe(true)
      expect(hasButton(renderer, 'Record that they asked to stop')).toBe(false)
      expect(hasText(renderer, 'opt them in')).toBe(false)
    })

    it('says texts too when they opted in to them', async () => {
      const { renderer } = await show(<CustomerScreen id="c-1" />, detail({ 'query Customer(': () => ({ customer: person({ consent: { state: 'opted_in', at: '2026-09-27T04:42:00.000Z', source: 'email', channels: ['email', 'sms'] } }) }) }))

      expect(hasText(renderer, 'Yes to marketing emails and texts')).toBe(true)
    })
  })

  describe('edit details', () => {
    const edit = async (handlers: Handlers = {}) => {
      const shown = await show(<CustomerScreen id="c-1" />, detail({ 'mutation UpdateCustomer': () => ({ updateCustomer: true }), ...handlers }))
      await click(shown.renderer, 'Edit details')
      return shown
    }

    it('starts from what is kept and sends the name, number and address as its parts', async () => {
      const { renderer, calls } = await edit()

      expect(input(renderer, 'Full name').props.value).toBe('Ananya Rao')
      expect(input(renderer, 'Street address').props.value).toBe('14, 3rd Cross')
      await type(renderer, 'Phone number', ' +91 99999 00000 ')
      await click(renderer, 'Save')

      expect(asked(calls, 'mutation UpdateCustomer')[0]?.variables).toEqual({
        id: 'c-1',
        name: 'Ananya Rao',
        phone: '+91 99999 00000',
        address: { name: 'Ananya Rao', line1: '14, 3rd Cross', line2: null, city: 'Bengaluru', region: 'Karnataka', postalCode: '560038', country: 'IN' },
      })
      expect(hasText(renderer, 'Saved — past orders keep the details they were placed with')).toBe(true)
    })

    it('wants the address whole or not at all', async () => {
      const { renderer, calls } = await edit()

      await type(renderer, 'City', '')
      await click(renderer, 'Save')
      expect(hasText(renderer, 'Fill in the street, city and country, or leave the address empty.')).toBe(true)
      expect(asked(calls, 'mutation UpdateCustomer')).toHaveLength(0)

      for (const label of ['Street address', 'Flat, floor or building (optional)', 'City', 'State or region (optional)', 'Postal code (optional)']) await type(renderer, label, '')
      await press(pressableNamed(renderer, 'Country: India'))
      await click(renderer, 'No address')
      await click(renderer, 'Save')
      expect(asked(calls, 'mutation UpdateCustomer')[0]?.variables).toMatchObject({ name: 'Ananya Rao', address: null })
    })

    it('needs a name', async () => {
      const { renderer, calls } = await edit()

      await type(renderer, 'Full name', '  ')
      await click(renderer, 'Save')

      expect(hasText(renderer, 'Type a name')).toBe(true)
      expect(asked(calls, 'mutation UpdateCustomer')).toHaveLength(0)
    })

    it('keeps a refused number in the sheet, by its code, with what was typed', async () => {
      const { renderer } = await edit({
        'mutation UpdateCustomer': () => {
          throw new ApiError('NUMBER_TAKEN', 'x')
        },
      })

      await type(renderer, 'Phone number', '+91 11111 11111')
      await click(renderer, 'Save')

      expect(hasText(renderer, 'Another customer already has that number.')).toBe(true)
      expect(input(renderer, 'Phone number').props.value).toBe('+91 11111 11111')
    })
  })
})
