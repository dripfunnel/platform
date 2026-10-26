// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

afterEach(() => {
  cleanup()
  mapsLoader.current = frameMaps
})

/** A stand-in for Google: draws nothing, finds Pune and the address at a pin, and lets a test drag the pin. */
const fakeMaps = () => {
  const drag: { to: ((p: Pin) => void) | null } = { to: null }
  const maps: Maps = {
    draw: (_, __, ___, moved) => {
      drag.to = moved
      return { move: () => undefined }
    },
    find: vi.fn(async () => pune),
    close: vi.fn(),
    place: vi.fn(async () => ({ line1: 'Fashion Street, Camp', city: 'Pune', region: 'Maharashtra', postalCode: '411001', country: 'IN' })),
  }
  return { maps, drag, load: vi.fn(async () => maps) }
}

let saved: Pin | null | undefined
let typed: AddressDraft | undefined
const Fields = ({ pin = null }: { pin?: Pin | null }) => {
  const [value, setValue] = useState<AddressDraft>({ ...addressDraft(null, 'IN'), line1: '12 MG Road', city: 'Pune', pin })
  saved = value.pin
  typed = value
  return <AddressFields value={value} onChange={setValue} countries={['IN']} errors={{}} t={t} locale="en-US" />
}

const frame = 'https://hooks.dripfunnel.ai/maps/pin'
const show = (o: { mapFrame?: string | null; mode?: RenderMode; pin?: Pin | null } = {}) =>
  render(
    <StorefrontProvider value={{ client: createShopClient(), store: { ...store, mapFrame: o.mapFrame === undefined ? frame : o.mapFrame }, locale: 'en-US', mode: o.mode ?? 'live', poweredBy: null }}>
      <Fields pin={o.pin ?? null} />
    </StorefrontProvider>,
  )

const tap = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

