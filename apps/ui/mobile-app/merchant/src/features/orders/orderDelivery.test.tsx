import { Linking } from 'react-native'
import { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { fakeClient, hasText, press, pressableNamed, pressablesNamed, renderShell } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { OrderScreen } from './OrderScreen'

// An own-delivery order's Delivery panel (docs/mobile-app/merchant/ARCHITECTURE.md §5; the web's DL 9, on a phone).
jest.setTimeout(120_000)

const mockSession: { client: ApiClient | null } = { client: null }

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), back: jest.fn() }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))

const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

type Json = Record<string, unknown>
type Handlers = Record<string, (variables: Json, headers: Record<string, string>) => unknown>

const money = (amount: string) => ({ amount, currency: 'INR' })
const shirt = { id: 'l1', name: 'Mara Linen Shirt', versionName: null, quantity: 1, unitPrice: money('249900'), amount: money('249900'), total: money('249900'), fulfilledQuantity: 0, returnedQuantity: 0, sentToStoreQuantity: 0 }

const baseOrder = (over: Json = {}): Json => ({
  id: 'o-1',
  number: 'KT-1042',
  state: 'placed',
  placedAt: '2026-10-20T08:00:00Z',
  customerName: 'Ananya Rao',
  shippingAddress: { name: 'Ananya Rao', line1: '14 3rd Cross', line2: null, city: 'Jaipur', region: 'Rajasthan', postalCode: '302003', country: 'IN' },
  parts: [{ id: 'part-own', supplierId: null, supplierName: null, shippingMode: 'store', state: 'to_ship', lines: [shirt] }],
  history: [],
  shipments: [],
  returns: [],
  refunds: [],
  paymentState: 'paid',
  fulfilmentState: 'unfulfilled',
  paymentMethod: 'razorpay',
  test: false,
  customerId: 'c-1',
  email: 'ananya.rao@example.in',
  phone: '+91 98450 12345',
  marketName: 'India',
  taxInclusive: true,
  subtotal: money('249900'),
  discount: null,
  shipping: money('0'),
  tax: money('0'),
  duties: null,
  total: money('249900'),
  refunded: null,
  shippingOption: 'own_delivery',
  shopperNote: null,
  delivery: null,
  ...over,
})

const rider = { name: 'Imran Qureshi', phone: '+91 98110 22334', vehicleType: 'Bike', vehicleNumber: 'RJ14 AB 2210' }
const step = (state: string, at: string, deliveryId = 'd1') => ({ deliveryId, state, at })
const searching = [step('packing', '2026-10-20T08:10:00Z'), step('searching', '2026-10-20T08:20:00Z')]
const accepted = [...searching, step('assigned', '2026-10-20T08:40:00Z')]
const out = [...accepted, step('picked_up', '2026-10-20T09:00:00Z')]

const deliveryOf = (state: string, steps: unknown[], over: Json = {}) => ({
  id: 'd1',
  state,
  failedReason: null,
  failedNote: null,
  cashCollectedAt: null,
  codeLocked: false,
  codeUnconfirmedAt: null,
  rider: null,
  steps,
  ...over,
})

const staff = ['orders.read', 'orders.write', 'orders.fulfil']
const manager = [...staff, 'orders.refund', 'orders.mark_paid']
const owner = [...manager, 'shipping.configure', 'riders.manage']
const readerOnly = ['orders.read']
const readOnlyState = { readOnly: true, status: null, trialEndsAt: null, pastDueSince: null, provisioning: null, support: null }

const ridersPage = {
  riders: {
    nodes: [
      { id: 'r-1', name: 'Asha Verma', phone: '+91 98765 00001', status: 'active', online: false, currentDeliveryId: null, deliveriesDone: 3 },
      { id: 'r-2', name: 'Imran Qureshi', phone: '+91 98110 22334', status: 'active', online: true, currentDeliveryId: null, deliveriesDone: 12 },
      { id: 'r-3', name: 'Vikram Rao', phone: '+91 98765 00003', status: 'invited', online: false, currentDeliveryId: null, deliveriesDone: 0 },
    ],
    pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null },
  },
}

