import type { ReactElement } from 'react'
import { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '../../graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { actingAs, fakeClient, hasText, press, pressableNamed, pressablesNamed, renderShell, texts } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { MarketEditorScreen } from './markets/MarketEditorScreen'
import { SettingsScreen } from './SettingsScreen'
import { SettingsTabScreen } from './SettingsTabScreen'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockPush = jest.fn()
const mockBack = jest.fn()
const mockSession: { client: ApiClient | null } = { client: null }

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => ({ push: mockPush, replace: jest.fn(), back: mockBack, navigate: jest.fn() }),
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

const paged = <T,>(nodes: T[]) => ({ nodes, pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } })
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

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
})

describe('Settings is the Owner’s', () => {
  it('lists the seven tabs of this release as a phone list, each opening on its own screen', async () => {
    const { renderer } = await show(<SettingsScreen />, {})

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Store info', 'People', 'Suppliers', 'Warehouse', 'Tax setup', 'Markets', 'Catalogue']))
    expect(hasText(renderer, 'Payment setup')).toBe(false)
    await press(pressableNamed(renderer, 'Markets'))
    expect(mockPush).toHaveBeenCalledWith('/more/settings/markets')
  })

  it('tells a Manager the list is the owner’s, without reading anything', async () => {
    const { renderer, calls } = await show(<SettingsScreen />, {}, { acting: actingAs('manager') })

    expect(hasText(renderer, 'You don’t have access to Settings')).toBe(true)
    expect(hasText(renderer, 'People')).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it.each(['store', 'people', 'suppliers', 'warehouse', 'tax', 'markets', 'catalogue'])('opening %s by a deep link as a Manager is access denied, and reads and writes nothing', async (tab) => {
    const { renderer, calls } = await show(<SettingsTabScreen tab={tab} />, {}, { acting: actingAs('manager') })

    expect(hasText(renderer, 'You don’t have access to Settings')).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('says Staff and a supplier have no access either, and a tab that does not exist is a 404 for the Owner only', async () => {
    const staff = await show(<SettingsTabScreen tab="people" />, {}, { acting: actingAs('staff') })
    expect(hasText(staff.renderer, 'You don’t have access to Settings')).toBe(true)
    const supplier = await show(<SettingsTabScreen tab="people" />, {}, { acting: actingAs('supplier-admin', 'vendor-catalogue') })
    expect(hasText(supplier.renderer, 'You don’t have access to Settings')).toBe(true)
    const missing = await show(<SettingsTabScreen tab="payments" />, {})
    expect(hasText(missing.renderer, 'This page isn’t here any more')).toBe(true)
    const hidden = await show(<SettingsTabScreen tab="payments" />, {}, { acting: actingAs('manager') })
    expect(hasText(hidden.renderer, 'You don’t have access to Settings')).toBe(true)
  })

  it('says it could not load, and loads again on request', async () => {
    let fail = true
    const { renderer, calls } = await show(<SettingsTabScreen tab="warehouse" />, {
      'query Places': () => {
        if (fail) throw new ApiError('NO_RESPONSE', 'x')
        return { warehouses: paged([]) }
      },
    })

    expect(hasText(renderer, 'We couldn’t load Warehouse')).toBe(true)
    fail = false
    await click(renderer, 'Try again')
    expect(asked(calls, 'query Places')).toHaveLength(2)
    expect(hasText(renderer, 'No locations yet')).toBe(true)
  })
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
const locale = {
  pricingCurrency: 'INR',
  mainLanguage: 'en-IN',
  offeredLanguages: ['en-IN', 'hi-IN'],
  currencies: [{ code: 'USD', mode: 'convert', rounding: 'ends-99', status: 'active' }],
  languages: [{ code: 'en-IN', status: 'active' }],
  examples: [{ currency: 'USD', publishedOn: '2026-10-05', from: { amount: '10000', currency: 'INR' }, none: { amount: '120' }, nearest: { amount: '100' }, ends99: { amount: '199' } }],
}

describe('Store info', () => {
  const store = (over: Handlers = {}): Handlers => ({
    '{ storeInfo {': () => ({ storeInfo: info }),
    '{ storeLocale {': () => ({ storeLocale: locale }),
    'query Progress': () => ({}),
    ...over,
  })

  it('saves the details card in the API’s input shape and says so', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="store" />, store({ 'mutation SaveStoreInfo': () => ({ saveStoreInfo: true }) }))

    await type(renderer, 'Store name', 'Kesari Threads Jaipur')
    await type(renderer, 'Prefix', 'kj-')
    await type(renderer, 'Next number', '2000')
    await click(renderer, 'Save store info')

    expect(asked(calls, 'mutation SaveStoreInfo')[0]?.variables).toEqual({
      input: {
        name: 'Kesari Threads Jaipur',
        legalName: '',
        description: '',
        logoAssetId: null,
        address: { street: '14 Johari Bazaar', city: 'Jaipur', postal: '302003', region: 'Rajasthan' },
        contactEmail: 'hello@kesarithreads.in',
        contactPhone: '',
        taxId: '',
        timeZone: 'Asia/Kolkata',
        unitSystem: 'metric',
        orderPrefix: 'KJ-',
        nextOrderNumber: 2000,
      },
    })
    expect(hasText(renderer, 'Store info saved')).toBe(true)
  })

  it('words the address and tax number in the home country’s terms', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="store" />, store())

    expect(texts(renderer)).toEqual(expect.arrayContaining(['PIN code', 'GSTIN']))
  })

  it('does not send a store with no name or an order number below 1, and says what to fix', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="store" />, store())

    await type(renderer, 'Store name', ' ')
    await click(renderer, 'Save store info')
    expect(hasText(renderer, 'Your store needs a name')).toBe(true)
    await type(renderer, 'Store name', 'Kesari')
    await type(renderer, 'Next number', '0')
    await click(renderer, 'Save store info')
    expect(hasText(renderer, 'Type the next order number')).toBe(true)
    expect(asked(calls, 'mutation SaveStoreInfo')).toHaveLength(0)
  })

  it('shows a refusal by its code and keeps what was typed', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="store" />, store({ 'mutation SaveStoreInfo': () => { throw new ApiError('ORDER_NUMBER_DOWN', 'x') } }))

    await type(renderer, 'Next number', '5')
    await click(renderer, 'Save store info')

    expect(hasText(renderer, 'The next order number can only go up, so no number is used twice.')).toBe(true)
    expect((input(renderer, 'Next number').props as { value: string }).value).toBe('5')
  })

  it('saves currencies on their own, asking first before a currency stops converting', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="store" />, store({ 'mutation SaveCurrencies': () => ({ saveCurrencies: true }) }))

    expect(hasText(renderer, '₹100.00 → $1.99 · reference rates from the European Central Bank, published Oct 5, 2026')).toBe(true)
    await click(renderer, 'Convert automatically')
    expect(hasText(renderer, 'Stop converting USD automatically?')).toBe(true)
    await click(renderer, 'Set prices myself')
    await click(renderer, 'Save currencies')

    expect(asked(calls, 'mutation SaveCurrencies')[0]?.variables).toEqual({ c: [{ code: 'USD', mode: 'manual', rounding: 'ends-99' }] })
    expect(asked(calls, 'mutation SaveStoreInfo')).toHaveLength(0)
    expect(hasText(renderer, 'Currencies saved')).toBe(true)
  })

  it('saves languages with the main one, and asks before removing one', async () => {
    const two = { ...locale, languages: [{ code: 'en-IN', status: 'active' }, { code: 'hi-IN', status: 'active' }] }
    const { renderer, calls } = await show(
      <SettingsTabScreen tab="store" />,
      store({ '{ storeLocale {': () => ({ storeLocale: two }), 'query Progress': () => ({ l0: { products: 20, untranslated: 5 } }), 'mutation SaveLanguages': () => ({ saveLanguages: true }) }),
    )

    expect(hasText(renderer, '15 of 20 products translated')).toBe(true)
    await click(renderer, 'Remove Hindi (India)')
    expect(hasText(renderer, 'Your translations are kept but won’t show.')).toBe(true)
    await click(renderer, 'Remove')
    await click(renderer, 'Save languages')

    expect(asked(calls, 'mutation SaveLanguages')[0]?.variables).toEqual({ l: ['en-IN'], m: 'en-IN' })
  })

  it('can look but not change in a store that is read-only', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="store" />, store(), { client: fakeClient({ state: readOnlyState }) })

    expect(hasText(renderer, 'Your store is read-only until the bill is paid.')).toBe(true)
    expect(pressablesNamed(renderer, 'Save store info')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Save currencies')).toHaveLength(0)
  })
})

