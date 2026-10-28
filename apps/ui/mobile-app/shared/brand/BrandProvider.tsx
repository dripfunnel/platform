import * as SplashScreen from 'expo-splash-screen'
import { useEffect, useState, type ReactNode } from 'react'
import type { ApiClient } from '../graphql'
import { buildTheme, ThemeProvider, useMode } from '../theme'
import { BrandContext, type BrandState } from './BrandContext'
import { loadBrand } from './loadBrand'
import { readSavedBrand, saveBrand } from './storage'
import { fetchBrand } from './store'
import { storeHost } from './storeHost'

// Short, so a phone with no signal reaches the saved look in seconds, not after the client's own timeout.
export const brandTimeoutMs = 5_000

SplashScreen.preventAutoHideAsync().catch(() => undefined)

type Props = {
  children: ReactNode
  /** The client the store's look is read with: each app says which API and headers (the shop's carry its tokens). */
  createClient: (host: string, timeoutMs: number) => ApiClient | Promise<ApiClient>
  /** Drawn before any provider has a theme, when the store did not answer and nothing is saved. */
  renderError: (retry: () => void) => ReactNode
}

// The splash stays up until the store has answered, or failed to.
export function BrandProvider({ children, createClient, renderError }: Props) {
  const mode = useMode()
  const [state, setState] = useState<BrandState | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    const start = async () => {
      const host = storeHost()
      const client = await createClient(host, brandTimeoutMs)
      const loaded = await loadBrand({ fetch: () => fetchBrand(client), readSaved: () => readSavedBrand(host), save: (brand) => saveBrand(host, brand) })
      if (current) setState(loaded)
    }
    start().catch(() => current && setFailed(true))
    return () => {
      current = false
    }
  }, [attempt, createClient])

  useEffect(() => {
    if (state || failed) SplashScreen.hideAsync().catch(() => undefined)
  }, [state, failed])

  if (failed) {
    return renderError(() => {
      setFailed(false)
      setAttempt((n) => n + 1)
    })
  }
  if (!state) return null
  return (
    <BrandContext.Provider value={state}>
      <ThemeProvider theme={buildTheme(mode)}>{children}</ThemeProvider>
    </BrandContext.Provider>
  )
}
