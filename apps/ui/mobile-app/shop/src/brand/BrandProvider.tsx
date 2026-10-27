import type { ReactNode } from 'react'
import { BrandProvider as SharedBrandProvider } from '@dripfunnel/mobile-shared/brand'
import { createShopClient } from '../api/client'
import { loadTokens } from '../session/tokens'
import { StartupError } from './StartupError'

export { useBrand } from '@dripfunnel/mobile-shared/brand'

const createClient = async (host: string, timeoutMs: number) => createShopClient(host, await loadTokens(host), timeoutMs)
const renderError = (retry: () => void) => <StartupError onRetry={retry} />

// The store's look before anything renders, read with the shop's client.
export function BrandProvider({ children }: { children: ReactNode }) {
  return (
    <SharedBrandProvider createClient={createClient} renderError={renderError}>
      {children}
    </SharedBrandProvider>
  )
}