const person = (over: Record<string, unknown>) => ({ id: 'm1', kind: 'member', name: 'Farhan Ali', email: 'farhan@kesarithreads.in', role: 'owner', you: true, since: '2026-06-01T09:00:00Z', expiresAt: null, expired: false, ...over })
const people = [
  person({}),
  person({ id: 'm2', name: 'Meera Joshi', email: 'meera@kesarithreads.in', role: 'manager', you: false }),
  person({ id: 'i1', kind: 'invitation', name: null, email: 'asha@example.com', role: 'staff', you: false, since: '2026-10-04T09:00:00Z', expiresAt: '2026-10-11T09:00:00Z' }),
  person({ id: 'i2', kind: 'invitation', name: null, email: 'old@example.com', role: 'staff', you: false, expired: true, expiresAt: '2026-09-01T09:00:00Z' }),
]

describe('People', () => {
  const team = (over: Handlers = {}): Handlers => ({ 'query People(': () => ({ people: paged(people) }), '{ storeInfo {': () => ({ storeInfo: info }), ...over })

  it('lists everyone with their role and state, and the invitations waiting', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="people" />, team())

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Farhan Ali', 'farhan@kesarithreads.in · you', 'Owner', 'Active', 'Meera Joshi', 'Manager', 'asha@example.com', 'Waiting', 'Invite expired']))
    expect(hasText(renderer, '2 active · 2 waiting to accept.')).toBe(true)
    await click(renderer, 'Waiting 2')
    expect(hasText(renderer, 'Meera Joshi')).toBe(false)
  })

  it('invites by email with a role, which the server sends, and shows the people again', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="people" />, team({ 'mutation InviteMember': () => ({ inviteMember: true }) }))

    await click(renderer, 'Invite someone')
    await type(renderer, 'Their email', 'ravi@example.com')
    await pick(renderer, 'Manager')
    await click(renderer, 'Send invite')

    expect(asked(calls, 'mutation InviteMember')[0]?.variables).toEqual({ e: 'ravi@example.com', r: 'manager' })
    expect(hasText(renderer, 'Invite sent to ravi@example.com')).toBe(true)
    expect(asked(calls, 'query People(').length).toBeGreaterThan(1)
  })

  it('does not send an address that is not one, and keeps the sheet open', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="people" />, team())

    await click(renderer, 'Invite someone')
    await type(renderer, 'Their email', 'ravi')
    await click(renderer, 'Send invite')

    expect(hasText(renderer, 'That doesn’t look like an email address')).toBe(true)
    expect(asked(calls, 'mutation InviteMember')).toHaveLength(0)
  })

  it('keeps what was typed and says why when the API refuses by code', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="people" />, team({ 'mutation InviteMember': () => { throw new ApiError('ALREADY_MEMBER', 'x') } }))

    await click(renderer, 'Invite someone')
    await type(renderer, 'Their email', 'meera@kesarithreads.in')
    await click(renderer, 'Send invite')

    expect(hasText(renderer, 'They’re already in this store.')).toBe(true)
    expect((input(renderer, 'Their email').props as { value: string }).value).toBe('meera@kesarithreads.in')
  })

  it('changes a role, saying it can take a few minutes', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="people" />, team({ 'mutation ChangeRole': () => ({ changeRole: true }) }))

    await click(renderer, 'Manage Meera Joshi')
    await click(renderer, 'Change role')
    expect(hasText(renderer, 'Role changes can take a few minutes to apply.')).toBe(true)
    await pick(renderer, 'Staff')
    await clickLast(renderer, 'Change role')

    expect(asked(calls, 'mutation ChangeRole')[0]?.variables).toEqual({ id: 'm2', r: 'staff' })
    expect(hasText(renderer, 'Meera Joshi is now Staff')).toBe(true)
  })

  it('refuses to remove or demote the last owner, by its code', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="people" />, team({ 'mutation RemoveMember': () => { throw new ApiError('LAST_OWNER', 'x') } }))

    await click(renderer, 'Manage Farhan Ali')
    await click(renderer, 'Remove from this store')
    expect(hasText(renderer, 'They lose access to this store straight away.')).toBe(true)
    await click(renderer, 'Remove')

    expect(hasText(renderer, 'The last owner can’t be demoted or removed — make someone else an owner first.')).toBe(true)
  })

  it('resends an invitation, naming the old link’s end, and cancels one only after asking', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="people" />, team({ 'mutation ResendInvitation': () => ({ resendInvitation: true }), 'mutation RevokeInvitation': () => ({ revokeInvitation: true }) }))

    await click(renderer, 'Manage asha@example.com')
    await click(renderer, 'Resend invite — the old link stops working')
    expect(asked(calls, 'mutation ResendInvitation')[0]?.variables).toEqual({ id: 'i1' })
    expect(hasText(renderer, 'New invite sent to asha@example.com')).toBe(true)

    await click(renderer, 'Manage old@example.com')
    await click(renderer, 'Cancel invite')
    expect(hasText(renderer, 'The link in their email stops working.')).toBe(true)
    expect(asked(calls, 'mutation RevokeInvitation')).toHaveLength(0)
    await press(pressablesNamed(renderer, 'Cancel invite').at(-1) as never)
    await settle()
    expect(asked(calls, 'mutation RevokeInvitation')[0]?.variables).toEqual({ id: 'i2' })
  })

  it('shows no secret or link anywhere, and no controls to a store that is read-only', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="people" />, team(), { client: fakeClient({ state: readOnlyState }) })

    expect(texts(renderer).join(' ')).not.toMatch(/token|https?:\/\//i)
    expect(pressablesNamed(renderer, 'Invite someone')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Manage Meera Joshi')).toHaveLength(0)
  })
})

