// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Rider } from '../../api/riders'
import type { ShippingSettings } from '../../api/shipping'
import type { Place } from '../../api/stock'
import type { Acting } from '../../api/shell'
import { fill, messages } from '../../messages'
import { feeMinor, feeText, kmText, metresOfKm, minutesOf, missingOf } from './ownDelivery'
import { settingsSearch } from './settingsSearch'

// Own delivery in Settings › Shipping and Warehouse (SetOwnDelivery, docs/api/DELIVERY.md §2, #845).

const w = messages.settings.shipping.own
const d = messages.warehouses.delivery
const feeLabel = fill(d.fee, { currency: 'USD' })

const ship = vi.hoisted(() => ({ loadShipping: vi.fn(), saveShipping: vi.fn() }))
vi.mock('../../api/shipping', async (actual) => ({ ...(await actual<typeof import('../../api/shipping')>()), ...ship }))
const riders = vi.hoisted(() => ({ loadRiderPlan: vi.fn(), loadRiders: vi.fn() }))
vi.mock('../../api/riders', async (actual) => ({ ...(await actual<typeof import('../../api/riders')>()), ...riders }))
const stock = vi.hoisted(() => ({ loadPlaces: vi.fn(), savePlace: vi.fn(), loadMapFrame: vi.fn(), loadStoreCountry: vi.fn() }))
vi.mock('../../api/stock', async (actual) => ({ ...(await actual<typeof import('../../api/stock')>()), ...stock }))
const settings = vi.hoisted(() => ({ loadStoreInfo: vi.fn(), loadLocale: vi.fn() }))
vi.mock('../../api/settings', () => settings)

const { SettingsPage } = await import('./SettingsPage')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['settings', 'shipping.configure'] }

const shipping: ShippingSettings = {
  revision: 4,
  savedAt: null,
  currency: 'USD',
  courierRate: false,
  flatRate: true,
  flatAmount: '900',
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
  dispatchWhen: 'ready',
  offerMinutes: 5,
  labelSizes: [],
  couriers: [],
}
const rider = (status: Rider['status']): Rider => ({ id: 'r1', name: 'Asha', phone: null, status, online: false, currentDeliveryId: null, deliveriesDone: 0 })
const place = (p: Partial<Place> & Pick<Place, 'id' | 'name'>): Place => ({ isDefault: false, units: 0, revision: 2, latitude: 12.9, longitude: 77.6, supplierId: null, supplierName: null, address: null, ...p })
const readyPlaces = [place({ id: 'w1', name: 'Workshop', isDefault: true, ownDelivery: true, deliveryRadiusM: 8000, riderRadiusM: 5000, deliveryFeeAmount: '250' })]
const onePage = (nodes: Rider[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } })

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

