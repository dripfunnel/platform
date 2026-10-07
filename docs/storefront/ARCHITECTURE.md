# ARCHITECTURE.md: storefront template

How DripFunnel's storefronts are built. The template's source lives in the `platform` repo at
`templates/storefront/`; every store gets its own storefront repo created from it when its
merchant first picks a template. The look comes from the store's **site data** (`site.json`:
theme, header, home sections, footer, About and Contact), which the merchant changes in the
portal's studio with the AI; a locked, versioned **core package** renders it and supplies all
commerce behaviour through the **Shop API**.

Companion documents: [DESIGN.md](DESIGN.md) covers what the AI may design and the rules every
design keeps. `../api/PLATFORM-PROMPT.md` covers the platform and the engine behind the
Shop API. **"The reference"** below means the first platform's storefront template (a
Next.js commerce starter as customised by us, now removed from the workspace); §11 records
what was taken from it.

**Status: specification only.** No code exists yet.

Last updated: 2026-10-08 (#470: the AI edits site data, templates, the brand step).

---

## 1. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **Internal, fully automated.** Merchants never see this template, its repos or any code. | A public starter merchants' developers fork (as open-source commerce starters are) | The merchant is non-technical. The split between core and theme exists so the AI can produce a completely different design for every store without being able to break commerce. Merchants who want their own frontend use the Shop API and SDK directly (PLATFORM-PROMPT §5.5), not this template. |
| **Commerce behaviour ships as a versioned package, `@dripfunnel/storefront-core`.** | A `core/` folder inside each repo, guarded by a CI path check (SAAS-PLAN §2) | The AI physically cannot edit a dependency. A fleet upgrade is a version bump rather than a merge into 1,000 diverged folders. The CI path guard stays as a second line of defence for the few locked files in the repo (§3). |
| **The AI changes look, not logic.** It may restyle and rearrange every page, checkout included, using core's hooks and components. It can't change flow order, pricing, payments, validation or data. | Checkout fully locked; or the AI adding its own features | Checkout is where design differences matter to a merchant. Checkout *behaviour* is where mistakes cost money, so behaviour stays in core. New features arrive through core releases, not per-store code. |
| **The AI edits site data, never code** (decided 2026-10-08 on #470). A store's look is one JSON document in core's schema: theme tokens, announcement bar, header, up to 12 home sections of 8 types, footer, About and Contact. Core renders it; every other page takes the theme's tokens. | The AI editing `src/theme/**` in the store repo behind CI gates (the 2026-10-05 design) | A document checked against a schema can't break a build, a route or checkout, so there are no per-change gates, builds or visual diffs; undo and "go back" are versions of a row; the prototype (`designs/PortalStorefront`, `storefront-lib.js`) draws exactly this. |
| **A store starts from a template** (decided 2026-10-08): six presets (Linen, Concrete, Bloom, Circuit, Market, Atelier) and "Start from scratch", each with a demo, after a required brand step. | The AI proposing three directions (decided 2026-10-05, replaced) | The merchant sees finished looks with their own products before typing a word. |
| **Two render modes from one codebase.** **Preview** is a client-rendered SPA on the brand's preview subdomain, with no SSR or SSG. **Live** is a static site (SSG) on the customer's domain. | One mode for both | The preview must show every AI edit and every catalogue change immediately, with builds that take seconds. The live site must be fast, cheap to host, crawlable, and immune to API load spikes. §4 covers both, and how the live site stays current. |
| **The engine computes; the storefront displays.** Every price, tax, discount, shipping cost, stock level and total comes from the Shop API. | Any client-side commerce calculation | This is what lets the AI change the storefront freely: nothing a theme does can assert a price or skip a rule (PLATFORM-PROMPT §5.5). |
| **Hosted on Cloudflare** as static assets, both modes. | S3 + CloudFront (the reference's deploy) | Platform decision (PLATFORM-PROMPT §5.6). Custom domains through Cloudflare for SaaS. |

---

## 2. The pieces

```
┌────────────────────── store repo (one per store, generated) ──────────────────────┐
│  site.json            the published site data, committed by the platform on       │
│                       publish (never edited in the repo, never by the AI directly)│
│  src/theme/**         LOCKED: the baseline pages (D1) that every store shares     │
│  src/app/**           LOCKED, generated route shims: core route → theme page      │
│  store.config.ts      LOCKED, generated with the repo (store key, API, locales)   │
│  package.json         LOCKED: core version pinned by the sync bot, dependency     │
│                       allowlist                                                   │
│  tests/**, .github/** LOCKED: contract tests, smoke tests, deploy                 │
└──────────────────────────────────┬────────────────────────────────────────────────┘
                                   │ depends on (exact version)
                    ┌──────────────▼───────────────┐
                    │  @dripfunnel/storefront-core │  GitHub Packages, semver;
                    │  incl. the site-data schema, │  the schema version is the
                    │  presets and renderer        │  "renderer version"
                    └──────────────┬───────────────┘
                                   │ GraphQL, public store key
                    ┌──────────────▼───────────────┐
                    │  Shop API (DF engine)        │
                    └──────────────────────────────┘
```

### 2.1 `@dripfunnel/storefront-core`

Everything a store must behave identically on. Organised as feature modules, as the reference
is (`account`, `authentication`, `cart`, `checkout`, `collections`, `currency`, `orders`,
`pricing`, `products`, `search`), plus the platform layers:

| Module | Provides |
|---|---|
| `platform/api` | The Shop API client (PLATFORM-PROMPT §5.5): typed operations (gql.tada against our schema), the store key header, the shopper session token, locale and currency headers, retries, error mapping. No other module performs network calls. |
| `platform/store` | Store resolution from `store.config.ts`, store settings from the Shop API (name, locales, currencies, policies, legal and compliance info, brand "Powered by" rule), and the store's state (live, past due, suspended) for degraded mode. |
| `platform/render` | The render-mode adapter (§4): one interface for data loading that resolves at build time in live mode and at run time in preview mode. |
| `platform/i18n` | Locale routing, message catalogues for core strings, `Intl` formatting, RTL direction. Themes add their own messages; core messages can be restyled, never removed. |
| `platform/seo` | Metadata, canonical URLs, hreflang, Open Graph, structured data (Product, Offer, BreadcrumbList, Organization), sitemap and robots, noindex in preview. |
| `platform/analytics` | Commerce events (view item, add to cart, begin checkout, purchase), consent-aware, provider adapters: **GA4, Meta Pixel and Google Tag Manager**, loaded only after consent (decided 2026-10-05 on #337). |
| `platform/consent` | Cookie and tracking consent by region (EU/UK required). |
| `cart` | The active order as the only cart state (the reference's rule), add, remove, adjust, apply and remove codes, optimistic UI with server reconciliation. |
| `checkout` | The checkout state machine: contact → shipping address → delivery → payment → review, with the engine deciding what each step needs. Payment adapters (Stripe, Razorpay, Cashfree first), each loading its own provider SDK; asynchronous settlement with a "payment processing" state (the reference's `PaymentProcessingBanner` pattern). AI storefronts check out in the theme; own storefronts hand off to the engine's hosted checkout by default and may build their own (decided 2026-10-05 on #337). |
| `products`, `collections`, `search` | Loaders and hooks for product detail (versions, options, selection rules, live price and stock), collection listings, search with filters (OR within a filter, AND across filters), sorting and pagination as URL state. |
| `account`, `authentication`, `orders` | Sign-up, verification, sign-in, password reset, profile, addresses, order history, order detail and tracking. |
| `pricing` | The price display component: currency always explicit (the reference's silent `USD` default is banned), tax label per region ("incl. VAT", "+ tax"), compare-at price only as the engine returns it. |
| `ui/headless` | Unstyled, accessible behaviour components the theme skins: variant picker, quantity stepper, cart drawer state, address form (country-aware fields), payment element host, facet filter, pagination, locale and currency pickers, consent banner, search overlay. |
| `contracts` | The TypeScript interfaces and route manifest the theme must satisfy (§3), and the contract test suite. |
| `site` | The **site-data schema** (zod), `normalize` (WCAG AA contrast, fonts from the allowlist, at most 12 sections, section ids kept), `keepContent` (a new template keeping the merchant's words), the seven template presets, and the renderer of the theme, announcement bar, header, the 8 section types (hero, products, categories, banner, features, testimonial, newsletter, text), footer, About and Contact. The Store API validates the AI's output with the same version, and the portal's studio preview renders with it (decided 2026-10-08 on #470). |

**Cancelling and returns on the storefront** (*proposed* on #285, awaiting Gaurav's approval; §12): a shopper may cancel an order
until it ships, and may ask for a return until the **store's returns window** closes, counted from
delivery. The window is the store's own policy, read by `platform/store` with the other policies,
never the theme's; a product's own rule overrides it (CATALOG-DESIGN S8), and neither may go below
a market's legal floor. Downloads keep the store's limits the same way (times and days per
order). The prototype draws both (`designs/DF Storefront Prototype`: 14 days in the India sample,
30 in the US one); the events are logged as LOGGING §2 lists.

**Core exposes behaviour through three shapes, and the theme owns every pixel:**
1. **Hooks** (`useCart()`, `useProduct()`, `useCheckout()`, …) return data, state and
   actions.
2. **Headless components** with render props or slots render nothing visual of their own.
3. **Required components** render something that must exist but can be styled: the payment
   element host, legal and compliance notices, the price with its tax label, the consent
   banner, the preview banner. The theme can style them through tokens and class slots, but
   can't omit, replace or alter their content.

### 2.2 The store repo

Created **when the merchant first picks a template** in Storefront, not at provisioning
(decided 2026-10-08 on #470): an empty repo in the `dripfunnel` org, into which
`apps/api/src/integrations/github` copies `templates/storefront/` through the GitHub App, then
writes `site.json` (the chosen template's data), the generated files (`store.config.ts`, route
shims) and pins the published `@dripfunnel/storefront-core` version (PLATFORM-PROMPT §5.7,
`../ARCHITECTURE.md` §1). Choosing another template later writes new site data to the same
repo. Nothing in the repo is edited by hand or by the AI: the platform commits `site.json` on
each publish, and the sync bot bumps core (§7).

```
src/
  app/                  LOCKED, generated. One thin file per core route, re-exporting
                        the page the theme's manifest names (the reference's
                        "app files are re-export shims" test, kept).
  theme/                LOCKED: the baseline pages (D1), styled by site.json's theme
    manifest.ts         which theme page implements each core route (§3.1)
    layouts/ pages/     collection, product, search, cart, checkout, account, policies,
                        404; home, About and Contact are core's site renderer
    messages/           baseline copy per locale
site.json               the published site data (core's schema)
store.config.ts         LOCKED, generated: store key, Shop API URL, preview and live
                        hostnames, locales, currencies, core feature flags
package.json            LOCKED: core pinned exactly; dependencies from an allowlist only
tests/                  LOCKED: contract, smoke, accessibility, performance budgets
.github/workflows/      LOCKED: build and deploy both modes
```

---

## 3. The theme contract

### 3.1 Routes

Core owns the **route map**; the theme owns what each route looks like. Required routes:
home, collection, product (plus a version URL), search, cart, checkout, order confirmation,
sign-in, register, verify, forgot and reset password, account (profile, addresses, orders,
order detail), policies (terms, privacy, shipping, returns, legal notice), 404, and the
degraded-store page, plus **content pages** (FAQ, lookbook, the merchant's own) and the blog
from SAPI 24, and About and Contact from the site data (decided 2026-10-08 on #470). It may not add routes that perform commerce (no custom
cart, checkout, or pricing pages).

`theme/manifest.ts` must map every required route to a page. A missing mapping fails the
build.

### 3.2 What the theme receives and must render

Each page receives typed props from core (for example `ProductPageProps`: product, selected
version, price, availability, breadcrumbs, related products, SEO data) and may call core
hooks. Contract tests assert, per route, that the rendered page:

- renders every **required component** for that route (price with tax label, add-to-cart
  that uses `useCart`, payment element on checkout, legal and compliance notices where the
  store's markets require them, consent banner, preview banner in preview);
- shows only data that came from core. **No hard-coded products, prices, stock, discounts,
  ratings, reviews, badges or scarcity claims** (the reference's rule, now enforced by a
  lint rule and a test that scans theme source for literals in those positions);
- keeps accessibility floors (§8) and the performance budget (§9).

### 3.3 What is enforced, and where

| Rule | Enforced by |
|---|---|
| The AI changes only the site data | The Store API parses the AI's answer with core's schema and `normalize` before it becomes a draft; only the platform commits `site.json`; a CI path check fails any other change to the repo |
| Core can't be edited | It's a dependency; the lockfile pins the exact version and CI verifies its integrity hash |
| Dependencies from an allowlist | CI check on `package.json` and the lockfile |
| Themes call the network only through core | Lint (no `fetch`, no GraphQL client, no provider SDKs in `theme/`) and a bundle check |
| Route map complete, required components present | Contract tests |
| No fabricated commerce data | Lint and contract tests |
| Accessibility and performance floors | axe checks and Lighthouse budgets in CI |
| Checkout works | Smoke test: home → product → add to cart → checkout loads → payment element renders in test mode |

---

## 4. Two render modes

The same repo builds in two modes. Core's `platform/render` adapter hides the difference from
the theme, so a page is written once.

### 4.1 Preview (staging)

- **Where**: the brand's preview subdomain, e.g. `{store}.preview.dripfunnel.com` or
  **`{store}.preview.{partner-domain}`** on the partner's wildcard (decided 2026-10-05 on #337).
- **How**: a client-rendered SPA with no SSR and no SSG. One `index.html` with client-side
  routing; every page loads its data from the Shop API at run time.
- **Why**: builds contain no catalogue, so they take seconds and never go stale. A merchant
  sees AI edits and catalogue changes as soon as they happen.
- **One preview build per store and core version** (decided 2026-10-08 on #470): it reads the
  store's **draft** site data from the Shop API at run time, so an AI change needs no build.
  The studio in the portal renders the same draft with the same renderer; "Open preview" there
  opens this host. Previews are `noindex`, carry a visible "Preview" banner,
  and open only through a **signed link from the portal** (decided 2026-10-05 on #284). Checkout
  in preview uses the payment providers' **test mode** (decided the same day); the Shop API
  serves the draft only to a signed preview request.

### 4.2 Live (production)

- **Where**: the customer's custom domain via Cloudflare for SaaS. Until one is connected,
  `{shop}.shops.<partnerdomain>` (SAAS §8).
- **How**: a **static build (SSG)**. Catalogue pages (home, collections, products and their
  version URLs, content and policy pages, per locale) are prerendered at build time from the
  Shop API, with SEO data baked in.
- **Live data after load**: price, stock, cart, account and checkout always come from the
  Shop API in the browser. The prerendered price is the build-time value for the default
  currency and is superseded by the live fetch, skipped when nothing differs (the
  reference's 2026-09-03 decisions, kept).
- **Staying current without full rebuilds on every edit** *(the platform's rule that
  catalogue changes don't rebuild, adapted to SSG)*:
  1. **Pages the build doesn't know yet** (a new product, a renamed web address) are served
     by a **client-rendered fallback**: the edge serves the SPA shell for unknown catalogue
     URLs, and the page renders from the Shop API. It works immediately, but without
     prerendered SEO until the next build.
  2. **Catalogue publishing** works as the first platform's deployment tracker did, rebuilt
     properly on the engine:
     - **Change detection**: engine events (product, version, collection, filter, menu,
       content, store settings that appear on the storefront) mark the store's live site
       **"has unpublished changes"**, with what changed and when (the old
       `channel_catalog_state` / `needsPublish`, as an engine table rather than an
       in-memory debounce).
     - **"Publish now"**: the merchant presses it in the portal and a live catalogue build
       runs. Each press uses one **catalogue build from the plan's monthly allowance**
       (an entitlement, e.g. "30 catalogue publishes a month"). **The allowance is set per
       plan by the partner** in the partner console (or by DripFunnel staff on its behalf),
       within the platform ceiling DripFunnel sets (../api/SAAS.md §6.1, CONSOLE-DESIGN G2). The button shows what is
       waiting ("12 products changed since 10:40"), how many publishes are left this month,
       and when the next automatic publish is due. At zero it explains itself and points to
       the automatic publish and the upgrade (Owner only).
     - **Automatic publishing**: every store with unpublished changes is published on a
       **schedule configured in the admin console** (CONSOLE-DESIGN R5): a platform default
       interval, which DripFunnel staff can set differently per plan. It runs whether or not
       anyone presses the button. Automatic publishes do **not** use the monthly allowance.
       Stores with no changes aren't rebuilt.
     - **One build at a time per store**: a press while a build runs queues the next one
       rather than starting a second; changes made during a build are picked up by the next.
     - **Status is real, not estimated**: queued, building, deploying, live, failed, from the
       job and the Cloudflare deploy, never from polling GitHub with a cache (the old
       tracker's gap). A failed build keeps the previous live site and tells
       the merchant plainly. **A failed build never uses up an allowance** (decided).
     - Build minutes per store per month stay a platform metric (SAAS-PLAN §14), shown in DF
       Admin.
  3. **Removed or hidden products** return a proper 404 or redirect immediately via an
     edge rule, without waiting for the rebuild.
  4. **Design changes** build live only when the merchant publishes them in the studio: the
     platform commits `site.json` and the live build runs (SAAS §9.2). Search-and-sharing
     and brand changes go out with the next publish of any kind.
- **Degraded store** (past due, suspended): an edge rule serves the degraded page or a
  read-only notice without a rebuild (DESIGN-BRIEF fact 9).

### 4.3 Pitfalls the reference already hit (carry the fixes)

From the reference's recorded decisions:

- A component reading search params directly (`useSearchParams()`) in a static build turns
  the whole enclosing boundary client-only and blanks it from the HTML. Isolate that read in
  one invisible component and pass values down.
- A version selector that only changes client state never appears in static HTML. Give each
  version its own URL and page, canonicalised to the product.
- Next.js static-export link prefetch requests files that don't exist. Default prefetch off
  in the two link wrappers until the upstream bug is fixed.
- The image optimiser needs a server. Use **Cloudflare image resizing** through a core image component instead of
  `unoptimized` originals (decided 2026-10-05 on #337).
- Trailing-slash URLs for static hosting, and a root redirect to the default locale.
- Codegen schema pointer and runtime API URL are separate; generated types drift silently if
  they differ. The core package owns both.
- Per-component live fetches must be deduplicated: one store-settings request per page, one
  batched price request, not one per product card.

Verify each against the Next.js version actually used; the reference notes that its Next.js
"is not the Next.js you know".

---

## 5. Talking to the Shop API

- Only `platform/api` in core talks to the network, and only to the Shop API (and payment
  providers' own browser SDKs inside checkout).
- The store is identified by its **public store key** from `store.config.ts`. No secret is
  ever in a build or a bundle.
- The shopper session travels as a header token stored by core, as in the reference. Decide
  cookie versus storage per mode *(recommend)*.
- Build-time reads (live mode) use the same public Shop API, with a build-only rate limit.
- The Shop API version is pinned by the core version; a core release declares which Shop API
  versions it supports.
- Cart operations must not need the reference's `ORDER_MODIFICATION_ERROR` retry workaround:
  the engine's cart model shouldn't lock the order during checkout in a way the storefront has
  to fight (raise it with the engine design if it does).

---

## 6. The AI loop, storefront side

Decided 2026-10-08 on #470 (SAAS §9.2 owns the platform side):

```
the merchant fills in "Your brand" (first time only)
  → picks a template, or "Start from scratch"          (the repo is created, §2.2)
  → describes a change in the studio
  → the Store API asks the model for the full site data, parses it with core's schema,
    normalizes it and saves it as the draft             (no build, no gate run)
  → the studio and the preview host (§4.1) show the draft; "Undo this change" restores
    the previous draft
  → Publish: the platform commits site.json → live SSG build (§4.2) → cache purge
```

- **The AI's working context**: core's site-data schema, the current site data, the page and
  screen size the merchant is looking at, their last four requests, the store's name and city,
  a sample of about 12 products (names and prices; never photos), and the brand (tagline,
  description, voice; colours only as a hint).
- **What it refuses**: prices, stock, products, shipping and checkout; it says these are
  changed in Products or Settings, and the draft stays as it was.
- **Undo** restores the draft before the latest change; **Go back to this** makes an earlier
  published version live again by redeploying its kept deployment, with no build minutes
  (decided 2026-10-08 on #470).
- **Failures never reach live**: an answer that doesn't parse leaves the draft unchanged and
  says so in plain words.

---

## 7. Core upgrades across the fleet

- Core follows **semver**. The sync bot (SAAS §10) opens a version bump on every store repo,
  **canary stores first**, then in waves.
- **The renderer version is pinned per published version** (decided 2026-10-08 on #470): each
  published version records the core version it was built with.
- **Patch and minor** releases can't change the look or the theme contract. Gates pass →
  auto-merge → rebuild both modes from the same site data.
- **Major** releases may change the look or the schema. They ship **upgrade notes** in the
  reference's structured format (`.upgrades/changes/*.md`) and a schema migration that
  `normalize` applies. The new look reaches a store only when its merchant next publishes (or
  approves the upgrade in the studio), keeping the #337 rule that **the merchant approves**
  visual changes.
- DF Admin shows fleet core-version drift and rollout state (CONSOLE-DESIGN part L).
- Security fixes can be pushed to every store as a forced patch.

---

## 8. Cross-cutting requirements

- **Languages and currencies** follow store settings: locale routing, translated catalogue
  content from the Shop API, core messages per locale (the reference ships en, de, hi, tel),
  currency picker only when there's more than one, RTL layouts where the store offers
  right-to-left languages.
- **Regions**: tax labels, address formats, required legal and compliance notices, and unit
  display all come from store settings via core (CATALOG-DESIGN-PROMPT §3 facts 36–48).
- **Accessibility**: WCAG 2.2 AA as the floor (the EU Accessibility Act and ADA make this
  legal, not optional). Headless components carry the semantics; contract tests run axe per
  route.
- **SEO**: owned by core, fed by the engine's per-language search fields. The theme can't
  remove structured data, canonical or hreflang.
- **Privacy**: consent before non-essential tracking where required; no third-party scripts
  outside the allowlist.
- **White label**: the brand's "Powered by" rule is a required component driven by store
  settings (CONSOLE-DESIGN §3 fact 18).

---

## 9. Performance budgets

Set per route in CI *(numbers to confirm)*: Largest Contentful Paint, total JavaScript,
Cumulative Layout Shift and Interaction to Next Paint measured on a mid-range phone profile.
Core keeps its own bundle small and splits payment SDKs by provider so a theme never pays
for providers the store doesn't use.

---

## 10. Testing

- **Core**: unit and integration tests against a real engine (the platform's test stack),
  contract tests published with the package, and payment adapters tested in provider test
  modes.
- **Template**: the baseline pages pass every contract test with each of the seven presets'
  site data.
- **Per store** (in CI, both modes): typecheck, lint, contract tests, smoke test, a11y, budgets,
  and the architecture tests carried from the reference (`tests/architecture/boundaries.test.mjs`:
  app files are only re-exports; feature internals aren't imported from outside).
- **Fleet**: a core release is tested against a sample of real store themes before canary.

---

## 11. What to take from the reference

| Take (adapt) | Change | Drop |
|---|---|---|
| Feature-module layout and the boundary rules (thin `app/`, features imported only through top-level files, colocated operations and messages) | Features move **into the core package**; the store repo keeps only theme and shims | Everything developer-owned-by-default: here the look is the store's site data and core is locked |
| The architecture tests, i18n message composition and its duplicate-namespace test | The reference's transport (its channel token headers) → our SDK and store key | Framework-specific workarounds (`withCartModificationRetry`, `ORDER_MODIFICATION_ERROR`, the hard-coded root `parentId: "1"`) |
| The protected-commerce list in its `CLAUDE.md` and `docs/commerce.md` (active order as the only cart, checkout order, async payment settlement, facet OR/AND, validated currency) as core invariants | Server Actions and `'use cache'` notes (already stale there) → the render-mode adapter (§4) | The S3 + CloudFront workflows and committed `.env.*` build config |
| Static-export lessons (§4.3), the live-price supersede pattern, per-version pages | Payment clients (Stripe, Razorpay, Cashfree) → core payment adapters against our engine | The `USD` default in the price component |
| The upgrade-note protocol for core majors (§7) | Upgrade reconciliation done by our agent per store, not by a merchant's developer | `upgrade:init` provenance for human forks (the sync bot owns provenance) |
| Its shadcn primitive set and Tailwind v4 token approach as the **baseline theme**'s starting kit | Tokens come per store from the site data's theme (DESIGN.md) | The neutral slate-only look as a default for stores |

---

## 12. Open questions

- ~~The preview hostname pattern per brand.~~ `{store}.preview.{partner-domain}` (decided 2026-10-05 on #337).
- ~~Whether previews are gated (signed link) or open but `noindex`.~~ Gated by a signed link
  (decided 2026-10-05 on #284).
- ~~Can shoppers check out on the preview (test mode), or is checkout disabled there?~~ Test-mode
  checkout (decided 2026-10-05 on #284).
- ~~Before a custom domain is connected, where is the live site?~~ `{shop}.shops.<partnerdomain>` (SAAS §8).
- ~~Hosted checkout (engine-served) vs in-theme checkout for AI storefronts: both, or one?~~ AI storefronts check out in the theme; own storefronts use the hosted checkout by default and may build their own (decided 2026-10-05 on #337).
- ~~Image resizing: Cloudflare image resizing, or engine-generated variants?~~ Cloudflare image resizing (decided 2026-10-05 on #337).
- ~~Analytics providers to support in core (GA4, Meta Pixel, others), and per-brand defaults.~~ GA4, Meta Pixel, Google Tag Manager, after consent (decided 2026-10-05 on #337).
- ~~Who approves visual changes from a core major upgrade: the merchant, or DripFunnel staff?~~ The merchant (decided 2026-10-05 on #337).
- ~~Does the AI edit the theme's code, and how does a design start?~~ Site data only, from a template after a brand step (decided 2026-10-08 on #470; §1, §6).
- ~~Which content pages and sections may the theme add without new core support (blog, lookbook,
  store locator)?~~ FAQ, lookbook, the merchant's own pages **and a blog** (SAPI 24); About and Contact are site data (decided 2026-10-08 on #470); no store locator (decided 2026-10-05 on #337).
- ~~How store repos authenticate to GitHub Packages in CI (decided registry; see
  `../code/ARCHITECTURE.md` §5 for the options).~~ The GitHub App's per-repo grant, a read-only token secret only if that's impossible (decided 2026-10-05 on #337). It is impossible (no API), so one read-only token in the org secret `DF_PACKAGES_TOKEN`, shared with each store repo by the App (decided on #303).
- Shopper cancelling and returns (§2.1, proposed on #285): cancel until the order ships; a return until the store's window closes, counted from delivery; a product's rule over the store's, never below a market's legal floor. The prototype draws this; it stands until approved or changed on #285.