const supplier = (over: Record<string, unknown>) => ({ id: 'v1', name: 'Northwind Textiles', accessLevel: 'vendor-catalogue', shippingMode: 'to-store', labelAccount: 'store', status: 'active', users: 2, products: 14, ...over })

describe('Suppliers', () => {
  const list = (over: Handlers = {}): Handlers => ({
    'query Suppliers(': () => ({ suppliers: paged([supplier({}), supplier({ id: 'v3', name: 'Moradabad Brass', status: 'suspended', users: 1, products: 3 })]) }),
    '{ supplierApprovalRequired }': () => ({ supplierApprovalRequired: true }),
    ...over,
  })

  it('lists each company with its access level, people, products and status', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="suppliers" />, list())

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Northwind Textiles', '2 users · 14 products', 'Products and stock', 'Active', 'Moradabad Brass', 'Suspended']))
    expect(hasText(renderer, '2 companies, 17 of your products.')).toBe(true)
  })

  it('invites a company and its first user, naming what they can do', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="suppliers" />, list({ 'mutation InviteSupplier': () => ({ inviteSupplier: 'v9' }) }))

    await click(renderer, 'Invite a supplier')
    await type(renderer, 'Company name', 'Sanganer Prints')
    await type(renderer, 'First user’s email', 'owner@sanganer.example')
    await pick(renderer, 'Stock only')
    await click(renderer, 'Send the invite')

    expect(asked(calls, 'mutation InviteSupplier')[0]?.variables).toEqual({ input: { name: 'Sanganer Prints', email: 'owner@sanganer.example', accessLevel: 'vendor-stock' } })
    expect(hasText(renderer, 'Invite sent to owner@sanganer.example at Sanganer Prints')).toBe(true)
  })

  it('turns approval off only after saying what changes', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="suppliers" />, list({ 'mutation SetApproval': () => ({ setApproval: true }) }))

    await click(renderer, 'Approve supplier products before they go live')
    expect(hasText(renderer, 'Turn approval off?')).toBe(true)
    expect(asked(calls, 'mutation SetApproval')).toHaveLength(0)
    await click(renderer, 'Turn off')
    expect(asked(calls, 'mutation SetApproval')[0]?.variables).toEqual({ on: false })
  })

  it('changes how a supplier ships, asking about labels only for items sent straight to the shopper', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="suppliers" />, list({ 'mutation SetShippingMode': () => ({ setSupplierShippingMode: true }) }))

    await click(renderer, 'Manage Northwind Textiles')
    await click(renderer, 'Change how they ship')
    expect(hasText(renderer, 'Labels bought on')).toBe(false)
    await click(renderer, 'Straight to the shopper')
    await click(renderer, 'Their own courier account')
    await click(renderer, 'Save')

    expect(asked(calls, 'mutation SetShippingMode')[0]?.variables).toEqual({ id: 'v1', m: 'to-shopper', l: 'own' })
  })

  it('suspends with the choice to hide their products, and reactivates one that is suspended', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="suppliers" />, list({ 'mutation SuspendSupplier': () => ({ suspendSupplier: 14 }), 'mutation ResumeSupplier': () => ({ resumeSupplier: 3 }) }))

    await click(renderer, 'Manage Northwind Textiles')
    await click(renderer, 'Suspend')
    expect(hasText(renderer, 'Their 14 products are still in your catalogue.')).toBe(true)
    await click(renderer, 'Keep selling their products')
    await press(pressablesNamed(renderer, 'Suspend').at(-1) as never)
    await settle()
    expect(asked(calls, 'mutation SuspendSupplier')[0]?.variables).toEqual({ id: 'v1', h: false })

    await click(renderer, 'Manage Moradabad Brass')
    await click(renderer, 'Reactivate')
    expect(asked(calls, 'mutation ResumeSupplier')[0]?.variables).toEqual({ id: 'v3' })
  })

  it('shows a refusal by its code', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="suppliers" />, list({ 'mutation InviteSupplier': () => { throw new ApiError('DUPLICATE_SUPPLIER', 'x') } }))

    await click(renderer, 'Invite a supplier')
    await type(renderer, 'Company name', 'Northwind Textiles')
    await type(renderer, 'First user’s email', 'a@northwind.example')
    await click(renderer, 'Send the invite')

    expect(hasText(renderer, 'That company is already one of your suppliers.')).toBe(true)
  })
})

