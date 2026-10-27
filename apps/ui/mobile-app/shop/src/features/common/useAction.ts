import { useCallback, useRef, useState } from 'react'
import { isApiError } from '@dripfunnel/mobile-shared/graphql'
import { useShop } from '../../api/ShopContext'

/**
 * One write at a time: whether it runs, and its last refusal's code (`UNKNOWN` if not the API's); `SIGNED_OUT` lets the session go.
 * `handled` sees each refusal first; true means it moved the shopper elsewhere, so no error text is kept.
 */
export function useAction(handled?: (error: unknown) => boolean) {
  const { endSession } = useShop()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(handled)
  latest.current = handled

  const run = useCallback(async <T,>(work: () => Promise<T>): Promise<{ value: T } | null> => {
    setBusy(true)
    setError(null)
    try {
      return { value: await work() }
    } catch (failure) {
      if (!latest.current?.(failure)) setError(isApiError(failure) ? failure.code : 'UNKNOWN')
      if (isApiError(failure, 'SIGNED_OUT')) void endSession()
      return null
    } finally {
      setBusy(false)
    }
  }, [endSession])

  return { busy, error, run, clear: useCallback(() => setError(null), []) }
}
