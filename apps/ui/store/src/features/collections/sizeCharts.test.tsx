// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { idParam, optionalParam, searchParam } from '@dripfunnel/shared/search'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Acting } from '../../api/shell'
import type { SizeChart } from '../../api/sizeCharts'
import { messages } from '../../messages'

// CatSizeCharts driven as the merchant (Collections › Size charts) and a supplier (Your products › Size charts) would.

const words = messages.collections.charts

const charts = vi.hoisted(() => ({ loadSizeChartList: vi.fn(), loadSizeChartLimit: vi.fn(), loadSizeChart: vi.fn(), saveSizeChart: vi.fn(), deleteSizeChart: vi.fn() }))
vi.mock('../../api/sizeCharts', () => charts)
const editorApi = vi.hoisted(() => ({ loadProductBasics: vi.fn() }))
vi.mock('../../api/productEditor', () => editorApi)
vi.mock('../../api/collections', () => ({ loadCollections: vi.fn(async () => []), loadMarketCountries: vi.fn(async () => []), loadCollection: vi.fn(), loadMembers: vi.fn(), previewCollection: vi.fn(), searchPickable: vi.fn(), saveCollection: vi.fn(), deleteCollection: vi.fn() }))
vi.mock('../../api/filters', () => ({ loadFilters: vi.fn(async () => []), saveFilter: vi.fn(), mergeValues: vi.fn() }))
vi.mock('../../api/menu', () => ({ loadMenu: vi.fn(async () => null), saveMenu: vi.fn() }))

const { CollectionsPage } = await import('./CollectionsPage')
const { SupplierSizeChartsPage } = await import('./SupplierSizeChartsPage')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['catalog.read', 'catalog.write'] }
const manager: Acting = { ...owner, role: 'manager' }
const supplier: Acting = { ...owner, role: 'supplier-admin', tier: 'vendor-catalogue', seller: { id: 'v1', name: 'Northwind' }, permissions: ['catalog.read', 'catalog.write'] }

const tops: SizeChart = {
  id: 'c1',
  name: 'Tops',
  unit: 'cm',
  systems: [],
  measurements: ['Chest', 'Waist'],
  rows: [
    { size: 'M', values: ['96', '81'] },
    { size: 'L', values: ['101', '86'] },
  ],
  howToMeasure: [],
  fitNotes: null,
  modelInfo: null,
  revision: 2,
  products: 3,
  supplierId: null,
}
const summary = (c: SizeChart) => ({ id: c.id, name: c.name, unit: c.unit, products: c.products, supplierId: c.supplierId })
const theirs = { ...summary(tops), id: 'c9', name: 'Northwind tees', supplierId: 'v1' }

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const dialog = () => within(document.querySelector('dialog') as HTMLElement)