const place = (over: Record<string, unknown>) => ({
  id: 'w1',
  name: 'Main godown',
  isDefault: true,
  units: 40,
  revision: 2,
  address: { line1: '14 Johari Bazaar', line2: null, city: 'Jaipur', region: 'Rajasthan', postalCode: '302003', country: 'IN' },
  supplierId: null,
  supplierName: null,
  ...over,
})

describe('Warehouse', () => {
  const places = [place({}), place({ id: 'w2', name: 'Back room', isDefault: false, units: 0, address: null }), place({ id: 'w3', name: 'Shed', isDefault: false, units: 7 }), place({ id: 'w9', name: 'Their shelf', isDefault: false, supplierId: 's1', supplierName: 'Northwind' })]
  const store = (over: Handlers = {}): Handlers => ({ 'query Places': () => ({ warehouses: paged(places) }), ...over })

  it('lists the store’s locations with the default first, and its suppliers’ apart with no controls', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="warehouse" />, store())

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Main godown', 'Default for new products', 'Back room', 'Supplier locations', 'Their shelf', 'Northwind · 14 Johari Bazaar, Jaipur, Rajasthan, IN · 40 units']))
    expect(pressablesNamed(renderer, 'Manage Their shelf')).toHaveLength(0)
  })

  it('adds a location with the name and only the address lines given', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="warehouse" />, store({ 'mutation SavePlace': () => ({ saveWarehouse: 'w10' }) }))

    await click(renderer, 'Add a location')
    await type(renderer, 'Name', 'Pop-up')
    await type(renderer, 'City', 'Udaipur')
    await click(renderer, 'Add location')

    expect(asked(calls, 'mutation SavePlace')[0]?.variables).toEqual({ id: null, r: null, input: { name: 'Pop-up', address: { city: 'Udaipur' } } })
    expect(hasText(renderer, 'Pop-up added')).toBe(true)
  })

  it('needs a name', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="warehouse" />, store())

    await click(renderer, 'Add a location')
    await click(renderer, 'Add location')

    expect(hasText(renderer, 'Give it a name')).toBe(true)
    expect(asked(calls, 'mutation SavePlace')).toHaveLength(0)
  })

  it('edits at the revision it was read at, and says so when someone else saved first', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="warehouse" />, store({ 'mutation SavePlace': () => { throw new ApiError('STALE_REVISION', 'x') } }))

    await click(renderer, 'Manage Main godown')
    await click(renderer, 'Rename or change address')
    await type(renderer, 'Name', 'Main store')
    await click(renderer, 'Save')

    expect(asked(calls, 'mutation SavePlace')[0]?.variables).toMatchObject({ id: 'w1', r: 2, input: { name: 'Main store' } })
    expect(hasText(renderer, 'Someone else changed this location first.')).toBe(true)
  })

  it('makes one the default and says existing stock does not move, after asking', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="warehouse" />, store({ 'mutation MakeDefaultPlace': () => ({ setDefaultWarehouse: true }) }))

    await click(renderer, 'Manage Back room')
    await click(renderer, 'Make default')
    expect(hasText(renderer, 'New products start here. Existing stock doesn’t move.')).toBe(true)
    expect(asked(calls, 'mutation MakeDefaultPlace')).toHaveLength(0)
    await press(pressablesNamed(renderer, 'Make default').at(-1) as never)
    await settle()
    expect(asked(calls, 'mutation MakeDefaultPlace')[0]?.variables).toEqual({ id: 'w2' })
  })

  it('does not even ask to delete a location that still holds stock, and deletes an empty one after asking', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="warehouse" />, store({ 'mutation DeletePlace': () => ({ deleteWarehouse: true }) }))

    await click(renderer, 'Manage Shed')
    await click(renderer, 'Delete')
    expect(hasText(renderer, 'Shed still holds 7 units')).toBe(true)
    expect(asked(calls, 'mutation DeletePlace')).toHaveLength(0)

    await click(renderer, 'Manage Back room')
    await click(renderer, 'Delete')
    await click(renderer, 'Delete location')
    expect(asked(calls, 'mutation DeletePlace')[0]?.variables).toEqual({ id: 'w2' })
  })

  it('offers no way to delete or move the default', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="warehouse" />, store())

    await click(renderer, 'Manage Main godown')
    expect(pressablesNamed(renderer, 'Delete')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Make default')).toHaveLength(0)
  })
})

