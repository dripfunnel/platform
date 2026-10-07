import { createContext, useContext, type ReactNode } from 'react'
import type { ShopClient } from '../api/client'
import { createI18n, type Translate } from '../i18n/i18n'
import type { ShopStoreSettings } from './store'

export type RenderMode = 'live' | 'preview'

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

export const StorefrontProvider = ({ value, children }: { value: Omit<Storefront, 't'> & { t?: Translate }; children: ReactNode }) => (
  <StorefrontContext.Provider value={{ ...value, t: value.t ?? createI18n(value.locale).t }}>{children}</StorefrontContext.Provider>
)

export const useStorefront = (): Storefront => {
  const value = useContext(StorefrontContext)
  if (!value) throw new Error('useStorefront needs a StorefrontProvider above it.')
  return value
}
