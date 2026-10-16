import { useEffect } from 'react'
import { AppState } from 'react-native'

/** Reads again when the person comes back to the app, e.g. from the browser where a provider was connected. */
export function useRefreshOnReturn(refresh: () => Promise<void>) {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh()
    })
    return () => subscription.remove()
  }, [refresh])
}
