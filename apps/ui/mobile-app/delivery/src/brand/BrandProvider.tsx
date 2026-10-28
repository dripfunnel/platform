import type { ReactNode } from 'react'
import { BrandProvider as SharedBrandProvider } from '@dripfunnel/mobile-shared/brand'
import { createBrandClient } from '../api/client'
import { StartupError } from './StartupError'

const renderError = (retry: () => void) => <StartupError onRetry={retry} />

// The store's look before anything renders, read from the Shop API: the rider app has no shopper session.
export function BrandProvider({ children }: { children: ReactNode }) {
  return (
    <SharedBrandProvider createClient={createBrandClient} renderError={renderError}>
      {children}
    </SharedBrandProvider>
  )
}
