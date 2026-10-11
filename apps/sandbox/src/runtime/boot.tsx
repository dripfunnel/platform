import type { ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  connectHotReload,
  createI18n,
  createShopClient,
  loadStore,
  StorefrontProvider,
  studioBasePath,
  studioPagePath,
  studioShopEndpoint,
  type Catalogue,
  type CoreRoute,
  type ShopStoreSettings,
} from '@dripfunnel/storefront-core'

/** The theme's pages as the bundle's entry exports them, from routes.json (gate/bundle.ts). */
export type ThemePages = { routes: Partial<Record<CoreRoute, ComponentType>>; custom: Record<string, ComponentType>; content: Record<string, Record<string, string>> }

// In the studio frame every address carries the session (AI-STUDIO §3 step 6); core reads it from its own module's URL.
const base = studioBasePath(import.meta.url)
const client = createShopClient(base ? { endpoint: studioShopEndpoint(base) } : {})
let root: Root | null = null
let store: Promise<ShopStoreSettings | null> | null = null

const pageFor = (pages: ThemePages, path: string): ComponentType | undefined => (path === '/' ? pages.routes.home : (pages.custom[path] ?? pages.routes.notFound))

const render = async (pages: ThemePages): Promise<void> => {
  const element = document.getElementById('root')
  if (!element) return
  store ??= loadStore(client)
  const settings = await store
  const Page = pageFor(pages, base ? studioPagePath(base, location.pathname) : location.pathname)
  if (!settings || !Page) return
  root ??= createRoot(element)
  // The theme's keys are its own (`pages.home.title`), checked against content/** by the validator, not core's MessageKey.
  const { t } = createI18n(settings.language, pages.content as Record<string, Catalogue>)
  root.render(
    <StorefrontProvider value={{ client, store: settings, locale: settings.language, t, mode: base ? 'studio' : 'preview', poweredBy: null }}>
      <Page />
    </StorefrontProvider>,
  )
}

let booted = false

/** Mounts the first bundle's pages; in the studio frame, later bundles arrive by the hot reload and render in place. */
export const boot = (pages: ThemePages): void => {
  if (booted) return
  booted = true
  void render(pages)
  if (!base) return
  connectHotReload<ThemePages>({
    base,
    origin: location.origin,
    load: async (url) => ((await import(url)) as { theme: ThemePages }).theme,
    apply: (pages) => render(pages),
    scroll: { read: () => [scrollX, scrollY], restore: (x, y) => scrollTo(x, y) },
  })
}
