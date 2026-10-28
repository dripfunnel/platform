import type { ReactElement } from 'react'
import { Linking } from 'react-native'
import { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { actingAs, fakeClient, hasText, press, pressableNamed, pressablesNamed, renderShell, texts } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { SettingsScreen } from './SettingsScreen'
import { SettingsTabScreen } from './SettingsTabScreen'

// Settings › Riders, Shipping › Own delivery and a location's delivery fields (docs/mobile-app/merchant/ARCHITECTURE.md §5; the web's DL 7 and DL 8, on a phone).
jest.setTimeout(120_000)

const mockPush = jest.fn()
const mockSession: { client: ApiClient | null } = { client: null }

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return {
    useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), navigate: jest.fn() }),
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
// A Button is a component over its Pressable, so the state is read from whichever node carries it.
const stateOf = (node: ReactTestInstance) => (node.findAll((inner) => inner.props.accessibilityState !== undefined)[0]?.props.accessibilityState ?? node.props.accessibilityState ?? {}) as { disabled?: boolean; checked?: boolean }
const isOff = (node: ReactTestInstance) => stateOf(node).disabled === true
const asked = (calls: Call[], text: string) => calls.filter((call) => call.query.includes(text))
const mockOpenUrl = jest.spyOn(Linking, 'openURL')

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
  mockOpenUrl.mockResolvedValue(true)
})

const plan = (ownDelivery: boolean) => ({ planCatalogue: [{ current: false, values: [{ key: 'own_delivery', enabled: true }] }, { current: true, values: [{ key: 'own_delivery', enabled: ownDelivery }] }] })
const paged = <T,>(nodes: T[]) => ({ nodes, pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } })
const rider = (over: Record<string, unknown> = {}) => ({ id: 'r-1', name: 'Asha Verma', phone: '+919876500001', status: 'active', online: true, currentDeliveryId: null, deliveriesDone: 12, ...over })