const show = async (order: Json, permissions: string[], more: Handlers = {}, options: Parameters<typeof renderShell>[1] = {}) => {
  const current = { order }
  const { client, calls } = fakeApi({
    storeInfo: () => ({ storeInfo: { timeZone: 'Asia/Kolkata' } }),
    'acting { permissions': () => ({ me: { acting: { permissions, seller: null } } }),
    'order(id': () => ({ order: current.order }),
    ...more,
  })
  mockSession.client = client
  const renderer = await renderShell(<OrderScreen id="o-1" />, options)
  await settle()
  return { renderer, calls, current }
}

const textIn = (node: ReactTestInstance): string => node.children.map((child) => (typeof child === 'string' ? child : textIn(child))).join('')
const click = async (renderer: ReactTestRenderer, label: string) => {
  await press(pressableNamed(renderer, label))
  await settle()
}
const clickLast = async (renderer: ReactTestRenderer, label: string) => {
  await press(pressablesNamed(renderer, label).at(-1) as ReactTestInstance)
  await settle()
}
const pick = async (renderer: ReactTestRenderer, label: string) => {
  const row = renderer.root.findAll((node) => node.props.accessibilityRole === 'radio' && typeof node.props.onPress === 'function' && textIn(node).startsWith(label))[0]
  if (!row) throw new Error(`no choice named "${label}"`)
  await press(row)
  await settle()
}
const type = async (renderer: ReactTestRenderer, label: string, value: string) => {
  const found = renderer.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function')[0]
  if (!found) throw new Error(`no field named "${label}"`)
  await act(async () => found.props.onChangeText(value))
}
const asked = (calls: Call[], text: string) => calls.filter((call) => call.query.includes(text))

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
})

