// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrderCounts, OrderSummary } from '../../api/orders'
import type { Acting } from '../../api/shell'
import { messages } from '../../messages'
import { ordersAccessOf, rowStatus } from './orderView'

// PortalOrders' list driven as a merchant and a supplier would (FIRST-RELEASE §6): what each seat sees and what each
// chip, search, page and export asks the API for.

const words = messages.orders

const api = vi.hoisted(() => ({ loadOrders: vi.fn(), loadOrderCounts: vi.fn(), loadStoreTimeZone: vi.fn(), requestOrderExport: vi.fn(), loadOrderExport: vi.fn() }))
vi.mock('../../api/orders', async (actual) => ({ ...(await actual<typeof import('../../api/orders')>()), ...api }))

const { OrderList } = await import('./OrderList')
const { Route: ordersRoute } = await import('../../routes/_app/orders')

const order = (r: Partial<OrderSummary> & Pick<OrderSummary, 'id' | 'number'>): OrderSummary => ({
  placedAt: '2026-10-10T07:30:00.000Z',
  state: 'placed',
  paymentState: 'paid',
  fulfilmentState: 'unfulfilled',
  paymentMethod: 'razorpay',
  total: { amount: '489700', currency: 'INR' },
  test: false,
  customerName: 'Ananya Rao',
  city: 'Bengaluru',
  items: 3,
  partState: null,
  shippingMode: null,
  ...r,
})

const counts = (c: Partial<OrderCounts> = {}): OrderCounts => ({ all: 2, toShip: 1, partlyShipped: 0, shipped: 1, cancelledRefunded: 0, paymentPending: 1, ...c })

const toShip = order({ id: 'o1', number: 'KT-1042' })
const pending = order({ id: 'o2', number: 'KT-1041', customerName: 'Rohan Mehta', city: 'Pune', items: 1, paymentState: 'pending', paymentMethod: 'cod', fulfilmentState: 'fulfilled' })

const owner: Acting = { store: { id: 's1', name: 'Kesari Threads' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['orders.read', 'orders.write', 'orders.fulfil', 'orders.refund', 'orders.mark_paid', 'exports'] }
const staff: Acting = { ...owner, role: 'staff', permissions: ['orders.read', 'orders.write', 'orders.fulfil', 'exports'] }
const supplier: Acting = { ...owner, role: 'supplier-member', tier: 'vendor-orders-fulfil', seller: { id: 'v1', name: 'Northwind Textiles' }, permissions: ['orders.read', 'orders.fulfil', 'orders.refund', 'exports.orders'] }
const stockOnly: Acting = { ...supplier, tier: 'vendor-stock', permissions: ['catalog.read', 'stock.read'] }

const show = async (acting: Acting, readOnly = false, entry = '/orders') => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const list = createRoute({ getParentRoute: () => app, path: '/orders', validateSearch: ordersRoute.options.validateSearch, component: OrderList })
  const detail = createRoute({ getParentRoute: () => app, path: '/orders/$orderId', component: () => null })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([list, detail])]), history: createMemoryHistory({ initialEntries: [entry] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  return router
}

const settle = (ms = 0) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)))

