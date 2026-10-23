import type { ReactElement } from 'react'
import { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { actingAs, fakeClient, hasText, press, pressableNamed, pressablesNamed, renderShell, texts } from '../../testing/harness'
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

describe('Settings is the Owner’s', () => {
  it.each(['people', 'suppliers', 'warehouse'])('opening %s by a deep link as a Manager is access denied, and reads and writes nothing', async (tab) => {
    const { renderer, calls } = await show(<SettingsTabScreen tab={tab} />, {}, { acting: actingAs('manager') })

    expect(hasText(renderer, 'You don’t have access to Settings')).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('says Staff and a supplier have no access to People either', async () => {
    const staff = await show(<SettingsTabScreen tab="people" />, {}, { acting: actingAs('staff') })
    expect(hasText(staff.renderer, 'You don’t have access to Settings')).toBe(true)
    const supplier = await show(<SettingsTabScreen tab="people" />, {}, { acting: actingAs('supplier-admin', 'vendor-catalogue') })
    expect(hasText(supplier.renderer, 'You don’t have access to Settings')).toBe(true)
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

  it('refuses to demote the last owner through a role change too, by its code', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="people" />, team({ 'mutation ChangeRole': () => { throw new ApiError('LAST_OWNER', 'x') } }))

    await click(renderer, 'Manage Farhan Ali')
    await click(renderer, 'Change role')
    await pick(renderer, 'Manager')
    await clickLast(renderer, 'Change role')

    expect(hasText(renderer, 'The last owner can’t be demoted or removed — make someone else an owner first.')).toBe(true)
  })

  it('does not show the invitation times in a guessed zone: the tab says it could not load when the store’s zone can’t be read', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="people" />, team({ '{ storeInfo {': () => { throw new ApiError('NO_RESPONSE', 'x') } }))

    expect(hasText(renderer, 'We couldn’t load People')).toBe(true)
    expect(hasText(renderer, 'invited')).toBe(false)
  })

  it('says it could not load when the store has no info to take a time zone from either', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="people" />, team({ '{ storeInfo {': () => ({ storeInfo: null }) }))

    expect(hasText(renderer, 'We couldn’t load People')).toBe(true)
    expect(hasText(renderer, 'invited')).toBe(false)
  })

  it('resends an invitation, naming the old link’s end, and cancels one only after asking', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="people" />, team({ 'mutation ResendInvitation': () => ({ resendInvitation: true }), 'mutation RevokeInvitation': () => ({ revokeInvitation: true }) }))

    await click(renderer, 'Manage asha@example.com')
    await click(renderer, 'Resend invite — the old link stops working')
    expect(hasText(renderer, 'A new link goes to them by email, and the old link stops working.')).toBe(true)
    expect(asked(calls, 'mutation ResendInvitation')).toHaveLength(0)
    await clickLast(renderer, 'Send a new invite')
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

  it('says why a resend is refused, by its code, rather than a generic failure', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="people" />, team({ 'mutation ResendInvitation': () => { throw new ApiError('RATE_LIMITED', 'x') } }))

    await click(renderer, 'Manage asha@example.com')
    await click(renderer, 'Resend invite — the old link stops working')
    await clickLast(renderer, 'Send a new invite')

    expect(hasText(renderer, 'Too many invitations for now. Try again later.')).toBe(true)
    expect(hasText(renderer, 'Something went wrong')).toBe(false)
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

  it('filters companies by their own state: an invited one is under Invited, not Active', async () => {
    const { renderer } = await show(
      <SettingsTabScreen tab="suppliers" />,
      list({ 'query Suppliers(': () => ({ suppliers: paged([supplier({}), supplier({ id: 'v2', name: 'Sanganer Prints', status: 'invited' }), supplier({ id: 'v3', name: 'Moradabad Brass', status: 'suspended' })]) }) }),
    )

    await click(renderer, 'Active 1')
    expect(hasText(renderer, 'Northwind Textiles')).toBe(true)
    expect(hasText(renderer, 'Sanganer Prints')).toBe(false)
    await click(renderer, 'Invited 1')
    expect(hasText(renderer, 'Sanganer Prints')).toBe(true)
    expect(hasText(renderer, 'Northwind Textiles')).toBe(false)
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

  it('sends nothing until how a supplier ships has changed', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="suppliers" />, list({ 'mutation SetShippingMode': () => ({ setSupplierShippingMode: true }) }))

    await click(renderer, 'Manage Northwind Textiles')
    await click(renderer, 'Change how they ship')
    await clickLast(renderer, 'Save')
    expect(asked(calls, 'mutation SetShippingMode')).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Save').at(-1)?.props.disabled).toBe(true)

    await click(renderer, 'Straight to the shopper')
    await clickLast(renderer, 'Save')
    expect(asked(calls, 'mutation SetShippingMode')[0]?.variables).toEqual({ id: 'v1', m: 'to-shopper', l: 'store' })
  })

  it('says why a reactivation is refused, by its code', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="suppliers" />, list({ 'mutation ResumeSupplier': () => { throw new ApiError('NOT_SUSPENDED', 'x') } }))

    await click(renderer, 'Manage Moradabad Brass')
    await click(renderer, 'Reactivate')
    await clickLast(renderer, 'Reactivate')

    expect(hasText(renderer, 'That supplier isn’t suspended.')).toBe(true)
  })

  it('says why a suspension is refused when the supplier is already suspended, and why a change to a suspended one is', async () => {
    const { renderer } = await show(
      <SettingsTabScreen tab="suppliers" />,
      list({ 'mutation SuspendSupplier': () => { throw new ApiError('ALREADY_SUSPENDED', 'x') }, 'mutation SetSupplierAccess': () => { throw new ApiError('SUSPENDED', 'x') } }),
    )

    await click(renderer, 'Manage Northwind Textiles')
    await click(renderer, 'Suspend')
    await clickLast(renderer, 'Suspend')
    expect(hasText(renderer, 'That supplier is already suspended.')).toBe(true)

    await click(renderer, 'Cancel')
    await click(renderer, 'Manage Moradabad Brass')
    await click(renderer, 'Change what they can do')
    await pick(renderer, 'Stock only')
    await clickLast(renderer, 'Save')
    expect(hasText(renderer, 'Reactivate this supplier first.')).toBe(true)
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
    expect(hasText(renderer, 'Their users can sign in again')).toBe(true)
    expect(asked(calls, 'mutation ResumeSupplier')).toHaveLength(0)
    await clickLast(renderer, 'Reactivate')
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

  it('says why a location is refused at the limit, and why deleting the default is', async () => {
    const { renderer } = await show(
      <SettingsTabScreen tab="warehouse" />,
      store({ 'mutation SavePlace': () => { throw new ApiError('TOO_MANY_WAREHOUSES', 'x') }, 'mutation DeletePlace': () => { throw new ApiError('DEFAULT_WAREHOUSE', 'x') } }),
    )

    await click(renderer, 'Add a location')
    await type(renderer, 'Name', 'One more')
    await click(renderer, 'Add location')
    expect(hasText(renderer, 'You can have up to 20 locations. Remove one first.')).toBe(true)

    await click(renderer, 'Cancel')
    await click(renderer, 'Manage Back room')
    await click(renderer, 'Delete')
    await clickLast(renderer, 'Delete location')
    expect(hasText(renderer, 'Make another location the default first.')).toBe(true)
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

  it('edits at the revision it was read at, and when someone else saved first keeps what was typed and saves at their revision', async () => {
    let saves = 0
    let reads = 0
    const { renderer, calls } = await show(
      <SettingsTabScreen tab="warehouse" />,
      store({
        'query Places': () => {
          reads += 1
          return { warehouses: paged(places.map((candidate) => (reads > 1 && candidate.id === 'w1' ? { ...candidate, revision: 3 } : candidate))) }
        },
        'mutation SavePlace': () => {
          saves += 1
          if (saves === 1) throw new ApiError('STALE_REVISION', 'x')
          return { saveWarehouse: 'w1' }
        },
      }),
    )

    await click(renderer, 'Manage Main godown')
    await click(renderer, 'Rename or change address')
    await type(renderer, 'Name', 'Main store')
    await click(renderer, 'Save')

    expect(asked(calls, 'mutation SavePlace')[0]?.variables).toMatchObject({ id: 'w1', r: 2, input: { name: 'Main store' } })
    expect(hasText(renderer, 'Someone else changed this location first.')).toBe(true)
    expect((input(renderer, 'Name').props as { value: string }).value).toBe('Main store')
    await click(renderer, 'Save')

    expect(asked(calls, 'mutation SavePlace')[1]?.variables).toMatchObject({ id: 'w1', r: 3, input: { name: 'Main store' } })
  })

  it('says a location is gone when someone deleted it while it was being edited, and shows the list without it', async () => {
    let reads = 0
    const { renderer } = await show(
      <SettingsTabScreen tab="warehouse" />,
      store({
        'query Places': () => {
          reads += 1
          return { warehouses: paged(reads > 1 ? places.filter((candidate) => candidate.id !== 'w1') : places) }
        },
        'mutation SavePlace': () => { throw new ApiError('STALE_REVISION', 'x') },
      }),
    )

    await click(renderer, 'Manage Main godown')
    await click(renderer, 'Rename or change address')
    await type(renderer, 'Name', 'Main store')
    await click(renderer, 'Save')

    expect(hasText(renderer, 'That location isn’t here any more.')).toBe(true)
    expect(pressablesNamed(renderer, 'Manage Main godown')).toHaveLength(0)
  })

  it('says the server could not be reached, not that the list is current, when reading it again fails, and reads it only once', async () => {
    let reads = 0
    const { renderer, calls } = await show(
      <SettingsTabScreen tab="warehouse" />,
      store({
        'query Places': () => {
          reads += 1
          if (reads > 1) throw new ApiError('NO_RESPONSE', 'x')
          return { warehouses: paged(places) }
        },
        'mutation SavePlace': () => { throw new ApiError('STALE_REVISION', 'x') },
      }),
    )

    await click(renderer, 'Manage Main godown')
    await click(renderer, 'Rename or change address')
    await type(renderer, 'Name', 'Main store')
    await click(renderer, 'Save')

    expect(hasText(renderer, 'We couldn’t reach the server.')).toBe(true)
    expect(hasText(renderer, 'The list now shows their changes')).toBe(false)
    expect((input(renderer, 'Name').props as { value: string }).value).toBe('Main store')
    expect(asked(calls, 'query Places')).toHaveLength(2)
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
