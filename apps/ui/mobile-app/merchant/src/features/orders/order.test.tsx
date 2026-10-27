import { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { actingAs, fakeClient, hasText, press, pressableNamed, pressablesNamed, renderShell } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { OrderScreen } from './OrderScreen'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockPush = jest.fn()
const mockSession: { client: ApiClient | null } = { client: null }

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, navigate: jest.fn(), back: jest.fn() }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))

// The fake network answers over several promise turns; jest-expo runs timers faked, so wait on promises, not on a timer.
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

type Json = Record<string, unknown>
type Handlers = Record<string, (variables: Json, headers: Record<string, string>) => unknown>

const money = (amount: string, currency = 'INR') => ({ amount, currency })
const line = (id: string, name: string, quantity: number, each: string, over: Json = {}) => ({
  id,
  name,
  versionName: null,
  quantity,
  unitPrice: money(each),
  amount: money(String(Number(each) * quantity)),
  total: money(String(Number(each) * quantity)),
  fulfilledQuantity: 0,
  returnedQuantity: 0,
  sentToStoreQuantity: 0,
  ...over,
})
const ownPart = (lines: unknown[], state = 'to_ship') => ({ id: 'part-own', supplierId: null, supplierName: null, shippingMode: 'store', state, lines })
const supplierPart = (lines: unknown[], mode = 'to-store', state = 'to_ship') => ({ id: 'part-nw', supplierId: 's-1', supplierName: 'Northwind Textiles', shippingMode: mode, state, lines })
const shirt = (over: Json = {}) => line('l1', 'Mara Linen Shirt', 1, '249900', { versionName: 'M / Indigo', ...over })
const cushion = (over: Json = {}) => line('l2', 'Block-print Cushion Cover', 2, '89900', over)
const dupatta = (over: Json = {}) => line('l3', 'Handloom Cotton Dupatta', 1, '149900', over)

const baseOrder = (over: Json = {}): Json => ({
  id: 'o-1',
  number: 'KT-1042',
  state: 'placed',
  placedAt: '2026-10-10T09:30:00Z',
  customerName: 'Ananya Rao',
  shippingAddress: { name: 'Ananya Rao', line1: '14 3rd Cross', line2: null, city: 'Bengaluru', region: 'Karnataka', postalCode: '560038', country: 'IN' },
  parts: [ownPart([shirt(), cushion()])],
  history: [{ id: 'e1', action: 'order.placed', at: '2026-10-10T09:30:00Z', actorName: null, note: null }],
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
  subtotal: money('429700'),
  discount: null,
  shipping: money('0'),
  tax: money('46000'),
  duties: null,
  total: money('429700'),
  refunded: null,
  shippingOption: 'flat',
  shopperNote: null,
  delivery: null,
  ...over,
})

// Everything the order holds has gone, so it can be returned.
const shippedOrder = (over: Json = {}) =>
  baseOrder({
    fulfilmentState: 'fulfilled',
    parts: [ownPart([shirt({ fulfilledQuantity: 1 }), cushion({ fulfilledQuantity: 2 })], 'shipped')],
    shipments: [{ id: 'f1', kind: 'manual', supplierId: null, warehouseName: 'Main location', courierName: 'Delhivery', trackingNumber: '1490 2210', trackingUrl: null, shippedAt: '2026-10-10T11:00:00Z', pickupRequestedAt: null, lines: [{ lineId: 'l1', quantity: 1 }, { lineId: 'l2', quantity: 2 }] }],
    ...over,
  })

const returnJson = (over: Json = {}) => ({ id: 'r1', number: 'R1042-1', state: 'requested', reason: 'damaged', startedAt: '2026-10-10T12:00:00Z', lines: [{ lineId: 'l2', quantity: 1 }], ...over })

const access = (permissions: string[], seller: { id: string } | null = null) => ({ me: { acting: { permissions, seller } } })
const staff = ['orders.read', 'orders.write', 'orders.fulfil', 'exports', 'customers.read', 'stock.read']
const manager = [...staff, 'orders.refund', 'orders.mark_paid']
const owner = [...manager, 'shipping.configure']
const readOnlyState = { readOnly: true, status: null, trialEndsAt: null, pastDueSince: null, provisioning: null, support: null }

const places = {
  warehouses: {
    nodes: [
      { id: 'w-main', name: 'Main location', isDefault: true, units: 10, revision: 1, supplierId: null, supplierName: null, address: null },
      { id: 'w-nw', name: 'Northwind yard', isDefault: false, units: 4, revision: 1, supplierId: 's-1', supplierName: 'Northwind Textiles', address: null },
    ],
    pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null },
  },
}
const couriers = { shippingSettings: { couriers: [{ provider: 'shiprocket', status: 'pricing' }, { provider: 'ups', status: 'off' }] } }

