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
  // Numbered for the first release after 2.0.0: the release card gives it the number of the release that ships it (§7.1).
  {
    version: '2.0.1',
    kind: 'major',
    security: false,
    notes: [
      'The address form (checkout and My addresses) shows its map with the form and a search box above it, instead of a "Pin on map" button (#1615). No theme has to change: the map, the search and their buttons are core\'s, drawn in the `--df-sealed-*` colours, and a theme restyles them through the `df-pin-search`, `df-pin-options` and `df-pin-option` classes.',
      'The fields follow the warehouse form: Name, Address, Apartment, City, State and PIN code, then Country, then Phone. Required fields show the `address.requiredMark` after their label and carry `aria-required`; `TextField` takes `required` and `requiredMark`.',
      'The message keys `address.map.open`, `move`, `confirm`, `cancel`, `close`, `hide`, `finding` and `remove` are gone, and `address.map.search`, `searchPlaceholder`, `suggestions`, `searchNone`, `searchUnavailable`, `at`, `loading`, `locateFailed` and `address.requiredMark` are new. A theme that reads a removed key from core\'s messages draws it blank; none of the starting themes does.',
    ].join('\n'),
    codemods: [],
  },
  // #1606: 2.0.0 ships #1490's sign-in pages and #1598's loading skeletons, with both cards' codemods.
  {
    version: '2.0.0',
    kind: 'major',
    security: false,
    notes: [
      'The sign-in, create-account and reset-password pages no longer guess the store\'s sign-in ways (#1490): `useSignIn()` now says `waysKnown`, false from the first draw of a live page until the Shop API has answered, and a theme draws only its heading until then, so the tabs and fields appear once, from the store\'s setting, and never jump (before, an email-only form was drawn first and the Mobile number tab or form popped in afterwards).',
      '`ways` itself is unchanged (email only until the answer, both on a preview), so a theme that does not read `waysKnown` draws as it always did. A theme that draws its own sign-in view adds `if (!s.waysKnown) return <section><h1>{title}</h1></section>` after its preview check.',
      'The codemods add that check to the shipped sign-in view of the Classic, Baseline, Beauty, Electronics, Fashion, Grocery, Home and Jewelry themes; a theme that changed the view places it itself.',
      'The starting themes draw a skeleton while a page loads (#1598): grey blocks in the page\'s own layout instead of a "Loading …" line, with a lighter band of the page colour sweeping across them every 1.6 seconds (none when the shopper asks for reduced motion). The cart shows line rows beside its summary, checkout its step cards beside the order summary, the order, account, orders and wishlist their rows and cards, the product page its picture and details, the blog and content pages their cards and lines, a collection a title bar until its name arrives, and a listing a row of grey product cells while more products load. Each view keeps its "Loading …" words for screen readers, as a hidden heading or label.',
      'No theme has to change. The codemods rewrite each loading block of a Baseline, Classic or category theme that still has the shipped markup, and add the skeleton classes to its shop styles, the `shimmer` keyframes (in `theme.css` with `--animate-shimmer`, or in Classic\'s shop and product modules) (`skeletonText`, `skeletonShort`, `skeletonTitle`, `skeletonPhoto`, `skeletonCover`, `skeletonDot`, `skeletonButton` and `srOnly`), `loadingPicture` to its product styles and `orderRow` to its account styles, and lets `ProductGrid` draw placeholder cells after its products (`placeholders`). A theme that draws its own loading states keeps them; to match, draw blocks in the theme\'s soft colour shaped like the loaded page, sweep them with the same keyframes, and keep the loading words for screen readers.',
      'Themes may show that Add to cart is working (#1292): `<AddToCart>` and `<BuyNow>` accept a function as their children, which gets `{ busy }` from the press until the engine answers, and the button carries `aria-busy` while busy. A plain child works as before.',
      'The validator lets a theme do more (2026-11-12): words and numbers may be written in the code (checked for invented prices, stock, urgency, ratings and countdowns as content is), any CSS or motion property may animate, more elements and attributes, `lucide-react` icons, Google Fonts listed in `theme.css`, and larger page budgets (200 KB JavaScript, 120 KB CSS, gzipped). A theme that passed before still passes.',
      'Core\'s `<SizeChart>` window has a cm | in switch (#1571); no theme has to change.',
    ].join('\n'),
    codemods: [
      {
        kind: 'replace',
        paths: ['src/theme/components/interactive/SignInView.tsx'],
        find: '  if (s.previewOnly) {\n    return (\n      <section className={styles.auth}>\n        <h1 className={styles.title}>{title}</h1>\n        <p className={styles.alert} role="status">\n          {t(\'shop.account.preview\')}\n        </p>\n        <Link href="/" className={shop.secondary}>\n          {t(\'shop.order.keepShopping\')}\n        </Link>\n      </section>\n    )\n  }\n\n  // Sign-in and create account offer the ways the store turned on; a code to a number makes the account, with no password.\n',
        replace: '  if (s.previewOnly) {\n    return (\n      <section className={styles.auth}>\n        <h1 className={styles.title}>{title}</h1>\n        <p className={styles.alert} role="status">\n          {t(\'shop.account.preview\')}\n        </p>\n        <Link href="/" className={shop.secondary}>\n          {t(\'shop.order.keepShopping\')}\n        </Link>\n      </section>\n    )\n  }\n\n  // The store\'s setting isn\'t known until it answers: no tabs or fields yet, so the form is drawn once, from the setting, and never jumps (#1490).\n  if (!s.waysKnown) {\n    return (\n      <section className={styles.auth} aria-busy="true">\n        <h1 className={styles.title}>{title}</h1>\n      </section>\n    )\n  }\n\n  // Sign-in and create account offer the ways the store turned on; a code to a number makes the account, with no password.\n',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/interactive/SignInView.tsx'],
        find: '  if (s.previewOnly) {\n    return (\n      <section className={styles.auth}>\n        <h1 className={styles.title}>{title}</h1>\n        <p className={styles.alert} role="status">\n          {t(\'shop.account.preview\')}\n        </p>\n        <Link href="/" className={shop.secondary}>\n          {t(\'shop.order.keepShopping\')}\n        </Link>\n      </section>\n    )\n  }\n\n  const byPhone = purpose === \'signIn\' && (channel === \'phone\' || !s.ways.email)\n',
        replace: '  if (s.previewOnly) {\n    return (\n      <section className={styles.auth}>\n        <h1 className={styles.title}>{title}</h1>\n        <p className={styles.alert} role="status">\n          {t(\'shop.account.preview\')}\n        </p>\n        <Link href="/" className={shop.secondary}>\n          {t(\'shop.order.keepShopping\')}\n        </Link>\n      </section>\n    )\n  }\n\n  // The store\'s setting isn\'t known until it answers: no tabs or fields yet, so the form is drawn once, from the setting, and never jumps (#1490).\n  if (!s.waysKnown) {\n    return (\n      <section className={styles.auth} aria-busy="true">\n        <h1 className={styles.title}>{title}</h1>\n      </section>\n    )\n  }\n\n  const byPhone = purpose === \'signIn\' && (channel === \'phone\' || !s.ways.email)\n',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/interactive/CartView.tsx'],
        find: '        <h1 className={shop.title}>{t(\'shop.cart.title\')}</h1>\n        <p className={shop.lead}>{t(\'shop.cart.loading\')}</p>\n      </section>',
        replace: '        <h1 className={shop.title}>{t(\'shop.cart.title\')}</h1>\n        <p className={shop.srOnly}>{t(\'shop.cart.loading\')}</p>\n        <div className={styles.cart}>\n          <ul className={styles.lines}>\n            {[0, 1].map((i) => (\n              <li key={i} className={styles.line}>\n                <span className={shop.skeletonPhoto} />\n                <div className={styles.info}>\n                  <span className={shop.skeletonText} />\n                  <span className={shop.skeletonShort} />\n                </div>\n              </li>\n            ))}\n          </ul>\n          <aside className={styles.side}>\n            <h2 className={styles.sideTitle}>{t(\'shop.cart.summary\')}</h2>\n            <span className={shop.skeletonText} />\n            <span className={shop.skeletonText} />\n            <span className={shop.skeletonShort} />\n            <span className={shop.skeletonButton} />\n          </aside>\n        </div>\n      </section>',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/interactive/CheckoutView.tsx'],
        find: '    return (\n      <section className={shop.page} aria-busy="true">\n        <h1 className={shop.title}>{t(\'shop.checkout.title\')}</h1>\n        <p className={shop.lead}>{t(\'shop.checkout.loading\')}</p>\n      </section>',
        replace: '    return (\n      <section className={styles.page} aria-busy="true">\n        <h1 className={styles.title}>{t(\'shop.checkout.title\')}</h1>\n        <p className={shop.srOnly}>{t(\'shop.checkout.loading\')}</p>\n        <div className={styles.layout}>\n          <ol className={styles.steps}>\n            {[0, 1, 2, 3].map((i) => (\n              <li key={i} className={styles.step}>\n                <div className={styles.stepHead}>\n                  <span className={shop.skeletonDot} />\n                  <span className={shop.skeletonText} />\n                </div>\n              </li>\n            ))}\n          </ol>\n          <aside className={styles.side}>\n            <h2 className={styles.sideTitle}>{t(\'shop.checkout.summary\')}</h2>\n            <span className={shop.skeletonText} />\n            <span className={shop.skeletonText} />\n            <span className={shop.skeletonShort} />\n          </aside>\n        </div>\n      </section>',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/interactive/OrderView.tsx'],
        find: '      <section className={shop.page} aria-busy="true">\n        <h1 className={shop.title}>{t(\'shop.order.loading\')}</h1>\n      </section>',
        replace: '      <section className={shop.page} aria-busy="true">\n        <h1 className={shop.srOnly}>{t(\'shop.order.loading\')}</h1>\n        <div className={styles.order}>\n          <div className={styles.main}>\n            <div className={styles.head}>\n              <span className={shop.skeletonTitle} />\n              <span className={shop.skeletonShort} />\n            </div>\n            <div className={styles.card}>\n              <span className={shop.skeletonText} />\n              <span className={shop.skeletonText} />\n              <span className={shop.skeletonShort} />\n            </div>\n          </div>\n          <aside className={styles.side}>\n            {[0, 1, 2].map((i) => (\n              <span key={i} className={shop.skeletonText} />\n            ))}\n            <span className={shop.skeletonShort} />\n          </aside>\n        </div>\n      </section>',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/interactive/AccountView.tsx'],
        find: '      <section className={shop.page} aria-busy="true">\n        <h1 className={shop.title}>{t(\'pages.account.title\')}</h1>\n      </section>',
        replace: '      <section className={shop.page} aria-busy="true">\n        <div className={styles.hello}>\n          <h1 className={styles.title}>{t(\'pages.account.title\')}</h1>\n        </div>\n        <div className={styles.account}>\n          <div className={styles.nav}>\n            {[0, 1, 2, 3].map((i) => (\n              <span key={i} className={shop.skeletonShort} />\n            ))}\n          </div>\n          <div className={styles.card}>\n            <span className={shop.skeletonTitle} />\n            <span className={shop.skeletonText} />\n            <span className={shop.skeletonText} />\n          </div>\n        </div>\n      </section>',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/interactive/AccountView.tsx'],
        find: '      <Card title={t(\'shop.orders.title\')}>\n        <p className={styles.note} aria-busy="true">\n          {t(\'shop.orders.loading\')}\n        </p>\n      </Card>',
        replace: '      <Card title={t(\'shop.orders.title\')}>\n        <div aria-busy="true">\n          <p className={shop.srOnly}>{t(\'shop.orders.loading\')}</p>\n          <ul className={styles.orders}>\n            {[0, 1, 2].map((i) => (\n              <li key={i} className={styles.orderRow}>\n                <span className={shop.skeletonShort} />\n                <span className={shop.skeletonShort} />\n              </li>\n            ))}\n          </ul>\n        </div>\n      </Card>',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/interactive/WishlistList.tsx'],
        find: '        <h2 className={styles.cardTitle}>{t(\'shop.wishlist.title\')}</h2>\n        <p className={styles.note} aria-busy="true">\n          {t(\'shop.wishlist.loading\')}\n        </p>\n      </div>',
        replace: '        <h2 className={styles.cardTitle}>{t(\'shop.wishlist.title\')}</h2>\n        <ul className={styles.wishlist} aria-busy="true" aria-label={t(\'shop.wishlist.loading\')}>\n          {[0, 1, 2].map((i) => (\n            <li key={i} className={styles.wished}>\n              <div className={shop.skeletonPicture} />\n              <span className={shop.skeletonText} />\n              <span className={shop.skeletonShort} />\n              <span className={shop.skeletonButton} />\n              <span className={shop.skeletonButton} />\n            </li>\n          ))}\n        </ul>\n      </div>',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/interactive/BlogView.tsx'],
        find: '      </header>\n      {blog.status === \'loading\' ? <p className={shop.lead}>{t(\'pages.blog.loading\')}</p> : null}\n      {blog.status === \'error\' ? (',
        replace: '      </header>\n      {blog.status === \'loading\' ? (\n        <div className={styles.posts} aria-busy="true" aria-label={t(\'pages.blog.loading\')}>\n          {[0, 1, 2].map((i) => (\n            <div key={i} className={styles.post}>\n              <span className={shop.skeletonCover} />\n              <span className={shop.skeletonShort} />\n              <span className={shop.skeletonText} />\n            </div>\n          ))}\n        </div>\n      ) : null}\n      {blog.status === \'error\' ? (',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/interactive/BlogPostView.tsx'],
        find: '    return (\n      <section className={shop.page} aria-busy="true">\n        <h1 className={shop.title}>{t(\'pages.blog.loadingPost\')}</h1>\n      </section>\n    )',
        replace: '    return (\n      <article className={styles.article} aria-busy="true">\n        <h1 className={shop.srOnly}>{t(\'pages.blog.loadingPost\')}</h1>\n        <span className={shop.skeletonShort} />\n        <span className={shop.skeletonTitle} />\n        <span className={shop.skeletonCover} />\n        {[0, 1, 2, 3].map((i) => (\n          <span key={i} className={shop.skeletonText} />\n        ))}\n      </article>\n    )',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/interactive/ContentView.tsx'],
        find: '    return (\n      <section className={shop.page} aria-busy="true">\n        <h1 className={shop.title}>{t(\'pages.content.loading\')}</h1>\n      </section>\n    )',
        replace: '    return (\n      <article className={styles.article} aria-busy="true">\n        <h1 className={shop.srOnly}>{t(\'pages.content.loading\')}</h1>\n        <span className={shop.skeletonTitle} />\n        {[0, 1, 2, 3].map((i) => (\n          <span key={i} className={shop.skeletonText} />\n        ))}\n        <span className={shop.skeletonShort} />\n      </article>\n    )',
      },
      {
        kind: 'replace',
        paths: ['src/theme/pages/ProductPage.tsx'],
        find: '            <div className={styles.product} aria-busy="true">\n              <div className={styles.noPicture} />\n              <div className={styles.info}>\n                <h1 className={styles.loadingTitle}>{t(\'shop.product.loading\')}</h1>\n              </div>',
        replace: '            <div className={styles.product} aria-busy="true">\n              <div className={styles.loadingPicture} />\n              <div className={styles.info}>\n                <h1 className={shop.srOnly}>{t(\'shop.product.loading\')}</h1>\n                <span className={shop.skeletonTitle} />\n                <span className={shop.skeletonShort} />\n                <span className={shop.skeletonButton} />\n                <span className={shop.skeletonText} />\n                <span className={shop.skeletonText} />\n                <span className={shop.skeletonText} />\n              </div>',
      },
      {
        kind: 'replace',
        paths: ['src/theme/pages/CollectionPage.tsx'],
        find: '            <header className={styles.intro}>\n              <h1 className={styles.title}>{name ?? t(\'shop.collection.loading\')}</h1>\n              {lead ? <p className={styles.lead}>{lead}</p> : null}',
        replace: '            <header className={styles.intro}>\n              {name !== null ? (\n                <h1 className={styles.title}>{name}</h1>\n              ) : (\n                <>\n                  <h1 className={styles.srOnly}>{t(\'shop.collection.loading\')}</h1>\n                  <span className={styles.skeletonTitle} />\n                </>\n              )}\n              {lead ? <p className={styles.lead}>{lead}</p> : null}',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/interactive/Filters.tsx'],
        find: '      {listing.loadingMore ? (\n        <p className={styles.muted} role="status">\n          {t(\'shop.listing.loadingMore\')}',
        replace: '      {listing.loadingMore ? (\n        <p className={styles.srOnly} role="status">\n          {t(\'shop.listing.loadingMore\')}',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/ListingResults.tsx'],
        find: '        ) : null}\n        {listing.status === \'ready\' ? <ProductGrid products={listing.items} /> : null}\n        <MoreOnScroll listing={listing} />',
        replace: '        ) : null}\n        {listing.status === \'ready\' ? <ProductGrid products={listing.items} placeholders={listing.loadingMore ? 4 : 0} /> : null}\n        <MoreOnScroll listing={listing} />',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/ProductCard.tsx'],
        find: '      ) : null}\n    </article>\n  )\n}\n\nexport const ProductGrid = ({ products, wide = false }: { products: readonly Card[]; wide?: boolean }) => (\n  <ul className={wide ? styles.gridWide : styles.grid}>\n    {products.map((p) => (\n      <li key={p.id} className={styles.cell}>\n        <ProductCard product={p} />\n      </li>\n    ))}\n  </ul>\n)\n\n/** The grid\'s shape while its products load, so nothing moves when they arrive. */\nexport const GridPlaceholder = ({ label, count }: { label: string; count: number }) => (',
        replace: '      ) : null}\n    </article>\n  )\n}\n\n/** `placeholders`: that many cells shaped like the placeholder\'s, after the products, while more load. */\nexport const ProductGrid = ({ products, wide = false, placeholders = 0 }: { products: readonly Card[]; wide?: boolean; placeholders?: number }) => (\n  <ul className={wide ? styles.gridWide : styles.grid} aria-busy={placeholders > 0 || undefined}>\n    {products.map((p) => (\n      <li key={p.id} className={styles.cell}>\n        <ProductCard product={p} />\n      </li>\n    ))}\n    {[...Array(placeholders).keys()].map((i) => (\n      <li key={i} className={styles.cell}>\n        <div className={styles.skeletonPicture} />\n        <div className={styles.skeletonLine} />\n      </li>\n    ))}\n  </ul>\n)\n\n/** The grid\'s shape while its products load, so nothing moves when they arrive. */\nexport const GridPlaceholder = ({ label, count }: { label: string; count: number }) => (',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/styles/shop.tsx'],
        find: '  secondary: clsx(\'py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer bg-surface text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]\'),\n  skeletonLine: clsx(\'mt-3 w-[60%] h-3.5 rounded-[6px] bg-soft\'),\n  skeletonPicture: clsx(\'aspect-[4/5] rounded-card bg-soft\'),\n  soldOut: clsx(\'py-0.75 px-2.5 absolute rounded-full text-[12px] font-semibold top-auto right-2.5 bottom-2.5 left-auto bg-ink text-bg\'),',
        replace: '  secondary: clsx(\'py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer bg-surface text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]\'),\n  skeletonLine: clsx(\'mt-3 w-[60%] h-3.5 rounded-[6px] bg-soft animate-shimmer\'),\n  skeletonPicture: clsx(\'aspect-[4/5] rounded-card bg-soft animate-shimmer\'),\n  skeletonButton: clsx(\'block w-full h-12 rounded-button bg-soft animate-shimmer\'),\n  skeletonCover: clsx(\'block aspect-[3/2] rounded-card bg-soft animate-shimmer\'),\n  skeletonDot: clsx(\'block w-6.5 h-6.5 shrink-0 rounded-full bg-soft animate-shimmer\'),\n  skeletonPhoto: clsx(\'block w-22 h-27.5 rounded-[calc(var(--radius-card)_-_4px)] bg-soft animate-shimmer\'),\n  skeletonShort: clsx(\'block w-[40%] h-3.5 rounded-[6px] bg-soft animate-shimmer\'),\n  skeletonText: clsx(\'block w-full max-w-[28rem] h-3.5 rounded-[6px] bg-soft animate-shimmer\'),\n  skeletonTitle: clsx(\'block w-[min(100%,16rem)] h-7 rounded-[8px] bg-soft animate-shimmer\'),\n  srOnly: clsx(\'absolute overflow-hidden w-px h-px -m-px p-0 border-0 [clip-path:inset(50%)] whitespace-nowrap\'),\n  soldOut: clsx(\'py-0.75 px-2.5 absolute rounded-full text-[12px] font-semibold top-auto right-2.5 bottom-2.5 left-auto bg-ink text-bg\'),',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/styles/product.tsx'],
        find: '  legal: clsx(\'block w-full [--df-sealed-size:14px]\'),\n  loadingTitle: clsx(\'m-0 font-heading font-[var(--heading-weight)] tracking-[var(--heading-spacing)] leading-[1.15] wrap-anywhere [text-transform:var(--heading-case)] text-muted text-[20px]\'),\n  media: clsx(\'block w-full h-full object-cover\'),\n  noPicture: clsx(\'aspect-[4/5] rounded-card [background:var(--picture-alt)]\'),',
        replace: '  legal: clsx(\'block w-full [--df-sealed-size:14px]\'),\n  media: clsx(\'block w-full h-full object-cover\'),\n  loadingPicture: clsx(\'aspect-[4/5] rounded-card bg-soft animate-shimmer\'),\n  noPicture: clsx(\'aspect-[4/5] rounded-card [background:var(--picture-alt)]\'),',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/styles/account.tsx'],
        find: '  order: clsx(\'p-4 border border-line flex items-center justify-between gap-y-3 gap-x-3 rounded-card bg-surface text-ink no-underline hover:border-ink-soft focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]\'),\n  orderFacts: clsx(\'flex min-w-0 flex-col gap-y-1 gap-x-1\'),',
        replace: '  order: clsx(\'p-4 border border-line flex items-center justify-between gap-y-3 gap-x-3 rounded-card bg-surface text-ink no-underline hover:border-ink-soft focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]\'),\n  orderRow: clsx(\'p-4 border border-line flex items-center justify-between gap-y-3 gap-x-3 rounded-card bg-surface\'),\n  orderFacts: clsx(\'flex min-w-0 flex-col gap-y-1 gap-x-1\'),',
      },
      {
        kind: 'replace',
        paths: ['src/theme/styles/theme.css'],
        find: '  --picture-alt: linear-gradient(160deg, #e2dcc4, #c8bc98);\n}\n',
        replace: '  --picture-alt: linear-gradient(160deg, #e2dcc4, #c8bc98);\n  --animate-shimmer: shimmer 1.6s linear infinite;\n}\n\n@keyframes shimmer {\n  0% {\n    background: linear-gradient(90deg, var(--color-soft) 40%, var(--color-bg) 50%, var(--color-soft) 60%) 150% 0 / 200% 100% var(--color-soft);\n  }\n  40%,\n  100% {\n    background: linear-gradient(90deg, var(--color-soft) 40%, var(--color-bg) 50%, var(--color-soft) 60%) -50% 0 / 200% 100% var(--color-soft);\n  }\n}\n',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/ProductCard.tsx'],
        find: '        <p className={styles.cardPrice}>\n          {product.from ? <span className={styles.from}>{t(\'shop.card.from\')}</span> : null}\n          <Price money={product.price} compareAt={product.compareAt} includesTax={store.pricesIncludeTax} locale={locale} t={t} className={styles.price} />\n        </p>\n      ) : null}\n    </article>\n  )\n}\n\nexport const ProductGrid = ({ products, wide = false }: { products: readonly Card[]; wide?: boolean }) => (\n  <ul className={wide ? styles.gridWide : styles.grid}>\n    {products.map((p) => (\n      <li key={p.id} className={styles.cell}>\n        <ProductCard product={p} />\n      </li>\n    ))}\n  </ul>\n)\n\n/** The grid\'s shape while its products load, so nothing moves when they arrive. */\nexport const GridPlaceholder = ({ label, count, wide = false }: { label: string; count: number; wide?: boolean }) => (\n  <ul className={wide ? styles.gridWide : styles.grid} aria-busy="true" aria-label={label}>\n    {[...Array(count).keys()].map((i) => (\n      <li key={i} className={styles.cell}>\n        <div className={styles.skeletonCard}>',
        replace: '        <p className={styles.cardPrice}>\n          {product.from ? <span className={styles.from}>{t(\'shop.card.from\')}</span> : null}\n          <Price money={product.price} compareAt={product.compareAt} includesTax={store.pricesIncludeTax} locale={locale} t={t} className={styles.price} />\n        </p>\n      ) : null}\n    </article>\n  )\n}\n\n/** `placeholders`: that many cells shaped like the placeholder\'s, after the products, while more load. */\nexport const ProductGrid = ({ products, wide = false, placeholders = 0 }: { products: readonly Card[]; wide?: boolean; placeholders?: number }) => (\n  <ul className={wide ? styles.gridWide : styles.grid} aria-busy={placeholders > 0 || undefined}>\n    {products.map((p) => (\n      <li key={p.id} className={styles.cell}>\n        <ProductCard product={p} />\n      </li>\n    ))}\n    {[...Array(placeholders).keys()].map((i) => (\n      <li key={i} className={styles.cell}>\n        <div className={styles.skeletonCard}>\n          <div className={styles.skeletonPicture} />\n          <div className={styles.skeletonLine} />\n        </div>\n      </li>\n    ))}\n  </ul>\n)\n\n/** The grid\'s shape while its products load, so nothing moves when they arrive. */\nexport const GridPlaceholder = ({ label, count, wide = false }: { label: string; count: number; wide?: boolean }) => (\n  <ul className={wide ? styles.gridWide : styles.grid} aria-busy="true" aria-label={label}>\n    {[...Array(count).keys()].map((i) => (\n      <li key={i} className={styles.cell}>\n        <div className={styles.skeletonCard}>',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/styles/shop.tsx'],
        find: '  skeletonCard: clsx(\'h-full box-border flex flex-col gap-y-3 rounded-card bg-soft p-2.5 pb-4 min-[900px]:p-3 min-[900px]:pb-5\'),\n  skeletonLine: clsx(\'w-[60%] h-3.5 rounded-[6px] bg-tint\'),\n  skeletonPicture: clsx(\'aspect-square rounded-[16px] bg-tint\'),\n  soldOut: clsx(\'py-0.75 px-2.5 absolute rounded-full text-[12px] font-semibold top-auto right-2.5 bottom-2.5 left-auto bg-ink text-bg\'),',
        replace: '  skeletonCard: clsx(\'h-full box-border flex flex-col gap-y-3 rounded-card bg-soft p-2.5 pb-4 min-[900px]:p-3 min-[900px]:pb-5\'),\n  skeletonLine: clsx(\'w-[60%] h-3.5 rounded-[6px] bg-tint animate-shimmer\'),\n  skeletonPicture: clsx(\'aspect-square rounded-[16px] bg-tint animate-shimmer\'),\n  skeletonButton: clsx(\'block w-full h-12 rounded-button bg-tint animate-shimmer\'),\n  skeletonCover: clsx(\'block aspect-[3/2] rounded-card bg-tint animate-shimmer\'),\n  skeletonDot: clsx(\'block w-6.5 h-6.5 shrink-0 rounded-full bg-tint animate-shimmer\'),\n  skeletonPhoto: clsx(\'block w-22 h-27.5 rounded-[calc(var(--radius-card)_-_4px)] bg-tint animate-shimmer\'),\n  skeletonShort: clsx(\'block w-[40%] h-3.5 rounded-[6px] bg-tint animate-shimmer\'),\n  skeletonText: clsx(\'block w-full max-w-[28rem] h-3.5 rounded-[6px] bg-tint animate-shimmer\'),\n  skeletonTitle: clsx(\'block w-[min(100%,16rem)] h-7 rounded-[8px] bg-tint animate-shimmer\'),\n  srOnly: clsx(\'absolute overflow-hidden w-px h-px -m-px p-0 border-0 [clip-path:inset(50%)] whitespace-nowrap\'),\n  soldOut: clsx(\'py-0.75 px-2.5 absolute rounded-full text-[12px] font-semibold top-auto right-2.5 bottom-2.5 left-auto bg-ink text-bg\'),',
      },
      {
        kind: 'replace',
        paths: ['src/theme/styles/theme.css'],
        find: '  --color-tone-3d2232-18: rgb(61 34 50 / 0.18);\n}\n',
        replace: '  --color-tone-3d2232-18: rgb(61 34 50 / 0.18);\n  --animate-shimmer: shimmer 1.6s linear infinite;\n}\n\n@keyframes shimmer {\n  0% {\n    background: linear-gradient(90deg, var(--color-tint) 40%, var(--color-bg) 50%, var(--color-tint) 60%) 150% 0 / 200% 100% var(--color-tint);\n  }\n  40%,\n  100% {\n    background: linear-gradient(90deg, var(--color-tint) 40%, var(--color-bg) 50%, var(--color-tint) 60%) -50% 0 / 200% 100% var(--color-tint);\n  }\n}\n',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/ProductCard.tsx'],
        find: '      </Link>\n    </article>\n  )\n}\n\nexport const ProductGrid = ({ products, wide = false }: { products: readonly Card[]; wide?: boolean }) => (\n  <ul className={wide ? styles.gridWide : styles.grid}>\n    {products.map((p) => (\n      <li key={p.id} className={styles.cell}>\n        <ProductCard product={p} />\n      </li>\n    ))}\n  </ul>\n)\n\n/** The grid\'s shape while its products load, so nothing moves when they arrive. */\nexport const GridPlaceholder = ({ label, count }: { label: string; count: number }) => (',
        replace: '      </Link>\n    </article>\n  )\n}\n\n/** `placeholders`: that many cells shaped like the placeholder\'s, after the products, while more load. */\nexport const ProductGrid = ({ products, wide = false, placeholders = 0 }: { products: readonly Card[]; wide?: boolean; placeholders?: number }) => (\n  <ul className={wide ? styles.gridWide : styles.grid} aria-busy={placeholders > 0 || undefined}>\n    {products.map((p) => (\n      <li key={p.id} className={styles.cell}>\n        <ProductCard product={p} />\n      </li>\n    ))}\n    {[...Array(placeholders).keys()].map((i) => (\n      <li key={i} className={styles.cell}>\n        <div className={styles.skeletonPicture} />\n        <div className={styles.skeletonLine} />\n      </li>\n    ))}\n  </ul>\n)\n\n/** The grid\'s shape while its products load, so nothing moves when they arrive. */\nexport const GridPlaceholder = ({ label, count }: { label: string; count: number }) => (',
      },
      {
        kind: 'replace',
        paths: ['src/theme/styles/shop.module.css'],
        find: '  background: var(--soft);\n}\n\n.notice {\n  display: flex;\n  flex-direction: column;',
        replace: '  background: var(--soft);\n}\n\n.skeletonText,\n.skeletonShort,\n.skeletonTitle,\n.skeletonPhoto,\n.skeletonCover,\n.skeletonDot,\n.skeletonButton {\n  display: block;\n  border-radius: 6px;\n  background: var(--soft);\n}\n\n.skeletonText {\n  width: 100%;\n  max-width: 28rem;\n  height: 14px;\n}\n\n.skeletonShort {\n  width: 40%;\n  height: 14px;\n}\n\n.skeletonTitle {\n  width: min(100%, 16rem);\n  height: 28px;\n  border-radius: 8px;\n}\n\n.skeletonPhoto {\n  width: 88px;\n  height: 110px;\n  border-radius: calc(var(--radius) - 4px);\n}\n\n.skeletonCover {\n  aspect-ratio: 3 / 2;\n  border-radius: var(--radius);\n}\n\n.skeletonDot {\n  flex-shrink: 0;\n  width: 26px;\n  height: 26px;\n  border-radius: 50%;\n}\n\n.skeletonButton {\n  width: 100%;\n  height: 48px;\n  border-radius: var(--button-radius);\n}\n\n.skeletonPicture,\n.skeletonLine,\n.skeletonText,\n.skeletonShort,\n.skeletonTitle,\n.skeletonPhoto,\n.skeletonCover,\n.skeletonDot,\n.skeletonButton {\n  animation: shimmer 1.6s linear infinite;\n}\n\n@keyframes shimmer {\n  0% {\n    background: linear-gradient(90deg, var(--soft) 40%, var(--bg) 50%, var(--soft) 60%) 150% 0 / 200% 100% var(--soft);\n  }\n  40%,\n  100% {\n    background: linear-gradient(90deg, var(--soft) 40%, var(--bg) 50%, var(--soft) 60%) -50% 0 / 200% 100% var(--soft);\n  }\n}\n\n.srOnly {\n  position: absolute;\n  overflow: hidden;\n  width: 1px;\n  height: 1px;\n  margin: -1px;\n  padding: 0;\n  border: 0;\n  clip-path: inset(50%);\n  white-space: nowrap;\n}\n\n.notice {\n  display: flex;\n  flex-direction: column;',
      },
      {
        kind: 'replace',
        paths: ['src/theme/styles/product.module.css'],
        find: '  background: var(--picture-alt);\n}\n\n.thumbs {\n  display: flex;\n  flex-wrap: wrap;',
        replace: '  background: var(--picture-alt);\n}\n\n.loadingPicture {\n  aspect-ratio: 4 / 5;\n  border-radius: var(--radius);\n  background: var(--soft);\n  animation: shimmer 1.6s linear infinite;\n}\n\n@keyframes shimmer {\n  0% {\n    background: linear-gradient(90deg, var(--soft) 40%, var(--bg) 50%, var(--soft) 60%) 150% 0 / 200% 100% var(--soft);\n  }\n  40%,\n  100% {\n    background: linear-gradient(90deg, var(--soft) 40%, var(--bg) 50%, var(--soft) 60%) -50% 0 / 200% 100% var(--soft);\n  }\n}\n\n.thumbs {\n  display: flex;\n  flex-wrap: wrap;',
      },
      {
        kind: 'replace',
        paths: ['src/theme/styles/product.module.css'],
        find: '\n.title,\n.loadingTitle {\n  margin: 0;',
        replace: '\n.title {\n  margin: 0;',
      },
      {
        kind: 'replace',
        paths: ['src/theme/styles/product.module.css'],
        find: '\n.loadingTitle {\n  color: var(--muted);\n  font-size: 20px;\n}\n\n.price {',
        replace: '\n.price {',
      },
      {
        kind: 'replace',
        paths: ['src/theme/styles/account.module.css'],
        find: '\n.order {\n  display: flex;',
        replace: '\n.order,\n.orderRow {\n  display: flex;',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/ProductCard.tsx'],
        find: '        <p className={styles.cardPrice}>\n          {product.from ? <span className={styles.from}>{t(\'shop.card.from\')}</span> : null}\n          <Price money={product.price} compareAt={product.compareAt} includesTax={store.pricesIncludeTax} locale={locale} t={t} className={styles.price} />\n        </p>\n      ) : null}\n    </article>\n  )\n}\n\nexport const ProductGrid = ({ products, wide = false }: { products: readonly Card[]; wide?: boolean }) => (\n  <ul className={wide ? styles.gridWide : styles.grid}>\n    {products.map((p) => (\n      <li key={p.id} className={styles.cell}>\n        <ProductCard product={p} />\n      </li>\n    ))}\n  </ul>\n)\n\n/** The grid\'s shape while its products load, so nothing moves when they arrive. */\nexport const GridPlaceholder = ({ label, count, wide = false }: { label: string; count: number; wide?: boolean }) => (\n  <ul className={wide ? styles.gridWide : styles.grid} aria-busy="true" aria-label={label}>\n    {[...Array(count).keys()].map((i) => (\n      <li key={i} className={styles.cell}>\n        <div className={styles.skeletonPicture} />',
        replace: '        <p className={styles.cardPrice}>\n          {product.from ? <span className={styles.from}>{t(\'shop.card.from\')}</span> : null}\n          <Price money={product.price} compareAt={product.compareAt} includesTax={store.pricesIncludeTax} locale={locale} t={t} className={styles.price} />\n        </p>\n      ) : null}\n    </article>\n  )\n}\n\n/** `placeholders`: that many cells shaped like the placeholder\'s, after the products, while more load. */\nexport const ProductGrid = ({ products, wide = false, placeholders = 0 }: { products: readonly Card[]; wide?: boolean; placeholders?: number }) => (\n  <ul className={wide ? styles.gridWide : styles.grid} aria-busy={placeholders > 0 || undefined}>\n    {products.map((p) => (\n      <li key={p.id} className={styles.cell}>\n        <ProductCard product={p} />\n      </li>\n    ))}\n    {[...Array(placeholders).keys()].map((i) => (\n      <li key={i} className={styles.cell}>\n        <div className={styles.skeletonPicture} />\n        <div className={styles.skeletonLine} />\n      </li>\n    ))}\n  </ul>\n)\n\n/** The grid\'s shape while its products load, so nothing moves when they arrive. */\nexport const GridPlaceholder = ({ label, count, wide = false }: { label: string; count: number; wide?: boolean }) => (\n  <ul className={wide ? styles.gridWide : styles.grid} aria-busy="true" aria-label={label}>\n    {[...Array(count).keys()].map((i) => (\n      <li key={i} className={styles.cell}>\n        <div className={styles.skeletonPicture} />',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/styles/shop.tsx'],
        find: '  secondary: clsx(\'py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer bg-surface text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]\'),\n  skeletonLine: clsx(\'mt-3 w-[60%] h-3.5 rounded-[6px] bg-soft\'),\n  skeletonPicture: clsx(\'aspect-square rounded-card bg-soft\'),\n  soldOut: clsx(\'py-0.75 px-2.5 absolute rounded-full text-[12px] font-semibold top-auto right-2.5 bottom-2.5 left-auto bg-ink text-bg\'),',
        replace: '  secondary: clsx(\'py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer bg-surface text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]\'),\n  skeletonLine: clsx(\'mt-3 w-[60%] h-3.5 rounded-[6px] bg-soft animate-shimmer\'),\n  skeletonPicture: clsx(\'aspect-square rounded-card bg-soft animate-shimmer\'),\n  skeletonButton: clsx(\'block w-full h-12 rounded-button bg-soft animate-shimmer\'),\n  skeletonCover: clsx(\'block aspect-[3/2] rounded-card bg-soft animate-shimmer\'),\n  skeletonDot: clsx(\'block w-6.5 h-6.5 shrink-0 rounded-full bg-soft animate-shimmer\'),\n  skeletonPhoto: clsx(\'block w-22 h-27.5 rounded-[calc(var(--radius-card)_-_4px)] bg-soft animate-shimmer\'),\n  skeletonShort: clsx(\'block w-[40%] h-3.5 rounded-[6px] bg-soft animate-shimmer\'),\n  skeletonText: clsx(\'block w-full max-w-[28rem] h-3.5 rounded-[6px] bg-soft animate-shimmer\'),\n  skeletonTitle: clsx(\'block w-[min(100%,16rem)] h-7 rounded-[8px] bg-soft animate-shimmer\'),\n  srOnly: clsx(\'absolute overflow-hidden w-px h-px -m-px p-0 border-0 [clip-path:inset(50%)] whitespace-nowrap\'),\n  soldOut: clsx(\'py-0.75 px-2.5 absolute rounded-full text-[12px] font-semibold top-auto right-2.5 bottom-2.5 left-auto bg-ink text-bg\'),',
      },
      {
        kind: 'replace',
        paths: ['src/theme/styles/theme.css'],
        find: '  --color-shade-92: rgb(11 13 18 / 0.92);\n}\n',
        replace: '  --color-shade-92: rgb(11 13 18 / 0.92);\n  --animate-shimmer: shimmer 1.6s linear infinite;\n}\n\n@keyframes shimmer {\n  0% {\n    background: linear-gradient(90deg, var(--color-soft) 40%, var(--color-bg) 50%, var(--color-soft) 60%) 150% 0 / 200% 100% var(--color-soft);\n  }\n  40%,\n  100% {\n    background: linear-gradient(90deg, var(--color-soft) 40%, var(--color-bg) 50%, var(--color-soft) 60%) -50% 0 / 200% 100% var(--color-soft);\n  }\n}\n',
      },
      {
        kind: 'replace',
        paths: ['src/theme/styles/theme.css'],
        find: '  --color-shade-60: rgb(0 0 0 / 0.6);\n}\n',
        replace: '  --color-shade-60: rgb(0 0 0 / 0.6);\n  --animate-shimmer: shimmer 1.6s linear infinite;\n}\n\n@keyframes shimmer {\n  0% {\n    background: linear-gradient(90deg, var(--color-soft) 40%, var(--color-bg) 50%, var(--color-soft) 60%) 150% 0 / 200% 100% var(--color-soft);\n  }\n  40%,\n  100% {\n    background: linear-gradient(90deg, var(--color-soft) 40%, var(--color-bg) 50%, var(--color-soft) 60%) -50% 0 / 200% 100% var(--color-soft);\n  }\n}\n',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/ProductCard.tsx'],
        find: '    </article>\n  )\n}\n\nexport const ProductGrid = ({ products, wide = false }: { products: readonly Card[]; wide?: boolean }) => (\n  <ul className={wide ? styles.gridWide : styles.grid}>\n    {products.map((p) => (\n      <li key={p.id} className={styles.cell}>\n        <ProductCard product={p} />\n      </li>\n    ))}\n  </ul>\n)\n\n/** The grid\'s shape while its products load, so nothing moves when they arrive; `list` and `cell` match the loaded grid. */',
        replace: '    </article>\n  )\n}\n\n/** `placeholders`: that many cells shaped like the placeholder\'s, after the products, while more load. */\nexport const ProductGrid = ({ products, wide = false, placeholders = 0 }: { products: readonly Card[]; wide?: boolean; placeholders?: number }) => (\n  <ul className={wide ? styles.gridWide : styles.grid} aria-busy={placeholders > 0 || undefined}>\n    {products.map((p) => (\n      <li key={p.id} className={styles.cell}>\n        <ProductCard product={p} />\n      </li>\n    ))}\n    {[...Array(placeholders).keys()].map((i) => (\n      <li key={i} className={styles.cell}>\n        <div className={styles.skeletonCard}>\n          <div className={styles.skeletonPicture} />\n          <div className={styles.skeletonLine} />\n        </div>\n      </li>\n    ))}\n  </ul>\n)\n\n/** The grid\'s shape while its products load, so nothing moves when they arrive; `list` and `cell` match the loaded grid. */',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/styles/shop.tsx'],
        find: '  secondary: clsx(\'py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer bg-surface text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]\'),\n  skeletonLine: clsx(\'mt-3 w-[60%] h-3.5 rounded-[6px] bg-soft\'),\n  skeletonCard: clsx(\'box-border p-2.5 border border-line rounded-card bg-surface\'),\n  skeletonPicture: clsx(\'aspect-square rounded-[9px] bg-soft\'),\n  soldOut: clsx(\'py-0.5 px-2 absolute rounded-[6px] text-[11px] font-bold top-2 right-2 bottom-auto left-auto bg-ink text-bg\'),',
        replace: '  secondary: clsx(\'py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer bg-surface text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]\'),\n  skeletonLine: clsx(\'mt-3 w-[60%] h-3.5 rounded-[6px] bg-soft animate-shimmer\'),\n  skeletonCard: clsx(\'box-border p-2.5 border border-line rounded-card bg-surface\'),\n  skeletonPicture: clsx(\'aspect-square rounded-[9px] bg-soft animate-shimmer\'),\n  skeletonButton: clsx(\'block w-full h-12 rounded-button bg-soft animate-shimmer\'),\n  skeletonCover: clsx(\'block aspect-[3/2] rounded-card bg-soft animate-shimmer\'),\n  skeletonDot: clsx(\'block w-6.5 h-6.5 shrink-0 rounded-full bg-soft animate-shimmer\'),\n  skeletonPhoto: clsx(\'block w-22 h-27.5 rounded-[calc(var(--radius-card)_-_4px)] bg-soft animate-shimmer\'),\n  skeletonShort: clsx(\'block w-[40%] h-3.5 rounded-[6px] bg-soft animate-shimmer\'),\n  skeletonText: clsx(\'block w-full max-w-[28rem] h-3.5 rounded-[6px] bg-soft animate-shimmer\'),\n  skeletonTitle: clsx(\'block w-[min(100%,16rem)] h-7 rounded-[8px] bg-soft animate-shimmer\'),\n  srOnly: clsx(\'absolute overflow-hidden w-px h-px -m-px p-0 border-0 [clip-path:inset(50%)] whitespace-nowrap\'),\n  soldOut: clsx(\'py-0.5 px-2 absolute rounded-[6px] text-[11px] font-bold top-2 right-2 bottom-auto left-auto bg-ink text-bg\'),',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/styles/product.tsx'],
        find: '  legal: clsx(\'block w-full [--df-sealed-size:14px]\'),\n  loadingTitle: clsx(\'m-0 font-heading font-[var(--heading-weight)] tracking-[var(--heading-spacing)] leading-[1.15] wrap-anywhere [text-transform:var(--heading-case)] text-muted text-[20px]\'),\n  media: clsx(\'block w-full h-full object-cover\'),\n  noPicture: clsx(\'aspect-square rounded-card [background:var(--picture-alt)]\'),',
        replace: '  legal: clsx(\'block w-full [--df-sealed-size:14px]\'),\n  media: clsx(\'block w-full h-full object-cover\'),\n  loadingPicture: clsx(\'aspect-square rounded-card bg-soft animate-shimmer\'),\n  noPicture: clsx(\'aspect-square rounded-card [background:var(--picture-alt)]\'),',
      },
      {
        kind: 'replace',
        paths: ['src/theme/styles/theme.css'],
        find: '  --color-shade-12: rgb(22 35 26 / 0.12);\n}\n',
        replace: '  --color-shade-12: rgb(22 35 26 / 0.12);\n  --animate-shimmer: shimmer 1.6s linear infinite;\n}\n\n@keyframes shimmer {\n  0% {\n    background: linear-gradient(90deg, var(--color-soft) 40%, var(--color-bg) 50%, var(--color-soft) 60%) 150% 0 / 200% 100% var(--color-soft);\n  }\n  40%,\n  100% {\n    background: linear-gradient(90deg, var(--color-soft) 40%, var(--color-bg) 50%, var(--color-soft) 60%) -50% 0 / 200% 100% var(--color-soft);\n  }\n}\n',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/ProductCard.tsx'],
        find: '      ) : null}\n    </article>\n  )\n}\n\nexport const ProductGrid = ({ products, wide = false }: { products: readonly Card[]; wide?: boolean }) => (\n  <ul className={wide ? styles.gridWide : styles.grid}>\n    {products.map((p) => (\n      <li key={p.id} className={styles.cell}>\n        <ProductCard product={p} />\n      </li>\n    ))}\n  </ul>\n)\n\n/** The grid\'s shape while its products load, so nothing moves when they arrive. */\nexport const GridPlaceholder = ({ label, count, list = styles.grid, cell = styles.cell }: { label: string; count: number; list?: string; cell?: string }) => (',
        replace: '      ) : null}\n    </article>\n  )\n}\n\n/** `placeholders`: that many cells shaped like the placeholder\'s, after the products, while more load. */\nexport const ProductGrid = ({ products, wide = false, placeholders = 0 }: { products: readonly Card[]; wide?: boolean; placeholders?: number }) => (\n  <ul className={wide ? styles.gridWide : styles.grid} aria-busy={placeholders > 0 || undefined}>\n    {products.map((p) => (\n      <li key={p.id} className={styles.cell}>\n        <ProductCard product={p} />\n      </li>\n    ))}\n    {[...Array(placeholders).keys()].map((i) => (\n      <li key={i} className={styles.cell}>\n        <div className={styles.skeletonPicture} />\n        <div className={styles.skeletonLine} />\n      </li>\n    ))}\n  </ul>\n)\n\n/** The grid\'s shape while its products load, so nothing moves when they arrive. */\nexport const GridPlaceholder = ({ label, count, list = styles.grid, cell = styles.cell }: { label: string; count: number; list?: string; cell?: string }) => (',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/styles/shop.tsx'],
        find: '  secondary: clsx(\'py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer bg-surface text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]\'),\n  skeletonLine: clsx(\'mt-3 w-[60%] h-3.5 rounded-[6px] bg-soft\'),\n  skeletonPicture: clsx(\'aspect-[4/5] rounded-card bg-soft\'),\n  soldOut: clsx(\'py-1 px-3 absolute rounded-full text-[12px] font-bold top-auto right-3 bottom-3 left-auto bg-olive text-footer-ink\'),',
        replace: '  secondary: clsx(\'py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer bg-surface text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]\'),\n  skeletonLine: clsx(\'mt-3 w-[60%] h-3.5 rounded-[6px] bg-soft animate-shimmer\'),\n  skeletonPicture: clsx(\'aspect-[4/5] rounded-card bg-soft animate-shimmer\'),\n  skeletonButton: clsx(\'block w-full h-12 rounded-button bg-soft animate-shimmer\'),\n  skeletonCover: clsx(\'block aspect-[3/2] rounded-card bg-soft animate-shimmer\'),\n  skeletonDot: clsx(\'block w-6.5 h-6.5 shrink-0 rounded-full bg-soft animate-shimmer\'),\n  skeletonPhoto: clsx(\'block w-22 h-27.5 rounded-[calc(var(--radius-card)_-_4px)] bg-soft animate-shimmer\'),\n  skeletonShort: clsx(\'block w-[40%] h-3.5 rounded-[6px] bg-soft animate-shimmer\'),\n  skeletonText: clsx(\'block w-full max-w-[28rem] h-3.5 rounded-[6px] bg-soft animate-shimmer\'),\n  skeletonTitle: clsx(\'block w-[min(100%,16rem)] h-7 rounded-[8px] bg-soft animate-shimmer\'),\n  srOnly: clsx(\'absolute overflow-hidden w-px h-px -m-px p-0 border-0 [clip-path:inset(50%)] whitespace-nowrap\'),\n  soldOut: clsx(\'py-1 px-3 absolute rounded-full text-[12px] font-bold top-auto right-3 bottom-3 left-auto bg-olive text-footer-ink\'),',
      },
      {
        kind: 'replace',
        paths: ['src/theme/styles/theme.css'],
        find: '  --color-tone-2f2b22-16: rgb(47 43 34 / 0.16);\n}\n',
        replace: '  --color-tone-2f2b22-16: rgb(47 43 34 / 0.16);\n  --animate-shimmer: shimmer 1.6s linear infinite;\n}\n\n@keyframes shimmer {\n  0% {\n    background: linear-gradient(90deg, var(--color-soft) 40%, var(--color-bg) 50%, var(--color-soft) 60%) 150% 0 / 200% 100% var(--color-soft);\n  }\n  40%,\n  100% {\n    background: linear-gradient(90deg, var(--color-soft) 40%, var(--color-bg) 50%, var(--color-soft) 60%) -50% 0 / 200% 100% var(--color-soft);\n  }\n}\n',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/styles/shop.tsx'],
        find: '  secondary: clsx(\'py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] text-[12px] [font-style:inherit] [line-height:inherit] font-semibold tracking-[0.2em] uppercase no-underline cursor-pointer bg-transparent border-ink text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]\'),\n  skeletonLine: clsx(\'mt-3 w-[60%] h-3.5 rounded-[6px] bg-soft\'),\n  skeletonPicture: clsx(\'aspect-[4/5] rounded-card bg-soft\'),\n  soldOut: clsx(\'py-1 px-2.5 absolute top-auto right-3 bottom-3 left-auto bg-ink text-bg text-[10px] font-semibold tracking-[0.2em] uppercase\'),',
        replace: '  secondary: clsx(\'py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] text-[12px] [font-style:inherit] [line-height:inherit] font-semibold tracking-[0.2em] uppercase no-underline cursor-pointer bg-transparent border-ink text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]\'),\n  skeletonLine: clsx(\'mt-3 w-[60%] h-3.5 rounded-[6px] bg-soft animate-shimmer\'),\n  skeletonPicture: clsx(\'aspect-[4/5] rounded-card bg-soft animate-shimmer\'),\n  skeletonButton: clsx(\'block w-full h-12 rounded-button bg-soft animate-shimmer\'),\n  skeletonCover: clsx(\'block aspect-[3/2] rounded-card bg-soft animate-shimmer\'),\n  skeletonDot: clsx(\'block w-6.5 h-6.5 shrink-0 rounded-full bg-soft animate-shimmer\'),\n  skeletonPhoto: clsx(\'block w-22 h-27.5 rounded-[calc(var(--radius-card)_-_4px)] bg-soft animate-shimmer\'),\n  skeletonShort: clsx(\'block w-[40%] h-3.5 rounded-[6px] bg-soft animate-shimmer\'),\n  skeletonText: clsx(\'block w-full max-w-[28rem] h-3.5 rounded-[6px] bg-soft animate-shimmer\'),\n  skeletonTitle: clsx(\'block w-[min(100%,16rem)] h-7 rounded-[8px] bg-soft animate-shimmer\'),\n  srOnly: clsx(\'absolute overflow-hidden w-px h-px -m-px p-0 border-0 [clip-path:inset(50%)] whitespace-nowrap\'),\n  soldOut: clsx(\'py-1 px-2.5 absolute top-auto right-3 bottom-3 left-auto bg-ink text-bg text-[10px] font-semibold tracking-[0.2em] uppercase\'),',
      },
      {
        kind: 'replace',
        paths: ['src/theme/styles/theme.css'],
        find: '  --picture-alt: linear-gradient(160deg, #f4eee3, #e6d8c0);\n}\n',
        replace: '  --picture-alt: linear-gradient(160deg, #f4eee3, #e6d8c0);\n  --animate-shimmer: shimmer 1.6s linear infinite;\n}\n\n@keyframes shimmer {\n  0% {\n    background: linear-gradient(90deg, var(--color-soft) 40%, var(--color-bg) 50%, var(--color-soft) 60%) 150% 0 / 200% 100% var(--color-soft);\n  }\n  40%,\n  100% {\n    background: linear-gradient(90deg, var(--color-soft) 40%, var(--color-bg) 50%, var(--color-soft) 60%) -50% 0 / 200% 100% var(--color-soft);\n  }\n}\n',
      },
    ],
  },
  {
    version: '1.0.0',
    kind: 'major',
    security: false,
    notes: [
      'The header menu now always draws the fixed links around the merchant\'s own items (#1481): Home, Shop all, the items of `useMenu().items` (or, while there are none, the automatic list of collections), About and Contact. Before, the merchant\'s first menu item replaced Shop all, About and Contact. The phone menu draws the same links.',
      '`useMenu` now keeps the menu a live page was built with and never asks the Shop API for another, so a header cannot change after the page has loaded and shows the same on every reload; a menu change reaches the live site with the next publish. The preview and the studio still load the current menu.',
      'The codemods rewrite the header of a Classic or Baseline theme that still has the shipped markup. A theme that draws its own header places the fixed links around `menu.items` itself and draws nothing that depends on the menu changing after load.',
      'A cart with an age-restricted product now asks for age confirmation at Review (#1443): `<PlaceOrder>` stays disabled until the box is ticked, and draws the box just above itself in a theme that doesn\'t place it, so no change is needed. To choose where it sits, place `<AgeConfirmation needed={c.needsAgeConfirmation} checked={c.ageConfirmed} onChange={c.confirmAge} t={t} />` above `<PlaceOrder>`; it renders nothing for other carts.',
      'The sealed `<Price>` no longer puts the word "Was" before the crossed-out compare-at price (#1357). No code change is needed: a theme that styles `::part(was)` keeps working; a theme or visual test that expects the text "Was {price}" must drop it.',
      'A product whose stock isn\'t tracked no longer says "In stock" (#1278): in `src/theme/pages/ProductPage.tsx`, show the stock `<p role="status">` only when an option is still to choose or `page.stock?.available` is a number. The last codemod makes that edit in a theme still holding a starting theme\'s text.',
    ].join('\n'),
    codemods: [
      {
        kind: 'replace',
        paths: ['src/theme/components/Layout.tsx'],
        find: '              <Link href="/" className={styles.navLink}>\n                {t(\'common.nav.home\')}\n              </Link>\n              {menu.items.length ? (\n                menu.items.map((item) => <NavItem key={item.id} item={item} />)\n              ) : (\n                <>\n                  <Link href="/collections/all/" className={styles.navLink}>\n                    {t(\'common.nav.shopAll\')}\n                  </Link>\n                  {collections.map((c) => (\n                    <Link key={c.id} href={c.href} className={styles.navLink}>\n                      {c.name}\n                    </Link>\n                  ))}\n                  <Link href="/about/" className={styles.navLink}>\n                    {t(\'common.nav.about\')}\n                  </Link>\n                  <Link href="/contact/" className={styles.navLink}>\n                    {t(\'common.nav.contact\')}\n                  </Link>\n                </>\n              )}\n            </nav>',
        replace: '              <Link href="/" className={styles.navLink}>\n                {t(\'common.nav.home\')}\n              </Link>\n              <Link href="/collections/all/" className={styles.navLink}>\n                {t(\'common.nav.shopAll\')}\n              </Link>\n              {menu.items.length ? (\n                menu.items.map((item) => <NavItem key={item.id} item={item} />)\n              ) : (\n                collections.map((c) => (\n                  <Link key={c.id} href={c.href} className={styles.navLink}>\n                    {c.name}\n                  </Link>\n                ))\n              )}\n              <Link href="/about/" className={styles.navLink}>\n                {t(\'common.nav.about\')}\n              </Link>\n              <Link href="/contact/" className={styles.navLink}>\n                {t(\'common.nav.contact\')}\n              </Link>\n            </nav>',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/Layout.tsx'],
        find: '              {menu.items.length ? (\n                menu.items.map((item) => <NavItem key={item.id} item={item} />)\n              ) : (\n                <Link href="/collections/all/" className={styles.navLink}>\n                  {t(\'common.nav.shop\')}\n                </Link>\n              )}\n              <Link href="/about/" className={styles.navLink}>',
        replace: '              <Link href="/collections/all/" className={styles.navLink}>\n                {t(\'common.nav.shop\')}\n              </Link>\n              {menu.items.map((item) => (\n                <NavItem key={item.id} item={item} />\n              ))}\n              <Link href="/about/" className={styles.navLink}>',
      },
      {
        kind: 'replace',
        paths: ['src/theme/pages/ProductPage.tsx'],
        find: '            <p className={styles.stock} role="status">\n              {firstMissing ? t(\'shop.product.choose\', { option: firstMissing.name }) : page.stock?.inStock ? t(\'shop.product.inStock\') : t(\'shop.product.outOfStock\')}\n            </p>',
        replace: '            {firstMissing || typeof page.stock?.available === \'number\' ? (\n              <p className={styles.stock} role="status">\n                {firstMissing ? t(\'shop.product.choose\', { option: firstMissing.name }) : page.stock?.inStock ? t(\'shop.product.inStock\') : t(\'shop.product.outOfStock\')}\n              </p>\n            ) : null}',
      },
    ],
  },
  {
    version: '0.14.0',
    kind: 'minor',
    security: false,
    notes: [
      'A theme may now hold its own PNG, JPEG and WebP images in `src/theme/media/` (#1405) and draw them with `<ThemeImage src="<name>" alt={…} ratio={…} />` (width over height) or name them in CSS as `url(media/<name>)`.',
      'A product\'s size chart is available (#1326): `useProduct().product.sizeChart` (null when the product has none) and `<SizeChart>` to show it.',
      'Both are optional; no theme has to change. The codemods place the size chart link under the options of a Classic product page that still has the shipped markup (#1462), each edit only where its own anchor is shipped; a theme that changed that markup, or whose import differs, places `<SizeChart chart={product.sizeChart} />` itself and imports `SizeChart` from core.',
    ].join('\n'),
    codemods: [
      {
        kind: 'replace',
        paths: ['src/theme/pages/ProductPage.tsx'],
        find: 'RichText, useProduct, useStorefront }',
        replace: 'RichText, SizeChart, useProduct, useStorefront }',
      },
      {
        kind: 'replace',
        paths: ['src/theme/pages/ProductPage.tsx'],
        find: '<Options page={page} />\n            <p className={styles.stock} role="status">',
        replace: '<Options page={page} />\n            <SizeChart chart={product.sizeChart} className={styles.sizeLink} />\n            <p className={styles.stock} role="status">',
      },
      // The same place in the markup #1278 shipped, where the stock line shows only when there is stock to say.
      {
        kind: 'replace',
        paths: ['src/theme/pages/ProductPage.tsx'],
        find: '<Options page={page} />\n            {firstMissing || ',
        replace: '<Options page={page} />\n            <SizeChart chart={product.sizeChart} className={styles.sizeLink} />\n            {firstMissing || ',
      },
      {
        kind: 'replace',
        paths: ['src/theme/styles/product.module.css'],
        find: '.stock {\n  margin: 0;\n  color: var(--ink-soft);\n',
        replace:
          '.sizeLink {\n  align-self: flex-start;\n  min-height: 24px;\n  padding: 0;\n  border: 0;\n  background: none;\n  color: var(--ink);\n  font: inherit;\n  font-size: 14px;\n  text-decoration: underline;\n  cursor: pointer;\n}\n\n.sizeLink:focus-visible {\n  outline: 2px solid var(--focus);\n  outline-offset: 2px;\n}\n\n.stock {\n  color: var(--ink-soft);\n  margin: 0;\n',
      },
    ],
  },
  {
    version: '0.13.0',
    kind: 'minor',
    security: false,
    notes: [
      'Products can ask the shopper questions before buying (#1367, #1372). `AddToCart` and `BuyNow` open core\'s sealed customisation modal for a product that asks any; a product without questions adds as before, and the modal\'s code loads only when needed.',
      'A cart line now carries `answers`, `lineId` and `slug`, and the problem `check_answers` (word it, e.g. "Your choices need checking", beside `<EditAnswers>`). Show a customised line\'s answers with `<LineAnswers line={line} />` and offer Edit with `<EditAnswers line={line} />` under the line in the cart; both render nothing on a line without answers. The codemods add them to a cart view that still has the shipped markup; a theme that changed it places them itself.',
    ].join('\n'),
    codemods: [
      {
        kind: 'replace',
        paths: ['src/theme/components/interactive/CartView.tsx'],
        find: "import { CodeField, Image, Link, OrderSummary, Price, useCart, useStorefront, type CartLine } from '@dripfunnel/storefront-core/theme'",
        replace: "import { CodeField, EditAnswers, Image, LineAnswers, Link, OrderSummary, Price, useCart, useStorefront, type CartLine } from '@dripfunnel/storefront-core/theme'",
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/interactive/CartView.tsx'],
        find: '{line.versionName ? <p className={styles.version}>{line.versionName}</p> : null}',
        replace: '{line.versionName ? <p className={styles.version}>{line.versionName}</p> : null}\n                <LineAnswers line={line} className={styles.version} />\n                <EditAnswers line={line} className={styles.remove} />',
      },
      {
        kind: 'replace',
        paths: ['src/theme/components/interactive/CartView.tsx'],
        find: "line.problem === 'not_sold_here' ? t('shop.cart.problems.notSoldHere') : line.problem ? t('shop.cart.problems.unavailable') : null",
        replace: "line.problem === 'not_sold_here' ? t('shop.cart.problems.notSoldHere') : line.problem === 'check_answers' ? t('shop.cart.problems.checkAnswers') : line.problem ? t('shop.cart.problems.unavailable') : null",
      },
      {
        kind: 'replace',
        paths: ['content/*/shop.json'],
        find: '"notSoldHere": "Not sold where you are",',
        replace: '"notSoldHere": "Not sold where you are",\n      "checkAnswers": "Your choices need checking",',
      },
    ],
  },
  {
    version: '0.12.0',
    kind: 'minor',
    security: false,
    notes: [
      'Every change only adds; no theme has to change.',
      'A listing can filter by price and load on scroll (#1385): `useListing` adds `priceBounds`, `priceRange` and `setPriceRange`, `<PriceRange>` draws the price filter, and `useLoadOnScroll` loads the next page as the end of the grid nears the screen. A theme that uses none of them keeps today\'s behaviour.',
    ].join('\n'),
    codemods: [],
  },
  {
    version: '0.11.0',
    kind: 'minor',
    security: false,
    notes: [
      'Every change only adds; no theme has to change.',
      '`useCheckout` can save a signed-in shopper\'s delivery address to their account (#1310): `canKeepAddress` says whether they may, and `saveAddress(address, true)` saves it. A theme that passes nothing keeps today\'s behaviour.',
    ].join('\n'),
    codemods: [],
  },
  {
    version: '0.10.0',
    kind: 'minor',
    security: false,
    notes: [
      'Every shipped theme passes unchanged; no codemod runs.',
      'A product card shows only the product\'s own photos (#1244): the validator\'s new `jsx/product-image` rule refuses a `<MerchantImage>` inside one product\'s render, so a theme that drew a store picture there must show the product\'s photo instead.',
      'Themes may use Tailwind v4 classes (#1239), more of motion with core keeping reduced motion itself (#1245), `useWishlist`, `useProducts({ sort: \'best-selling\' })` and `useOffers()`, and `<RichText>` for a product\'s formatted description.',
      '`AddToCart` and `BuyNow` stay disabled until the engine answers, so a second press no longer adds twice.',
      'In the studio frame, the hot reload swaps stylesheets too (#1240), and a store link stays under the frame\'s session path (#1296).',
    ].join('\n'),
    codemods: [],
  },
  {
    version: '0.9.0',
    kind: 'minor',
    security: false,
    notes: [
      'Every change only adds; no theme has to change.',
      "`seoFor` writes more of the head for every page (#1184): Twitter cards, `og:locale`, `og:image:alt`, hreflang alternates, WebSite with SearchAction on the home page, ItemList for a collection's products, the store's social profiles on Organization, and a product's description and every photo.",
    ].join('\n'),
    codemods: [],
  },
  {
    version: '0.8.2',
    kind: 'patch',
    security: false,
    notes: [
      'No theme has to change.',
      'The checkout order summary shows each picture as a 320 px resized copy on the live site (#1168), and sign-in counts the shop as email only until its sign-in options answer (#1173).',
    ].join('\n'),
    codemods: [],
  },
  {
    version: '0.8.1',
    kind: 'patch',
    security: false,
    notes: [
      'No theme has to change.',
      "`PhoneField`'s country list no longer re-renders on every keystroke in the form around it (#1153), so a checkout with two phone fields stays quick.",
    ].join('\n'),
    codemods: [],
  },
  {
    version: '0.8.0',
    kind: 'minor',
    security: false,
    notes: [
      'Every change only adds; no theme has to change.',
      '`PhoneField` takes a mobile number as a country code dropdown and the number, saved as E.164 with no spaces (#1147); `AddressFields` uses it, and a theme may switch its own contact or sign-in phone field from `TextField` to it (`codeLabel`, `country`, `locale`).',
      "Checkout shows the delivery step only once the cart has a delivery address (#1145), and a listing keeps its filter panel while a new filter or sort loads (#1134).",
    ].join('\n'),
    codemods: [],
  },
  {
    version: '0.7.0',
    kind: 'minor',
    security: false,
    notes: [
      'Every change only adds; no theme has to change.',
      "`<StoreLogo className>` shows the store's logo from Site settings › Brand, or its name while it has none (#1129); a theme may put it in its header in place of the name.",
      "Every page's head carries the store's favicon (#1129), and a live page's pictures stay on their asset-host copies after it loads, with checkout asking the Shop API less (#1105).",
    ].join('\n'),
    codemods: [],
  },
  {
    version: '0.6.1',
    kind: 'patch',
    security: false,
    notes: [
      'No theme has to change.',
      "The publish gate's visual diff runs the live site's own scripts from the asset host (#1092), so an upgrade is compared with the live site as shoppers see it and refused only for a real change of look.",
    ].join('\n'),
    codemods: [],
  },
  {
    version: '0.6.0',
    kind: 'minor',
    security: false,
    notes: [
      'Every change only accepts more; no theme has to change.',
      "The theme guard accepts a t() key typed as a list of written names (['hero.one', 'hero.two'] as const), each checked against every language, and CSS transitions and keyframes on colours, backgrounds, box-shadow, fill and stroke as well as transform, opacity and filter.",
      "The publish gate's visual diff gives the live page the same shop data as the new build (#1087), so an upgrade is refused only for a real change of look.",
    ].join('\n'),
    codemods: [],
  },
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
