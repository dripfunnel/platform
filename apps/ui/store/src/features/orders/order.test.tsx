// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Order, OrderLine, OrderPart } from '../../api/order'
import type { Acting } from '../../api/shell'
import { messages } from '../../messages'
import { eventText, leftToShip } from './orderDetail'

// An order's page driven as each seat would (FIRST-RELEASE §6): what it shows, and what shipping, marking paid,
// cancelling, tracking and notes send.

const words = messages.orders.detail
const cancelWords = messages.orders.cancel

const api = vi.hoisted(() => ({ loadOrder: vi.fn(), shipItems: vi.fn(), addTracking: vi.fn(), markOrderPaid: vi.fn(), cancelOrder: vi.fn(), addOrderNote: vi.fn() }))
vi.mock('../../api/order', async (actual) => ({ ...(await actual<typeof import('../../api/order')>()), ...api }))
const listApi = vi.hoisted(() => ({ loadStoreTimeZone: vi.fn() }))
vi.mock('../../api/orders', async (actual) => ({ ...(await actual<typeof import('../../api/orders')>()), ...listApi }))
const stockApi = vi.hoisted(() => ({ loadShipFrom: vi.fn() }))
vi.mock('../../api/stock', async (actual) => ({ ...(await actual<typeof import('../../api/stock')>()), ...stockApi }))

const { OrderPage } = await import('./OrderPage')

const inr = (amount: string) => ({ amount, currency: 'INR' })
const line = (l: Partial<OrderLine> & Pick<OrderLine, 'id' | 'name'>): OrderLine => ({
  productId: 'p1',
  versionName: null,
  sku: null,
  quantity: 1,
  unitPrice: inr('249900'),
  amount: inr('249900'),
  total: inr('249900'),
  fulfilledQuantity: 0,
  returnedQuantity: 0,
  refundedQuantity: 0,
  sentToStoreQuantity: 0,
  ...l,
})
const part = (p: Partial<OrderPart> & Pick<OrderPart, 'id' | 'lines'>): OrderPart => ({ supplierId: null, supplierName: null, shippingMode: 'store', state: 'to_ship', ...p })

const shirt = line({ id: 'l1', name: 'Mara Linen Shirt', versionName: 'M' })
const cushion = line({ id: 'l2', name: 'Cushion Cover', quantity: 2, total: inr('179800') })
const dupatta = line({ id: 'l3', name: 'Handloom Dupatta', total: inr('149900') })

const placed: Order = {
  id: 'o1',
  number: 'KT-1042',
  state: 'placed',
  placedAt: '2026-10-10T07:30:00.000Z',
  customerName: 'Ananya Rao',
  shippingAddress: { name: 'Ananya Rao', line1: '14 3rd Cross', line2: null, city: 'Bengaluru', region: 'KA', postalCode: '560038', country: 'IN', phone: null },
  parts: [part({ id: 'own', lines: [shirt, cushion] }), part({ id: 'nw', supplierId: 'v1', supplierName: 'Northwind Textiles', shippingMode: 'to-store', lines: [dupatta] })],
  history: [{ id: 'e1', action: 'order.placed', at: '2026-10-10T07:30:00.000Z', actorKind: 'shopper', actorName: null, note: null }],
  shipments: [],
  returns: [],
  refunds: [],
  paymentState: 'paid',
  fulfilmentState: 'unfulfilled',
  paymentMethod: 'razorpay',
  test: false,
  customerId: 'c1',
  email: 'ananya@example.in',
  phone: '+91 98450 12345',
  marketName: 'India',
  taxInclusive: true,
  subtotal: inr('579600'),
  discount: null,
  shipping: inr('0'),
  tax: inr('62100'),
  duties: null,
  total: inr('579600'),
  refunded: null,
  shippingOption: 'flat',
  shippingMethodLabel: null,
  shopperNote: null,
}

