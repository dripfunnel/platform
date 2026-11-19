import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { fill, locale, messages } from '../../messages'
import { frameMap, type FoundAddress, type FrameLoader, type FrameMap, type Pin, type Suggestion } from './mapFrame'

const words = messages.warehouses.map

/** Which map the control loads; tests give their own. */
export const mapLoader: { current: FrameLoader } = { current: frameMap }

// One arrow-key press moves the pin about 11 m; with Shift, about 110 m.
const step = 0.0001
const keyed: Record<string, [number, number]> = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
const clamp = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value))
const coordinate = new Intl.NumberFormat(locale, { minimumFractionDigits: 5, maximumFractionDigits: 5 })

// Typing waits for a pause before asking for places; the keyboard waits for the pin to rest before asking for its address.
const typedWaitMs = 250
const nudgedWaitMs = 500
const shortestSearch = 3

/** "Pin at 18.52040, 73.85670": the pin as text, for the list, the form and screen readers. */
export const pinText = (p: Pin) => fill(words.at, { latitude: coordinate.format(p.latitude), longitude: coordinate.format(p.longitude) })

type Phase = 'loading' | 'open' | 'failed'
type Search = 'idle' | 'none' | 'unavailable'

type Inputs = { source: string | null; value: Pin | null; onChange: (pin: Pin | null, found?: FoundAddress | null) => void; address: string; country: string; near: string }

/**
 * The location form's map (#815, #1609): it loads with the form, in #814's frame on the hooks host, and is unavailable without
 * a frame or once the map fails, so the form works as before. The pin and the address follow each other from the map:
 * dropping the pin fills the address fields, and choosing a place found in the search box above the map moves the pin.
 */
