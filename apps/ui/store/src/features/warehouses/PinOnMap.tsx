import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { fill, locale, messages } from '../../messages'
import { frameMap, type FoundAddress, type FrameLoader, type FrameMap, type Pin } from './mapFrame'

const words = messages.warehouses.map

/** Which map the control loads; tests give their own. */
export const mapLoader: { current: FrameLoader } = { current: frameMap }

// One arrow-key press moves the pin about 11 m; with Shift, about 110 m.
const step = 0.0001
const keyed: Record<string, [number, number]> = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
const clamp = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value))
const coordinate = new Intl.NumberFormat(locale, { minimumFractionDigits: 5, maximumFractionDigits: 5 })

/** "Pin at 18.52040, 73.85670": the pin as text, for the list, the form and screen readers. */
export const pinText = (p: Pin) => fill(words.at, { latitude: coordinate.format(p.latitude), longitude: coordinate.format(p.longitude) })

type Phase = 'closed' | 'loading' | 'open' | 'failed'

/**
 * "Pin on map" in the location form (#815): the map loads only when it's opened, in #814's frame on the hooks host, and the
 * control hides itself without a frame or once the map fails, so the form works as before.
 */
export const PinOnMap = ({ source, value, onChange, address, country, near }: { source: string | null; value: Pin | null; onChange: (pin: Pin | null, found?: FoundAddress | null) => void; address: string; country: string; near: string }) => {
  const id = useId()
  const [phase, setPhase] = useState<Phase>('closed')
  const [confirming, setConfirming] = useState(false)
  const [map, setMap] = useState<FrameMap | null>(null)
  const [draft, setDraft] = useState<Pin | null>(null)
  const [locating, setLocating] = useState<'idle' | 'busy' | 'failed'>('idle')
  const area = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (phase !== 'loading' || !source || !area.current) return
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
  }, [phase, source])

  useEffect(() => (map ? () => map.close() : undefined), [map])

  useEffect(() => {
    if (phase !== 'open' || !map) return
    let gone = false
    void (async () => {
      // The pin, else the address, else its country's (or the default location's) middle; the world only when nothing names a place.
      const start = value ?? (address || country ? await map.find(address, country) : null) ?? (country || near ? await map.find('', country || near) : null)
      if (gone) return
      const at = start ?? { latitude: 0, longitude: 0 }
      setDraft(at)
      map.draw(at, start ? 17 : 2, setDraft)
      area.current?.focus()
    })()
    return () => {
      gone = true
    }
    // Drawn once per opening, from the pin or the address as it was when the map was opened.
  }, [phase, map])

  if (!source || phase === 'failed') return null

  const close = () => {
    setMap(null)
    setDraft(null)
    setLocating('idle')
    setConfirming(false)
    setPhase('closed')
    opener.current?.focus()
  }
  // The browser's own location, asked for only when the button is pressed; no Google request.
  const geolocation = typeof navigator === 'undefined' ? undefined : navigator.geolocation
  const locate = () => {
    if (!geolocation) return
    setLocating('busy')
    geolocation.getCurrentPosition(
      ({ coords }) => {
        const here = { latitude: coords.latitude, longitude: coords.longitude }
        setLocating('idle')
        setDraft(here)
        // Drawn afresh at street level: a move would keep the world view the map may have opened on.
        map?.draw(here, 17, setDraft)
      },
      () => setLocating('failed'),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  }
  const nudge = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') return close()
    const by = keyed[e.key]
    if (!by || !draft) return
    e.preventDefault()
    const far = e.shiftKey ? 10 : 1
    const next = { latitude: clamp(draft.latitude + by[0] * step * far, 90), longitude: clamp(draft.longitude + by[1] * step * far, 180) }
    setDraft(next)
    map?.move(next)
  }

  return (
    <div className="df-places-pin">
      <div className="df-places-pin-row">
        <button ref={opener} type="button" className="df-button" aria-expanded={phase !== 'closed'} aria-controls={phase === 'open' ? id : undefined} disabled={phase === 'loading'} onClick={phase === 'closed' ? () => setPhase('loading') : close}>
          {value ? words.move : words.open}
        </button>
        {value && phase === 'closed' && (
          <button type="button" className="df-places-link" onClick={() => onChange(null)}>
            {words.remove}
          </button>
        )}
      </div>
      {value && <p className="df-places-hint">{fill(words.pinned, { at: pinText(value) })}</p>}
      {phase === 'loading' && (
        <p className="df-places-hint" role="status">
          {words.loading}
        </p>
      )}
      {phase !== 'closed' && (
        <div id={id} className="df-places-map" role="group" aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`}>
          <p id={`${id}-title`} className="df-places-map-title">
            {words.title}
          </p>
          <p id={`${id}-help`} className="df-places-hint">
            {words.help}
          </p>
          <div ref={area} className="df-places-map-area" tabIndex={0} role="application" aria-label={words.title} aria-describedby={`${id}-at`} onKeyDown={nudge} />
          {geolocation && (
            <div>
              <button type="button" className="df-button" disabled={!draft || locating === 'busy'} aria-busy={locating === 'busy'} onClick={locate}>
                {words.locate}
              </button>
            </div>
          )}
          {locating === 'busy' && (
            <p className="df-places-hint" role="status">
              {words.locating}
            </p>
          )}
          {locating === 'failed' && (
            <p className="df-places-problem" role="alert">
              {words.locateFailed}
            </p>
          )}
          <p id={`${id}-at`} className="df-places-hint" aria-live="polite">
            {draft ? pinText(draft) : words.loading}
          </p>
          <div className="df-places-actions">
            <button type="button" className="df-button" onClick={close}>
              {words.cancel}
            </button>
            <button
              type="button"
              className="df-button df-button--primary"
              disabled={!draft || confirming}
              aria-busy={confirming}
              onClick={async () => {
                if (!draft) return close()
                setConfirming(true)
                // The address at the pin replaces the typed one (decided on #815); none found leaves it as typed.
                const found = map ? await map.place(draft) : null
                onChange(draft, found)
                close()
              }}
            >
              {words.confirm}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