const show = async (handlers: Handlers, options: Parameters<typeof renderShell>[1] = {}) => {
  const { client, calls } = fakeApi({ storeInfo: () => ({ storeInfo: { timeZone: 'Asia/Kolkata' } }), ...handlers })
  mockSession.client = client
  const renderer = await renderShell(<OrderScreen id="o-1" />, options)
  await settle()
  return { renderer, calls }
}

// The order as the API answers it, changed by a handler when a write goes through.
const serving = (order: { current: Json }, permissions: string[], more: Handlers = {}): Handlers => ({
  'acting { permissions': () => access(permissions),
  'order(id': () => ({ order: order.current }),
  ...more,
})

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
const asked = (calls: Call[], text: string) => calls.filter((call) => call.query.includes(text))

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
})

describe('an order', () => {
  it('shows its lines by who packs them, payment as the API worked it out, the shopper, and the history in the store’s zone', async () => {
    const { renderer } = await show(
      serving({ current: baseOrder({ parts: [ownPart([shirt(), cushion()]), supplierPart([dupatta()])], total: money('579600'), subtotal: money('579600'), discount: money('10000'), history: [{ id: 'e2', action: 'order.paid', at: '2026-10-10T09:31:00Z', actorName: null, note: null }, { id: 'e1', action: 'order.placed', at: '2026-10-10T09:30:00Z', actorName: null, note: null }] }) }, owner),
    )

    for (const text of ['KT-1042', 'To ship', 'Paid', 'You pack these', 'Northwind Textiles packs these', '3 to ship', 'Mara Linen Shirt · M / Indigo', 'Not shipped yet', '₹2,499.00', '₹1,798.00', '₹1,499.00', 'Items', '₹5,796.00', '−₹100.00', 'Paid with', 'Razorpay', 'Ananya Rao', 'ananya.rao@example.in', '14 3rd Cross, Bengaluru, Karnataka 560038, IN', 'Market: India', 'Order placed', 'Paid']) expect(hasText(renderer, text)).toBe(true)
    expect(hasText(renderer, 'Placed Oct 10, 2026, 15:00 GMT+5:30')).toBe(true)
    expect(hasText(renderer, 'Oct 10, 2026, 15:01 GMT+5:30')).toBe(true)
    await press(pressableNamed(renderer, 'Open Ananya Rao in Customers'))
    expect(mockPush).toHaveBeenCalledWith('/more/customers/c-1')
  })

  it('does not open the customer for a seat that cannot read customers', async () => {
    const { renderer } = await show(serving({ current: baseOrder() }, ['orders.read']))
    expect(hasText(renderer, 'Ananya Rao')).toBe(true)
    expect(pressablesNamed(renderer, 'Open Ananya Rao in Customers')).toEqual([])
  })

  it('draws a skeleton while the order is on its way', async () => {
    let release: (value: unknown) => void = () => undefined
    const { renderer } = await show({ 'acting { permissions': () => access(owner), 'order(id': () => new Promise((resolve) => (release = resolve)) })
    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === 'Loading').length).toBeGreaterThan(0)
    await act(async () => release({ order: baseOrder() }))
    await settle()
    expect(hasText(renderer, 'KT-1042')).toBe(true)
  })

  it('says it is not here for an order that does not exist or is not the caller’s', async () => {
    const { renderer } = await show({ 'acting { permissions': () => access(owner), 'order(id': () => ({ order: null }) })
    expect(hasText(renderer, 'This page isn’t here any more')).toBe(true)
  })

  it('says it could not load, quotes no reference of its own, and tries again', async () => {
    let failing = true
    const { renderer } = await show({
      'acting { permissions': () => access(owner),
      'order(id': () => {
        if (failing) throw new ApiError('NO_RESPONSE', 'down')
        return { order: baseOrder() }
      },
    })
    expect(hasText(renderer, 'We couldn’t load this order')).toBe(true)
    expect(hasText(renderer, 'Ref ')).toBe(false)
    failing = false
    await click(renderer, 'Try again')
    expect(hasText(renderer, 'KT-1042')).toBe(true)
  })

  it('says the seat has no access without orders.read, or when the API refuses', async () => {
    const lacking = await show({ 'acting { permissions': () => access(['catalog.read']), 'order(id': () => ({ order: baseOrder() }) })
    expect(hasText(lacking.renderer, 'You don’t have access to this order')).toBe(true)
    const refused = await show({
      'acting { permissions': () => access(owner),
      'order(id': () => {
        throw new ApiError('FORBIDDEN', 'no')
      },
    })
    expect(hasText(refused.renderer, 'You don’t have access to this order')).toBe(true)
  })
})