describe('the Delivery panel, by state', () => {
  const cases: { state: string; order: Json; says: string[]; actions: string[]; notThere?: string[] }[] = [
    { state: 'packing', order: baseOrder({ delivery: deliveryOf('packing', [step('packing', '2026-10-20T08:10:00Z')]) }), says: ['Being packed', 'Riders are offered it when you mark it ready for pickup.'], actions: ['Ready for pickup', 'Cancel delivery'] },
    { state: 'searching', order: baseOrder({ delivery: deliveryOf('searching', searching) }), says: ['Looking for a rider', 'Offered to riders'], actions: ['Cancel delivery'] },
    { state: 'unassigned', order: baseOrder({ delivery: deliveryOf('unassigned', [...searching, step('unassigned', '2026-10-20T08:30:00Z')]) }), says: ['Nobody accepted'], actions: ['Assign by hand', 'Offer again', 'Cancel delivery'] },
    { state: 'assigned', order: baseOrder({ delivery: deliveryOf('assigned', accepted, { rider }) }), says: ['Rider assigned', 'Imran Qureshi accepted', 'Bike · RJ14 AB 2210', 'Accepted by Imran Qureshi'], actions: ['Cancel delivery', 'Call Imran Qureshi'] },
    { state: 'picked up', order: baseOrder({ delivery: deliveryOf('picked_up', out, { rider }) }), says: ['On the way', 'Imran Qureshi picked it up', 'The order can’t be cancelled while the parcel is out. Recall it first.'], actions: ['Recall', 'Call Imran Qureshi'], notThere: ['Cancel delivery'] },
    { state: 'code locked', order: baseOrder({ delivery: deliveryOf('picked_up', out, { rider, codeLocked: true }) }), says: ['Code locked after 5 wrong tries'], actions: ['Mark delivered', 'Not delivered', 'Call Imran Qureshi'] },
    { state: 'code unconfirmed', order: baseOrder({ delivery: deliveryOf('picked_up', out, { rider, codeLocked: true, codeUnconfirmedAt: '2026-10-20T09:40:00Z' }) }), says: ['The code didn’t match'], actions: ['Mark delivered', 'Not delivered'] },
    { state: 'delivered', order: baseOrder({ delivery: deliveryOf('delivered', [...out, step('delivered', '2026-10-20T09:50:00Z')], { rider }) }), says: ['Delivered', 'Imran Qureshi delivered it.'], actions: [], notThere: ['Call Imran Qureshi'] },
    { state: 'failed', order: baseOrder({ delivery: deliveryOf('failed', [...out, step('failed', '2026-10-20T09:50:00Z')], { rider, failedReason: 'no_one_home' }) }), says: ['Not delivered: no one home'], actions: ['Offer again'], notThere: ['Call Imran Qureshi'] },
    { state: 'recalled', order: baseOrder({ delivery: deliveryOf('failed', [...out, step('failed', '2026-10-20T09:50:00Z')], { rider, failedReason: 'recalled' }) }), says: ['Recalled', 'Recalled by you'], actions: ['Offer again'] },
    { state: 'cancelled', order: baseOrder({ delivery: deliveryOf('cancelled', [...searching, step('cancelled', '2026-10-20T08:35:00Z')]) }), says: ['Delivery cancelled'], actions: ['Offer again'] },
  ]

  it.each(cases)('shows $state with its words and the actions the Owner has', async ({ order, says, actions, notThere = [] }) => {
    const { renderer } = await show(order, owner)
    expect(hasText(renderer, 'Delivery')).toBe(true)
    expect(hasText(renderer, 'Order placed')).toBe(true)
    for (const text of says) expect(hasText(renderer, text)).toBe(true)
    for (const action of actions) expect(pressablesNamed(renderer, action).length).toBeGreaterThan(0)
    for (const action of ['Ready for pickup', 'Assign by hand', 'Offer again', 'Cancel delivery', 'Recall', 'Mark delivered', 'Not delivered'].filter((a) => !actions.includes(a))) expect(pressablesNamed(renderer, action)).toEqual([])
    for (const action of notThere) expect(pressablesNamed(renderer, action)).toEqual([])
  })

  it('says a paid-later own-delivery order is waiting for payment, and draws nothing for any other order', async () => {
    const waiting = await show(baseOrder({ paymentState: 'pending', paymentMethod: 'bank_transfer' }), owner)
    expect(hasText(waiting.renderer, 'Waiting for payment')).toBe(true)
    const courier = await show(baseOrder({ shippingOption: 'flat' }), owner)
    expect(hasText(courier.renderer, 'Own delivery')).toBe(false)
  })

  it('opens the phone’s dialler on the rider’s number, never the handover code', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
    const { renderer } = await show(baseOrder({ delivery: deliveryOf('picked_up', out, { rider, codeLocked: true }) }), owner)
    await click(renderer, 'Call Imran Qureshi')
    expect(open).toHaveBeenCalledWith('tel:+919811022334')
    expect(hasText(renderer, 'The handover code is only shown to the customer.')).toBe(true)
  })

  it('says what the rider claimed for cash on delivery', async () => {
    const order = baseOrder({ paymentMethod: 'cod', paymentState: 'pending', delivery: deliveryOf('picked_up', out, { rider, cashCollectedAt: '2026-10-20T09:35:00Z', codeLocked: true }) })
    const { renderer } = await show(order, owner)
    expect(hasText(renderer, 'The rider says')).toBe(true)
    expect(hasText(renderer, 'Cash collected: ₹2,499.00, sent from the app at Oct 20, 2026, 15:05 GMT+5:30')).toBe(true)
    const none = await show(baseOrder({ paymentMethod: 'cod', paymentState: 'pending', delivery: deliveryOf('picked_up', out, { rider, codeLocked: true }) }), owner)
    expect(hasText(none.renderer, 'No cash claim was sent from the app.')).toBe(true)
  })
})