export const usePlaceMap = ({ source, value, onChange, address, country, near }: Inputs) => {
  const [phase, setPhase] = useState<Phase>('loading')
  const [map, setMap] = useState<FrameMap | null>(null)
  const [at, setAt] = useState<Pin | null>(null)
  const [locating, setLocating] = useState<'idle' | 'busy' | 'failed'>('idle')
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<Suggestion[]>([])
  const [active, setActive] = useState(-1)
  const [search, setSearch] = useState<Search>('idle')
  const area = useRef<HTMLDivElement>(null)
  const latest = useRef({ onChange, value, address, country, near })
  const touched = useRef(false)
  const addressTurn = useRef(0)
  const addressTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const typedTurn = useRef(0)
  const typedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    latest.current = { onChange, value, address, country, near }
  })

  useEffect(() => {
    if (!source || !area.current) return
    const stop = new AbortController()
    const framed = new URL(source)
    framed.searchParams.set('language', locale)
    mapLoader.current(framed.toString(), area.current, words.title, stop.signal).then(
      (loaded) => {
        setMap(loaded)
        setPhase('open')
      },
      () => {
        if (!stop.signal.aborted) setPhase('failed')
      },
    )
    return () => stop.abort()
  }, [source])

  useEffect(() => (map ? () => map.close() : undefined), [map])
  useEffect(
    () => () => {
      addressTurn.current += 1
      typedTurn.current += 1
      clearTimeout(addressTimer.current)
      clearTimeout(typedTimer.current)
    },
    [],
  )

  /** The pin is set at once; the address there is asked for after `wait`, and used only if the pin hasn't moved since (#1609). */
  const pinAt = (pin: Pin, wait: number) => {
    touched.current = true
    setAt(pin)
    latest.current.onChange(pin)
    const mine = ++addressTurn.current
    clearTimeout(addressTimer.current)
    addressTimer.current = setTimeout(async () => {
      const found = (await map?.place(pin)) ?? null
      if (mine === addressTurn.current && found) latest.current.onChange(pin, found)
    }, wait)
  }
  const dropped = (to: Pin) => pinAt(to, 0)

  useEffect(() => {
    if (phase !== 'open' || !map) return
    let gone = false
    void (async () => {
      const now = latest.current
      // The pin, else the address, else its country's (or the default location's) middle; the world only when nothing names a place.
      const start = now.value ?? (now.address || now.country ? await map.find(now.address, now.country) : null) ?? (now.country || now.near ? await map.find('', now.country || now.near) : null)
      if (gone) return
      const first = start ?? { latitude: 0, longitude: 0 }
      setAt(first)
      map.draw(first, start ? 17 : 2, dropped)
      // A new location with nothing to go on opens at the map's best guess, then moves to where the browser says the person is, unless they have already moved the pin.
      if (now.value || now.address || now.country || !navigator.geolocation) return
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          if (gone || touched.current || latest.current.value) return
          const here = { latitude: coords.latitude, longitude: coords.longitude }
          setAt(here)
          map.draw(here, 17, dropped)
        },
        () => undefined,
        { timeout: 10_000, maximumAge: 60_000 },
      )
    })()
    return () => {
      gone = true
    }
    // Drawn once, from the pin or the address as it was when the form opened (#1609); the pin is saved only once it is set by hand.
  }, [phase, map])

  const showAt = (pin: Pin) => {
    setAt(pin)
    map?.draw(pin, 17, dropped)
    pinAt(pin, 0)
  }
  // The browser's own location, asked for only when the button is pressed; no Google request.
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
    map?.move(next)
    pinAt(next, nudgedWaitMs)
  }
  const remove = () => {
    addressTurn.current += 1
    clearTimeout(addressTimer.current)
    onChange(null)
  }

  /** What the search box now says: places matching it are asked for after a pause in typing. */
  const typed = (text: string) => {
    setQuery(text)
    setActive(-1)
    clearTimeout(typedTimer.current)
    const mine = ++typedTurn.current
    if (!map || text.trim().length < shortestSearch) {
      setOptions([])
      setSearch('idle')
      return
    }
    typedTimer.current = setTimeout(async () => {
      const inCountry = /^[A-Z]{2}$/.test(latest.current.country) ? latest.current.country : ''
      const found = await map.suggest(text.trim(), inCountry)
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
    const found = (await map?.select(option.id)) ?? null
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

  return { available: Boolean(source) && phase !== 'failed', phase, area, value, locating, geolocation, locate, nudge, remove, query, options, active, search, typed, choose, searchKey }
}

export type PlaceMap = ReturnType<typeof usePlaceMap>

/** The search box and the map, above the name and the address fields, with the pin's own controls. */
export const PinOnMap = ({ pinMap }: { pinMap: PlaceMap }) => {
  const id = useId()
  const { available, phase, area, value, locating, geolocation, query, options, active, search } = pinMap
  if (!available) return null
  return (
    <div className="df-places-pin">
      <div className="df-places-field df-places-search">
        <label htmlFor={`${id}-search`}>{words.search}</label>
        <input
          id={`${id}-search`}
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={options.length > 0}
          aria-controls={`${id}-options`}
          aria-activedescendant={active >= 0 ? `${id}-option-${active}` : undefined}
          placeholder={words.searchPlaceholder}
          maxLength={200}
          disabled={phase !== 'open'}
          value={query}
          onChange={(e) => pinMap.typed(e.target.value)}
          onKeyDown={pinMap.searchKey}
        />
        {options.length > 0 && (
          <ul id={`${id}-options`} role="listbox" aria-label={words.suggestions} className="df-places-options">
            {options.map((o, i) => (
              <li
                key={o.id}
                id={`${id}-option-${i}`}
                role="option"
                aria-selected={i === active}
                className="df-places-option"
                onMouseDown={(e) => {
                  e.preventDefault()
                  void pinMap.choose(o)
                }}
              >
                <strong>{o.main}</strong> {o.secondary && <span>{o.secondary}</span>}
              </li>
            ))}
          </ul>
        )}
        {search !== 'idle' && (
          <p className="df-places-hint" role="status">
            {search === 'none' ? words.searchNone : words.searchUnavailable}
          </p>
        )}
      </div>
      <div className="df-places-map">
        <p className="df-places-hint" id={`${id}-help`}>
          {words.help}
        </p>
        <div ref={area} className="df-places-map-area" tabIndex={0} role="application" aria-label={words.title} aria-describedby={`${id}-help ${id}-at`} onKeyDown={pinMap.nudge} />
        {phase === 'loading' && (
          <p className="df-places-hint" role="status">
            {words.loading}
          </p>
        )}
        {locating === 'failed' && (
          <p className="df-places-problem" role="alert">
            {words.locateFailed}
          </p>
        )}
        <div className="df-places-pin-row">
          {geolocation && (
            <button type="button" className="df-button" disabled={phase !== 'open' || locating === 'busy'} aria-busy={locating === 'busy'} onClick={pinMap.locate}>
              {locating === 'busy' ? words.locating : words.locate}
            </button>
          )}
          {value && (
            <button type="button" className="df-places-link" onClick={pinMap.remove}>
              {words.remove}
            </button>
          )}
        </div>
        <p id={`${id}-at`} className="df-places-hint" aria-live="polite">
          {value ? fill(words.pinned, { at: pinText(value) }) : words.unpinned}
        </p>
      </div>
    </div>
  )
}