describe('who is offered what', () => {
  const waiting = () => baseOrder({ paymentState: 'pending', paymentMethod: 'cod' })

  it('offers Owner and Manager Mark as paid on an order waiting for its money, and Staff nothing of the sort', async () => {
    for (const permissions of [owner, manager]) {
      const { renderer } = await show(serving({ current: waiting() }, permissions))
      expect(pressablesNamed(renderer, 'Mark as paid').length).toBe(1)
    }
    const { renderer } = await show(serving({ current: waiting() }, staff), { acting: actingAs('staff') })
    expect(hasText(renderer, 'KT-1042')).toBe(true)
    expect(hasText(renderer, 'Mark as paid')).toBe(false)
    expect(hasText(renderer, 'Ship items')).toBe(true)
    expect(hasText(renderer, 'Cancel order')).toBe(true)
  })

  it('offers Staff no return and no refund (absent, not disabled), and Owner and Manager both', async () => {
    const shipped = () => shippedOrder({ returns: [returnJson()] })
    const forStaff = await show(serving({ current: shipped() }, staff), { acting: actingAs('staff') })
    for (const text of ['Start a return', 'Refund', 'Mark as received', 'Cancel return']) expect(hasText(forStaff.renderer, text)).toBe(false)
    const forManager = await show(serving({ current: shipped() }, manager), { acting: actingAs('manager') })
    for (const text of ['Start a return', 'Refund', 'Mark as received', 'Cancel return']) expect(pressablesNamed(forManager.renderer, text).length).toBe(1)
  })

  it('offers Ship items only while something is left to ship, and Cancel only before anything has gone', async () => {
    const shipped = await show(serving({ current: shippedOrder() }, owner))
    expect(hasText(shipped.renderer, 'Ship items')).toBe(false)
    expect(hasText(shipped.renderer, 'Cancel order')).toBe(false)
    const open = await show(serving({ current: baseOrder() }, owner))
    expect(pressablesNamed(open.renderer, 'Ship items').length).toBe(1)
    expect(pressablesNamed(open.renderer, 'Cancel order').length).toBe(1)
  })

  it('offers no write while the store is read-only, and says so', async () => {
    const { renderer } = await show(serving({ current: baseOrder() }, owner), { client: fakeClient({ state: readOnlyState }) })
    expect(hasText(renderer, 'Your store is read-only until the bill is paid.')).toBe(true)
    for (const text of ['Ship items', 'Cancel order', 'Refund', 'Mark as paid']) expect(hasText(renderer, text)).toBe(false)
  })

  it('never ships a test order or an unpaid card order', async () => {
    const test = await show(serving({ current: baseOrder({ test: true }) }, owner))
    expect(hasText(test.renderer, 'Ship items')).toBe(false)
    expect(hasText(test.renderer, 'Test order from a preview · never ships')).toBe(true)
    const card = await show(serving({ current: baseOrder({ paymentState: 'pending', paymentMethod: 'razorpay' }) }, owner))
    expect(hasText(card.renderer, 'Ship items')).toBe(false)
    expect(hasText(card.renderer, 'Mark as paid')).toBe(false)
  })
})

describe('Mark as paid', () => {
  it('says first what it means, then writes, and reads the order again', async () => {
    const order = { current: baseOrder({ paymentState: 'pending', paymentMethod: 'cod' }) }
    const { renderer, calls } = await show(
      serving(order, owner, {
        markOrderPaid: () => {
          order.current = baseOrder({ paymentState: 'paid', paymentMethod: 'cod' })
          return { markOrderPaid: true }
        },
      }),
    )

    await click(renderer, 'Mark as paid')
    expect(hasText(renderer, 'Mark KT-1042 as paid?')).toBe(true)
    expect(hasText(renderer, 'Only once the ₹4,297.00 has actually reached you (Cash on delivery).')).toBe(true)
    expect(asked(calls, 'markOrderPaid')).toEqual([])
    await clickLast(renderer, 'Mark as paid')

    expect(asked(calls, 'markOrderPaid')[0]?.variables).toEqual({ o: 'o-1' })
    expect(hasText(renderer, 'KT-1042 marked as paid')).toBe(true)
    expect(hasText(renderer, 'Mark KT-1042 as paid?')).toBe(false)
    expect(pressablesNamed(renderer, 'Mark as paid')).toEqual([])
  })

  it('keeps the sheet open with the API’s refusal, by its code', async () => {
    const { renderer } = await show(
      serving({ current: baseOrder({ paymentState: 'pending', paymentMethod: 'cod' }) }, owner, {
        markOrderPaid: () => {
          throw new ApiError('NOT_PENDING', 'x')
        },
      }),
    )
    await click(renderer, 'Mark as paid')
    await clickLast(renderer, 'Mark as paid')
    expect(hasText(renderer, 'This order isn’t waiting for payment any more.')).toBe(true)
    expect(hasText(renderer, 'Mark KT-1042 as paid?')).toBe(true)
  })

  it('shows the API’s refusal when a seat without the permission gets this far', async () => {
    const { renderer } = await show(
      serving({ current: baseOrder({ paymentState: 'pending', paymentMethod: 'cod' }) }, manager, {
        markOrderPaid: () => {
          throw new ApiError('FORBIDDEN', 'x')
        },
      }),
    )
    await click(renderer, 'Mark as paid')
    await clickLast(renderer, 'Mark as paid')
    expect(hasText(renderer, 'You can’t do that with orders. Ask the store’s owner or a manager.')).toBe(true)
  })
})