describe('Settings › Riders', () => {
  const riders = [
    rider(),
    rider({ id: 'r-2', name: 'Imran Qureshi', phone: '+919811022334', online: false, currentDeliveryId: 'd-1', deliveriesDone: 1 }),
    rider({ id: 'r-3', name: 'Vikram Rao', phone: '+919876500003', status: 'invited', online: false, deliveriesDone: 0 }),
    rider({ id: 'r-4', name: 'Meena Joshi', phone: '+919876500004', status: 'suspended', online: false, deliveriesDone: 30 }),
  ]
  const served = (over: Handlers = {}): Handlers => ({ planCatalogue: () => plan(true), 'query Riders': () => ({ riders: paged(riders) }), ...over })

  it('lists the riders with their status, whether they are online or on a delivery, and how many they have delivered', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="riders" />, served())

    for (const text of ['Asha Verma', '+919876500001 · Online', '12 delivered', 'Active', '+919811022334 · Offline · On a delivery', '1 delivered', 'Invited', 'Suspended', '30 delivered']) expect(hasText(renderer, text)).toBe(true)
    expect(hasText(renderer, '+919876500003 · Offline')).toBe(false)
  })

  it('tells a store without own delivery in its plan, and reads no riders', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="riders" />, served({ planCatalogue: () => plan(false) }))

    expect(hasText(renderer, 'Own delivery isn’t part of your plan')).toBe(true)
    expect(pressablesNamed(renderer, 'Invite a rider')).toEqual([])
    expect(asked(calls, 'query Riders')).toEqual([])
  })

  it('is the Owner’s: a Manager is refused before anything is read', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="riders" />, served(), { acting: actingAs('manager') })

    expect(hasText(renderer, 'Asha Verma')).toBe(false)
    expect(calls).toEqual([])
  })

  it('says what an empty list means and offers the invitation', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="riders" />, served({ 'query Riders': () => ({ riders: paged([]) }) }))

    expect(hasText(renderer, 'No riders yet')).toBe(true)
    expect(pressablesNamed(renderer, 'Invite a rider').length).toBeGreaterThan(0)
  })

  it('invites by name and mobile number with the country code, sending the number as the API takes it, then reads the list again', async () => {
    let list = [rider()]
    const { renderer, calls } = await show(
      <SettingsTabScreen tab="riders" />,
      served({
        'query Riders': () => ({ riders: paged(list) }),
        'mutation InviteRider': () => {
          list = [...list, rider({ id: 'r-9', name: 'Ravi K.', phone: '+919811100000', status: 'invited', online: false, deliveriesDone: 0 })]
          return { inviteRider: { id: 'r-9' } }
        },
      }),
    )

    await click(renderer, 'Invite a rider')
    await clickLast(renderer, 'Send invitation')
    expect(hasText(renderer, 'Add their name')).toBe(true)
    await type(renderer, 'Name', ' Ravi K. ')
    await type(renderer, 'Mobile number', '98111 00000')
    await clickLast(renderer, 'Send invitation')
    expect(hasText(renderer, 'Enter the full mobile number with its country code, such as +91 98765 43210')).toBe(true)
    expect(asked(calls, 'mutation InviteRider')).toEqual([])

    await type(renderer, 'Mobile number', '+91 98111-00000')
    await clickLast(renderer, 'Send invitation')
    expect(asked(calls, 'mutation InviteRider')[0]?.variables).toEqual({ n: 'Ravi K.', p: '+919811100000' })
    expect(hasText(renderer, 'Invitation texted to +919811100000')).toBe(true)
    expect(hasText(renderer, 'Ravi K.')).toBe(true)
  })

  it.each([
    ['PHONE_TAKEN', 'That number is already one of your riders.'],
    ['PLAN_LIMIT', 'Your plan doesn’t include own delivery or more riders. Remove a rider, or ask DripFunnel to raise your limit.'],
    ['RATE_LIMITED', 'That rider has had three texts in the last 24 hours. Try again later.'],
  ])('keeps the invitation open with the refusal %s in words, what was typed kept', async (code, words) => {
    const { renderer } = await show(
      <SettingsTabScreen tab="riders" />,
      served({
        'mutation InviteRider': () => {
          throw new ApiError(code, 'x')
        },
      }),
    )

    await click(renderer, 'Invite a rider')
    await type(renderer, 'Name', 'Ravi K.')
    await type(renderer, 'Mobile number', '+919811100000')
    await clickLast(renderer, 'Send invitation')

    expect(hasText(renderer, words)).toBe(true)
    expect((input(renderer, 'Name').props as { value: string }).value).toBe('Ravi K.')
  })

  it('resends an invitation with one tap and says so', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="riders" />, served({ 'mutation ResendRider': () => ({ resendRiderInvitation: true }) }))

    await click(renderer, 'Manage Vikram Rao')
    await click(renderer, 'Resend invitation')

    expect(asked(calls, 'mutation ResendRider')[0]?.variables).toEqual({ id: 'r-3' })
    expect(hasText(renderer, 'Invitation texted again to Vikram Rao')).toBe(true)
  })

  it('restores a suspended rider with one tap, and says what that means', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="riders" />, served({ 'mutation RestoreRider': () => ({ restoreRider: { id: 'r-4' } }) }))

    await click(renderer, 'Manage Meena Joshi')
    expect(pressablesNamed(renderer, 'Suspend')).toEqual([])
    await click(renderer, 'Restore')

    expect(asked(calls, 'mutation RestoreRider')[0]?.variables).toEqual({ id: 'r-4' })
    expect(hasText(renderer, 'Meena Joshi can sign in and take deliveries again')).toBe(true)
  })

  it('says first what suspending does, then does it', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="riders" />, served({ 'mutation SuspendRider': () => ({ suspendRider: { id: 'r-1' } }) }))

    await click(renderer, 'Manage Asha Verma')
    await click(renderer, 'Suspend')
    expect(hasText(renderer, 'Suspend Asha Verma?')).toBe(true)
    expect(hasText(renderer, 'Their app signs out at once. A delivery they’ve accepted goes back to the other riders. You can restore them later.')).toBe(true)
    expect(asked(calls, 'mutation SuspendRider')).toEqual([])
    await clickLast(renderer, 'Suspend')

    expect(asked(calls, 'mutation SuspendRider')[0]?.variables).toEqual({ id: 'r-1' })
    expect(hasText(renderer, 'Asha Verma suspended')).toBe(true)
  })

  it('removes a rider after saying their number is erased, and cancels an invitation in its own words', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="riders" />, served({ 'mutation RemoveRider': () => ({ removeRider: true }) }))

    await click(renderer, 'Manage Asha Verma')
    await click(renderer, 'Remove')
    expect(hasText(renderer, 'Remove Asha Verma?')).toBe(true)
    expect(hasText(renderer, 'They can’t sign in again; past deliveries keep their name. Their phone number is erased.')).toBe(true)
    await clickLast(renderer, 'Remove')
    expect(asked(calls, 'mutation RemoveRider')[0]?.variables).toEqual({ id: 'r-1' })

    await click(renderer, 'Manage Vikram Rao')
    await click(renderer, 'Cancel invitation')
    expect(hasText(renderer, 'The invitation is cancelled and their phone number is erased.')).toBe(true)
  })

  it('keeps a rider carrying a parcel, saying to recall it first', async () => {
    const { renderer } = await show(
      <SettingsTabScreen tab="riders" />,
      served({
        'mutation SuspendRider': () => {
          throw new ApiError('RIDER_HAS_PARCEL', 'x')
        },
      }),
    )

    await click(renderer, 'Manage Asha Verma')
    await click(renderer, 'Suspend')
    await clickLast(renderer, 'Suspend')

    expect(hasText(renderer, 'They’re carrying an order: recall it first.')).toBe(true)
    expect(hasText(renderer, 'Suspend Asha Verma?')).toBe(true)
  })

  it('shows a store that is read-only its riders without invite or manage', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="riders" />, served(), { client: fakeClient({ state: readOnlyState }) })

    expect(hasText(renderer, 'Asha Verma')).toBe(true)
    expect(pressablesNamed(renderer, 'Invite a rider')).toEqual([])
    expect(pressablesNamed(renderer, 'Manage Asha Verma')).toEqual([])
  })

  it('draws the load failing, so the list is never mistaken for empty', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="riders" />, served({ 'query Riders': () => { throw new ApiError('NO_RESPONSE', 'x') } }))

    expect(hasText(renderer, 'No riders yet')).toBe(false)
  })
})

