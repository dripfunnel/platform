// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Sale, SalePage } from '../../api/sales'
import type { Acting } from '../../api/shell'
import { fill, messages } from '../../messages'
import { saleStatus } from './salesView'

// Your sales per seat (FIRST-RELEASE §17, ACCESS §5.2): only the two order tiers read it, their own lines with no
// totals; every other seat is told so and asks the API nothing.

const words = messages.sales

const api = vi.hoisted(() => ({ loadMySales: vi.fn(), requestOrderExport: vi.fn() }))
vi.mock('../../api/sales', async (actual) => ({ ...(await actual<typeof import('../../api/sales')>()), loadMySales: api.loadMySales }))
vi.mock('../../api/orders', async (actual) => ({ ...(await actual<typeof import('../../api/orders')>()), requestOrderExport: api.requestOrderExport }))

const { SalesPage } = await import('./SalesPage')

const sale = (lineId: string, over: Partial<Sale> = {}): Sale => ({
  lineId,
  orderNumber: `KT-${lineId}`,
  placedAt: '2026-10-04T06:10:00.000Z',
  orderState: 'placed',
  name: 'Mara Linen Shirt',
  versionName: 'M',
  sku: null,
  quantity: 1,
  refundedQuantity: 0,
  amount: { amount: '269900', currency: 'INR' },
  ...over,
})
const page = (rows: Sale[], next: string | null = null, previous: string | null = null): SalePage => ({ rows, next, previous })

const northwind = { id: 'v1', name: 'Northwind Textiles' }
const orderTier = ['catalog.read', 'orders.read', 'sales.read', 'exports.orders']
const fulfil: Acting = { store: { id: 's1', name: 'Kesari Threads' }, role: 'supplier-member', tier: 'vendor-orders-fulfil', seller: northwind, plan: null, permissions: [...orderTier, 'orders.fulfil'] }
const readOrders: Acting = { ...fulfil, tier: 'vendor-orders-read', permissions: orderTier }
const catalogue: Acting = { ...fulfil, tier: 'vendor-catalogue', permissions: ['catalog.read', 'catalog.write'] }
const stock: Acting = { ...fulfil, tier: 'vendor-stock', permissions: ['catalog.read', 'stock.write'] }
const owner: Acting = { store: fulfil.store, role: 'owner', tier: null, seller: null, plan: null, permissions: ['catalog.read', 'orders.read', 'reports.read', 'exports'] }

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

