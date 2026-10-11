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
})

/** An https origin, or the loopback a local run serves from. */
const origin = z.string().regex(/^(?:https:\/\/[a-z0-9.-]+|http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?)$/)

export const catalogueSnapshotSchema = z.strictObject({
  version: z.literal(1),
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
  assetBase: z
    .string()
    .regex(/^(?:https:\/\/[a-z0-9.-]+|http:\/\/127\.0\.0\.1(?::\d+)?)\/(?:[A-Za-z0-9_-]+\/)*$/)
    .nullable(),
})

export type CatalogueSnapshot = z.infer<typeof catalogueSnapshotSchema>