describe('who can act on a delivery', () => {
  const unassigned = baseOrder({ delivery: deliveryOf('unassigned', [...searching, step('unassigned', '2026-10-20T08:30:00Z')]) })

  it('lets a Manager offer it again or cancel it, but leaves picking the rider to the Owner', async () => {
    const { renderer } = await show(unassigned, manager)
    expect(pressablesNamed(renderer, 'Offer again').length).toBe(1)
    expect(pressablesNamed(renderer, 'Cancel delivery').length).toBe(1)
    expect(pressablesNamed(renderer, 'Assign by hand')).toEqual([])
    expect(hasText(renderer, 'Only the owner can pick the rider; ask them, or offer it again to everyone nearby.')).toBe(true)
  })

  it('lets Staff with orders.fulfil act the same way', async () => {
    const { renderer } = await show(unassigned, staff)
    expect(pressablesNamed(renderer, 'Offer again').length).toBe(1)
    expect(pressablesNamed(renderer, 'Assign by hand')).toEqual([])
  })

  it('lets a seat that only reads follow the delivery, with no action and one line saying why', async () => {
    const { renderer } = await show(unassigned, readerOnly)
    for (const action of ['Offer again', 'Cancel delivery', 'Assign by hand']) expect(pressablesNamed(renderer, action)).toEqual([])
    expect(hasText(renderer, 'You can follow this delivery, but changing it needs permission to fulfil orders.')).toBe(true)
    expect(hasText(renderer, 'Nobody accepted')).toBe(true)
  })

  it('shows a store that is read-only the delivery without its actions', async () => {
    const { renderer } = await show(unassigned, owner, {}, { client: fakeClient({ state: readOnlyState }) })
    for (const action of ['Offer again', 'Cancel delivery', 'Assign by hand']) expect(pressablesNamed(renderer, action)).toEqual([])
  })
})

