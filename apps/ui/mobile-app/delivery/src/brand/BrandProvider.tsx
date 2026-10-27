import * as SplashScreen from 'expo-splash-screen'
import { useEffect, useState, type ReactNode } from 'react'
import { createBrandClient } from '../api/client'
import { fetchBrand } from '../api/store'
import { storeHost } from '../graphql/storeHost'
import { buildTheme, ThemeProvider, useMode } from '@dripfunnel/mobile-shared/theme'
import { BrandContext, type BrandState } from './BrandContext'
import { loadBrand } from './loadBrand'
import { readSavedBrand, saveBrand } from './storage'
import { StartupError } from './StartupError'

export { useBrand } from './BrandContext'

// Short, so a phone with no signal reaches the saved look in seconds, not after the client's own timeout.
export const brandTimeoutMs = 5_000

SplashScreen.preventAutoHideAsync().catch(() => undefined)

// The splash stays up until the store has answered, or failed to.
export function BrandProvider({ children }: { children: ReactNode }) {
  const mode = useMode()
  const [state, setState] = useState<BrandState | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    const start = async () => {
      const host = storeHost()
      const client = createBrandClient(host, brandTimeoutMs)
      const loaded = await loadBrand({ fetch: () => fetchBrand(client), readSaved: () => readSavedBrand(host), save: (brand) => saveBrand(host, brand) })
      if (current) setState(loaded)
    }
    start().catch(() => current && setFailed(true))
    return () => {
      current = false
    }
  }, [attempt])

  useEffect(() => {
    if (state || failed) SplashScreen.hideAsync().catch(() => undefined)
  }, [state, failed])

  if (failed) {
    return (
      <StartupError
        onRetry={() => {
          setFailed(false)
          setAttempt((n) => n + 1)
        }}
      />
    )
  }
  if (!state) return null
  return (
    <BrandContext.Provider value={state}>
      <ThemeProvider theme={buildTheme(mode)}>{children}</ThemeProvider>
    </BrandContext.Provider>
  )
}
