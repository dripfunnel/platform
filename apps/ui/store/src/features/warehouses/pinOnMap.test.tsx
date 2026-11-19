// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Place } from '../../api/stock'
import { fill, messages } from '../../messages'
import type { FrameMap, Pin } from './mapFrame'

// The map in a location's form (#815, #1609): each state the cards name, with the frame stood in for.

const words = messages.warehouses
const frame = 'https://hooks.dripfunnel.ai/maps/pin'

const api = vi.hoisted(() => ({ loadPlaces: vi.fn(), savePlace: vi.fn(), makeDefaultPlace: vi.fn(), deletePlace: vi.fn(), loadMapFrame: vi.fn(), loadStoreCountry: vi.fn() }))
vi.mock('../../api/stock', async (actual) => ({ ...(await actual<typeof import('../../api/stock')>()), ...api }))

const { WarehousesView } = await import('./WarehousesView')
const { mapLoader } = await import('./PinOnMap')
const { frameMap } = await import('./mapFrame')

const place = (p: Partial<Place> & Pick<Place, 'id' | 'name'>): Place => ({ isDefault: false, units: 0, revision: 1, latitude: null, longitude: null, supplierId: null, supplierName: null, address: { line1: '12 Ring Road', line2: null, city: 'Pune', region: 'MH', postalCode: '411014', country: 'IN' }, ...p })

const sleep = (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)))
const settle = () => sleep(0)
const typedWait = 300
const nudgedWait = 600

