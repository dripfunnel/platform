import { z } from 'zod'
import { collectionPath, contentAddresses, coreRoutes, jsonLdText, moneySchema, productPath, recordedAnswer, routeAddresses, seoFor, storeHead, type ThemeRoute, type ThemeRoutes } from '@dripfunnel/storefront-core'
import { fallbackPath, indexable, isVersionPath, type CatalogueSnapshot, type PageRoute, type SnapshotCatalogue } from '@dripfunnel/storefront-core/guard'

// The live site's pages and the files around them (storefront ARCHITECTURE §4.2, §8; LIVE-SHOP §4 step 6, and §5 step 6
// for `_edge.json`): the build writes them and the check step reads the same plan, so a missing page is one the gate names.

export type PlannedPage = { path: string; route: PageRoute; language: string; custom: string | null }

/** What the page's script reads to hydrate the same tree the build rendered (runtime/boot.tsx), with its answers by question. */
export type LivePage = { route: ThemeRoute | null; custom: string | null; path: string; store: CatalogueSnapshot['store']; poweredBy: string | null; answers?: Record<string, unknown> }

export const livePageId = 'df-page'

const rightToLeft = new Set(['ar', 'fa', 'he', 'ur'])
export const directionOf = (language: string): 'ltr' | 'rtl' => (rightToLeft.has(language.split('-')[0] ?? language) ? 'rtl' : 'ltr')

/** The main language at the root and every other one under its own code (ARCHITECTURE §8 "locale routing"). */
export const languagePrefix = (store: CatalogueSnapshot['store'], language: string) => (language === store.mainLanguage ? '' : `/${language.toLowerCase()}`)

/**
 * `contentPaths`: the store's content pages and posts (the snapshot's `guard.usedPaths`); each page gets its own file.
 * `postPaths`: its published posts (the snapshot's `posts`), each with its own file, its head and Article data (§8).
 */
export const plan = (routes: ThemeRoutes, store: CatalogueSnapshot['store'], contentPaths: readonly string[] = [], postPaths: readonly string[] = [], catalogue: SnapshotCatalogue | null = null): PlannedPage[] =>
  [store.mainLanguage, ...store.languages.filter((l) => l !== store.mainLanguage)].flatMap((language) => {
    const prefix = languagePrefix(store, language)
    // The catalogue's answers are in the main language, as a post's words are; another language's items read their own.
    const items = language === store.mainLanguage ? catalogue : null
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
      ...(routes.routes.product === undefined ? [] : (items?.products ?? [])).flatMap((p): PlannedPage[] =>
        [productPath(p.slug), ...p.versions.map((v) => `${productPath(p.slug)}${v}/`)].map((path) => ({ path, route: 'product', language, custom: null })),
      ),
      ...(routes.routes.collection === undefined || !items ? [] : collectionSlugs(items)).map((slug): PlannedPage => ({ path: collectionPath(slug), route: 'collection', language, custom: null })),
    ]
  })

/** The store's collections, and `/collections/all/` unless one of them has that address. */
const collectionSlugs = (catalogue: SnapshotCatalogue) => {
  const slugs = catalogue.collections.map((c) => c.slug)
  return slugs.includes('all') ? slugs : [...slugs, 'all']
}

/** A product's or a collection's own page, written from the catalogue, rather than its route's client-rendered one. */
const isItemPage = (page: PlannedPage) => (page.route === 'product' || page.route === 'collection') && !page.path.includes('/_fallback/')

/** The item pages the check step opens: each item route's first few, rendered by the same page the rest share. */
const sampledItems = 2

/** The pages the check step reads, visits and weighs, and the edge cases render: every page but most items (the build renders them all). */
export const checkedPages = (pages: readonly PlannedPage[]): PlannedPage[] => {
  const seen = new Map<string, number>()
  return pages.filter((p) => {
    if (!isItemPage(p)) return true
    const n = seen.get(p.route) ?? 0
    seen.set(p.route, n + 1)
    return n < sampledItems
  })
}

/** A page's file: `/cart/` is `cart/index.html` (store-proxy's relativeKey). */
export const fileOf = (path: string) => `${path.slice(1)}index.html`

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// Inside a script element, `<` would let a store's words end it early.
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

export type PageAssets = { entry: string; css: readonly string[] }

/** A post's own page, written for the main language only (`plan`). */
const postOf = (page: PlannedPage, s: CatalogueSnapshot) => (page.route === 'blogPost' ? (s.posts.find((p) => page.path === `${p.path}/`) ?? null) : null)

const text = z.string().nullish()
const productAnswer = z.object({
  product: z.object({ name: z.string().min(1), seoTitle: text, seoDescription: text, description: text, inStock: z.boolean().nullish(), price: moneySchema.nullish().catch(null), photos: z.array(z.object({ image: z.object({ url: text }).nullish() })).nullish() }),
})
const collectionAnswer = z.object({ collection: z.object({ name: z.string().min(1), seoTitle: text, seoDescription: text, description: text }) })
const priceAnswer = z.object({
  product: z.object({ price: z.unknown(), versions: z.array(z.object({ id: text, price: z.unknown() })).nullish(), compliance: z.array(z.object({ region: text, value: text })).nullish() }),
  store: z.object({ marketId: text, markets: z.array(z.object({ id: text, countries: z.array(z.string()).nullish() })).nullish() }).nullish(),
})

/** The item's slug in a path the plan wrote (`/products/{slug}/…`). */
const slugOf = (path: string) => path.split('/')[2] ?? ''