const show = async (acting: Acting, path: string, readOnly = false) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const page = createRoute({ getParentRoute: () => app, path: '/collections', validateSearch: z.looseObject({ tab: optionalParam(z.enum(['filters', 'menus', 'sizeCharts'])), edit: idParam, name: searchParam }), component: CollectionsPage })
  const products = createRoute({ getParentRoute: () => app, path: '/products', component: () => <p>Products</p> })
  const theirsPage = createRoute({ getParentRoute: () => app, path: '/products/size-charts', component: SupplierSizeChartsPage })
  const billing = createRoute({ getParentRoute: () => app, path: '/billing', component: () => <p>Billing</p> })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page, products, theirsPage, billing])]), history: createMemoryHistory({ initialEntries: [path] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  await settle()
  return router
}

beforeEach(() => {
  charts.loadSizeChartList.mockResolvedValue([summary(tops), theirs])
  charts.loadSizeChartLimit.mockResolvedValue(200)
  charts.loadSizeChart.mockResolvedValue(tops)
  charts.saveSizeChart.mockResolvedValue({ id: 'c1', revision: 3 })
  editorApi.loadProductBasics.mockResolvedValue({ pricingCurrency: 'INR', unitSystem: 'metric', features: [{ key: 'sizeCharts', enabled: true, inPlan: true }] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const merchant = '/collections?tab=sizeCharts'

describe('size charts, the merchant’s', () => {
  it('lists the store’s own charts with the count against the limit, and opens the first', async () => {
    await show(owner, merchant)
    const list = within(screen.getByRole('navigation', { name: words.listLabel }))
    expect(list.getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent)).toEqual(['Tops'])
    expect(list.getByText('1 of 200')).toBeTruthy()
    expect(list.getByText('3 products · cm')).toBeTruthy()
    expect((screen.getByLabelText(words.name) as HTMLInputElement).value).toBe('Tops')
    expect((screen.getByLabelText('L, Chest') as HTMLInputElement).value).toBe('101')
    expect(screen.getByText('This chart is on 3 products. Changes show on all of them.')).toBeTruthy()
  })

  it('converts to inches, sends a blank cell as "—", and asks before changing a chart on several products', async () => {
    await show(owner, merchant)
    fireEvent.click(screen.getByRole('button', { name: 'in' }))
    expect((screen.getByLabelText('M, Chest') as HTMLInputElement).value).toBe('37.8')
    fireEvent.change(screen.getByLabelText('L, Waist'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: words.save }))
    fireEvent.click(dialog().getByRole('button', { name: words.next }))
    await settle()
    expect(charts.saveSizeChart).toHaveBeenCalledWith('c1', 2, expect.objectContaining({ unit: 'in', rows: [{ size: 'M', values: ['37.8', '31.9'] }, { size: 'L', values: ['39.8', '—'] }] }))
    expect(screen.getByText('“Tops” saved — updated on 3 products')).toBeTruthy()
  })

  it('makes a copy instead when asked, which starts on no products', async () => {
    charts.saveSizeChart.mockResolvedValue({ id: 'c2', revision: 1 })
    await show(owner, merchant)
    fireEvent.change(screen.getByLabelText('M, Chest'), { target: { value: '98' } })
    fireEvent.click(screen.getByRole('button', { name: words.save }))
    fireEvent.change(dialog().getByRole('combobox'), { target: { value: 'copy' } })
    fireEvent.click(dialog().getByRole('button', { name: words.next }))
    await settle()
    expect(charts.saveSizeChart).toHaveBeenCalledWith(null, null, expect.objectContaining({ name: 'Tops (copy)' }))
    expect(screen.getByText(words.copied)).toBeTruthy()
    expect(charts.loadSizeChart).toHaveBeenLastCalledWith('c2')
  })

  it('starts one from a template in the store’s unit, and adds empty size-system columns', async () => {
    charts.saveSizeChart.mockResolvedValue({ id: 'c3', revision: 1 })
    await show(owner, merchant)
    fireEvent.click(screen.getByRole('button', { name: words.new }))
    fireEvent.click(dialog().getByRole('radio', { name: new RegExp(words.templates.kurta) }))
    fireEvent.click(dialog().getByRole('button', { name: words.create }))
    await settle()
    expect(charts.saveSizeChart).toHaveBeenCalledWith(null, null, expect.objectContaining({ name: 'Kurtas', unit: 'cm', measurements: ['Chest', 'Length', 'Shoulder'] }))
    expect(screen.getByText(words.created)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.addSystems }))
    expect((screen.getByLabelText('Column 2 name') as HTMLInputElement).value).toBe('US')
    expect((screen.getByLabelText('M, US') as HTMLInputElement).value).toBe('')
  })

  it('asks before leaving unsaved changes, says what can’t be saved, and deletes saying how many products lose it', async () => {
    charts.deleteSizeChart.mockResolvedValue(3)
    charts.loadSizeChartList.mockResolvedValue([summary(tops), { ...summary(tops), id: 'c5', name: 'Jeans' }])
    await show(owner, merchant)
    fireEvent.change(screen.getByLabelText(words.name), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: words.save }))
    expect(screen.getByRole('alert').textContent).toBe(words.problems.name)
    expect(charts.saveSizeChart).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Jeans/ }))
    expect(dialog().getByText(words.leaveBody)).toBeTruthy()
    fireEvent.click(dialog().getByRole('button', { name: words.keep }))
    fireEvent.change(screen.getByLabelText(words.name), { target: { value: 'Tops' } })
    fireEvent.click(screen.getByRole('button', { name: words.delete }))
    expect(dialog().getByText('3 products will lose their size chart. You can pick another chart for them after.')).toBeTruthy()
    fireEvent.click(dialog().getByRole('button', { name: words.deleteConfirm }))
    await settle()
    expect(charts.deleteSizeChart).toHaveBeenCalledWith('c1')
    expect(screen.getByText(words.pick)).toBeTruthy()
  })

  it('shows the chart picked last, whichever read answers first', async () => {
    const jeans = { ...tops, id: 'c5', name: 'Jeans' }
    charts.loadSizeChartList.mockResolvedValue([summary(tops), { ...summary(tops), id: 'c5', name: 'Jeans' }])
    await show(owner, merchant)
    let answerTops: (c: typeof tops) => void = () => undefined
    charts.loadSizeChart.mockImplementation((id: string) => (id === 'c1' ? new Promise((resolve) => (answerTops = resolve)) : Promise.resolve(jeans)))
    fireEvent.click(screen.getByRole('button', { name: /Jeans/ }))
    fireEvent.click(screen.getByRole('button', { name: /Tops/ }))
    fireEvent.click(screen.getByRole('button', { name: /Jeans/ }))
    await settle()
    await act(async () => answerTops(tops))
    expect((screen.getByLabelText(words.name) as HTMLInputElement).value).toBe('Jeans')
  })

  it('keeps another chart open when a save answers after it was picked', async () => {
    const jeans = { ...tops, id: 'c5', name: 'Jeans', products: 0 }
    charts.loadSizeChartList.mockResolvedValue([summary({ ...tops, products: 0 }), { ...summary(tops), id: 'c5', name: 'Jeans' }])
    charts.loadSizeChart.mockImplementation((id: string) => Promise.resolve(id === 'c5' ? jeans : { ...tops, products: 0 }))
    let answerSave: (r: { id: string; revision: number }) => void = () => undefined
    charts.saveSizeChart.mockReturnValueOnce(new Promise((resolve) => (answerSave = resolve)))
    await show(owner, merchant)
    fireEvent.change(screen.getByLabelText(words.name), { target: { value: 'Tops 2' } })
    fireEvent.click(screen.getByRole('button', { name: words.save }))
    fireEvent.click(screen.getByRole('button', { name: /Jeans/ }))
    fireEvent.click(dialog().getByRole('button', { name: words.discard }))
    await settle()
    expect((screen.getByLabelText(words.name) as HTMLInputElement).value).toBe('Jeans')
    await act(async () => answerSave({ id: 'c1', revision: 4 }))
    await settle()
    expect((screen.getByLabelText(words.name) as HTMLInputElement).value).toBe('Jeans')
  })

  it('keeps another chart open when a delete answers after it was picked', async () => {
    const jeans = { ...tops, id: 'c5', name: 'Jeans', products: 0 }
    charts.loadSizeChartList.mockResolvedValue([summary({ ...tops, products: 0 }), { ...summary(tops), id: 'c5', name: 'Jeans' }])
    charts.loadSizeChart.mockImplementation((id: string) => Promise.resolve(id === 'c5' ? jeans : { ...tops, products: 0 }))
    let answerDelete: (n: number) => void = () => undefined
    charts.deleteSizeChart.mockReturnValueOnce(new Promise((resolve) => (answerDelete = resolve)))
    await show(owner, merchant)
    fireEvent.click(screen.getByRole('button', { name: words.delete }))
    fireEvent.click(dialog().getByRole('button', { name: words.deleteConfirm }))
    fireEvent.click(screen.getByRole('button', { name: /Jeans/ }))
    await settle()
    await act(async () => answerDelete(0))
    await settle()
    expect((screen.getByLabelText(words.name) as HTMLInputElement).value).toBe('Jeans')
  })

  it('takes the limit from the API', async () => {
    charts.loadSizeChartLimit.mockResolvedValue(1)
    await show(owner, merchant)
    expect(screen.getByText('1 of 1')).toBeTruthy()
  })

  it('asks before a new chart from a template replaces unsaved changes', async () => {
    await show(owner, merchant)
    fireEvent.change(screen.getByLabelText('M, Chest'), { target: { value: '99' } })
    fireEvent.click(screen.getByRole('button', { name: words.new }))
    expect(dialog().getByText(words.leaveBody)).toBeTruthy()
    fireEvent.click(dialog().getByRole('button', { name: words.keep }))
    expect(document.querySelector('dialog')).toBeNull()
    expect((screen.getByLabelText('M, Chest') as HTMLInputElement).value).toBe('99')
    fireEvent.click(screen.getByRole('button', { name: words.new }))
    fireEvent.click(dialog().getByRole('button', { name: words.discard }))
    await settle()
    expect(screen.getByRole('heading', { name: words.startTitle })).toBeTruthy()
  })

  it('says why a save was refused, and keeps the chart as typed', async () => {
    charts.loadSizeChart.mockResolvedValue({ ...tops, products: 0 })
    charts.saveSizeChart.mockRejectedValue(new ApiError('STALE_REVISION', 'stale'))
    await show(owner, merchant)
    fireEvent.change(screen.getByLabelText('M, Chest'), { target: { value: '99' } })
    fireEvent.click(screen.getByRole('button', { name: words.save }))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(words.refused.STALE_REVISION)
    expect((screen.getByLabelText('M, Chest') as HTMLInputElement).value).toBe('99')
  })

  it('tells the Owner charts aren’t in the plan, with a way to see plans; a manager gets no plan prompt', async () => {
    editorApi.loadProductBasics.mockResolvedValue({ pricingCurrency: 'INR', unitSystem: 'metric', features: [{ key: 'sizeCharts', enabled: false, inPlan: false }] })
    await show(owner, merchant)
    expect(screen.getByText(words.notInPlanOwner)).toBeTruthy()
    expect(screen.getByRole('link', { name: words.seePlans })).toBeTruthy()
    expect(screen.queryByRole('button', { name: words.new })).toBeNull()
    cleanup()
    await show(manager, merchant)
    expect(screen.getByText(words.notInPlan)).toBeTruthy()
    expect(screen.queryByRole('link', { name: words.seePlans })).toBeNull()
  })

  it('says when charts are switched off, and lets a read-only store look only', async () => {
    editorApi.loadProductBasics.mockResolvedValue({ pricingCurrency: 'INR', unitSystem: 'metric', features: [{ key: 'sizeCharts', enabled: false, inPlan: true }] })
    await show(owner, merchant, true)
    expect(screen.getByText(words.offNote)).toBeTruthy()
    expect((screen.getByLabelText('M, Chest') as HTMLInputElement).readOnly).toBe(true)
    expect(screen.queryByRole('button', { name: words.save })).toBeNull()
  })

  it('shows the error with a retry, and a chart that didn’t load can be tried again', async () => {
    charts.loadSizeChartList.mockRejectedValueOnce(new Error('offline'))
    await show(owner, merchant)
    expect(screen.getByText(words.loadFailed.title)).toBeTruthy()
    charts.loadSizeChart.mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: words.retry }))
    await settle()
    expect(screen.getByText(words.chartFailed)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.retry }))
    await settle()
    expect((screen.getByLabelText(words.name) as HTMLInputElement).value).toBe('Tops')
  })
})