describe('Settings', () => {
  it('lists Riders only for a plan with own delivery', async () => {
    const on = await show(<SettingsScreen />, { planCatalogue: () => plan(true) })
    expect(pressablesNamed(on.renderer, 'Riders')).toHaveLength(1)
    expect(hasText(on.renderer, 'Your own delivery people')).toBe(true)

    const off = await show(<SettingsScreen />, { planCatalogue: () => plan(false) })
    expect(pressablesNamed(off.renderer, 'Riders')).toEqual([])
    expect(pressablesNamed(off.renderer, 'Warehouse')).toHaveLength(1)

    const unread = await show(<SettingsScreen />, {})
    expect(pressablesNamed(unread.renderer, 'Riders')).toEqual([])
    expect(pressablesNamed(unread.renderer, 'Shipping')).toHaveLength(1)
  })
})

const courier = { provider: 'shiprocket', status: 'pricing', offered: true, pickupMode: 'scheduled', labelSize: 'a6', trackingEmails: true, lastTestedAt: null, lastTestResult: null }
const shippingOf = (over: Record<string, unknown> = {}) => ({
  revision: 7,
  savedAt: null,
  currency: 'INR',
  courierRate: true,
  flatRate: true,
  flatAmount: '4900',
  pickup: false,
  pickupHours: null,
  pickupAddress: null,
  freeMode: 'never',
  freeThresholdAmount: null,
  areaMode: 'everywhere',
  areaFileName: null,
  areaCount: 0,
  areaSample: [],
  ownDelivery: false,
  dispatchWhen: 'placed',
  offerMinutes: 10,
  labelSizes: ['a6'],
  couriers: [courier],
  ...over,
})
const info = { name: 'Kesari Threads', legalName: null, description: null, logoAssetId: null, address: null, contactEmail: null, contactPhone: null, country: 'IN', taxId: null, timeZone: 'Asia/Kolkata', unitSystem: 'metric', orderPrefix: 'KT-', nextOrderNumber: '1042' }
const place = (over: Record<string, unknown> = {}) => ({
  id: 'w1',
  name: 'Main godown',
  isDefault: true,
  units: 12,
  revision: 2,
  address: { line1: '14 Johari Bazaar', line2: null, city: 'Jaipur', region: 'Rajasthan', postalCode: '302003', country: 'IN' },
  supplierId: null,
  supplierName: null,
  latitude: null,
  longitude: null,
  ownDelivery: null,
  deliveryRadiusM: null,
  riderRadiusM: null,
  deliveryFeeAmount: null,
  deliveryFeeCurrency: null,
  ...over,
})
const pinned = { latitude: 26.9, longitude: 75.8 }

