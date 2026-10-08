# ARCHITECTURE.md: storefront template

How DripFunnel's storefronts are built. The template's source lives in the `platform` repo at
`templates/storefront/`; every store gets its own storefront repo created from it when its
merchant first picks a template. **The AI writes the store's theme code**: React pages and
components, CSS Modules, the shopper-facing words per language and the store's own pages,
inside `src/theme/**`, `content/**` and `routes.json` of that repo, and nothing else. A locked,
versioned **core package** supplies all commerce behaviour through the **Shop API**, and a chain
of independent walls (§3) keeps the AI's code from reaching money, data, the network or the
parts every store must show.

Companion documents: [DESIGN.md](DESIGN.md) covers what the AI may design and the rules every
design keeps. `../api/PLATFORM-PROMPT.md` covers the platform and the engine behind the
Shop API; `../api/SAAS.md` §9 owns publishing state, the studio's API and metering. **"The
reference"** below means the first platform's storefront template (a Next.js commerce starter
as customised by us, now removed from the workspace); §11 records what was taken from it.

**Status: specification only.** `storefront-core` has its Shop API client, store settings,
i18n, money, the first required components, SEO and the route contract (#304); everything
else below is to build.

Last updated: 2026-10-08 (#470: the AI writes theme code behind strict walls, "Plan A").

---

## 1. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **Internal, fully automated.** Merchants never see this template, its repos or any code. | A public starter merchants' developers fork (as open-source commerce starters are) | The merchant is non-technical. The split between core and theme exists so the AI can produce a completely different design for every store without being able to break commerce. Merchants who want their own frontend use the Shop API directly (PLATFORM-PROMPT §5.5), not this template. |
| **Commerce behaviour ships as a versioned package, `@dripfunnel/storefront-core`.** | A `core/` folder inside each repo, guarded by a CI path check (SAAS-PLAN §2) | The AI physically cannot edit a dependency. A fleet upgrade is a version bump rather than a merge into 1,000 diverged folders. The file allowlist (§3.4) stays as a second line for the few locked files in the repo. |
| **The AI writes theme code: full freedom over look and front-end behaviour, none over commerce** (decided 2026-10-08 with Gaurav on #470, "Plan A"). It may write any page, component, layout, style, animation or interaction (a pasted image matched, a page featuring one product, a card anywhere, zoom, infinite scroll, a quiz), on every page **checkout included**, using core's hooks and sealed components (§2.1). | The AI editing a fixed site-data schema (`site.json`: theme tokens and 12 sections of 8 types; decided earlier the same day, reversed); a design tree; sandboxed or inline HTML blocks (plans B, B+) | Merchants want what they see in tools like Lovable: anything they can describe or show. Every schema caps that. What breaks a store is logic, never layout, so logic stays in core and the engine, and the AI's code is fenced by walls that don't depend on the AI behaving (§3). |
| **Safety by walls, not by trust**: a file allowlist, a type-aware code validator with allowlisted imports and APIs, sealed components in a closed Shadow DOM, CSP and Trusted Types in the browser, and the engine computing every amount (§3.3–§3.5) | Lint rules on AI code as the only guard; reviewing AI output | Each danger meets three independent walls: the code can't express it, a gate rejects it, the browser or engine contains it. A bad outcome needs all three to fail, and money is safe even then. |
| **Every AI change runs in its store's own sandbox** (decided 2026-10-08 on #470): **Cloudflare Containers**, one container per store with a studio open, held by one Durable Object per store that runs one change at a time (§6.1) | GitHub Actions (decided 2026-10-05 on #284; 30–90 s per change); a third-party sandbox | Seconds per change, no new vendor, next to R2 and the Worker. Merchants never share a machine, and the store's Durable Object makes two tabs safe. |
| **Every accepted change is a commit; undo is a revert** | Draft rows of site data | The repo is the history; "Undo this change" and bisecting a broken publish both work on commits. |
| **Nothing reaches live that hasn't passed** (§4.2): a deterministic build in a frozen image, a full gate, then an atomic deploy, post-deploy checks and automatic rollback; repairs and bisecting before refusing | Building on publish and hoping | The exact files tested are the files deployed. A failure leaves the live site as it was; most failures repair themselves. |
| **A store starts from a template** (decided 2026-10-08): six (Linen, Concrete, Bloom, Circuit, Market, Atelier) and "Start from scratch", each a complete starting theme in this repo, after a required brand step | The AI proposing three directions (decided 2026-10-05, replaced) | The merchant sees finished looks with their own products before typing a word. |
| **Two render modes from one codebase.** **Preview** is a client-rendered build on the brand's preview subdomain, with no SSR or SSG. **Live** is a static site (SSG) on the customer's domain. | One mode for both | The preview builds in seconds and shows catalogue changes at once; the live site must be fast, cheap to host, crawlable and immune to API load spikes. §4 covers both. |
| **The engine computes; the storefront displays.** Every price, tax, discount, shipping cost, stock level and total comes from the Shop API. | Any client-side commerce calculation | This is what lets the AI change the storefront freely: nothing a theme does can assert a price or skip a rule (PLATFORM-PROMPT §5.5). |
| **Fast and findable by construction**: core owns the `<head>`, structured data, sitemap, redirects, images, fonts and script loading; theme components are server-only unless they are interactive islands; budgets are gates (§8, §9) | Asking the AI to be careful | Speed and SEO are the storefront's job; a slow or unindexable design is refused like a broken one. |
| **Hosted on Cloudflare** as static assets, both modes, a Pages project per store (decided 2026-10-05 on #284) | S3 + CloudFront (the reference's deploy) | Platform decision (PLATFORM-PROMPT §5.6). Custom domains through Cloudflare for SaaS. |

---

## 2. The pieces

```
┌──────────────────────── store repo (one per store, generated) ─────────────────────────┐
│  src/theme/**          AI-WRITTEN: pages, components, layouts, CSS Modules             │
│  content/{locale}/*.json  AI-WRITTEN (the merchant may edit): every word shoppers see  │
│  routes.json           AI-WRITTEN: which theme page skins each core route; custom pages│
│  src/app/**            LOCKED, generated route shims: core route → theme page          │
│  store.config.ts       LOCKED, generated with the repo (store key, API, locales)       │
│  package.json          LOCKED: core pinned exactly; the dependency allowlist           │
└──────────────────────────────────┬─────────────────────────────────────────────────────┘
                                   │ depends on (exact version)
                    ┌──────────────▼───────────────┐
                    │  @dripfunnel/storefront-core │  GitHub Packages, semver; hooks,
                    │  incl. ./guard (the validator│  sealed components, contracts, the
                    │  and gates) and ./testing    │  validator and the gate suites
                    └──────────────┬───────────────┘
                                   │ GraphQL, public store key
                    ┌──────────────▼───────────────┐
                    │  Shop API (DF engine)        │
                    └──────────────────────────────┘
```

Builds and AI changes never run in the store repo: they run in the platform's sandbox image
(`apps/sandbox`, §6.1), which has core and the allowed libraries preinstalled for each core
version. The store repo has no workflows and needs no package access.

### 2.1 `@dripfunnel/storefront-core`

Everything a store must behave identically on. Organised as feature modules, as the reference
is (`account`, `authentication`, `cart`, `checkout`, `collections`, `currency`, `orders`,
`pricing`, `products`, `search`), plus the platform layers:

| Module | Provides |
|---|---|
| `platform/api` | The Shop API client (PLATFORM-PROMPT §5.5): operations whose answers are decoded with zod schemas written from `apps/api/schema/shop.graphql`, as the SPAs do (decided on #304, in place of gql.tada), the store key header, the shopper session and cart tokens, language, currency and market headers, error mapping. No other module performs network calls. |
| `platform/store` | Store resolution from `store.config.ts`, store settings from the Shop API (name, locales, currencies, policies, legal and compliance info, brand "Powered by" rule), **the brand and the home page's search and sharing** (logo, tagline, social links, public contact, title, description, share image: SAAS §9.2), and the store's state (live, past due, suspended) for degraded mode. A theme reads all of it through `useStorefront()` and never copies it into its own files (decided 2026-10-08 on #470). |
| `platform/render` | The render-mode adapter (§4): one interface for data loading that resolves at build time in live mode and at run time in preview mode. |
| `platform/i18n` | Locale routing, message catalogues for core strings, `t()` over the theme's `content/{locale}/*.json`, `Intl` formatting, RTL direction. Core messages can be restyled, never removed. |
| `platform/seo` | The whole `<head>` (§8): title, description, canonical URLs, hreflang, Open Graph, structured data (Product, Offer, BreadcrumbList, ItemList, Organization, WebSite, Article), sitemap and robots, noindex in preview. |
| `platform/analytics` | Commerce events (view item, add to cart, begin checkout, purchase), consent-aware, provider adapters: **GA4, Meta Pixel and Google Tag Manager**, loaded only after consent and after the page loads (decided 2026-10-05 on #337); and **real-user Core Web Vitals**, also only after consent (decided 2026-10-08 on #470, §9). |
| `platform/consent` | Cookie and tracking consent by region (EU/UK required). |
| `platform/media` | `<Image>` (Cloudflare image resizing, AVIF/WebP, `srcset` and `sizes`, width and height always set, lazy unless core chose it as the page's main image), `<Video>` (poster required, `preload="none"` on phones, paused off-screen and under reduced motion, a size cap) and the font loader (allowlisted, self-hosted, subset `woff2`, metric-matched fallbacks). |
| `platform/browser` | The only browser access a theme gets: `useInView`, `useScrollProgress`, `usePointer`, `useMediaQuery`, `useReducedMotion`, `navigate()`, `<Link>` (internal routes and the store's listed external links; prefetch by Speculation Rules). |
| `cart` | The active order as the only cart state (the reference's rule), add, remove, adjust, apply and remove codes, buy now, optimistic UI with server reconciliation. |
| `checkout` | The checkout controller: contact → shipping address → delivery → payment → review, with the engine deciding what each step needs, and express wallets where the provider offers them. Payment adapters (Stripe, Razorpay, Cashfree first), each loading its own provider SDK; asynchronous settlement with a "payment processing" state (the reference's `PaymentProcessingBanner` pattern). The theme skins its slots; an error in the theme's checkout switches that shopper to the baseline checkout. AI storefronts check out in the theme; own storefronts hand off to the engine's hosted checkout by default (decided 2026-10-05 on #337). |
| `products`, `collections`, `search` | Hooks for product detail (versions, options, selection rules, live price and stock), collection listings with `fetchMore`, search with filters (OR within a filter, AND across filters), sorting and pagination as URL state. |
| `account`, `authentication`, `orders` | Sign-up, verification, sign-in, password reset, profile, addresses, order history, order detail and tracking. |
| `pricing` | `Money`, `Stock`, `Rating` and `Badge` as **opaque branded types** only core's hooks return; the price display: currency always explicit (the reference's silent `USD` default is banned), tax label per region ("incl. VAT", "+ tax"), compare-at price only as the engine returns it. |
| `ui/headless` | Unstyled, accessible behaviour components the theme skins: variant picker, quantity stepper, cart drawer state, address form (country-aware fields), payment element host, facet filter, pagination, locale and currency pickers, search overlay. |
| `sealed` | The **sealed components** (§3.5): the price with its tax label, the payment element, legal and compliance notices, the consent banner, the preview banner, the brand's "Powered by" line, breadcrumbs and the order summary at review. |
| `contracts` | The TypeScript interfaces and route manifest the theme must satisfy (§3), and `routes.json`'s schema. |
| `guard` | The **validator** (§3.4) and the **gate suites** (§4.2) the sandbox runs, exported as `./guard`. |
| `testing` | The contract checks, exported as `./testing`. |

**Cancelling and returns on the storefront** (*proposed* on #285, awaiting Gaurav's approval; §12): a shopper may cancel an order
until it ships, and may ask for a return until the **store's returns window** closes, counted from
delivery. The window is the store's own policy, read by `platform/store` with the other policies,
never the theme's; a product's own rule overrides it (CATALOG-DESIGN S8), and neither may go below
a market's legal floor. Downloads keep the store's limits the same way (times and days per
order). The prototype draws both (`designs/DF Storefront Prototype`: 14 days in the India sample,
30 in the US one); the events are logged as LOGGING §2 lists.

**Core exposes behaviour through three shapes, and the theme owns every pixel:**
1. **Hooks** (`useCart()`, `useProduct()`, `useCheckout()`, `useStorefront()`, …) return data,
   state and actions.
2. **Headless components** with render props or slots render nothing visual of their own.
3. **Sealed components** render something that must exist and be seen: the theme places and
   styles them through tokens and `::part`, and can't omit, cover, replace or reword them.

### 2.2 The store repo

Created **when the merchant first picks a template** in Storefront, not at provisioning
(decided 2026-10-08 on #470): an empty repo in the `dripfunnel` org, into which
`apps/api/src/integrations/github` copies `templates/storefront/` with the chosen template's
theme (§2.3) through the GitHub App, then writes the generated files (`store.config.ts`, route
shims) and pins the published `@dripfunnel/storefront-core` version (PLATFORM-PROMPT §5.7,
`../ARCHITECTURE.md` §1). Nothing in the repo is edited by hand: **the platform commits each
change the AI makes once it passes the fast gate** (§6.2), through the GitHub App; the
sandbox itself holds no credential (§6.1).

```
src/
  app/                  LOCKED, generated. One thin file per core route and custom page,
                        re-exporting the page routes.json names (the reference's
                        "app files are re-export shims" test, kept).
  theme/                AI-WRITTEN
    pages/              a page per core route (§3.1) and the store's custom pages
    components/         server components; components/interactive/ for client islands
    styles/             *.module.css only
content/{locale}/       AI-WRITTEN: every shopper-facing word, one file per page or area
routes.json             AI-WRITTEN: core route → theme page; custom page path → theme page
store.config.ts         LOCKED, generated: store key, Shop API URL, preview and live
                        hostnames, locales, currencies, core feature flags
package.json            LOCKED: core pinned exactly; dependencies from the allowlist only
```

Choosing another template later replaces `src/theme/**` and `routes.json` with that
template's, after asking whether to **keep the merchant's words** (`content/**` kept) or take
the template's.

### 2.3 Templates

The six templates and "Start from scratch" live in this repo as complete starting themes,
`templates/storefront/themes/{key}/` (`src/theme/**`, `content/**`, `routes.json`, a
`template.json` with the name, description and demo store) *(proposed, the baseline-theme card
confirms the path)*. "Start from scratch" is the baseline theme drawn in
`designs/DF Storefront Prototype` (D1, #285). Every template passes every gate of §4.2 with
every core release before it ships (§10). A template keeps its own colours; the brand's
colours are a hint the AI uses when asked, never applied automatically.

---

## 3. The theme contract

### 3.1 Routes

Core owns the **route map**; the theme owns what each route looks like. Required routes:
home, collection, product (plus a version URL), search, cart, checkout, order confirmation,
sign-in, register, verify, forgot and reset password, account (profile, addresses, orders,
order detail), policies (terms, privacy, shipping, returns, legal notice), 404, and the
degraded-store page, plus **content pages** (FAQ, lookbook, the merchant's own) and the blog
from SAPI 24.

**Custom pages**: the AI may add pages of its own in `routes.json` (an About page, a page
featuring one product, a lookbook of its own design). **All of a store's paths are one
namespace** (decided 2026-10-08 on #470): core's routes are reserved; a custom page's path that
a content page or blog post already uses is refused by the validator, and SAPI 24 refuses a
content page or post slug a custom page uses. The platform holds both lists: each accepted
change records the theme's custom paths in `storefront.custom_paths` (from `routes.json`), and
the Worker passes the store's content and post paths into the validator's context, so the
sandbox needs no network to check them. A custom page may show catalogue data through
core's hooks and may hold core's commerce components (add to cart, buy now), but never
performs commerce of its own: no cart, checkout or pricing pages.

`routes.json` must map every required route to a page. A missing mapping fails the gate.

### 3.2 What the theme receives and must render

Each page receives typed props from core (for example `ProductPageProps`: product, selected
version, price, availability, breadcrumbs, related products, SEO data) and may call core
hooks. Contract tests assert, per route, that the rendered page:

- renders every **sealed component** for that route (price with tax label, add-to-cart that
  uses `useCart`, payment element on checkout, legal and compliance notices where the store's
  markets require them, consent banner, preview banner in preview, "Powered by" where the
  brand's rule shows it), **visible**;
- shows only data that came from core. **No hard-coded products, prices, stock, discounts,
  ratings, reviews, badges or scarcity claims** (the reference's rule, now enforced by the
  validator, §3.4, and a scan of the content files);
- keeps the accessibility floors (§8), the SEO rules (§8) and the performance budget (§9).

### 3.3 What is enforced, and where

| Danger | Wall 1: can't be written (§3.4) | Wall 2: the gate rejects it (§4.2, §6.2) | Wall 3: the runtime contains it (§3.5) |
|---|---|---|---|
| **A wrong price or total** | `Money` is an opaque type only core's hooks return; `<Price>` takes nothing else | A scan for currency and number patterns in content and rendered text | The engine computes and charges every amount; checkout's review step is a sealed core summary |
| **Broken checkout** | Core owns the route and the controller; the theme only skins its slots | The checkout smoke test at three widths (product → cart → checkout → test payment) | An error in the theme's checkout switches that shopper to the baseline checkout |
| **A required part hidden** | Sealed components in a closed Shadow DOM; theme CSS can't name them or core's classes | A headless browser checks each sealed component is present, visible, uncovered, on screen and at least its minimum size, on every route at three widths | Each sealed component checks its own visibility at run time and reports a violation; the consent and preview banners sit in the browser's top layer |
| **Invented data** ("only 2 left", stars, badges) | No text in code; stock, ratings and badges only from core | A scan of `content/**` for scarcity, urgency, rating and price patterns | n/a |
| **Network calls, trackers, leaks** | No `fetch`, sockets, `eval`, dynamic import, storage, cookies, `<script>`, `<iframe>`; imports from the allowlist only | A bundle scan | **CSP** (`connect-src` only the Shop API and payment providers) and **Trusted Types** block what the checks missed |
| **A build that breaks** | Dependencies fixed and preinstalled; the theme compiles against core's public types only | Typecheck, validator and bundle before a change becomes the draft; the repair loop | The live site keeps the last version that passed; every published version is kept |
| **A page that crashes** | n/a | Contract tests on every route, with the edge-case catalogue (§10) | Each section has core's error boundary and falls back to the baseline section |
| **A slow or unfindable site** | Server-only components unless interactive; core owns images, fonts, scripts and `<head>` | Byte and timing budgets, the no-JS render check, the crawl (§8, §9) | Speculation rules, edge caching, reduced motion enforced by core |
| **Instructions hidden in a sample site or image** (prompt injection) | The AI's only output is a file diff; it holds no tool, secret or network | Every gate above, the same for every change | The sandbox has no network and no credential (§6.1) |

**The engine is the last authority on money**: if every wall in front of it failed, a theme
could at worst *display* something wrong, never *charge* it.

### 3.4 The validator (`./guard`)

Run on every change, before the change becomes the draft (§6.2), and again on the whole theme
at publish. It is an **allowlist**: what isn't listed is refused.

**Files.** The AI may write only `src/theme/pages/**/*.tsx`, `src/theme/components/**/*.tsx`,
`src/theme/styles/**/*.module.css`, `content/{locale}/*.json` and `routes.json`. Any other
path, file type, symlink, or a file over its size cap refuses the **whole change**, never a
trimmed one. Caps on file count, file size and total theme size.

**Code** (type-aware, using the TypeScript checker):
- **Imports** only from `react`, `@dripfunnel/storefront-core/theme` (core's public theme
  API), relative paths inside `src/theme`, and the library allowlist: `motion` (only inside
  `components/interactive/`, loaded lazily) and `clsx` (decided 2026-10-08 on #470; each
  addition goes into the sandbox image). No dynamic `import()` or `require`.
- **No browser globals**: no `window`, `document`, `globalThis`, `fetch`, XHR, WebSocket,
  `EventSource`, `sendBeacon`, storage, cookies, `eval`, `Function`, string timers,
  `postMessage`, workers, no assignment to `location`. Browser behaviour comes from
  `platform/browser`.
- **No walking the DOM**: on a value typed as a DOM node, no `parentElement`, `closest`,
  `querySelector*`, `getRootNode`, `shadowRoot`, `innerHTML`, `outerHTML`, `insertAdjacent*`
  or computed `[expr]` access. A ref may style its own element and nothing else.
- **JSX**: no `dangerouslySetInnerHTML`, `<script>`, `<iframe>`, `<object>`, `<embed>`,
  `<form>`, `<input>`, `<meta>`, `<link>`, `<base>` or `<style>`; links only through core's
  `<Link>`, images and video only through core's `<Image>` and `<Video>`, forms and inputs only
  from core components. No `loading="eager"` or priority hints: core picks the main image.
- **No text in code**: every word a shopper sees comes from `content/*.json` through `t()`;
  JSX text literals, and string literals rendered as text, are refused. A brand field
  (shop name, tagline, contact) appears only through `useStorefront()`, never as a literal.
- `'use client'` only in `src/theme/components/interactive/`.

**CSS**: CSS Modules only; every selector starts with a module class; no `:global`, no
`@import`, no `@font-face`; `url()` only for the store's media ids; no selector naming a core
class or a `df-` element; `z-index` below core's layer; animation only of `transform`,
`opacity` and `filter`.

**Content**: every key the theme's `t()` calls exists in **every language the store offers**
(the AI writes them all, decided 2026-10-08 on #470; the merchant can correct any); no pattern
of a price, a scarcity or urgency claim, a rating or a countdown.

**Routes**: §3.1's rules.

### 3.5 Sealed components and the runtime walls

*Planned (#481)*: until it lands, the required components of #304 are plain DOM a theme styles
through their class names, and the banners are not yet in the top layer.

- **Sealed components** render in a **closed Shadow DOM**, styled only through the custom
  properties and `::part` names core documents; theme CSS can't reach inside. Each checks its
  own visibility after layout (on screen, not covered at its centre, not transparent, not
  below its minimum size) and reports a violation to the platform.
- **The consent and preview banners** use the browser's **top layer** (`<dialog>` or
  `popover`), which no `z-index` can cover.
- **CSP**: scripts only from the store's own build and the hosts of the analytics providers
  **this store has set up** (GA4, Google Tag Manager, Meta Pixel, §2.1), which load only after
  consent; `connect-src` only the Shop API, the store's payment providers and those analytics
  hosts; images from the store's media and the payment providers; fonts
  from the store's build; `form-action` only the store and the payment providers;
  `frame-src` only the payment providers. **Trusted Types** required.
- **Error boundaries**: core wraps every section; a section that throws falls back to the
  baseline section and is reported. Checkout falls back to the baseline checkout.

---

## 4. Two render modes

The same repo builds in two modes. Core's `platform/render` adapter hides the difference from
the theme, so a page is written once.

### 4.1 Preview (staging)

- **Where**: the brand's preview subdomain, e.g. `{store}.preview.dripfunnel.com` or
  **`{store}.preview.{partner-domain}`** on the partner's wildcard (decided 2026-10-05 on #337).
- **How**: a client-rendered build with no SSR and no SSG. Every page loads its data from the
  Shop API at run time, so the build holds no catalogue and takes seconds.
- **When**: **each change that passes the fast gate is built in preview mode and deployed to
  the preview host** (decided 2026-10-08 on #470), so "Open preview" always shows the current
  draft, on any device, after the studio closes. The studio itself shows the sandbox's own
  dev server (§6.1).
- Previews are `noindex`, carry a visible "Preview" banner, and open only through a **signed
  link from the portal** (decided 2026-10-05 on #284). Checkout in preview uses the payment
  providers' **test mode** (decided the same day).

### 4.2 Live (production)

- **Where**: the customer's custom domain via Cloudflare for SaaS. Until one is connected,
  `{shop}.shops.<partnerdomain>` (SAAS §8).
- **How**: a **static build (SSG)**. Catalogue pages (home, collections, products and their
  version URLs, content and policy pages, custom pages, per locale) are prerendered from a
  catalogue snapshot, with SEO data baked in.
- **Live data after load**: price, stock, cart, account and checkout always come from the
  Shop API in the browser. The prerendered price is the build-time value for the default
  currency and is superseded by the live fetch, skipped when nothing differs (the
  reference's 2026-09-03 decisions, kept), holding its space so nothing shifts.

**The publish pipeline** (every publish of any kind: design, catalogue, automatic, staff,
core upgrade):

```
1. freeze the input: the commit to publish, and a snapshot of the catalogue from the Shop API
2. build it in the frozen sandbox image for its core version, offline (no network but the
   snapshot): the same inputs give the same files
3. full gate on the built files:
     the validator over the whole theme (§3.4); contract tests per route; sealed-component
     visibility at 3 widths; the checkout smoke test (test mode); axe; the budgets (§9);
     the no-JS render check and the crawl (§8); the content scan; a visual diff against the
     live version; and the theme rendered against the edge-case catalogue (§10)
4. fail → REPAIR (a design publish only: the AI fixes its own code from the report, ≤3 tries,
   each re-running the full gate) → still failing → BISECT the draft's commits to the first
   one that breaks, and offer "publish everything before this change" → else refuse
5. pass → deploy the built files to the store's Pages project (atomic), purge the store's
   cache, then POST-DEPLOY CHECKS from the edge within about two minutes (home, a product,
   add to cart, checkout opens, the payment element renders)
6. post-deploy failure → AUTOMATIC ROLLBACK to the previous deployment (seconds), then the
   repair loop on the candidate
```

A refused or rolled-back publish leaves the live site as it was, says so in plain words, and
**never uses an allowance** (SAAS §6.2). Repair attempts and gate runs are the platform's cost,
never the merchant's meters (decided 2026-10-08 on #470). What can't be repaired goes to the
ops queue in the admin console (CONSOLE-DESIGN L3), with the live site untouched.

**Staying current without full rebuilds on every edit** *(the platform's rule that catalogue
changes don't rebuild, adapted to SSG)*:

1. **A new or renamed product gets its page at once** (decided 2026-10-08 on #470): a
   **single-page render** builds that product's page (and its version URLs) with the store's
   live theme, adds it to the sitemap, redirects the old address (§8), deploys it on top of the
   live deployment and notifies IndexNow. It takes seconds and uses no allowance. Until it lands,
   and for any other unknown catalogue URL, the edge serves a client-rendered fallback.
2. **Catalogue publishing**:
   - **Change detection**: engine events (product, version, collection, filter, menu,
     content, store settings that appear on the storefront) mark the store's live site
     **"has unpublished changes"**, with what changed and when, in an engine table.
   - **"Publish now"**: the merchant presses it in the portal and a live catalogue build
     runs. Each press uses one **catalogue build from the plan's monthly allowance**. **The
     allowance is set per plan by the partner** in the partner console (or by DripFunnel staff
     on its behalf), within the platform ceiling DripFunnel sets (../api/SAAS.md §6.1,
     CONSOLE-DESIGN G2). The button shows what is waiting ("12 products changed since 10:40"),
     how many publishes are left this month, and when the next automatic publish is due. At
     zero it explains itself and points to the automatic publish and the upgrade (Owner only).
   - **Automatic publishing**: every store with unpublished changes is published on a
     **schedule configured in the admin console** (CONSOLE-DESIGN R5). It never uses the
     allowance. Stores with no changes aren't rebuilt.
   - **One build at a time per store**: a press while a build runs queues the next one; changes
     made during a build are picked up by the next. Publish builds run in their own pool of
     containers, so a burst of publishes never slows a studio (§6.1).
   - **Status is real, not estimated**: queued, building, checking, deploying, live, failed,
     rolled back, from the job and the deploy, never from polling with a cache (the old
     tracker's gap).
   - Build minutes per store per month stay a platform metric (SAAS §12), shown in the admin
     console.
3. **Removed or hidden products** return a proper 404 or redirect immediately via an edge
   rule, without waiting for the rebuild.
4. **Design changes** go live only when the merchant publishes them in the studio (SAAS
   §9.2). Brand changes go out with the next publish of any kind; saving the home page's search
   and sharing re-renders the home page at once, like a new product's single-page render.
- **Degraded store** (past due, suspended): an edge rule serves the degraded page or a
  read-only notice without a rebuild (DESIGN-BRIEF fact 9).

### 4.3 Pitfalls the reference already hit (carry the fixes)

From the reference's recorded decisions:

- A component reading search params directly (`useSearchParams()`) in a static build turns
  the whole enclosing boundary client-only and blanks it from the HTML. Isolate that read in
  one invisible component and pass values down.
- A version selector that only changes client state never appears in static HTML. Give each
  version its own URL and page, canonicalised to the product.
- Next.js static-export link prefetch requests files that don't exist. Core's `<Link>`
  turns it off and prefetches with Speculation Rules instead.
- The image optimiser needs a server. Use **Cloudflare image resizing** through core's
  `<Image>` instead of `unoptimized` originals (decided 2026-10-05 on #337).
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
- Build-time reads (live mode) use the same public Shop API, with a build-only rate limit; the
  publish pipeline reads them once, into the catalogue snapshot.
- The Shop API version is pinned by the core version; a core release declares which Shop API
  versions it supports.
- Cart operations must not need the reference's `ORDER_MODIFICATION_ERROR` retry workaround:
  the engine's cart model shouldn't lock the order during checkout in a way the storefront has
  to fight (raise it with the engine design if it does).

---

## 6. The AI loop, storefront side

Decided 2026-10-08 with Gaurav on #470 (SAAS §9.2 owns the platform side: the API, the
`design_*` rows, metering):

```
the merchant fills in "Your brand" (first time only)
  → picks a template, or "Start from scratch"     (the repo is created, §2.2)
  → describes a change in the studio: words, a pasted image, a sample site's address
  → the Worker asks the model; the model answers with a file diff
  → the store's sandbox applies it and runs the fast gate        (§6.2)
      fail → repair from the exact errors (≤3) → else "I couldn't make that change",
             nothing changes
  → pass → the platform commits it; the studio shows it; the preview host gets it (§4.1)
  → "Undo this change" reverts the latest commit
  → Publish → the pipeline of §4.2
```

### 6.1 Studio sessions: one sandbox per store

```
Merchant A's studio ─┐                          ┌─ Durable Object "studio:A" ─► container A
Merchant B's studio ─┼─► API Worker ────────────┼─ Durable Object "studio:B" ─► container B
Merchant C's studio ─┘   (model calls, keys)    └─ Durable Object "studio:C" ─► container C
                                                 Publish builds: Queue ─► build containers
```

- **One Durable Object per store** owns the store's studio session: the container, the change
  in progress and the draft's head commit. It runs **one change at a time**: a second request
  for the same store (another tab, another device) waits, and the studio says "Finishing your
  previous change…"; both see the same draft as each change commits.
- **One container per store with a studio open** (Cloudflare Containers, `apps/sandbox`'s
  image for the store's core version, with core, the allowed libraries and the gate tools
  preinstalled). It applies diffs, runs the fast gate and serves the studio's live preview.
  Stores never share a container, a file system or a queue for changes.
- **No credential and no network in the container.** The Worker makes the model call (the
  partner's or merchant's key never enters a container); the Durable Object loads the store's
  last commit into the container when it starts and commits accepted changes through the
  GitHub App itself.
- **How the studio reaches its sandbox**: the studio's preview frame and every change go to
  the Store API on the portal host, never to a container's address. The Worker builds the
  `TenantContext` from the session (ACCESS §3), checks the `publish` capability (a Manager may
  only view), and forwards to the Durable Object named by **the context's store**, never by a
  store id from the client; the Durable Object forwards to its own container. So no address
  reaches another store's draft (isolation test on #482).
- **Idle stop and cold start**: a container stops after 10 idle minutes *(proposed)*; the next
  request starts a new one from the image and the last commit in a few seconds ("Opening your
  studio…").
- **A crash** mid-change: the Durable Object starts a new container from the last commit and
  retries the change once; the draft is only ever the last committed state.
- **Capacity**: when the account's container limit is reached, studios wait in a queue that
  shows the merchant's place ("You're next — about 20 seconds"). A plan may cap simultaneous
  sessions *(decide)*. The account's limits and the price are confirmed on INF 0 (#287).
- **Publish builds** use their own pool of containers fed by a Queue, so the nightly
  automatic publish never slows a studio. "Publish now" presses go ahead of automatic ones.

### 6.2 One change

- **The model's working context**: the store's theme files (or the parts the change touches),
  core's theme API and the rules of §3.4, the page and screen size the merchant is looking at,
  their last four requests, the store's name and city, a sample of about 12 products (names
  and prices; never photos), the brand (tagline, description, voice; colours only as a
  hint), and, when given, the merchant's image or a screenshot of the sample site.
- **A sample site** is fetched as a screenshot by the platform (public addresses only, the
  rules of `../ARCHITECTURE.md` §7), never by the container. The AI takes its layout, spacing,
  colour and mood, **never its logo, photos or words**.
- **The fast gate** (seconds): the file allowlist, the validator, the typecheck, the bundle,
  the byte budgets (§9) and the content checks. On failure the model gets the exact errors
  and tries again, **at most three times**; repairs are the platform's cost.
- **What it refuses**: prices, stock, products, shipping and checkout behaviour; it says these
  are changed in Products or Settings, and the draft stays as it was. A request that would
  break a budget is answered in words with an alternative ("a 4K video would make the page
  slow on phones; I can use a short compressed loop").
- **Undo** reverts the latest change's commit. **Go back to this** makes an earlier published
  version live again by redeploying its kept deployment (no build, free), then resets the
  draft to that version's commit, so the next change starts from what is live (decided
  2026-10-08 on #470). **Except across a security fix**: when a security release of core is
  newer than that version's core, the version is rebuilt on the fixed core and gated instead
  (still free), so going back never brings a vulnerable core back.

---

## 7. Core upgrades across the fleet

- Core follows **semver**. The release workflow publishes it and *(planned, #482)* builds the
  **sandbox image** for that version.
- **The upgrade bot** (SAAS §10) takes a release to every store, **canary stores first**, then
  in waves: it builds each store's current published commit with the new core, applies
  core's **codemods**, and runs the full gate of §4.2 plus a visual diff against what is live.
- **Patch and minor** releases can't change the look or the theme contract. A store that
  passes goes live on the new core; a store that fails gets the **migration agent** (the AI,
  with the build errors and the release's upgrade notes, under the same walls and gates); a
  store still failing **stays on its old core version**, with an alert in the admin console.
- **Major** releases ship **upgrade notes** in the reference's structured format
  (`.upgrades/changes/*.md`) and codemods. The new look reaches a store only when its merchant
  next publishes (or approves the upgrade in the studio), keeping the #337 rule that **the
  merchant approves** visual changes.
- **Security fixes** reach every store: a store whose theme can't build on the fixed core,
  even after the migration agent, is served the **baseline theme** with its own colours, fonts
  and words until the repair succeeds or the merchant republishes, and its merchant is told
  plainly (decided 2026-10-08 on #470).
- The admin console shows core-version drift, pinned stores and rollout state (CONSOLE-DESIGN
  part L).

---

## 8. Cross-cutting requirements

- **Languages and currencies** follow store settings: locale routing, translated catalogue
  content from the Shop API, core messages per locale (the reference ships en, de, hi, tel),
  the theme's words in `content/{locale}/` for every language the store offers, currency
  picker only when there's more than one, RTL layouts where the store offers right-to-left
  languages.
- **Regions**: tax labels, address formats, required legal and compliance notices, and unit
  display all come from store settings via core (CATALOG-DESIGN-PROMPT §3 facts 36–48).
- **Accessibility**: WCAG 2.2 AA as the floor (the EU Accessibility Act and ADA make this
  legal, not optional). Headless components carry the semantics; the gate runs axe per route.
- **SEO**, owned by core and fed by the engine's per-language search fields:
  - **The whole `<head>`** (title, description, canonical, hreflang, Open Graph and Twitter
    cards, robots); the AI and the merchant supply only words, through validated content fields.
  - **Structured data from real data only**: Product with its Offer (the real price, currency
    and availability), BreadcrumbList, ItemList on collections, Organization and WebSite with
    SearchAction, Article for the blog.
  - **Crawling**: `sitemap.xml` per locale with `lastmod` and images, `robots.txt`; filter and
    sort URLs canonicalised so they make no crawl traps; correct pagination canonicals;
    previews `noindex`.
  - **Addresses**: a renamed product, collection or page gets an automatic **301** from its
    old address at the edge; removed products answer 404 or redirect; trailing slashes
    consistent; the root redirects to the default locale.
  - **Breadcrumbs** are sealed on product and collection pages.
  - **Telling search engines**: IndexNow on every publish and single-page render (Bing,
    Yandex); Google through the sitemap named in `robots.txt`. A Search Console verification
    tag can be set in Site settings.
  - **What the theme must do**: one `<h1>` per page and headings in order; the main content
    in the HTML without JavaScript (the gate renders every page with JavaScript off and checks
    the `<h1>`, the main text, and a product's name and price are there); alt text on every
    image (product photos from the catalogue); landmarks (`header`, `nav`, `main`, `footer`);
    descriptive link text; each custom page has a slug, a title (≤60) and a description (≤160),
    unique in the store.
- **Privacy**: consent before non-essential tracking where required, real-user speed data
  included (§9); no third-party scripts outside the allowlist.
- **White label**: the brand's "Powered by" rule is a sealed component driven by store
  settings (CONSOLE-DESIGN §3 fact 18).

---

## 9. Performance budgets

Gates on every publish, per page type (home, collection, product, custom pages, cart), on a
mid-range phone profile *(proposed 2026-10-08 on #470 as the starting gates; real-user data
decides whether to tighten them)*:

| Measure | Budget | For reference |
|---|---|---|
| Largest Contentful Paint (lab) | ≤ 2.0 s | Google's "good" is 2.5 s at p75 in the field |
| Cumulative Layout Shift (lab) | ≤ 0.05 | Google's "good" is 0.1 |
| Total Blocking Time (lab); Interaction to Next Paint (field) | ≤ 150 ms; ≤ 200 ms | 200 ms is Google's "good" INP |
| JavaScript on first load, gzipped | ≤ 90 KB (checkout excluded) | |
| CSS, gzipped | ≤ 50 KB | |
| The main image at phone width | ≤ 200 KB | |
| Page weight on phones | ≤ 1 MB (video capped separately) | |

**Byte budgets are exact and repeatable, so they are hard gates in the fast gate and at
publish.** Timing budgets vary run to run: they are measured three times at publish and the
median counts.

- **How core keeps them**: theme components are server-only unless they are interactive
  islands; payment SDKs load only on checkout and only the store's provider; images, video,
  fonts and third-party scripts go through core (§2.1); third-party tags load after consent and
  after the page.
- **Real-user Core Web Vitals** are recorded by core **only after the shopper consents**
  (decided 2026-10-08 on #470), anonymously and first-party, and Google's CrUX data per domain
  is read too. A p75 regression after a deploy starts a repair and is flagged in the admin
  console; a severe one (LCP or INP doubled, CLS above 0.25) also rolls back automatically.
  Without consent the field data is thinner, so the lab gates carry most of the weight.

---

## 10. Testing

- **Core**: unit and integration tests against a real engine (the platform's test stack),
  the contract and gate suites published with the package, the validator tested against a
  corpus of forbidden code (every rule of §3.4 has a case that must be refused), and payment
  adapters tested in provider test modes.
- **Templates**: every template passes every gate of §4.2 with each core release, before the
  release ships.
- **The edge-case catalogue**: a store of fixture data every theme is rendered against at
  publish: very long names, no photos, 100 versions, everything out of stock, no products,
  every language the store offers, a right-to-left language, the largest prices.
- **Per store**: the full gate of §4.2 on every publish, in the sandbox, plus the
  architecture tests carried from the reference (`tests/architecture/boundaries.test.mjs`: app
  files are only re-exports; feature internals aren't imported from outside).
- **Fleet**: a core release is gated against a sample of real store themes before canary.

---

## 11. What to take from the reference

| Take (adapt) | Change | Drop |
|---|---|---|
| Feature-module layout and the boundary rules (thin `app/`, features imported only through top-level files, colocated operations and messages) | Features move **into the core package**; the store repo keeps only the AI's theme and the shims | Everything developer-owned-by-default: here the theme is the AI's, inside the walls of §3, and core is locked |
| The architecture tests, i18n message composition and its duplicate-namespace test | The reference's transport (its channel token headers) → our client and store key | Framework-specific workarounds (`withCartModificationRetry`, `ORDER_MODIFICATION_ERROR`, the hard-coded root `parentId: "1"`) |
| The protected-commerce list in its `CLAUDE.md` and `docs/commerce.md` (active order as the only cart, checkout order, async payment settlement, facet OR/AND, validated currency) as core invariants | Server Actions and `'use cache'` notes (already stale there) → the render-mode adapter (§4) | The S3 + CloudFront workflows and committed `.env.*` build config |
| Static-export lessons (§4.3), the live-price supersede pattern, per-version pages | Payment clients (Stripe, Razorpay, Cashfree) → core payment adapters against our engine | The `USD` default in the price component |
| The upgrade-note protocol for core majors (§7) | Upgrade reconciliation done by our migration agent per store, not by a merchant's developer | `upgrade:init` provenance for human forks (the upgrade bot owns provenance) |
| Its shadcn primitive set and Tailwind v4 token approach as a starting kit for the **templates** | Each template carries its own tokens (DESIGN.md) | The neutral slate-only look as a default for stores |

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
- ~~Does the AI edit the theme's code, and how does a design start?~~ It writes the theme's code inside the walls of §3, from a template after a brand step (decided 2026-10-08 on #470, reversing that day's site-data design; §1, §6).
- ~~Which content pages and sections may the theme add without new core support (blog, lookbook,
  store locator)?~~ FAQ, lookbook, the merchant's own pages **and a blog** (SAPI 24); any custom page the AI writes (§3.1); no store locator (decided 2026-10-05 on #337).
- ~~How store repos authenticate to GitHub Packages in CI.~~ They don't: builds run in the sandbox image, which has core preinstalled (decided 2026-10-08 on #470, following the choice of Cloudflare Containers; it replaces #303's org secret).
- ~~Where AI changes and builds run.~~ Cloudflare Containers, one per store with a studio open and a pool for publish builds (decided 2026-10-08 on #470).
- ~~What a store whose theme can't take a security fix gets.~~ The baseline theme until repaired (decided 2026-10-08 on #470).
- How the preview build reaches `{store}.preview.{partner-domain}`: a branch deployment of the store's Pages project, or its own project *(decide, INF 2)*.
- The containers' size, the idle timeout (10 minutes proposed) and whether a plan caps simultaneous studio sessions *(decide, INF 0 and the sandbox card)*.
- Whether the studio's live preview is the Next.js dev server in the container, or a lighter client build of the same theme *(decide, the sandbox card)*.
- Shopper cancelling and returns (§2.1, proposed on #285): cancel until the order ships; a return until the store's window closes, counted from delivery; a product's rule over the store's, never below a market's legal floor. The prototype draws this; it stands until approved or changed on #285.
- Sample words in a template (raised on #470): a template's sample testimonial quote and author (Bloom, Atelier) is invented content. Until decided, the AI never writes a quote attributed to a person, and the studio flags sample text before the first publish (DESIGN.md §9).
