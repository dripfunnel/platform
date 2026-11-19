import { useCallback, useEffect, useState } from 'react'

/** Seconds left until something may be asked again, from `initial`; `restart` starts it over, from `from` or the seconds given. */
export const useCountdown = (from: number, initial: number = from): [number, (seconds?: number) => void] => {
  const [left, setLeft] = useState(initial)
  useEffect(() => {
    if (left <= 0) return undefined
    const timer = setTimeout(() => setLeft(left - 1), 1000)
    return () => clearTimeout(timer)
  }, [left])
  const restart = useCallback((seconds: number = from) => setLeft(seconds), [from])
  return [left, restart]
}
