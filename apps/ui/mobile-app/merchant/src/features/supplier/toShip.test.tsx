import { fakeClient, hasText, pressableNamed, press, texts } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { SupplierOrderScreen } from './SupplierOrderScreen'
import { ToShipScreen } from './ToShipScreen'
import { access, ApiError, asked, click, clickLast, mockSession, page, show, supplierSeat, tiers, type, type Handlers } from './testKit'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockPush = jest.fn()
const readOnlyState = { readOnly: true, status: null, trialEndsAt: null, pastDueSince: null, provisioning: null, support: null }

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react')
  return { useRouter: () => ({ push: mockPush, navigate: jest.fn(), back: jest.fn() }), useFocusEffect: (effect: () => void) => useEffect(effect, [effect]) }
})
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))

type Json = Record<string, unknown>

const row = (id: string, number: string, over: Json = {}) => ({
  id,
  number,
  placedAt: '2026-10-10T09:30:00Z',
  state: 'placed',
  paymentState: null,
  fulfilmentState: null,
  paymentMethod: null,
  total: null,
  test: null,
  customerName: null,
  city: null,
  items: 2,
  partState: 'to_ship',
  shippingMode: 'to-store',
  ...over,
})
const counts = (over: Record<string, number> = {}) => ({ all: 0, toShip: 0, partlyShipped: 0, shipped: 0, cancelledRefunded: 0, paymentPending: 0, ...over })
const list = (nodes: unknown[]) => ({ orders: page(nodes) })

const listHandlers = (nodes: unknown[], c = counts({ all: nodes.length, toShip: nodes.length }), permissions = tiers.ordersFulfil): Handlers => ({
  'acting { permissions': () => access(permissions),
  orderCounts: () => ({ orderCounts: c }),
  'orders(filter': () => list(nodes),
})

const showList = (handlers: Handlers, tier: Parameters<typeof supplierSeat>[0] = 'ordersFulfil') => show(<ToShipScreen />, handlers, { acting: supplierSeat(tier) })

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
})

describe('To ship', () => {
  it('lists the API’s parts by shipping mode, with no total, and who a to-shopper part is for only because the API sent it', async () => {
    const { renderer } = await showList(
      listHandlers([
        row('o-1', 'KT-1042'),
        row('o-2', 'KT-1041', { shippingMode: 'to-shopper', customerName: 'Ananya Rao', city: 'Bengaluru', partState: 'partly_shipped', items: 1, total: { amount: '489700', currency: 'INR' } }),
      ]),
    )

    expect(texts(renderer)).toEqual(
      expect.arrayContaining(['KT-1042', 'For Juniper & Co.', 'Send to the store', '2 items', 'To ship', 'KT-1041', 'Ananya Rao', 'Bengaluru', '1 item', 'Partly shipped']),
    )
    expect(hasText(renderer, '₹')).toBe(false)
    expect(hasText(renderer, 'Oct 10, 2026, 09:30 UTC')).toBe(true)
  })

  it('opens an order on its own screen under the tab', async () => {
    const { renderer } = await showList(listHandlers([row('o-1', 'KT-1042')]))
    await press(pressableNamed(renderer, 'Open order KT-1042'))
    expect(mockPush).toHaveBeenCalledWith('/to-ship/o-1')
  })

  it('has only the chips a supplier has, with the API’s counts, and asks the API again for the one chosen', async () => {
    const { renderer, calls } = await showList(listHandlers([row('o-1', 'KT-1042')], counts({ all: 7, toShip: 3, partlyShipped: 1, shipped: 3 })))

    expect(texts(renderer)).toEqual(expect.arrayContaining(['✓ All', '7', 'To ship', '3', 'Partly shipped', '1', 'Shipped']))
    expect(hasText(renderer, 'Payment pending')).toBe(false)
    expect(hasText(renderer, 'Cancelled & refunded')).toBe(false)
    expect(hasText(renderer, '3 to ship')).toBe(true)
    await click(renderer, 'Partly shipped1')
    expect(asked(calls, 'orders(filter').at(-1)?.variables.filter).toBe('PARTLY_SHIPPED')
  })

  it('says nothing is to ship yet when the API holds no part for this supplier', async () => {
    const { renderer } = await showList(listHandlers([], counts()))
    expect(hasText(renderer, 'Nothing to ship yet')).toBe(true)
    expect(hasText(renderer, 'Search by order number')).toBe(false)
  })

  it('asks for nothing from a seat that cannot read orders', async () => {
    for (const tier of ['stock', 'catalogue'] as const) {
      const { renderer, calls } = await showList(listHandlers([row('o-1', 'KT-1042')], counts({ all: 1 }), tiers[tier]), tier)
      expect(hasText(renderer, 'You don’t have access to To ship')).toBe(true)
      expect(asked(calls, 'orders(filter')).toEqual([])
      expect(asked(calls, 'orderCounts')).toEqual([])
    }
  })

  it('says it could not load, and tries again', async () => {
    let failing = true
    const { renderer } = await showList({
      ...listHandlers([row('o-1', 'KT-1042')]),
      'orders(filter': () => {
        if (failing) throw new ApiError('NO_RESPONSE', 'down')
        return list([row('o-1', 'KT-1042')])
      },
    })
    expect(hasText(renderer, 'We couldn’t load To ship')).toBe(true)
    failing = false
    await click(renderer, 'Try again')
    expect(hasText(renderer, 'KT-1042')).toBe(true)
  })
})

