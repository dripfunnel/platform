# CATALOG-DESIGN.md

The prompt for a design session on the **Catalogue** part of the merchant portal
(`apps/ui/store`): products, versions, options, photos, pricing, stock on the product,
collections, filters, menus, import/export and the vendor side of all of it, plus
multi-language and multi-currency listing and rich listings (A+ content, size charts,
specifications, FAQs, legal information), all of which follow store settings and the billing
plan. It was ported from the first platform's
CATALOG-DESIGN-PROMPT on 2026-09-28, with its framework facts replaced by engine facts: what our own commerce engine
(`apps/api`, specified in [PLATFORM-PROMPT.md](../../api/PLATFORM-PROMPT.md)) must provide,
and the product rules that hold whatever the engine looks like. Parts, scenario ids and fact
numbers are unchanged, so older citations ("CATALOG §3 fact 16", "part L") still resolve.
Where this document disagrees with [../../ARCHITECTURE.md](../../ARCHITECTURE.md) or
[../../USERS-AND-DOMAINS.md](../../USERS-AND-DOMAINS.md), those two win.

Last updated: 2026-10-05.

It is written for stores anywhere in the world (US, Canada, UK, EU, India, the Gulf,
Asia-Pacific), with region-driven tax, units, formats and compliance (PLATFORM-PROMPT §2
item 9).

It expands [DESIGN-BRIEF.md](DESIGN-BRIEF.md) §3 D (flows 20–29) and the catalogue half of §E
(flows 33–34). Paste §1 to start. Then name a part from §6, or say "all of it, in order".

---

## 1. The prompt

