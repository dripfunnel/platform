'use client'

import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { setProblemReporter, shopProblemReporter } from '../../sealed/report'
import type { ShopClient } from '../api/client'
import { AddressProvider, useLocation } from '../browser/router'
import { createI18n, type Translate } from '../i18n/i18n'
import { storeHead, useHeadAt } from '../seo/head'
import type { ShopStoreSettings } from './store'

/** `studio` is the AI studio's frame on the preview origin (AI-STUDIO §1). */
export type RenderMode = 'live' | 'preview' | 'studio'

export type Storefront = {
  client: ShopClient
  store: ShopStoreSettings
  locale: string
  t: Translate
  mode: RenderMode
  /** The brand's name when its rule shows "Powered by" (CONSOLE-DESIGN §3 fact 18), else null. */
  poweredBy: string | null
}

const StorefrontContext = createContext<Storefront | null>(null)

/** The store's own head under every page's; a preview or the studio frame is never indexed (PREVIEW §5 step 4). */
const StoreHead = ({ store, mode }: { store: ShopStoreSettings; mode: RenderMode }) => {
  const { path } = useLocation()
  useHeadAt(0, { ...storeHead(store, path), hidden: mode !== 'live' })
  return null
}

/**
 * Gives the page its store, and sends what core's walls catch to the Shop API (ARCHITECTURE §3.5). `address` is the
 * page's path where there is no browser to read it from: a static build, and the hydration that follows it.
 */
export const StorefrontProvider = ({ value, address = '/', children }: { value: Omit<Storefront, 't'> & { t?: Translate }; address?: string; children: ReactNode }) => {
  useEffect(() => {
    setProblemReporter(shopProblemReporter(value.client))
    return () => setProblemReporter(null)
  }, [value.client])
  return (
    <StorefrontContext.Provider value={{ ...value, t: value.t ?? createI18n(value.locale).t }}>
      <AddressProvider address={address}>
        <StoreHead store={value.store} mode={value.mode} />
        {children}
      </AddressProvider>
    </StorefrontContext.Provider>
  )
}

/** The page's store where there is one; core's headless controls also render on their own. */
export const useOptionalStorefront = (): Storefront | null => useContext(StorefrontContext)

export const useStorefront = (): Storefront => {
  const value = useContext(StorefrontContext)
  if (!value) throw new Error('useStorefront needs a StorefrontProvider above it.')
  return value
}
