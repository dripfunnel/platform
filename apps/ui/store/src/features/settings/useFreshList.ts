import { useCallback, useRef, useState } from 'react'

/**
 * A list a tab keeps itself and reads again after each write, so a secret shown beside it survives. Only the newest read
 * lands; a read that fails keeps what is shown and says it is stale.
 */
export const useFreshList = <T>(initial: readonly T[], read: () => Promise<T[]>) => {
  const [list, setList] = useState<readonly T[]>(initial)
  const [stale, setStale] = useState(false)
  const latest = useRef(0)
  const refresh = useCallback(async () => {
    const ask = ++latest.current
    try {
      const next = await read()
      if (ask !== latest.current) return
      setList(next)
      setStale(false)
    } catch {
      if (ask === latest.current) setStale(true)
    }
  }, [read])
  return { list, stale, refresh }
}