const line = (id: string, name: string, quantity: number, over: Json = {}) => ({ id, name, versionName: null, quantity, fulfilledQuantity: 0, sentToStoreQuantity: 0, ...over })
const part = (mode: string, lines: unknown[], state = 'to_ship') => ({ id: 'part-1', shippingMode: mode, state, lines })
const order = (over: Json = {}): Json => ({
  id: 'o-1',
  number: 'KT-1042',
  state: 'placed',
  placedAt: '2026-10-10T09:30:00Z',
  customerName: null,
  shippingAddress: null,
  parts: [part('to-store', [line('l1', 'Mara Linen Shirt', 1, { versionName: 'M / Indigo' }), line('l2', 'Block-print Cushion Cover', 2)])],
  shipments: [],
  ...over,
})
const toShopper = (over: Json = {}) =>
  order({
    customerName: 'Ananya Rao',
    shippingAddress: { name: 'Ananya Rao', line1: '14 3rd Cross', line2: null, city: 'Bengaluru', region: 'Karnataka', postalCode: '560038', country: 'IN' },
    parts: [part('to-shopper', [line('l1', 'Mara Linen Shirt', 1, { versionName: 'M / Indigo' }), line('l2', 'Block-print Cushion Cover', 2)])],
    ...over,
  })

const places = { warehouses: page([{ id: 'w-nw', name: 'Northwind yard', isDefault: true }, { id: 'w-2', name: 'Northwind annex', isDefault: false }]) }

const showOrder = (current: { value: Json | null }, handlers: Handlers = {}, tier: Parameters<typeof supplierSeat>[0] = 'ordersFulfil', options: Record<string, unknown> = {}) =>
  show(<SupplierOrderScreen id="o-1" />, { 'acting { permissions': () => access(tiers[tier]), 'order(id': () => ({ order: current.value }), ...handlers }, { acting: supplierSeat(tier), ...options })

