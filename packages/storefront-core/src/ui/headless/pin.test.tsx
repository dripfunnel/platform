// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { store } from '../../../test/shop'
import type { AddressDraft, Pin } from '../../checkout/address'
import { addressDraft } from '../../checkout/checkout'
import { createShopClient } from '../../platform/api/client'
import { createI18n } from '../../platform/i18n/i18n'
import { StorefrontProvider, type RenderMode } from '../../platform/store/context'
import { AddressFields } from './form'
import { mapsLoader, type Maps } from './pin'
import { frameMaps } from './pinFrame'

const { t } = createI18n('en-US')
const pune = { latitude: 18.5204, longitude: 73.8567 }
const camp = { line1: 'Fashion Street, Camp', city: 'Pune', region: 'Maharashtra', postalCode: '411001', country: 'IN' }

afterEach(() => {
  cleanup()
  mapsLoader.current = frameMaps
})

const sleep = (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)))
const settle = () => sleep(0)
const typedWait = 300
const nudgedWait = 600

/** A stand-in for Google: draws nothing, finds Pune and the address at a pin, offers one place, and lets a test drag the pin. */
const fakeMaps = () => {
  const drag: { to: ((p: Pin) => void) | null } = { to: null }
  const maps: Maps = {
    draw: vi.fn((_, __, ___, moved: (p: Pin) => void) => {
      drag.to = moved
      return { move: () => undefined }
    }),
    find: vi.fn(async () => pune),
    close: vi.fn(),
    place: vi.fn(async () => camp),
    suggest: vi.fn(async () => [{ id: 'p1', main: 'Viman Nagar', secondary: 'Pune, Maharashtra' }]),
    select: vi.fn(async () => ({ latitude: 18.5679, longitude: 73.9143 })),
  }
  return { maps, drag, load: vi.fn(async () => maps) }
}

let saved: Pin | null | undefined
let typed: AddressDraft | undefined
const Fields = ({ pin = null, blank = false }: { pin?: Pin | null; blank?: boolean }) => {
  const [value, setValue] = useState<AddressDraft>({ ...addressDraft(null, 'IN'), name: 'Asha Rao', phone: '+91 98765 43210', ...(blank ? {} : { line1: '12 MG Road', line2: 'Near the temple', city: 'Pune' }), pin })
  saved = value.pin
  typed = value
  return <AddressFields value={value} onChange={setValue} countries={['IN', 'US']} errors={{}} t={t} locale="en-US" />
}

const frame = 'https://hooks.dripfunnel.ai/maps/pin'
const show = async (o: { mapFrame?: string | null; mode?: RenderMode; pin?: Pin | null; blank?: boolean } = {}) => {
  render(
    <StorefrontProvider value={{ client: createShopClient(), store: { ...store, mapFrame: o.mapFrame === undefined ? frame : o.mapFrame }, locale: 'en-US', mode: o.mode ?? 'live', poweredBy: null }}>
      <Fields pin={o.pin ?? null} blank={o.blank ?? false} />
    </StorefrontProvider>,
  )
  await settle()
}

const tap = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}
const search = () => screen.getByRole('combobox', { name: 'Search for your address' }) as HTMLInputElement
const typeIn = async (text: string) => {
  fireEvent.change(search(), { target: { value: text } })
  await sleep(typedWait)
}
const field = (label: string) => screen.getByLabelText(new RegExp(`^${label}( \\*)?$`)) as HTMLInputElement

