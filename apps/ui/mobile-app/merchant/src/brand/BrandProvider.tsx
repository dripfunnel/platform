import * as SplashScreen from 'expo-splash-screen'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { fetchBrand, type Brand } from '../api/brand'
import { createApiClient, partnerDomain } from '../graphql'
import { buildTheme, ThemeProvider, useMode } from '../theme'
import { themeFor } from './brandTheme'
import { loadBrand, type BrandSource } from './loadBrand'
import { readSavedBrand, saveBrand } from './storage'

export type BrandState = { brand: Brand | null; source: BrandSource; domain: string }

// Short, so a phone with no signal reaches the saved look in seconds, not after the client's own timeout.
export const brandTimeoutMs = 5_000

const BrandContext = createContext<BrandState>({ brand: null, source: 'defaults', domain: '' })

export const useBrand = (): BrandState => useContext(BrandContext)

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
      const client = createApiClient({ domain, timeoutMs: brandTimeoutMs })
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
