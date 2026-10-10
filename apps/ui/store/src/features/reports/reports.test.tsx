// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { exportJob } from '@dripfunnel/shared/ui'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReportSuppliers, StoreReport } from '../../api/reports'
import type { Acting } from '../../api/shell'
import { messages } from '../../messages'
import { panelsOf } from './reportView'

// Reports driven as the Owner and a Manager would (FIRST-RELEASE §10): the range and currency, what the plan unlocks,
// each panel's export and the builder, and who is turned away.

const words = messages.reports

const api = vi.hoisted(() => ({ loadReport: vi.fn(), loadReportSuppliers: vi.fn(), requestReportExport: vi.fn(), loadReportExport: vi.fn() }))
vi.mock('../../api/reports', async (actual) => ({ ...(await actual<typeof import('../../api/reports')>()), ...api }))

const { ReportsPage } = await import('./ReportsPage')

const inr = (amount: string) => ({ amount, currency: 'INR' })

const takings = { orders: 42, sales: inr('1845200'), refunds: inr('61200'), net: inr('1784000'), previousNet: inr('2000000'), previousOrders: 37 }
const report: StoreReport = {
  days: 30,
  timeZone: 'Asia/Kolkata',
  currency: 'INR',
  currencies: ['INR', 'USD'],
  country: 'IN',
  takings,
  sold: [
    { productId: 'p1', name: 'Saree', units: 14, amount: inr('600000') },
    { productId: 'p2', name: 'Kurta', units: 31, amount: inr('300000') },
  ],
  markets: [{ marketId: null, name: null, orders: 1, amount: inr('30800') }],
  tax: { by: 'rate', total: inr('221400'), rows: [{ key: '500', orders: 30, amount: inr('61200') }, { key: null, orders: 9, amount: inr('11400') }] },
  offers: [{ name: 'DIWALI20', orders: 11, discount: inr('89200'), amount: inr('356800') }],
}
const suppliers: ReportSuppliers = [
  { supplierId: null, name: null, units: 61 },
  { supplierId: 's1', name: 'Northwind', units: 23 },
]
const planLimit = (name: string) => new ApiError('PLAN_LIMIT', 'Your plan doesn’t include this.', { key: 'reports_sales', limit: null, unlockedBy: { id: 'p', name } })

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['reports.read', 'billing', 'orders.read'] }
const manager: Acting = { ...owner, role: 'manager', permissions: ['reports.read', 'orders.read'] }
const staff: Acting = { ...owner, role: 'staff', permissions: ['orders.read'] }
const supplier: Acting = { ...owner, role: 'supplier-member', tier: 'vendor-orders-fulfil', seller: { id: 'v1', name: 'Northwind' }, permissions: ['orders.read', 'sales.read'] }