describe('The map in the address form', () => {
  it('is hidden without a map, and the address form is as it was', async () => {
    await show({ mapFrame: null })
    expect(screen.queryByRole('combobox', { name: 'Search for your address' })).toBeNull()
    expect(screen.queryByRole('application')).toBeNull()
    expect(field('PIN code')).toBeTruthy()
  })

  it('opens with the form, with no button to press, at the address as typed, above the fields', async () => {
    const { load, maps } = fakeMaps()
    mapsLoader.current = load
    await show()
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith(`${frame}?language=en-US`, expect.any(HTMLElement), 'Pin your delivery address', expect.any(AbortSignal))
    expect(maps.find).toHaveBeenCalledWith('12 MG Road, Near the temple, Pune', 'IN')
    expect(maps.draw).toHaveBeenCalledWith(expect.any(HTMLElement), pune, 17, expect.any(Function))
    expect(screen.queryByRole('button', { name: /pin on map|use this point|hide the map|close the map/i })).toBeNull()
    expect(screen.getByText('Not pinned yet. Search for your address, or move the pin to your door.')).toBeTruthy()
    const before = (first: HTMLElement, second: HTMLElement) => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(before(search(), screen.getByRole('application'))).toBe(true)
    expect(before(screen.getByRole('application'), field('Country'))).toBe(true)
    expect(before(field('PIN code'), field('Country'))).toBe(true)
    expect(before(field('Country'), field('Phone for delivery'))).toBe(true)
  })

  it('saves no pin until it is set by hand, however the map was drawn', async () => {
    const { load } = fakeMaps()
    mapsLoader.current = load
    await show()
    expect(saved).toBeNull()
  })

  it('sets the pin at once where it is dropped, and fills the address there, replacing what was typed but never the name, phone or line 2', async () => {
    const { load, drag, maps } = fakeMaps()
    mapsLoader.current = load
    await show()
    act(() => drag.to?.({ latitude: 18.53, longitude: 73.85 }))
    expect(saved).toEqual({ latitude: 18.53, longitude: 73.85 })
    expect(screen.getByText('Pinned on the map (Pin at 18.53000, 73.85000)')).toBeTruthy()
    await settle()
    expect(maps.place).toHaveBeenCalledWith({ latitude: 18.53, longitude: 73.85 })
    expect(typed).toMatchObject({ ...camp, name: 'Asha Rao', phone: '+91 98765 43210', line2: 'Near the temple' })
    expect(field('PIN code').value).toBe('411001')
  })

  it('moves the pin at once by the arrow keys, and asks for the address once it has rested', async () => {
    const { load, maps } = fakeMaps()
    mapsLoader.current = load
    await show({ pin: { latitude: 18.52, longitude: 73.85 } })
    expect(maps.find).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('application'), { key: 'ArrowUp' })
    fireEvent.keyDown(screen.getByRole('application'), { key: 'ArrowRight', shiftKey: true })
    expect(screen.getByText('Pinned on the map (Pin at 18.52010, 73.85100)')).toBeTruthy()
    expect(maps.place).not.toHaveBeenCalled()
    await sleep(nudgedWait)
    expect(maps.place).toHaveBeenCalledTimes(1)
    expect(typed?.line1).toBe('Fashion Street, Camp')
    expect(saved?.latitude).toBeCloseTo(18.5201, 6)
    expect(saved?.longitude).toBeCloseTo(73.851, 6)
  })

  it('uses only the address of the pin’s last position when the answers arrive out of order', async () => {
    const { load, drag, maps } = fakeMaps()
    const slow: { done: ((p: typeof camp | null) => void) | null } = { done: null }
    vi.mocked(maps.place)
      .mockImplementationOnce(() => new Promise((resolve) => void (slow.done = resolve)))
      .mockResolvedValueOnce({ ...camp, line1: 'Second street' })
    mapsLoader.current = load
    await show()
    act(() => drag.to?.({ latitude: 1, longitude: 1 }))
    await settle()
    act(() => drag.to?.({ latitude: 2, longitude: 2 }))
    await settle()
    expect(typed?.line1).toBe('Second street')
    await act(async () => slow.done?.({ ...camp, line1: 'First street' }))
    expect(typed?.line1).toBe('Second street')
    expect(saved).toEqual({ latitude: 2, longitude: 2 })
  })

  it('saves the pin even when Google can’t say what address is there, and keeps what was typed', async () => {
    const { load, drag, maps } = fakeMaps()
    vi.mocked(maps.place).mockRejectedValue(new Error('down'))
    mapsLoader.current = load
    await show()
    act(() => drag.to?.({ latitude: 18.6, longitude: 73.9 }))
    await settle()
    expect(saved).toEqual({ latitude: 18.6, longitude: 73.9 })
    expect(typed).toMatchObject({ line1: '12 MG Road', city: 'Pune' })
  })

  it('fills nothing from a pin in a country the shop doesn’t sell to, though the pin is saved', async () => {
    const { load, drag, maps } = fakeMaps()
    vi.mocked(maps.place).mockResolvedValue({ ...camp, country: 'FR' })
    mapsLoader.current = load
    await show()
    act(() => drag.to?.({ latitude: 48.85, longitude: 2.35 }))
    await settle()
    expect(saved).toEqual({ latitude: 48.85, longitude: 2.35 })
    expect(typed).toMatchObject({ line1: '12 MG Road', country: 'IN' })
  })

  it('moves the pin to where the shopper is on Use my location, fills the address, and says so when the browser won’t tell', async () => {
    const { load, maps } = fakeMaps()
    mapsLoader.current = load
    const here = vi.fn((done: PositionCallback, failed: PositionErrorCallback) => (here.mock.calls.length === 1 ? done({ coords: { latitude: 18.5679, longitude: 73.9143 } } as GeolocationPosition) : failed({ code: 1 } as GeolocationPositionError)))
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: here }, configurable: true })
    await show()
    await tap('Use my location')
    expect(screen.getByText('Pinned on the map (Pin at 18.56790, 73.91430)')).toBeTruthy()
    expect(maps.draw).toHaveBeenLastCalledWith(expect.any(HTMLElement), { latitude: 18.5679, longitude: 73.9143 }, 17, expect.any(Function))
    expect(maps.place).toHaveBeenCalledWith({ latitude: 18.5679, longitude: 73.9143 })
    await tap('Use my location')
    expect(screen.getByRole('alert').textContent).toBe('We couldn’t get your location. Check that your browser lets this shop use it, or move the pin yourself.')
    expect(screen.getByText('Pinned on the map (Pin at 18.56790, 73.91430)')).toBeTruthy()
    Reflect.deleteProperty(navigator, 'geolocation')
  })

  it('offers no Use my location where the browser has no location', async () => {
    const { load } = fakeMaps()
    mapsLoader.current = load
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true })
    await show()
    expect(screen.queryByRole('button', { name: 'Use my location' })).toBeNull()
    Reflect.deleteProperty(navigator, 'geolocation')
  })

  it('hides the map and the search when Google fails to load, and the form works on', async () => {
    mapsLoader.current = vi.fn(async () => Promise.reject(new Error('blocked')))
    await show()
    expect(screen.queryByRole('combobox', { name: 'Search for your address' })).toBeNull()
    expect(screen.queryByRole('application')).toBeNull()
    expect(field('City')).toBeTruthy()
  })

  it('on a preview or in the studio frame, explains that pinning works on the live shop and asks Google for nothing', async () => {
    for (const mode of ['preview', 'studio'] as const) {
      const { load } = fakeMaps()
      mapsLoader.current = load
      await show({ mode })
      expect(screen.getByRole('status').textContent).toBe('Pinning on a map works on the live shop, not on a preview.')
      expect(screen.queryByRole('combobox', { name: 'Search for your address' })).toBeNull()
      expect(load).not.toHaveBeenCalled()
      cleanup()
    }
  })
})

