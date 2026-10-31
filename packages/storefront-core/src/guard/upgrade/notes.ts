import { z } from 'zod'
import { isThemePath } from '../files.js'

// Core's structured release notes (storefront ARCHITECTURE §7.1): what each release changed for themes, and the codemods
// the upgrade bot applies to every store's theme on its way to that release.

const semver = z.string().regex(/^\d+\.\d+\.\d+(-dev\.\d+)?$/)
const themePath = z.string().refine(isThemePath, 'a codemod names only theme paths')
// `*` is one path segment's characters, `**` any number of whole segments.
const glob = z.string().regex(/^[A-Za-z0-9_.*/-]{1,200}$/)

export const codemodSchema = z.discriminatedUnion('kind', [
  /** Every occurrence of `find`, literally, in the theme files `paths` match. */
  z.strictObject({ kind: z.literal('replace'), paths: z.array(glob).min(1).max(20), find: z.string().min(1).max(2000), replace: z.string().max(2000) }),
  /** A theme file moved; nothing happens when `from` is missing or `to` is taken. */
  z.strictObject({ kind: z.literal('rename'), from: themePath, to: themePath }),
])
export type Codemod = z.infer<typeof codemodSchema>

export const upgradeNoteSchema = z.strictObject({
  version: semver,
  kind: z.enum(['major', 'minor', 'patch']),
  /** A security fix reaches every store, with the baseline theme for one that can't take it (ARCHITECTURE §7). */
  security: z.boolean(),
  /** What a theme has to change, in plain words: the migration agent's instructions. */
  notes: z.string().min(1).max(8000),
  codemods: z.array(codemodSchema).max(100),
})
export type UpgradeNote = z.infer<typeof upgradeNoteSchema>

/**
 * One entry per release that changes anything for themes, added by its release card (docs/code/ARCHITECTURE.md §5
 * "Releases"); a release with no entry needs no codemod.
 */
export const coreUpgradeNotes: readonly UpgradeNote[] = [
  {
    version: '0.5.0',
    kind: 'minor',
    security: false,
    notes: [
      'Every addition is optional; no theme has to change.',
      'SearchField takes `suggest`, how many products (up to 4) to list under the box while the shopper types, each with its picture, name and sealed <Price>, then "See all results". Core renders the list (<ul role="listbox">) and a <p role="status"> for "No products match" inside the form; style them through the form\'s class, and keep the list\'s `hidden` working (never set `display` on the <ul>).',
    ].join('\n'),
    codemods: [],
  },
  {
    version: '0.4.0',
    kind: 'minor',
    security: false,
    notes: [
      'Every addition is optional, except that a product page must keep the sealed <Price> and <LegalNotices> placed when its product gives them, and stay whole with very long names and no photo (below); the publish gate refuses one that doesn\'t.',
      'The live site now builds a page for each product, version and collection, with the catalogue already in it (ARCHITECTURE §4.2): useProduct, useCollection, useListing, useProducts, useCollections and useMenu return their data on the first render there, and the browser refreshes it from the Shop API after load. The studio and the preview load as before.',
      'The publish gate checks those pages: a product page must place the sealed <Price> when the product (or the version its address names) has a price, and <LegalNotices> when the product has compliance details for the store\'s market or everywhere. A theme that shows product.legal through LegalNotices and the chosen price through Price already passes; one that hides either must place it.',
      'The long-names edge case now also stretches product and collection names and descriptions and removes their pictures, so a product page must stay whole with a 200-character name and no photo.',
      'An item page\'s title is its own (the product\'s or collection\'s search title, else its name), as useHead sets it.',
    ].join('\n'),
    codemods: [],
  },
  {
    version: '0.3.0',
    kind: 'minor',
    security: false,
    notes: [
      'Every addition is optional; no theme has to change.',
      'MerchantImage (from ./theme) draws a picture the merchant chose in Storefront › Assets. Give it the asset id as `asset`, written as a value in the theme\'s content (never an address), plus `alt` and `ratio`; it renders nothing for the content value `none`. Core fetches the file, so a theme still never writes an address.',
    ].join('\n'),
    codemods: [],
  },
  {
    version: '0.2.0',
    kind: 'minor',
    security: false,
    notes: [
      'Every addition is optional, except that a theme must not assume the delivery step is always present (below).',
      'useOrder().order.tracking is new (OrderTracking, TrackingStep, TrackingState from ./theme): an own-delivery order\'s steps, the rider while assigned, and the handover code, all in core\'s words. It is null for other orders; a theme may show it on the order page, as the baseline\'s DeliveryTracking does.',
      'Link now renders a tel: address with a dialable number as a link; any other tel: address is still refused.',
      'useCheckout skips the delivery step when a store offers exactly one shipping method and applies it for the shopper. A theme that renders the steps useCheckout gives needs no change; one that assumes a delivery step always comes between address and payment must follow the steps instead.',
      'AddressFields can end with a map pin (AddressDraft.pin, CartAddress.pin), shown only when the store has a map set up.',
      'storeCsp takes the page path, and pageHeaders passes it to the csp callback; both are used by core\'s build, not by themes.',
    ].join('\n'),
    codemods: [],
  },
]

const parts = (version: string) => version.split('-')[0]?.split('.').map(Number) ?? []
const devRun = (version: string) => Number(version.split('-dev.')[1] ?? Number.POSITIVE_INFINITY)

/** Semver order of two `x.y.z` or `x.y.z-dev.<run>` versions: negative when `a` is older; a release is newer than its dev builds. */
export const compareVersions = (a: string, b: string): number => {
  const [pa, pb] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  const [ra, rb] = [devRun(a), devRun(b)]
  return ra === rb ? 0 : ra < rb ? -1 : 1
}

/** The notes of every release after `from`, up to and including `to`, oldest first. */
export const notesBetween = (from: string, to: string, notes: readonly UpgradeNote[] = coreUpgradeNotes): UpgradeNote[] =>
  notes.filter((n) => compareVersions(n.version, from) > 0 && compareVersions(n.version, to) <= 0).sort((a, b) => compareVersions(a.version, b.version))