const taxSetup = {
  pricesIncludeTax: true,
  classes: [
    { id: 't12', name: 'Clothing', isDefault: true, taxCode: null, versions: 41 },
    { id: 't5', name: 'Under ₹1,000', isDefault: false, taxCode: '6109', versions: 0 },
  ],
  zones: [
    { id: 'z-in', name: 'India', countries: ['IN'], regions: [], rates: [{ taxClassId: 't12', rateBps: 1200 }, { taxClassId: 't5', rateBps: 500 }] },
    { id: 'z-ae', name: 'UAE', countries: ['AE'], regions: [], rates: [{ taxClassId: 't12', rateBps: 500 }] },
  ],
}

describe('Tax setup', () => {
  const tax = (over: Handlers = {}): Handlers => ({
    '{ taxSetup {': () => ({ taxSetup: taxSetup }),
    '{ invoiceSettings {': () => ({ invoiceSettings: { taxPerLine: true, emailWithDispatch: false, footer: 'Thank you', legalName: 'Kesari Threads Pvt Ltd' } }),
    '{ storeInfo {': () => ({ storeInfo: { ...info, taxId: '08ABCDE1234F1Z5' } }),
    ...over,
  })

  it('shows the rates the API holds, in words naming the tax, with no price worked out', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="tax" />, tax())

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Clothing', '12%', 'default for new products', '5%', 'Rates in other places', 'UAE', 'Your tax number: 08ABCDE1234F1Z5']))
    expect(hasText(renderer, 'The price you type is the price shoppers pay; GST is part of it.')).toBe(true)
  })

  it('switches how prices are typed only after saying the numbers stay and what shoppers pay changes', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="tax" />, tax({ 'mutation SetPricesIncludeTax': () => ({ setPricesIncludeTax: true }) }))

    await pick(renderer, 'Prices don’t include GST')
    await click(renderer, 'Save')
    expect(hasText(renderer, 'Prices exclude GST from now on?')).toBe(true)
    expect(hasText(renderer, 'The numbers you typed on your products stay as they are')).toBe(true)
    expect(asked(calls, 'mutation SetPricesIncludeTax')).toHaveLength(0)
    await press(pressablesNamed(renderer, 'Save').at(-1) as never)
    await settle()

    expect(asked(calls, 'mutation SetPricesIncludeTax')[0]?.variables).toEqual({ i: false })
    expect(hasText(renderer, 'Prices now exclude GST — it’s added at checkout')).toBe(true)
  })

  it('adds a category with its rate in basis points, the home zone named for the country', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="tax" />, tax({ 'mutation AddTaxCategory': () => ({ addTaxCategory: 't7' }) }))

    await click(renderer, 'Add a rate')
    await type(renderer, 'Name', 'Books')
    await type(renderer, 'Rate, %', '7.5')
    await click(renderer, 'Add')

    expect(asked(calls, 'mutation AddTaxCategory')[0]?.variables).toEqual({ n: 'Books', r: 750, h: 'India' })
  })

  it('changes a category’s rate at home, and refuses what is not a percentage', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="tax" />, tax({ 'mutation SetHomeTaxRate': () => ({ setHomeTaxRate: true }) }))

    await click(renderer, 'Manage Clothing')
    await click(renderer, 'Change its rate')
    await type(renderer, 'Rate, %', '101')
    await clickLast(renderer, 'Save')
    expect(hasText(renderer, 'Type a percentage from 0 to 100')).toBe(true)
    expect(asked(calls, 'mutation SetHomeTaxRate')).toHaveLength(0)
    await type(renderer, 'Rate, %', '18')
    await clickLast(renderer, 'Save')

    expect(asked(calls, 'mutation SetHomeTaxRate')[0]?.variables).toEqual({ c: 't12', r: 1800, h: 'India' })
  })

  it('never offers deleting the default nor a category a product version uses, and deletes an unused one after asking', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="tax" />, tax({ 'mutation DeleteTaxClass': () => ({ deleteTaxClass: true }) }))

    await click(renderer, 'Manage Clothing')
    expect(pressablesNamed(renderer, 'Delete')).toHaveLength(0)
    await click(renderer, 'Manage Under ₹1,000')
    await click(renderer, 'Delete')
    expect(hasText(renderer, 'No product uses it, so nothing else changes.')).toBe(true)
    await press(pressablesNamed(renderer, 'Delete').at(-1) as never)
    await settle()

    expect(asked(calls, 'mutation DeleteTaxClass')[0]?.variables).toEqual({ id: 't5' })
  })

  it('saves the invoice switches and sends the footer back as it is', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="tax" />, tax({ 'mutation SaveInvoiceSettings': () => ({ saveInvoiceSettings: true }) }))

    await click(renderer, 'Email the invoice with the dispatch note')
    await click(renderer, 'Save invoice settings')

    expect(asked(calls, 'mutation SaveInvoiceSettings')[0]?.variables).toEqual({ input: { taxPerLine: true, emailWithDispatch: true, footer: 'Thank you' } })
  })

  it('shows a refusal by its code', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="tax" />, tax({ 'mutation AddTaxCategory': () => { throw new ApiError('DUPLICATE_NAME', 'x') } }))

    await click(renderer, 'Add a rate')
    await type(renderer, 'Name', 'Clothing')
    await type(renderer, 'Rate, %', '12')
    await click(renderer, 'Add')

    expect(hasText(renderer, 'Another category already has that name.')).toBe(true)
  })

  it('leaves a US store’s rates to the shopper’s state: no add and no rate change', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="tax" />, tax({ '{ storeInfo {': () => ({ storeInfo: { ...info, country: 'US' } }) }))

    expect(hasText(renderer, 'Rate depends on the shopper’s state')).toBe(true)
    expect(pressablesNamed(renderer, 'Add a rate')).toHaveLength(0)
  })
})

