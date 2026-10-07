# DESIGN.md: storefront template

What the AI may design in a store's storefront, how it starts, and the rules every design
keeps. Read with [ARCHITECTURE.md](ARCHITECTURE.md): that document says *how* a design reaches
shoppers (the store's site data, rendered by core); this one says *what good work looks like*.

**The aim:** every store looks like itself. Two stores on DripFunnel should not look like the
same theme with different colours. The AI has full freedom over the look; the core package
guarantees the commerce.

Last updated: 2026-10-08 (#470: site data, templates, the brand step).

---

## 1. Who the AI is designing for

- **The merchant** is non-technical. They describe what they want in words ("make it feel
  like a quiet Japanese stationery shop", "bigger photos, less text", "put the sale up top"),
  look at the preview, and approve. They never see code, files or this template.
- **The shopper** is on a phone most of the time, anywhere in the world, in their own
  language and currency.
- **The brand** (DripFunnel or a white-label partner) may set rules every store under it
  follows, such as the "Powered by" line (CONSOLE-DESIGN §3 fact 18).

---

## 2. What the AI may change

The store's **site data**, in core's schema and its limits (decided 2026-10-08 on #470;
`designs/storefront-lib.js` `SCHEMA` is the drawn version):

- **Theme**: background, surface, text, muted, accent and accent-text colours; heading and
  body fonts from the allowlist; heading weight (300–900) and case; corner radius (0–28);
  photo tone (soft, vivid, dark, mono).
- **Announcement bar**: on or off, its words and colours.
- **Header**: left or centred, up to 6 menu labels, colours.
- **Home sections**: up to 12, in order, each one of hero (split, full or centred; headline,
  line, button), products (title, 2–5 per row, 3–12 shown, card style, photo shape),
  categories (up to 6), banner, features (up to 4), testimonial, newsletter and text.
- **Footer**: its line, up to 6 links, tone.
- **About and Contact**: headline and words; Contact's email, phone and address.
- **Copy** in all of the above, in plain, warm words: no emoji, no fake urgency.

Every other page (collection, product, search, cart, checkout, account, policies) keeps the
baseline layout and takes the theme's colours, fonts, radius and photo tone. Product names,
photos and prices always come from the catalogue.

## 3. What the AI may not change

Enforced by the core package and CI (ARCHITECTURE §3.3), not by this document alone:

- **Commerce behaviour**: what goes in the cart, prices, tax, discounts, shipping costs,
  stock, availability, checkout step order and validation, payment handling, order
  placement, account security.
- **Data**: nothing hard-coded. No invented products, prices, discounts, "only 2 left",
  ratings, reviews, testimonials, "bestseller" badges or countdowns unless they come from
  the Shop API. Placeholder images and copy never ship to live.
- **Required components** (ARCHITECTURE §2.1): the price with its tax label, the payment
  element, legal and compliance notices, the consent banner, the preview banner, and the
  brand's "Powered by" line. The AI styles them; it doesn't remove or reword them.
- **SEO and accessibility plumbing**: structured data, canonical and hreflang, landmarks,
  labels, focus handling.
- **Anything outside the schema**: no new section types, routes, scripts or code. A request
  the schema can't express is answered in words, and the draft stays as it was.
- **The network**: themes don't fetch, embed third-party scripts, or add dependencies
  outside the allowlist.

When a merchant asks for something in the second list ("show 'only 3 left' on everything",
"remove the tax line", "add a free-shipping countdown"), the AI explains in plain words why it
can't, and offers what it can (for example, showing real stock when the store tracks it).

---

## 4. How a design starts

Decided 2026-10-08 on #470, as `designs/PortalStorefront` draws it:

1. **Your brand** (first time only, required before anything else): the shop name and logo
   (required), favicon, primary and secondary colours, the home page's title and description,
   a tagline and short description, social links, the public email, phone and address, and a
   tone of voice. The same fields are later in Storefront › Site settings › Brand.
2. **A template**: six presets (Linen, minimal fashion; Concrete, bold streetwear; Bloom,
   beauty and wellness; Circuit, electronics; Market, food and grocery; Atelier, luxury
   editorial) and **Start from scratch**, each previewed with the store's own products and
   openable as a demo. A preset keeps its own colours: the brand colours are a hint the AI
   uses when asked, never applied automatically. Changing template later asks whether to keep
   the merchant's words (headline, menu, footer, About, Contact) or take the template's.
3. **The studio**: the merchant describes changes; each one updates the draft and the preview
   (desktop, tablet, phone; Home, Product, Cart, About, Contact) and can be undone. Nothing
   reaches the live site until **Publish**.

## 5. Rules every design keeps

Design floors the gates check, whatever the look:

- **Readable and accessible**: WCAG 2.2 AA contrast for text and controls in both themes;
  visible focus; tap targets of at least 44 px; no information by colour alone; motion that
  respects reduced-motion settings.
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
- **Fast**: within the performance budget (ARCHITECTURE §9). Big hero videos and many web fonts
  are the usual failures; the AI says so when a request would break the budget.
- **Consistent**: one token set per store. The AI doesn't invent one-off colours or spacing
  on a single page.

## 6. Commerce pages: look, not logic

| Page | The AI decides | Core decides |
|---|---|---|
| **Product** | Gallery style, layout, where options sit, how versions look (swatches, buttons, dropdowns), content order, related products' presentation | Which versions exist and are buyable, the selected version's price, stock and photo, add-to-cart behaviour |
| **Collection and search** | Grid density, card design, filter presentation (sidebar, drawer, chips), sort control placement | Which products match, filter logic (OR within a filter, AND across), sort and pagination as URL state |
| **Cart** | Drawer or page, layout, empty-cart design, upsell placement (from real related products) | Lines, quantities, totals, codes, limits |
| **Checkout** | Layout (one page or steps shown as tabs, accordion or pages), styling of forms and summary, reassurance content | Step order, required fields per country, validation, shipping options, payment element, placing the order, payment processing state |
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
  **replaced 2026-10-08 on #470** by the template gallery after the brand step (§4).
- ~~Can merchants upload their own fonts, or only choose from the allowlist?~~ The allowlist only (decided 2026-10-05 on #337).
- ~~Content pages the AI may add without new core support (about, lookbook, FAQ, blog)?~~ About, FAQ, contact, lookbook and a blog (SAPI 24) (decided 2026-10-05 on #337); About and Contact are site data the AI edits, the rest SAPI 24's (decided 2026-10-08 on #470).
- ~~Is there a merchant-facing "undo to any earlier version" beyond undoing the last change?~~ Yes: any earlier published version (decided 2026-10-05 on #337).
- **Sample words in a template** (raised on #470): the presets carry sample copy, including a
  testimonial quote and author (Bloom, Atelier). §3 forbids invented reviews, and placeholder
  copy never ships to live. Should Publish be refused while a preset's sample testimonial is
  unchanged, or the testimonial section start empty? Until decided, the AI never writes a quote
  attributed to a person, and the studio flags sample text before the first publish.
