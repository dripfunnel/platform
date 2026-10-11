import type { ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createI18n, createShopClient, loadStore, StorefrontProvider, type Catalogue, type CoreRoute, type ShopStoreSettings } from '@dripfunnel/storefront-core'

/** The theme's pages as the bundle's entry hands them over, from routes.json (gate/bundle.ts). */
export type ThemePages = { routes: Partial<Record<CoreRoute, ComponentType>>; custom: Record<string, ComponentType>; content: Record<string, Record<string, string>> }

const client = createShopClient()
let root: Root | null = null
let store: Promise<ShopStoreSettings | null> | null = null

const pageFor = (pages: ThemePages, path: string): ComponentType | undefined => (path === '/' ? pages.routes.home : (pages.custom[path] ?? pages.routes.notFound))

/** Mounts the theme's page for this address; a later call, from a new bundle, renders its pages in the same root. */
export const boot = async (pages: ThemePages): Promise<void> => {
  const element = document.getElementById('root')
  if (!element) return
  store ??= loadStore(client)
  const settings = await store
  const Page = pageFor(pages, location.pathname)
  if (!settings || !Page) return
  root ??= createRoot(element)
  // The theme's keys are its own (`pages.home.title`), checked against content/** by the validator, not core's MessageKey.
  const { t } = createI18n(settings.language, pages.content as Record<string, Catalogue>)
  root.render(
    <StorefrontProvider value={{ client, store: settings, locale: settings.language, t, mode: 'preview', poweredBy: null }}>
      <Page />
    </StorefrontProvider>,
  )
}
