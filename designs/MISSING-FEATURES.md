# DF Store: missing features

This compares the DF Store merchant portal, as designed in this folder, with **Shopify**,
**Wix eCommerce** and the **first DripFunnel platform**, which was built on a third-party
commerce framework and has since been removed from the workspace.

Last updated: 2026-10-27 (#846: what an order's Delivery panel draws but the first release doesn't have, §4). Before: 2026-10-23 (#854: what the shop app drawing shows but the first release doesn't have, §5). Before: 2026-10-23 (#837: the delivery app and own-delivery drawings, §4). Earlier: 2026-10-05.

"Missing" means DF Store has no screen or flow for the feature at all. When something is
started but not finished, it is in [INCOMPLETE-FEATURES.md](INCOMPLETE-FEATURES.md).

Legend: **✓** = has it · **~** = partial, or through an app or plugin · **—** = no

---

## 1. Summary

DF Store is already strong in these areas:

- catalogue (variants, A+ content, size charts, legal fields per market),
- offers,
- abandoned carts,
- markets, currencies and languages,
- suppliers,
- regional tax and wording,
- plan gating.

Compared with Shopify and Wix, the biggest gaps are:

1. **What the shopper sees.** ~~There is no store-level design, pages or blog, no checkout
   settings, and no customer accounts.~~ The shopper's pages, content pages, blog, checkout
   and accounts are drawn in `DF Storefront Prototype` (#285, 2026-10-05). The merchant side
   still lacks checkout settings, and the AI designer only edits the hero section.
2. **Order operations after the sale.** There are no returns, no order editing, no draft or
   manual orders, and no shipping labels.
3. **Customers and marketing.** There are no customer groups or segments, no email
   marketing, no reviews, no gift cards and no loyalty.
4. **Notifications.** There is no screen for the order, shipping and account emails that
   shoppers receive.
5. **Extensibility.** ~~There are no API keys, no webhooks, no apps or integrations~~ API keys,
   webhooks and private apps are drawn (`SetDev`, #286); there are still no sales channels
   (Google, Meta, marketplaces).
6. **Inventory depth.** There is no stock history, no transfers and no purchase orders.
7. **Trust and admin.** There is no activity log, no granular permissions and no profile or
   two-step (2FA) settings.

The first DripFunnel platform already had some of this, through its commerce framework: draft orders,
order modification, customer groups, customer history, a stock movement ledger, API keys,
zones, shopper email templates, an audit log, storefront customer accounts and Shiprocket
fulfilment. **Those features were designed away when the engine was replaced.** They are
marked **⚑** below. They are the cheapest to recover, because the old implementation
shows what is needed.

---

## 2. Feature comparison

### 2.1 Storefront and content

| Feature | Shopify | Wix | First DF platform | DF Store design |
|---|---|---|---|---|
| Theme library / choose a theme | ✓ | ✓ | ~ (one Next.js template) | — |
| Edit the whole site: sections, pages, header and footer | ✓ | ✓ | — | — (AI edits the hero only) |
| Content pages (About, Contact, FAQ) | ✓ | ✓ | ~ | — |
| Legal pages (refund, privacy, terms, shipping) with generator | ✓ | ✓ | — | — |
| Blog | ✓ | ✓ | — | — (Pricing says "Planned") |
| Forms (contact, newsletter sign-up) | ✓ | ✓ | — | — |
| Footer and secondary menus, links to pages or URLs | ✓ | ✓ | — | — (one main menu of collections only) |
| Store-level SEO: home title, social image, sitemap, robots | ✓ | ✓ | ~ | — |
| URL redirects (old link to new link) | ✓ | ✓ | — | — (a slug change only warns) |
| Preview link to share before publishing | ✓ | ✓ | — | — |
| Custom code or scripts, tracking pixels (GA4, Meta Pixel) | ✓ | ✓ | — | — |
| Cookie and consent banner settings | ✓ | ✓ | — | — (required by the storefront rules, but nothing to configure) |
| Storefront search settings (synonyms, boosts) | ✓ | ~ | ~ | — |
| Password-protected or "coming soon" store | ✓ | ✓ | — | — |

### 2.2 Checkout and shopper accounts

| Feature | Shopify | Wix | First DF platform | DF Store design |
|---|---|---|---|---|
| Checkout settings: guest vs account, required fields, tipping, notes | ✓ | ✓ | ~ (guest-checkout strategy) | — |
| Shopper accounts: sign-in, order history, addresses ⚑ | ✓ | ✓ | ✓ (template account pages) | ✓ shopper side in `DF Storefront Prototype` (#285); Settings › Customer accounts drawn in `SetAccess` (SUI 1, #286) |
| Wishlist | ~ app | ✓ | — | — |
| Product reviews and ratings | ~ app | ✓ | — | — |
| Back-in-stock alerts | ~ app | ✓ | — | — |
| Pre-orders | ~ app | ✓ | — | — (only "Keep selling when out of stock") |
| Product personalisation (custom text or upload on the product) | ~ app | ✓ | ✓ (custom fields) | — |
| Express wallets (Apple Pay, Google Pay, Shop Pay) | ✓ | ✓ | ~ (via Stripe) | — (not mentioned) |
| Local pickup with hours and locations | ✓ | ✓ | — | ~ (pickup hours; no location choice) |
| Local delivery (radius or postcode, time slots) | ✓ | ✓ | — | — |

### 2.3 Orders and fulfilment

| Feature | Shopify | Wix | First DF platform | DF Store design |
|---|---|---|---|---|
| Draft or manual orders (phone, WhatsApp sales) ⚑ | ✓ | ✓ | ✓ | — |
| Edit an order: items, quantities, address ⚑ | ✓ | ~ | ✓ (OrderModification) | — |
| Returns / RMA: request, approve, receive, restock, exchange | ✓ | ~ | — | ~ (start, receive, refund, restock, cancel; no exchange) |
| Buy and print shipping labels, book courier pickups ⚑ | ✓ | ✓ | ✓ (Shiprocket fulfilment handler) | ✓ (booked labels, courier pickup) |
| Choose which location fulfils an order | ✓ | ~ | ✓ | — |
| Fraud or risk analysis | ✓ | ~ | — | — (only "Looks like fraud" as a cancel reason) |
| Order tags, date filters, saved views | ✓ | ✓ | ~ | — |
| Bulk actions on orders: ship, print, archive | ✓ | ✓ | ~ | — |
| Resend order emails, send an invoice or payment link | ✓ | ✓ | ~ | — |
| Order number format, archiving | ✓ | ✓ | ✓ (OrderCodeStrategy) | ~ (number format in Store info; no archiving) |
| Tracking page for shoppers | ✓ | ✓ | ~ (Shiprocket sync) | — |

### 2.4 Customers and marketing

| Feature | Shopify | Wix | First DF platform | DF Store design |
|---|---|---|---|---|
| Create or edit customers, notes, tags | ✓ | ✓ | ✓ | ✓ |
| Customer groups ⚑ | ✓ (segments) | ✓ | ✓ | ✓ |
| Customer segments by behaviour | ✓ | ✓ | — | — |
| Customer history timeline ⚑ | ✓ | ✓ | ✓ | — |
| Marketing consent per customer, import and export | ✓ | ✓ | — | ~ (consent per customer and export; no import) |
| Data requests: export or delete a customer (GDPR, DPDP) | ✓ | ✓ | — | — (required by AGENTS.md) |
| Email marketing campaigns and automations | ✓ | ✓ | — | — (abandoned cart only) |
| SMS / WhatsApp marketing | ~ app | ~ | — | ~ (WhatsApp for abandoned carts, India only) |
| Gift cards: sell, issue, balance, redeem | ✓ | ✓ | — | ✓ product kind with amounts, expiry and cards issued (`CatEditor`, #286); balance and redeem on the storefront (`DF Storefront Prototype`) |
| Store credit | ✓ | ~ | — | — |
| Loyalty or rewards points | ~ app | ✓ | — | — |
| Referral or affiliate programme | ~ app | ~ | — | — |
| Pop-ups, announcement bar, email capture | ✓ | ✓ | ✓ (template announcement bar) | — |

### 2.5 Catalogue and inventory

| Feature | Shopify | Wix | First DF platform | DF Store design |
|---|---|---|---|---|
| Barcode / GTIN field | ✓ | ✓ | ~ | — (the import template has it, the editor doesn't) |
| Bundles and kits | ✓ | ✓ | — | — |
| Subscriptions and recurring products | ✓ | ✓ | — | — |
| Services and bookings | ~ | ✓ | — | — ("Coming later") |
| Product badges: define and assign | ~ | ✓ | — | ✓ (Settings › Catalogue, picked per product) |
| Custom fields / metafields for the merchant | ✓ | ✓ | ✓ | — (Business "custom fields" is only a plan flag) |
| Scheduled publishing | ✓ | ~ | — | — |
| Collection image and SEO, manual sort order | ✓ | ✓ | ✓ | — |
| Price-range automatic collections | ✓ | ✓ | ~ | — ("isn't possible yet") |
| Stock history / movement ledger ⚑ | ✓ | ~ | ✓ (StockMovement) | ✓ |
| Stock transfers between locations | ✓ | — | ~ | — |
| Purchase orders / receiving from suppliers | ✓ | — | — | — |
| Stock per location for every variant | ✓ | ~ | ✓ | — (the 2-location split is for simple products only) |
| Low-stock threshold per product | ~ | ✓ | ✓ | — (it appears on Home, with no setting) |
| Wholesale / B2B price lists, payment terms | ✓ | ~ | ~ (customer-group pricing, PunchOut) | — |

### 2.6 Shipping, payments and tax

| Feature | Shopify | Wix | First DF platform | DF Store design |
|---|---|---|---|---|
| Shipping zones with several methods (Standard, Express) ⚑ | ✓ | ✓ | ✓ (zones and methods; old DF allowed one active) | — (one charge rule; Offers refers to Express) |
| Rate tables by weight or order value | ✓ | ✓ | ~ | — |
| Processing and delivery-time estimates | ✓ | ✓ | — | — |
| Package presets | ✓ | ~ | — | — |
| Payment test mode | ✓ | ✓ | ✓ | — |
| Automatic tax (US nexus, tax service) | ✓ | ✓ | — | — (US tax is hard-coded to Ohio) |
| Tax exemptions for customers | ✓ | ~ | ✓ (group tax rates) | — |
| Tax overrides per product or collection | ✓ | ~ | ✓ | — |

### 2.7 Analytics

| Feature | Shopify | Wix | First DF platform | DF Store design |
|---|---|---|---|---|
| Traffic, sessions and conversion funnel | ✓ | ✓ | — | — ("Visitor sources need analytics — not shown") |
| Custom date range, trends over time | ✓ | ✓ | — | — (7 / 30 / 90 days only) |
| Inventory, discount and customer (LTV, cohort) reports | ✓ | ✓ | — | — |
| Custom report builder | ✓ | ~ | — | ~ (rows and columns) |
| Scheduled or emailed reports | ~ | ~ | — | — |

### 2.8 Sales channels and integrations

| Feature | Shopify | Wix | First DF platform | DF Store design |
|---|---|---|---|---|
| Google Shopping / Merchant Center feed | ✓ | ✓ | — | — |
| Meta and Instagram shop, catalogue sync | ✓ | ✓ | — | — |
| Marketplaces (Amazon, eBay, Flipkart) | ~ app | ✓ | — | — |
| Point of sale (POS) | ✓ | ✓ | — | — |
| App store / integrations directory | ✓ | ✓ | ~ (plugins) | — |
| API keys for the merchant ⚑ | ✓ | ✓ | ✓ (ApiKey) | — (Partner plan only, and not designed) |
| Webhooks | ✓ | ✓ | ~ | — |
| Automation (Shopify Flow style: "when X, do Y") | ✓ | ✓ | — | — |
| Accounting export (Tally, QuickBooks, Xero) | ~ app | ~ | — | — |

### 2.9 Notifications

| Feature | Shopify | Wix | First DF platform | DF Store design |
|---|---|---|---|---|
| Shopper email templates: order confirmation, shipped, refund, password ⚑ | ✓ | ✓ | ✓ (email plugin, branded templates) | — |
| Merchant notifications: new order, low stock ⚑ | ✓ | ✓ | ✓ ("fulfil order" admin email) | — |
| SMS or WhatsApp order updates | ~ | ~ | — | — |
| Sender name and address, email domain authentication | ✓ | ✓ | — | — |

### 2.10 Account, team and security

| Feature | Shopify | Wix | First DF platform | DF Store design |
|---|---|---|---|---|
| My profile: name, email, password, 2FA set-up | ✓ | ✓ | ✓ | ✓ |
| Authenticator app / passkeys | ✓ | ✓ | — | ~ (authenticator app and SMS; no passkeys) |
| Granular or custom staff permissions ⚑ | ✓ | ✓ | ✓ (per-entity permissions) | — (3 fixed roles) |
| Activity / audit log for the merchant ⚑ | ~ | ~ | ✓ (audit-log plugin) | — (per-object histories only) |
| Store time zone, units, order-number format | ✓ | ✓ | ~ | ✓ (Store info) |
| Dark mode | ✓ | — | ✓ | ✓ |

---

## 3. Recommended order

This is a suggested order of importance, from what a real shop needs first.

1. **Needed before anyone can sell properly:**
   - shopper notification emails and templates,
   - legal and policy pages,
   - shipping zones and more than one method,
   - shopper accounts,
   - the cookie and consent banner,
   - a customer data export and delete flow.
2. **Needed in the first months:**
   - draft orders and order editing,
   - redirects,
   - store-level SEO and tracking pixels,
   - content pages and the full-site AI editor,
   - activity log.
3. **Growth features:**
   - gift cards,
   - reviews,
   - email marketing,
   - Google and Meta feeds,
   - traffic analytics,
   - bundles,
   - back-in-stock alerts,
   - API keys and webhooks.
4. **Later or partner tier:**
   - POS,
   - subscriptions,
   - bookings and services,
   - B2B price lists,
   - loyalty,
   - marketplaces,
   - app store,
   - automation.

---

## 4. Own delivery and the delivery app (#837)

Drawn in the prototypes but not in the first release, or linked to something that doesn't exist yet.

| What | Where it's drawn | Why it's missing | Card |
| --- | --- | --- | --- |
| Export a rider's data (a job, download when ready) | `SetRiders` › Manage | Proposed, built on #874 | #874 |
| Erase a rider ("Former delivery partner" in past deliveries and the activity log) | `SetRiders` › Manage | Proposed, built on #874 | #874 |
| iOS build of the delivery app | `DF Delivery App Prototype` (iOS permission wording) | First release is an Android APK only | — |
| "Download the new version" for a build too old for the API | Delivery app › Account blocked › `tooOld` | Proposed in docs/mobile-app/delivery/FIRST-RELEASE.md §1 | — |
| The rider's photo, "offered to N riders", the alert countdown and the last-position map in an order's Delivery panel | `OrderDelivery` | The API answers a photo's asset id and no address, no offer count or timer, and the portal's first release has no map (#846) | — |
| Setting a warehouse's map pin on a map | `SetOwnDelivery` › "Set the map pin" places the pin at the address | The map picker is #815's | #815 |
| Open settings / Call / Navigate from the delivery app | Delivery app (toasts) | Hand-offs to the phone's OS and map apps | — |

## 5. The shop app (#854)

Drawn in `DF Shop App Prototype`, copied from the Storefront prototype, but not in docs/mobile-app/shop/FIRST-RELEASE.md §2.
Each is built only if the release gains it.

| What | Where it's drawn | Why it's missing | Card |
| --- | --- | --- | --- |
| Cancel an order (until it ships) | Order › Cancel order | Orders in the release are list, detail and tracking; the rule is a proposal (storefront ARCHITECTURE §2.1) | — |
| Request a return, with the store's returns window | Order › Request a return | Same proposal; the window is the store's returns policy | — |
| "Need help with this order?" (call or email the store) | Order | Not in the release's Orders row | — |
| "You may also like" on a product | Product | The release lists the store's product sections, not related products | — |
| "Email me new arrivals and offers" | Register, Checkout › Contact | Marketing consent is not in the release's Getting in or Checkout rows | — |
| "Text me offers (SMS)", when the store has SMS on | Checkout › Contact | Same: marketing consent, and its own consent record, are not scoped | — |
| Change email, mobile number or password | Account › Your details | The release's Account is profile, addresses, sign out and delete | — |
| "Billing address is the same as delivery" | Checkout › Payment | The release's Checkout row names one address | — |
