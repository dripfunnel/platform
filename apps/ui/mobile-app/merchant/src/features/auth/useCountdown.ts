import { useCallback, useEffect, useState } from 'react'

/** Seconds left until something may be asked again (a texted code is asked again after 30 s); `restart` starts it over. */
export const useCountdown = (from: number): [number, () => void] => {
  const [left, setLeft] = useState(from)
  useEffect(() => {
    if (left <= 0) return undefined
    const timer = setTimeout(() => setLeft(left - 1), 1000)
    return () => clearTimeout(timer)
  }, [left])
  const restart = useCallback(() => setLeft(from), [from])
  return [left, restart]
}
