'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { Pin, Place } from '../../checkout/address'
import type { Translate } from '../../platform/i18n/i18n'
import { useOptionalStorefront } from '../../platform/store/context'
import { frameMaps } from './pinFrame'

// "Pin on map" (#814; storefront ARCHITECTURE §2.1 `ui/headless`): the map loads only once the shopper asks, in a frame of
// its own (pinFrame.ts), so Google never runs under the store's CSP (§3.5).

/** A map drawn in an element, with a draggable pin. */
export type DrawnMap = { move: (to: Pin) => void }

export type Maps = {
  draw: (element: HTMLElement, at: Pin, zoom: number, moved: (to: Pin) => void) => DrawnMap
  /** The point an address names; null when it can't be found. */
  find: (address: string, country: string) => Promise<Pin | null>
  /** What address is at a point; null when Google can't say. */
  place: (at: Pin) => Promise<Place | null>
  close: () => void
}

/** Loads the map from `source` into `element`; rejects when it can't, or once `signal` aborts. */
export type MapsLoader = (source: string, element: HTMLElement, title: string, signal: AbortSignal) => Promise<Maps>

/** Which Maps the control uses; tests give their own. */
export const mapsLoader: { current: MapsLoader } = { current: frameMaps }

// One arrow-key press moves the pin about 11 m; with Shift, about 110 m.
const step = 0.0001
const clamp = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value))
const keyed: Record<string, [number, number]> = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
const placeWaitMs = 5000
const within = <T,>(ms: number, work: Promise<T>): Promise<T | null> => Promise.race([work.catch(() => null), new Promise<null>((done) => setTimeout(() => done(null), ms))])
const same = (a: Pin | null, b: Pin | null) => a?.latitude === b?.latitude && a?.longitude === b?.longitude

type Phase = 'closed' | 'loading' | 'open' | 'failed' | 'liveOnly'

export type PinOnMapProps = {
  value: Pin | null
  /** With the address at the pin when it was confirmed, for the form to fill what is still empty. */
  onChange: (pin: Pin | null, place?: Place | null) => void
  /** The address as typed, one line, for where the map starts. */
  address: string
  country: string
  t: Translate
  locale: string
  className?: string | undefined
}

