// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Place } from '../../api/stock'
import { fill, messages } from '../../messages'
import type { FrameMap, Pin } from './mapFrame'

// "Pin on map" on a location (#815): each state the card names, with the frame stood in for.

const words = messages.warehouses
const frame = 'https://hooks.dripfunnel.com/maps/pin'

const api = vi.hoisted(() => ({ loadPlaces: vi.fn(), savePlace: vi.fn(), makeDefaultPlace: vi.fn(), deletePlace: vi.fn(), loadMapFrame: vi.fn(), loadStoreCountry: vi.fn() }))
vi.mock('../../api/stock', async (actual) => ({ ...(await actual<typeof import('../../api/stock')>()), ...api }))

const { WarehousesView } = await import('./WarehousesView')
const { mapLoader } = await import('./PinOnMap')
const { frameMap } = await import('./mapFrame')

const place = (p: Partial<Place> & Pick<Place, 'id' | 'name'>): Place => ({ isDefault: false, units: 0, revision: 1, latitude: null, longitude: null, supplierId: null, supplierName: null, address: { line1: '12 Ring Road', line2: null, city: 'Pune', region: 'MH', postalCode: '411014', country: 'IN' }, ...p })

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

const show = async (canEdit = true) => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => <WarehousesView canEdit={canEdit} side="merchant" /> }), history: createMemoryHistory({ initialEntries: ['/settings/warehouse'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
}

/** A stand-in for the frame: finds Pune's Viman Nagar, names the address at any point, and lets a test drag the pin. */
const fakeMap = () => {
  const drag: { to: ((p: Pin) => void) | null } = { to: null }
  const map: FrameMap = { draw: vi.fn((_, __, moved: (p: Pin) => void) => void (drag.to = moved)), move: vi.fn(), find: vi.fn(async () => ({ latitude: 18.5679, longitude: 73.9143 })), place: vi.fn(async () => ({ line1: '5 Nagar Road, Viman Nagar', city: 'Pune', region: 'Maharashtra', postalCode: '411014', country: 'IN' })), close: vi.fn() }
  return { map, drag, load: vi.fn(async () => map) }
}

const edit = async (name: string) => {
  fireEvent.click(screen.getByRole('button', { name: fill(words.manage, { name }) }))
  const dialog = within(document.querySelector('dialog') as HTMLElement)
  fireEvent.change(dialog.getByRole('combobox'), { target: { value: 'edit' } })
  fireEvent.click(dialog.getByRole('button', { name: messages.editor.apply }))
  await settle()
}
const tap = async (name: string) => {
  fireEvent.click(screen.getByRole('button', { name }))
  await settle()
}

beforeEach(() => {
  api.loadPlaces.mockResolvedValue([place({ id: 'w1', name: 'Workshop', isDefault: true }), place({ id: 'w2', name: 'Godown', latitude: 18.52, longitude: 73.85 })])
  api.loadMapFrame.mockResolvedValue(frame)
  api.loadStoreCountry.mockResolvedValue(null)
  api.savePlace.mockImplementation(async (id: string | null) => id ?? 'w3')
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  mapLoader.current = frameMap
})

describe('Pin on map, on a location', () => {
  it('asks for no map until it is opened, then pins a new location by dragging and saves the pin with the address found there', async () => {
    const { load, drag, map } = fakeMap()
    mapLoader.current = load
    await show()
    await tap(words.add)
    fireEvent.change(screen.getByLabelText(words.form.name), { target: { value: 'Shed' } })
    fireEvent.change(screen.getByLabelText(words.form.city), { target: { value: 'Pune' } })
    expect(load).not.toHaveBeenCalled()
    await tap(words.map.open)
    expect(load).toHaveBeenCalledWith(`${frame}?language=en`, expect.any(HTMLElement), words.map.title, expect.any(AbortSignal))
    expect(map.find).toHaveBeenCalledWith('Pune', '')
    expect(screen.getByText('Pin at 18.56790, 73.91430')).toBeTruthy()
    act(() => drag.to?.({ latitude: 18.57, longitude: 73.92 }))
    await tap(words.map.confirm)
    expect(screen.getByText(fill(words.map.pinned, { at: 'Pin at 18.57000, 73.92000' }))).toBeTruthy()
    expect(map.place).toHaveBeenCalledWith({ latitude: 18.57, longitude: 73.92 })
    expect(map.close).toHaveBeenCalled()
    expect((screen.getByLabelText(words.form.line1) as HTMLInputElement).value).toBe('5 Nagar Road, Viman Nagar')
    await tap(words.form.saveAdd)
    expect(api.savePlace).toHaveBeenCalledWith(null, null, { name: 'Shed', address: { line1: '5 Nagar Road, Viman Nagar', city: 'Pune', region: 'Maharashtra', postalCode: '411014', country: 'IN' }, latitude: 18.57, longitude: 73.92 })
  })

  it('reopens a pinned location at its pin, moves it by keyboard, and can take it off', async () => {
    const { load, map } = fakeMap()
    mapLoader.current = load
    await show()
    expect(screen.getByText(/Pin at 18\.52000, 73\.85000/)).toBeTruthy()
    await edit('Godown')
    await tap(words.map.move)
    expect(map.find).not.toHaveBeenCalled()
    expect(map.draw).toHaveBeenCalledWith({ latitude: 18.52, longitude: 73.85 }, 17, expect.any(Function))
    const area = screen.getByRole('application', { name: words.map.title })
    fireEvent.keyDown(area, { key: 'ArrowUp' })
    fireEvent.keyDown(area, { key: 'ArrowRight', shiftKey: true })
    expect(screen.getByText('Pin at 18.52010, 73.85100')).toBeTruthy()
    expect(map.move).toHaveBeenLastCalledWith({ latitude: expect.closeTo(18.5201, 6), longitude: expect.closeTo(73.851, 6) })
    // Esc closes without changing the pin.
    fireEvent.keyDown(area, { key: 'Escape' })
    expect(screen.queryByRole('application')).toBeNull()
    expect(screen.getByText(fill(words.map.pinned, { at: 'Pin at 18.52000, 73.85000' }))).toBeTruthy()
    await tap(words.map.remove)
    await tap(words.form.save)
    expect(api.savePlace).toHaveBeenCalledWith('w2', 1, expect.objectContaining({ latitude: null, longitude: null }))
  })

  it('keeps the typed address when nothing is found at the pin', async () => {
    const { load, map, drag } = fakeMap()
    vi.mocked(map.place).mockResolvedValue(null)
    mapLoader.current = load
    await show()
    await edit('Godown')
    await tap(words.map.move)
    act(() => drag.to?.({ latitude: 18.6, longitude: 73.9 }))
    await tap(words.map.confirm)
    await tap(words.form.save)
    expect(api.savePlace).toHaveBeenCalledWith('w2', 1, expect.objectContaining({ address: expect.objectContaining({ line1: '12 Ring Road', postalCode: '411014' }), latitude: 18.6, longitude: 73.9 }))
  })

  it('leaves the pin as it was on Cancel', async () => {
    const { load, drag } = fakeMap()
    mapLoader.current = load
    await show()
    await edit('Godown')
    await tap(words.map.move)
    act(() => drag.to?.({ latitude: 1, longitude: 1 }))
    await tap(words.map.cancel)
    await tap(words.form.save)
    expect(api.savePlace).toHaveBeenCalledWith('w2', 1, expect.objectContaining({ latitude: 18.52, longitude: 73.85 }))
  })

  it('starts a new location with no address at the default location’s country', async () => {
    const { load, map } = fakeMap()
    vi.mocked(map.find).mockResolvedValue({ latitude: 22.35, longitude: 78.67 })
    mapLoader.current = load
    await show()
    await tap(words.add)
    await tap(words.map.open)
    expect(map.find).toHaveBeenCalledTimes(1)
    expect(map.find).toHaveBeenCalledWith('', 'IN')
    expect(map.draw).toHaveBeenCalledWith({ latitude: 22.35, longitude: 78.67 }, 17, expect.any(Function))
  })

  it('starts a new location at the store’s country when the default location has no address either', async () => {
    const { load, map } = fakeMap()
    vi.mocked(map.find).mockResolvedValue({ latitude: 22.35, longitude: 78.67 })
    mapLoader.current = load
    api.loadPlaces.mockResolvedValue([place({ id: 'w1', name: 'Main location', isDefault: true, address: null })])
    api.loadStoreCountry.mockResolvedValue('IN')
    await show()
    await tap(words.add)
    await tap(words.map.open)
    expect(map.find).toHaveBeenCalledWith('', 'IN')
    expect(map.draw).toHaveBeenCalledWith({ latitude: 22.35, longitude: 78.67 }, 17, expect.any(Function))
  })

  it('starts at the country’s middle when the address can’t be found, and at the world only when nothing names a place', async () => {
    const { load, map } = fakeMap()
    vi.mocked(map.find).mockImplementation(async (address) => (address ? null : { latitude: 22.35, longitude: 78.67 }))
    mapLoader.current = load
    await show()
    await edit('Workshop')
    await tap(words.map.open)
    expect(map.find).toHaveBeenNthCalledWith(1, '12 Ring Road, Pune, MH, 411014', 'IN')
    expect(map.find).toHaveBeenNthCalledWith(2, '', 'IN')
    expect(map.draw).toHaveBeenCalledWith({ latitude: 22.35, longitude: 78.67 }, 17, expect.any(Function))
    await tap(words.map.cancel)
    cleanup()

    const blank = fakeMap()
    mapLoader.current = blank.load
    api.loadPlaces.mockResolvedValue([place({ id: 'w1', name: 'Workshop', isDefault: true, address: null })])
    await show()
    await tap(words.add)
    await tap(words.map.open)
    expect(blank.map.find).not.toHaveBeenCalled()
    expect(blank.map.draw).toHaveBeenCalledWith({ latitude: 0, longitude: 0 }, 2, expect.any(Function))
  })

  it('moves the pin to where the browser says it is on Use my location, and says so when it won’t tell', async () => {
    const { load, map } = fakeMap()
    mapLoader.current = load
    const here = vi.fn((done: PositionCallback, failed: PositionErrorCallback) => (here.mock.calls.length === 1 ? done({ coords: { latitude: 18.5204, longitude: 73.8567 } } as GeolocationPosition) : failed({ code: 1 } as GeolocationPositionError)))
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: here }, configurable: true })
    await show()
    await edit('Workshop')
    await tap(words.map.open)
    await tap(words.map.locate)
    expect(screen.getByText('Pin at 18.52040, 73.85670')).toBeTruthy()
    expect(map.draw).toHaveBeenLastCalledWith({ latitude: 18.5204, longitude: 73.8567 }, 17, expect.any(Function))
    await tap(words.map.locate)
    expect(screen.getByRole('alert').textContent).toBe(words.map.locateFailed)
    expect(screen.getByText('Pin at 18.52040, 73.85670')).toBeTruthy()
    Reflect.deleteProperty(navigator, 'geolocation')
  })

  it('offers no Use my location where the browser has none', async () => {
    const { load } = fakeMap()
    mapLoader.current = load
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true })
    await show()
    await edit('Workshop')
    await tap(words.map.open)
    expect(screen.queryByRole('button', { name: words.map.locate })).toBeNull()
    Reflect.deleteProperty(navigator, 'geolocation')
  })

  it('offers no map without a Maps key, and the form saves as before', async () => {
    api.loadMapFrame.mockResolvedValue(null)
    await show()
    await edit('Workshop')
    expect(screen.queryByRole('button', { name: words.map.open })).toBeNull()
    await tap(words.form.save)
    expect(api.savePlace).toHaveBeenCalledWith('w1', 1, expect.objectContaining({ latitude: null, longitude: null }))
  })

  it('hides the map once it fails to load, and the form works on', async () => {
    mapLoader.current = vi.fn(async () => Promise.reject(new Error('blocked')))
    await show()
    await edit('Workshop')
    await tap(words.map.open)
    expect(screen.queryByRole('button', { name: words.map.open })).toBeNull()
    expect(screen.getByLabelText(words.form.city)).toBeTruthy()
    await tap(words.form.save)
    expect(api.savePlace).toHaveBeenCalled()
  })

  it('shows a read-only seat the saved pin, and never asks where the map is', async () => {
    await show(false)
    expect(screen.getByText(/Godown/)).toBeTruthy()
    expect(screen.getByText(/Pin at 18\.52000, 73\.85000/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: fill(words.manage, { name: 'Godown' }) })).toBeNull()
    expect(api.loadMapFrame).not.toHaveBeenCalled()
  })
})