const owner: Acting = { store: { id: 's1', name: 'Kesari Threads' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['orders.read', 'orders.write', 'orders.fulfil', 'orders.refund', 'orders.mark_paid', 'exports'] }
const staff: Acting = { ...owner, role: 'staff', permissions: ['orders.read', 'orders.write', 'orders.fulfil', 'exports'] }
const supplier: Acting = { ...owner, role: 'supplier-member', tier: 'vendor-orders-fulfil', seller: { id: 'v1', name: 'Northwind Textiles' }, permissions: ['orders.read', 'orders.fulfil', 'orders.refund', 'exports.orders'] }

const show = async (acting: Acting, order: Order | null, readOnly = false) => {
  api.loadOrder.mockResolvedValue(order)
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const list = createRoute({ getParentRoute: () => app, path: '/orders', component: () => null })
  const page = createRoute({ getParentRoute: () => app, path: '/orders/$orderId', component: OrderPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([list, page])]), history: createMemoryHistory({ initialEntries: ['/orders/o1'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  return router
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const button = (name: string | RegExp) => screen.getByRole('button', { name })

beforeEach(() => {
  listApi.loadStoreTimeZone.mockResolvedValue('Asia/Kolkata')
  stockApi.loadShipFrom.mockResolvedValue([
    { id: 'w2', name: 'Pop-up', isDefault: false },
    { id: 'w1', name: 'Main location', isDefault: true },
  ])
  for (const write of [api.shipItems, api.addTracking, api.markOrderPaid, api.cancelOrder, api.addOrderNote]) write.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('what an order page works out', () => {
  it('counts what the caller can send now: the store its own lines and handed-over ones; a supplier its own by its mode', () => {
    const toStore = part({ id: 'nw', shippingMode: 'to-store', lines: [] })
    const toShopper = part({ id: 'nw', shippingMode: 'to-shopper', lines: [] })
    const own = part({ id: 'own', lines: [] })
    expect(leftToShip(line({ id: 'a', name: 'a', quantity: 3, fulfilledQuantity: 1 }), own, false)).toBe(2)
    expect(leftToShip(line({ id: 'a', name: 'a', quantity: 3, sentToStoreQuantity: 2, fulfilledQuantity: 1 }), toStore, false)).toBe(1)
    expect(leftToShip(line({ id: 'a', name: 'a', quantity: 3 }), toShopper, false)).toBe(0)
    expect(leftToShip(line({ id: 'a', name: 'a', quantity: 3, sentToStoreQuantity: 1 }), toStore, true)).toBe(2)
    expect(leftToShip(line({ id: 'a', name: 'a', quantity: 3, fulfilledQuantity: 3 }), toShopper, true)).toBe(0)
  })

  it('words the history: a note as written, a cancellation’s reason, and who did it', () => {
    expect(eventText({ id: '1', action: 'order.note_added', at: '', actorKind: 'person', actorName: 'Farhan Ali', note: 'Gift wrap' })).toBe('Note · Gift wrap · Farhan Ali')
    expect(eventText({ id: '1', action: 'order.cancelled', at: '', actorKind: 'system', actorName: 'Unpaid transfer', note: 'unpaid_transfer' })).toBe('Cancelled · Transfer not paid in time · Unpaid transfer')
    expect(eventText({ id: '1', action: 'something.new', at: '', actorKind: 'system', actorName: null, note: 'x' })).toBe(messages.orders.history.actions.other)
  })
})

describe('an order’s page', () => {
  it('shows the lines by who packs them, the payment, the customer and the history', async () => {
    await show(owner, placed)
    expect(screen.getByRole('heading', { level: 1, name: 'KT-1042' })).toBeTruthy()
    expect(screen.getByText(words.pay.paid)).toBeTruthy()
    const own = screen.getByRole('region', { name: words.groups.mine })
    expect(within(own).getByText('Mara Linen Shirt · M')).toBeTruthy()
    expect(within(own).getByText('3 to ship')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Northwind Textiles packs these' })).toBeTruthy()
    const totals = screen.getByRole('region', { name: words.totals.title })
    expect(within(totals).getByText(words.totals.includesTax)).toBeTruthy()
    expect(within(totals).getByText(words.totals.free)).toBeTruthy()
    expect(within(totals).getByText('Razorpay')).toBeTruthy()
    const customer = screen.getByRole('region', { name: words.customer.title })
    expect(within(customer).getByText('14 3rd Cross, Bengaluru, KA 560038, IN')).toBeTruthy()
    expect(within(customer).getByText('Market: India')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: words.history.title })).getByText('Order placed')).toBeTruthy()
    expect(api.loadOrder).toHaveBeenCalledWith('o1')
  })

  it('ships the picked items from the chosen location with the courier and tracking, and says the shopper is told', async () => {
    await show(owner, placed)
    fireEvent.click(button(words.actions.ship))
    await settle()
    expect(screen.getByRole('heading', { name: 'Ship 3 items' })).toBeTruthy()
    // The supplier's line isn't the store's to send until it's handed over.
    expect(screen.queryByRole('button', { name: 'More of Handloom Dupatta' })).toBeNull()
    fireEvent.click(button('Fewer of Cushion Cover'))
    expect(screen.getByRole('heading', { name: 'Ship 2 items' })).toBeTruthy()
    const form = within(screen.getByRole('region', { name: 'Ship 2 items' }))
    expect((form.getByRole('combobox', { name: words.ship.location }) as HTMLSelectElement).value).toBe('w1')
    fireEvent.change(form.getByRole('textbox', { name: words.ship.courier }), { target: { value: 'Delhivery' } })
    fireEvent.change(form.getByRole('textbox', { name: new RegExp(words.ship.tracking) }), { target: { value: '1490 2210' } })
    fireEvent.change(form.getByRole('textbox', { name: new RegExp(words.ship.link) }), { target: { value: 'track.example/1490' } })
    fireEvent.click(form.getByRole('button', { name: words.ship.confirm }))
    expect(form.getByRole('alert').textContent).toBe(words.ship.linkInvalid)
    expect(api.shipItems).not.toHaveBeenCalled()
    fireEvent.change(form.getByRole('textbox', { name: new RegExp(words.ship.link) }), { target: { value: 'https://track.example/1490' } })
    fireEvent.click(form.getByRole('button', { name: words.ship.confirm }))
    await settle()
    expect(api.shipItems).toHaveBeenCalledWith({
      orderId: 'o1',
      warehouseId: 'w1',
      lines: [
        { lineId: 'l1', quantity: 1 },
        { lineId: 'l2', quantity: 1 },
      ],
      courierName: 'Delhivery',
      trackingNumber: '1490 2210',
      trackingUrl: 'https://track.example/1490',
    })
    expect(screen.getByText('2 items shipped — Ananya gets an email')).toBeTruthy()
    expect(api.loadOrder).toHaveBeenCalledTimes(2)
  })

  it('keeps the form and says why when the API refuses the shipment', async () => {
    api.shipItems.mockRejectedValue(new ApiError('NOT_ENOUGH_STOCK', 'no'))
    await show(owner, placed)
    fireEvent.click(button(words.actions.ship))
    await settle()
    fireEvent.click(button(words.ship.confirm))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(words.refused.NOT_ENOUGH_STOCK)
    expect(screen.getByRole('heading', { name: 'Ship 3 items' })).toBeTruthy()
  })

  it('hands a pickup order over with no courier or tracking', async () => {
    await show(owner, { ...placed, shippingOption: 'pickup', parts: [part({ id: 'own', lines: [shirt] })] })
    fireEvent.click(button(words.actions.ship))
    await settle()
    expect(screen.queryByRole('textbox', { name: words.ship.courier })).toBeNull()
    expect(screen.getByText(words.customer.pickup)).toBeTruthy()
    fireEvent.click(button(words.ship.confirmPickup))
    await settle()
    expect(api.shipItems).toHaveBeenCalledWith(expect.objectContaining({ courierName: null, trackingNumber: null, trackingUrl: null, lines: [{ lineId: 'l1', quantity: 1 }] }))
    expect(screen.getByText('1 item handed over')).toBeTruthy()
  })

  it('lets a to-store supplier send its own items to the store, and shows it no shopper or money', async () => {
    const own: Order = { ...placed, customerName: null, shippingAddress: null, email: null, phone: null, total: null, subtotal: null, tax: null, shipping: null, paymentState: null, paymentMethod: null, parts: [part({ id: 'nw', supplierId: 'v1', supplierName: 'Northwind Textiles', shippingMode: 'to-store', lines: [dupatta] })], history: [] }
    await show(supplier, own)
    expect(screen.getByText(words.supplierNote)).toBeTruthy()
    expect(screen.getByRole('region', { name: words.sendTo.title })).toBeTruthy()
    expect(screen.queryByRole('region', { name: words.totals.title })).toBeNull()
    expect(screen.queryByRole('button', { name: words.actions.cancel })).toBeNull()
    expect(screen.queryByRole('button', { name: words.note.add })).toBeNull()
    fireEvent.click(button(words.actions.ship))
    await settle()
    expect(stockApi.loadShipFrom).toHaveBeenCalledWith(true)
    expect(screen.getByRole('heading', { name: 'Send 1 item to the store' })).toBeTruthy()
    fireEvent.click(button(words.ship.confirmToStore))
    await settle()
    expect(screen.getByText('1 item marked as sent to Kesari Threads')).toBeTruthy()
  })

  it('marks a cash-on-delivery order paid once the owner confirms the money arrived', async () => {
    await show(owner, { ...placed, paymentState: 'pending', paymentMethod: 'cod' })
    expect(screen.getByText(words.pay.pending)).toBeTruthy()
    fireEvent.click(button(words.actions.markPaid))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText('Only once the ₹5,796.00 has actually reached you (Cash on delivery).')).toBeTruthy()
    fireEvent.click(dialog.getByRole('button', { name: words.markPaid.confirm }))
    await settle()
    expect(api.markOrderPaid).toHaveBeenCalledWith('o1')
    expect(screen.getByText('KT-1042 marked as paid')).toBeTruthy()
  })

  it('shows staff Mark as paid disabled with who can, and never a card order’s', async () => {
    await show(staff, { ...placed, paymentState: 'pending', paymentMethod: 'cod' })
    expect((button(words.actions.markPaid) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(words.staffOnly)).toBeTruthy()
    // Staff see no money, so no Payment card either.
    expect(screen.queryByRole('region', { name: words.totals.title })).toBeNull()
    cleanup()
    await show(owner, { ...placed, paymentState: 'pending', paymentMethod: 'stripe' })
    expect(screen.queryByRole('button', { name: words.actions.markPaid })).toBeNull()
  })

  it('cancels an unshipped order with a reason, saying the shopper gets their money back', async () => {
    await show(owner, placed)
    fireEvent.click(button(words.actions.cancel))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText('Ananya Rao gets ₹5,796.00 back through Razorpay. The items go back in stock.')).toBeTruthy()
    fireEvent.change(dialog.getByRole('combobox', { name: cancelWords.reason }), { target: { value: 'shopper' } })
    fireEvent.click(dialog.getByRole('button', { name: cancelWords.confirm }))
    await settle()
    expect(api.cancelOrder).toHaveBeenCalledWith('o1', 'shopper')
    expect(screen.getByText('KT-1042 cancelled')).toBeTruthy()
  })

  it('keeps the cancel dialog open with the API’s reason when something has already left', async () => {
    api.cancelOrder.mockRejectedValue(new ApiError('NOT_CANCELLABLE', 'no'))
    await show(owner, placed)
    fireEvent.click(button(words.actions.cancel))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: cancelWords.confirm }))
    await settle()
    expect(within(screen.getByRole('dialog')).getByText(words.refused.NOT_CANCELLABLE)).toBeTruthy()
  })

  it('offers no cancel once anything has shipped', async () => {
    await show(owner, { ...placed, fulfilmentState: 'partly_fulfilled', parts: [part({ id: 'own', lines: [{ ...shirt, fulfilledQuantity: 1 }, cushion] })] })
    expect(screen.queryByRole('button', { name: words.actions.cancel })).toBeNull()
    expect(button(words.actions.ship)).toBeTruthy()
  })

  it('adds tracking to a shipment sent without it', async () => {
    await show(owner, { ...placed, shipments: [{ id: 'f1', kind: 'manual', supplierId: null, warehouseName: 'Main location', courierName: 'Delhivery', trackingNumber: null, trackingUrl: null, shippedAt: '2026-10-10T08:00:00.000Z', lines: [{ lineId: 'l1', quantity: 1 }] }] })
    const shipments = within(screen.getByRole('region', { name: words.shipments.title }))
    expect(shipments.getByText('1× Mara Linen Shirt · M')).toBeTruthy()
    fireEvent.click(shipments.getByRole('button', { name: words.shipments.add }))
    fireEvent.click(shipments.getByRole('button', { name: words.shipments.save }))
    expect(shipments.getByRole('alert').textContent).toBe(words.shipments.numberMissing)
    fireEvent.change(shipments.getByRole('textbox', { name: words.ship.tracking }), { target: { value: 'DL123' } })
    fireEvent.click(shipments.getByRole('button', { name: words.shipments.save }))
    await settle()
    expect(api.addTracking).toHaveBeenCalledWith('f1', 'Delhivery', 'DL123', null)
    expect(screen.getByText(words.shipments.added)).toBeTruthy()
  })

  it('adds a team note to the history', async () => {
    await show(owner, placed)
    fireEvent.click(button(words.note.add))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByRole('textbox', { name: words.note.label }), { target: { value: '  Gift wrap  ' } })
    fireEvent.click(dialog.getByRole('button', { name: words.note.confirm }))
    await settle()
    expect(api.addOrderNote).toHaveBeenCalledWith('o1', 'Gift wrap')
  })

  it('leaves every change disabled on a read-only store, saying why', async () => {
    await show(owner, placed, true)
    expect(screen.getByText(words.readOnly)).toBeTruthy()
    expect((button(words.actions.ship) as HTMLButtonElement).disabled).toBe(true)
    expect((button(words.actions.cancel) as HTMLButtonElement).disabled).toBe(true)
    expect((button(words.note.add) as HTMLButtonElement).disabled).toBe(true)
  })

  it('says it can’t find an order that isn’t there, and shows the error state when it fails to load', async () => {
    await show(owner, null)
    expect(screen.getByRole('heading', { name: words.notFound.title })).toBeTruthy()
    cleanup()
    api.loadOrder.mockRejectedValue(new Error('offline'))
    const root = createRootRoute({ component: Outlet })
    const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting: owner, state: { readOnly: false } }), component: Outlet })
    const page = createRoute({ getParentRoute: () => app, path: '/orders/$orderId', component: OrderPage })
    const list = createRoute({ getParentRoute: () => app, path: '/orders', component: () => null })
    const router = createRouter({ routeTree: root.addChildren([app.addChildren([list, page])]), history: createMemoryHistory({ initialEntries: ['/orders/o1'] }) })
    await act(async () => {
      render(<RouterProvider router={router} />)
    })
    await settle()
    expect(screen.getByRole('heading', { name: words.error.title })).toBeTruthy()
  })
})