describe('The map for a new address', () => {
  const here = (done: PositionCallback) => done({ coords: { latitude: 12.97, longitude: 77.59 } } as GeolocationPosition)
  const geolocate = (fn: unknown) => Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: fn }, configurable: true })
  afterEach(() => Reflect.deleteProperty(navigator, 'geolocation'))

  it('opens at its best guess, then moves to where the browser says the shopper is, without setting the pin', async () => {
    const { load, maps } = fakeMaps()
    mapsLoader.current = load
    geolocate(vi.fn(here))
    await show({ blank: true })
    expect(maps.draw).toHaveBeenNthCalledWith(1, expect.any(HTMLElement), pune, 17, expect.any(Function))
    expect(maps.draw).toHaveBeenNthCalledWith(2, expect.any(HTMLElement), { latitude: 12.97, longitude: 77.59 }, 17, expect.any(Function))
    expect(saved).toBeNull()
    expect(screen.getByText('Not pinned yet. Search for your address, or move the pin to your door.')).toBeTruthy()
  })

  it('keeps a saved pin or a typed address over the browser’s location, and asks the browser for nothing', async () => {
    const { load } = fakeMaps()
    mapsLoader.current = load
    const ask = vi.fn()
    geolocate(ask)
    await show({ pin: { latitude: 12.9716, longitude: 77.5946 }, blank: true })
    cleanup()
    await show()
    expect(ask).not.toHaveBeenCalled()
  })

  it('never moves over a pin the shopper has already set', async () => {
    const { load, maps, drag } = fakeMaps()
    mapsLoader.current = load
    const ask = vi.fn()
    geolocate(ask)
    await show({ blank: true })
    expect(ask).toHaveBeenCalledTimes(1)
    act(() => drag.to?.({ latitude: 5, longitude: 5 }))
    const answer = ask.mock.calls[0]?.[0] as PositionCallback
    answer({ coords: { latitude: 12.97, longitude: 77.59 } } as GeolocationPosition)
    expect(maps.draw).not.toHaveBeenCalledWith(expect.any(HTMLElement), { latitude: 12.97, longitude: 77.59 }, 17, expect.any(Function))
    expect(saved).toEqual({ latitude: 5, longitude: 5 })
  })

  it('never moves over an address the shopper types while the browser is still asking', async () => {
    const { load, maps } = fakeMaps()
    mapsLoader.current = load
    const ask = vi.fn()
    geolocate(ask)
    await show({ blank: true })
    fireEvent.change(field('Address'), { target: { value: '12 MG Road' } })
    fireEvent.change(field('City'), { target: { value: 'Pune' } })
    const answer = ask.mock.calls[0]?.[0] as PositionCallback
    answer({ coords: { latitude: 12.97, longitude: 77.59 } } as GeolocationPosition)
    expect(maps.draw).toHaveBeenCalledTimes(1)
    expect(saved).toBeNull()
  })

  it('stays where it started, with no message, when the browser won’t say where the shopper is', async () => {
    const { load, maps } = fakeMaps()
    mapsLoader.current = load
    geolocate(vi.fn((_: PositionCallback, failed: PositionErrorCallback) => failed({ code: 1 } as GeolocationPositionError)))
    await show({ blank: true })
    expect(maps.draw).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('The address search', () => {
  it('lists matching places after a pause in typing, within the form’s country', async () => {
    const { load, maps } = fakeMaps()
    mapsLoader.current = load
    await show()
    fireEvent.change(search(), { target: { value: 'vi' } })
    await sleep(typedWait)
    expect(maps.suggest).not.toHaveBeenCalled()
    fireEvent.change(search(), { target: { value: 'vim' } })
    fireEvent.change(search(), { target: { value: 'viman' } })
    await sleep(typedWait)
    expect(maps.suggest).toHaveBeenCalledTimes(1)
    expect(maps.suggest).toHaveBeenCalledWith('viman', 'IN')
    expect(within(screen.getByRole('listbox', { name: 'Matching places' })).getByRole('option').textContent).toContain('Viman Nagar')
    expect(search().getAttribute('aria-expanded')).toBe('true')
    expect(search().getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id)
  })

  it('moves the pin to a chosen place and fills the address, leaving the name, phone and line 2', async () => {
    const { load, maps } = fakeMaps()
    mapsLoader.current = load
    await show()
    await typeIn('viman')
    fireEvent.mouseDown(within(screen.getByRole('listbox')).getByRole('option'))
    await sleep(50)
    expect(maps.select).toHaveBeenCalledWith('p1')
    expect(maps.draw).toHaveBeenLastCalledWith(expect.any(HTMLElement), { latitude: 18.5679, longitude: 73.9143 }, 17, expect.any(Function))
    expect(screen.getByText('Pinned on the map (Pin at 18.56790, 73.91430)')).toBeTruthy()
    expect(maps.place).toHaveBeenCalledWith({ latitude: 18.5679, longitude: 73.9143 })
    expect(typed).toMatchObject({ ...camp, name: 'Asha Rao', phone: '+91 98765 43210', line2: 'Near the temple' })
    expect(search().value).toBe('Viman Nagar, Pune, Maharashtra')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('works by keyboard: arrows to a place, Enter to choose it, Escape to close the list', async () => {
    const { load, maps } = fakeMaps()
    vi.mocked(maps.suggest).mockResolvedValue([
      { id: 'p1', main: 'Viman Nagar', secondary: 'Pune' },
      { id: 'p2', main: 'Viman Nagar Road', secondary: 'Pune' },
    ])
    mapsLoader.current = load
    await show()
    await typeIn('viman')
    fireEvent.keyDown(search(), { key: 'ArrowDown' })
    fireEvent.keyDown(search(), { key: 'ArrowDown' })
    const second = within(screen.getByRole('listbox')).getAllByRole('option')[1]
    expect(second?.getAttribute('aria-selected')).toBe('true')
    expect(search().getAttribute('aria-activedescendant')).toBe(second?.id)
    fireEvent.keyDown(search(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    await typeIn('viman n')
    fireEvent.keyDown(search(), { key: 'ArrowUp' })
    fireEvent.keyDown(search(), { key: 'Enter' })
    await settle()
    expect(maps.select).toHaveBeenCalledWith('p2')
  })

  it('ignores a list that arrives after more was typed', async () => {
    const { load, maps } = fakeMaps()
    const late: { done: ((r: { id: string; main: string; secondary: string }[]) => void) | null } = { done: null }
    vi.mocked(maps.suggest)
      .mockImplementationOnce(() => new Promise((resolve) => void (late.done = resolve)))
      .mockResolvedValueOnce([{ id: 'p9', main: 'Newer match', secondary: '' }])
    mapsLoader.current = load
    await show()
    await typeIn('vim')
    await typeIn('viman')
    await act(async () => late.done?.([{ id: 'p0', main: 'Older match', secondary: '' }]))
    expect(within(screen.getByRole('listbox')).getByRole('option').textContent).toContain('Newer match')
  })

  it('says when nothing matches and when search can’t be used, and the map still works', async () => {
    const { load, maps, drag } = fakeMaps()
    vi.mocked(maps.suggest).mockResolvedValueOnce([]).mockResolvedValueOnce(null)
    mapsLoader.current = load
    await show()
    await typeIn('zzzzz')
    expect(screen.getByText('No place matches that. Try fewer words, or move the pin by hand.').getAttribute('role')).toBe('status')
    await typeIn('zzzzzz')
    expect(screen.getByText('Address search isn’t available right now. Move the pin, or type your address.')).toBeTruthy()
    act(() => drag.to?.({ latitude: 3, longitude: 3 }))
    await settle()
    expect(saved).toEqual({ latitude: 3, longitude: 3 })
  })

  it('says search can’t be used when the chosen place can’t be found, and leaves the pin as it was', async () => {
    const { load, maps } = fakeMaps()
    vi.mocked(maps.select).mockResolvedValue(null)
    mapsLoader.current = load
    await show({ pin: { latitude: 12.9716, longitude: 77.5946 } })
    await typeIn('viman')
    fireEvent.mouseDown(within(screen.getByRole('listbox')).getByRole('option'))
    await sleep(50)
    expect(screen.getByText('Address search isn’t available right now. Move the pin, or type your address.')).toBeTruthy()
    expect(saved).toEqual({ latitude: 12.9716, longitude: 77.5946 })
  })
})

describe('Required fields', () => {
  it('are marked for a screen reader, and the optional ones are not', async () => {
    await show({ mapFrame: null })
    for (const label of ['Full name', 'Address', 'City', 'State', 'PIN code']) expect(field(label).getAttribute('aria-required')).toBe('true')
    expect(field('Country').getAttribute('aria-required')).toBe('true')
    expect(field('Apartment, floor, landmark Optional').getAttribute('aria-required')).toBeNull()
  })
})
