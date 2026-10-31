import { z } from 'zod'
import { storeCspSchema } from '../../platform/csp/csp.js'
import { guardContextSchema, localePattern } from '../rules.js'

// The frozen input a publish builds from (storefront LIVE-SHOP §4 step 3): the store as the Shop API answers it, read
// once by the platform, so the build needs no network and the same snapshot always gives the same files.

const text = (max: number) => z.string().max(max)
const optional = (max: number) => text(max).nullable()

export const snapshotStoreSchema = z.strictObject({
  name: z.string().min(1).max(200),
  description: optional(2000),
  language: z.string().regex(localePattern),
  mainLanguage: z.string().regex(localePattern),
  languages: z.array(z.string().regex(localePattern)).min(1).max(50),
  currency: z.string().regex(/^[A-Z]{3}$/),
  pricingCurrency: z.string().regex(/^[A-Z]{3}$/),
  currencies: z.array(z.strictObject({ code: z.string().regex(/^[A-Z]{3}$/) })).max(50),
  pricesIncludeTax: z.boolean(),
  timeZone: z.string().min(1).max(64),
  contactEmail: optional(320),
  contactPhone: optional(40),
  logo: z.strictObject({ url: z.string().max(2048) }).nullable(),
  address: z.strictObject({ street: optional(200), city: optional(200), region: optional(200), postal: optional(40), country: optional(2) }).nullable(),
  // The brand and the home page's search and sharing (DATA-MODEL §7.8), which a theme reads through useStorefront().
  favicon: z.strictObject({ url: z.string().max(2048) }).nullable().default(null),
  tagline: optional(100).default(null),
  social: z.array(z.strictObject({ network: z.string().max(20), url: z.string().max(300) })).max(6).default([]),
  seo: z.strictObject({ title: optional(60), description: optional(155), image: z.strictObject({ url: z.string().max(2048) }).nullable() }).nullable().default(null),
})

/** An https origin, or the loopback a local run serves from. */
const origin = z.string().regex(/^(?:https:\/\/[a-z0-9.-]+|http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?)$/)

/** The posts a build writes pages for: the newest, past which a post is still served by the blog's client-rendered page. */
export const maxSnapshotPosts = 500

/** The products and collections a build writes pages for; past them an item is served by its route's client-rendered page. */
export const maxSnapshotProducts = 1000
export const maxSnapshotCollections = 200
/** Version addresses across all products, so a build stays well inside the platform's 5,000 files (saas/storefronts/manifest.ts). */
export const maxSnapshotVersionPages = 2000

const itemSlug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(200)

/**
 * The Shop API's own answers to core's catalogue questions (version 2, ARCHITECTURE §4.2), which the build's offline
 * client gives the page (`recordedShopClient`), and the items the build writes a page for.
 */
export const snapshotCatalogueSchema = z.strictObject({
  answers: z
    .array(z.strictObject({ operation: z.string().regex(/^[A-Za-z_]\w{0,63}$/), variables: z.record(z.string(), z.unknown()), data: z.record(z.string(), z.unknown()) }))
    .max(maxSnapshotProducts + maxSnapshotCollections * 2 + 20),
  /** Each product's slug and, when it has more than one, its versions' ids, which have their own addresses. */
  products: z
    .array(z.strictObject({ slug: itemSlug, versions: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(250) }))
    .max(maxSnapshotProducts)
    .refine((products) => products.reduce((n, p) => n + p.versions.length, 0) <= maxSnapshotVersionPages, 'too many version pages'),
  collections: z.array(z.strictObject({ slug: itemSlug })).max(maxSnapshotCollections),
})

export type SnapshotCatalogue = z.infer<typeof snapshotCatalogueSchema>

export const catalogueSnapshotSchema = z.strictObject({
  /** 2 carries the catalogue; a build image before it refuses one, so the platform sends it only to a core that reads it. */
  version: z.union([z.literal(1), z.literal(2)]),
  catalogue: snapshotCatalogueSchema.nullable().default(null),
  /** The store's live address, which the sitemap, canonical links and robots.txt name (ARCHITECTURE §8). */
  origin,
  store: snapshotStoreSchema,
  /** The brand's name when its rule shows "Powered by" (CONSOLE-DESIGN §3 fact 18), else null. */
  poweredBy: z.string().min(1).max(100).nullable(),
  /** What the validator needs to know about the store (ARCHITECTURE §3.4). */
  guard: guardContextSchema,
  /** The page CSP's inputs (ARCHITECTURE §3.5); the check step writes each page's header from them. */
  csp: storeCspSchema,
  /** The public folder this build's JS and CSS are served from (LIVE-SHOP §5 step 7), or null for the page's own origin. */
  /**
   * The store's published blog posts, newest first (#324), so the build writes each one's page with its head and Article
   * structured data (ARCHITECTURE §8: JSON-LD is only ever in the static HTML). Empty without a blog.
   */
  posts: z
    .array(
      z.strictObject({
        path: z.string().regex(/^\/blog\/[a-z0-9]+(?:-[a-z0-9]+)*$/),
        title: z.string().min(1).max(200),
        seoTitle: optional(60),
        seoDescription: optional(160),
        author: optional(80),
        publishedAt: z.iso.datetime({ offset: true }),
        image: z.strictObject({ url: z.string().max(2048) }).nullable(),
      }),
    )
    .max(maxSnapshotPosts)
    .default([]),
  assetBase: z
    .string()
    .regex(/^(?:https:\/\/[a-z0-9.-]+|http:\/\/127\.0\.0\.1(?::\d+)?)\/(?:[A-Za-z0-9_-]+\/)*$/)
    .nullable(),
})

export type CatalogueSnapshot = z.infer<typeof catalogueSnapshotSchema>