const show = async (tab: 'shipping' | 'warehouse', { acting = owner, readOnly = false } = {}) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const page = createRoute({ getParentRoute: () => app, path: '/settings', validateSearch: settingsSearch, component: SettingsPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page])]), history: createMemoryHistory({ initialEntries: [`/settings?tab=${tab}`] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  await settle()
  return router
}

beforeEach(() => {
  ship.loadShipping.mockResolvedValue(shipping)
  ship.saveShipping.mockResolvedValue(5)
  riders.loadRiderPlan.mockResolvedValue({ ownDelivery: true })
  riders.loadRiders.mockResolvedValue(onePage([rider('active')]))
  stock.loadPlaces.mockResolvedValue(readyPlaces)
  stock.savePlace.mockResolvedValue('w1')
  stock.loadMapFrame.mockResolvedValue(null)
  stock.loadStoreCountry.mockResolvedValue(null)
  settings.loadStoreInfo.mockResolvedValue({ country: 'US' })
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('the units', () => {
  it('turns kilometres into metres and back, only 1 to 50', () => {
    expect(metresOfKm('8')).toBe(8000)
    expect(kmText(8000)).toBe('8')
    expect(metresOfKm('1')).toBe(1000)
    expect(metresOfKm('50')).toBe(50_000)
    for (const bad of ['0', '51', '2.5', 'ten', '-3']) expect(metresOfKm(bad)).toBe('invalid')
    expect(metresOfKm('  ')).toBeNull()
  })

  it('turns the fee into minor units of the store currency and back', () => {
    expect(feeMinor('2.50', 'USD')).toBe('250')
    expect(feeMinor('0', 'USD')).toBe('0')
    expect(feeMinor('300', 'JPY')).toBe('300')
    expect(feeMinor('', 'USD')).toBeNull()
    expect(feeMinor('2.555', 'USD')).toBe('invalid')
    expect(feeText(place({ id: 'a', name: 'A', deliveryFeeAmount: '250' }), 'USD')).toBe('2.50')
    expect(feeText(place({ id: 'a', name: 'A', deliveryFeeAmount: null }), 'USD')).toBe('')
  })

  it('reads whole minutes from 1 to 30', () => {
    expect(minutesOf('5')).toBe(5)
    expect(minutesOf('30')).toBe(30)
    for (const bad of ['0', '31', '', '1.5']) expect(minutesOf(bad)).toBeNull()
  })

  it('reads which pieces are missing from the refusal, and nothing from any other error', () => {
    expect(missingOf(new ApiError('OWN_DELIVERY_NOT_READY', 'x', { missing: ['rider', 'warehouse', 'bogus'] }))).toEqual(['rider', 'warehouse'])
    expect(missingOf(new ApiError('OWN_DELIVERY_NOT_READY', 'x'))).toEqual([])
    expect(missingOf(new ApiError('STALE', 'x'))).toBeNull()
  })
})

describe('Shipping › Own delivery', () => {
  it('is absent when the plan has no own delivery', async () => {
    riders.loadRiderPlan.mockResolvedValue({ ownDelivery: false })
    await show('shipping')
    expect(screen.queryByRole('region', { name: w.title })).toBeNull()
  })

  it('turns it on over the saved shipping, with when riders are offered and the alert minutes', async () => {
    await show('shipping')
    const card = within(screen.getByRole('region', { name: w.title }))
    fireEvent.click(card.getByRole('switch', { name: w.switch }))
    fireEvent.click(card.getByRole('radio', { name: new RegExp(w.placed) }))
    fireEvent.change(card.getByLabelText(w.minutes), { target: { value: '12' } })
    fireEvent.click(card.getByRole('button', { name: w.save }))
    await settle()
    expect(ship.saveShipping).toHaveBeenCalledWith(4, {
      courierRate: false,
      flatRate: true,
      flatAmount: '900',
      pickup: false,
      pickupHours: null,
      freeMode: 'never',
      freeThresholdAmount: null,
      areaMode: 'everywhere',
      ownDelivery: true,
      dispatchWhen: 'placed',
      offerMinutes: 12,
    })
    expect(screen.getByText(w.saved)).toBeTruthy()
  })

  it('refuses minutes outside 1 to 30 without calling the API', async () => {
    await show('shipping')
    const card = within(screen.getByRole('region', { name: w.title }))
    fireEvent.change(card.getByLabelText(w.minutes), { target: { value: '31' } })
    fireEvent.click(card.getByRole('button', { name: w.save }))
    expect(card.getByText(w.minutesInvalid)).toBeTruthy()
    expect(ship.saveShipping).not.toHaveBeenCalled()
  })

  it('keeps the switch off, and says what is missing with links, until a rider and a location are ready', async () => {
    riders.loadRiders.mockResolvedValue(onePage([rider('invited')]))
    stock.loadPlaces.mockResolvedValue([place({ id: 'w1', name: 'Workshop', latitude: null, longitude: null })])
    const router = await show('shipping')
    const card = within(screen.getByRole('region', { name: w.title }))
    expect((card.getByRole('switch', { name: w.switch }) as HTMLInputElement).disabled).toBe(true)
    expect(card.getAllByText(w.todo)).toHaveLength(2)
    fireEvent.click(card.getByRole('button', { name: w.warehouseGo }))
    await settle()
    expect(router.state.location.search).toMatchObject({ tab: 'warehouse' })
  })

  it('names each missing piece when the API refuses OWN_DELIVERY_NOT_READY', async () => {
    ship.saveShipping.mockRejectedValue(new ApiError('OWN_DELIVERY_NOT_READY', 'x', { missing: ['rider', 'warehouse'] }))
    await show('shipping')
    const card = within(screen.getByRole('region', { name: w.title }))
    fireEvent.click(card.getByRole('switch', { name: w.switch }))
    fireEvent.click(card.getByRole('button', { name: w.save }))
    await settle()
    expect(card.getByRole('alert').textContent).toBe(`${w.notReady} ${w.rider} and ${w.warehouse}.`)
    expect((card.getByRole('switch', { name: w.switch }) as HTMLInputElement).checked).toBe(false)
  })

  it('is read-only for a store that can not change settings', async () => {
    await show('shipping', { readOnly: true })
    const card = within(screen.getByRole('region', { name: w.title }))
    expect((card.getByRole('radio', { name: new RegExp(w.placed) }) as HTMLInputElement).disabled).toBe(true)
    expect(card.queryByRole('button', { name: w.save })).toBeNull()
  })
})

describe('Warehouse › Own delivery from your locations', () => {
  it('lists only the store’s own locations, never a supplier’s', async () => {
    stock.loadPlaces.mockResolvedValue([...readyPlaces, place({ id: 'w9', name: 'Northwind depot', supplierId: 'sup-1', supplierName: 'Northwind' })])
    await show('warehouse')
    const section = within(screen.getByRole('region', { name: d.title }))
    expect(section.getByText('Workshop')).toBeTruthy()
    expect(section.queryByText('Northwind depot')).toBeNull()
    expect(screen.getAllByRole('switch')).toHaveLength(1)
  })

  it('shows nothing for a plan without own delivery', async () => {
    riders.loadRiderPlan.mockResolvedValue({ ownDelivery: false })
    await show('warehouse')
    expect(screen.queryByRole('region', { name: d.title })).toBeNull()
  })

  it('shows the saved area, rider distance and fee, and saves them as metres and minor units', async () => {
    await show('warehouse')
    expect((screen.getByLabelText(d.area) as HTMLInputElement).value).toBe('8')
    expect((screen.getByLabelText(d.rider) as HTMLInputElement).value).toBe('5')
    expect((screen.getByLabelText(feeLabel) as HTMLInputElement).value).toBe('2.50')
    fireEvent.change(screen.getByLabelText(d.area), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText(feeLabel), { target: { value: '3.75' } })
    fireEvent.click(screen.getByRole('button', { name: d.save }))
    await settle()
    expect(stock.savePlace).toHaveBeenCalledWith('w1', 2, expect.objectContaining({ name: 'Workshop', latitude: 12.9, longitude: 77.6, ownDelivery: true, deliveryRadiusM: 12_000, riderRadiusM: 5000, deliveryFeeAmount: '375' }))
  })

  it('refuses an area outside 1 to 50 km and a missing fee without calling the API', async () => {
    await show('warehouse')
    fireEvent.change(screen.getByLabelText(d.area), { target: { value: '60' } })
    fireEvent.change(screen.getByLabelText(feeLabel), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: d.save }))
    expect(screen.getByText(d.kmInvalid)).toBeTruthy()
    expect(screen.getByText(d.feeMissing)).toBeTruthy()
    expect(stock.savePlace).not.toHaveBeenCalled()
  })

  it('needs the map pin before a location can deliver', async () => {
    stock.loadPlaces.mockResolvedValue([place({ id: 'w2', name: 'Annex', latitude: null, longitude: null })])
    await show('warehouse')
    expect((screen.getByRole('switch') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(d.pinFirst)).toBeTruthy()
  })

  it('lets a delivering location whose pin was cleared be switched off', async () => {
    stock.loadPlaces.mockResolvedValue([place({ id: 'w1', name: 'Workshop', latitude: null, longitude: null, ownDelivery: true, deliveryRadiusM: 8000, riderRadiusM: 5000, deliveryFeeAmount: '250' })])
    await show('warehouse')
    const toggle = screen.getByRole('switch') as HTMLInputElement
    expect(toggle.checked).toBe(true)
    expect(toggle.disabled).toBe(false)
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: d.save }))
    await settle()
    expect(stock.savePlace.mock.calls[0]?.[2]).toMatchObject({ ownDelivery: false })
  })

  it('sends only “off” when a location is switched off', async () => {
    await show('warehouse')
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: d.save }))
    await settle()
    const input = stock.savePlace.mock.calls[0]?.[2] as Record<string, unknown>
    expect(input).toMatchObject({ ownDelivery: false })
    expect(input).not.toHaveProperty('deliveryRadiusM')
  })

  it('tells the owner when the area is refused', async () => {
    stock.savePlace.mockRejectedValue(new ApiError('DELIVERY_AREA_REQUIRED', 'x'))
    await show('warehouse')
    fireEvent.change(screen.getByLabelText(d.area), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: d.save }))
    await settle()
    expect(screen.getByText(d.refused.DELIVERY_AREA_REQUIRED)).toBeTruthy()
  })
})