describe('the delivery’s actions', () => {
  it('says what Ready for pickup does, then writes it, and reads the order again', async () => {
    const { renderer, calls, current } = await show(baseOrder({ delivery: deliveryOf('packing', [step('packing', '2026-10-20T08:10:00Z')]) }), manager, {
      markReadyForPickup: () => {
        current.order = baseOrder({ delivery: deliveryOf('searching', searching) })
        return { markReadyForPickup: true }
      },
    })
    await click(renderer, 'Ready for pickup')
    expect(hasText(renderer, 'Every online rider within range gets an offer, and the alert timer starts.')).toBe(true)
    expect(asked(calls, 'markReadyForPickup')).toEqual([])
    await clickLast(renderer, 'Ready for pickup')

    expect(asked(calls, 'markReadyForPickup')[0]?.variables).toEqual({ o: 'o-1' })
    expect(hasText(renderer, 'Ready for pickup. Offered to nearby riders.')).toBe(true)
    expect(hasText(renderer, 'Looking for a rider')).toBe(true)
    expect(pressablesNamed(renderer, 'Ready for pickup')).toEqual([])
  })

  it('offers it again as a new attempt after a failure, naming the delivery', async () => {
    const failed = baseOrder({ delivery: deliveryOf('failed', [...out, step('failed', '2026-10-20T09:50:00Z')], { rider, failedReason: 'wrong_address' }) })
    const { renderer, calls } = await show(failed, manager, { offerDeliveryAgain: () => ({ offerDeliveryAgain: true }) })
    await click(renderer, 'Offer again')
    expect(hasText(renderer, 'This is a new attempt; the earlier one stays in the steps.')).toBe(true)
    await clickLast(renderer, 'Offer again')
    expect(asked(calls, 'offerDeliveryAgain')[0]?.variables).toEqual({ d: 'd1' })
  })

  it('cancels a delivery before pickup, telling the rider who accepted', async () => {
    const assigned = baseOrder({ delivery: deliveryOf('assigned', accepted, { rider }) })
    const { renderer, calls } = await show(assigned, manager, { cancelDelivery: () => ({ cancelDelivery: true }) })
    await click(renderer, 'Cancel delivery')
    expect(hasText(renderer, 'Imran Qureshi is told not to pick it up.')).toBe(true)
    expect(hasText(renderer, 'Keep it')).toBe(true)
    await clickLast(renderer, 'Cancel delivery')
    expect(asked(calls, 'cancelDelivery')[0]?.variables).toEqual({ d: 'd1' })
    expect(hasText(renderer, 'Delivery cancelled. The order is still open.')).toBe(true)
  })

  it('recalls a parcel that is out, never cancels it', async () => {
    const { renderer, calls } = await show(baseOrder({ delivery: deliveryOf('picked_up', out, { rider }) }), manager, { cancelDelivery: () => ({ cancelDelivery: true }) })
    await click(renderer, 'Recall')
    expect(hasText(renderer, 'Imran Qureshi is told to bring the parcel back.')).toBe(true)
    await clickLast(renderer, 'Recall')
    expect(asked(calls, 'cancelDelivery')).toHaveLength(1)
    expect(hasText(renderer, 'Imran Qureshi has been told to bring it back.')).toBe(true)
  })

  it('marks a locked delivery not delivered, which tells the rider to bring it back', async () => {
    const locked = baseOrder({ delivery: deliveryOf('picked_up', out, { rider, codeLocked: true }) })
    const { renderer, calls } = await show(locked, manager, { cancelDelivery: () => ({ cancelDelivery: true }) })
    await click(renderer, 'Not delivered')
    await clickLast(renderer, 'Mark not delivered')
    expect(asked(calls, 'cancelDelivery')).toHaveLength(1)
    expect(hasText(renderer, 'Marked not delivered. Imran Qureshi has been told to bring it back.')).toBe(true)
  })

  it('assigns by hand for the Owner, active riders only and online first, and says who got it', async () => {
    const unassigned = baseOrder({ delivery: deliveryOf('unassigned', [...searching, step('unassigned', '2026-10-20T08:30:00Z')]) })
    const { renderer, calls } = await show(unassigned, owner, { riders: () => ridersPage, assignDelivery: () => ({ assignDelivery: true }) })
    await click(renderer, 'Assign by hand')
    expect(hasText(renderer, 'They get a notification and the delivery straight away.')).toBe(true)
    expect(hasText(renderer, 'Imran Qureshi · Online')).toBe(true)
    expect(hasText(renderer, 'Asha Verma · Offline, gets a notification')).toBe(true)
    expect(hasText(renderer, 'Vikram Rao')).toBe(false)
    await pick(renderer, 'Asha Verma')
    await clickLast(renderer, 'Assign')

    expect(asked(calls, 'assignDelivery')[0]?.variables).toEqual({ d: 'd1', r: 'r-1' })
    expect(hasText(renderer, 'Assigned to Asha Verma.')).toBe(true)
  })

  it('says there is nobody to assign when no rider is active, and when the riders cannot be read', async () => {
    const unassigned = baseOrder({ delivery: deliveryOf('unassigned', [...searching, step('unassigned', '2026-10-20T08:30:00Z')]) })
    const none = await show(unassigned, owner, { riders: () => ({ riders: { nodes: [], pageInfo: ridersPage.riders.pageInfo } }) })
    await click(none.renderer, 'Assign by hand')
    expect(hasText(none.renderer, 'No active riders. Invite one in Settings › Riders.')).toBe(true)

    const broken = await show(unassigned, owner, {
      riders: () => {
        throw new ApiError('NO_RESPONSE', 'x')
      },
    })
    await click(broken.renderer, 'Assign by hand')
    expect(hasText(broken.renderer, 'The riders couldn’t be read. Try again.')).toBe(true)
  })

  it('keeps the sheet open with the refusal in words by its code', async () => {
    const packing = baseOrder({ delivery: deliveryOf('packing', [step('packing', '2026-10-20T08:10:00Z')]) })
    const { renderer } = await show(packing, manager, {
      markReadyForPickup: () => {
        throw new ApiError('NOT_PACKING', 'x')
      },
    })
    await click(renderer, 'Ready for pickup')
    await clickLast(renderer, 'Ready for pickup')
    expect(hasText(renderer, 'This order isn’t waiting to be packed any more.')).toBe(true)
    expect(hasText(renderer, 'Ready for pickup?')).toBe(true)
  })

  it.each([
    ['NOT_ENOUGH_STOCK', 'The location hasn’t enough stock for this order.'],
    ['NOT_HANDED_OVER', 'A supplier hasn’t handed all the items to the store yet.'],
    ['FORBIDDEN', 'You can’t change this delivery.'],
  ])('words the refusal %s', async (code, words) => {
    const packing = baseOrder({ delivery: deliveryOf('packing', [step('packing', '2026-10-20T08:10:00Z')]) })
    const { renderer } = await show(packing, manager, {
      markReadyForPickup: () => {
        throw new ApiError(code, 'x')
      },
    })
    await click(renderer, 'Ready for pickup')
    await clickLast(renderer, 'Ready for pickup')
    expect(hasText(renderer, words)).toBe(true)
  })
})

