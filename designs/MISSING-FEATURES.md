# DF Store: missing features

This compares the DF Store merchant portal, as designed in this folder, with **Shopify**,
**Wix eCommerce** and the **first DripFunnel platform**, which was built on a third-party
commerce framework and has since been removed from the workspace.

Last updated: 2026-09-29.

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

1. **What the shopper sees.** There is no store-level design, pages or blog, no checkout
   settings, and no customer accounts. The AI designer only edits the hero section.
2. **Order operations after the sale.** There are no returns, no order editing, no draft or
   manual orders, and no shipping labels.
3. **Customers and marketing.** There are no customer groups or segments, no email
   marketing, no reviews, no gift cards and no loyalty.
4. **Notifications.** There is no screen for the order, shipping and account emails that
   shoppers receive.
5. **Extensibility.** There are no API keys, no webhooks, no apps or integrations, and no
   sales channels (Google, Meta, marketplaces).
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
| Shopper accounts: sign-in, order history, addresses ⚑ | ✓ | ✓ | ✓ (template account pages) | — (guests are matched by email) |
| Wishlist | ~ app | ✓ | — | — |
| Product reviews and ratings | ~ app | ✓ | — | — |
| Back-in-stock alerts | ~ app | ✓ | — | — |
| Pre-orders | ~ app | ✓ | — | — (only "Keep selling when out of stock") |
| Product personalisation (custom text or upload on the product) | ~ app | ✓ | ✓ (custom fields) | — |
| Express wallets (Apple Pay, Google Pay, Shop Pay) | ✓ | ✓ | ~ (via Stripe) | — (not mentioned) |
| Local pickup with hours and locations | ✓ | ✓ | — | ~ (pickup exists, with no hours or location choice) |
| Local delivery (radius or postcode, time slots) | ✓ | ✓ | — | — |

### 2.3 Orders and fulfilment

| Feature | Shopify | Wix | First DF platform | DF Store design |
|---|---|---|---|---|
| Draft or manual orders (phone, WhatsApp sales) ⚑ | ✓ | ✓ | ✓ | — |
| Edit an order: items, quantities, address ⚑ | ✓ | ~ | ✓ (OrderModification) | — |
| Returns / RMA: request, approve, receive, restock, exchange | ✓ | ~ | — | — (only a refund reason and a restock tick box) |
| Buy and print shipping labels, book courier pickups ⚑ | ✓ | ✓ | ✓ (Shiprocket fulfilment handler) | — (a toast only) |
| Choose which location fulfils an order | ✓ | ~ | ✓ | — |
| Fraud or risk analysis | ✓ | ~ | — | — (only "Looks like fraud" as a cancel reason) |
| Order tags, date filters, saved views | ✓ | ✓ | ~ | — |
| Bulk actions on orders: ship, print, archive | ✓ | ✓ | ~ | — |
| Resend order emails, send an invoice or payment link | ✓ | ✓ | ~ | — |
| Order number format, archiving | ✓ | ✓ | ✓ (OrderCodeStrategy) | — |
| Tracking page for shoppers | ✓ | ✓ | ~ (Shiprocket sync) | — |

### 2.4 Customers and marketing

| Feature | Shopify | Wix | First DF platform | DF Store design |
|---|---|---|---|---|
| Create or edit customers, notes, tags | ✓ | ✓ | ✓ | — (a read-only list built from orders) |
| Customer groups ⚑ | ✓ (segments) | ✓ | ✓ | — (Offers refers to groups, but no screen manages them) |
| Customer segments by behaviour | ✓ | ✓ | — | — |
| Customer history timeline ⚑ | ✓ | ✓ | ✓ | — |
| Marketing consent per customer, import and export | ✓ | ✓ | — | — |
| Data requests: export or delete a customer (GDPR, DPDP) | ✓ | ✓ | — | — (required by AGENTS.md) |
| Email marketing campaigns and automations | ✓ | ✓ | — | — (abandoned cart only) |
| SMS / WhatsApp marketing | ~ app | ~ | — | ~ (WhatsApp for abandoned carts, India only) |
| Gift cards: sell, issue, balance, redeem | ✓ | ✓ | — | — (only a seeded "Gift card" product) |
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
| Product badges: define and assign | ~ | ✓ | — | — (the toggle exists, there is nothing to configure) |
| Custom fields / metafields for the merchant | ✓ | ✓ | ✓ | — (Business "custom fields" is only a plan flag) |
| Scheduled publishing | ✓ | ~ | — | — |
| Collection image and SEO, manual sort order | ✓ | ✓ | ✓ | — |
| Price-range automatic collections | ✓ | ✓ | ~ | — ("isn't possible yet") |
| Stock history / movement ledger ⚑ | ✓ | ~ | ✓ (StockMovement) | — (the adjustment reason promises a history that doesn't exist) |
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
| Custom report builder | ✓ | ~ | — | — (a toast only) |
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
| My profile: name, email, password, 2FA set-up | ✓ | ✓ | ✓ | — (a toast only) |
| Authenticator app / passkeys | ✓ | ✓ | — | — (SMS code only) |
| Granular or custom staff permissions ⚑ | ✓ | ✓ | ✓ (per-entity permissions) | — (3 fixed roles) |
| Activity / audit log for the merchant ⚑ | ~ | ~ | ✓ (audit-log plugin) | — (per-object histories only) |
| Store time zone, units, order-number format | ✓ | ✓ | ~ | — (Offers depends on a time zone that doesn't exist) |
| Dark mode | ✓ | — | ✓ | — |

---

## 3. Recommended order

This is a suggested order of importance, from what a real shop needs first.

1. **Needed before anyone can sell properly:**
   - shopper notification emails and templates,
   - legal and policy pages,
   - shipping zones and more than one method,
   - shopper accounts,
   - the cookie and consent banner,
   - a customer data export and delete flow,
   - store time zone,
   - My profile and 2FA.
2. **Needed in the first months:**
   - returns,
   - draft orders and order editing,
   - shipping labels (Shiprocket),
   - customer groups and customer create/edit,
   - stock history,
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
