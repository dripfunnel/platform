import { useCallback, useEffect, useRef, useState } from 'react'

// The session contract on #46: read every 15 s and whenever the tab comes back into view.
export const sessionPollMs = 15_000

interface PageEvents {
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}

/**
 * Calls `refresh` now and every `intervalMs` while the page is visible, and again when it comes
 * back into view; a background tab doesn't ask. Returns the cleanup.
 */
export const pollWhileVisible = (refresh: () => void, intervalMs: number, { doc, win }: { doc: PageEvents & { visibilityState: string }; win: PageEvents }) => {
  refresh()
  const timer = setInterval(() => doc.visibilityState !== 'hidden' && refresh(), intervalMs)
  const onShown = () => doc.visibilityState === 'visible' && refresh()
  win.addEventListener('focus', onShown)
  doc.addEventListener('visibilitychange', onShown)
  return () => {
    clearInterval(timer)
    win.removeEventListener('focus', onShown)
    doc.removeEventListener('visibilitychange', onShown)
  }
}

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
  useEffect(() => (active ? pollWhileVisible(refresh, intervalMs, { doc: document, win: window }) : undefined), [active, intervalMs, refresh])

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
