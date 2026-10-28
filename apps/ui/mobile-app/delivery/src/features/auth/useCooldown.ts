import { useCallback, useEffect, useState } from 'react'

/** Whole seconds left of a wait that `start` begins; 0 once it is over or before it began. */
export function useCooldown() {
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (endsAt === null) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [endsAt])

  const left = endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - now) / 1000))
  return { left, start: useCallback((seconds: number) => setEndsAt(Date.now() + seconds * 1000), []) }
}