/** The snapshot's answer to core's question about one item, by the same lookup the build's client uses. */
const recordedFor = (s: CatalogueSnapshot, operation: string, slug: string) => recordedAnswer(s.catalogue?.answers ?? [], `query ${operation}`, { slug })

/** A product's or collection's own head, as core's hooks set it in the browser (products/product.ts, collections/collections.ts). */
const itemSeo = (page: PlannedPage, s: CatalogueSnapshot, store: CatalogueSnapshot['store'], absolute: (url: string) => string) => {
  if (!isItemPage(page)) return null
  const site = { name: store.name, url: `${s.origin}/` }
  if (page.route === 'product') {
    const p = productAnswer.safeParse(recordedFor(s, 'Product', slugOf(page.path))).data?.product
    if (!p) return null
    const image = p.photos?.find((ph) => ph.image?.url)?.image?.url
    const seo = seoFor({ store: site, url: `${s.origin}${productPath(slugOf(page.path))}`, title: p.seoTitle ?? p.name, description: p.seoDescription ?? p.description, image: image ? absolute(image) : null, preview: false, ...(p.price ? { product: { name: p.name, price: p.price, available: p.inStock ?? false, image: image ? absolute(image) : null } } : {}) })
    return { seo, title: p.seoTitle ?? p.name, description: p.seoDescription ?? p.description ?? null }
  }
  const c = collectionAnswer.safeParse(recordedFor(s, 'Collection', slugOf(page.path))).data?.collection
  return c ? { seo: seoFor({ store: site, url: `${s.origin}${page.path}`, title: c.seoTitle ?? c.name, description: c.seoDescription ?? c.description, preview: false }), title: c.seoTitle ?? c.name, description: c.seoDescription ?? c.description ?? null } : null
}

/**
 * What each product page built from the catalogue shows, for the gate: its price (the version its address names, as
 * `useProduct` chooses) and legal notices for the store's market or everywhere (products/product.ts `legalNotices`).
 */
export const itemFacts = (pages: readonly PlannedPage[], s: CatalogueSnapshot): Map<string, { priced: boolean; legal: boolean }> =>
  new Map(
    pages.flatMap((page) => {
      const answer = isItemPage(page) && page.route === 'product' ? priceAnswer.safeParse(recordedFor(s, 'Product', slugOf(page.path))).data : undefined
      if (!answer) return []
      const versions = answer.product.versions ?? []
      const named = versions.find((v) => v.id === page.path.split('/')[3]) ?? (versions.length === 1 ? versions[0] : undefined)
      const countries = new Set(answer.store?.markets?.find((m) => m.id && m.id === answer.store?.marketId)?.countries ?? [])
      const legal = (answer.product.compliance ?? []).some((c) => !!c.value?.trim() && !!c.region && (c.region === 'ALL' || countries.has(c.region)))
      return [[page.path, { priced: (named ? named.price : answer.product.price) != null, legal }] as const]
    }),
  )

/** The document around a rendered page: core owns the head (ARCHITECTURE §8), the theme the body. */

export const pageDocument = (page: PlannedPage, s: CatalogueSnapshot, o: { body: string; assets: PageAssets; dir: 'ltr' | 'rtl'; store: CatalogueSnapshot['store']; answers?: Record<string, unknown> }) => {
  const asset = (file: string) => escapeHtml(`${s.assetBase ?? '/'}${file}`)
  const post = postOf(page, s)
  const absolute = (url: string) => (url.startsWith('/') ? `${s.origin}${url}` : url)
  const article = post
    ? seoFor({ store: { name: o.store.name, url: `${s.origin}/` }, url: `${s.origin}${page.path}`, title: post.seoTitle ?? post.title, description: post.seoDescription, image: post.image ? absolute(post.image.url) : null, preview: false, article: { headline: post.title, datePublished: post.publishedAt, author: post.author, image: post.image ? absolute(post.image.url) : null } })
    : null
  const item = itemSeo(page, s, o.store, absolute)
  const seo = article ?? item?.seo ?? null
  const ogImage = seo?.meta.find((m) => m.property === 'og:image')?.content ?? null
  const head = article ? { title: article.title, description: post?.seoDescription ?? null, image: post?.image ? absolute(post.image.url) : null } : item ? { title: item.title, description: item.description, image: ogImage } : storeHead(o.store, page.route === 'home' ? '/' : page.path)
  const ogType = seo?.meta.find((m) => m.property === 'og:type')?.content
  const answers = o.answers && Object.keys(o.answers).length > 0 ? { answers: o.answers } : {}
  const live: LivePage = { route: page.route === 'custom' ? null : page.route, custom: page.custom, path: page.path, store: o.store, poweredBy: s.poweredBy, ...answers }
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(page.language)}" dir="${o.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escapeHtml(head.title ?? o.store.name)}</title>`,
    head.description ? `<meta name="description" content="${escapeHtml(head.description)}">` : '',
    head.image ? `<meta property="og:image" content="${escapeHtml(head.image)}">` : '',
    ogType && ogType !== 'website' ? `<meta property="og:type" content="${ogType}">` : '',
    ...(seo?.jsonLd ?? []).map((data) => `<script type="application/ld+json">${jsonLdText(data)}</script>`),
    indexable(page.route) && !page.path.includes('/_fallback/') ? `<link rel="canonical" href="${escapeHtml(item?.seo.canonical ?? `${s.origin}${page.path}`)}">` : '<meta name="robots" content="noindex">',
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
    ...pages.filter((p) => indexable(p.route) && !p.path.includes('/_fallback/') && !isVersionPath(p.path)).map((p) => `<url><loc>${escapeHtml(`${origin}${p.path}`)}</loc></url>`),
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
