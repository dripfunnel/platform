'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { Pin, Place } from '../../checkout/address'
import type { Translate } from '../../platform/i18n/i18n'
import { useOptionalStorefront } from '../../platform/store/context'
import { frameMaps } from './pinFrame'

// "Pin on map" (#814, #1615; storefront ARCHITECTURE §2.1 `ui/headless`): the map and an address search load with the
// address form, in a frame of its own (pinFrame.ts), so Google never runs under the store's CSP (§3.5).

/** A map drawn in an element, with a draggable pin. */
export type DrawnMap = { move: (to: Pin) => void }

/** One line of the search's list: the place's name, and where it is. */
export type Suggestion = { id: string; main: string; secondary: string }

export type Maps = {
  /** Draws the map and its pin; drawn again, it recentres the same map. */
  draw: (element: HTMLElement, at: Pin, zoom: number, moved: (to: Pin) => void) => DrawnMap
  /** The point an address names; null when it can't be found. */
  find: (address: string, country: string) => Promise<Pin | null>
  /** What address is at a point; null when Google can't say. */
  place: (at: Pin) => Promise<Place | null>
  /** Places matching what was typed, best first; null when search is unavailable or fails. */
  suggest: (text: string, country: string) => Promise<Suggestion[] | null>
  /** The point of one of the last suggestions; null when it can't be found. */
  select: (id: string) => Promise<Pin | null>
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
// Typing waits for a pause before asking for places; the keyboard waits for the pin to rest before asking for its address.
const typedWaitMs = 250
const nudgedWaitMs = 500
const shortestSearch = 3
const within = <T,>(ms: number, work: Promise<T>): Promise<T | null> => Promise.race([work.catch(() => null), new Promise<null>((done) => setTimeout(() => done(null), ms))])

type Phase = 'loading' | 'open' | 'failed' | 'liveOnly'
type Search = 'idle' | 'none' | 'unavailable'

// Core's own look, in the sealed parts' tokens, adopted once as a stylesheet (the CSP allows no inline <style>). `:where()` gives
// it no specificity, so a theme's rule for a `df-pin-*` class always wins.
const css = `:where(.df-pin-search){position:relative}
:where(.df-pin-options){position:absolute;z-index:20;top:100%;left:0;right:0;max-height:17.5rem;overflow-y:auto;margin:0;padding:0;list-style:none;background:var(--df-sealed-surface,#fff);color:var(--df-sealed-color,#1d1b18);border:1px solid var(--df-sealed-muted,currentColor)}
:where(.df-pin-option){padding:.5rem .75rem;cursor:pointer}
:where(.df-pin-option[aria-selected=true]){background:var(--df-sealed-accent,currentColor);color:var(--df-sealed-on-accent,#fff)}
:where(.df-pin-map){border-radius:var(--df-sealed-radius,8px);overflow:hidden}
:where(.df-pin-button){font:inherit;padding:.5rem 1rem;margin:.5rem 0;cursor:pointer;background:var(--df-sealed-surface,#fff);color:var(--df-sealed-color,#1d1b18);border:1px solid var(--df-sealed-muted,currentColor);border-radius:var(--df-sealed-radius,8px)}
:where(.df-pin-status){position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}`
let sheet: CSSStyleSheet | null = null
const style = () => {
  if (sheet || typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in document)) return
  sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
}

export type PinOnMapProps = {
  value: Pin | null
  /** The pin, set at once, and again with the address at it once that is known, for the form to fill. */
  onChange: (pin: Pin | null, place?: Place | null) => void
  /** The address lines as typed, one line, for where the map starts; empty while there is nothing to go on. */
  address: string
  country: string
  t: Translate
  locale: string
  className?: string | undefined
}

/**
 * The address form's map: an address search, then the map, shown with the form. Hidden without a map or once it fails, so the
 * address form works as it did; never asks Google on a preview. Choosing a place, dropping the pin or moving it fills the address.
 */
