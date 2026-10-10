'use client'

import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { setProblemReporter, shopProblemReporter } from '../../sealed/report'
import type { ShopClient } from '../api/client'
import { createI18n, type Translate } from '../i18n/i18n'
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

/** Gives the page its store, and sends what core's walls catch to the Shop API (ARCHITECTURE §3.5). */
export const StorefrontProvider = ({ value, children }: { value: Omit<Storefront, 't'> & { t?: Translate }; children: ReactNode }) => {
  useEffect(() => {
    setProblemReporter(shopProblemReporter(value.client))
    return () => setProblemReporter(null)
  }, [value.client])
  return <StorefrontContext.Provider value={{ ...value, t: value.t ?? createI18n(value.locale).t }}>{children}</StorefrontContext.Provider>
}

export const useStorefront = (): Storefront => {
  const value = useContext(StorefrontContext)
  if (!value) throw new Error('useStorefront needs a StorefrontProvider above it.')
  return value
}