> You are designing the **Catalogue** section of the **DripFunnel merchant portal**
> (`apps/ui/store`): the screens where a merchant or vendor adds and manages what they sell.
> The portal is a static SPA that talks only to the **Store API** (GraphQL, at `/api` on the
> partner's portal host). Every screen renders in the **partner's look** (white label), so
> never hard-code DripFunnel's brand, colours or name. Nothing is built in the new portal yet;
> the first platform's portal's screens (sign-in, store settings, people, suppliers, warehouses) are
> the visual baseline, and their look and words carry over unless the engine changes what they
> can say. The left bar has **Products**, **Collections** (with three tabs: Collections,
> Filters and Menus) and, when approval is on, **To approve** (in the first release a "Waiting for
> approval" chip in Products instead, ui/store/FIRST-RELEASE.md §3.1).
>
> **Who this is for.** Picture a first-time seller **anywhere in the world**: a boutique in
> Ohio, a ceramicist in Lisbon, a spice shop in Manchester, a kurta brand in Jaipur, a skincare
> start-up in Dubai. They have sold on Instagram, WhatsApp, Etsy or a market stall, or never
> online at all. They do not know what a SKU, variant, facet, slug, HS code, tax class or option
> group is, and they should never *need* to. They are often on a phone. If they would need a
> video to understand a screen, the design has failed. The standard is **Dukaan's simplicity
> with Shopify's completeness**: WooCommerce's power without WooCommerce's forms.
>
> **The store's country shapes the catalogue, and nothing is hard-coded to one country.** The
> store's home country and the countries it sells to decide:
> - the tax words (GST, VAT, sales tax) and how prices are shown (including or excluding tax);
> - the product classification code (HSN, HTS, CN, commodity code);
> - units (kg/cm or lb/in) and size systems (US, UK, EU, JP…);
> - number, date and currency formats;
> - which legal information each product needs.
>
> Every example in your designs should work for a US, a European and an Indian store. When a
> screen differs by region, show at least a US, an EU and an Indian version side by side. See
> §3 facts 36–48 and part T.
>
> **Read first.** `docs/ui/store/DESIGN-BRIEF.md` (the portal-wide facts), `docs/api/ACCESS.md`
> (roles, vendors, and why vendor separation is enforced by the engine on every row), and
> `docs/api/PLATFORM-PROMPT.md` §3.2, §3.3 and §5.4 (what the engine's catalogue, inventory,
> money and tax modules provide). Everything below is also specification.
>
> **Languages and currencies follow Settings.** Settings › Store info lets the Owner offer
> more than one language and more than one currency. **When a store has one of each, none of
> the screens below mention translations or other currencies at all.** When more are switched
> on, the catalogue grows the extra controls described in §3 facts 18–26 and parts N and O.
> Design both: the single-language, single-currency store is the common case, and it must stay
> as simple as if multi-language and multi-currency did not exist.
>
> **Rich listings follow settings and the billing plan.** Beyond the basics, a listing can
> carry an **A+ / enhanced description** (a module-based story below the product), a **size
> chart**, a **specifications table**, **highlights**, **FAQs**, **legal information**, badges,
> related products and video. Each is controlled by two things:
> - **store configuration**: whether the Owner has turned the feature on for this store;
> - **billing plan**: whether their plan includes it, and how much of it. Plans are set by the
>   store's partner, so plan names differ between partners.
>
> Every such feature therefore has four designed states: *included and on*, *included but
> turned off*, *not in your plan*, and *at your plan's limit*. See §3 facts 27–35 and parts
> P–S. Legal information required in the store's markets is never paywalled (§3 fact 34).
>
> **The backend is our own commerce engine**, reached through the Store API. The UI may use
> any words it likes, but it must not promise anything the engine does not store or enforce.
> §3 lists the engine facts that shape each screen: what the engine provides, and what it must
> provide. Nothing is built yet, and which release each item ships in is undecided; where an
> item's release is open, design it and **label it `(release: decide)`** so it is a decision,
> not a surprise.
>
> **How to work.** One part at a time (§6). For each screen, produce:
> 1. The happy path, then **every** state listed in §7: empty, loading, error, permission
>    denied, read-only (subscription past due), Store API unreachable, slow network, and the
>    phone layout.
> 2. The **actual words**: labels, helper text, button copy, error messages, empty-state copy.
>    Words are most of this job. Write them, don't lorem-ipsum them.
> 3. A short table mapping each control to the engine module and field or operation behind it
>    (PLATFORM-PROMPT §5.4; exact table and field names are fixed in the engine's data model,
>    not yet written), or `(release: decide)`, so an engineer can build it without guessing.
> 4. The scenarios from §6 that the screen covers, ticked off, so gaps are visible.
>
> Ask me when the spec is silent (§9 lists what is known to be open). When it decides
> something, follow it. Start by restating, in your own words, who the users are and what a
> "product" means to them. Then wait for me to pick a part.

---

## 2. Plain-language vocabulary

The UI speaks the left column. Engine terms appear only in the engineer mapping, never on
screen. Use these words consistently on every screen, in help text and in errors. The middle
column names the engine module and concept (PLATFORM-PROMPT §5.4); table and field names are
indicative until the engine's data model is written.

| Say this on screen | Engine concept (module) | Explain it as |
|---|---|---|
| **Product** | Catalogue: product | "Something you sell, like a Cotton T-shirt." |
| **Options** (e.g. Size, Colour) | Catalogue: option (per product) | "Ways the product comes in different choices." |
| **Choices** (e.g. S, M, L / Red, Blue) | Catalogue: option choice | "The choices a shopper picks from." |
| **Versions** (or "each combination") | Catalogue: version | "Each combination a shopper can buy, like Red / M. Each can have its own price, stock and photo." |
| **Photos** | Assets (R2) linked to product and version, ordered; the first is the main photo | Main photo = the first photo. |
| **Price** | Money: per-version price, integer minor units with a currency code | In the store's main currency. It includes tax when the store's prices include tax (the norm in the EU, UK, India and Australia) and excludes it when they don't (the norm in the US and Canada). §3 fact 6. |
| **Tax class**, named with the store's tax label ("GST rate", "VAT rate", "Sales tax category") | Tax: tax class on the version; rate = class × shopper's zone, per store | "Which kind of tax this product gets, e.g. Standard, Reduced, Zero-rated, Exempt." Chosen from a short list and never typed as a percentage. §3 fact 37. |
| **Product classification code**, named by region: HSN (India), HTS (US), CN / TARIC (EU), commodity code (UK), HS code (elsewhere) | Catalogue: nullable, neutral `hsCode` on the version (§3 fact 7) | "The international code for this kind of product, used for tax invoices, shipping and customs." Offer search by plain words. |
| **Barcode** (GTIN / UPC / EAN / ISBN) | Catalogue: barcode on the version `(release: decide)` (§3 fact 44) | "The number under the barcode on the packaging. Needed to sell on Google Shopping and marketplaces." |
| **Weight / size of the package** | Catalogue: weight and dimensions `(release: decide)` (§3 fact 12) | Shown in the store's units (kg · cm, or lb · in). §3 fact 39. |
| **Product code (SKU)** | Catalogue: version SKU, unique per owner, the merchant's and each supplier's (decided on #293: a store-wide rule would tell a supplier which codes others use) | "Your own code to tell versions apart. We can make one for you." Auto-generate by default. |
| **In stock / quantity** | Inventory: on hand per (version, warehouse) | One number for most sellers (§3 fact 9). |
| **Reserved for orders** | Inventory: reserved per (version, warehouse) | "Sold but not shipped yet." |
| **Warehouse** | Inventory: warehouse (per merchant and per vendor) | Already named this in Settings › Warehouse. |
| **Visible on your store / Hidden** | Catalogue: visibility on product and on version | Never say "enabled" or "draft" without an explanation. |
| **Collection** | Catalogue: collection | "A group of products shown together on your store, like 'Summer Sale' or 'Men's Shirts'." |
| **Automatic collection** | Catalogue: rule-based collection, recomputed in the background | "Fills itself with every product that matches your rules." |
| **Hand-picked collection** | Catalogue: hand-picked collection (product and version members) | "You choose exactly which products." |
| **Filters** (shopper-facing) | Catalogue: filter (public) and filter choice | "Things shoppers filter by, like Brand, Fabric or Occasion." |
| **Internal tags** | Catalogue: internal tag (private filter) | "Labels only you see, like 'Holiday stock' or 'Reorder soon'." |
| **Menu** | Catalogue: menu (Shop API "content: menus", PLATFORM-PROMPT §5.5) | "What shoppers see in your store's navigation." |
| **Web address** | Catalogue: per-language web address, unique per store and language | Auto-generated from the name. Show the full URL, not the slug. |
| **Search engine listing** | Catalogue: SEO title, description and tags, per language (§3 fact 21) | Show a Google-style preview, auto-filled from the product, and editable. |
| **Supplier / vendor** | `seller_id` on the product (null = the merchant's own) | The UI word is "Supplier", as in Settings. Be consistent. |
| **Waiting for approval / Approved / Sent back** | Catalogue: approval status on the product | "Sent back" rather than "Rejected" to the vendor, always with the reason. |
| **Main language** | Store: main language | "The language you write your products in. Shoppers see it when a translation is missing." |
| **Other languages / Translations** | Store: offered languages; Catalogue: translations per language | "The same product, in French, Spanish, Arabic or Hindi, for shoppers who choose it." |
| **Not translated yet** | no translation row for that language | "Shoppers see your [main language] text instead." Never "missing" or "error". |
| **Pricing currency** | Store: pricing currency | "The currency you set your prices in." It is locked after the first order. |
| **Other currencies** | Store: offered currencies; Money: per-currency prices on the version | "Prices for shoppers abroad." |
| **Set automatically / Set by you** | Store: per-currency pricing mode, `convert` / `manual` | "We work it out from your [main currency] price" vs "You type the price yourself." |
| **A+ content** (subtitle "Product story") | Catalogue listing section `(release: decide)` (§3 fact 28) | "Big photos, comparisons and feature blocks below your product, like on Amazon." Sellers from Amazon know "A+", so keep the term with the plain subtitle. |
| **Size chart** | Catalogue: size chart, reusable `(release: decide)` (§3 fact 29) | "Helps shoppers pick the right size, so fewer orders come back." |
| **Specifications** | Catalogue listing section `(release: decide)` (§3 fact 30) | "Facts about the product, like Material: Cotton or Battery: 5000 mAh." |
| **Highlights** | Catalogue listing section `(release: decide)` | "3–5 short points shoppers read first." |
| **Legal information** / **Product safety & compliance** | Catalogue: compliance fields by market `(release: decide)` (§3 facts 34, 45–47) | "Details the law in the countries you sell to requires on your product page, like where it's made, who makes it, safety warnings and ingredients." |
| **Where you sell** | Catalogue: per-product selling restrictions `(release: decide)` (§3 fact 42) | "Countries this product can be shipped to." |
| **Your plan / Upgrade** | Platform: the store's plan and entitlements, server-enforced ([SAAS.md](../../api/SAAS.md)) | Always name the plan that unlocks a feature. Never say just "Premium feature". |

---

## 3. Engine facts that shape the interface

Each of these changes what a screen can show or promise. Each is either a **product rule**
(true whatever the engine looks like) or an **engine requirement** (what the engine's
catalogue, inventory, money and tax modules must provide, PLATFORM-PROMPT §3.2, §3.3, §5.4).
Nothing is built yet: once the engine's data model and API documents exist, check each fact
against them before relying on it, and fix this document where they differ.

1. **Every product has at least one version, and the UI never shows that.** A "simple"
   product with no options is one form with one price and one stock number. It must not be a
   list containing a single row. The engine must let a simple product be created, read and
   edited without the client handling a visible version (PLATFORM-PROMPT §5.4, and §3.1: "a
   simple product is a product with one variant" leaking into the UI is gone).
2. **Price, stock, SKU, classification code, tax class and weight belong to the version, not
   the product.** For a simple product, show them on the product form. Once options exist,
   they move to each version, with "apply to all" helpers.
3. **Options belong to the product.** Adding an option (e.g. "Fabric") to a product that
   already has versions means every existing version must be given a choice for it. Design that
   moment explicitly: "Your 6 existing versions need a Fabric. Which one are they?" Removing a
   choice removes its versions. Warn, and explain that past orders keep their record (orders
   hold immutable snapshots of their lines, PLATFORM-PROMPT §5.4).
4. **Every combination becomes a version unless the seller removes it.** Size × Colour × Fabric
   grows fast (4 × 5 × 3 = 60). Show the count before generating, let the seller untick
   combinations they don't make, and set a sensible limit with a clear message. The engine
   enforces the limit too.
5. **Prices are stored in integer minor units with a currency code on every amount**
   (PLATFORM-PROMPT §5.4 Money). The UI shows and accepts major units, formatted for the
   store's locale:
   - $1,299.00 (US)
   - 1.299,00 € (Germany) or €1,299.00 (Ireland)
   - £1,299.00 (UK)
   - ₹1,299.00, grouped ₹1,00,000 (India)
   - ¥1,299, with no decimals (Japan)

   Use `Intl.NumberFormat`, never hand-built strings. Respect zero-decimal and three-decimal
   currencies (JPY, KWD); the engine keeps rounding rules in one place. Price is per store and
   per currency. Everything else about a product is one shared record, seen the same by the
   merchant and the supplier who owns it.
6. **Whether prices include tax is a store setting** (Tax module: inclusive or exclusive
   pricing, PLATFORM-PROMPT §5.4).
   - **Tax-inclusive stores** (EU, UK, India, Australia): label the field "Price (incl. VAT)" or
     "(incl. GST)", using the tax label from Settings › Tax setup. Show a live line: "Shopper
     pays €49.00 · VAT €8.18 · You receive €40.82".
   - **Tax-exclusive stores** (US, Canada): label it "Price (before tax)". Show "Sales tax is
     added at checkout, based on where the shopper is", with no single percentage, because the
     rate depends on the shopper's state and city (§3 fact 37).
   - The breakdown always uses the store's home zone and says so ("for shoppers in Germany").
     The engine computes it; the portal never does tax arithmetic of its own.
7. **The product classification code is optional by default, and required only where the
   store's markets need it.** The engine stores a nullable, neutral `hsCode` on the version
   (PLATFORM-PROMPT §3.3), labelled per region on screen (§2). Indian GST invoices and
   cross-border customs need one; a US store selling domestically does not.
   - Don't block saving a first product on it. Block visibility only in the markets that
     require it, and explain why.
   - Offer search by plain words ("cotton shirt" → 6205.20). The first 6 digits are
     international, and countries add their own digits after them. The code lookup is an engine
     or platform service `(release: decide)`.
8. **Visibility is on the product *and* on each version.** A visible product with every version
   hidden shows nothing. The UI must never let that happen silently, and the engine reports it
   (a product that is visible but not buyable) so lists can show it.
9. **Stock is per (version, warehouse)** (DESIGN-BRIEF fact 10, PLATFORM-PROMPT §5.4
   Inventory). Most sellers have one warehouse, so the default is one number. More warehouses
   appear as an expansion. The merchant and each vendor have their own default warehouse; a
   product saved without choosing a warehouse goes to its owner's default. Say which one.
10. **Stock tracking and "keep selling when out of stock"** are per version, inheriting a store
    default. Most sellers never touch them. Keep them under "More options". The engine must
    store both per version, with the store default.
11. **Collections can fill themselves.** The engine provides rule-based and hand-picked
    collections, with background recomputation (PLATFORM-PROMPT §5.4). Rules cover filter
    choices (any / all), product name contains, and specific products and versions.
    Collections nest. If a child collection can be limited to its parent's products (the
    the first platform's behaviour, "inherit parent's filters"; `(release: decide)` whether the engine keeps
    it), explain it as "Only show products that are also in [Parent]". Because contents are
    recomputed in the background, after saving show "Updating… 42 products so far", not a stale
    count.
12. **The familiar extras are engine requirements whose release is undecided.** The engine
    must provide a **manual product order inside a collection** (PLATFORM-PROMPT §5.4). It is
    also expected to provide (PLATFORM-PROMPT §3.3), each `(release: decide)`:
    - a compare-at price ("was", RRP, MSRP, MRP) with price history;
    - cost price;
    - weight and dimensions;
    - barcodes;
    - scheduled publishing;
    - a product type (physical / digital / service).

    Design the familiar versions of each. Call out the ones with legal or operational weight:
    - Weight and dimensions are essential everywhere shipping is calculated.
    - A compare-at price is regulated in the EU (§3 fact 41) and legally required as MRP in
      India.
13. **Filters can be assigned to the product or to a single version.** "Fabric: Cotton" is
    about the product. "Colour: Red" may be about the version. Default to product-level, and
    offer version-level only where it matters. The engine stores both and makes both
    filterable and indexable (the lesson in PLATFORM-PROMPT §5.10: design filtering in from the
    start).
14. **Deleting is soft, and search is asynchronous.** A deleted product disappears but orders
    keep it. A new or edited product reaches storefront search after the engine's search
    indexing runs from the outbox (PLATFORM-PROMPT §5.10), which can take a moment. Say so,
    rather than letting it look broken.
15. **Web addresses must be unique within the store** (and within each language, §3 fact 22;
    PLATFORM-PROMPT §5.1). On a clash, auto-suffix (`cotton-t-shirt-2`) and tell the seller.
    Changing the address of a live product breaks old links. Warn about that. *(Ask whether the
    engine keeps a redirect from the old address.)*
16. **Vendor separation is enforced by the engine on every row** ([ACCESS.md](../../api/ACCESS.md),
    PLATFORM-PROMPT §5.1). Every vendor list, count, search result, export, empty state and
    dropdown is scoped to that vendor's `seller_id` by the scoped query layer and
    `SellerScope`, including derived reads (stock totals, filter counts, collection contents).
    A vendor never sets `seller_id`, visibility or approval status: those controls don't exist
    on their screens, and the fields are absent from vendor input types, so the Store API
    rejects them (PLATFORM-PROMPT §2 items 18–19). The UI still hides them; the server is the
    gate.
17. **The live storefront updates on publish; the preview updates at once.** Each store has
    two links (PLATFORM-PROMPT §2 item 13, [storefront ARCHITECTURE.md](../../storefront/ARCHITECTURE.md)
    §4): a **preview** with live data, which shows catalogue changes immediately, and a
    **live** static site, which picks them up on the next publish ("Publish now", limited to a
    monthly number of builds per plan, plus automatic periodic publishing of every store with
    changes). New products appear on the live site before a publish through a client-rendered
    fallback, and removed products are handled by edge rules. So never promise "live within a
    minute": say "Visible in your preview now · on your live store after the next publish", and
    show when that is. *(Confirm the exact copy and whether price and stock read live on the
    live site.)*

### Languages

The first platform's portal specified Settings › Store info › Languages, including a per-language
translation progress count; those screens are the baseline. The engine must store the store's
main language and offered languages, and translations per language with fallback
(PLATFORM-PROMPT §5.4).

18. **Translatable text is per language; everything else is shared.** These have a translation
    per language:
    - product name, web address and description
    - option names and choice names ("Size" / "Taille" / "Größe", "Red" / "Rouge" / "Rot")
    - version names
    - collection name, web address and description
    - filter names and choice names

    Price, stock, SKU, photos, classification code and tax class are the same in every
    language. The UI must make clear which fields change with the language and which do not.
    Keep the shared fields visible but locked while translating, marked "same in every
    language".
19. **A missing translation falls back to the main language.** The engine serves the shopper
    the main-language text, so nothing breaks. That is also why a translation can be missing
    without anyone noticing. Progress must be visible:
    - per product: "French: done · German: not translated"
    - in lists: a "Not translated into German" filter
    - in Settings: "96 products untranslated"

    The engine must be able to count and filter untranslated items per language.
20. **The main language must be complete.** A product cannot be saved without main-language
    text. Other languages are optional. The engine enforces this.
21. **The search-engine listing is per language.** Per-language SEO title, description and tags
    are an engine requirement (PLATFORM-PROMPT §3.3) `(release: decide)`. Design the
    per-language search listing; until it ships, the listing is main-language only and the UI
    says so.
22. **Web addresses are per language** and must be unique within each language in the store.
    Auto-generate them from the translated name.
    - Accented Latin characters are simplified ("crème brûlée" → `creme-brulee`).
    - For non-Latin scripts (Arabic, Cyrillic, Devanagari, CJK), offer transliteration
      ("кроссовки" → `krossovki`) rather than an unreadable encoded URL *(ask which the
      storefront wants)*. **Until that's decided** (#296): a name with no Latin letters keeps
      the main language's address, and the merchant may type one.
23. **Photo alt text per language** is an engine requirement `(release: decide)`: alt text
    belongs to the photo's use on a product, with a translation per language. Until it ships,
    alt text is one text in the main language, and the UI does not offer to translate it.
24. **Machine translation is a platform feature, not part of the catalogue's data.** Design it
    as "Suggest a translation", which the seller reviews before it counts as translated.
    `(release: decide)`, and ask whether it is metered against the plan.

### Currencies

The first platform's portal specified Settings › Store info › Currencies: multi-currency on or off,
per-currency pricing (`convert` | `manual`), rounding (`none` | `nearest` | `ends-99`), rate
source, and the rule that the pricing currency cannot change after the first order. The engine
must store all of it per store, and enforce the pricing-currency lock.

25. **The engine stores one price per currency per version**, each an integer amount in minor
    units with its currency code (PLATFORM-PROMPT §3.2 "per-currency prices", §5.4 Money). The
    pricing currency's price is required. Other currencies' prices exist only if the seller
    types them or the conversion job writes them.
26. **Automatic conversion is an engine requirement** `(release: decide)`: fetching exchange
    rates, writing or computing converted prices, and applying rounding. Design the automatic
    experience:
    - the shown converted price
    - rounding ("ends in .99")
    - "rates updated 2 hours ago"
    - what happens when rates move

    Ask whether converted prices are written ahead of time (visible and overridable per
    version) or computed at checkout (visible only as an estimate). "Set by you" (`manual`)
    needs only the per-currency prices of fact 25: the seller types a price per currency per
    version.

    Other currency rules:
    - A version with no price in a manual currency is **not buyable in that currency**; the
      engine refuses it at checkout. Show this loudly, and never let it pass silently.
    - The tax breakdown (§3 fact 6) applies to the pricing currency. For other currencies, ask
      how tax is shown before designing a breakdown. A currency often implies a different tax
      market: USD for US shoppers means sales tax on top, where the EUR price included VAT.

### Rich listings, store configuration and plans

27. **Plans and entitlements are a first-class, server-enforced model in the platform**
    (PLATFORM-PROMPT §3.3; [SAAS.md](../../api/SAAS.md)). Each partner sets its own plans and
    prices (USERS-AND-DOMAINS §1), so plan names are not ours to hard-code.

    Design against an **entitlement per feature**, of three kinds:
    - on or off (e.g. A+ content);
    - a limit (e.g. products, photos per product, languages);
    - a meter (e.g. AI suggestions per month).

    Use placeholder plan names, and **ask which feature sits in which plan**. Do not invent
    prices or tiers. The Store API checks the entitlement on every write that uses a gated
    feature. Hiding a button is not a gate.
28. **A+ content is a structured document per product**: ordered modules, each with its own
    fields and photos. The engine stores it as a catalogue listing section behind an
    entitlement (PLATFORM-PROMPT §5.4) `(release: decide)`; whether it is a platform custom
    field on the product or its own table (needed if modules are reused across products, Q5) is
    decided in the engine's data model.
    - Its photos are ordinary assets on R2.
    - Per-language text follows the translation model (§3 facts 18, 21).
    - The **storefront must render it**: that is `@dripfunnel/storefront-core` work (the locked
      core, not the AI-editable theme), so the portal must not offer a module the store's core
      version cannot show.
29. **A size chart is reusable, not per product.** Sellers make one "Men's shirts" chart and use
    it on 200 products. The engine needs a size-chart entity (chart = rows × measurements + unit
    + "how to measure"), assigned to products either directly or by rule (a collection or
    filter value) `(release: decide)`.
    - "Products without a size chart" must be listable, so the product's link to its chart must
      be filterable and indexed (the custom-fields lesson in PLATFORM-PROMPT §5.10).
30. **Specifications overlap with filters.** Some specs are filterable (Fabric, RAM). Those are
    filters (§3 fact 13). Others are display-only (Care: Hand wash, Battery life: 10 h). Design
    one "Specifications" section where each row can be marked "shoppers can filter by this",
    which turns it into a filter choice. Display-only rows are an engine requirement
    `(release: decide)`.
31. **Category decides what's relevant.** A size chart means nothing for a phone, and a battery
    spec means nothing for a T-shirt. Relevance comes from the store's configuration (which
    features are on) and the store-type preset chosen at sign-up, editable in Settings ›
    Catalogue (P2) (decided 2026-10-05 on #337). The product type (§3 fact 12) is related but separate. Don't show
    every section on every product.
32. **Downgrading must not destroy content.** When a plan loses a feature or limit, existing
    content is **kept**. Decided 2026-10-02 on #186's review (SAAS §6.2, the prototype's *Choose what to
    keep*): what is over the new limit is **paused**, hidden from shoppers and kept intact,
    and the Owner chooses which items stay within the limit before the change takes effect;
    an upgrade brings the rest back. Adding more is blocked with a clear explanation. The
    engine enforces the same rule (DATA-MODEL §2.2 `product.hidden_by = 'plan'`).
33. **Past due is read-only** (DESIGN-BRIEF fact 9, PLATFORM-PROMPT §2 item 7): writes are
    blocked, the merchant is never locked out. Plan gating is different: a merchant in good
    standing on a smaller plan can edit everything they have. Don't confuse the two banners.
34. **Required product information depends on where the store sells, and on the product's
    category.** The regional and category detail is in §3 facts 45–47. The engine stores
    compliance fields by market (PLATFORM-PROMPT §3.3) `(release: decide)`.
    - It is **store configuration, never plan-gated**: defaults are set once in Settings
      (manufacturer, importer, responsible person, customer care), overridable per product.
    - The sections shown on a product come from the union of the store's selling markets and
      the product's category. An Indian food product and an EU toy need different fields; a
      US T-shirt and an EU T-shirt need overlapping ones.
    - Design this as a **compliance checklist per product** ("Ready to sell in: US ✓ · EU: 2
      details missing"). Do not show a wall of every field for every country.
    - Confirm each region's exact list with whoever owns compliance before finalising the copy.
      The lists below are a design starting point, **not legal advice**.
35. **Vendor content follows the same approval path.** A+ content, size charts and specs a
    vendor adds are part of the product. When approval is on, they wait for approval like
    everything else (L2). Vendors may use A+ when the plan includes it **and** the merchant
    allows it (decided 2026-10-05 on #337).

### Regions, tax and compliance

These are a design starting point for a worldwide catalogue. The legal items are **not legal
advice**: each must be confirmed by whoever owns compliance before the copy is final.

36. **Store settings must be global, and the catalogue reads them.** The first platform's Settings ›
    Store info was shaped for India (PIN code, state code, GSTIN and PAN fields; delivery
    serviceability as a list of 6-digit PIN codes; one Indian courier; a mandatory HSN code).
    None of that carries over as a default. The engine's store must hold (PLATFORM-PROMPT §3.3):
    - a home country, and the **countries it sells to**;
    - a postal code and region in any format;
    - tax registrations per country (VAT number, EU OSS, US sales-tax permits, EIN, ABN,
      GSTIN…);
    - a unit system;
    - a real time zone.

    Every catalogue screen reads those settings. No screen may assume India, the US or anywhere
    else.
37. **Tax is a class on the product; the rate depends on where the shopper is.** A version
    carries a tax class, and the engine looks up the rate as class × zone, from rates held per
    store (PLATFORM-PROMPT §5.4 Tax). So the product form picks a **class** in plain words
    (Standard, Reduced, Zero, Exempt, or the region's own names) and never a single percentage,
    because:
    - **EU**: rates differ per country (e.g. Germany 19% / 7%, France 20% / 10% / 5.5%). A
      seller selling across borders above the EU threshold charges the shopper's country rate
      (the One-Stop Shop scheme).
    - **US**: sales tax differs by state, county and city. Product taxability differs too
      (clothing is exempt in some states, groceries in many). It is normally calculated by a
      tax service (Stripe Tax, Avalara, TaxJar) using **product tax codes**. The engine uses
      **Stripe Tax** (decided 2026-10-04 on #184, PLATFORM-PROMPT §5.4; on the merchant's own Stripe
      account through Connect, decided 2026-10-05), so the product form
      picks a tax code from a searchable plain-language list ("Clothing", "Prepared food",
      "Digital book").
    - **Canada**: GST, HST or PST by province. **Australia**: GST 10%. **UK**: VAT 20% / 5% /
      0% (e.g. children's clothes are zero-rated). **UAE / Saudi Arabia**: VAT. **India**: GST
      slabs.

    Where one class maps to several rates, show "Rate depends on the shopper's location" with a
    "See rates" link, not a number. Rates are the store's own, read through the Store API like
    any other store data.
38. **Some products are tax-exempt or specially taxed** by region and category: books, food,
    children's clothing, medical items, digital goods (taxed where the shopper lives in the EU
    and UK). The engine's tax class list must include them (PLATFORM-PROMPT §5.4 exemptions),
    and a product can differ from the store default.
39. **Units follow the store** (the store's unit system, §3 fact 36). Metric stores use g/kg,
    cm/m and ml/l. US stores use oz/lb, in/ft and fl oz. UK sellers mix both.
    - The engine stores one canonical unit; the seller may type either ("2 lb" is accepted in a
      metric store and shown as 907 g).
    - Size-chart measurements (part R) follow the same rule.
40. **Formats follow locale, not country assumptions.**
    - Dates (09/10 is 10 September in the US and 9 October in Europe, so prefer "9 Oct 2026"),
      decimal separators, thousands grouping, currency symbol position and first day of the
      week all come from `Intl`.
    - The portal UI uses the *signed-in person's* locale. Storefront previews use the *store's*
      locale.
    - **Accessibility law applies to storefronts in many markets** (the European Accessibility
      Act from June 2025, and the ADA in the US). Alt text (F5) and readable A+ content (Q7)
      matter legally, not just for SEO.
41. **"Was" prices are regulated.**
    - **EU (Omnibus Directive)**: a price reduction must show the **lowest price of the previous
      30 days** as the reference. That needs a price history, which the engine keeps
      (PLATFORM-PROMPT §3.3) `(release: decide)`. The UI shows the computed reference, and does
      not let the seller type any "was" price.
    - **UK**: similar guidance.
    - **US**: FTC rules against fictitious former prices.
    - **India**: the selling price may not exceed MRP.

    Label the field by region: "Compare-at price", "RRP", "MSRP" or "MRP". The engine validates
    it by market; the UI explains a refusal in plain words.
42. **"Where you sell" is per product in real life.** Shipping zones decide at checkout, but
    some products cannot go to some countries: lithium batteries by air, alcohol, aerosols,
    knives, CBD, food with import rules. Design a per-product "Can't ship to" or "Only sell in"
    list, inheriting from the store's markets. The engine stores it and checkout honours it
    `(release: decide)`; show the effect on the storefront ("Not available in your country").
43. **Age-restricted products** (alcohol, tobacco and vapes, knives in the UK, some games or
    videos) need a flag that makes the storefront ask for age confirmation or verification at
    checkout `(release: decide)`. Which categories require it varies by country.
44. **Barcodes (GTIN / UPC / EAN / ISBN) are per version.** Google Shopping and marketplaces
    require them for most branded goods. Validate the check digit (in the UI and in the
    engine). Let handmade or own-brand products say "This product has no barcode".
    `(release: decide)` (PLATFORM-PROMPT §3.3).
45. **Region-specific product information (starting point, confirm with compliance).**
    - **EU**:
      - General Product Safety Regulation (from December 2024): manufacturer name and postal
        and electronic address; an **EU responsible person** when the manufacturer is outside
        the EU; a product identifier (type, batch or serial); warnings and safety information;
        a product photo.
      - CE marking for regulated categories (toys, electronics, PPE).
      - An energy label for appliances.
      - Textile fibre composition, as percentages.
      - Food: ingredients with **allergens highlighted**, nutrition, net quantity, best-before,
        storage.
      - Cosmetics: full ingredient list.
      - **Unit price** (price per kg / l / m) for goods sold by quantity.
      - Battery and WEEE (electronic waste) information.
    - **UK**: much the same, with UKCA or CE marking, a UK responsible person for some
      categories, and unit pricing under the Price Marking Order.
    - **US**:
      - Textiles: fibre content, country of origin and care instructions (FTC). A "Made in
        USA" claim has a strict standard.
      - California **Proposition 65** warnings where they apply.
      - Food: nutrition facts and the major allergens (FDA).
      - Children's products: tracking information and certification (CPSIA).
      - Electronics: an FCC statement.
    - **India**: country of origin; and for packaged goods, MRP, net quantity, manufacturer /
      packer / importer name and address, month and year of manufacture, and customer care
      (Consumer Protection (E-Commerce) Rules, Legal Metrology).
    - **Canada**: bilingual (English/French) information for many consumer goods.
      **Australia**: country-of-origin labels for food. **Gulf states**: Arabic labelling for
      many categories. India and the US are in scope at launch (decided 2026-10-04 on #184).
46. **Category drives the rest.** The product's category (§3 fact 31) switches on the relevant
    sections:
    - **apparel**: fibre, care, size chart;
    - **food and drink**: ingredients, allergens, nutrition, best-before, storage;
    - **cosmetics**: ingredients, period-after-opening;
    - **electronics and batteries**: warranty, battery type, energy label, compliance marks;
    - **toys and children's products**: age range, safety warnings, marks;
    - **jewellery**: metal and purity, hallmark;
    - **supplements**: dosage and warnings.

    Categories the platform does not support are refused clearly, by the engine as well as
    the UI: **weapons, prescription medicine, illegal drugs, tobacco and vapes, adult content
    and counterfeits**; alcohol is allowed with an age check (decided 2026-10-05 on #337).
47. **Compliance text must be in the shopper's language in many markets.** EU safety
    information must be in the language of the country sold into. A store selling into France
    needs French warnings even if it doesn't offer a French storefront. This ties part T to part
    N. Show "Selling to France needs these details in French", and let those fields be
    translated even when the rest of the product is not. The engine must allow translations of
    compliance fields in languages the store does not offer on its storefront.
48. **Not every product is physical.** Digital downloads, gift cards, services, bookings and
    subscriptions have no weight, often no stock (or a licence-key pool), no shipping, and
    different tax rules (EU and UK digital VAT is charged where the shopper lives). The engine's
    product type (PLATFORM-PROMPT §3.3) covers physical, digital, services and gift cards, all in
    the first release (FIRST-RELEASE §1). Design the "What are you selling?" choice
    (Physical · Digital · Service · Gift card).

---

## 4. Who uses it, and what they see

Roles are fixed templates with permission sets in code; there is no role editor
([ACCESS.md](../../api/ACCESS.md), PLATFORM-PROMPT §2 item 2). The merchant picks one vendor tier
per supplier.

| Role (key) | Products | Collections, Filters, Menus | Import / Export |
|---|---|---|---|
| **Owner** (`owner`) | Everything, with supplier attribution. Create, edit, hide, delete. | Full | Full |
| **Manager** (`manager`) | Same as Owner | Full | Full |
| **Staff** (`staff`) | **Read-only**: a view page rather than a form with greyed-out fields, and no "Add product" button | Read-only | Export (decided on #184) |
| **Stock only** (`vendor-stock`) | Only their own. **Only the quantity is editable**, and the screen says why ("Your store owner manages everything else"). | Not shown | Export their own only (decided on #184) |
| **Products and stock** (`vendor-catalogue`), **Products, stock and their orders** (`vendor-orders-fulfil`), and the defined-but-not-offered read-only orders tier (`vendor-orders-read`) | Only their own. Create and edit, with no visibility control when approval is on. | Not shown: no collections; they set filter values on their own products (decided 2026-10-05 on #337) | Their own products only (decided on #184) |

The navigation differs per role (the first platform's `nav.ts` model carries over, PLATFORM-PROMPT §7).
Vendors see "Your products".

---

## 5. Design principles

1. **Start simple, reveal more.** A new product form asks only for name, photos, price and
    quantity. Everything else sits in clearly labelled sections that are collapsed and optional.
    The first product should take under a minute.
2. **One page per product.** No wizard to edit and no tabs hiding required fields. Use a sticky
    save bar that shows "Unsaved changes".
3. **Never lose work.** Autosave a local draft, warn when leaving with unsaved changes, and
    restore the draft after a crash or lost connection.
4. **Sensible defaults for everything.** Auto SKU, auto web address, auto search listing,
    default warehouse, the store's usual tax class, tracked stock, and the store's units and
    locale.
5. **Explain with examples, not definitions.** Each unfamiliar field shows an inline example
    ("e.g. Size: S, M, L") and a small "What's this?" that opens one sentence, not a help centre.
6. **Show the shopper's view.** A live preview of how the product card and product page will
    look, including version pickers, is the fastest way to explain options.
7. **Errors say what to do.** Write "Add a price so shoppers can buy this", not "price is
    required". Put the message next to the field and scroll to the first one.
8. **Bulk work is normal.** Sellers have 5 products or 5,000. Lists need search, filters, select
    all, bulk actions and a spreadsheet-style quick edit for price and stock.
9. **Destructive actions are rare and reversible where possible.** Prefer "Hide" to "Delete".
    Deletion confirms with the product name and offers undo for a few seconds where the engine
    allows.
10. **Phone first, desktop comfortable.** Take photos with the camera, use big tap targets and
    number keypads for price and stock, and never rely on horizontal scrolling.
11. **Local by default, global by design.** Every term, example, unit, format and suggestion
    comes from the store's country and language. The same screen might show:
    - **US**: "Sales tax category", "MSRP", "lb", sizes US 8 / M / 32×30;
    - **Germany**: "MwSt.-Satz", "UVP", "kg", sizes EU 38;
    - **India**: "GST rate", "MRP", sizes S–XXL / 28–44.

    Nothing is hard-coded to one market, and every design shows at least a US, an EU and one
    other variant wherever the screen differs.

---

## 6. Parts and scenarios

Numbered so coverage can be ticked off. This is the complete list. Nothing is out of scope,
though items marked *(ask)* need a decision first (§9), and items marked `(release: decide)`
depend on an engine capability whose release is not yet chosen.

### A. First-time experience

- A1. The catalogue is empty on a brand-new store. Show a friendly empty state with one primary
  action ("Add your first product") and two secondary ones ("Import from a file",
  "Bring products from Shopify").
- A2. A guided first product: a short inline walkthrough that can be dismissed, not a modal tour.
- A3. A setup checklist on Home ("Add 3 products · Create a collection · Set up shipping")
  linking into these screens.
- A4. An optional sample product to explore, clearly marked, and removable in one click.
- A5. The first-save moment: "Your product is in your preview. View it", and when it reaches the
  live store (§3 fact 17); or explain why it isn't live yet (hidden, awaiting approval, missing
  details a selling market requires, not yet published).

### B. Product list

- B1. The list shows photo, name, status (Visible / Hidden / Waiting for approval / Sent back),
  price or price range, stock ("12 in stock", "Out of stock", "Low: 3", "Not tracked"), number
  of versions ("4 versions") and supplier (merchant view only).
- B2. Search by name, SKU or code, with instant results.
- B3. Filter by status, stock level, collection, supplier (merchant only), filter value and
  missing information ("No photo", "No price", "No barcode", "No classification code", "Not ready
  to sell in EU").
- B4. Sort by newest, name, price, stock and recently updated.
- B5. Bulk actions: show, hide, add to or remove from a collection, add a filter value or tag,
  change the tax class, change where it can be sold, delete, export selected.
- B6. Quick edit: change price and stock inline, including per version, without opening the
  product.
- B7. Large catalogues: paging or infinite scroll with a total count, and "select all 2,340
  matching" as distinct from selecting the visible rows.
- B8. Other empty states: no search results (offer to clear filters), and a supplier with no
  products yet.
- B9. Supplier attribution for the merchant, with a note that editing a supplier's product
  changes it for the supplier too.
- B10. The same list for a vendor: only their products, and **counts, filters and empty states
  computed on their products alone** (§3 fact 16).
- B11. Staff: read-only list with no bulk actions.
- B12. Phone layout: a card list with a floating "Add product" button.

### C. Add a simple product (no options)

- C1. Required: name, and price (and a photo is strongly encouraged). Everything else defaults.
- C2. Description: a friendly rich-text editor (bold, lists, links, no raw HTML), with an
  optional "Write it for me" AI suggestion using the partner's or merchant's AI key, metered
  (decided 2026-10-05 on #337).
- C3. Photos: see part F.
- C4. Price in the store's currency, including or excluding tax per store setting, with the
  live breakdown (§3 fact 6). The **compare-at price**, labelled per region as "was", RRP,
  MSRP or MRP, follows the rules in §3 fact 41 `(release: decide)`. **Cost price with profit
  shown** `(release: decide)`.
- C5. Tax class picker (§3 fact 37). Where a tax service is used, a plain-language tax-code
  search. The classification code search appears only where the store's markets need it (§3
  fact 7).
- C6. Quantity: one number, going to the default warehouse, which is named. There is a link to
  split it across warehouses when there are several.
- C7. "Track stock" and "Keep selling when out of stock" sit under More options.
- C8. SKU auto-generated from the name, editable, with a clash check.
- C9. Weight and package size in the store's units (§3 fact 39) for delivery charges
  `(release: decide)`; every courier's rates depend on them. For cross-border selling, add
  customs details: country of origin, classification code and customs description.
- C9a. Barcode per version (§3 fact 44), or "This product has no barcode".
- C9b. "What are you selling?": Physical · Digital · Service (§3 fact 48). The choice removes
  irrelevant fields (no weight or stock for a download).
- C9c. "Where you sell" / "Can't ship to" (§3 fact 42), and the age-restriction flag (§3 fact
  43), under More options.
- C9d. The compliance checklist for the store's markets (§3 fact 34, part T): "Ready to sell
  in US ✓ · EU: 2 details missing".
- C10. Collections: pick existing ones or create one inline. Automatic collections the product
  already matches are shown read-only ("Also in: Cotton Collection, via Fabric = Cotton").
- C11. Filters and internal tags: add values inline and create new ones on the fly.
- C12. Search-engine listing preview, auto-filled and editable.
- C13. Web address, auto-generated, with the full URL shown and editable under More options.
- C14. Visibility: "Visible on your store" / "Hidden (only you can see it)". This control is
  absent for vendors when approval is on.
- C15. Save, and Save & add another.
- C16. Validation: missing name or price, a negative or zero price ("Selling for free?"),
  absurd values (a price 1,000× the store's average), a price with too many decimals for the
  currency (¥ has none), a duplicate SKU, an invalid barcode check digit, a duplicate web
  address (auto-suffix).
- C17. Leaving with unsaved changes, session expiry mid-edit (save the draft and ask to sign in
  again), and losing connection mid-save.

### D. Products with options and versions

- D1. "Does this product come in different sizes, colours or other choices?" opens the options
  builder.
- D2. Add an option from suggestions (Size, Colour, Material, Style, Weight, Volume, Pack of,
  Scent, Flavour) or a custom name, and type choices as chips. Colour choices offer a swatch.
  Size suggestions follow the store's region and category: US 2–16 / S–XL, UK 6–20, EU 34–48,
  shoes US / UK / EU / JP / CM, jeans W×L, and ring sizes US / UK / EU.
- D3. The version count is previewed before generating ("This makes 12 versions"). Up to 3
  options and 100 versions (decided 2026-10-05 on #337), and a clear message at the version limit.
- D4. A generated versions table showing each combination's price, stock, SKU, photo and
  visibility, with "Apply to all" for price and stock, and per-choice apply ("All XL:
  $34.99").
- D5. Remove combinations that don't exist ("We don't make Red in XL") and add them back later.
- D6. Add a choice later (e.g. XXL). Only the new versions appear, pre-filled from a sibling.
- D7. Remove a choice. Confirm which versions go, say they cannot be undone, and say that past
  orders are kept.
- D8. Add a whole new option to an existing product (§3 fact 3): ask which choice the existing
  versions get.
- D9. Remove an option entirely, which collapses versions. Explain what happens, and let the
  seller choose which version survives per combination.
- D10. Rename an option or a choice ("Red" → "Maroon") without touching stock or prices.
- D11. Reorder options and choices. This changes the order the shopper sees.
- D12. Per-version photo ("Show this photo when Red is picked"), usually set per colour rather
  than per version.
- D13. Per-version tax class, classification code, barcode and weight, defaulting from the
  product and overridable. For example, a children's size can be zero-rated in the UK while
  the adult sizes are not.
- D14. Hide one version (e.g. discontinued Blue) while the product stays visible. Guard against
  hiding all versions (§3 fact 8).
- D15. One version out of stock: the shopper sees it greyed out. Show how it will look.
- D16. Convert a simple product to one with options, and back to simple when one version is
  left.
- D17. Price range display in lists ("$24.99 – $34.99"), formatted for the store's locale.
- D18. Very many versions (60+): table search, filter by choice, bulk edit.

### E. Edit, duplicate, hide, delete

- E1. Editing a supplier's product: a banner says "This is Northwind Textiles' product. They will
  see your changes."
- E2. A vendor editing their own product sees "Your store owner can also edit this product."
- E3. A vendor edits an already-approved product. Settled 2026-10-02 (ACCESS.md §7.2): it goes
  back to waiting for approval, and off the storefront, **only when the name, a price or the
  photos changed**; every other edit goes live. The save says which: "Your price, title or
  photo change needs approval" or "Saved — live now".
- E4. Two people edit the same product. The second save sees "Someone else changed this product
  2 minutes ago", with a choice to review or overwrite. The engine must detect the conflict (a
  version number or updated-at check on save).
- E5. Changing the web address of a live product: warn that old links will break.
- E6. Duplicate a product: "Copy of …", hidden by default, stock not copied (decided 2026-10-05 on #337).
- E7. Hide vs delete. Hiding is the recommended action. Delete confirms, lists what happens to
  collections and past orders, and offers undo where possible.
- E8. Bulk delete of many products, with progress and partial failure ("48 deleted, 2 could
  not be: …").
- E9. Change history ("Edited by Priya, 2 hours ago"). Every privileged write is audited with
  the real actor (PLATFORM-PROMPT §2 item 20); the portal **shows** that history on the
  product page (decided 2026-10-05 on #337).
- E10. Price per store: if one product can be listed in more than one of a merchant's stores
  *(open, §9)*, the form shows "Price in this store". Other stores are never shown.

### F. Photos and media

- F1. Drag-and-drop or tap to upload several at once, and use the phone camera.
- F2. Progress per photo, retry on failure, and continue editing while uploads finish.
- F3. Reorder by dragging. The first photo is the main photo, and this is stated.
- F4. Remove a photo, and choose from photos already uploaded.
- F5. Alt text, auto-suggested and explained as "helps blind shoppers and Google".
- F6. Too large, wrong format (HEIC from iPhones: convert or explain), duplicate upload.
- F7. Basic crop and square framing guidance ("Square photos look best").
- F8. A product with no photo: a placeholder in lists, and a nudge in the "No photo" filter.
- F9. Video: **supported** (decided 2026-10-05 on #337).

### G. Stock on the product (the catalogue half of §E)

- G1. One warehouse: a single quantity field.
- G2. Several warehouses: expand to per-warehouse quantities, default warehouse first.
- G3. Show "12 in stock · 3 reserved for orders", and explain "reserved".
- G4. Adjust with a reason, settled 2026-10-02: the form offers "Change stock with a reason"
  (Received new stock, Returned by a shopper, Damaged or lost, Counted again) and a typed
  number is recorded as "Typed a new number". The engine keeps the stock-movement ledger
  either way (PLATFORM-PROMPT §5.4 Inventory), and the product shows its **Stock history**:
  every change, by hand, by orders, by suppliers and by imports, per product and per version.
- G5. Low-stock threshold and low-stock badges.
- G6. A stock-only vendor sees exactly this and nothing else.
- G7. A vendor never sees merchant or other-vendor quantities, including totals.

### H. Collections

- H1. Collections list with image, name, product count ("Updating…" while computing), type
  (Automatic / Hand-picked) and visibility.
- H2. Empty state explaining collections with examples ("Summer Sale", "Gifts under $50",
  "Men's Shirts").
- H3. Create hand-picked: search and add products, and remove them.
- H4. Create automatic: a rule builder written as sentences — "Products where **Fabric** is
  **Cotton** *or* **Linen**", "…and **Occasion** is **Wedding**", "name contains 'shirt'". It
  shows a live preview of matching products and the count.
- H5. "Match any rule" vs "match all rules", written in words.
- H6. Nested collections (Men › Shirts) and the "only products also in the parent" behaviour
  (§3 fact 11), with a diagram if it helps.
- H7. Collection photo, description, web address and search listing.
- H8. Hidden collections (internal use, e.g. for offers).
- H9. Delete a collection: the products are not deleted, and this is stated.
- H10. A product in several collections, visible from the product side (C10).
- H11. Ordering products within a collection: "Sort by: best selling / newest / price /
  manual". The engine provides the manual order (PLATFORM-PROMPT §5.4); best selling needs
  order data per product `(release: decide)`.
- H12. "Under $50" collections: price-range rules are an engine requirement (PLATFORM-PROMPT
  §3.3) `(release: decide)`. With several currencies, say which currency the rule uses.
- H13. Seasonal and regional collections: "Black Friday", "Christmas", "Diwali", "Ramadan",
  "Back to school", "Singles' Day". Suggest them by the store's markets and date, never assume
  one culture's calendar.

### I. Filters (facets) and internal tags

- I1. Filters list: name, choices, how many products use each, and shopper-visible vs
  internal.
- I2. Explain with the storefront picture: "These are the checkboxes shoppers see on the left of
  your shop."
- I3. Create a filter with choices, from suggestions (Brand, Fabric, Occasion, Fit, Pattern).
- I4. Rename a choice, merge two choices ("Cotton" + "cotton"), and delete a choice in use
  (say how many products lose it).
- I5. Internal tags: the same mechanism, private, explained as "only you see these".
- I6. The difference between **options** (what the shopper *chooses* when buying) and
  **filters** (what the shopper *browses by*). This is the most confusing concept in the whole
  catalogue. Explain it once, well, wherever either is created.
- I7. Filters as the basis for automatic collections (links both ways).

### J. Menus

- J1. Build the store's navigation from collections: drag to order and nest.
- J2. Preview of the menu on desktop and phone.
- J3. What happens to a menu item when its collection is hidden or deleted.
- J4. Menus **can** link to content pages and URLs, not only collections (decided 2026-10-05 on #337).

### K. Import and export

The engine's import/export module provides CSV and Shopify import (file and store connect),
with validation before any write, partial-failure reports, and translation and currency columns
(PLATFORM-PROMPT §3.2, §5.4). Imports and exports run as background jobs, never in a request.

- K1. Entry points: "Import from a spreadsheet", "Bring products from Shopify" (file or connect
  store), and a template download with an example row.
- K2. Upload, then a validation summary: "120 products ready · 8 have problems".
- K3. Problems listed by row and column in plain words, with a download of the file with an
  errors column. The seller can fix and re-upload, or import only the valid rows.
- K4. Existing products matched by SKU: the merchant chooses "update them" or "skip them" (decided 2026-10-05 on #337).
- K5. A warehouse for imported stock, defaulting to the default warehouse.
- K6. Long-running import: a progress bar, and permission to leave the page, with a
  notification when done and partial-failure reporting (e.g. image URLs that 404).
- K7. Shopify connect: enter the store address, approve on Shopify, return, pick products with
  select-all, then import. Also handle a connection that failed or expired.
- K8. Export all or the current filtered selection: long-running, with a download link and a
  "recent exports" list.
- K9. Vendor import/export: allowed, their own products only (decided on #184).
- K10. Multi-language: import and export translations as extra columns (`name:hi`,
  `description:hi`) (decided 2026-10-05 on #337).
- K11. Multi-currency: import and export manual-currency prices as extra columns
  (`price:USD`). Automatic currencies are never imported.

### L. Vendors and approval (catalogue side)

- L1. Approval off: a vendor's product goes live immediately. The vendor is told so.
- L2. Approval on: the vendor's save becomes "Submit for approval". The status reads "Waiting
  for approval", and there is no visibility control.
- L3. Merchant review (the To approve screen; in the first release the review panel opened from
  Products' "Waiting for approval" chip, FIRST-RELEASE §3.1): see the product as the shopper would, approve,
  or "Send back" with a required reason.
- L4. The vendor sees "Sent back: [reason]", edits and resubmits.
- L5. Merchant edits a pending vendor product before approving.
- L6. A vendor-supplied product in the merchant list is marked with the supplier's name, and
  can be filtered by supplier.
- L7. Suspending a supplier asks the Owner whether to **hide its products or keep selling
  them** from the stock in hand (settled 2026-10-02 on #186's review with the prototype's suspend modal,
  ACCESS.md §7.5); hidden ones return on resume. A removed supplier's products are hidden and
  kept, still marked as theirs, for the merchant to publish or delete (settled 2026-10-02).
  Show the count and the hidden list.
- L8. A vendor at the Stock only tier (§4).
- L9. Vendor filters and collections: no collections; a vendor sets filter values on its own
  products (decided 2026-10-05 on #337).

### M. Help and learning

- M1. "What's this?" micro-help on every unfamiliar field, one or two sentences with an
  example.
- M2. A small glossary drawer built from §2's right-hand column.
- M3. Contextual tips that disappear once used ("Tip: add Size as an option so shoppers can pick
  one").
- M4. The **portal's own** language (the seller's interface): **English only** at launch (decided 2026-10-05 on #337). This is separate
  from the store's product languages in part N. Every string, format and example in the
  portal must be localisable, with no concatenated sentences and plurals handled per language.

### N. Multi-language listing (only when Settings offers more than one language)

- N1. **Single-language store**: no language switcher, no "translations" section, and no
  mention anywhere. Check every screen for leftovers.
- N2. A language switcher on the product form ("Editing in: English ▾ · French · German") shows
  per-language status dots. Switching keeps unsaved changes in both languages.
- N3. Translating: the translatable fields (§3 fact 18) show the main-language text as a
  reference beside or above each field. Shared fields are locked and labelled "same in every
  language".
- N4. Side-by-side mode on desktop (main language left, translation right) for fast work across
  many products. On a phone it stacks.
- N5. Product status per language: "Translated", "Not translated (shoppers see [main
  language])",
  "Changed since translated" when the main text was edited after the translation. **Decided on
  #296**: each translation keeps the md5 of the main text it translated, so the status is a
  comparison, per field.
- N6. Translate options and choices once per product. Show where "Red" is used across the
  catalogue: translations are **shared** across the catalogue (decided 2026-10-05 on #337).
- N7. Collections, filters, filter choices and menus are translatable too, on the same
  pattern. The menu preview (J2) can be viewed in each language.
- N8. Web address per language (§3 fact 22), and the search listing per language (§3 fact 21,
  `(release: decide)`).
- N9. "Suggest a translation" with AI (§3 fact 24): per field, per product, or in bulk across
  the untranslated products. Always reviewed before it counts as translated.
- N10. Product list: a language column or filter ("Not translated into German: 96"), plus bulk
  "Suggest translations for selected".
- N11. The storefront preview in each language, showing the fallback text where a translation
  is missing, labelled as such.
- N12. A language added in Settings later: every product starts "not translated". Show a
  gentle banner in Products with a count, and nothing that looks like an error.
- N13. A language removed in Settings: translations are kept but not shown (decided 2026-10-05 on #337). Say so
  in Settings and on affected products.
- N14. Main language changed in Settings: **allowed** after products exist, with a warning;
  products with no text in the new main language fall back until translated (decided 2026-10-05 on #337).
- N15. Vendors may translate their own products only (decided 2026-10-05 on #337), and
  the merchant can edit translations too (same shared-record rule as E1/E2).
- N16. A vendor's new translation needs approval while approval is on (decided 2026-10-05 on #337).
- N17. Right-to-left languages (Arabic, Hebrew, Urdu, Persian): fields flip direction only while
  that language is being edited, and previews render RTL. Needed for Gulf and Middle East
  stores; **not at launch** (decided 2026-10-05 on #337).
- N18. Regional variants of one language: en-US vs en-GB ("color" / "colour"), pt-BR vs pt-PT,
  es-ES vs es-MX, fr-FR vs fr-CA. The engine's language codes must be able to express these
  (BCP 47 tags); **en-IN, en-US and hi-IN** are offered at launch (decided 2026-10-05 on #337). Show them as separate languages only when the
  store offers both.
- N19. Compliance text in a market's language (§3 fact 47): required translations for safety
  information show as a checklist item, even when the store doesn't offer that language on the
  storefront.

### O. Multi-currency listing (only when Settings has multi-currency on)

- O1. **Single-currency store**: one price field in the pricing currency. No currency words,
  codes or switchers appear anywhere.
- O2. On the price field, other currencies show beneath the main price:
  - **Set automatically**: "USD $15.99 · set automatically". The value is read-only, with
    "Set this one yourself" to override it for this version (§3 fact 26; built on #296: a typed
    price is that override, and always wins over the converted one).
  - **Set by you**: an editable field per currency ("USD $ ____"). Empty is allowed but
    flagged: "Not for sale in USD until you add a price."
- O3. Versions table (D4): a column per manual currency, with "Apply to all" per currency and
  a toggle to hide the extra columns when not needed.
- O4. Rounding shown as it will apply ("$15.47 → $15.99"), with a link to Settings. **Built on
  #296**: `nearest` is the nearest whole unit (a no-op for a currency with no minor unit, such as
  JPY); `ends-99` rounds up to the nearest price ending in 99 of the minor unit, never below the
  computed one ($15.00 → $15.99, $15.99 stays), or, with no minor unit, of the hundred (¥1,547 →
  ¥1,599).
- O5. Rates freshness: "Rates updated 2 hours ago", and what shoppers see if rates are stale or
  unavailable. **Decided on #296**: the ECB's daily euro reference rates, checked every six hours; a
  converted price uses the latest rate held, however old (the portal shows its date), and a
  currency with no rate at all isn't for sale until one arrives.
- O6. Product list: price column in the pricing currency, and a filter "Missing a USD price".
  Bulk "Set USD price" for selected.
- O7. Quick edit (B6) includes manual currencies.
- O8. A currency added in Settings:
  - Automatic: nothing to do, and the product form says so.
  - Manual: a banner in Products says "214 products have no USD price yet", with bulk tools.
- O9. A currency removed in Settings: its prices are kept but unused (decided 2026-10-05 on #337).
- O10. A currency switched from manual to automatic, or back: typed prices are **kept as
  overrides** (decided 2026-10-05 on #337).
- O11. The compare-at price (C4, `(release: decide)`) also exists per currency, converted by the
  same rule unless typed (decided 2026-10-05 on #337).
- O12. Tax display for non-pricing currencies (§3 fact 26): labels follow each market ("incl. GST" in India, "+ tax" in the US) (decided 2026-10-05 on #337). A EUR price that includes
  VAT and a USD price to which sales tax is added must each be labelled correctly. Show
  "incl. VAT" and "+ tax" per currency.
- O12a. Psychological price endings differ by market: .99 (US/UK), ,90 or whole euros (parts of
  Europe), round numbers (Japan). Rounding (O4) should offer market-appropriate endings *(ask
  whether per currency)*.
- O13. Price per store (E10) combines with currency: price is per store **and** per currency.
  Show only this store's currencies.
- O14. Prices in other currencies are the merchant's call; vendors can't set them (decided 2026-10-05 on #337). A Stock only vendor sees none of it.
- O15. Storefront preview in each currency, showing the shopper's price after rounding.

### P. Catalogue features: configuration and plan

- P1. **Settings › Catalogue** (a Settings tab, designed in the prototype's `CatSettings` on
  2026-10-02 with the badge definitions of S5; the store settings behind it are an engine
  requirement, `(release: decide)` in FIRST-RELEASE.md): the Owner switches rich-listing
  features on or off for the store:
  - size charts, A+ content, specifications, highlights, FAQs, badges, related products and
    video;
  - the legal information defaults (§3 fact 34).

  Each row shows whether the plan includes it.
- P2. Store-type presets are offered at sign-up and editable in this tab (decided 2026-10-05 on #337): "Clothing" turns on size charts;
  "Electronics" turns on specifications and warranty; "Food" turns on net quantity and best
  before. Presets are only starting points.
- P3. **Included and on**: the section appears on the product form in its place (part C's
  order), collapsed and optional.
- P4. **Included but turned off**: the section is absent from the product form. Settings is the
  only place it is mentioned.
- P5. **Not in the plan**: one quiet, dismissible teaser per feature on the product form
  ("Add a size chart · Available on [plan name]"), with a preview of what it looks like on the
  storefront. Never block the save, and never a modal.
- P6. **Limits** (products, versions per product, photos per product, collections, languages,
  currencies, size charts, A+ products, video): a usage meter in Settings › Catalogue and at
  the point of use ("8 of 10 photos"). Warn at about 80%. At the limit, the add button explains
  itself instead of vanishing.
- P7. **Metered features** (AI descriptions, AI translations, background removal if offered):
  remaining allowance shown before running, not after.
- P8. **Trial**: everything included, labelled "Included in your trial · 7 days left" (the
  house partner's trial is 10 days, SAAS.md §6.1).
  Before the trial ends, show what will be locked and what happens to content already made.
- P9. **Downgrade** (§3 fact 32): a summary before confirming ("A+ content on 34 products will
  be hidden from your store; you keep it"), and afterwards an "over limit" state that never
  looks like an error.
- P10. **Upgrade**: a plan-unlock moment returns the Owner to exactly the screen they came
  from, with the feature now open.
- P11. **Who sees plan messages**: only the Owner sees upgrade prompts, because billing is
  Owner-only. A Manager sees "Ask your store owner to add this". **A vendor never sees plans,
  prices or upgrade prompts.** For them an unavailable feature simply isn't there.
- P12. **Import** respects limits: "Your file has 700 products; your plan allows 500 more. Import
  the first 500?"

### Q. A+ content (Product story)

- Q1. Entry: "Add A+ content" on the product form (below the description), opening a
  full-width builder. On a phone: a stacked editor with preview.
- Q2. **Modules** to pick from, shown as visual thumbnails (confirm the list against what the
  storefront core can render, §3 fact 28):
  - large banner image with headline
  - image + text, left or right
  - 3- or 4-column feature highlights with icons or images
  - comparison chart (this product vs 2–5 others from the catalogue, picked by search)
  - image gallery / lifestyle strip
  - "What's in the box"
  - specifications block (pulls from part S, never retyped)
  - brand story
  - video *(plan-gated)*
  - FAQ (pulls from part S)
- Q3. Add, reorder by dragging, duplicate, delete a module, and a module limit per plan.
- Q4. **Templates**: start from "Fashion", "Electronics", "Home" or "Beauty", pre-filled with
  placeholders the seller replaces. Show what's left to fill in.
- Q5. **Reusable blocks**: a "Brand story" block edited once and shared by many products
  `(release: decide)`. Editing it shows "Used on 48 products".
- Q6. Copy A+ content from another product, and apply it to several products at once.
- Q7. Photo requirements per module (e.g. banner 1464 × 600), with automatic cropping guides.
  Wrong-size uploads get a crop tool, not a rejection. Alt text is required, with a
  suggestion.
- Q8. Live preview on desktop and phone, exactly as the storefront renders it.
- Q9. Draft vs live: A+ content can be saved unfinished without affecting the live page, and
  published **separately** from the product (decided 2026-10-05 on #337).
- Q10. Per language (part N): text is translated per module and photos are shared by default,
  with "Use a different photo for French" `(release: decide)`.
- Q11. Vendor A+ content goes through approval with the product (§3 fact 35). The merchant
  reviews it in the same preview.
- Q12. Empty, not-in-plan (P5) and turned-off (P4) states. On downgrade, existing A+ content is
  kept and shown as "Hidden from your store — upgrade to show it" *(or as decided, §3 fact
  32)*.
- Q13. Import/export: A+ content is not in the CSV (decided 2026-10-05 on #337). Copying between products (Q6)
  is the bulk tool instead.

### R. Size charts

- R1. **Size charts list** (in the Collections area, as in the prototype (decided 2026-10-05 on #337)): name,
  how many products use it, units, last edited.
- R2. Create from a **template**, suggested by the store's region, with other regions one click
  away:
  - Women's clothing (US / UK / EU / IT / FR / JP / AU / IN)
  - Men's shirts (collar size, or S–XXL)
  - Jeans (W×L)
  - Kids by age and height
  - Footwear (US / UK / EU / JP / CM, men's vs women's)
  - Bra sizes (US / UK / EU / FR, which differ even with the same letters)
  - Rings (US / UK / EU / diameter)
  - Hats and gloves
  - Region-specific garments (e.g. kurtas, abayas)

  Or start blank.
- R2a. **Size conversion**: a chart can list several size systems as columns (US 8 = UK 12 =
  EU 40), so one chart serves shoppers from every market. The storefront can highlight the
  shopper's own system (storefront core work, `(release: decide)`).
- R3. **Table editor** like a spreadsheet: rows are sizes, columns are measurements (Chest,
  Waist, Length, Shoulder…). Add, remove and reorder rows and columns, and paste from Excel or
  Google Sheets.
- R4. Units: cm or inches, defaulting from the store's unit system (§3 fact 39), with the other
  computed automatically and a toggle for the shopper on the storefront. Ranges allowed
  ("38–40").
- R5. **How to measure**: an illustration (from a library or uploaded) and short text per
  measurement. Optional fit notes ("Runs small — order one size up") and model info ("Model is
  175 cm / 5'9" wearing M"), shown in the shopper's units.
- R6. **Assign** directly on the product form ("Size chart: Men's shirts ▾"), in bulk from the
  product list, or by rule ("All products in Men's Shirts", or with Category = Shirts),
  `(release: decide)`. Rule-assigned charts show on the product as "From collection Men's
  Shirts".
- R7. **Check the match with the Size option**: warn when the product's Size choices (part D)
  don't appear in the chart ("Chart has no row for XXL"), and offer to add the row.
- R8. A product with a Size option but no chart: gentle nudge ("Shoppers return fewer orders
  when there's a size chart"), plus a filter "Has sizes, no size chart".
- R9. Edit a chart used by many products: "This changes the chart on 120 products." Offer to
  duplicate it instead.
- R10. Delete a chart in use: say how many products lose it, or require reassigning.
- R11. Per language (part N): measurement names, notes and "how to measure" are translatable,
  while numbers are shared.
- R12. Storefront preview: the "Size chart" link beside the size picker, and the popup on phone
  and desktop.
- R13. Vendors may create their own charts (decided 2026-10-05 on #337). Their
  charts are visible only to them and the merchant.
- R14. Plan states: not in plan (P5), and limit on number of charts (P6). Existing charts are
  kept on downgrade.
- R15. Import: a "size chart" column naming an existing chart by name `(release: decide)`.

### S. Other listing sections: specifications, highlights, FAQs, legal, badges, related

Each one is switched on in Settings › Catalogue and may be plan-gated, except **legal
information (S4)**, which is configuration only.

- S1. **Specifications**: a two-column list of name and value, with suggestions by store type,
  reused names ("Material" appears as you type) and group headings ("Display", "Battery").
  "Shoppers can filter by this" turns a row into a filter value (§3 fact 30). Per-version
  values where they differ (e.g. Storage: 128 GB / 256 GB).
- S2. **Highlights**: 3–5 short bullets with a character counter, shown near the price.
- S3. **FAQs**: question and answer pairs, reorderable, with suggested common questions per
  store type. Shared FAQs across products *(ask; `(release: decide)`)*.
- S4. **Legal and safety information** (§3 facts 34, 45–47): the fields shown are the union of
  the store's selling markets and the product's category. Examples: country of origin;
  manufacturer, importer, and EU/UK responsible person; safety warnings; fibre and care; food
  and cosmetic ingredients and allergens; age range; compliance marks; energy label; battery
  information; Prop 65 warning; MRP; net quantity; dates; customer care. Part T designs this in
  full.
  - Defaults come from Settings (company, manufacturer, responsible person, customer care), and
    the product form shows them as "Using your store's details — change for this product".
  - Missing values required for a market block selling **in that market only** ("Ready in US ·
    Not yet in EU: add the EU responsible person"), with an explanation of why. They don't
    block other markets.
  - Never plan-gated.
- S5. **Badges**: defined in Settings › Catalogue (P1) with a label of up to 18 characters and
  one rule, designed 2026-10-02: added in the last 30 days, your 5 best sellers this month,
  lower than its compare price, only a few left (3 or fewer), or **manual** ("you choose the
  products"). Automatic badges come and go by themselves; only manual ones are picked on the
  product. Show a preview on the product card. Release `(release: decide)` in FIRST-RELEASE.md.
- S6. **Related products / Frequently bought together**: pick by hand, or "Automatic (same
  collection)". Vendors can pick only their own products.
- S7. **Video**: upload or paste a YouTube link, with a poster image *(plan-gated; ask whether
  hosted or linked only)*.
- S8. **Warranty and returns**: per product, overriding the store policy (e.g. "No returns on
  underwear"). Consumer law sets floors that a seller cannot go below: the EU's 14-day
  withdrawal right and 2-year legal guarantee, and the UK's equivalents. A per-product override
  must not undercut them in those markets, and the UI explains why *(confirm with
  compliance)*.
- S9. All of S1–S8 are translatable where they contain text (part N), subject to approval for
  vendors (§3 fact 35), and absent when turned off (P4). The exception is legal information
  (S4), which is switched on by the store's markets and cannot be turned off while selling
  there.

### T. Regions, tax and compliance (the catalogue side)

- T1. **The store's markets drive the product form.** The store's settings (§3 fact 36) hold
  the home country and the countries sold to. The product form shows only what those markets
  need. Design the same product for three stores: a US-only store, an EU store selling to five
  countries, and an Indian store selling domestically and to the UAE.
- T2. **Compliance checklist per product**: "Ready to sell in: US ✓ · DE: 2 missing ·
  FR: French warnings needed". Clicking an item jumps to the field. It appears in the
  product list as a filter and a column ("Not ready in EU: 34"). **Built on #298** as the
  prototype's `marketStatus` reckons it, per live top-level market: a price the market can
  charge (gift cards aside), and for a physical product what its countries require, the US
  fibre content, country of origin and care instructions, India the country of origin and an
  MRP (compare-at price); a detail counts when filed for the country or for every country
  (`product_compliance` keys `fibre`, `origin`, `care`). Other countries add theirs as they
  launch.
- T3. **Tax class** (§3 fact 37): a plain-language picker, "depends on location" messaging,
  exempt and reduced classes, and the US tax-code search via a tax service
  `(release: decide)`. Changing the class in bulk (B5).
- T4. **Tax-inclusive vs exclusive display** per store (§3 fact 6), and per currency where they
  differ (O12). Design the price field for a German, a US and an Indian store.
- T5. **Classification and customs**: classification code search by plain words, country of
  origin, and customs description for cross-border sales. Show a region-appropriate label, and
  an optional field where not needed (§3 fact 7).
- T6. **Compare-at price rules** (§3 fact 41): the EU "lowest price in the last 30 days" shown
  automatically, India's MRP ceiling, and an explanation when a value is refused.
- T7. **Unit pricing** (EU, UK, parts of the US): "€12.50 / kg", computed from net quantity and
  price, with a per-product override of the reference unit (per 100 g, per l, per m).
- T8. **Where you sell** (§3 fact 42): the product inherits the store's markets. "Can't ship
  to…" and "Only sell in…" lists, with bulk editing and storefront messaging for blocked
  countries.
- T9. **Restricted products** (§3 fact 43): the age-restriction flag, prohibited-category
  refusal (§3 fact 46), and hazardous-goods flags (batteries, aerosols, flammables) that affect
  shipping.
- T10. **Category-driven sections** (§3 fact 46): picking a category ("Food & drink") reveals
  its sections. Changing category asks before hiding filled-in fields, and never deletes them.
- T11. **Responsible person / importer** (EU, UK): set once in Settings, overridable per
  product or per supplier. **Deferred**: the EU and UK aren't launch regions (decided 2026-10-05 on #337).
- T12. **Barcodes** (§3 fact 44): per version, check-digit validation, "no barcode" for own-brand
  items, and bulk entry by pasting or scanning with a phone camera.
- T13. **Units** (§3 fact 39): entry in either system, a canonical stored value, and display in
  the store's system with the other in brackets where helpful.
- T14. **Digital, service and gift-card products** (§3 fact 48): a different, shorter form with
  no weight, stock or shipping. File upload or a licence-key pool for downloads; an optional
  duration and location for services, with no booking (decided 2026-10-05 on #337).
  **Built on #323 (SAPI 22), part 1** (`productKind`, `saveProductKind`, `addLicenceKeys`;
  `POST /api/assets?kind=download`): a download is a private file (PDF, ZIP, MP3, MP4, WebM or
  an image, up to 30 MB while uploads go through the Worker's memory, as video does) or a key
  pool, its link working 3, 5 or 10 times over 7, 30 or 365 days; keys are counted and never
  shown again once saved, and a pool's keys left are the product's stock on the storefront,
  sold out at none. A service keeps an optional length (60 characters) and place (200). A gift
  card's amounts are its versions, priced as any product; it expires after 12–120 months or
  never, no sooner than its country allows (FIRST-RELEASE §1). None of the three is counted in
  stock, a cart holding only them asks no address or delivery, and a gift card carries no tax.
  Decided here: these kinds are the merchant's own, never a supplier's (ACCESS §7.1).
  **Part 2, delivery** (`deliverOrder`, run as a payment settles or is marked paid, never before;
  nothing for a preview's test order): a download's grant, served at `/shop-api/downloads/{grant}.{signature}`
  from R2 as an attachment, rate-limited per host and address (`DOWNLOAD_RATE_LIMITER`, 30 a minute), with one refusal (`LINK_CLOSED`) for
  a link unknown, another shop's, expired, used up or of a refunded order; a key per unit from the
  pool, an order the pool ran dry for logged and given the next keys added; a gift card issued per
  gift card line (one card a line, for the recipient chosen last), emailed with its code at 08:00
  in the store's time zone on the day chosen. The order page and an email list the links and keys.
  **Part 3, gift cards** (`giftCards`, `issueGiftCard`; Shop API `giftCardBalance`, `applyGiftCard`,
  `removeGiftCard`, `ShopCart.amountDue`, `placeOrder(provider: "gift_card")`): a number checked in the
  shop's own store only, rate-limited per store and address with the offer codes' limiter, one
  refusal (`GIFT_CARD_INVALID`) for a wrong, unsent, expired or used-up card or another store's; a
  card is spent only in its own currency and never on a preview; placement takes what it applies
  under the card's lock, so a second order priced against the same balance is told
  `CART_CHANGED`. "Issue a card" (Owner and Manager) gives one of the product's amounts by email.
- T15. **Vendors across borders**: a vendor may be in a different country from the merchant
  (e.g. a UK merchant with a Chinese supplier). Country of origin, importer and customs
  details default from the vendor, not the merchant (decided 2026-10-05 on #337).
- T16. **Import/export** (part K) carries the region fields as columns (tax class, barcode,
  country of origin, classification code, weight with unit) and validates them per market.
  Shopify CSVs already carry some of these (barcode, weight, HS code, country of origin): map
  them.
- T17. **A store adds a new market in Settings** (e.g. starts selling to the EU): a banner in
  Products says "To sell in the EU, 214 products need 2 more details", with a guided bulk fix
  (set a default responsible person for all, add missing translations of warnings).

---

## 7. States that apply to every screen

Design once, apply everywhere:

- **Empty** — every list, with an action and an example.
- **Loading** — skeletons, not spinners, for lists. Show progress for uploads, imports and
  exports.
- **Saving / saved / failed to save** — in the sticky bar.
- **Validation errors** — inline, plus a summary at the top for long forms.
- **Permission denied** — a Staff member opening an edit URL, or a vendor opening another
  vendor's product. The vendor case looks like **"not found"**, not "forbidden", so it doesn't
  reveal that the product exists.
- **Read-only (subscription past due)** — everything visible, nothing editable, and a clear
  banner linking to billing. This is not an error page.
- **Store API unreachable / something went wrong** — the draft is kept, and a retry is offered.
- **Slow or offline network** on a phone.
- **Background work in progress** — collection counts updating, search not yet showing a new
  product, a change waiting for the next storefront publish (§3 fact 17).
- **Not translated** — calm, informational, never red. The shopper sees the main language.
- **No price in a currency** — prominent, because the product cannot be bought in that
  currency.
- **Settings changed underneath** — a language or currency added or removed while someone has a
  product open. On save, keep what they typed and explain the change.
- **Not in your plan** — a quiet teaser, not an error (P5). Owner only. Nothing for vendors.
- **Near or at a plan limit** — a meter, with the add action explaining itself (P6).
- **Over limit after a downgrade** — existing content kept, adding blocked, never an error
  (P9).
- **Feature turned off in settings** — the section is simply absent (P4).
- **Not ready to sell in a market** — per-market, specific and actionable (T2). It never blocks
  the markets the product is ready for.
- **Regional variants** — every screen that differs by region is shown for at least a US, an
  EU and an Indian store, in LTR and (where in scope) RTL.
- **Partner look** — every screen in the partner's look, never hard-coded to DripFunnel's.

---

## 8. What the interface must never do

- Show a vendor anything belonging to the merchant or another vendor. That includes search
  results, counts, filter-choice counts, collection contents, stock totals, exports, "also
  bought", and empty states that say "0 of 340".
- Offer a vendor a visibility, approval or supplier control.
- Show a raw engine or database term (variant, facet, slug, asset, channel, enabled,
  `seller_id`, minor units) or a raw error message.
- Show prices in minor units (cents, paise, pence), or tax-exclusive where the store is
  tax-inclusive (or the reverse).
- Hard-code a country's terms, units, formats, tax rates or legal rules. "GST" must never
  appear in a US store, and "sales tax" never in a German one.
- Show a single tax percentage as final when the rate depends on the shopper's location.
- Let a seller type a "was" price that a market's pricing rules forbid, without explaining why.
- Block a product everywhere because one market's information is missing.
- Delete or hide something in bulk without saying how many items, and which.
- Let a product be "visible" while nothing about it can be bought (§3 fact 8), without saying
  so.
- Show language or currency controls to a store that offers only one of each.
- Present an automatically converted price as if the seller typed it, or a typed price as if it
  were converted.
- Let a product be sold in a currency with no price, or treat a missing translation as an
  error.
- Gate a feature only in the UI. The server refuses too.
- Paywall legally required product information, or block saving on a plan limit without
  saying which limit and how to lift it.
- Delete or silently hide a seller's content because their plan changed.
- Show a vendor plans, prices or upgrade prompts.
- Offer an A+ module, badge or section that the storefront cannot render.
- Promise a change is on the live store before it has been published (§3 fact 17).

---

## 9. Open questions: ask, don't assume

- ~~Does editing an approved vendor product send it back for approval? (E3)~~ **Settled
  2026-10-02** (E3, ACCESS.md §7.2).
- ~~What happens to a removed or suspended supplier's products? (L7)~~ **Settled 2026-10-02**
  (L7, ACCESS.md §7.5).
- ~~Can vendors see or assign collections and filters? (L9)~~ No collections; filter values on
  their own products (decided 2026-10-05 on #337). ~~Can they import or export? (K9)~~
  **Settled 2026-10-04 on #184**: their own rows only (ACCESS.md §5.2).
- ~~Can Staff export? (§4)~~ **Settled 2026-10-04 on #184**: yes (ACCESS.md §5.1).
- Exact copy for publishing, and whether price and stock read live on the live static site.
  (§3 fact 17)
- Can one product be listed in more than one of a merchant's stores, or does every product
  belong to exactly one store? (E10, O13; new with the engine, since every catalogue row
  carries one `store_id`)
- Which engine requirements from §3 fact 12 are in the first release: compare-at price with
  price history, cost price, weight and dimensions, barcodes, scheduled publishing, product
  type? Price-range collections? (§3 fact 12, H12, PLATFORM-PROMPT §10)
- Does the engine keep "child collection limited to its parent's products"? (§3 fact 11)
- Does changing a web address keep a redirect from the old one? (§3 fact 15)
~~- Maximum options and versions per product. (D3)~~ 3 and 100 (decided 2026-10-05 on #337).
- ~~Stock adjustments with reasons, or plain overwrite? (G4)~~ **Settled 2026-10-02**: with
  reasons, and a stock history (G4).
- ~~Video on products? (F9)~~ Yes (decided 2026-10-05 on #337).
~~- AI help for descriptions and photos in the catalogue, and is it metered against the plan?
  (C2)~~ Descriptions, with the partner's or merchant's key, metered (decided 2026-10-05 on #337).
~~- Is change history shown on the product? (E9)~~ Yes (decided 2026-10-05 on #337).
~~- Which portal UI languages at launch? (M4)~~ English only (decided 2026-10-05 on #337).
~~- Duplicate: copy stock or not? (E6)~~ Not copied (decided 2026-10-05 on #337).
~~- Import: update or skip products matched by SKU? (K4)~~ The merchant chooses (decided 2026-10-05 on #337).
~~- Languages: may vendors translate, and do their translations need approval? (N15, N16)~~ Their own only; approval while approval is on (decided 2026-10-05 on #337).
~~- Can the main language change after products exist? What happens to removed languages'
  translations? (N13, N14)~~ Yes, with a warning; kept but hidden (decided 2026-10-05 on #337).
~~- Are option and choice translations shared across products, or per product? (N6)~~ Shared (decided 2026-10-05 on #337).
- Web addresses in non-Latin scripts: transliterate, or use the script? (§3 fact 22)
~~- Right-to-left languages in scope? (N17)~~ Not at launch (decided 2026-10-05 on #337).
~~- Which regional language variants are offered? (N18)~~ en-IN, en-US, hi-IN (decided 2026-10-05 on #337).
- AI translation: in scope, and metered? (§3 fact 24, N9)
- Automatic currency conversion: prices written ahead of time, or computed at checkout? Which
  rate provider? (§3 fact 26)
~~- Manual ↔ automatic switch: keep or discard typed prices? (O10)~~ Kept as overrides (decided 2026-10-05 on #337).
~~- Compare-at price and tax display in other currencies. (O11, O12)~~ Converted unless typed; labels per market (decided 2026-10-05 on #337).
~~- May vendors set prices in other currencies? (O14)~~ No (decided 2026-10-05 on #337).
~~- Translation and currency column format in import/export files. (K10, K11)~~ Extra columns (decided 2026-10-05 on #337).
- **Plans**: which features and limits each plan includes (A+, size charts, specifications,
  FAQs, video, badges, related products, languages, currencies, products, photos, AI
  allowances). Plan names are set by each partner. (§3 fact 27, P6)
- After a downgrade, does the storefront keep showing existing A+ content and size charts, or
  hide them? (§3 fact 32)
~~- Store-type presets and product categories: in scope? (P2, §3 fact 31)~~ Yes: at sign-up, editable in Settings › Catalogue (decided 2026-10-05 on #337).
- Which A+ modules can the storefront core render in its first version? (Q2)
~~- Is A+ content published with the product or separately? (Q9)~~ Separately (decided 2026-10-05 on #337).
~~- Where do size charts live in the nav? Can vendors create them? (R1, R13)~~ Collections area; yes, visible to them and the merchant (decided 2026-10-05 on #337).
- Shared FAQs and reusable A+ blocks across products? (S3, Q5)
- Video: hosted by us or linked only? (S7)
- The exact legally required fields per region, confirmed by whoever owns compliance. (§3 facts
  34, 45)
- **Regions**: which countries and regions are in scope at launch (US, Canada, UK, EU, India,
  Gulf, Australia, Southeast Asia…)? (§3 fact 36, T1, PLATFORM-PROMPT §10)
- Global store settings: home country, selling markets, tax registrations, and any-format
  postal codes and regions. Which release ships them? (§3 fact 36) ~~Unit system, time zone~~
  **Settled 2026-10-02**: first release, in Settings › Store info with the order-number format
  (PLATFORM-PROMPT §3.3).
- Classification code: which markets make it required, and does the engine offer a
  plain-words code lookup? (§3 fact 7)
- ~~US sales tax: the engine's own zones and rates, or a tax service?~~ **Stripe Tax** (decided
  2026-10-04 on #184), on the merchant's own Stripe account through Connect (decided 2026-10-05). EU OSS support? (§3 fact 37; the EU is not a launch region)
- EU Omnibus: price history for compare-at prices in the first release? (§3 fact 41)
- Per-product "where you sell", age restrictions, hazardous goods: in scope? (§3 facts 42–43)
~~- The prohibited-categories list. (§3 fact 46)~~ Set in §3 fact 46 (decided 2026-10-05 on #337).
~~- Digital products, services and gift cards: in scope? (§3 fact 48, PLATFORM-PROMPT §10)~~ Yes (T14) (decided 2026-10-05 on #337).
~~- Vendors in other countries: do origin, importer and responsible-person details come from the
  vendor? (T11, T15)~~ Origin and customs from the vendor; responsible person deferred (decided 2026-10-05 on #337).
- Price endings and rounding per currency and market? (O12a)
