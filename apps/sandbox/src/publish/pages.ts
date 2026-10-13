import { contentAddresses, coreRoutes, jsonLdText, routeAddresses, seoFor, storeHead, type ThemeRoute, type ThemeRoutes } from '@dripfunnel/storefront-core'
import { fallbackPath, indexable, type CatalogueSnapshot, type PageRoute } from '@dripfunnel/storefront-core/guard'

// The live site's pages and the files around them (storefront ARCHITECTURE §4.2, §8; LIVE-SHOP §4 step 6, and §5 step 6
// for `_edge.json`): the build writes them and the check step reads the same plan, so a missing page is one the gate names.

export type PlannedPage = { path: string; route: PageRoute; language: string; custom: string | null }

/** What the page's script reads to hydrate the same tree the build rendered (runtime/boot.tsx). */
export type LivePage = { route: ThemeRoute | null; custom: string | null; path: string; store: CatalogueSnapshot['store']; poweredBy: string | null }

export const livePageId = 'df-page'

const rightToLeft = new Set(['ar', 'fa', 'he', 'ur'])
export const directionOf = (language: string): 'ltr' | 'rtl' => (rightToLeft.has(language.split('-')[0] ?? language) ? 'rtl' : 'ltr')

/** The main language at the root and every other one under its own code (ARCHITECTURE §8 "locale routing"). */
export const languagePrefix = (store: CatalogueSnapshot['store'], language: string) => (language === store.mainLanguage ? '' : `/${language.toLowerCase()}`)

/**
 * `contentPaths`: the store's content pages and posts (the snapshot's `guard.usedPaths`); each page gets its own file.
 * `postPaths`: its published posts (the snapshot's `posts`), each with its own file, its head and Article data (§8).
 */
export const plan = (routes: ThemeRoutes, store: CatalogueSnapshot['store'], contentPaths: readonly string[] = [], postPaths: readonly string[] = []): PlannedPage[] =>
  [store.mainLanguage, ...store.languages.filter((l) => l !== store.mainLanguage)].flatMap((language) => {
    const prefix = languagePrefix(store, language)
    return [
      ...coreRoutes
        .filter((route) => routes.routes[route] !== undefined)
        .map((route): PlannedPage => {
          const address = routeAddresses[route]
          return { path: `${prefix}${'page' in address ? address.page : fallbackPath(route)}`, route, language, custom: null }
        }),
      ...(['blog', 'blogPost'] as const)
        .filter((route) => routes.routes[route] !== undefined)
        .map((route): PlannedPage => {
          const address = contentAddresses[route]
          return { path: `${prefix}${'page' in address ? address.page : fallbackPath(route)}`, route, language, custom: null }
        }),
      // The snapshot holds a post's main-language words, so only those pages are written; another language's reads its own.
      ...(routes.routes.blogPost === undefined || language !== store.mainLanguage ? [] : postPaths).map((path): PlannedPage => ({ path: `${path}/`, route: 'blogPost', language, custom: null })),
      ...(routes.routes.contentPage === undefined ? [] : contentPaths.filter((p) => /^\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p))).map((path): PlannedPage => ({ path: `${prefix}${path}/`, route: 'contentPage', language, custom: null })),
      ...Object.keys(routes.custom ?? {}).map((custom): PlannedPage => ({ path: `${prefix}${custom}/`, route: 'custom', language, custom })),
    ]
  })

/** A page's file: `/cart/` is `cart/index.html` (store-proxy's relativeKey). */
export const fileOf = (path: string) => `${path.slice(1)}index.html`

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// Inside a script element, `<` would let a store's words end it early.
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

export type PageAssets = { entry: string; css: readonly string[] }

/** A post's own page, written for the main language only (`plan`). */
const postOf = (page: PlannedPage, s: CatalogueSnapshot) => (page.route === 'blogPost' ? (s.posts.find((p) => page.path === `${p.path}/`) ?? null) : null)

/** The document around a rendered page: core owns the head (ARCHITECTURE §8), the theme the body. */

export const pageDocument = (page: PlannedPage, s: CatalogueSnapshot, o: { body: string; assets: PageAssets; dir: 'ltr' | 'rtl'; store: CatalogueSnapshot['store'] }) => {
  const asset = (file: string) => escapeHtml(`${s.assetBase ?? '/'}${file}`)
  const post = postOf(page, s)
  const absolute = (url: string) => (url.startsWith('/') ? `${s.origin}${url}` : url)
  const article = post
    ? seoFor({ store: { name: o.store.name, url: `${s.origin}/` }, url: `${s.origin}${page.path}`, title: post.seoTitle ?? post.title, description: post.seoDescription, image: post.image ? absolute(post.image.url) : null, preview: false, article: { headline: post.title, datePublished: post.publishedAt, author: post.author, image: post.image ? absolute(post.image.url) : null } })
    : null
  const head = article ? { title: article.title, description: post?.seoDescription ?? null, image: post?.image ? absolute(post.image.url) : null } : storeHead(o.store, page.route === 'home' ? '/' : page.path)
  const live: LivePage = { route: page.route === 'custom' ? null : page.route, custom: page.custom, path: page.path, store: o.store, poweredBy: s.poweredBy }
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(page.language)}" dir="${o.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escapeHtml(head.title ?? o.store.name)}</title>`,
    head.description ? `<meta name="description" content="${escapeHtml(head.description)}">` : '',
    head.image ? `<meta property="og:image" content="${escapeHtml(head.image)}">` : '',
    article ? '<meta property="og:type" content="article">' : '',
    ...(article?.jsonLd ?? []).map((data) => `<script type="application/ld+json">${jsonLdText(data)}</script>`),
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
    if (p.route === 'custom' || p.route === 'contentPage') return []
    const address = p.route === 'blog' || p.route === 'blogPost' ? contentAddresses[p.route] : routeAddresses[p.route]
    return 'prefix' in address ? [{ prefix: `${languagePrefix(store, p.language)}${address.prefix}`, page: p.path }] : []
  }),
  notFound: pages.find((p) => p.route === 'notFound' && p.language === store.mainLanguage)?.path ?? null,
})