describe('Cancel order', () => {
  it('says first what the shopper gets back, asks why, and cancels with that reason', async () => {
    const { renderer, calls } = await show(serving({ current: baseOrder() }, owner, { cancelOrder: () => ({ cancelOrder: true }) }))

    await click(renderer, 'Cancel order')
    expect(hasText(renderer, 'Cancel KT-1042?')).toBe(true)
    expect(hasText(renderer, 'Ananya Rao gets back what they paid, through Razorpay. The items go back in stock.')).toBe(true)
    expect(hasText(renderer, 'Keep order')).toBe(true)
    await pick(renderer, 'Shopper asked')
    await clickLast(renderer, 'Cancel order')

    expect(asked(calls, 'cancelOrder')[0]?.variables).toEqual({ o: 'o-1', r: 'shopper' })
    expect(hasText(renderer, 'KT-1042 cancelled')).toBe(true)
  })

  it('says nothing is refunded for an order nothing was paid on', async () => {
    const { renderer } = await show(serving({ current: baseOrder({ paymentState: 'pending', paymentMethod: 'cod' }) }, staff))
    await click(renderer, 'Cancel order')
    expect(hasText(renderer, 'Nothing has been paid, so nothing is refunded. The items go back in stock.')).toBe(true)
  })

  it('keeps the sheet with the refusal when something has already been sent', async () => {
    const { renderer } = await show(
      serving({ current: baseOrder() }, owner, {
        cancelOrder: () => {
          throw new ApiError('NOT_CANCELLABLE', 'x')
        },
      }),
    )
    await click(renderer, 'Cancel order')
    await clickLast(renderer, 'Cancel order')
    expect(hasText(renderer, 'Something has already been sent, so this order can’t be cancelled. Start a return instead.')).toBe(true)
  })
})