describe('Mark delivered', () => {
  const locked = (over: Json = {}) => baseOrder({ delivery: deliveryOf('picked_up', out, { rider, codeLocked: true }), ...over })

  it('needs the reason, and sends it with the delivery', async () => {
    const { renderer, calls } = await show(locked(), manager, { markDeliveryDelivered: () => ({ markDeliveryDelivered: true }) })
    await click(renderer, 'Mark delivered')
    await clickLast(renderer, 'Mark delivered')
    expect(hasText(renderer, 'Say how you know the customer has it.')).toBe(true)
    expect(asked(calls, 'markDeliveryDelivered')).toEqual([])

    await type(renderer, 'Reason', ' Called the customer; they have the parcel ')
    await clickLast(renderer, 'Mark delivered')
    expect(asked(calls, 'markDeliveryDelivered')[0]?.variables).toEqual({ d: 'd1', r: 'Called the customer; they have the parcel', c: null })
    expect(hasText(renderer, 'KT-1042 marked delivered.')).toBe(true)
  })

  it('asks a Manager whether the cash reached the store, for cash on delivery, and sends yes', async () => {
    const { renderer, calls } = await show(locked({ paymentMethod: 'cod', paymentState: 'pending' }), manager, { markDeliveryDelivered: () => ({ markDeliveryDelivered: true }) })
    await click(renderer, 'Mark delivered')
    expect(hasText(renderer, 'Did the cash reach you?')).toBe(true)
    await type(renderer, 'Reason', 'Customer confirmed by phone')
    await clickLast(renderer, 'Mark delivered')
    expect(asked(calls, 'markDeliveryDelivered')[0]?.variables).toEqual({ d: 'd1', r: 'Customer confirmed by phone', c: true })
  })

  it('lets Staff say the cash has not reached the store, but not that it has, which needs orders.mark_paid', async () => {
    const { renderer, calls } = await show(locked({ paymentMethod: 'cod', paymentState: 'pending' }), staff, { markDeliveryDelivered: () => ({ markDeliveryDelivered: true }) })
    await click(renderer, 'Mark delivered')
    await type(renderer, 'Reason', 'Customer confirmed by phone')
    await pick(renderer, 'Yes, the cash reached us')
    await clickLast(renderer, 'Mark delivered')
    expect(hasText(renderer, 'Only an owner or manager can say the cash reached the store.')).toBe(true)
    expect(asked(calls, 'markDeliveryDelivered')).toEqual([])

    await pick(renderer, 'No, not yet')
    await clickLast(renderer, 'Mark delivered')
    expect(asked(calls, 'markDeliveryDelivered')[0]?.variables).toMatchObject({ c: false })
  })

  it('words the refusal when the code can still be used', async () => {
    const { renderer } = await show(locked(), manager, {
      markDeliveryDelivered: () => {
        throw new ApiError('CODE_NOT_LOCKED', 'x')
      },
    })
    await click(renderer, 'Mark delivered')
    await type(renderer, 'Reason', 'Called them')
    await clickLast(renderer, 'Mark delivered')
    expect(hasText(renderer, 'The rider can still confirm this delivery with the customer’s code.')).toBe(true)
  })
})