describe('Pin on map', () => {
  it('is hidden without a map, and the address form is as it was', () => {
    show({ mapFrame: null })
    expect(screen.queryByRole('button', { name: 'Pin on map' })).toBeNull()
    expect(screen.getByLabelText('PIN code')).toBeTruthy()
  })

  it('asks Google for nothing until the shopper taps it, then opens at the address as typed', async () => {
    const { load, maps } = fakeMaps()
    mapsLoader.current = load
    show()
    expect(load).not.toHaveBeenCalled()
    await tap('Pin on map')
    expect(load).toHaveBeenCalledWith(`${frame}?language=en-US`, expect.any(HTMLElement), 'Pin your delivery address', expect.any(AbortSignal))
    expect(maps.find).toHaveBeenCalledWith('12 MG Road, Pune', 'IN')
    expect(screen.getByRole('dialog', { name: 'Pin your delivery address' })).toBeTruthy()
    expect(screen.getByText('Pin at 18.52040, 73.85670')).toBeTruthy()
  })

  it('moves the pin by dragging or by the arrow keys, saving it on Confirm with the map left open', async () => {
    const { load, drag, maps } = fakeMaps()
    mapsLoader.current = load
    show()
    await tap('Pin on map')
    act(() => drag.to?.({ latitude: 18.53, longitude: 73.85 }))
    fireEvent.keyDown(screen.getByRole('application'), { key: 'ArrowUp' })
    fireEvent.keyDown(screen.getByRole('application'), { key: 'ArrowRight', shiftKey: true })
    expect(screen.getByText('Pin at 18.53010, 73.85100')).toBeTruthy()
    await tap('Use this point')
    expect(maps.place).toHaveBeenCalledWith({ latitude: expect.closeTo(18.5301, 6), longitude: expect.closeTo(73.851, 6) })
    expect(screen.getByRole('dialog', { name: 'Pin your delivery address' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close the map' })).toBeTruthy()
    expect(saved?.latitude).toBeCloseTo(18.5301, 6)
    expect(saved?.longitude).toBeCloseTo(73.851, 6)
    expect(screen.getByText('Pinned on the map (Pin at 18.53010, 73.85100)')).toBeTruthy()
    await tap('Hide the map')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Move the pin' })).toBeTruthy()
  })

  it('fills the fields still empty from the address at the pin, never one the shopper typed', async () => {
    const { load } = fakeMaps()
    mapsLoader.current = load
    show()
    await tap('Pin on map')
    await tap('Use this point')
    expect(typed).toMatchObject({ line1: '12 MG Road', city: 'Pune', region: 'Maharashtra', postalCode: '411001', country: 'IN' })
    expect((screen.getByLabelText('PIN code') as HTMLInputElement).value).toBe('411001')
  })

  it('moves what the map filled to the new point when the pin moves, keeping what the shopper typed', async () => {
    const { load, drag, maps } = fakeMaps()
    mapsLoader.current = load
    show()
    await tap('Pin on map')
    await tap('Use this point')
    vi.mocked(maps.place).mockResolvedValue({ line1: 'Mhada Colony, Viman Nagar', city: 'Pune', region: 'Maharashtra', postalCode: '411014', country: 'IN' })
    act(() => drag.to?.({ latitude: 18.5679, longitude: 73.9143 }))
    await tap('Use this point')
    expect(typed).toMatchObject({ line1: '12 MG Road', city: 'Pune', region: 'Maharashtra', postalCode: '411014' })
    expect(saved).toEqual({ latitude: 18.5679, longitude: 73.9143 })
  })

  it('saves the pin even when Google can’t say what address is there', async () => {
    const { load, maps } = fakeMaps()
    vi.mocked(maps.place).mockRejectedValue(new Error('down'))
    mapsLoader.current = load
    show()
    await tap('Pin on map')
    await tap('Use this point')
    expect(saved).toEqual(pune)
    expect(typed).toMatchObject({ region: '', postalCode: '' })
  })

  it('leaves the address unpinned on Cancel or Escape', async () => {
    const { load } = fakeMaps()
    mapsLoader.current = load
    show()
    await tap('Pin on map')
    await tap('Cancel')
    expect(saved).toBeNull()
    await tap('Pin on map')
    fireEvent.keyDown(screen.getByRole('application'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(saved).toBeNull()
  })

  it('reopens a pinned address at its pin, and can take the pin off', async () => {
    const { load, maps } = fakeMaps()
    mapsLoader.current = load
    show({ pin: { latitude: 12.9716, longitude: 77.5946 } })
    await tap('Move the pin')
    expect(maps.find).not.toHaveBeenCalled()
    expect(screen.getByText('Pin at 12.97160, 77.59460')).toBeTruthy()
    await tap('Close the map')
    await tap('Remove the pin')
    expect(saved).toBeNull()
    expect(screen.getByRole('button', { name: 'Pin on map' })).toBeTruthy()
  })

  it('moves the pin to where the shopper is on Use my location, and says so when the browser won’t tell', async () => {
    const { load } = fakeMaps()
    mapsLoader.current = load
    const here = vi.fn((done: PositionCallback, failed: PositionErrorCallback) => (here.mock.calls.length === 1 ? done({ coords: { latitude: 18.5679, longitude: 73.9143 } } as GeolocationPosition) : failed({ code: 1 } as GeolocationPositionError)))
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: here }, configurable: true })
    show()
    await tap('Pin on map')
    await tap('Use my location')
    expect(screen.getByText('Pin at 18.56790, 73.91430')).toBeTruthy()
    await tap('Use my location')
    expect(screen.getByRole('alert').textContent).toBe('We couldn’t get your location. Check that your browser lets this shop use it, or move the pin yourself.')
    expect(screen.getByText('Pin at 18.56790, 73.91430')).toBeTruthy()
    Reflect.deleteProperty(navigator, 'geolocation')
  })

  it('offers no Use my location where the browser has no location', async () => {
    const { load } = fakeMaps()
    mapsLoader.current = load
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true })
    show()
    await tap('Pin on map')
    expect(screen.queryByRole('button', { name: 'Use my location' })).toBeNull()
    Reflect.deleteProperty(navigator, 'geolocation')
  })

  it('hides itself when Google fails to load, and the form works on', async () => {
    mapsLoader.current = vi.fn(async () => Promise.reject(new Error('blocked')))
    show()
    await tap('Pin on map')
    expect(screen.queryByRole('button', { name: 'Pin on map' })).toBeNull()
    expect(screen.getByLabelText('City')).toBeTruthy()
  })

  it('on a preview or in the studio frame, explains that pinning works on the live shop and asks Google for nothing', async () => {
    for (const mode of ['preview', 'studio'] as const) {
      const { load } = fakeMaps()
      mapsLoader.current = load
      show({ mode })
      await tap('Pin on map')
      expect(screen.getByRole('status').textContent).toBe('Pinning on a map works on the live shop, not on a preview.')
      expect(load).not.toHaveBeenCalled()
      cleanup()
    }
  })
})