beforeEach(() => {
  api.loadOrders.mockResolvedValue({ rows: [toShip, pending], next: 'c2', previous: null })
  api.loadOrderCounts.mockResolvedValue(counts())
  api.loadStoreTimeZone.mockResolvedValue('Asia/Kolkata')
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('who may do what on Orders', () => {
  it('gives the owner every action, staff the money but no payment marking or refund, and a supplier its own part only', () => {
    expect(ordersAccessOf(owner, false)).toEqual({ supplier: false, money: true, canShip: true, canMarkPaid: true, canCancel: true, canNote: true, canRefund: true, canExport: true, readOnly: false })
    expect(ordersAccessOf(staff, false)).toMatchObject({ money: true, canMarkPaid: false, canRefund: false, canCancel: true, canShip: true })
    expect(ordersAccessOf(supplier, false)).toEqual({ supplier: true, money: false, canShip: true, canMarkPaid: false, canCancel: false, canNote: false, canRefund: true, canExport: true, readOnly: false })
  })

  it('words a row by its part for a supplier and by the order for the store', () => {
    expect(rowStatus(order({ id: 'a', number: '1', fulfilmentState: 'partly_fulfilled' }), false)).toBe('partly')
    expect(rowStatus(order({ id: 'a', number: '1', fulfilmentState: 'fulfilled', paymentState: 'refunded' }), false)).toBe('refunded')
    expect(rowStatus(order({ id: 'a', number: '1', state: 'cancelled' }), false)).toBe('cancelled')
    expect(rowStatus(order({ id: 'a', number: '1', partState: 'sent_to_store' }), true)).toBe('shipped')
    expect(rowStatus(order({ id: 'a', number: '1', partState: 'to_ship', fulfilmentState: 'fulfilled' }), true)).toBe('toShip')
  })
})

describe('the Orders list', () => {
  it('shows the owner the chips with their counts and each order with its customer, status, total and payment', async () => {
    await show(owner)
    expect(screen.getByRole('heading', { level: 1, name: words.title })).toBeTruthy()
    expect(screen.getByText('2 orders · 1 to ship')).toBeTruthy()
    expect(screen.getByText('Times in India Standard Time')).toBeTruthy()
    const chips = within(screen.getByRole('group', { name: words.chips.label }))
    expect(chips.getAllByRole('button').map((b) => b.textContent)).toEqual(['All2', 'To ship1', 'Partly shipped0', 'Shipped1', 'Cancelled & refunded0', 'Payment pending1'])
    const rows = within(screen.getByRole('list', { name: words.list.label })).getAllByRole('link')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('KT-1042')
    expect(rows[0]?.textContent).toContain('Oct 10, 1:00 PM')
    expect(rows[0]?.textContent).toContain('Ananya Rao')
    expect(rows[0]?.textContent).toContain('3 items')
    expect(rows[0]?.textContent).toContain('₹4,897.00')
    expect(rows[1]?.textContent).toContain(words.payment.pending)
    expect(rows[1]?.textContent).toContain(words.status.shipped)
    expect(rows[0]?.getAttribute('href')).toBe('/orders/o1')
    expect(api.loadOrders).toHaveBeenCalledWith('ALL', '', {})
  })

  it('opens on the chip a link from Home names, one the seat has', async () => {
    await show(owner, false, '/orders?filter=TO_SHIP')
    expect(api.loadOrders).toHaveBeenCalledWith('TO_SHIP', '', {})
    cleanup()
    api.loadOrders.mockClear()
    await show(supplier, false, '/orders?filter=PAYMENT_PENDING')
    expect(api.loadOrders).toHaveBeenCalledWith('ALL', '', {})
  })

  it('filters by a chip, searches, and pages on with the cursor it was given', async () => {
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: /^Payment pending/ }))
    await settle()
    expect(api.loadOrders).toHaveBeenLastCalledWith('PAYMENT_PENDING', '', {})
    expect(screen.getByRole('button', { name: /^Payment pending/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.change(screen.getByRole('searchbox', { name: words.search.label }), { target: { value: 'Rohan' } })
    await settle(350)
    expect(api.loadOrders).toHaveBeenLastCalledWith('PAYMENT_PENDING', 'Rohan', {})
    fireEvent.click(screen.getByRole('button', { name: words.pages.next }))
    await settle()
    expect(api.loadOrders).toHaveBeenLastCalledWith('PAYMENT_PENDING', 'Rohan', { after: 'c2' })
    expect(screen.getByText('Showing 26–27')).toBeTruthy()
  })

  it('offers to clear a filter that holds nothing', async () => {
    await show(owner)
    api.loadOrders.mockResolvedValue({ rows: [], next: null, previous: null })
    fireEvent.click(screen.getByRole('button', { name: /^Partly shipped/ }))
    await settle()
    expect(screen.getByRole('heading', { name: words.noResults.filters })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.noResults.clear }))
    await settle()
    expect(api.loadOrders).toHaveBeenLastCalledWith('ALL', '', {})
  })

  it('greets a new store with its first-order empty state, and a supplier with its own', async () => {
    api.loadOrders.mockResolvedValue({ rows: [], next: null, previous: null })
    api.loadOrderCounts.mockResolvedValue(counts({ all: 0, toShip: 0, shipped: 0, paymentPending: 0 }))
    await show(owner)
    expect(screen.getByRole('heading', { name: words.empty.title })).toBeTruthy()
    expect(screen.queryByRole('button', { name: words.export.button })).toBeNull()
    cleanup()
    await show(supplier)
    expect(screen.getByRole('heading', { name: words.emptySupplier.title })).toBeTruthy()
  })

  it('shows the error state, and loads again on retry', async () => {
    api.loadOrders.mockRejectedValueOnce(new Error('offline'))
    await show(owner)
    expect(screen.getByRole('heading', { name: words.error.title })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.error.retry }))
    await settle()
    expect(screen.getByText('KT-1042')).toBeTruthy()
  })

  it('shows staff the totals, payment and payment chips, as the API gives them (ACCESS §5.1)', async () => {
    await show(staff)
    const first = within(screen.getByRole('list', { name: words.list.label })).getAllByRole('link')[0]
    expect(first?.textContent).toContain('₹4,897.00')
    expect(first?.textContent).toContain(words.payment.paid)
    expect(screen.getByRole('button', { name: /^Payment pending/ })).toBeTruthy()
  })

  it('shows a supplier To ship: its part’s chips only, the store in place of the shopper, and no money', async () => {
    api.loadOrders.mockResolvedValue({ rows: [order({ id: 'o1', number: 'KT-1042', customerName: null, city: null, total: null, paymentState: null, fulfilmentState: null, partState: 'to_ship', shippingMode: 'to-store', items: 1 })], next: null, previous: null })
    await show(supplier)
    expect(screen.getByRole('heading', { level: 1, name: words.titleSupplier })).toBeTruthy()
    expect(screen.getByText(words.summarySupplier)).toBeTruthy()
    expect(within(screen.getByRole('group', { name: words.chips.label })).getAllByRole('button')).toHaveLength(4)
    const row = within(screen.getByRole('list', { name: words.list.label })).getByRole('link')
    expect(row.textContent).toContain('For Kesari Threads')
    expect(row.textContent).toContain(words.row.sendToStore)
    expect(row.textContent).not.toContain('₹')
    expect(screen.getByRole('searchbox', { name: words.search.label }).getAttribute('placeholder')).toBe(words.search.placeholderSupplier)
    // A supplier reads no store settings, so its times stay in UTC.
    expect(api.loadStoreTimeZone).not.toHaveBeenCalled()
  })

  it('tells a seat without orders that it can’t see them, and asks the API nothing', async () => {
    await show(stockOnly)
    expect(screen.getByRole('heading', { name: words.denied.title })).toBeTruthy()
    expect(api.loadOrders).not.toHaveBeenCalled()
  })

  it('exports the list as it is filtered, and says the export is being prepared', async () => {
    api.requestOrderExport.mockResolvedValue({ id: 'x1', state: 'preparing', entries: null, url: null, expiresAt: null })
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: /^To ship/ }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: words.export.button }))
    await settle()
    expect(api.requestOrderExport).toHaveBeenCalledWith('TO_SHIP', '')
    expect(screen.getByText(words.export.preparing)).toBeTruthy()
  })
})