describe('Ship items', () => {
  it('books a label through the connected courier for the picked items, from the chosen location', async () => {
    const order = { current: baseOrder() }
    const { renderer, calls } = await show(
      serving(order, owner, {
        shippingSettings: () => couriers,
        'warehouses(first': () => places,
        bookLabel: () => ({ bookLabel: 'f-9' }),
      }),
    )

    await click(renderer, 'Ship items')
    expect(hasText(renderer, 'Ship 3 items')).toBe(true)
    expect(hasText(renderer, 'Book a Shiprocket label')).toBe(true)
    expect(hasText(renderer, 'Book a UPS label')).toBe(false)
    expect(hasText(renderer, 'Booking buys the label now, and the shopper is told it’s on its way.')).toBe(true)
    await press(pressableNamed(renderer, 'Fewer of Block-print Cushion Cover'))
    expect(hasText(renderer, 'Ship 2 items')).toBe(true)
    await clickLast(renderer, 'Book and ship')

    expect(asked(calls, 'bookLabel')[0]?.variables).toEqual({ o: 'o-1', w: 'w-main', l: [{ lineId: 'l1', quantity: 1 }, { lineId: 'l2', quantity: 1 }], c: 'shiprocket' })
    expect(asked(calls, 'shipItems')).toEqual([])
    expect(hasText(renderer, '2 items shipped — Shiprocket label booked')).toBe(true)
  })

  it('ships with the tracking typed by hand, and only the store’s own locations are offered', async () => {
    const { renderer, calls } = await show(serving({ current: baseOrder() }, owner, { shippingSettings: () => couriers, 'warehouses(first': () => places, shipItems: () => ({ shipItems: ['f-1'] }) }))

    await click(renderer, 'Ship items')
    await pick(renderer, 'I’ll enter the tracking myself')
    expect(hasText(renderer, 'Shipping part of an order is normal')).toBe(true)
    await type(renderer, 'Courier', 'Delhivery')
    await type(renderer, 'Tracking number (optional)', '1490 2210 8834')
    await type(renderer, 'Tracking link (optional)', 'https://www.delhivery.com/track/149022108834')
    await clickLast(renderer, 'Mark as shipped')

    expect(asked(calls, 'shipItems')[0]?.variables).toEqual({
      o: 'o-1',
      w: 'w-main',
      l: [{ lineId: 'l1', quantity: 1 }, { lineId: 'l2', quantity: 2 }],
      c: 'Delhivery',
      t: '1490 2210 8834',
      u: 'https://www.delhivery.com/track/149022108834',
    })
    expect(asked(calls, 'bookLabel')).toEqual([])
    expect(hasText(renderer, '3 items shipped — Ananya gets an email')).toBe(true)
  })

  it('offers no label to a seat that cannot read the couriers, and never asks for them', async () => {
    const { renderer, calls } = await show(serving({ current: baseOrder() }, manager, { 'warehouses(first': () => places, shipItems: () => ({ shipItems: ['f-1'] }) }), { acting: actingAs('manager') })

    await click(renderer, 'Ship items')
    expect(hasText(renderer, 'Book a Shiprocket label')).toBe(false)
    expect(hasText(renderer, 'Tracking number (optional)')).toBe(true)
    expect(asked(calls, 'shippingSettings')).toEqual([])
    await clickLast(renderer, 'Mark as shipped')
    expect(asked(calls, 'shipItems')[0]?.variables).toMatchObject({ c: null, t: null, u: null })
  })

  it('hands a pickup order over with no courier or tracking', async () => {
    const { renderer, calls } = await show(serving({ current: baseOrder({ shippingOption: 'pickup' }) }, owner, { shippingSettings: () => couriers, 'warehouses(first': () => places, shipItems: () => ({ shipItems: ['f-1'] }) }))

    await click(renderer, 'Ship items')
    expect(hasText(renderer, 'The shopper collects this order.')).toBe(true)
    expect(hasText(renderer, 'Book a Shiprocket label')).toBe(false)
    expect(hasText(renderer, 'Tracking number (optional)')).toBe(false)
    await clickLast(renderer, 'Mark as handed over')
    expect(asked(calls, 'shipItems')[0]?.variables).toMatchObject({ c: null, t: null, u: null })
    expect(hasText(renderer, '3 items handed over')).toBe(true)
  })

  it('asks for a link that starts with https:// and a number to go with it, before sending anything', async () => {
    const { renderer, calls } = await show(serving({ current: baseOrder() }, manager, { 'warehouses(first': () => places }), { acting: actingAs('manager') })

    await click(renderer, 'Ship items')
    await type(renderer, 'Tracking link (optional)', 'http://courier.example/track')
    await clickLast(renderer, 'Mark as shipped')
    expect(hasText(renderer, 'A tracking link starts with https://')).toBe(true)
    await type(renderer, 'Tracking link (optional)', 'https://courier.example/track')
    await clickLast(renderer, 'Mark as shipped')
    expect(hasText(renderer, 'Add the tracking number this link is for.')).toBe(true)
    expect(asked(calls, 'shipItems')).toEqual([])
  })

  it('needs at least one item picked', async () => {
    const { renderer, calls } = await show(serving({ current: baseOrder({ parts: [ownPart([shirt()])] }) }, manager, { 'warehouses(first': () => places }), { acting: actingAs('manager') })
    await click(renderer, 'Ship items')
    await press(pressableNamed(renderer, 'Fewer of Mara Linen Shirt · M / Indigo'))
    await clickLast(renderer, 'Mark as shipped')
    expect(hasText(renderer, 'Pick at least one item to ship.')).toBe(true)
    expect(asked(calls, 'shipItems')).toEqual([])
  })

  it('keeps the sheet and what was typed when the API refuses, saying why by its code', async () => {
    const { renderer } = await show(
      serving({ current: baseOrder() }, manager, {
        'warehouses(first': () => places,
        shipItems: () => {
          throw new ApiError('NOT_ENOUGH_STOCK', 'x')
        },
      }),
      { acting: actingAs('manager') },
    )
    await click(renderer, 'Ship items')
    await type(renderer, 'Tracking number (optional)', 'ZX-1')
    await clickLast(renderer, 'Mark as shipped')

    expect(hasText(renderer, 'That location hasn’t that many. Change the stock or pick another location.')).toBe(true)
    expect(input(renderer, 'Tracking number (optional)').props.value).toBe('ZX-1')
  })

  it('says a label could not be booked by the courier’s refusal, and bought nothing', async () => {
    const { renderer } = await show(
      serving({ current: baseOrder() }, owner, {
        shippingSettings: () => couriers,
        'warehouses(first': () => places,
        bookLabel: () => {
          throw new ApiError('COURIER_UNAVAILABLE', 'x')
        },
      }),
    )
    await click(renderer, 'Ship items')
    await clickLast(renderer, 'Book and ship')
    expect(hasText(renderer, 'The courier didn’t answer. Nothing was bought; try again in a moment.')).toBe(true)
  })

  it('says there is no location to ship from, and cannot be confirmed', async () => {
    const { renderer, calls } = await show(serving({ current: baseOrder() }, manager, { 'warehouses(first': () => ({ warehouses: { ...places.warehouses, nodes: [] } }) }), { acting: actingAs('manager') })
    await click(renderer, 'Ship items')
    expect(hasText(renderer, 'Add a location under Settings › Warehouse before you ship.')).toBe(true)
    await clickLast(renderer, 'Mark as shipped')
    expect(asked(calls, 'shipItems')).toEqual([])
  })
})

