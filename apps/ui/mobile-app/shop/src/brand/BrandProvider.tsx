import * as SplashScreen from 'expo-splash-screen'
import { useEffect, useState, type ReactNode } from 'react'
import { createShopClient } from '../api/client'
import { fetchBrand } from '../api/store'
import { storeHost } from '../graphql/storeHost'
import { loadTokens } from '../session/tokens'
import { buildTheme, ThemeProvider, useMode } from '@dripfunnel/mobile-shared/theme'
import { BrandContext, type BrandState } from './BrandContext'
import { loadBrand } from './loadBrand'
import { readSavedBrand, saveBrand } from './storage'

export { useBrand } from './BrandContext'

// Short, so a phone with no signal reaches the saved look in seconds, not after the client's own timeout.
export const brandTimeoutMs = 5_000

SplashScreen.preventAutoHideAsync().catch(() => undefined)

// The splash stays up until the store has answered, or failed to.
export function BrandProvider({ children }: { children: ReactNode }) {
  const mode = useMode()
  const [state, setState] = useState<BrandState | null>(null)
  const [failure, setFailure] = useState<Error | null>(null)

  useEffect(() => {
    let current = true
    const start = async () => {
      const host = storeHost()
      const client = createShopClient(host, await loadTokens(host), brandTimeoutMs)
      const loaded = await loadBrand({ fetch: () => fetchBrand(client), readSaved: () => readSavedBrand(host), save: (brand) => saveBrand(host, brand) })
      if (current) setState(loaded)
    }
    start().catch((error: unknown) => current && setFailure(error instanceof Error ? error : new Error('The app could not start.')))
    return () => {
      current = false
    }
  }, [])

  useEffect(() => {
    if (state || failure) SplashScreen.hideAsync().catch(() => undefined)
  }, [state, failure])

  if (failure) throw failure
  if (!state) return null
  return (
    <BrandContext.Provider value={state}>
      <ThemeProvider theme={buildTheme(mode)}>{children}</ThemeProvider>
    </BrandContext.Provider>
  )
}
