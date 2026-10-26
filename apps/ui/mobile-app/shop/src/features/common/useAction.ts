import { useCallback, useState } from 'react'
import { isApiError } from '@dripfunnel/mobile-shared/graphql'
import { useShop } from '../../api/ShopContext'

/** One write at a time: whether it is running, and the code of its last refusal (`UNKNOWN` for anything not the API's). A session the API says has ended (`SIGNED_OUT`) is let go. */
export function useAction() {
  const { endSession } = useShop()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async <T,>(work: () => Promise<T>): Promise<{ value: T } | null> => {
    setBusy(true)
    setError(null)
    try {
      return { value: await work() }
    } catch (failure) {
      setError(isApiError(failure) ? failure.code : 'UNKNOWN')
      if (isApiError(failure, 'SIGNED_OUT')) void endSession()
      return null
    } finally {
      setBusy(false)
    }
  }, [endSession])

  return { busy, error, run, clear: useCallback(() => setError(null), []) }
}