describe('shipments', () => {
  const sent = (over: Json = {}) => ({ id: 'f1', kind: 'manual', supplierId: null, warehouseName: 'Main location', courierName: null, trackingNumber: null, trackingUrl: null, shippedAt: '2026-10-10T11:00:00Z', pickupRequestedAt: null, lines: [{ lineId: 'l1', quantity: 1 }], ...over })

  it('adds tracking to a shipment sent without it, then reads the order again', async () => {
    const order = { current: baseOrder({ shipments: [sent()] }) }
    const { renderer, calls } = await show(
      serving(order, staff, {
        addTracking: () => {
          order.current = baseOrder({ shipments: [sent({ courierName: 'Delhivery', trackingNumber: '1490' })] })
          return { addTracking: true }
        },
      }),
      { acting: actingAs('staff') },
    )

    expect(hasText(renderer, 'No tracking yet')).toBe(true)
    await click(renderer, 'Add tracking')
    await clickLast(renderer, 'Save tracking')
    expect(hasText(renderer, 'Type the tracking number.')).toBe(true)
    await type(renderer, 'Tracking number', '1490')
    await type(renderer, 'Courier', 'Delhivery')
    await clickLast(renderer, 'Save tracking')

    expect(asked(calls, 'addTracking')[0]?.variables).toEqual({ s: 'f1', c: 'Delhivery', t: '1490', u: null })
    expect(hasText(renderer, 'Tracking saved — the shopper gets it by email')).toBe(true)
    expect(hasText(renderer, 'Delhivery · 1490')).toBe(true)
    expect(hasText(renderer, 'No tracking yet')).toBe(false)
  })

  it('asks the courier to collect a label booked here, once', async () => {
    const order = { current: baseOrder({ shipments: [sent({ kind: 'booked', courierName: 'Shiprocket', trackingNumber: 'SR1' })] }) }
    const { renderer, calls } = await show(
      serving(order, owner, {
        requestPickup: () => {
          order.current = baseOrder({ shipments: [sent({ kind: 'booked', courierName: 'Shiprocket', trackingNumber: 'SR1', pickupRequestedAt: '2026-10-10T12:00:00Z' })] })
          return { requestPickup: true }
        },
      }),
    )

    expect(hasText(renderer, 'Label booked Oct 10, 2026, 16:30 GMT+5:30 from Main location')).toBe(true)
    await click(renderer, 'Ask the courier to collect it')
    expect(asked(calls, 'requestPickup')[0]?.variables).toEqual({ s: 'f1' })
    expect(hasText(renderer, 'Pickup requested — the courier collects it')).toBe(true)
    expect(hasText(renderer, 'Pickup asked for')).toBe(true)
    expect(pressablesNamed(renderer, 'Ask the courier to collect it')).toEqual([])
  })

  it('shows the refusal of a pickup on the screen, by its code', async () => {
    const { renderer } = await show(
      serving({ current: baseOrder({ shipments: [sent({ kind: 'booked', trackingNumber: 'SR1' })] }) }, owner, {
        requestPickup: () => {
          throw new ApiError('PICKUP_ASKED', 'x')
        },
      }),
    )
    await click(renderer, 'Ask the courier to collect it')
    expect(hasText(renderer, 'A pickup has already been asked for.')).toBe(true)
  })

  it('offers no tracking to a supplier’s hand-off or a pickup, and none to a seat that cannot fulfil', async () => {
    const handOff = await show(serving({ current: baseOrder({ shipments: [sent({ kind: 'sent_to_store', supplierId: 's-1' }), sent({ id: 'f2', kind: 'pickup' })] }) }, staff), { acting: actingAs('staff') })
    expect(hasText(handOff.renderer, 'Add tracking')).toBe(false)
    const readOnly = await show(serving({ current: baseOrder({ shipments: [sent()] }) }, ['orders.read']))
    expect(hasText(readOnly.renderer, 'Add tracking')).toBe(false)
  })
})

