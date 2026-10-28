import { useCallback, useState } from 'react'
import { isApiError } from '@dripfunnel/mobile-shared/graphql'

/** One write at a time: whether it runs, and the code of its last refusal (`UNKNOWN` when it was not the API's). */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async <T,>(work: () => Promise<T>): Promise<{ value: T } | null> => {
    setBusy(true)
    setError(null)
    try {
      return { value: await work() }
    } catch (failure) {
      setError(isApiError(failure) ? failure.code : 'UNKNOWN')
      return null
    } finally {
      setBusy(false)
    }
  }, [])

  return { busy, error, run, clear: useCallback(() => setError(null), []) }
}