describe('A supplier’s order', () => {
  it('shows only its own items and, for a to-store part, nothing of the shopper — only where to send them', async () => {
    const { renderer, calls } = await showOrder({ value: order() })

    expect(texts(renderer)).toEqual(expect.arrayContaining(['KT-1042', 'To ship', 'Your items', '3 to ship', 'Mara Linen Shirt · M / Indigo', 'Block-print Cushion Cover', 'Send your items to', 'Juniper & Co.']))
    expect(hasText(renderer, 'Deliver to')).toBe(false)
    expect(hasText(renderer, '₹')).toBe(false)
    expect(hasText(renderer, 'You see only your items in this order. The store delivers to the shopper')).toBe(true)
    const query = asked(calls, 'order(id')[0]?.query ?? ''
    for (const field of ['total', 'subtotal', 'email', 'phone', 'paymentState', 'unitPrice', 'amount', 'customerId']) expect(query).not.toContain(field)
  })

  it('shows a to-shopper part the name and delivery address the API sent, and says the supplier ships it', async () => {
    const { renderer } = await showOrder({ value: toShopper() })

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Deliver to', 'Ananya Rao', '14 3rd Cross, Bengaluru, Karnataka 560038, IN']))
    expect(hasText(renderer, 'Send your items to')).toBe(false)
    expect(hasText(renderer, 'You send them to the shopper yourself.')).toBe(true)
  })

  it('sends a to-store part to the store from the supplier’s own location, and reads the order again', async () => {
    const current = { value: order() }
    const { renderer, calls } = await showOrder(current, {
      'warehouses(first': () => places,
      shipItems: () => {
        current.value = order({ parts: [part('to-store', [line('l1', 'Mara Linen Shirt', 1, { versionName: 'M / Indigo', sentToStoreQuantity: 1 }), line('l2', 'Block-print Cushion Cover', 2, { sentToStoreQuantity: 2 })], 'sent_to_store')] })
        return { shipItems: ['f-1'] }
      },
    })

    await click(renderer, 'Send items to the store')
    expect(hasText(renderer, 'Send 3 items to the store')).toBe(true)
    expect(hasText(renderer, 'Send these to Juniper & Co.; it delivers them to the shopper.')).toBe(true)
    await clickLast(renderer, 'Mark as sent')

    expect(asked(calls, 'shipItems')[0]?.variables).toEqual({ o: 'o-1', w: 'w-nw', l: [{ lineId: 'l1', quantity: 1 }, { lineId: 'l2', quantity: 2 }], c: null, t: null, u: null })
    expect(hasText(renderer, '3 items marked as sent to Juniper & Co.')).toBe(true)
    expect(hasText(renderer, 'Send items to the store')).toBe(false)
    expect(hasText(renderer, 'All shipped')).toBe(true)
    expect(hasText(renderer, 'Sent to the store')).toBe(false)
  })

  it('ships a to-shopper part with its own courier and tracking, only as many as picked', async () => {
    const { renderer, calls } = await showOrder({ value: toShopper() }, { 'warehouses(first': () => places, shipItems: () => ({ shipItems: ['f-1'] }) })

    await click(renderer, 'Ship items')
    expect(hasText(renderer, 'Ship 3 items')).toBe(true)
    expect(hasText(renderer, 'Book a')).toBe(false)
    await press(pressableNamed(renderer, 'Fewer of Block-print Cushion Cover'))
    await type(renderer, 'Courier', 'Delhivery')
    await type(renderer, 'Tracking number (optional)', '1490 2210')
    await clickLast(renderer, 'Mark as shipped')

    expect(asked(calls, 'shipItems')[0]?.variables).toEqual({ o: 'o-1', w: 'w-nw', l: [{ lineId: 'l1', quantity: 1 }, { lineId: 'l2', quantity: 1 }], c: 'Delhivery', t: '1490 2210', u: null })
    expect(hasText(renderer, '2 items shipped')).toBe(true)
  })

  it('asks for the supplier’s locations, never the store’s, and cannot confirm with none', async () => {
    const { renderer } = await showOrder({ value: toShopper() }, { 'warehouses(first': () => ({ warehouses: page([]) }) })
    await click(renderer, 'Ship items')
    expect(hasText(renderer, 'You have no location to send from yet.')).toBe(true)
  })

  it('keeps a refusal in the sheet, by its code, with what was typed', async () => {
    const { renderer } = await showOrder({ value: toShopper() }, {
      'warehouses(first': () => places,
      shipItems: () => {
        throw new ApiError('TOO_MANY', 'no')
      },
    })
    await click(renderer, 'Ship items')
    await type(renderer, 'Courier', 'Delhivery')
    await clickLast(renderer, 'Mark as shipped')
    expect(hasText(renderer, 'That’s more than is left.')).toBe(true)
    expect(pressableNamed(renderer, 'Cancel')).toBeTruthy()
  })

  it('offers nothing to ship to a seat that can only read orders, or while the store is read-only, or when nothing is left', async () => {
    const reading = await showOrder({ value: order() }, {}, 'ordersRead')
    expect(hasText(reading.renderer, 'KT-1042')).toBe(true)
    expect(hasText(reading.renderer, 'Send items to the store')).toBe(false)

    const readOnly = await showOrder({ value: order() }, {}, 'ordersFulfil', { client: fakeClient({ state: readOnlyState }) })
    expect(hasText(readOnly.renderer, 'KT-1042')).toBe(true)
    expect(hasText(readOnly.renderer, 'Your store is read-only until the bill is paid.')).toBe(true)
    expect(hasText(readOnly.renderer, 'Send items to the store')).toBe(false)

    const done = await showOrder({ value: order({ parts: [part('to-store', [line('l1', 'Mara Linen Shirt', 1, { sentToStoreQuantity: 1 })], 'sent_to_store')] }) })
    expect(hasText(done.renderer, 'Send items to the store')).toBe(false)
    expect(hasText(done.renderer, 'Shipped')).toBe(true)

    const cancelled = await showOrder({ value: order({ state: 'cancelled' }) })
    expect(hasText(cancelled.renderer, 'Cancelled')).toBe(true)
    expect(hasText(cancelled.renderer, 'Send items to the store')).toBe(false)
  })

  it('adds tracking to a shipment of its own that was sent without it', async () => {
    const shipment = { id: 'f1', kind: 'manual', supplierId: 's-1', warehouseName: 'Northwind yard', courierName: null, trackingNumber: null, trackingUrl: null, shippedAt: '2026-10-10T11:00:00Z', pickupRequestedAt: null, lines: [{ lineId: 'l1', quantity: 1 }] }
    const { renderer, calls } = await showOrder({ value: toShopper({ shipments: [shipment] }) }, { addTracking: () => ({ addTracking: true }) })

    await click(renderer, 'Add tracking')
    await type(renderer, 'Tracking number', '1490 2210')
    await clickLast(renderer, 'Save tracking')
    expect(asked(calls, 'addTracking')[0]?.variables).toMatchObject({ s: 'f1', t: '1490 2210' })
  })

  it('says it is not here for an order that is not this supplier’s, whether the API answers null or not found', async () => {
    const empty = await showOrder({ value: null })
    expect(hasText(empty.renderer, 'This page isn’t here any more')).toBe(true)

    const missing = await showOrder({ value: order() }, {
      'order(id': () => {
        throw new ApiError('NOT_FOUND', 'no')
      },
    })
    expect(hasText(missing.renderer, 'This page isn’t here any more')).toBe(true)
    expect(hasText(missing.renderer, 'KT-1042')).toBe(false)
  })

  it('says the seat has no access without orders.read, and draws nothing of the order', async () => {
    const { renderer } = await showOrder({ value: order() }, {}, 'catalogue')
    expect(hasText(renderer, 'You don’t have access to this order')).toBe(true)
    expect(hasText(renderer, 'KT-1042')).toBe(false)
  })
})
