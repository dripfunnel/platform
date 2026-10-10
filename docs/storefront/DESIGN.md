# DESIGN.md: storefront template

What the AI may design in a store's storefront, how it starts, and the rules every design
keeps. Read with [ARCHITECTURE.md](ARCHITECTURE.md): that document says *how* a design reaches
shoppers (theme code written by the AI, fenced by walls, rendered with core); this one says
*what good work looks like*.

**The aim:** every store looks like itself. Two stores on DripFunnel should not look like the
same theme with different colours. The AI has full freedom over the look and the front-end
behaviour; the core package and the engine guarantee the commerce.

Last updated: 2026-10-08 (#470: the AI writes theme code behind strict walls, "Plan A").

---

## 1. Who the AI is designing for

- **The merchant** is non-technical. They describe what they want in words ("make it feel
  like a quiet Japanese stationery shop", "bigger photos, less text", "put the sale up top"),
  paste an image ("make my hero look like this"), or give a website they like; they look at
  the preview and approve. They never see code, files or this template.
- **The shopper** is on a phone most of the time, anywhere in the world, in their own
  language and currency.
- **The brand** (DripFunnel or a white-label partner) may set rules every store under it
  follows, such as the "Powered by" line (CONSOLE-DESIGN §3 fact 18).

---

## 2. What the AI may change

The store's **theme**: everything in `src/theme/**`, the words in `content/{locale}/**` and
its own pages in `routes.json` (ARCHITECTURE §2.2, §3.4; decided 2026-10-08 on #470). That is:

- **Every page's look and layout**, commerce pages included: home, collection, product,
  search, cart, checkout, account, policies, 404 (§6 says where core's part begins).
- **New pages of its own**: an About page, a page featuring one product, a lookbook, a
  landing page for a sale (ARCHITECTURE §3.1).
- **Any element anywhere**: rows, cards, grids, banners, menus, footers, announcement bars.
- **Styles and motion**: colours, fonts from the allowlist, spacing, radius, shadows,
  gradients, hover and focus effects, transitions, background animation and video (through
  core's `<Video>`), within the performance budget.
- **Front-end behaviour**: carousels, image zoom, infinite scroll, tabs, accordions, filters'
  presentation, a quiz or a size finder, written as interactive islands on core's browser
  hooks (ARCHITECTURE §2.1 `platform/browser`).
- **Where core's commerce parts sit**: add to cart, buy now, express wallets, the price, the
  variant picker, anywhere a page holds them.
- **Copy**, in every language the store offers: plain, warm words; no emoji, no fake urgency.
  The merchant can correct any language's text in the studio.

**What it reads, never copies**: the shop's name, logo, tagline, social links, public contact
and the home page's search and sharing come from Site settings through core
(`useStorefront()`); a change there reaches the site at the next publish without touching the
theme.

**Matching an image or a sample site**: the AI takes layout, spacing, colour, type and mood.
It never copies another site's logo, photos or words; product names, photos and prices always
come from the catalogue.

## 3. What the AI may not change

Enforced by the walls of ARCHITECTURE §3.3–§3.5, not by this document alone:

- **Commerce behaviour**: what goes in the cart, prices, tax, discounts, shipping costs,
  stock, availability, checkout step order and validation, payment handling, order
  placement, account security.
- **Data**: nothing hard-coded. No invented products, prices, discounts, "only 2 left",
  ratings, reviews, testimonials, "bestseller" badges or countdowns unless they come from
  the Shop API. Placeholder images and copy never ship to live.
- **Sealed components** (ARCHITECTURE §3.5): the price with its tax label, the payment
  element, legal and compliance notices, the consent banner, the preview banner, the brand's
  "Powered by" line, breadcrumbs and the order summary at review. The AI places and styles
  them, through their class, core's `--df-*` custom properties and their `::part` names
  (ARCHITECTURE §3.5); it doesn't remove, cover or reword them.
- **SEO and accessibility plumbing**: the `<head>`, structured data, canonical and hreflang,
  the sitemap, redirects, landmarks, labels, focus handling.
- **Anything outside its files**: the route shims, configuration, dependencies, core, tests.
  A library outside the allowlist, a script, a network call or a tracker is refused.
- **The network**: themes don't fetch, embed third-party scripts or frames, or add
  dependencies.

When a merchant asks for something in this list ("show 'only 3 left' on everything",
"remove the tax line", "add a free-shipping countdown"), the AI explains in plain words why it
can't, and offers what it can (for example, showing real stock when the store tracks it).

---

## 4. How a design starts

Decided 2026-10-08 on #470, as `designs/PortalStorefront` draws it:

1. **Your brand** (first time only, required before anything else): the shop name and logo
   (required), favicon, primary and secondary colours, the home page's title and description,
   a tagline and short description, social links, the public email, phone and address, and a
   tone of voice. The same fields are later in Storefront › Site settings › Brand.
2. **A template**: six (Linen, minimal fashion; Concrete, bold streetwear; Bloom, beauty and
   wellness; Circuit, electronics; Market, food and grocery; Atelier, luxury editorial) and
   **Start from scratch**, each a complete starting theme (ARCHITECTURE §2.3), previewed with
   the store's own products and openable as a demo. A template keeps its own colours: the
   brand colours are a hint the AI uses when asked, never applied automatically. Changing
   template later asks whether to keep the merchant's words or take the template's.
3. **The studio**: the merchant describes changes; each one is checked, then updates the draft
   and the preview (desktop, tablet, phone; any page of the store) and can be undone. Nothing
   reaches the live site until **Publish**, and Publish checks the whole site first
   (ARCHITECTURE §4.2).

## 5. Rules every design keeps

Design floors the gates check, whatever the look:

- **Readable and accessible**: WCAG 2.2 AA contrast for text and controls; visible focus; tap
  targets of at least 44 px; no information by colour alone; motion that respects
  reduced-motion settings (core enforces it).
- **Phone first**: every page works at 360 px wide with no horizontal scroll; the cart and
  search are always reachable.
- **Commerce clarity**: price, tax label and availability are visible near the add-to-cart
  button; the selected version is obvious; out-of-stock versions look unavailable; checkout
  shows the running total and what's left to do.
- **Honest merchandising**: badges, "sale" labels and crossed-out prices only when the Shop
  API returns them, in the form the store's region allows (CATALOG-DESIGN-PROMPT §3 fact 41).
- **Regional correctness**: dates, numbers, currencies and addresses formatted by core for the
  shopper's locale; layouts that survive long German words and right-to-left languages where
  offered.
- **Fast**: within the performance budget (ARCHITECTURE §9). Big hero videos, many web fonts
  and heavy scripts are the usual failures; the AI says so before writing a change that would
  break the budget.
- **Findable**: one `<h1>` per page, headings in order, the main content in the HTML, alt text
  on every image, descriptive links (ARCHITECTURE §8).
- **Consistent**: one set of tokens per store. The AI doesn't invent one-off colours or
  spacing on a single page.

## 6. Commerce pages: look, not logic

| Page | The AI decides | Core decides |
|---|---|---|
| **Product** | Gallery style and zoom, layout, where options sit, how versions look (swatches, buttons, dropdowns), content order, related products' presentation | Which versions exist and are buyable, the selected version's price, stock and photo, add-to-cart and buy-now behaviour |
| **Collection and search** | Grid density, card design, filter presentation (sidebar, drawer, chips), sort control placement, pages or infinite scroll | Which products match, filter logic (OR within a filter, AND across), sort and pagination as URL state |
| **Cart** | Drawer or page, layout, empty-cart design, upsell placement (from real related products) | Lines, quantities, totals, codes, limits |
| **Checkout** | Layout (one page or steps shown as tabs, accordion or pages), styling of forms and summary, reassurance content, where express wallets sit | Step order, required fields per country, validation, shipping options, payment element, placing the order, payment processing state, the review summary |
| **Account** | Layout and styling of every account page | Authentication, data shown, what can be changed |

## 7. White label and brand rules

- Stores under a white-label brand follow that brand's rules: whether "Powered by" shows,
  and the preview domain. Brands **may not** constrain fonts, colours or layouts (decided 2026-10-05 on #337).
- The house brand (DripFunnel) sets no visual constraints beyond the floors in §5.

## 8. Preview vs live

- Preview shows a clear "Preview, not your live store" banner and is never indexed.
- Preview and live render the same theme; differences come only from render mode (live data vs
  prerendered pages) and must not be visible to the merchant except in freshness.

## 9. Open questions

- ~~May a white-label brand constrain store designs (fonts, colours, layouts), or only the
  "Powered by" line?~~ Only the "Powered by" line (decided 2026-10-05 on #337).
- ~~How many design directions does the AI propose at the start, and can the merchant upload
  reference sites or screenshots?~~ Three, and the merchant may add reference screenshots (decided 2026-10-05 on #337);
  **replaced 2026-10-08 on #470** by the template gallery after the brand step (§4). Images and
  sample sites are taken in the studio at any time (§2).
- ~~Can merchants upload their own fonts, or only choose from the allowlist?~~ The allowlist only (decided 2026-10-05 on #337).
- ~~Content pages the AI may add without new core support (about, lookbook, FAQ, blog)?~~ Any
  page of its own design (§2), sharing one set of paths with SAPI 24's content pages and blog
  (decided 2026-10-08 on #470).
- ~~Is there a merchant-facing "undo to any earlier version" beyond undoing the last change?~~ Yes: any earlier published version (decided 2026-10-05 on #337).
- ~~Does the AI design with a fixed schema or with code?~~ Code, inside the walls (decided 2026-10-08 on #470, "Plan A").
- **Sample words in a template** (raised on #470): the templates carry sample copy, including a
  testimonial quote and author (Bloom, Atelier). §3 forbids invented reviews, and placeholder
  copy never ships to live. Should Publish be refused while a template's sample testimonial is
  unchanged, or the testimonial section start empty? Until decided, the AI never writes a quote
  attributed to a person, and the studio flags sample text before the first publish.