describe('size charts, a supplier’s', () => {
  it('sits under “Your products” with its tab current, and lists every chart it reads as its own', async () => {
    charts.loadSizeChartList.mockResolvedValue([theirs])
    charts.loadSizeChart.mockResolvedValue({ ...tops, id: 'c9', name: 'Northwind tees', supplierId: 'v1' })
    editorApi.loadProductBasics.mockResolvedValue({ pricingCurrency: 'INR', unitSystem: 'metric', features: [{ key: 'sizeCharts', enabled: true, inPlan: null }] })
    await show(supplier, '/products/size-charts')
    expect(screen.getByRole('link', { name: messages.warehouses.tabs.sizeCharts }).getAttribute('aria-current')).toBe('page')
    expect((screen.getByLabelText(words.name) as HTMLInputElement).value).toBe('Northwind tees')
    expect(screen.getByRole('button', { name: words.new })).toBeTruthy()
  })

  it('says when the store hasn’t switched charts on, and tells a seat without the catalogue it can’t see them', async () => {
    editorApi.loadProductBasics.mockResolvedValue({ pricingCurrency: 'INR', unitSystem: 'metric', features: [{ key: 'sizeCharts', enabled: false, inPlan: null }] })
    charts.loadSizeChartList.mockResolvedValue([])
    await show(supplier, '/products/size-charts')
    expect(screen.getByText(words.notInPlanSupplier)).toBeTruthy()
    expect(screen.queryByRole('button', { name: words.new })).toBeNull()
    cleanup()
    await show({ ...supplier, permissions: [] }, '/products/size-charts')
    expect(screen.getByRole('heading', { name: words.denied.title })).toBeTruthy()
  })

  it('sends the merchant side to its own charts under Collections, never a supplier’s view of every chart', async () => {
    const router = await show(owner, '/products/size-charts')
    await settle()
    expect(router.state.location.pathname).toBe('/collections')
    expect(router.state.location.search).toMatchObject({ tab: 'sizeCharts' })
  })
})
