import type { ComponentType } from 'react'
import { createRoot, hydrateRoot, type Root } from 'react-dom/client'
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

/** A live page carries the store it was built with and its route (publish/pages.ts), so it hydrates the same tree. */
const livePage = (): { route: CoreRoute | null; custom: string | null; store: ShopStoreSettings; poweredBy: string | null } | null => {
  const text = document.getElementById('df-page')?.textContent
  return text ? (JSON.parse(text) as ReturnType<typeof livePage>) : null
}

const hydrate = (pages: ThemePages, live: NonNullable<ReturnType<typeof livePage>>): void => {
  const element = document.getElementById('root')
  const Page = live.custom ? pages.custom[live.custom] : live.route ? pages.routes[live.route] : undefined
  if (!element || !Page) return
  const { t } = createI18n(live.store.language, pages.content as Record<string, Catalogue>)
  hydrateRoot(
    element,
    <StorefrontProvider value={{ client, store: live.store, locale: live.store.language, t, mode: 'live', poweredBy: live.poweredBy }}>
      <Page />
    </StorefrontProvider>,
  )
}

let booted = false

/** Mounts the first bundle's pages; in the studio frame, later bundles arrive by the hot reload and render in place. */
export const boot = (pages: ThemePages): void => {
  if (booted) return
  booted = true
  const live = livePage()
  if (live) return hydrate(pages, live)
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