const market = (over: Record<string, unknown>) => ({
  id: 'mk-in',
  name: 'India',
  parentId: null,
  primary: true,
  everywhereElse: false,
  active: true,
  countries: ['IN'],
  currency: 'INR',
  language: 'en-IN',
  priceAdjustmentBps: 0,
  webMode: 'main',
  pathPrefix: null,
  products: 'all',
  excludedProductIds: [],
  excludedProducts: [],
  duties: { mode: 'none', rateBps: null, thresholdAmount: null },
  revision: 1,
  ...over,
})
const markets = [
  market({}),
  market({ id: 'mk-us', name: 'United States', primary: false, everywhereElse: true, countries: ['US'], currency: 'USD', language: 'en-US', priceAdjustmentBps: 1000, webMode: 'path', pathPrefix: 'us', revision: 4 }),
  market({ id: 'mk-ae', name: 'UAE', primary: false, active: false, countries: ['AE'], currency: 'AED' }),
]
const marketLocale = { ...locale, currencies: [{ code: 'USD', mode: 'convert', rounding: 'ends-99', status: 'active' }, { code: 'AED', mode: 'manual', rounding: 'none', status: 'active' }], languages: [{ code: 'en-IN', status: 'active' }, { code: 'en-US', status: 'active' }] }

describe('Markets', () => {
  const store = (over: Handlers = {}): Handlers => ({ 'query Markets(': () => ({ markets: paged(markets) }), '{ storeLocale {': () => ({ storeLocale: marketLocale }), ...over })

  it('lists each market with its countries, currency and state, and opens one on its own screen', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="markets" />, store())

    expect(texts(renderer)).toEqual(expect.arrayContaining(['India', 'India · INR', 'Primary', 'United States', 'United States · USD', 'Active', 'UAE', 'Off']))
    await press(pressableNamed(renderer, 'Open United States'))
    expect(mockPush).toHaveBeenCalledWith('/more/settings/market/mk-us')
  })

  it('starts a new market by its name, and opens its editor with that name', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="markets" />, store())

    await click(renderer, 'Add market')
    await type(renderer, 'Market name', 'United Kingdom')
    await click(renderer, 'Create')

    expect(mockPush).toHaveBeenCalledWith('/more/settings/market/new?name=United%20Kingdom')
  })

  it('changes what shoppers elsewhere get only after saying so', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="markets" />, store({ 'mutation SetEverywhereElse': () => ({ setEverywhereElse: true }) }))

    await click(renderer, 'Everywhere else: United States')
    await click(renderer, 'India')
    expect(hasText(renderer, 'Change what shoppers elsewhere get?')).toBe(true)
    expect(asked(calls, 'mutation SetEverywhereElse')).toHaveLength(0)
    await click(renderer, 'Change')

    expect(asked(calls, 'mutation SetEverywhereElse')[0]?.variables).toEqual({ id: 'mk-in' })
  })

  const editor = (id: string | null, over: Handlers = {}, suggested = '', options: Options = {}) => show(<MarketEditorScreen id={id} suggested={suggested} />, store(over), options)

  it('saves a market in the API’s shape, at the revision it was read at, with the adjustment in basis points', async () => {
    const { renderer, calls } = await editor('mk-us', { 'mutation SaveMarket': () => ({ saveMarket: market({ id: 'mk-us', name: 'United States', revision: 5 }) }) })

    await type(renderer, 'Price adjustment, %', '12.5')
    await click(renderer, 'Save market')

    expect(asked(calls, 'mutation SaveMarket')[0]?.variables).toEqual({
      id: 'mk-us',
      r: 4,
      input: {
        name: 'United States',
        parentId: null,
        active: true,
        countries: ['US'],
        currency: 'USD',
        language: 'en-US',
        priceAdjustmentBps: 1250,
        webMode: 'path',
        pathPrefix: 'us',
        products: 'all',
        excludedProductIds: [],
        dutiesMode: 'none',
        dutiesRateBps: null,
        dutiesThresholdAmount: null,
      },
    })
    expect(hasText(renderer, 'United States saved')).toBe(true)
    expect(mockBack).toHaveBeenCalled()
  })

  it('creates a new market named from the list, with no countries until they are picked, and says what is missing', async () => {
    const { renderer, calls } = await editor(null, { 'mutation SaveMarket': () => ({ saveMarket: market({ id: 'mk-uk', name: 'United Kingdom', primary: false }) }) }, 'United Kingdom')

    expect((input(renderer, 'Market name').props as { value: string }).value).toBe('United Kingdom')
    await click(renderer, 'Save market')
    expect(hasText(renderer, 'Pick at least one country')).toBe(true)
    expect(asked(calls, 'mutation SaveMarket')).toHaveLength(0)
    await click(renderer, 'Add a country')
    await click(renderer, 'United Kingdom')
    await click(renderer, 'Save market')

    expect(asked(calls, 'mutation SaveMarket')[0]?.variables).toMatchObject({ id: null, r: null, input: { name: 'United Kingdom', countries: ['GB'], currency: 'INR', language: 'en-IN', active: true } })
    expect(hasText(renderer, 'United Kingdom added')).toBe(true)
  })

  it('names the market that already holds a country and will not take it twice', async () => {
    const { renderer } = await editor('mk-us')

    await click(renderer, 'Add a country')
    expect(pressablesNamed(renderer, 'India')).toHaveLength(0)
    expect(hasText(renderer, 'United States')).toBe(true)
  })

  it('shows the API’s refusal by its code, and reads the markets again when someone else saved first', async () => {
    let reads = 0
    const { renderer } = await editor('mk-us', {
      'query Markets(': () => {
        reads += 1
        return { markets: paged(reads === 1 ? markets : [markets[0], { ...markets[1], name: 'USA', revision: 5 }]) }
      },
      'mutation SaveMarket': () => {
        throw new ApiError('STALE_REVISION', 'x')
      },
    })

    await type(renderer, 'Price adjustment, %', '3')
    await click(renderer, 'Save market')

    expect(hasText(renderer, 'Someone else changed this market first.')).toBe(true)
    expect(hasText(renderer, 'It now shows what’s saved.')).toBe(true)
    expect((input(renderer, 'Market name').props as { value: string }).value).toBe('USA')
  })

  it('refuses the primary market’s deletion by offering none, and deletes another after saying where its shoppers go', async () => {
    const primary = await editor('mk-in')
    expect(pressablesNamed(primary.renderer, 'Delete market')).toHaveLength(0)

    const { renderer, calls } = await editor('mk-ae', { 'mutation DeleteMarket': () => ({ deleteMarket: true }) })
    await click(renderer, 'Delete market')
    expect(hasText(renderer, 'Shoppers in United Arab Emirates get your “Everywhere else” settings instead.')).toBe(true)
    await press(pressablesNamed(renderer, 'Delete market').at(-1) as never)
    await settle()

    expect(asked(calls, 'mutation DeleteMarket')[0]?.variables).toEqual({ id: 'mk-ae' })
    expect(mockBack).toHaveBeenCalled()
  })

  it('says a market that is not here is a 404, and one in a read-only store can only be looked at', async () => {
    const missing = await editor('nope')
    expect(hasText(missing.renderer, 'This page isn’t here any more')).toBe(true)

    const { renderer } = await editor('mk-us', {}, '', { client: fakeClient({ state: readOnlyState }) })
    expect(hasText(renderer, 'United States')).toBe(true)
    expect(pressablesNamed(renderer, 'Delete market')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Save market')).toHaveLength(0)
  })

  it('is access denied to a Manager, who reads nothing', async () => {
    const { renderer, calls } = await editor('mk-us', {}, '', { acting: actingAs('manager') })

    expect(hasText(renderer, 'You don’t have access to Markets')).toBe(true)
    expect(total(calls)).toEqual([])
  })
})