const show = async (acting: Acting, { readOnly = false } = {}) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const sales = createRoute({ getParentRoute: () => app, path: '/sales', component: SalesPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([sales])]), history: createMemoryHistory({ initialEntries: ['/sales'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
}

const lines = () => within(screen.getByRole('table', { name: words.list })).getAllByRole('row').slice(1)

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('a sold line’s status', () => {
  it('says sold, partly refunded, refunded or cancelled from what mySales answers', () => {
    expect(saleStatus({ orderState: 'placed', quantity: 2, refundedQuantity: 0 })).toBe('sold')
    expect(saleStatus({ orderState: 'placed', quantity: 2, refundedQuantity: 1 })).toBe('partlyRefunded')
    expect(saleStatus({ orderState: 'placed', quantity: 2, refundedQuantity: 2 })).toBe('refunded')
    expect(saleStatus({ orderState: 'cancelled', quantity: 2, refundedQuantity: 2 })).toBe('cancelled')
  })
})

describe('Your sales', () => {
  it('lists a supplier’s own lines at the price sold, with no total anywhere', async () => {
    api.loadMySales.mockResolvedValue(page([sale('1049'), sale('1046', { name: 'Linen Tote', versionName: null, quantity: 2, refundedQuantity: 1, amount: { amount: '349900', currency: 'INR' } }), sale('1037', { orderState: 'cancelled' })]))
    await show(fulfil)
    expect(screen.getByText(/Lines with Northwind Textiles’s products in Kesari Threads\./)).toBeTruthy()
    expect(screen.getByText(words.note)).toBeTruthy()
    const [first, second, third] = lines()
    expect(first?.textContent).toBe('KT-1049Oct 4Mara Linen ShirtM× 1₹2,699.00Sold')
    expect(second?.textContent).toContain('× 2₹3,499.001 of 2 refunded')
    expect(third?.textContent).toContain('Cancelled')
    expect(document.body.textContent).not.toMatch(/total/i)
    expect(api.loadMySales).toHaveBeenCalledWith({})
  })

  it('reads the read-only orders tier the same, and a read-only store still reads and exports', async () => {
    api.loadMySales.mockResolvedValue(page([sale('1049')]))
    await show(readOrders, { readOnly: true })
    expect(lines()).toHaveLength(1)
    expect(screen.getByRole('button', { name: words.export })).toBeTruthy()
  })

  it('exports the supplier’s own lines as the orders export, which the API masks to its part', async () => {
    api.loadMySales.mockResolvedValue(page([sale('1049')]))
    api.requestOrderExport.mockResolvedValue({ id: 'e1', state: 'preparing', entries: null, url: null, expiresAt: null })
    await show(fulfil)
    fireEvent.click(screen.getByRole('button', { name: words.export }))
    await settle()
    expect(api.requestOrderExport).toHaveBeenCalledWith('ALL', '')
    expect(screen.getByRole('status').textContent).toContain(messages.orders.export.preparing)
  })

  it('pages with the cursor the API gave, and a slow page asked for before never replaces the latest', async () => {
    api.loadMySales.mockResolvedValueOnce(page([sale('a')], 'c1'))
    await show(fulfil)
    api.loadMySales.mockResolvedValueOnce(page([sale('b')], 'c2', 'c0'))
    fireEvent.click(screen.getByRole('button', { name: messages.orders.pages.next }))
    await settle()
    expect(api.loadMySales).toHaveBeenLastCalledWith({ after: 'c1' })
    expect(screen.getByText('Showing 26–26')).toBeTruthy()
    let slow: (value: SalePage) => void = () => undefined
    api.loadMySales.mockReturnValueOnce(new Promise<SalePage>((resolve) => (slow = resolve))).mockResolvedValueOnce(page([sale('a')], 'c1'))
    fireEvent.click(screen.getByRole('button', { name: messages.orders.pages.next }))
    fireEvent.click(screen.getByRole('button', { name: messages.orders.pages.previous }))
    await settle()
    expect(api.loadMySales).toHaveBeenLastCalledWith({ before: 'c0' })
    expect(lines()[0]?.textContent).toContain('KT-a')
    expect(screen.getByText('Showing 1–1')).toBeTruthy()
    await act(async () => slow(page([sale('c')], null, 'c2')))
    await settle()
    expect(lines()[0]?.textContent).toContain('KT-a')
  })

  it('says so when nothing has sold yet, without an export', async () => {
    api.loadMySales.mockResolvedValue(page([]))
    await show(fulfil)
    expect(screen.getByRole('heading', { name: words.empty.title })).toBeTruthy()
    expect(screen.queryByRole('button', { name: words.export })).toBeNull()
  })

  it('offers a retry when the read fails, and shows the lines once it answers', async () => {
    api.loadMySales.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(page([sale('1049')]))
    await show(fulfil)
    expect(screen.getByRole('heading', { name: words.error.title })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.error.retry }))
    await settle()
    expect(lines()).toHaveLength(1)
  })

  it.each([
    ['a Stock-only supplier', stock, fill(words.denied.supplier, { store: 'Kesari Threads' })],
    ['a catalogue supplier', catalogue, fill(words.denied.supplier, { store: 'Kesari Threads' })],
    ['the merchant side', owner, words.denied.merchant],
  ])('tells %s it has no access and asks the API nothing', async (_name, acting, body) => {
    await show(acting)
    expect(screen.getByRole('heading', { name: words.denied.title })).toBeTruthy()
    expect(screen.getByText(body)).toBeTruthy()
    expect(api.loadMySales).not.toHaveBeenCalled()
  })
})