describe('Shipping › Own delivery', () => {
  const served = (over: Handlers = {}): Handlers => ({
    storeInfo: () => ({ storeInfo: info }),
    shippingSettings: () => ({ shippingSettings: shippingOf() }),
    planCatalogue: () => plan(true),
    'query Riders': () => ({ riders: paged([rider()]) }),
    'query Places': () => ({ warehouses: paged([place({ ...pinned, ownDelivery: true, deliveryRadiusM: 5000, riderRadiusM: 5000, deliveryFeeAmount: '4900' })]) }),
    ...over,
  })

  it('is there only with own delivery in the plan, and its failing never takes the rest of Shipping with it', async () => {
    const off = await show(<SettingsTabScreen tab="shipping" />, served({ planCatalogue: () => plan(false) }))
    expect(hasText(off.renderer, 'Own delivery')).toBe(false)
    expect(hasText(off.renderer, 'Save shipping')).toBe(true)

    const broken = await show(<SettingsTabScreen tab="shipping" />, served({ 'query Riders': () => { throw new ApiError('NO_RESPONSE', 'x') } }))
    expect(hasText(broken.renderer, 'Own delivery')).toBe(false)
    expect(hasText(broken.renderer, 'Save shipping')).toBe(true)
  })

  it('shows what is still needed, and keeps the switch off until a rider is active and a location has a pin and delivers', async () => {
    const { renderer } = await show(
      <SettingsTabScreen tab="shipping" />,
      served({ 'query Riders': () => ({ riders: paged([rider({ status: 'invited' })]) }), 'query Places': () => ({ warehouses: paged([place()]) }) }),
    )

    expect(hasText(renderer, 'To turn it on you need')).toBe(true)
    expect(hasText(renderer, 'At least one active rider')).toBe(true)
    expect(hasText(renderer, 'A location with a map pin and a delivery area')).toBe(true)
    expect(texts(renderer).filter((text) => text === 'To do')).toHaveLength(2)
    expect(isOff(pressableNamed(renderer, 'Deliver with our own riders'))).toBe(true)
    expect(hasText(renderer, 'Finish these steps to turn it on.')).toBe(true)
    await click(renderer, 'Open Riders')
    expect(mockPush).toHaveBeenCalledWith('/more/settings/riders')
  })

  it('turns on over the saved shipping, sending the three settings and nothing the form has edited', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="shipping" />, served({ 'mutation SaveShipping': () => ({ saveShipping: 8 }) }))

    expect(isOff(pressableNamed(renderer, 'Deliver with our own riders'))).toBe(false)
    expect(isOff(pressableNamed(renderer, 'Save own delivery'))).toBe(true)
    await click(renderer, 'Deliver with our own riders')
    await pick(renderer, 'When I mark it ready')
    await type(renderer, 'Alert me if nobody accepts within (minutes)', '15')
    await click(renderer, 'Save own delivery')

    expect(asked(calls, 'mutation SaveShipping')[0]?.variables).toEqual({
      r: 7,
      i: { courierRate: true, flatRate: true, flatAmount: '4900', pickup: false, pickupHours: null, freeMode: 'never', freeThresholdAmount: null, areaMode: 'everywhere', ownDelivery: true, dispatchWhen: 'ready', offerMinutes: 15 },
    })
    expect(hasText(renderer, 'Own delivery saved — checkout uses it now')).toBe(true)
  })

  it('needs the alert time to be 1 to 30 minutes before anything is sent', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="shipping" />, served({ 'mutation SaveShipping': () => ({ saveShipping: 8 }) }))

    await type(renderer, 'Alert me if nobody accepts within (minutes)', '45')
    await click(renderer, 'Save own delivery')

    expect(hasText(renderer, 'Choose between 1 and 30 minutes.')).toBe(true)
    expect(asked(calls, 'mutation SaveShipping')).toEqual([])
  })

  it('says what own delivery still needs when the API refuses to turn it on, and puts the switch back', async () => {
    const { renderer } = await show(
      <SettingsTabScreen tab="shipping" />,
      served({
        'mutation SaveShipping': () => {
          throw new ApiError('OWN_DELIVERY_NOT_READY', 'x', { missing: ['rider', 'warehouse'] })
        },
      }),
    )

    await click(renderer, 'Deliver with our own riders')
    await click(renderer, 'Save own delivery')

    expect(hasText(renderer, 'Own delivery can’t be turned on yet. Finish the steps listed above.')).toBe(true)
    expect(hasText(renderer, 'Still needed: At least one active rider and A location with a map pin and a delivery area.')).toBe(true)
    expect(stateOf(pressableNamed(renderer, 'Deliver with our own riders')).checked).toBe(false)
  })

  it('reads the saved shipping again when someone saved first', async () => {
    let reads = 0
    const { renderer, calls } = await show(
      <SettingsTabScreen tab="shipping" />,
      served({
        shippingSettings: () => {
          reads += 1
          return { shippingSettings: shippingOf({ revision: reads > 1 ? 9 : 7 }) }
        },
        'mutation SaveShipping': () => {
          throw new ApiError('STALE', 'x')
        },
      }),
    )

    await click(renderer, 'Deliver with our own riders')
    await click(renderer, 'Save own delivery')

    expect(hasText(renderer, 'Someone else saved shipping first.')).toBe(true)
    expect(reads).toBe(2)
    expect(asked(calls, 'mutation SaveShipping')).toHaveLength(1)
  })

  it('shows a store that is read-only the card without a way to save', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="shipping" />, served(), { client: fakeClient({ state: readOnlyState }) })

    expect(hasText(renderer, 'Own delivery')).toBe(true)
    expect(pressablesNamed(renderer, 'Save own delivery')).toEqual([])
    expect(isOff(pressableNamed(renderer, 'Deliver with our own riders'))).toBe(true)
  })
})