const features = [
  { key: 'sizeCharts', enabled: true, inPlan: true },
  { key: 'specs', enabled: false, inPlan: true },
  { key: 'badges', enabled: true, inPlan: true },
  { key: 'aplus', enabled: false, inPlan: false },
]

describe('Catalogue', () => {
  const store = (over: Handlers = {}): Handlers => ({
    '{ catalogueSettings {': () => ({ catalogueSettings: { features, badges: [{ id: 'b1', label: 'New', rule: 'new_30_days', tone: 'ok', position: 0 }, { id: 'b2', label: 'Handmade', rule: 'manual', tone: 'neutral', position: 1 }] } }),
    ...over,
  })

  it('shows each section with its plan, and none a plan lacks can be switched on', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="catalogue" />, store())

    expect(hasText(renderer, 'Big photos and feature blocks · Not in your plan')).toBe(true)
    expect(hasText(renderer, 'Helps shoppers pick the right size · Included in your plan')).toBe(true)
    expect(pressablesNamed(renderer, 'A+ content · Product story')[0]?.props.accessibilityState).toMatchObject({ disabled: true })
    expect(hasText(renderer, 'See plans')).toBe(false)
  })

  it('saves the sections after saying turning one off hides it on every product', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="catalogue" />, store({ 'mutation SaveSections': () => ({ saveCatalogueSettings: [] }) }))

    await click(renderer, 'Specifications')
    await click(renderer, 'Size charts')
    await click(renderer, 'Save sections')
    expect(hasText(renderer, 'Turning a section off hides it on every product.')).toBe(true)
    expect(asked(calls, 'mutation SaveSections')).toHaveLength(0)
    await press(pressablesNamed(renderer, 'Save sections').at(-1) as never)
    await settle()

    const sent = asked(calls, 'mutation SaveSections')[0]?.variables as { f: { key: string; enabled: boolean }[] }
    expect(sent.f).toEqual(expect.arrayContaining([{ key: 'specs', enabled: true }, { key: 'sizeCharts', enabled: false }, { key: 'badges', enabled: true }, { key: 'aplus', enabled: false }]))
  })

  it('switches on the sections a kind of shop wants, to be saved with the rest', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="catalogue" />, store())

    await click(renderer, 'Electronics')

    expect(hasText(renderer, 'Electronics sections switched on — press Save sections to keep them')).toBe(true)
    expect(asked(calls, 'mutation SaveSections')).toHaveLength(0)
  })

  it('adds a badge with its text and rule, and says whether it applies by itself', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="catalogue" />, store({ 'mutation SaveBadge': () => ({ saveBadge: 'b3' }) }))

    await click(renderer, 'Add a badge')
    await type(renderer, 'What it says', 'Few left')
    await click(renderer, 'Only a few left — automatic')
    await click(renderer, 'Save badge')

    expect(asked(calls, 'mutation SaveBadge')[0]?.variables).toEqual({ id: null, input: { label: 'Few left', rule: 'few_left', tone: 'peach', position: 2 } })
    expect(hasText(renderer, '“Few left” added — it applies by itself')).toBe(true)
  })

  it('keeps a badge to 18 characters and needs its text', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="catalogue" />, store())

    await click(renderer, 'Add a badge')
    await click(renderer, 'Save badge')
    expect(hasText(renderer, 'Type the badge text')).toBe(true)
    await type(renderer, 'What it says', 'Hand-woven in Jaipur by artisans')
    await click(renderer, 'Save badge')
    expect(hasText(renderer, 'Keep it to 18 characters')).toBe(true)
    expect(asked(calls, 'mutation SaveBadge')).toHaveLength(0)
  })

  it('edits a badge in place and deletes one after saying it comes off every product', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="catalogue" />, store({ 'mutation SaveBadge': () => ({ saveBadge: 'b2' }), 'mutation DeleteBadge': () => ({ deleteBadge: true }) }))

    await click(renderer, 'Manage “Handmade”')
    await click(renderer, 'Edit')
    await type(renderer, 'What it says', 'Hand made')
    await click(renderer, 'Save badge')
    expect(asked(calls, 'mutation SaveBadge')[0]?.variables).toEqual({ id: 'b2', input: { label: 'Hand made', rule: 'manual', tone: 'neutral', position: 1 } })

    await click(renderer, 'Manage “New”')
    await click(renderer, 'Delete badge')
    expect(hasText(renderer, 'It comes off every product straight away.')).toBe(true)
    await press(pressablesNamed(renderer, 'Delete badge').at(-1) as never)
    await settle()
    expect(asked(calls, 'mutation DeleteBadge')[0]?.variables).toEqual({ id: 'b1' })
  })

  it('shows a refusal by its code', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="catalogue" />, store({ 'mutation SaveBadge': () => { throw new ApiError('DUPLICATE_LABEL', 'x') } }))

    await click(renderer, 'Add a badge')
    await type(renderer, 'What it says', 'New')
    await click(renderer, 'Save badge')

    expect(hasText(renderer, 'Another badge already says that.')).toBe(true)
  })

  it('leaves legal details out: they wait for their API', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="catalogue" />, store())

    expect(hasText(renderer, 'Legal')).toBe(false)
  })
})