const show = async (canEdit = true) => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => <WarehousesView canEdit={canEdit} side="merchant" /> }), history: createMemoryHistory({ initialEntries: ['/settings/warehouse'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
}

const viman = { latitude: 18.5679, longitude: 73.9143 }
const nagar = { line1: '5 Nagar Road, Viman Nagar', city: 'Pune', region: 'Maharashtra', postalCode: '411014', country: 'IN' }

/** A stand-in for the frame: finds Pune's Viman Nagar, names the address at any point, offers one place, and lets a test drag the pin. */
const fakeMap = () => {
  const drag: { to: ((p: Pin) => void) | null } = { to: null }
  const map: FrameMap = {
    draw: vi.fn((_, __, moved: (p: Pin) => void) => void (drag.to = moved)),
    move: vi.fn(),
    find: vi.fn(async () => viman),
    place: vi.fn(async () => nagar),
    suggest: vi.fn(async () => [{ id: 'p1', main: 'Viman Nagar', secondary: 'Pune, Maharashtra' }]),
    select: vi.fn(async () => ({ latitude: 18.57, longitude: 73.92 })),
    close: vi.fn(),
  }
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
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement
const search = () => screen.getByRole('combobox', { name: words.map.search }) as HTMLInputElement
const typeIn = async (text: string) => {
  fireEvent.change(search(), { target: { value: text } })
  await sleep(typedWait)
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

describe('The map in a location’s form', () => {
  it('opens with the form, with no button to press, and loads nothing on the list page', async () => {
    const { load, map } = fakeMap()
    mapLoader.current = load
    await show()
    expect(load).not.toHaveBeenCalled()
    await tap(words.add)
    fireEvent.change(field(words.form.name), { target: { value: 'Shed' } })
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith(`${frame}?language=en`, expect.any(HTMLElement), words.map.title, expect.any(AbortSignal))
    expect(map.draw).toHaveBeenCalledWith(viman, 17, expect.any(Function))
    expect(screen.queryByRole('button', { name: /pin on map|use this point|close the map/i })).toBeNull()
    expect(screen.getByText(words.map.unpinned)).toBeTruthy()
  })

  it('saves no pin until the pin is set by hand, however it was drawn', async () => {
    const { load } = fakeMap()
    mapLoader.current = load
    await show()
    await tap(words.add)
    for (const [label, value] of [[words.form.name, 'Shed'], [words.form.line1, '1 Main Road'], [words.form.city, 'Pune'], [words.form.region, 'MH'], [words.form.postalCode, '411014'], [words.form.country, 'IN']] as const) fireEvent.change(field(label), { target: { value } })
    await tap(words.form.saveAdd)
    expect(api.savePlace).toHaveBeenCalledWith(null, null, expect.objectContaining({ latitude: null, longitude: null }))
  })

  it('fills the address fields from the pin where it is dropped, leaves Address line 2, and saves both', async () => {
    const { load, drag, map } = fakeMap()
    mapLoader.current = load
    await show()
    await tap(words.add)
    fireEvent.change(field(words.form.name), { target: { value: 'Shed' } })
    fireEvent.change(field(words.form.line2), { target: { value: 'Unit 4' } })
    fireEvent.change(field(words.form.city), { target: { value: 'Mumbai' } })
    act(() => drag.to?.({ latitude: 18.57, longitude: 73.92 }))
    // The pin is set at once; the address follows when it is found.
    expect(screen.getByText(fill(words.map.pinned, { at: 'Pin at 18.57000, 73.92000' }))).toBeTruthy()
    await settle()
    expect(map.place).toHaveBeenCalledWith({ latitude: 18.57, longitude: 73.92 })
    expect(field(words.form.line1).value).toBe('5 Nagar Road, Viman Nagar')
    expect(field(words.form.city).value).toBe('Pune')
    expect(field(words.form.region).value).toBe('Maharashtra')
    expect(field(words.form.postalCode).value).toBe('411014')
    expect(field(words.form.country).value).toBe('IN')
    expect(field(words.form.line2).value).toBe('Unit 4')
    expect(field(words.form.name).value).toBe('Shed')
    await tap(words.form.saveAdd)
    expect(api.savePlace).toHaveBeenCalledWith(null, null, { name: 'Shed', address: { line1: '5 Nagar Road, Viman Nagar', line2: 'Unit 4', city: 'Pune', region: 'Maharashtra', postalCode: '411014', country: 'IN' }, latitude: 18.57, longitude: 73.92 })
  })

  it('keeps what was typed when no address is found at the pin, but still sets the pin', async () => {
    const { load, map, drag } = fakeMap()
    vi.mocked(map.place).mockResolvedValue(null)
    mapLoader.current = load
    await show()
    await edit('Godown')
    act(() => drag.to?.({ latitude: 18.6, longitude: 73.9 }))
    await settle()
    await tap(words.form.save)
    expect(api.savePlace).toHaveBeenCalledWith('w2', 1, expect.objectContaining({ address: expect.objectContaining({ line1: '12 Ring Road', postalCode: '411014' }), latitude: 18.6, longitude: 73.9 }))
  })

  it('uses only the address of the pin’s last position when answers arrive out of order', async () => {
    const { load, map, drag } = fakeMap()
    const slow: { done: ((a: typeof nagar | null) => void) | null } = { done: null }
    vi.mocked(map.place).mockImplementationOnce(() => new Promise((resolve) => void (slow.done = resolve))).mockResolvedValueOnce({ ...nagar, line1: 'Second street' })
    mapLoader.current = load
    await show()
    await edit('Godown')
    act(() => drag.to?.({ latitude: 1, longitude: 1 }))
    await settle()
    act(() => drag.to?.({ latitude: 2, longitude: 2 }))
    await settle()
    expect(field(words.form.line1).value).toBe('Second street')
    await act(async () => slow.done?.({ ...nagar, line1: 'First street' }))
    expect(field(words.form.line1).value).toBe('Second street')
    await tap(words.form.save)
    expect(api.savePlace).toHaveBeenCalledWith('w2', 1, expect.objectContaining({ latitude: 2, longitude: 2 }))
  })

  it('moves the pin at once by keyboard, and asks for the address once it has rested', async () => {
    const { load, map } = fakeMap()
    mapLoader.current = load
    await show()
    await edit('Godown')
    expect(map.find).not.toHaveBeenCalled()
    expect(map.draw).toHaveBeenCalledWith({ latitude: 18.52, longitude: 73.85 }, 17, expect.any(Function))
    const area = screen.getByRole('application', { name: words.map.title })
    fireEvent.keyDown(area, { key: 'ArrowUp' })
    fireEvent.keyDown(area, { key: 'ArrowRight', shiftKey: true })
    expect(screen.getByText(fill(words.map.pinned, { at: 'Pin at 18.52010, 73.85100' }))).toBeTruthy()
    expect(map.move).toHaveBeenLastCalledWith({ latitude: expect.closeTo(18.5201, 6), longitude: expect.closeTo(73.851, 6) })
    expect(map.place).not.toHaveBeenCalled()
    await sleep(nudgedWait)
    expect(map.place).toHaveBeenCalledTimes(1)
    expect(field(words.form.line1).value).toBe('5 Nagar Road, Viman Nagar')
  })

  it('does not move the pin when the address is typed in', async () => {
    const { load, map } = fakeMap()
    mapLoader.current = load
    await show()
    await edit('Godown')
    fireEvent.change(field(words.form.city), { target: { value: 'Mumbai' } })
    await sleep(typedWait)
    expect(map.find).not.toHaveBeenCalled()
    expect(map.move).not.toHaveBeenCalled()
    expect(map.place).not.toHaveBeenCalled()
  })

  it('can take a pin off, and saves the location without one', async () => {
    const { load } = fakeMap()
    mapLoader.current = load
    await show()
    await edit('Godown')
    await tap(words.map.remove)
    expect(screen.getByText(words.map.unpinned)).toBeTruthy()
    await tap(words.form.save)
    expect(api.savePlace).toHaveBeenCalledWith('w2', 1, expect.objectContaining({ latitude: null, longitude: null }))
  })

  it('starts a new location with no address at the default location’s country', async () => {
    const { load, map } = fakeMap()
    vi.mocked(map.find).mockResolvedValue({ latitude: 22.35, longitude: 78.67 })
    mapLoader.current = load
    await show()
    await tap(words.add)
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
    expect(map.find).toHaveBeenCalledWith('', 'IN')
    expect(map.draw).toHaveBeenCalledWith({ latitude: 22.35, longitude: 78.67 }, 17, expect.any(Function))
  })

  it('starts at the country’s middle when the address can’t be found, and at the world only when nothing names a place', async () => {
    const { load, map } = fakeMap()
    vi.mocked(map.find).mockImplementation(async (address) => (address ? null : { latitude: 22.35, longitude: 78.67 }))
    mapLoader.current = load
    await show()
    await edit('Workshop')
    expect(map.find).toHaveBeenNthCalledWith(1, '12 Ring Road, Pune, MH, 411014', 'IN')
    expect(map.find).toHaveBeenNthCalledWith(2, '', 'IN')
    expect(map.draw).toHaveBeenCalledWith({ latitude: 22.35, longitude: 78.67 }, 17, expect.any(Function))
    cleanup()

    const blank = fakeMap()
    mapLoader.current = blank.load
    api.loadPlaces.mockResolvedValue([place({ id: 'w1', name: 'Workshop', isDefault: true, address: null })])
    await show()
    await tap(words.add)
    expect(blank.map.find).not.toHaveBeenCalled()
    expect(blank.map.draw).toHaveBeenCalledWith({ latitude: 0, longitude: 0 }, 2, expect.any(Function))
  })

  it('moves the pin to where the browser says it is on Use my location, fills the address, and says so when it won’t tell', async () => {
    const { load, map } = fakeMap()
    mapLoader.current = load
    const here = vi.fn((done: PositionCallback, failed: PositionErrorCallback) => (here.mock.calls.length === 1 ? done({ coords: { latitude: 18.5204, longitude: 73.8567 } } as GeolocationPosition) : failed({ code: 1 } as GeolocationPositionError)))
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: here }, configurable: true })
    await show()
    await edit('Workshop')
    await tap(words.map.locate)
    expect(screen.getByText(fill(words.map.pinned, { at: 'Pin at 18.52040, 73.85670' }))).toBeTruthy()
    expect(map.draw).toHaveBeenLastCalledWith({ latitude: 18.5204, longitude: 73.8567 }, 17, expect.any(Function))
    expect(map.place).toHaveBeenCalledWith({ latitude: 18.5204, longitude: 73.8567 })
    await tap(words.map.locate)
    expect(screen.getByRole('alert').textContent).toBe(words.map.locateFailed)
    expect(screen.getByText(fill(words.map.pinned, { at: 'Pin at 18.52040, 73.85670' }))).toBeTruthy()
    Reflect.deleteProperty(navigator, 'geolocation')
  })

  it('puts the search and the map above the name and the address fields', async () => {
    const { load } = fakeMap()
    mapLoader.current = load
    await show()
    await tap(words.add)
    const before = (first: HTMLElement, second: HTMLElement) => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(before(search(), field(words.form.name))).toBe(true)
    expect(before(screen.getByRole('application', { name: words.map.title }), field(words.form.name))).toBe(true)
    expect(before(field(words.form.name), field(words.form.line1))).toBe(true)
  })

  it('moves a new location’s map to where the browser says the person is, once it is known', async () => {
    const { load, map } = fakeMap()
    mapLoader.current = load
    const here = vi.fn((done: PositionCallback) => done({ coords: { latitude: 12.97, longitude: 77.59 } } as GeolocationPosition))
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: here }, configurable: true })
    await show()
    await tap(words.add)
    expect(map.draw).toHaveBeenNthCalledWith(1, viman, 17, expect.any(Function))
    expect(map.draw).toHaveBeenNthCalledWith(2, { latitude: 12.97, longitude: 77.59 }, 17, expect.any(Function))
    // Where the map starts is not yet a pin: nothing is saved until it is set by hand.
    expect(screen.getByText(words.map.unpinned)).toBeTruthy()
    Reflect.deleteProperty(navigator, 'geolocation')
  })

  it('keeps a saved pin, a typed address or a country over the browser’s location, and a pin set by hand', async () => {
    const { load, map, drag } = fakeMap()
    mapLoader.current = load
    const here = vi.fn()
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: here }, configurable: true })
    await show()
    await edit('Godown')
    expect(here).not.toHaveBeenCalled()
    cleanup()
    await show()
    await edit('Workshop')
    expect(here).not.toHaveBeenCalled()
    cleanup()
    await show()
    await tap(words.add)
    expect(here).toHaveBeenCalledTimes(1)
    act(() => drag.to?.({ latitude: 5, longitude: 5 }))
    const answer = here.mock.calls[0]?.[0] as PositionCallback
    answer({ coords: { latitude: 12.97, longitude: 77.59 } } as GeolocationPosition)
    expect(map.draw).not.toHaveBeenCalledWith({ latitude: 12.97, longitude: 77.59 }, 17, expect.any(Function))
    Reflect.deleteProperty(navigator, 'geolocation')
  })

  it('stays where it started when the browser won’t say where the person is', async () => {
    const { load, map } = fakeMap()
    mapLoader.current = load
    const here = vi.fn((_: PositionCallback, failed: PositionErrorCallback) => failed({ code: 1 } as GeolocationPositionError))
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: here }, configurable: true })
    await show()
    await tap(words.add)
    expect(map.draw).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
    Reflect.deleteProperty(navigator, 'geolocation')
  })

  it('offers no Use my location where the browser has none', async () => {
    const { load } = fakeMap()
    mapLoader.current = load
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true })
    await show()
    await edit('Workshop')
    expect(screen.queryByRole('button', { name: words.map.locate })).toBeNull()
    Reflect.deleteProperty(navigator, 'geolocation')
  })

  it('offers no map and no address search without a Maps key, and the form saves as before', async () => {
    api.loadMapFrame.mockResolvedValue(null)
    await show()
    await edit('Workshop')
    expect(screen.queryByRole('combobox', { name: words.map.search })).toBeNull()
    expect(screen.queryByRole('application')).toBeNull()
    await tap(words.form.save)
    expect(api.savePlace).toHaveBeenCalledWith('w1', 1, expect.objectContaining({ latitude: null, longitude: null }))
  })

  it('hides the map and the address search once the map fails to load, and the form works on', async () => {
    mapLoader.current = vi.fn(async () => Promise.reject(new Error('blocked')))
    await show()
    await edit('Workshop')
    expect(screen.queryByRole('combobox', { name: words.map.search })).toBeNull()
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

describe('The address search, above the map in a location’s form', () => {
  it('lists matching places after a pause in typing, within the form’s country', async () => {
    const { load, map } = fakeMap()
    mapLoader.current = load
    await show()
    await edit('Workshop')
    fireEvent.change(search(), { target: { value: 'vi' } })
    await sleep(typedWait)
    expect(map.suggest).not.toHaveBeenCalled()
    fireEvent.change(search(), { target: { value: 'vim' } })
    fireEvent.change(search(), { target: { value: 'viman' } })
    await sleep(typedWait)
    expect(map.suggest).toHaveBeenCalledTimes(1)
    expect(map.suggest).toHaveBeenCalledWith('viman', 'IN')
    const list = screen.getByRole('listbox', { name: words.map.suggestions })
    expect(within(list).getByRole('option').textContent).toContain('Viman Nagar')
    expect(search().getAttribute('aria-expanded')).toBe('true')
  })

  it('moves the pin to a chosen place and fills the address, without moving the form’s other fields', async () => {
    const { load, map } = fakeMap()
    mapLoader.current = load
    await show()
    await tap(words.add)
    fireEvent.change(field(words.form.name), { target: { value: 'Shed' } })
    await typeIn('viman')
    fireEvent.mouseDown(screen.getByRole('option'))
    await settle()
    expect(map.select).toHaveBeenCalledWith('p1')
    expect(map.draw).toHaveBeenLastCalledWith({ latitude: 18.57, longitude: 73.92 }, 17, expect.any(Function))
    expect(screen.getByText(fill(words.map.pinned, { at: 'Pin at 18.57000, 73.92000' }))).toBeTruthy()
    expect(map.place).toHaveBeenCalledWith({ latitude: 18.57, longitude: 73.92 })
    expect(field(words.form.line1).value).toBe('5 Nagar Road, Viman Nagar')
    expect(field(words.form.name).value).toBe('Shed')
    expect(search().value).toBe('Viman Nagar, Pune, Maharashtra')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('works by keyboard: arrows to a place, Enter to choose it, Escape to close the list', async () => {
    const { load, map } = fakeMap()
    vi.mocked(map.suggest).mockResolvedValue([
      { id: 'p1', main: 'Viman Nagar', secondary: 'Pune' },
      { id: 'p2', main: 'Viman Nagar Road', secondary: 'Pune' },
    ])
    mapLoader.current = load
    await show()
    await edit('Workshop')
    await typeIn('viman')
    fireEvent.keyDown(search(), { key: 'ArrowDown' })
    fireEvent.keyDown(search(), { key: 'ArrowDown' })
    const second = screen.getAllByRole('option')[1]
    expect(second?.getAttribute('aria-selected')).toBe('true')
    expect(search().getAttribute('aria-activedescendant')).toBe(second?.id)
    fireEvent.keyDown(search(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    await typeIn('viman n')
    fireEvent.keyDown(search(), { key: 'ArrowUp' })
    fireEvent.keyDown(search(), { key: 'Enter' })
    await settle()
    expect(map.select).toHaveBeenCalledWith('p2')
  })

  it('ignores a list that arrives after more was typed', async () => {
    const { load, map } = fakeMap()
    const late: { done: ((r: { id: string; main: string; secondary: string }[]) => void) | null } = { done: null }
    vi.mocked(map.suggest).mockImplementationOnce(() => new Promise((resolve) => void (late.done = resolve))).mockResolvedValueOnce([{ id: 'p9', main: 'Newer match', secondary: '' }])
    mapLoader.current = load
    await show()
    await edit('Workshop')
    await typeIn('vim')
    await typeIn('viman')
    await act(async () => late.done?.([{ id: 'p0', main: 'Older match', secondary: '' }]))
    expect(screen.getByRole('option').textContent).toContain('Newer match')
  })

  it('says when nothing matches, and when search can’t be used, and the map still works', async () => {
    const { load, map, drag } = fakeMap()
    vi.mocked(map.suggest).mockResolvedValueOnce([]).mockResolvedValueOnce(null)
    mapLoader.current = load
    await show()
    await edit('Workshop')
    await typeIn('zzzzz')
    expect(screen.getByText(words.map.searchNone).getAttribute('role')).toBe('status')
    await typeIn('zzzzzz')
    expect(screen.getByText(words.map.searchUnavailable)).toBeTruthy()
    act(() => drag.to?.({ latitude: 3, longitude: 3 }))
    await settle()
    await tap(words.form.save)
    expect(api.savePlace).toHaveBeenCalledWith('w1', 1, expect.objectContaining({ latitude: 3, longitude: 3 }))
  })

  it('says search can’t be used when the chosen place can’t be found, and leaves the pin', async () => {
    const { load, map } = fakeMap()
    vi.mocked(map.select).mockResolvedValue(null)
    mapLoader.current = load
    await show()
    await edit('Godown')
    await typeIn('viman')
    fireEvent.mouseDown(screen.getByRole('option'))
    await settle()
    expect(screen.getByText(words.map.searchUnavailable)).toBeTruthy()
    expect(screen.getByText(fill(words.map.pinned, { at: 'Pin at 18.52000, 73.85000' }))).toBeTruthy()
  })
})