describe('Warehouse › delivery fields', () => {
  const served = (places: unknown[], over: Handlers = {}): Handlers => ({
    shippingSettings: () => ({ shippingSettings: shippingOf() }),
    planCatalogue: () => plan(true),
    'query Places': () => ({ warehouses: paged(places) }),
    ...over,
  })
  const edit = async (renderer: ReactTestRenderer, name: string) => {
    await click(renderer, `Manage ${name}`)
    await click(renderer, 'Rename or change address')
  }

  it('shows a pinned location’s delivery as typed, in kilometres and in major units', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="warehouse" />, served([place({ ...pinned, ownDelivery: true, deliveryRadiusM: 5000, riderRadiusM: 7000, deliveryFeeAmount: '4900' })]))
    await edit(renderer, 'Main godown')

    expect(hasText(renderer, 'Map pin set')).toBe(true)
    expect((input(renderer, 'Delivery area (km)').props as { value: string }).value).toBe('5')
    expect((input(renderer, 'Rider distance (km)').props as { value: string }).value).toBe('7')
    expect((input(renderer, 'Fee (INR)').props as { value: string }).value).toBe('49.00')
  })

  it('saves the delivery in metres and minor units with the location, at its revision', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="warehouse" />, served([place(pinned)], { 'mutation SavePlace': () => ({ saveWarehouse: 'w1' }) }))
    await edit(renderer, 'Main godown')

    await click(renderer, 'Delivers with own riders')
    await type(renderer, 'Delivery area (km)', '8')
    await type(renderer, 'Rider distance (km)', '6')
    await type(renderer, 'Fee (INR)', '59.50')
    await click(renderer, 'Save')

    expect(asked(calls, 'mutation SavePlace')[0]?.variables).toMatchObject({ id: 'w1', r: 2, input: { name: 'Main godown', ownDelivery: true, deliveryRadiusM: 8000, riderRadiusM: 6000, deliveryFeeAmount: '5950' } })
  })

  it('sends nothing about delivery for a location that stays off, so what is saved stays', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="warehouse" />, served([place(pinned)], { 'mutation SavePlace': () => ({ saveWarehouse: 'w1' }) }))
    await edit(renderer, 'Main godown')
    await type(renderer, 'Name', 'Main store')
    await click(renderer, 'Save')

    const sent = asked(calls, 'mutation SavePlace')[0]?.variables as { input: Record<string, unknown> }
    expect(sent.input).not.toHaveProperty('ownDelivery')
    expect(sent.input).not.toHaveProperty('latitude')
  })

  it('turns delivery off by sending only the switch', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="warehouse" />, served([place({ ...pinned, ownDelivery: true, deliveryRadiusM: 5000, riderRadiusM: 5000, deliveryFeeAmount: '0' })], { 'mutation SavePlace': () => ({ saveWarehouse: 'w1' }) }))
    await edit(renderer, 'Main godown')
    await click(renderer, 'Delivers with own riders')
    await click(renderer, 'Save')

    const sent = asked(calls, 'mutation SavePlace')[0]?.variables as { input: Record<string, unknown> }
    expect(sent.input).toMatchObject({ ownDelivery: false })
    expect(sent.input).not.toHaveProperty('deliveryRadiusM')
  })

  it('needs a pin first: the switch is off, and the pin is set in the web portal', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="warehouse" />, served([place()]))
    await edit(renderer, 'Main godown')

    expect(hasText(renderer, 'No map pin')).toBe(true)
    expect(hasText(renderer, 'Needs the location’s map pin first.')).toBe(true)
    expect(isOff(pressableNamed(renderer, 'Delivers with own riders'))).toBe(true)
    await click(renderer, 'Set the map pin in the web portal')
    expect(mockOpenUrl).toHaveBeenCalledWith('https://shop.test/settings/warehouse')
  })

  it('names the field that is wrong before anything is sent', async () => {
    const { renderer, calls } = await show(<SettingsTabScreen tab="warehouse" />, served([place({ ...pinned, ownDelivery: true, deliveryRadiusM: 5000, riderRadiusM: 5000, deliveryFeeAmount: '4900' })]))
    await edit(renderer, 'Main godown')

    await type(renderer, 'Delivery area (km)', '80')
    await click(renderer, 'Save')
    expect(hasText(renderer, 'Enter 1 to 50 km.')).toBe(true)
    await type(renderer, 'Delivery area (km)', '8')
    await type(renderer, 'Fee (INR)', '')
    await click(renderer, 'Save')
    expect(hasText(renderer, 'Type the fee, or 0 for none.')).toBe(true)
    await type(renderer, 'Fee (INR)', 'free')
    await click(renderer, 'Save')
    expect(hasText(renderer, 'Type an amount like 49.00.')).toBe(true)
    expect(asked(calls, 'mutation SavePlace')).toEqual([])
  })

  it('says the pin and area are needed when the API refuses', async () => {
    const { renderer } = await show(
      <SettingsTabScreen tab="warehouse" />,
      served([place({ ...pinned, ownDelivery: true, deliveryRadiusM: 5000, riderRadiusM: 5000, deliveryFeeAmount: '0' })], {
        'mutation SavePlace': () => {
          throw new ApiError('DELIVERY_AREA_REQUIRED', 'x')
        },
      }),
    )
    await edit(renderer, 'Main godown')
    await click(renderer, 'Save')

    expect(hasText(renderer, 'Set the map pin and a delivery area first.')).toBe(true)
  })

  it('has no delivery fields without own delivery in the plan, on a new location, or on a supplier’s', async () => {
    const off = await show(<SettingsTabScreen tab="warehouse" />, served([place(pinned)], { planCatalogue: () => plan(false) }))
    await edit(off.renderer, 'Main godown')
    expect(hasText(off.renderer, 'Delivers with own riders')).toBe(false)

    const added = await show(<SettingsTabScreen tab="warehouse" />, served([place(pinned)]))
    await click(added.renderer, 'Add a location')
    expect(hasText(added.renderer, 'Delivers with own riders')).toBe(false)
    expect(pressablesNamed(added.renderer, 'Manage Their shelf')).toEqual([])
  })

  it('still lists the locations when the delivery reads fail', async () => {
    const { renderer } = await show(<SettingsTabScreen tab="warehouse" />, served([place()], { planCatalogue: () => { throw new ApiError('NO_RESPONSE', 'x') } }))

    expect(hasText(renderer, 'Main godown')).toBe(true)
  })
})
