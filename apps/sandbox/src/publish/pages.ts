import { coreRoutes, routeAddresses, type CoreRoute, type ThemeRoutes } from '@dripfunnel/storefront-core'
import { fallbackPath, indexable, type CatalogueSnapshot, type PageRoute } from '@dripfunnel/storefront-core/guard'

// The live site's pages and the files around them (storefront ARCHITECTURE §4.2, §8; LIVE-SHOP §5 step 6): the build
// writes them and the check step reads the same plan, so a page the build left out is one the gate names.

export type PlannedPage = { path: string; route: PageRoute; language: string; custom: string | null }

/** What the page's script reads to hydrate the same tree the build rendered (runtime/boot.tsx). */
export type LivePage = { route: CoreRoute | null; custom: string | null; store: CatalogueSnapshot['store']; poweredBy: string | null }

export const livePageId = 'df-page'

const rightToLeft = new Set(['ar', 'fa', 'he', 'ur'])
export const directionOf = (language: string): 'ltr' | 'rtl' => (rightToLeft.has(language.split('-')[0] ?? language) ? 'rtl' : 'ltr')

/** The main language at the root and every other one under its own code (ARCHITECTURE §8 "locale routing"). */
export const languagePrefix = (store: CatalogueSnapshot['store'], language: string) => (language === store.mainLanguage ? '' : `/${language.toLowerCase()}`)

export const plan = (routes: ThemeRoutes, store: CatalogueSnapshot['store']): PlannedPage[] =>
  [store.mainLanguage, ...store.languages.filter((l) => l !== store.mainLanguage)].flatMap((language) => {
    const prefix = languagePrefix(store, language)
    return [
      ...coreRoutes
        .filter((route) => routes.routes[route] !== undefined)
        .map((route): PlannedPage => {
          const address = routeAddresses[route]
          return { path: `${prefix}${'page' in address ? address.page : fallbackPath(route)}`, route, language, custom: null }
        }),
      ...Object.keys(routes.custom ?? {}).map((custom): PlannedPage => ({ path: `${prefix}${custom}/`, route: 'custom', language, custom })),
    ]
  })

/** A page's file: `/cart/` is `cart/index.html` (store-proxy's relativeKey). */
export const fileOf = (path: string) => `${path.slice(1)}index.html`

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// Inside a script element, `<` would let a store's words end it early.
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

export type PageAssets = { entry: string; css: readonly string[] }

/** The document around a rendered page: core owns the head (ARCHITECTURE §8), the theme the body. */
export const pageDocument = (page: PlannedPage, s: CatalogueSnapshot, o: { body: string; assets: PageAssets; dir: 'ltr' | 'rtl'; store: CatalogueSnapshot['store'] }) => {
  const asset = (file: string) => escapeHtml(`${s.assetBase ?? '/'}${file}`)
  const live: LivePage = { route: page.route === 'custom' ? null : page.route, custom: page.custom, store: o.store, poweredBy: s.poweredBy }
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(page.language)}" dir="${o.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escapeHtml(o.store.name)}</title>`,
    o.store.description ? `<meta name="description" content="${escapeHtml(o.store.description)}">` : '',
    indexable(page.route) && !page.path.includes('/_fallback/') ? `<link rel="canonical" href="${escapeHtml(`${s.origin}${page.path}`)}">` : '<meta name="robots" content="noindex">',
    ...o.assets.css.map((c) => `<link rel="stylesheet" href="${asset(c)}">`),
    `<script type="module" src="${asset(o.assets.entry)}"></script>`,
    `</head><body><div id="root">${o.body}</div><script type="application/json" id="${livePageId}">${scriptJson(live)}</script></body></html>`,
    '',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/** The pages search engines are told about, in every language. */
export const sitemap = (pages: readonly PlannedPage[], origin: string) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...pages.filter((p) => indexable(p.route) && !p.path.includes('/_fallback/')).map((p) => `<url><loc>${escapeHtml(`${origin}${p.path}`)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n')

export const robots = (origin: string) => `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`

/** `_edge.json` as store-proxy reads it: each item address gets its route's client-rendered page, and the 404 page. */
export const edgeRules = (pages: readonly PlannedPage[], store: CatalogueSnapshot['store']) => ({
  redirects: [],
  fallbacks: pages.flatMap((p) => {
    if (p.route === 'custom') return []
    const address = routeAddresses[p.route]
    return 'prefix' in address ? [{ prefix: `${languagePrefix(store, p.language)}${address.prefix}`, page: p.path }] : []
  }),
  notFound: pages.find((p) => p.route === 'notFound' && p.language === store.mainLanguage)?.path ?? null,
})