export const PinOnMap = ({ value, onChange, address, country, t, locale, className }: PinOnMapProps) => {
  const storefront = useOptionalStorefront()
  useEffect(style, [])
  const source = storefront?.store.mapFrame ?? null
  const mode = storefront?.mode ?? 'live'
  const id = useId()
  const [phase, setPhase] = useState<Phase>(mode === 'live' ? 'loading' : 'liveOnly')
  const [maps, setMaps] = useState<Maps | null>(null)
  const [at, setAt] = useState<Pin | null>(null)
  const [locating, setLocating] = useState<'idle' | 'busy' | 'failed'>('idle')
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<Suggestion[]>([])
  const [active, setActive] = useState(-1)
  const [search, setSearch] = useState<Search>('idle')
  const area = useRef<HTMLDivElement>(null)
  const drawn = useRef<{ element: HTMLElement } | null>(null)
  const latest = useRef({ onChange, value, address, country })
  const touched = useRef(false)
  const addressTurn = useRef(0)
  const addressTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const typedTurn = useRef(0)
  const typedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    latest.current = { onChange, value, address, country }
  })

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
  useEffect(
    () => () => {
      addressTurn.current += 1
      typedTurn.current += 1
      clearTimeout(addressTimer.current)
      clearTimeout(typedTimer.current)
    },
    [],
  )

  /** The pin is set at once; the address there is asked for after `wait`, and used only if the pin hasn't moved since. */
  const pinAt = (pin: Pin, wait: number) => {
    touched.current = true
    setAt(pin)
    latest.current.onChange(pin)
    const mine = ++addressTurn.current
    clearTimeout(addressTimer.current)
    addressTimer.current = setTimeout(async () => {
      const place = maps ? await within(placeWaitMs, maps.place(pin)) : null
      if (mine === addressTurn.current && place) latest.current.onChange(pin, place)
    }, wait)
  }
  const dropped = (to: Pin) => pinAt(to, 0)

  useEffect(() => {
    if (phase !== 'open' || !maps || !area.current) return
    const element = area.current
    let gone = false
    void (async () => {
      const now = latest.current
      const start = now.value ?? (await maps.find(now.address, now.country)) ?? (await maps.find('', now.country))
      if (gone) return
      const first = start ?? { latitude: 0, longitude: 0 }
      setAt(first)
      drawn.current = { element }
      maps.draw(element, first, now.value || start ? 17 : 2, dropped)
      // A new address with nothing to go on opens at the map's best guess, then moves to where the browser says the shopper is,
      // unless they have already set the pin.
      if (now.value || now.address || !navigator.geolocation) return
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          if (gone || touched.current || latest.current.value) return
          const here = { latitude: coords.latitude, longitude: coords.longitude }
          setAt(here)
          maps.draw(element, here, 17, dropped)
        },
        () => undefined,
        { timeout: 10_000, maximumAge: 60_000 },
      )
    })()
    return () => {
      gone = true
      drawn.current = null
    }
    // Drawn once, from the pin or the address as it was when the form opened; the pin is saved only once it is set by hand.
  }, [phase, maps])

  if (!source || phase === 'failed') return null

  const showAt = (pin: Pin) => {
    const element = drawn.current?.element
    setAt(pin)
    if (maps && element) maps.draw(element, pin, 17, dropped)
    pinAt(pin, 0)
  }
  // The browser's own location, asked for when the shopper presses the button (or once, for a new address); no Google request.
  const geolocation = typeof navigator === 'undefined' ? undefined : navigator.geolocation
  const locate = () => {
    if (!geolocation) return
    setLocating('busy')
    geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating('idle')
        showAt({ latitude: coords.latitude, longitude: coords.longitude })
      },
      () => setLocating('failed'),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  }
  const nudge = (e: KeyboardEvent<HTMLDivElement>) => {
    const by = keyed[e.key]
    if (!by || !at) return
    e.preventDefault()
    const far = e.shiftKey ? 10 : 1
    const next = { latitude: clamp(at.latitude + by[0] * step * far, 90), longitude: clamp(at.longitude + by[1] * step * far, 180) }
    const element = drawn.current?.element
    if (maps && element) maps.draw(element, next, 17, dropped)
    pinAt(next, nudgedWaitMs)
  }

  const typed = (text: string) => {
    setQuery(text)
    setActive(-1)
    clearTimeout(typedTimer.current)
    const mine = ++typedTurn.current
    if (!maps || text.trim().length < shortestSearch) {
      setOptions([])
      setSearch('idle')
      return
    }
    typedTimer.current = setTimeout(async () => {
      const inCountry = /^[A-Z]{2}$/.test(latest.current.country) ? latest.current.country : ''
      const found = await maps.suggest(text.trim(), inCountry)
      if (mine !== typedTurn.current) return
      setOptions(found ?? [])
      setSearch(found === null ? 'unavailable' : found.length === 0 ? 'none' : 'idle')
    }, typedWaitMs)
  }
  const choose = async (option: Suggestion) => {
    typedTurn.current += 1
    setOptions([])
    setActive(-1)
    setQuery(option.secondary ? `${option.main}, ${option.secondary}` : option.main)
    const found = (await maps?.select(option.id)) ?? null
    if (found) showAt(found)
    else setSearch('unavailable')
  }
  const searchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (options.length === 0) return
      e.preventDefault()
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % options.length : (i <= 0 ? options.length : i) - 1))
    } else if (e.key === 'Enter') {
      const option = options[active]
      if (!option) return
      e.preventDefault()
      void choose(option)
    } else if (e.key === 'Escape' && options.length > 0) {
      e.preventDefault()
      setOptions([])
      setActive(-1)
    }
  }
  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: 5, maximumFractionDigits: 5 })
  const where = (p: Pin) => t('address.map.at', { latitude: number.format(p.latitude), longitude: number.format(p.longitude) })

  if (phase === 'liveOnly') {
    return (
      <div className={className}>
        <small role="status">{t('address.map.liveOnly')}</small>
      </div>
    )
  }

  return (
    <div>
      <span className={['df-pin-search', className].filter(Boolean).join(' ')}>
        <label htmlFor={`${id}-search`}>{t('address.map.search')}</label>
        <input
          id={`${id}-search`}
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={options.length > 0}
          aria-controls={options.length > 0 ? `${id}-options` : undefined}
          aria-activedescendant={active >= 0 ? `${id}-option-${active}` : undefined}
          placeholder={t('address.map.searchPlaceholder')}
          maxLength={200}
          disabled={phase !== 'open'}
          value={query}
          onChange={(e) => typed(e.target.value)}
          onKeyDown={searchKey}
        />
        {options.length > 0 ? (
          <ul id={`${id}-options`} role="listbox" aria-label={t('address.map.suggestions')} className="df-pin-options">
            {options.map((o, i) => (
              <li
                key={o.id}
                id={`${id}-option-${i}`}
                role="option"
                aria-selected={i === active}
                className="df-pin-option"
                onMouseDown={(e) => {
                  e.preventDefault()
                  void choose(o)
                }}
              >
                <strong>{o.main}</strong> {o.secondary ? <span>{o.secondary}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {search !== 'idle' ? <small role="status">{search === 'none' ? t('address.map.searchNone') : t('address.map.searchUnavailable')}</small> : null}
      </span>
      <div role="group" aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`}>
        <p id={`${id}-title`}>{t('address.map.title')}</p>
        <p id={`${id}-help`}>{t('address.map.help')}</p>
        {/* Sized here: the map's frame fills it. */}
        <div ref={area} tabIndex={0} role="application" aria-label={t('address.map.title')} aria-describedby={`${id}-at`} onKeyDown={nudge} className="df-pin-map" style={{ height: '18rem' }} />
        {phase === 'loading' ? <small role="status">{t('address.map.loading')}</small> : null}
        {geolocation ? (
          <div>
            <button type="button" className="df-pin-button" disabled={phase !== 'open' || locating === 'busy'} aria-busy={locating === 'busy'} onClick={locate}>
              {locating === 'busy' ? t('address.map.locating') : t('address.map.locate')}
            </button>
          </div>
        ) : null}
        {locating === 'failed' ? <small role="alert">{t('address.map.locateFailed')}</small> : null}
        <p id={`${id}-at`} aria-live="polite" className="df-pin-status">
          {value ? `${t('address.map.pinned')} (${where(value)})` : t('address.map.unpinned')}
        </p>
      </div>
    </div>
  )
}
