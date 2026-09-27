# DESIGN.md: storefront template

What the AI may design in a store's storefront, how it starts, and the rules every design
keeps. Read with [ARCHITECTURE.md](ARCHITECTURE.md): that document says *where* the AI may
work (`src/theme/**`); this one says *what good work there looks like*.

**The aim:** every store looks like itself. Two stores on DripFunnel should not look like the
same theme with different colours. The AI has full freedom over the look; the core package
guarantees the commerce.

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

Everything visual and structural in `src/theme/**`:

- **Tokens**: colour (light and dark), typography (font families from the allowlist, scale,
  weights), spacing scale, radius, borders, elevation, motion, breakpoints if needed.
- **Layouts**: header, navigation (mega menu, drawer, minimal bar), footer, page frames, grid
  systems.
- **Pages**: the composition of every route, commerce pages included: home, collection,
  product, search, cart, checkout, order confirmation, account and sign-in pages, policies,
  404, and added content pages.
- **Sections and components**: heroes, editorial blocks, product cards, grids and carousels,
  galleries, filters' presentation, the cart drawer, form styling, empty and loading states,
  iconography, illustration and photography treatment.
- **Copy** in the theme's own messages: headings, microcopy, calls to action, per locale.

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
- **The network**: themes don't fetch, embed third-party scripts, or add dependencies
  outside the allowlist.

When a merchant asks for something in the second list ("show 'only 3 left' on everything",
"remove the tax line", "add a free-shipping countdown"), the AI explains in plain words why it
can't, and offers what it can (for example, showing real stock when the store tracks it).

---

## 4. How a design starts

1. **Inputs**: the merchant's brief (words, references they like), their logo and any brand
   colours, their catalogue (categories, number of products, photo style and quality), their
   markets and languages, and the brand's rules.
2. **Direction**: the AI proposes two or three distinct **design directions** as previews
   (for example editorial, minimal, bold, boutique, catalogue-dense), each with its own
   tokens, type pairing, header, home composition and product card. The merchant picks one,
   or mixes.
3. **Baseline**: every direction is built on the template's **baseline theme** (ARCHITECTURE
   §10), which already passes every contract test. The AI diverges from it as far as the
   brief asks; it never starts from an empty folder.
4. **Iteration**: the merchant keeps describing changes. Each one is a preview (ARCHITECTURE
   §6), and nothing reaches the live site without approval.

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
  default fonts or colours the brand requires *(ask whether brands may constrain store
  designs at all)*, and the preview domain.
- The house brand (DripFunnel) sets no visual constraints beyond the floors in §5.

## 8. Preview vs live

- Preview shows a clear "Preview, not your live store" banner and is never indexed.
- Preview and live render the same theme; differences come only from render mode (live data vs
  prerendered pages) and must not be visible to the merchant except in freshness.

## 9. Open questions

- May a white-label brand constrain store designs (fonts, colours, layouts), or only the
  "Powered by" line?
- How many design directions does the AI propose at the start, and can the merchant upload
  reference sites or screenshots?
- Can merchants upload their own fonts, or only choose from the allowlist?
- Content pages the AI may add without new core support (about, lookbook, FAQ, blog)?
- Is there a merchant-facing "undo to any earlier version" beyond undoing the last change?
