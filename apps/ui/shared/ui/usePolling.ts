import { useCallback, useEffect, useRef, useState } from 'react'

// The session contract on #46: read every 15 s and whenever the tab comes back into view.
export const sessionPollMs = 15_000

// Polls `load` while it is set, drops answers that arrive after a newer one, and refreshes on focus.
export const usePolling = <Value,>(load: (() => Promise<Value>) | null, intervalMs: number = sessionPollMs) => {
  const [value, setValue] = useState<Value | null>(null)
  const latest = useRef(0)
  const loadRef = useRef(load)
  loadRef.current = load

  const refresh = useCallback(() => {
    const current = loadRef.current
    if (!current) return
    const ask = ++latest.current
    current().then(
      (next) => ask === latest.current && setValue(() => next),
      () => undefined,
    )
  }, [])

  const active = load !== null
  useEffect(() => {
    if (!active) return
    refresh()
    // A tab in the background doesn't ask; it catches up when it is shown again (below).
    const timer = setInterval(() => document.visibilityState !== 'hidden' && refresh(), intervalMs)
    const onFocus = () => document.visibilityState === 'visible' && refresh()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [active, intervalMs, refresh])

  return { value, refresh }
}

// The time, ticking, so a countdown moves between polls.
export const useNow = (intervalMs = 1000): number => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