describe('returns', () => {
  it('starts a return of shipped units for a reason, saying first where they go', async () => {
    const { renderer, calls } = await show(serving({ current: shippedOrder() }, owner, { startReturn: () => ({ startReturn: 'r-1' }) }))

    await click(renderer, 'Start a return')
    expect(hasText(renderer, 'The items come back to their owner’s location.')).toBe(true)
    await clickLast(renderer, 'Start return')
    expect(hasText(renderer, 'Pick at least one item coming back.')).toBe(true)
    await press(pressableNamed(renderer, 'More of Block-print Cushion Cover'))
    await press(pressableNamed(renderer, 'More of Block-print Cushion Cover'))
    await clickLast(renderer, 'Start return')

    expect(asked(calls, 'startReturn')[0]?.variables).toEqual({ o: 'o-1', l: [{ lineId: 'l2', quantity: 2 }], r: 'doesnt_fit' })
    expect(hasText(renderer, 'Return started — mark it received when the items are back')).toBe(true)
  })

  it('names the suppliers who refund their own items once the units are back', async () => {
    const order = shippedOrder({ parts: [ownPart([shirt({ fulfilledQuantity: 1 })], 'shipped'), supplierPart([dupatta({ fulfilledQuantity: 1, sentToStoreQuantity: 1 })], 'to-store', 'shipped')] })
    const { renderer } = await show(serving({ current: order }, owner, { startReturn: () => ({ startReturn: 'r-1' }) }))
    await click(renderer, 'Start a return')
    expect(hasText(renderer, 'Suppliers refund their own items once you mark them received.')).toBe(true)
    await press(pressableNamed(renderer, 'More of Handloom Cotton Dupatta'))
    await clickLast(renderer, 'Start return')
    expect(hasText(renderer, 'Return started — Northwind Textiles will refund their items once they’re back')).toBe(true)
  })

  it('moves a return from on its way back to received, and cancels one with the consequence said first', async () => {
    const order = { current: shippedOrder({ returns: [returnJson()] }) }
    const { renderer, calls } = await show(
      serving(order, owner, {
        receiveReturn: () => {
          order.current = shippedOrder({ returns: [returnJson({ state: 'received' })] })
          return { receiveReturn: true }
        },
        cancelReturn: () => ({ cancelReturn: true }),
      }),
    )

    expect(hasText(renderer, 'On its way back')).toBe(true)
    expect(hasText(renderer, 'Damaged in transit · started Oct 10, 2026, 17:30 GMT+5:30')).toBe(true)
    await click(renderer, 'Cancel return')
    expect(hasText(renderer, 'Cancel return R1042-1?')).toBe(true)
    expect(hasText(renderer, 'Use this when the shopper keeps the items. Nothing is refunded, and the items can be returned again later.')).toBe(true)
    await clickLast(renderer, 'Cancel return')
    expect(asked(calls, 'cancelReturn')[0]?.variables).toEqual({ r: 'r1' })
    expect(hasText(renderer, 'Return R1042-1 cancelled')).toBe(true)

    await click(renderer, 'Mark as received')
    expect(asked(calls, 'receiveReturn')[0]?.variables).toEqual({ r: 'r1' })
    expect(hasText(renderer, 'Received — now refund the items')).toBe(true)
    expect(hasText(renderer, 'Received · refund due')).toBe(true)
    expect(pressablesNamed(renderer, 'Refund these items').length).toBe(1)
  })

  it('shows a refusal to mark received on the screen, by its code', async () => {
    const { renderer } = await show(
      serving({ current: shippedOrder({ returns: [returnJson()] }) }, owner, {
        receiveReturn: () => {
          throw new ApiError('NOT_REQUESTED', 'x')
        },
      }),
    )
    await click(renderer, 'Mark as received')
    expect(hasText(renderer, 'This return isn’t on its way back any more.')).toBe(true)
  })

  it('offers a refund of a received return’s items, with its units picked and put back in stock', async () => {
    const { renderer, calls } = await show(serving({ current: shippedOrder({ returns: [returnJson({ state: 'received' })] }) }, owner, { refund: () => ({ refund: ['f-1'] }) }))

    await click(renderer, 'Refund these items')
    expect(hasText(renderer, 'Money goes back through Razorpay.')).toBe(true)
    expect(hasText(renderer, '₹899.00 each')).toBe(true)
    expect(hasText(renderer, 'Refund the picked items')).toBe(true)
    await clickLast(renderer, 'Refund the picked items')

    expect(asked(calls, 'refund(')[0]?.variables).toEqual({ o: 'o-1', ret: 'r1', l: [{ lineId: 'l2', quantity: 1 }], x: null, r: 'returned', s: true, v: false })
    expect(hasText(renderer, 'Refunded to Ananya Rao')).toBe(true)
  })
})

