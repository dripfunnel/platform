import * as SplashScreen from 'expo-splash-screen'
import { useEffect, useState, type ReactNode } from 'react'
import { fetchBrand } from '../api/brand'
import { apiPath, partnerDomain } from '../graphql'
import { createApiClient } from '@dripfunnel/mobile-shared/graphql'
import { buildTheme, ThemeProvider, useMode } from '@dripfunnel/mobile-shared/theme'
import { BrandContext, type BrandState } from './BrandContext'
import { themeFor } from './brandTheme'
import { loadBrand } from './loadBrand'
import { readSavedBrand, saveBrand } from './storage'

export { useBrand, type BrandState } from './BrandContext'

// Short, so a phone with no signal reaches the saved look in seconds, not after the client's own timeout.
export const brandTimeoutMs = 5_000

SplashScreen.preventAutoHideAsync().catch(() => undefined)

// ARCHITECTURE.md §4 step 3: the partner's look; the splash stays up until it has answered, or failed to.
export function BrandProvider({ children }: { children: ReactNode }) {
  // Light until the signed-in person's own saved choice is known (ui/README.md §4); the shell sets it.
  const mode = useMode()
  const [state, setState] = useState<BrandState | null>(null)
  const [failure, setFailure] = useState<Error | null>(null)

  useEffect(() => {
    let current = true
    const start = async () => {
      const domain = partnerDomain()
      const client = createApiClient({ domain, path: apiPath, timeoutMs: brandTimeoutMs })
      const loaded = await loadBrand({ fetch: () => fetchBrand(client), readSaved: () => readSavedBrand(domain), save: (brand) => saveBrand(domain, brand) })
      if (current) setState({ ...loaded, domain })
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
      <ThemeProvider theme={state.brand ? themeFor(state.brand, mode) : buildTheme(mode)}>{children}</ThemeProvider>
    </BrandContext.Provider>
  )
}