const show = async (acting: Acting, { readOnly = false } = {}) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const page = createRoute({ getParentRoute: () => app, path: '/reports', component: ReportsPage })
  const billing = createRoute({ getParentRoute: () => app, path: '/billing', component: () => null })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page, billing])]), history: createMemoryHistory({ initialEntries: ['/reports'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  return router
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const panel = (title: string) => within(screen.getByRole('region', { name: title }))
const job = (id: string) => ({ id, state: 'preparing' as const, entries: null, url: null, expiresAt: null })

beforeEach(() => {
  api.loadReport.mockResolvedValue(report)
  api.loadReportSuppliers.mockResolvedValue(suppliers)
  api.requestReportExport.mockResolvedValue(job('r1'))
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  exportJob.set(null)
})

describe('what Reports works out', () => {
  it('words each panel from the API’s figures: the change, the bars, the tax rates and delivery', () => {
    const [takings, sold, markets, tax, suppliersPanel, offers] = panelsOf(report, 30, { kind: 'ready', rows: suppliers })
    expect(takings).toMatchObject({ big: '₹17,840.00', delta: { text: '▼ 11% vs the previous 30 days', tone: 'down' } })
    expect(takings?.rows.map((r) => r.value)).toEqual(['₹18,452.00', '−₹612.00', '₹17,840.00'])
    expect(sold?.rows.map((r) => [r.label, r.bar])).toEqual([
      ['Saree · 14 sold', 100],
      ['Kurta · 31 sold', 50],
    ])
    expect(markets?.rows[0]?.label).toBe(words.markets.outside)
    expect(tax).toMatchObject({ title: words.tax.titleGst, big: '₹2,214.00', delta: { text: 'For shoppers in India' } })
    expect(tax?.rows.map((r) => r.label)).toEqual(['5%', words.tax.delivery])
    expect(suppliersPanel?.rows.map((r) => [r.label, r.value])).toEqual([
      [words.suppliers.own, '61 units'],
      ['Northwind', '23 units'],
    ])
    expect(offers?.rows[0]).toMatchObject({ label: 'DIWALI20 · 11 orders · ₹892.00 off', value: '₹3,568.00' })
  })

  it('says a store with no sales has nothing to compare, and leaves out a supplier split it doesn’t have', () => {
    const quiet: StoreReport = { ...report, currency: null, takings: null, sold: [], markets: [], tax: null, offers: [] }
    const panels = panelsOf(quiet, 90, { kind: 'ready', rows: [{ supplierId: null, name: null, units: 3 }] })
    expect(panels.map((p) => p.key)).toEqual(['takings', 'sold', 'markets', 'tax', 'offers'])
    expect(panels.every((p) => p.none === 'No sales in the last 90 days.')).toBe(true)
    expect(panelsOf({ ...report, takings: { ...takings, previousNet: inr('0') } }, 30, { kind: 'hidden' })[0]?.delta?.text).toBe(words.takings.nothingBefore)
    expect(panelsOf({ ...report, offers: [] }, 30, { kind: 'hidden' }).find((p) => p.key === 'offers')?.none).toBe('No offer was used in the last 30 days.')
    expect(panelsOf({ ...report, country: 'US', tax: { by: 'state', total: inr('1'), rows: [{ key: 'NY', orders: 1, amount: inr('1') }] } }, 30, { kind: 'hidden' })[3]).toMatchObject({ title: words.tax.titleState, big: words.tax.byState })
  })
})

describe('the Reports screen', () => {
  it('reads the last 30 days and the suppliers, then reads again for another range or currency', async () => {
    await show(owner)
    expect(api.loadReport).toHaveBeenCalledWith(30, null)
    expect(api.loadReportSuppliers).toHaveBeenCalledWith(30, null)
    expect(screen.getByText('Last 30 days, compared with the 30 days before · 42 orders')).toBeTruthy()
    expect(panel(words.suppliers.title).getByText('Northwind')).toBeTruthy()
    const range = within(screen.getByRole('group', { name: words.range.label }))
    expect(range.getByRole('button', { name: '30 days' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(range.getByRole('button', { name: '7 days' }))
    await settle()
    expect(api.loadReport).toHaveBeenLastCalledWith(7, null)
    fireEvent.change(screen.getByRole('combobox', { name: words.currency.label }), { target: { value: 'USD' } })
    await settle()
    expect(api.loadReport).toHaveBeenLastCalledWith(7, 'USD')
    expect(api.loadReportSuppliers).toHaveBeenLastCalledWith(7, 'USD')
  })

  it('never lets a slow answer for the range picked before replace the latest', async () => {
    let answer30: (r: StoreReport) => void = () => undefined
    api.loadReport.mockReturnValueOnce(new Promise<StoreReport>((resolve) => (answer30 = resolve))).mockResolvedValueOnce({ ...report, days: 7, takings: { ...takings, orders: 5 } })
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    await settle()
    expect(screen.getByText(/· 5 orders$/)).toBeTruthy()
    await act(async () => answer30(report))
    expect(screen.getByText(/· 5 orders$/)).toBeTruthy()
  })

  it('shows the Owner the locked view naming the plan, with the way to Billing', async () => {
    api.loadReport.mockRejectedValue(planLimit('Growth'))
    await show(owner)
    expect(screen.getByText('Takings, what sold, markets and tax — on Growth and up')).toBeTruthy()
    expect(screen.getByRole('link', { name: words.locked.seePlans }).getAttribute('href')).toBe('/billing')
  })

  it('tells a Manager to ask the owner, with no plans to choose', async () => {
    api.loadReport.mockRejectedValue(planLimit('Growth'))
    await show(manager)
    expect(screen.getByText(words.locked.askOwner)).toBeTruthy()
    expect(screen.queryByRole('link', { name: words.locked.seePlans })).toBeNull()
  })

  it('locks only the supplier panel when the plan has reports but not export, and keeps a failed supplier read out of the way', async () => {
    api.loadReportSuppliers.mockRejectedValue(planLimit('Growth Pro'))
    await show(owner)
    expect(panel(words.suppliers.title).getByText('Export and the supplier report are on Growth Pro.')).toBeTruthy()
    expect((panel(words.suppliers.title).getByRole('button') as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    api.loadReportSuppliers.mockRejectedValue(new ApiError('NOT_CONNECTED', 'down'))
    await show(owner)
    expect(screen.queryByRole('region', { name: words.suppliers.title })).toBeNull()
    expect(screen.getByRole('region', { name: words.takings.title })).toBeTruthy()
  })

  it('exports a panel over the range and currency on screen, and Export all asks for the takings', async () => {
    await show(owner)
    fireEvent.click(panel(words.sold.title).getByRole('button', { name: `Export ${words.sold.title}` }))
    await settle()
    expect(api.requestReportExport).toHaveBeenCalledWith('sold', 30, 'INR', null)
    expect(screen.getByRole('status').textContent).toBe(words.export.preparing)
    exportJob.set(null)
    api.requestReportExport.mockResolvedValue(job('r2'))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: words.exportAll }))
    await settle()
    expect(api.requestReportExport).toHaveBeenLastCalledWith('takings', 30, 'INR', null)
  })

  it('says an export the plan refuses is on the plan that unlocks it, the way to Billing for the Owner only', async () => {
    api.requestReportExport.mockRejectedValue(planLimit('Growth Pro'))
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: words.exportAll }))
    await settle()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('That’s on Growth Pro. See plans in Billing.')
    expect(within(alert).getByRole('link', { name: words.locked.seePlans })).toBeTruthy()
    cleanup()
    await show(manager)
    fireEvent.click(screen.getByRole('button', { name: words.exportAll }))
    await settle()
    expect(screen.getByRole('alert').textContent?.trim()).toBe('That’s on Growth Pro.')
  })

  it('says a read-only support session can’t take the data, and that nothing sold means nothing to export', async () => {
    api.requestReportExport.mockRejectedValue(new ApiError('FORBIDDEN', 'no'))
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: words.exportAll }))
    await settle()
    expect(screen.getByRole('alert').textContent?.trim()).toBe(words.refused.FORBIDDEN)
    cleanup()
    api.requestReportExport.mockClear()
    api.loadReport.mockResolvedValue({ ...report, currency: null, takings: null })
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: words.exportAll }))
    await settle()
    expect(screen.getByRole('alert').textContent?.trim()).toBe('Nothing to export — no orders in the last 30 days.')
    expect(api.requestReportExport).not.toHaveBeenCalled()
  })

  it('builds a custom report in two steps, its refusal in the dialog alone, cleared when it opens again', async () => {
    await show(owner)
    const open = () => fireEvent.click(screen.getByRole('button', { name: `Export ${words.custom.title}` }))
    open()
    fireEvent.click(screen.getByRole('button', { name: words.custom.next }))
    fireEvent.change(screen.getByRole('combobox', { name: words.custom.columnsLabel }), { target: { value: 'tax' } })
    fireEvent.click(screen.getByRole('button', { name: words.custom.make }))
    await settle()
    expect(api.requestReportExport).toHaveBeenCalledWith('custom', 30, 'INR', { rows: 'orders', columns: 'tax' })
    expect(screen.queryByRole('button', { name: words.custom.make })).toBeNull()

    exportJob.set(null)
    api.requestReportExport.mockRejectedValue(planLimit('Business'))
    await settle()
    open()
    fireEvent.change(screen.getByRole('combobox', { name: words.custom.rowsLabel }), { target: { value: 'customers' } })
    fireEvent.click(screen.getByRole('button', { name: words.custom.next }))
    fireEvent.click(screen.getByRole('button', { name: words.custom.make }))
    await settle()
    expect(api.requestReportExport).toHaveBeenLastCalledWith('custom', 30, 'INR', { rows: 'customers', columns: 'basic' })
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(['That’s on Business. See plans in Billing.'])
    expect(panel(words.custom.title).getByText('On Business.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.custom.cancel }))
    open()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('turns Staff and suppliers away without asking the API', async () => {
    await show(staff)
    expect(screen.getByText(words.denied.staff)).toBeTruthy()
    cleanup()
    await show(supplier)
    expect(screen.getByText(words.denied.supplier)).toBeTruthy()
    expect(api.loadReport).not.toHaveBeenCalled()
    expect(api.loadReportSuppliers).not.toHaveBeenCalled()
  })

  it('keeps exports working while the store is read-only, saying so', async () => {
    await show(owner, { readOnly: true })
    expect(screen.getByText(words.readOnly)).toBeTruthy()
    expect((screen.getByRole('button', { name: words.exportAll }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the error with a retry that reads again', async () => {
    api.loadReport.mockRejectedValueOnce(new ApiError('NOT_CONNECTED', 'down'))
    await show(owner)
    expect(screen.getByRole('heading', { name: words.error.title })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.error.retry }))
    await settle()
    expect(screen.getByRole('region', { name: words.takings.title })).toBeTruthy()
  })
})