describe('Refund', () => {
  it('turns an amount typed in major units into the currency’s minor units, for the store’s own goodwill', async () => {
    const { renderer, calls } = await show(serving({ current: baseOrder() }, owner, { refund: () => ({ refund: ['f-1'] }) }))

    await click(renderer, 'Refund')
    expect(hasText(renderer, 'Money goes back through Razorpay. Pick items, or type an amount for a goodwill refund.')).toBe(true)
    await type(renderer, 'Amount', '250.50')
    expect(hasText(renderer, 'Refund ₹250.50')).toBe(true)
    await clickLast(renderer, 'Refund ₹250.50')

    expect(asked(calls, 'refund(')[0]?.variables).toEqual({ o: 'o-1', ret: null, l: [], x: '25050', r: 'goodwill', s: false, v: false })
    expect(hasText(renderer, 'Refunded to Ananya Rao')).toBe(true)
  })

  it('uses the currency’s own digits: yen has no minor unit, and a comma keyboard types a decimal point', async () => {
    const yen = await show(serving({ current: baseOrder({ total: money('500000', 'JPY') }) }, owner, { refund: () => ({ refund: ['f-1'] }) }))
    await click(yen.renderer, 'Refund')
    await type(yen.renderer, 'Amount', '1200')
    await clickLast(yen.renderer, 'Refund ¥1,200')
    expect(asked(yen.calls, 'refund(')[0]?.variables.x).toBe('1200')

    const comma = await show(serving({ current: baseOrder() }, owner, { refund: () => ({ refund: ['f-1'] }) }))
    await click(comma.renderer, 'Refund')
    await type(comma.renderer, 'Amount', '49,50')
    await clickLast(comma.renderer, 'Refund ₹49.50')
    expect(asked(comma.calls, 'refund(')[0]?.variables.x).toBe('4950')
  })

  it('refuses what is not an amount, and an amount of nothing, before sending', async () => {
    const { renderer, calls } = await show(serving({ current: baseOrder() }, owner))
    await click(renderer, 'Refund')

    await type(renderer, 'Amount', '2,500')
    await clickLast(renderer, 'Refund the picked items')
    expect(hasText(renderer, 'Type an amount, like 250 or 250.50.')).toBe(true)
    await type(renderer, 'Amount', '0')
    await clickLast(renderer, 'Refund the picked items')
    expect(hasText(renderer, 'Pick items, or type an amount.')).toBe(true)
    expect(asked(calls, 'refund(')).toEqual([])
  })

  it('refunds picked units with a restock choice, and the amount field gives way to them', async () => {
    const { renderer, calls } = await show(serving({ current: shippedOrder() }, owner, { refund: () => ({ refund: ['f-1'] }) }))

    await click(renderer, 'Refund')
    expect(input(renderer, 'Amount').props.editable).toBe(true)
    await press(pressableNamed(renderer, 'More of Mara Linen Shirt · M / Indigo'))
    expect(input(renderer, 'Amount').props.editable).toBe(false)
    await press(pressableNamed(renderer, 'Put the picked items back in stock'))
    await clickLast(renderer, 'Refund the picked items')

    expect(asked(calls, 'refund(')[0]?.variables).toEqual({ o: 'o-1', ret: null, l: [{ lineId: 'l1', quantity: 1 }], x: null, r: 'goodwill', s: true, v: false })
  })

  it('groups lines by who refunds them and, for a supplier’s, says the override is recorded against them before it does it', async () => {
    const order = shippedOrder({ parts: [ownPart([shirt({ fulfilledQuantity: 1 })], 'shipped'), supplierPart([dupatta({ fulfilledQuantity: 1, sentToStoreQuantity: 1 })], 'to-store', 'shipped')] })
    const { renderer, calls } = await show(serving({ current: order }, owner, { refund: () => ({ refund: ['f-1', 'f-2'] }) }))

    await click(renderer, 'Refund')
    for (const text of ['Your items', 'You refund these', 'Northwind Textiles’s items', 'Northwind Textiles refunds these']) expect(hasText(renderer, text)).toBe(true)
    expect(hasText(renderer, 'recorded against')).toBe(false)
    await press(pressableNamed(renderer, 'More of Handloom Cotton Dupatta'))
    expect(hasText(renderer, 'Northwind Textiles normally refunds their own items. Refunding here overrides them: it’s recorded against Northwind Textiles, for you to settle with them.')).toBe(true)
    await clickLast(renderer, 'Refund the picked items')

    expect(asked(calls, 'refund(')[0]?.variables).toMatchObject({ l: [{ lineId: 'l3', quantity: 1 }], v: true })
    expect(hasText(renderer, 'Refunded to Ananya Rao — recorded against Northwind Textiles to settle with them')).toBe(true)
  })

  it('keeps the sheet and what was typed when the API refuses, saying why by its code', async () => {
    const { renderer } = await show(
      serving({ current: baseOrder() }, owner, {
        refund: () => {
          throw new ApiError('PROVIDER_REFUSED', 'x')
        },
      }),
    )
    await click(renderer, 'Refund')
    await type(renderer, 'Amount', '100')
    await clickLast(renderer, 'Refund ₹100.00')

    expect(hasText(renderer, 'The payment provider refused the refund. Nothing was refunded.')).toBe(true)
    expect(input(renderer, 'Amount').props.value).toBe('100')
  })

  it('says you give the money back yourself for cash on delivery', async () => {
    const { renderer } = await show(serving({ current: baseOrder({ paymentMethod: 'cod' }) }, owner))
    await click(renderer, 'Refund')
    expect(hasText(renderer, 'You give the money back yourself (Cash on delivery); this records that you did.')).toBe(true)
  })

  it('offers no refund before the order is paid', async () => {
    const { renderer } = await show(serving({ current: baseOrder({ paymentState: 'pending', paymentMethod: 'cod' }) }, owner))
    expect(pressablesNamed(renderer, 'Refund')).toEqual([])
  })
})