/** "Pin on map": hidden without a map or once it fails, so the address form works as it did; never asks Google on a preview. */
export const PinOnMap = ({ value, onChange, address, country, t, locale, className }: PinOnMapProps) => {
  const storefront = useOptionalStorefront()
  const source = storefront?.store.mapFrame ?? null
  const mode = storefront?.mode ?? 'live'
  const id = useId()
  const [phase, setPhase] = useState<Phase>('closed')
  const [maps, setMaps] = useState<Maps | null>(null)
  const [draft, setDraft] = useState<Pin | null>(null)
  const [finding, setFinding] = useState(false)
  const [locating, setLocating] = useState<'idle' | 'busy' | 'failed'>('idle')
  const area = useRef<HTMLDivElement>(null)
  const drawn = useRef<DrawnMap | null>(null)
  const opener = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (phase !== 'loading' || !source || !area.current) return
    const stop = new AbortController()
    const framed = new URL(source)
    framed.searchParams.set('language', locale)
    mapsLoader.current(framed.toString(), area.current, t('address.map.title'), stop.signal).then(
      (loaded) => {
        setMaps(loaded)
        setPhase('open')
      },
      () => {
        if (!stop.signal.aborted) setPhase('failed')
      },
    )
    return () => stop.abort()
  }, [phase, source, t, locale])

  useEffect(() => (maps ? () => maps.close() : undefined), [maps])

  useEffect(() => {
    if (phase !== 'open' || !maps || !area.current) return
    const element = area.current
    let gone = false
    void (async () => {
      const start = value ?? (await maps.find(address, country)) ?? (await maps.find('', country))
      if (gone) return
      const at = start ?? { latitude: 0, longitude: 0 }
      setDraft(at)
      drawn.current = maps.draw(element, at, value || start ? 17 : 2, setDraft)
      element.focus()
    })()
    return () => {
      gone = true
      drawn.current = null
    }
    // Drawn once per opening, from the address as it was when the shopper asked.
  }, [phase, maps])

  if (!source || phase === 'failed') return null

  const open = () => setPhase(mode === 'live' ? 'loading' : 'liveOnly')
  const close = () => {
    setMaps(null)
    setPhase('closed')
    setDraft(null)
    setLocating('idle')
    opener.current?.focus()
  }
  // The browser's own location, asked for only when the shopper presses the button; no Google request.
  const geolocation = typeof navigator === 'undefined' ? undefined : navigator.geolocation
  const locate = () => {
    if (!geolocation) return
    setLocating('busy')
    geolocation.getCurrentPosition(
      ({ coords }) => {
        const here = { latitude: coords.latitude, longitude: coords.longitude }
        setLocating('idle')
        setDraft(here)
        drawn.current?.move(here)
      },
      () => setLocating('failed'),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  }
  const confirm = async (pin: Pin) => {
    setFinding(true)
    const place = maps ? await within(placeWaitMs, maps.place(pin)) : null
    setFinding(false)
    onChange(pin, place)
  }
  const nudge = (e: KeyboardEvent<HTMLDivElement>) => {
    const by = keyed[e.key]
    if (!by || !draft) return
    e.preventDefault()
    const far = e.shiftKey ? 10 : 1
    const next = { latitude: clamp(draft.latitude + by[0] * step * far, 90), longitude: clamp(draft.longitude + by[1] * step * far, 180) }
    setDraft(next)
    drawn.current?.move(next)
  }
  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: 5, maximumFractionDigits: 5 })
  const at = (p: Pin) => t('address.map.at', { latitude: number.format(p.latitude), longitude: number.format(p.longitude) })

  return (
    <div className={className}>
      <button ref={opener} type="button" aria-expanded={phase === 'open' || phase === 'loading'} aria-controls={phase === 'open' ? id : undefined} disabled={phase === 'loading'} onClick={phase === 'open' ? close : open}>
        {phase === 'open' ? t('address.map.hide') : value ? t('address.map.move') : t('address.map.open')}
      </button>
      {value ? (
        <>
          <small>
            {t('address.map.pinned')} ({at(value)})
          </small>
          <button type="button" onClick={() => onChange(null)}>
            {t('address.map.remove')}
          </button>
        </>
      ) : null}
      {phase === 'liveOnly' ? <small role="status">{t('address.map.liveOnly')}</small> : null}
      {phase === 'loading' ? <small role="status">{t('address.map.loading')}</small> : null}
      {phase === 'open' || phase === 'loading' ? (
        <div id={id} role="dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`} onKeyDown={(e) => (e.key === 'Escape' ? close() : undefined)}>
          <p id={`${id}-title`}>{t('address.map.title')}</p>
          <p id={`${id}-help`}>{t('address.map.help')}</p>
          {/* Sized here: the map's frame fills it. */}
          <div ref={area} tabIndex={0} role="application" aria-label={t('address.map.title')} aria-describedby={`${id}-at`} onKeyDown={nudge} style={{ height: '18rem' }} />
          {geolocation ? (
            <div>
              <button type="button" disabled={!draft || locating === 'busy'} aria-busy={locating === 'busy'} onClick={locate}>
                {t('address.map.locate')}
              </button>
            </div>
          ) : null}
          {locating === 'busy' ? <small role="status">{t('address.map.locating')}</small> : null}
          {locating === 'failed' ? <small role="alert">{t('address.map.locateFailed')}</small> : null}
          <p id={`${id}-at`} aria-live="polite">
            {draft ? at(draft) : t('address.map.loading')}
          </p>
          {finding ? <small role="status">{t('address.map.finding')}</small> : null}
          <button type="button" disabled={!draft || finding} aria-busy={finding} onClick={() => (draft ? void confirm(draft) : undefined)}>
            {t('address.map.confirm')}
          </button>
          <button type="button" onClick={close}>
            {draft && same(draft, value) ? t('address.map.close') : t('address.map.cancel')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
