import { useEffect, useState } from 'react'

/** `value`, but only once it has stopped changing for `delayMs`: a search asks the API when the typing pauses, not on every key. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return settled
}

export const searchDebounceMs = 300
