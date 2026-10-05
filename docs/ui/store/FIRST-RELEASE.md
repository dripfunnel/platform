# FIRST-RELEASE.md: the merchant portal

The first version of the merchant portal (`apps/ui/store`, each partner's portal host) and of
the storefront's Shop API behind it: **everything the Store prototype draws, plus the parts the
docs design and the prototype doesn't draw yet** (decided with Gaurav on 2026-10-04, on #184;
§1 records each answer). The prototype is `designs/DF Store Prototype.dc.html` with its child
screens (`designs/design.md` §1 maps them).

**Status: specification, not built.** The Store API and the Shop API answer `health` only, and
`apps/ui/store` is a sign-in title and a Home link. The strands that build this release are
§20; build order is not scope.

Last updated: 2026-10-05.

Rules that still apply in full: [README.md](README.md) (what the portal is, roles, never-do
list), [../README.md](../README.md) (how every SPA is built),
[../../api/ACCESS.md](../../api/ACCESS.md) (people, sessions, roles, vendors, support access),
[../../api/SAAS.md](../../api/SAAS.md) (sign-up, provisioning, store states, plans, billing,
domains, publishing), [../../api/LOGGING.md](../../api/LOGGING.md) §6 (what each role sees of
the activity log). The design depth stays in [DESIGN-BRIEF.md](DESIGN-BRIEF.md) (flows 1–82),
[CATALOG-DESIGN.md](CATALOG-DESIGN.md) and [OFFERS-DESIGN.md](OFFERS-DESIGN.md); this document
says which of it ships and cites them rather than restating them.

**The prototype decides behaviour; this document decides scope and rules** (docs/README.md §3).
§18 lists where they differ. Everything not listed there (wording, step order, each dialog's
consequence sentence, statuses and their colours, region wording from the prototype's `REG()`
packs) is taken from the prototype as drawn.

---

## 1. Scope decisions (2026-10-04, #184)

| Question (where it was open) | Answer |
|---|---|
| Baseline | **"Sell one thing"**: sign-up and provisioning in the partner's look, sign-in with 2-factor and My profile, Home, Products and the editor (options, versions, photos, stock with history), Collections, Orders with shipping, returns and refunds, Customers, Storefront (describe, preview, publish, own domain), Settings, Billing |
| Offers (OFFERS-DESIGN) | **In**, the whole model; the storefront and checkout honour them through the Shop API |
| Suppliers and approval (CATALOG-DESIGN L, ACCESS §7) | **In**: Business plan, the four tiers, shipping modes, supplier teams, approval |
| Import and export (CATALOG-DESIGN K) | **In**: CSV and Shopify import, exports as jobs |
| Reports | **In**, with the custom report builder |
| Markets, currencies and languages (CATALOG-DESIGN N, O, Settings › Markets) | **In** |
| Abandoned carts | **In**; reminder email through **Amazon SES** |
| A+ content (CATALOG-DESIGN Q) | **In** |
| Product kinds (PLATFORM-PROMPT §10) | **Physical, digital, services and gift cards**, drawn in `CatEditor` (SUI 1, #286) |
| Regions and payment providers (PLATFORM-PROMPT §10) | **India and the US.** Stripe (US) and Razorpay (India), plus **PayPal** (US), **Cashfree and PhonePe** (India), **cash on delivery** (India) and **bank transfer** (both) |
| US sales tax (PLATFORM-PROMPT §5.4, §10) | **Stripe Tax**, on the merchant's own Stripe account through Connect (decided 2026-10-05); India's GST from the store's own rates (CATALOG-DESIGN T) |
| Couriers | **Shiprocket** (India); the US carriers (USPS, UPS, FedEx) **through one aggregator** (**EasyPost**, decided 2026-10-05 on #337) |
| API keys, webhooks, apps, own storefront (PLATFORM-PROMPT §5.5, §10; DESIGN-BRIEF 75–77) | **All in**: API keys, webhooks and apps drawn in `SetDev`, own storefront in Storefront › Design (SUI 1, #286) |
| Settings › Support access, the store activity log, Settings › Customer accounts | **In**: drawn in `SetAccess` and `StoreActivity` (SUI 1, #286), to ACCESS §8, LOGGING §6 and ACCESS §2.1 |
| Staff export (README §3) | **Yes**: products, orders and customers |
| A read-only Offers list for Staff (README §3) | **Yes** (the prototype draws it) |
| Supplier import and export (README §3) | **Own only**: export for every tier, import for the catalogue tiers |
| Manager and the whole store log (README §3, LOGGING §6) | **Yes**, as the Owner sees it |

**Decided 2026-10-05 with Gaurav (#284), planning the build:**

| Question | Answer |
|---|---|
| The shopper storefront's pages (the prototype draws none) | **Designed in the prototype first** (card D1), then built as the baseline theme the AI restyles |
| Hosting (PLATFORM-PROMPT §5.6, §10) | **A Cloudflare Pages project per store**; the project limit per account is checked and raised (INF 0) |
| Where the AI designer runs | **GitHub Actions**, like the storefront builds |
| Merchant Stripe (THIRD-PARTY-ACCESS §3.1) | **Stripe Connect OAuth**, no pasted keys; **Stripe Tax runs on the merchant's own account** |
| SMS | **In the first release**: MSG91 (India) and Twilio (US), each the partner's own account; 2-factor by app or SMS; shoppers sign in by email or mobile code |
| The preview storefront | **Opens by a signed link** from the portal, never indexed; checkout in each provider's **test mode** |
| Data from the first platform | **None**: a fresh start |
| Cash on delivery and bank transfer | **Reserve stock when placed**; a bank transfer unpaid after **3 days** is cancelled by the system |
| `orders.mark_paid`, `offers.export` | **Owner and Manager** |
| Past due | **The storefront keeps selling**, the portal is read-only; **suspended after 14 days** unpaid |
| Build order | **Straight through**, area by area, as §20's build order lists |

**Decided 2026-10-05 with Gaurav (#337), the cards' own questions** (each recorded in the
document it belongs to, and in the card's "Decided" section):

| Question | Answer |
|---|---|
| Content pages and blog | **In**: about, FAQ, contact, lookbook and a blog, managed in the portal (SAPI 24, SUI 17) |
| WhatsApp cart reminders | **In**, in India, through MSG91 and the partner's WhatsApp Business account |
| SMS | Also sends shoppers' order updates (confirmed, shipped, delivered) |
| Gift cards | The merchant sets the expiry: at least 1 year in India, 5 years in the US |
| Services | Sold like a product with no shipping; an optional duration and location, no booking |
| Apps | Private apps only (an API grant with scopes), shown as links to their own site |
| US aggregator | **EasyPost**; a store may offer several shipping methods at once |
| A US store without Stripe | Enters its own state tax rates |
| "Under two minutes" | The portal works and the preview opens; the live build may finish later |
| Suppliers while the store is past due | Keep working, and aren't told about the store's billing |
| Catalogue limits | 3 options and 100 versions; product video, A+ reusable blocks, custom fields ship |
| Offers | Per-unit fixed discounts, case-insensitive codes, no draft state, combines with nothing by default (OFFERS-DESIGN §9) |
| Catalogue details | CATALOG-DESIGN §9: English-only portal, en-IN/en-US/hi-IN, no right-to-left at launch, the refused categories |

Decided on the way, from the prototype and the docs it follows (each recorded where it lives):
the Store API is **GraphQL**, like the Platform and Admin APIs (§19); **stock is reserved when an
order is paid** — "reserved" is sold and not yet shipped (PLATFORM-PROMPT §5.4) — and checkout
re-checks availability at payment; cash-on-delivery and bank-transfer orders reserve when placed,
released on cancellation or after 3 days unpaid for a transfer (decided 2026-10-05); a Manager may change stock but not warehouses, and never
presses "Publish now" (the prototype gives Managers neither Settings nor a working Storefront).

---

## 2. Principles

- **One store at a time, in the partner's look.** Every screen is scoped to the acting store,
  which is always visible; the look, words and sender come from the hostname before anything
  renders (README §6). No DripFunnel name appears unless the partner's "Powered by" rule shows
  it (§18 lists the prototype's exceptions).
- **The API decides, the screen displays.** Prices, tax, discounts, totals, stock, plan limits,
  permissions and every "ready to sell" check come from the Store API. A component computes
  nothing a shopper or a supplier could be charged or shown.
- **Never leak across owners.** A supplier sees only its own rows: counts, search, filters,
  empty states, exports and errors included (README §7). A supplier opening a URL that isn't
  theirs sees "not found".
- **Every action states its consequence first**, as the prototype words it, and every write is
  audited with the actor, store, target and reason (LOGGING.md).
- **Locked is never hidden for the Owner.** A plan gate names the plan that unlocks it and opens
  the upgrade prompt; a Manager sees "Ask your store owner"; a supplier never sees plans
  (SAAS §6.2).
- **Designed states on every screen**: empty (a new store is empty everywhere), loading, error,
  permission denied, read-only (past due), offline, and the banners in §3.3.
- **Phone first**: every screen works at 360 px.

---

## 3. Shell: menu, header, banners

### 3.1 Menu per role

From the prototype's shell (`design.md` §3), which this release keeps:

| Role | Rows |
|---|---|
| **Owner** | Home · Orders · Customers · Offers · Abandoned carts · Reports · *Catalogue:* Products, Collections · *Your shop:* Storefront · *Admin:* Settings, Billing |
| **Manager** | Home · Orders · Customers · Offers · Abandoned carts · Reports · *Catalogue:* Products, Collections · *Your shop:* Storefront (view only) |
| **Staff** | Home · Orders · Customers · Offers (view only) · Abandoned carts (view only) · *Catalogue:* Products (view only), Collections (view only) |
| **Supplier, Stock only** | Your products (stock only) |
| **Supplier, Products and stock** | Your products |
| **Supplier, Products, stock and their orders** | Your products · To ship · Your sales |
| **Supplier admin** (any tier) | + Your team |

- **Badges** (work waiting): Orders = orders to ship; Products = supplier products waiting for
  approval (only when approval is on). Nothing else carries a badge.
- **Approval lives in Products** (the "Waiting for approval" chip and the review panel), and
  **Suppliers, People and Warehouses are Settings tabs**; README §4's separate "To approve" and
  "Suppliers" rows are superseded (§18).
- Rows a role can't use are **absent**; a control a role can't use inside a screen is shown
  **disabled with the reason** ("Only the store owner can …"), never hidden (../README.md §5).
- "Your sales" and "Your team" are drawn in `VendorViews` (#286); the prototype's catalogue supplier is a Supplier admin.
- **Built on #291** (`apps/ui/store/src/nav.ts`): the rows above per role and tier, the group
  headings, Billing's trial note, and every row leading to a screen or its placeholder.
  **Built on #298**: Products is a screen (§11), and the shell reads `navBadges` for its badge,
  the products waiting for approval; a failed count draws no badge. Orders' badge stays 0 until
  SAPI 11 counts the orders to ship.

### 3.2 Header

The partner's logo; the **store switcher** (current store's name and initial; "Switch store"
lists the person's stores under this partner, never another partner's); Help; the person's name
and role with a menu holding **My profile**, **Switch store** and **Sign out** ("Signs you out of
every store on this device"). On a phone the menu is a drawer behind a button.

### 3.3 Banners and states the shell owns

| What | When | Behaviour |
|---|---|---|
| **Trial** | Store in Trial | "Free trial · N days left. You have everything in {plan}. No card needed." → Choose a plan (Owner) |
| **Trial ends tomorrow / ended** | Day 9 · after `trial_ends_at` | Ended drops to the free plan and pauses what is over its limits → **Choose what to keep** (`PortalKeep`, SAAS §6.2) |
| **Past due** | Billing webhook | **Read-only everywhere**: every save disabled with the reason, sign-in and reads keep working, the Owner gets "Pay the overdue invoice" (SAAS §4.2) |
| **Suspended / cancelled** | SAAS §4.2 | Suspended: sign-in shows why and **the partner's** support contact. Cancelled: read-only until the period ends, then export only |
| **Provisioning** | Steps 4–8 of SAAS §5 still running | "Setting up your storefront…" with the real step; Storefront and Settings open when done |
| **Import running** | An import job | A banner with progress on every screen; leaving the page never stops it |
| **Partner support session** | ACCESS §8 | Everyone signed in sees "{Partner} support ({name}) is viewing your store. Read-only. Ends in 28 min." and, when support asks to change something, **Allow / Deny** (an Owner or a Manager, ACCESS §8) — drawn in the shell (#286, control *Partner support*) |
| **Staff impersonation** | ACCESS §8.1 | "Support ({name}) is signed in as {person}. Ends in 28 min." — always "Support", never DripFunnel (`ImpBanner`) |
| **Offline** | No network | Reading continues; saves refuse and keep what was typed |
| **Session expired** | ACCESS §4 | Sign in again and come back to the same page |
| **Load error · not found · denied** | The API failed · a bad link · a role without access | The shell's generic states, each with its own sentence; a supplier's foreign URL is "not found" |
| **Edit conflict** | Someone else saved first | "Review their changes" or "Load their version"; nothing is overwritten silently |
| **Environment marker** | Non-production hosts | The shared Dev, Feature or Local strip (`environmentFor`, #65); nothing in production |

**Built on #291**: the header (§3.2) and the banners for trial and its last day, past due,
suspended, cancelled, provisioning, partner support and offline, in the prototype's words. The
import banner waits for `storeState`'s import job (SAPI 16); support's Allow / Deny for SAPI 21.

---

## 4. Getting in (DESIGN-BRIEF A, flows 1–7, 13)

- **Sign-up** (`PortalAuth` `su1`–`su4`, SAAS §4.1, §5): name, email, password (10 characters or
  more, ACCESS §4) → email code → store name, web address and country, which sets the currency (languages are set later in Settings, decided on #290) → phone
  code → a real progress screen driven by the provisioning job. Open only while the partner is
  Live. Responds identically whether or not the email has an account.
- **Store created by the partner**: the Owner gets an invitation, never a password.
- **Sign-in**: email and password, then the second factor **when the person has it on**. An
  Owner without it is sent to turn it on before the store opens (the `enrol` view, #183); every
  other role may skip it. Five wrong passwords or codes (one count) pause sign-in for 15 minutes and email the account's own address, the prototype's "we've emailed the account owner" (built on #290).
  Backup codes work once each. Google sign-in authenticates an existing account only (ACCESS §2).
- **Choose a store / switch store**: the portal never picks; a person who belongs to no store is
  refused, not shown an empty portal. "Create another store" starts sign-up step 3.
- **Reset password**: a link valid for 30 minutes; signs out everywhere else.
- **Invitations**: a new person sets a name and password; an existing account joins without one;
  an expired link (7 days) says so and asks the inviter for a new one.
- **Built on #292, part 1** (`apps/ui/store/src/features/auth/`): sign-in with its code, backup-code
  and SMS set-up steps, the lock, reset, sign-up `su1`–`su4` and its building view, invitations
  (`/accept-invite`, `/join`), the confirm-email link and the chooser in the same frame, each view
  under `?state=` (`authStates.ts`). Not built, for want of an API: Google sign-in; setting up an
  authenticator app at sign-in (SMS only); "Create another store", since sign-up starts only for a
  new account; and the web address's suffix, which needs the partner's storefront domain. Country
  is asked on the store step, where the API takes it.
- **Built on #292, part 2** (`apps/ui/store/src/features/profile/`): My profile as `PortalProfile`
  draws it, plus "Your activity" (own entries, a page at a time, in StoreActivity's rows). The API
  asks for the password where the prototype doesn't: a new email, every two-step start or switch,
  and turning it off. The sign-in number is read-only while SMS is the method, because #352 changes
  it only by switching method; texting a new number before saving it is still open.
- **My profile** (`PortalProfile`): name, email (changed through a link to the new address),
  mobile, password (signs out other devices), two-step sign-in (authenticator app or SMS; ten
  backup codes shown once; an Owner can switch method but never turn it off), appearance (light
  or dark), where you're signed in with "Sign out everywhere else", and **My activity** (own
  entries, LOGGING §6).

---

## 5. Home (`PortalHome`)

"Needs you" first — orders to pack and ship, supplier products waiting for approval, products low
on stock, team requests for the Owner — each linking to its filtered list; then "How the shop is
doing" (sales yesterday, orders today, average order over 7 days, returning customers) and the
latest orders. Staff see no money. A new store sees the getting-started checklist and the locale
check. Every figure is the API's (`home`, §19).

---

## 6. Orders (`PortalOrders`, DESIGN-BRIEF F, flows 36–41, 70–71)

- **List**: chips All · To ship · Partly shipped · Shipped · Cancelled & refunded · Payment
  pending, each with its count; rows show number, time in the store's zone, customer and city,
  items, status, total and payment state. Export (a job). A supplier sees only orders holding its
  lines, with **no order total**.
- **Detail**: the lines grouped by who packs them ("You pack these", "{Supplier} packs these"),
  the history with team notes, payment (items, delivery, tax, total, how it was paid), the
  customer and delivery address, the market. A supplier sees only its part and, by its shipping
  mode, nothing of the customer (`to-store`) or name and delivery address only (`to-shopper`,
  ACCESS §7.3).
- **Ship items**: per line and quantity, from a named warehouse; **book a label** through the
  connected courier or **enter tracking by hand**; partial shipping is normal. Packing slip,
  invoice and label print as documents.
- **Returns**: start (lines, quantities, reason, a return label) → On its way back → Received →
  Refunded; **Cancel return** while on its way back (#183).
- **Refunds**: per line, grouped by who refunds them; each supplier refunds its own lines, the
  store may override and the amount is recorded on the supplier ledger, settled outside
  DripFunnel (ACCESS §7.3, PLATFORM-PROMPT §5.4); restock really restocks with the reason
  "Returned by a shopper".
- **Cancel** an unshipped order, with a reason; **mark as paid** for cash on delivery and bank
  transfer (the order waits in Payment pending until then): Owner and Manager only
  (`orders.mark_paid`, ACCESS §5.1), audited with the actor. A transfer released
  for staying unpaid is cancelled by the system and logged as such (LOGGING §3).

## 7. Customers (`PortalOrders` › Customers, flows 40, 72)

List (name, city and tags, spent, orders) with search, **groups** as chips; detail with contact,
addresses, groups, tags, a team-only note, **marketing consent** (only the shopper opts in; the
team may record that they asked to stop) and their orders. Add a customer (order emails only),
edit, manage groups (showing where a group is used before it changes), **export** (Owner,
Manager and Staff, §1). "Suppliers never see this list."

## 8. Offers (`Offers`, `OfferEditor`, OFFERS-DESIGN A–V)

All of OFFERS-DESIGN ships: Live · Scheduled · Off · Ended tabs, type and code filters, uses and
discount given, the stacking warning, "Check a code a customer gives you"; the guided editor
(type → reward → trigger → requirement → audience → schedule → stacking) and its recipes; codes,
bulk single-use codes and QR downloads; pause, end, duplicate, delete. Staff see the list
read-only. Plan gates as OFFERS-DESIGN U and the Pricing page draw them.

## 9. Abandoned carts (`Carts`)

Carts tab: checkouts left, reminders sent, recovered and recovered sales for the last 14 days, and
each cart's shopper, items, value, where they left, and its reminder state. Reminders tab: up to
three reminders, each with its delay, an optional single-use discount, subject and message;
minimum cart value, skip when everything is out of stock, quiet hours in the shopper's time, once
a week per shopper, stop on any purchase (always on), an unsubscribe link in every email. Sent by
**email through Amazon SES** from the partner's sender domain (SAAS §3.6). Staff view only.

## 10. Reports (`PortalReports`)

7, 30 or 90 days against the period before: takings (sales, refunds, net), what sold, where it
came from (by market), tax collected (by state in the US, by rate in India), suppliers (units,
never a supplier's own totals shown to another), and the **custom report builder** (rows and
columns). Every panel exports. Locked below Growth. Owner and Manager.

---

## 11. Products (`CatList`, `CatEditor`, CATALOG-DESIGN A–G, L, N–T)

- **List**: chips All · Visible · Hidden · Waiting for approval · Sent back · Low stock ·
  Missing info; supplier filter and sort; columns product (versions), status, price, stock,
  supplier, ready to sell; quick edit of price and stock; bulk select (hide, show, add to
  collection, export, delete). "{N} supplier products are waiting for your approval" with
  **Review** (approve, or send back with a reason the supplier sees). A removed supplier's
  products say "From {supplier}, removed" (#183).
- **Editor**: what is sold (**a physical item · a download · a service · a gift card**, §1),
  photos (alt text, main photo per version), name and description (AI writing within the plan's
  allowance), **choices and versions** (up to three kinds, versions not made, price and stock for
  all), **stock per warehouse with reserved** ("sold, not shipped yet") and **stock history**
  (every change a movement with its reason, who, where and the result; reasons as #183 fixed
  them), shipping weight and box, collections and filters, tax category, size chart,
  specifications and highlights, **A+ content**, legal and safety (never a paid feature), search
  listing, more options (product code, barcode, web address, tracking, age check, where it
  ships), visibility, badges, **ready to sell per market** and the shopper preview. Languages
  and currencies appear only when Settings has more than one (CATALOG-DESIGN N, O).
- **Shared records say so**: "This is {Supplier}'s product. They will see your changes." /
  "Your store owner can also edit this product."
- **Approval**: price, title or photo changes to an approved product wait again; other edits go
  live (ACCESS §7.2).
- **Built on #298** (`apps/ui/store/src/features/products`, `productEditor`, `productStory`, `warehouses`): the
  list with quick edit and approval, the editor (choices and versions, photos, stock with history, the
  listing sections, translations, prices in other currencies and per market), A+ content at
  `/products/$productId/story`, and a supplier's Warehouses tab at `/products/warehouses` (#337). Still to
  come with their own cards: download files, service details and gift card amounts, a fixed price per
  market, product video upload, and Import and Export (§13).

## 12. Collections, Filters, Menus, Size charts (`CatCollections`, `CatSizeCharts`)

Collections (automatic by rules, or hand-picked with a manual order; visible or hidden for
offers; seasonal suggestions per market), Filters (shopper-facing values with counts, merge
look-alikes, internal tags only the team sees), Menus (one main menu, nesting one level, desktop
and phone previews), Size charts (sizes × measurements, units, other size systems, fit note).
Staff view only.

## 13. Import and export (`CatImport`, CATALOG-DESIGN K)

Choose → Check → Import → Done: a CSV or Excel file, a Shopify export, or **Connect Shopify**;
nothing changes until confirmed; an error file for rejected rows; the run continues after
leaving the page, with the shell's banner. Template download. Exports (all, hidden only,
filtered) are jobs with a download. Owner and Manager import; **Staff export**; suppliers import
(catalogue tiers) and export **their own** (§1). **A supplier's export is its screen, as a file**:
seller-scoped through the same serializer, so it holds only its own rows, never an order total,
and customer fields by shipping mode — none for `to-store`, name and delivery address for
`to-shopper` (ACCESS §7.3). Every card that builds an export carries the isolation-matrix test for it (caller kind × store ×
seller, ACCESS §11.1): SAPI 11, 13, 14, 16, 18, 19 and 21, as each §20 row says; customers are never exported to a supplier.
**A supplier's import writes only its own rows**: every imported row's `seller_id` comes from the
session's `SellerScope`, never from a column in the file or Shopify's data; a row naming another
supplier's or the store's product (by id or SKU) is rejected into the error file; and while
approval is on, its new and changed products wait for approval exactly as if edited by hand
(ACCESS §7.2).

## 14. Storefront (`PortalStorefront`, DESIGN-BRIEF H, SAAS §9)

Describe a change → the AI makes it on a preview → approve → publish, never straight to live;
the live version, this month's AI tokens and build minutes, **history with "Go back to this"**
(which never uses build minutes), "View live site". Catalogue **Publish now** and the publishing
status (storefront ARCHITECTURE §4.2). **Content pages and the blog** (about, FAQ, contact,
lookbook; SUI 17 on SAPI 24) (decided 2026-10-05 on #337). **Choose the storefront: AI or own** (flow 75; drawn on Storefront › Design, #286; sign-up
starts every store on AI, decided on #286): a store on its own storefront gets its public store key and allowed origins and
skips the AI designer. Owner; Manager view only.

---

## 15. Settings (Owner only)

| Tab | What ships |
|---|---|
| **Store info** (`SetStore`) | Name, legal name, description, contact, address, tax id, **time zone**, **units**, **order-number format**, logo; **currencies** (auto-converted or typed) and **languages**; the web address and **Connect your own domain** (record → we check → certificate → live, with failure; SAAS §8) |
| **People** (`SetTeam`) | Everyone, staff and supplier users, with invitations waiting; invite, resend, revoke, change role, remove from this store (never the account); the last Owner can't be demoted |
| **Supplier** (`SetTeam`) | Suppliers with users, products, access level and status; invite (first user's email), change access level and shipping mode, suspend (hide or keep selling), remove (hidden, kept, marked); the approval switch |
| **Payment setup** (`SetOps`) | Gateways by region: **Stripe, PayPal** (US); **Razorpay, Cashfree, PhonePe, cash on delivery** (India); **bank transfer** (both); connect with the merchant's own credentials (encrypted, never shown again), disconnect, which are live |
| **Shipping** (`SetOps`) | What the shopper pays (courier's live rate, flat rate, collect in person with hours), when delivery is free, delivery partners (**Shiprocket**; USPS, UPS, FedEx through the aggregator) with pricing, standby, test and manage, where you deliver (everywhere, or uploaded postcodes) |
| **Warehouse** (`SetOps`) | Locations with units, the default for new products, add, edit, delete; suppliers' locations in their own labelled group, read-only |
| **Tax setup** (`SetOps`) | Prices include or exclude tax; tax categories and their rates (India) or **Stripe Tax** by state (US; on the merchant's own Stripe account); invoice settings |
| **Markets** (`SetMarkets`) | Markets with countries, currency, language, price adjustment, fixed prices per product (Business), web address (main or path; one domain per store, never a market's own (decided 2026-10-05 on #337)), delivery charge, duties (Business), "everywhere else" |
| **Catalogue** (`CatSettings`) | What you sell, product page sections by plan, badges (define; assign per product), legal details used on every product, what you're using against the plan |
| **Customer accounts** | How shoppers sign in: email, mobile or both (ACCESS §2.1) — drawn in `SetAccess` (#286) |
| **Developers** | Public store key, allowed origins, API keys (scopes, supplier binding, expiry, rotate, revoke, last used), webhooks (endpoints, events, delivery log, replay, auto-disable) — drawn in `SetDev` (#286) |
| **Apps** | Install with scope consent, configure (on the app's own site, opened from here), uninstall saying what stops — drawn in `SetDev` (#286) |
| **Support access** | "Allow {partner} support to view my store: On / Off" (on by default), the support access log, and that DripFunnel staff can still sign in as a user (USERS-AND-DOMAINS §4.1–4.2) — drawn in `SetAccess` (#286) |
| **Activity log** | The whole store's log, shoppers included, filter by person, every name a link, export for the **Owner only** (LOGGING §6–7, ACCESS §5.1 `activity.export`). A Manager, who has no Settings, reads the same log as **Store activity** in the user menu, without the export — drawn in `StoreActivity` (#286) |

## 16. Billing (`PortalBilling`, Owner only)

The partner's plans with monthly or yearly prices and what each includes (from the Platform
API's plan catalogue, never hard-coded), switch now with **proration** or at period end, the
dates from the billing period; this month's usage (bandwidth, products, staff, AI tokens); buy
extra bandwidth; storefront setup by the partner's team where the plan offers it; the **card
that pays for the plan in a hosted field**, never the shoppers' payments; details on invoices;
invoices with PDF and export; **Close my store** with "Download my data first" (products, orders,
customers) and "Move to Free instead". Who charges is the partner or DripFunnel on its behalf
(SAAS §7.1) and the screen says which.

## 17. Supplier views

**Your products** (only theirs, with counts and empty states; stock only for the Stock-only tier;
add and edit for the catalogue tiers, waiting for approval when it's on; export; import for the
catalogue tiers), **To ship** (their lines by shipping mode), **Your sales** (own lines, no
totals) and **Your team** (Supplier admin: invite, change admin or member, resend, remove, never
the last admin; DATA-MODEL §4.2). Their own warehouses and stock. Never offers, customers beyond
§6, plans, other suppliers or the store's totals.

---

## 18. Prototype differences

Where the prototype and the docs disagree. **Rule** differences: the doc wins, because a rule
decided in a document outranks a prototype (docs/README.md §3). **Behaviour** differences: listed
for SUI 1 to resolve in the prototype, or asked; none is picked silently. **SUI 1 (#286, 2026-10-05) brought the
prototype in line with every row**: white-label billing without the partner tier, the hosted card box, the supplier
ledger wording, the identical sign-up answer, Staff exports, and the screens that weren't drawn.

| The prototype | This release | Kind |
|---|---|---|
| Billing says "What you pay DripFunnel", lists DripFunnel's plans and offers a "Partner · Talk to us" tier; Payment setup says "The card that pays for DripFunnel" | The **partner's** plans and name, white label (README §6, SAAS §7.1); no partnership offer inside a merchant portal | rule |
| Billing's card form | A hosted payment field; a card number never touches DripFunnel | rule |
| The refund override says "comes off their next payout" | Recorded on the supplier ledger and settled outside (DESIGN-BRIEF 71; #183 left the wording to this card) | rule |
| Sign-up says "There's already an account for this email" | Identical response whether or not the email has an account (ACCESS §2, README §7) | rule |
| Sign-in counts down the tries left and shows the paused screen after five wrong passwords | Every wrong password gets the same "don't match" answer; only the right password, during the pause, is told it is paused (ACCESS §2: never reveal an account) | rule |
| README §4's "To approve" and "Suppliers" menu rows | The prototype's: approval in Products, suppliers in Settings (§3.1) | behaviour, decided here |
| Customers export is offered to Owner and Manager | Staff too (§1) | behaviour, decided |
| ~~No "Your sales", "Your team", Customer accounts, Developers, Apps, Support access, store activity log, services, gift cards or digital file upload~~ | Drawn by SUI 1 (#286) | resolved |
| Abandoned-cart reminders by WhatsApp in India (MISSING-FEATURES) | WhatsApp reminders ship with email, through MSG91 (decided 2026-10-05 on #337) | scope, decided |
| Payment setup offers PayPal and Klarna for Germany | The launch regions are India and the US (§1); the DE region stays a prototype control | scope |
| The sandbox's stock-reason values | The list #183 settled is what DATA-MODEL stores | behaviour, decided |

---

## 19. What the Store API and the Shop API need

Both are **GraphQL** (decided here, as for the Platform API on #155), served by the one Worker:
the Store API at `/api` on the portal host, the Shop API at `/shop-api` on every storefront host
(ARCHITECTURE §2). Names are *(proposed)*.

**Every Store API call** carries the session cookie and the acting store; the server builds the
`TenantContext` (ACCESS §3) from them, checks the membership, and scopes every read and write
through `db/scoped`, supplier rows through `SellerScope`. A store or seller id in an argument is
never authority. **Lists are cursor-paged** with `after` and `before`, a maximum page size of
50, **no totals** (as ui/admin/FIRST-RELEASE §12 decided); counts on chips come from their own
query. **Refusals are stable codes** with their facts, worded by the portal (built on #288: `UNAUTHENTICATED`,
`FORBIDDEN` — a store the session doesn't hold is refused and logged, never "not found" — `STORE_REQUIRED`,
`SUPPLIER_REQUIRED`, `STORE_SUSPENDED`, `READ_ONLY`, `INVALID_CURSOR`, and `PLAN_LIMIT` with `key`, `limit`
and `unlockedBy`, the partner's cheapest live plan that allows it); every screen renders
`?state=loading|error|denied|readOnly|offline` from the harness (../README.md §6).

| Area | Queries | Mutations |
|---|---|---|
| Brand and sign-in (`/api/auth/*`) | `brand` (public: look, words, sender, by hostname) | `signUpStart`, `verifySignupEmail`, `signUpStore`, `verifySignupPhone`, `signIn`, `verifySecondFactor`, `useBackupCode`, `enrolSecondFactor`, `requestPasswordReset`, `resetPassword`, `acceptInvitation`, `signOut` |
| Shell | `me` (person, role, tier, store, plan facts, permissions), `myStores`, `navBadges`, `storeState` (trial, past due, suspended, provisioning, import job, support session) | `switchStore` |
| | *Built on #293 (part 1): `products(filter, search, supplier)`, `productCounts`, `product(id)`, `saveProduct` (create, or update at the revision read; simple products as one version, up to 3 options and 100 versions, a price in the pricing currency required), `duplicateProduct` (a hidden copy, no product codes), `deleteProducts` (soft), `updateProducts(ids, patch: { visible })` (merchant side); amounts are minor units as strings with their currency. Part 2: photos (up to 20, in order, each for the product or one version) and a video (an upload or an https link) on `saveProduct`, the Missing info chip (no photo or no description), and `uploadAsset` as `POST /api/assets` with the raw file, read back at `GET /api/assets/{id}` in the caller's scope. That is an upload through the Worker, as the partner's brand files are, not a signed R2 URL, which needs S3 keys the local setup doesn't have. JPEG, PNG and WebP up to 20 MB, MP4 and WebM up to 30 MB, the type read from the bytes. The Low stock chip comes with stock. Part 3: `facets` (paged in the filters' order, each value with its product count in the caller's scope; a supplier reads them to tag its own products, the one structure query it reaches; up to 200 filters a store), `collections`, `collection(id)`, `collectionProducts(id)` (its products a page at a time in its order), `menu`, and `saveFacet`, `deleteFacet`, `mergeFacetValues`, `saveCollection` (hand-picked in order, or automatic by any or all of: a filter value, name contains, a product, a version, a price range; optionally only inside its parent), `deleteCollection`, `saveMenu` (the main menu, one level of nesting, links to a collection, a shop page or an https address), and `filterValues` on `saveProduct`. Part 4: `catalogueSettings` (each section's switch and, for the merchant side, whether the plan has it; a supplier hears only whether a section is there, P11), `saveCatalogueSettings` (Owner; a plan section switches on only when the plan has it), `saveBadge`, `deleteBadge`, `sizeCharts` (paged, without the rows), `sizeChart(id)`, `saveSizeChart`, `deleteSizeChart` (answering how many products lost it; a supplier makes and keeps its own, R13; `size_charts` on the plan), and `listing` and `sizeChartId` on `saveProduct` (specifications, highlights, FAQs, related products, manual badges, age check and hazard flags, legal fields per region, where it sells), each section left out kept as it is. Part 5: A+ content, `productStory(productId)` (the draft, its status `draft`, `live` or `changed`, and its revision; readable after a downgrade, Q12), `saveProductStory` (a draft saved unfinished, up to 10 modules of the CatAPlus kinds), `publishProductStory` (refused as `STORY_INCOMPLETE` with each module and field still to fill, a photo with no description among them; an empty draft takes the story off the page), `copyProductStory(fromProductId, toProductIds)` (into up to 50 products' drafts, Q6), and the merchant side's brand stories, `storyBlocks` (paged, each with how many products use it), `storyBlock(id)`, `saveStoryBlock`, `deleteStoryBlock` (refused while in use); writing needs `aplus` on the plan. A supplier's story is published as its product saves until approval (SAPI 5) reviews it with the product (Q11). **#294 (SAPI 4)**: `warehouses` (paged; the merchant side also reads suppliers' locations and their counts, never changing them), `saveWarehouse`, `setDefaultWarehouse`, `deleteWarehouse` (not the default, nor one holding stock; up to 20 an owner; every store starts with its "Main location"), `productStock(productId)` (on hand and reserved per version and location), `stockHistory(productId, versionId)` (paged, newest first, with the reason, who, where and the result), `adjustStock` (received, returned, damaged, counted), `setStock` (typed numbers, up to 100 in one save; a location's first count is "Starting stock"), `setLowStockThreshold` (default 5), the Low stock chip and the list's stock. Reserving at payment, releasing and the 3-day bank-transfer cancellation come with orders (SAPI 9, SAPI 11), which write `reserved` **#295 (SAPI 5)**: part 1, a supplier's requests run as their own database role, `app_supplier` (DATA-MODEL §5.3). Part 2, Settings › Supplier (Owner, `manage-vendors`): `suppliers(filter: all | active | suspended)` (paged, newest first, each with its users and products), `supplierCounts`, `supplier(id)`, `inviteSupplier` (the company and its first user, a Supplier admin, in one; a name unique in the store whatever its case; `suppliers_enabled` and the `suppliers` limit on the plan, refused with nothing written), `setSupplierAccess`, `setSupplierShippingMode(shippingMode, labelAccount)`, `suspendSupplier(hideProducts)`, `resumeSupplier` (what a suspension hid comes back as it was), `removeSupplier` (its people and invitations end, its products hidden and kept as its own, its name free again). The supplier is `invited` until its first user joins; an invitation into a suspended or removed one no longer works. Part 3: `addSupplierPerson(id, email, role)` (the Owner's "Add a person", a member by default, an admin to appoint one; refused while suspended) and Your team, a Supplier admin's (`supplier.team`) own supplier only: `mySupplierTeam` (paged; people and open invitations, each with `you` and `lastAdmin`), `inviteSupplierUser(email, role)`, `resendSupplierInvitation`, `revokeSupplierInvitation`, `changeSupplierRole`, `removeSupplierUser`; never the last admin (`LAST_ADMIN`). Part 4, approval (ACCESS §7.2, CATALOG L): `supplierApprovalRequired` (read by everyone in the store), `setApproval(on)`, `approveProduct`, `sendBackProduct(reason)` (the Owner's, `approve`), `navBadges { products }` (the merchant side's count of what waits); while it's on a supplier's new product is made hidden and pending, and its save of an approved one whose name, a price or photo set changed, of one sent back, or its A+ published (Q11), puts it back in the queue; `saveProduct` answers `approval` and `reviewed` (which of the three changed) for E3's wording. Turning approval off leaves the queue as it is. A Stock-only supplier proposes with `proposeProduct` (waiting for approval whatever the switch says; no edit after). While the store is past due its suppliers keep working and read `readOnly: false` (§1). Left on the card: a supplier's translations wait for approval with SAPI 6 (N16). **#296 (SAPI 6)**, part 1: `storeLocale` (the main language and pricing currency, the store's languages and currencies with removed ones kept, the offered languages; merchant side, `catalog.read`), `saveLanguages(languages, main)` (en-IN, en-US, hi-IN; the plan's `languages` counting the main one), `saveCurrencies` (each `convert` with a rounding or `manual`; the plan's `currencies` counting the pricing one), `markets` (paged), `market(id)`, `saveMarket` (at the revision read; countries no other top-level market has, a sub-market within its parent's and none of its siblings'; a currency and language the store offers; the main address or a path; all products or all but some; duties none, by code or flat), `deleteMarket` (never the primary Home market; its sub-markets become top-level), `setEverywhereElse(marketId)`; the Owner writes (`settings`). Markets on their own domain are left out (one domain per store, #337); payments per market wait for SAPI 10, delivery charges for SAPI 23. Part 2: `product.pricing(marketId)` (merchant side; each version's price in every currency the store sells in, typed or converted, and in the market named: its currency's price moved by its adjustment and rounded), `storeLocale.rates` (the reference rates in use and their date), the `rates.refresh` job (ECB, every six hours), and a supplier's prices in the pricing currency only (O14). Fixed prices per market wait for the plan question on #296. Part 3, translations (facts 18–22, N): `productTranslation(productId, language)` and `saveProductTranslation` (name, web address, description, versions' names, and, for the merchant side, the shared option and choice names; each row with its main text and `translated`, `changed` or `missing`; a supplier its own products, waiting for approval while it's on, N16), `catalogueTranslation` and `saveCatalogueTranslation` (a collection, filter or filter choice; merchant side), `sharedNames(kind, language)` and `saveSharedNames` (N6), `translationProgress(language)` and `products(untranslatedIn)` (fact 19); into the store's other offered languages only. Per-language SEO, photo alt text (facts 21, 23) and suggested translations (fact 24) stay `(release: decide)`. Part 4, Store info: `storeInfo` (merchant side) and `saveStoreInfo` (Owner): name, legal name (in invoice settings), description, logo (one of the store's images), address in any format, contact, the home country's tax id (GSTIN; EIN or sales-tax permit; VAT number), time zone, units, order prefix and next number; the country is set at sign-up. **#297 (SAPI 7)**: `taxSetup` (prices including tax, the classes with their Stripe tax codes and how many versions each, the zones with their rates; merchant side), `setPricesIncludeTax`, `saveTaxClass` (and making one the default, products with none keeping their rate), `deleteTaxClass` (never the default or one in use), `saveTaxZone` (countries, regions, a rate per class), `deleteTaxZone`, `invoiceSettings` and `saveInvoiceSettings` (the Owner writes, `settings`); a version's `taxClassId` on `saveProduct` (the merchant side's; a supplier's take the default); `taxQuote(lines, shipTo)`, which carts (SAPI 9) price with: India's GST as CGST and SGST within the store's state and IGST across states, a US store's own state rates without Stripe (decided on #337), and Stripe Tax on its connected account once payments (SAPI 10) connects it. **#298 (SUI 4)**, what the list needs of the API: `products(sort:)` (created, updated, name, price either way, stock; each sort paged by its own cursor), `readiness` per market on each row and on the product (merchant side; CATALOG T2), `addProductsToCollection` and `setProductsTaxClass` (the bulk actions). What the editor needs: `productCollections(productId)` (the hand-picked and automatic collections a product is in) and `setProductCollections(productId, collectionIds)` (replaces its hand-picked set, answering the memberships), both merchant side only, a supplier refused; and `related { id name }` on `ProductListing`.* | |
| | *Built on #290: `brand`, sign-up (SAAS §4.1, steps 1–3 of §5), sign-in with 2-factor, invitations (`/accept-invite`, `/join`) and password reset under `/api/auth/*` (ACCESS §4), the Profile row (`profile`, `mySessions`, `myActivity` and its mutations, email confirmed at `/api/auth/confirm-email`), Settings › People (`people`, `peopleCounts`, `inviteMember`, `resendInvitation`, `revokeInvitation`, `changeRole`, `removeMember`), `me`, `myStores`, `storeState`, `switchStore`; `navBadges` comes with the tables it counts (SAPI 5's approvals, SAPI 11's orders), and `storeState`'s import job with SAPI 16* | |
| Profile | `profile`, `mySessions`, `myActivity` | `updateProfile`, `setTheme` (the theme alone), `changeEmail`, `changePassword`, `setSecondFactor`, `regenerateBackupCodes`, `signOutOtherSessions` |
| Home | `home` | |
| Orders | `orders(filter)`, `order(id)`, `orderCounts` | `shipItems`, `bookLabel`, `addTracking`, `startReturn`, `receiveReturn`, `cancelReturn`, `refund` (with `override`), `cancelOrder`, `markPaid`, `addOrderNote`, `exportOrders` (job) |
| Customers | `customers(filter)`, `customer(id)`, `customerGroups` | `addCustomer`, `updateCustomer`, `setCustomerTags`, `setCustomerNote`, `recordMarketingStop`, `createGroup`, `updateGroup`, `deleteGroup`, `exportCustomers` (job) |
| Offers | `offers(filter)`, `offer(id)`, `checkCode(code)`, `offerResults(id)` | `saveOffer`, `pauseOffer`, `endOffer`, `duplicateOffer`, `deleteOffer`, `generateCodes`, `exportOfferCodes` (job) |
| Abandoned carts | `abandonedCarts(filter)`, `cartSummary(range)`, `reminderSettings` | `saveReminderSettings`, `remindNow(cartId, discount)`, `sendTestReminder` |
| Reports | `report(panel, range)`, `customReport(rows, columns, range)` | `exportReport(panel, range)` (job) |
| Products | `products(filter, sort)`, `productCounts`, `product(id)`, `productStock(productId)`, `stockHistory(productId, versionId)`, `readiness(productId)` | `saveProduct`, `updateProducts(ids, patch)`, `deleteProducts`, `adjustStock(versionId, warehouseId, delta, reason)`, `setStock(entries)`, `setLowStockThreshold`, `approveProduct`, `sendBackProduct(reason)`, `uploadAsset` (signed upload), `writeDescription` (AI, metered), `exportProducts` (job) |
| Collections | `collections`, `facets` (the one a supplier reaches too, counting its own products only), `menu`, `sizeCharts`, `productCollections` (merchant side) | `saveCollection`, `deleteCollection`, `saveFacet`, `mergeFacetValues`, `saveMenu`, `saveSizeChart`, `deleteSizeChart`, `setProductCollections` (merchant side) |
| Import | `importJob(id)` | `startImport(file or shopify)`, `confirmImport`, `pauseImport`, `connectShopify` |
| Storefront | `storefront` (live version, history, usage, publishing status) | `describeChange(prompt)` (AI run), `approvePreview`, `publish`, `revertTo(version)`, `publishCatalogueNow`, `chooseStorefront(ai or own)` |
| Settings | `storeInfo`, `people`, `suppliers`, `gateways`, `shipping`, `warehouses`, `tax`, `markets`, `catalogueSettings`, `customerAccounts`, `apiKeys`, `webhooks(…deliveries)`, `apps`, `supportAccess` (+ log), `domain` | `saveStoreInfo`, `saveCurrencies`, `saveLanguages`, `connectDomain`, `recheckDomain`, `removeDomain`, `inviteMember`, `changeRole`, `removeMember`, `inviteSupplier`, `setSupplierAccess`, `setSupplierShippingMode`, `suspendSupplier(hide)`, `removeSupplier`, `setApproval`, `connectGateway`, `disconnectGateway`, `saveShipping`, `connectCourier`, `testCouriers`, `saveWarehouse`, `setDefaultWarehouse`, `saveTax`, `saveInvoiceSettings`, `saveMarket`, `saveCatalogueSettings`, `saveBadge`, `saveLegalDefaults`, `setCustomerSignIn`, `createApiKey` (secret shown once), `rotateApiKey`, `revokeApiKey`, `saveWebhook`, `replayDelivery`, `installApp`, `uninstallApp`, `setSupportAccess`, `answerSupportElevation(allow)` |
| Activity (Owner, and Manager as Store activity) | `activityLog(filter)` (`activity.read`, Owner and Manager, shoppers included), never behind the Settings permission | `exportActivity` (job, `activity.export`, Owner only) |
| Billing | `subscription`, `planCatalogue` (the partner's), `usage`, `invoices`, `billingDetails` | `changePlan(plan, period, when)`, `setPaymentMethod(token)`, `saveBillingDetails`, `buyBandwidth`, `buySetup`, `downloadInvoice`, `keepProducts(ids)` (Choose what to keep), `cancelStore`, `exportStoreData` (job) |
| Supplier | Only these, seller-scoped, by ACCESS §5.2's tier: `me` and `storeState` **masked** to what the shell needs (person, role, tier, store name, the read-only flag; never the plan, trial or billing state, §2), `myStores`, `navBadges`, the Profile queries; `products`, `productCounts`, `product`, `facets` (to tag its own products; each value's count is of its own products only), `productStory`, `productStock`, `warehouses` (their own), `stockHistory`, `readiness` (`catalog.read`, `stock.read`); `orders`, `order` and `orderCounts` for their own lines only, so the To ship chips count nothing else (`orders.read`); `mySales` (`sales.read`, no totals); `mySupplierTeam` (Supplier admin). **Every other query is refused**: `home`, `customers`, `offers`, `abandonedCarts`, `report`, Collections but `facets`, Settings, Billing | Only these, by tier: `saveProduct`, its `filterValues` tagging its own products with the store's filter values, `saveProductStory`, `publishProductStory`, `copyProductStory` (`catalog.write`), `adjustStock`, `setStock`, `setLowStockThreshold`, `saveWarehouse`, `setDefaultWarehouse`, `deleteWarehouse` (`stock.write`, `warehouses.write`), `shipItems`, `refund` on their own lines (`orders.fulfil`, `orders.refund`), `exportProducts` (`exports.products`), `exportOrders` (`exports.orders`, the two order tiers only), `startImport` (`catalog.import`), the Profile mutations; `inviteSupplierUser`, `changeSupplierRole`, `removeSupplierUser` (Supplier admin). Every other mutation is refused |

Every mutation is authorised by ACCESS §5.1–5.2 per role and tier, refused while past due
(`READ_ONLY`), metered through `saas/entitlements` where a plan limits it (`PLAN_LIMIT` with the
plan that unlocks it), and audited.

**Every Store API and Shop API card keeps AGENTS.md's platform rules**, and its tests show the ones
it touches:

- **Outbound calls** (webhooks, Shopify, couriers, payment providers, image fetches): a timeout,
  retries with backoff and a limit, and **SSRF protection on every user-supplied URL**: https
  only, the host resolved and refused when private, loopback, link-local or metadata
  (`169.254.169.254`), checked again on every redirect and every retry or replay.
- **Rate limits** on sign-in, codes and every public Shop API call, per host and per IP, and
  code lookups (`applyCode`, gift card balance and redemption, mobile sign-in codes, reminder
  and unsubscribe links, download links, reset and invitation tokens) answer **the same refusal
  whether the code or token is unknown, expired or already used**.
- Side effects through the outbox; webhooks, jobs and payments idempotent; money in minor units
  with a currency; every write audited with its actor; secrets never returned after creation.

**Every Shop API call** builds its `TenantContext` (ACCESS §3) from the storefront's host or the
public store key, never a secret; a store id in an argument is never authority. `products`,
`search` and `orderHistory` are **cursor-paged** like the Store API, at most 50 a page. A
shopper's `order(id)`, `orderHistory`, `account` and `addresses` read only that shopper's own
`customer_id`; a guest reads one order only through its order token (DATA-MODEL §5.1
`app.order_token_hash`). Each is held by SAPI 9's isolation tests.

**The Shop API** (`/shop-api`, PLATFORM-PROMPT §5.5) — what the storefront template needs to sell
what the portal publishes:
`store` (info, policies, legal, markets, currencies, languages), `menu`, `collections`,
`collection`, `products(filter, facets, search)`, `product` (with A+, size chart, sections,
badges, readiness per market), `search`; cart (`cart`, `addToCart`, `updateLine`,
`applyCode`, `setAddress`, `shippingOptions`, `setShipping`, `paymentOptions` per region:
Stripe, PayPal, Razorpay, Cashfree, PhonePe, cash on delivery, bank transfer), `checkout`
(prices, Stripe Tax or the store's rates, offers and totals computed by the engine, stock
checked at payment), `order` and `orderHistory`; shopper `signUp`, `signIn` by email or mobile
code (ACCESS §2.1), `account`, `addresses`; **gift card balance and redemption**; digital
downloads after payment; services sold with no booking (§1); marketing consent at
checkout; the abandoned-cart return link (`cart/r/{token}`) and single-use codes. Catalogue
queries are edge-cached per store, language and currency and purged by events (§5.5 there).

---

## 20. The strands that build this release

**Build order (decided 2026-10-05, #284): 53 cards, created on the board as #285–#335, plus
#338–#339 added on #337, built straight through.** The table below describes the cards #184 drafted; the cards added on #284
(D1, INF 0–2, SMS 1, SC 0–1, ST 1a–c replacing ST 1, L1–2) and on #337 (SAPI 24, SUI 17)
are described in their issues.

- **0. Design and accounts:** #285 D1, #286 SUI 1, #287 INF 0
- **1. Merchant identity:** #288 SAPI 1, #289 SMS 1, #290 SAPI 2, #291 SUI 2, #292 SUI 3
- **2. Catalogue:** #293 SAPI 3, #294 SAPI 4, #295 SAPI 5, #296 SAPI 6, #297 SAPI 7, #298 SUI 4, #299 SUI 5, #300 SUI 6, #301 SAPI 16, #302 SUI 10
- **3. Storefront base:** #303 SC 0, #304 SC 1, #305 SAPI 23, #306 SAPI 8, #307 ST 1a
- **4. Checkout and orders:** #308 SAPI 9, #309 SAPI 10, #310 SAPI 11, #311 SAPI 12, #312 SAPI 13, #313 ST 1b, #314 SUI 7, #315 SUI 8
- **5. Publishing:** #316 INF 1, #317 INF 2, #318 SAPI 17, #319 SUI 11
- **6. Growth:** #320 SAPI 14, #321 SAPI 15, #322 SAPI 18, #323 SAPI 22, #324 ST 1c, #325 SUI 9, #326 SUI 12, #327 SUI 15, #328 SUI 16, #338 SAPI 24, #339 SUI 17
- **7. Business and admin:** #329 SAPI 19, #330 SAPI 20, #331 SAPI 21, #332 SUI 13, #333 SUI 14
- **8. Launch:** #334 L1, #335 L2

The draft, as #184 left it, in the shape PAPI 1–9 and PC 2–12 took. **Needs** is
what must merge first. **Who builds each §19 operation**: Brand, sign-in, Shell (`me`, `myStores`,
`navBadges`, `storeState`, `switchStore`) and Profile, SAPI 2; Home (`home`) with Reports, SAPI 18;
Orders, SAPI 11 (labels and tracking SAPI 12, `markPaid` SAPI 10); Customers, SAPI 13; Offers,
SAPI 14; Abandoned carts, SAPI 15; Products and Collections, SAPI 3 (stock SAPI 4, approval
SAPI 5, `writeDescription` SAPI 17); Import and export, SAPI 16; Storefront and the custom domain
(`domain`, `connectDomain`, `recheckDomain`, `removeDomain`), SAPI 17; Settings by tab (Store info,
languages, currencies and Markets SAPI 6; People SAPI 2; Suppliers SAPI 5; payments SAPI 10;
Shipping and couriers SAPI 23; Warehouse SAPI 4; Tax and invoices SAPI 7; Catalogue, badges and
legal SAPI 3; Customer accounts SAPI 9; Developers and Apps SAPI 20; Support access and the
activity log SAPI 21); Billing, SAPI 19; Supplier (`mySupplierTeam` and the team mutations SAPI 5,
`mySales` SAPI 11). **Every SAPI card that reads or writes store data carries isolation tests
for each query and mutation it adds** (ACCESS §11: caller kind × store × seller, counts, exports
and bearer tokens included); the rows name the cases easiest to miss.

**Store prototype (designs/)**

| # | Card | Needs |
|---|---|---|
| SUI 1 | Draw the undrawn parts in the Store prototype: Support access with the banner's Allow/Deny, the store Activity log, Customer accounts, Developers (keys, webhooks), Apps, AI-or-own storefront, Your sales, Your team, services, gift cards, digital file upload, the blog and content pages (#337); resolve §18's behaviour rows | #184 |

**Store API (apps/api)**

| # | Card | Needs |
|---|---|---|
| SAPI 1 | Store API GraphQL skeleton on the portal host: schema file, `TenantContext` from session and acting store, resolver scope declarations, `READ_ONLY` and `PLAN_LIMIT`, cursor paging, the structural test | #184 |
| SAPI 2 | Brand by hostname, sign-up and provisioning (SAAS §5 workflow, steps 1–3), sign-in, 2-factor and enrolment, reset, invitations, My profile, sessions; `signIn`, `verifySecondFactor`, `useBackupCode`, `verifySignupEmail`, `verifySignupPhone`, `requestPasswordReset`, `resetPassword` and `acceptInvitation` rate-limited per host, IP and account or address (no flooding an address with reset emails, ACCESS §2); one refusal for a reset or invitation token that is unknown, expired or already used; `signIn`, `requestPasswordReset` and sign-up never reveal whether an account exists (same answer and timing, ACCESS §2); the shell queries (`me`, `myStores`, `navBadges`, `storeState`, `switchStore`), badges counting only what the caller may see | SAPI 1 |
| SAPI 3 | Money, catalogue, versions, assets (R2 signed uploads), collections, facets, menus, size charts, sections, legal, badges, readiness per market | SAPI 1 |
| SAPI 4 | Inventory: warehouses, stock per version and warehouse, the movement ledger with #183's reasons, reserved at payment, and at placement for cash on delivery and bank transfer (decided 2026-10-05), which the orders cards write | SAPI 3 |
| SAPI 5 | Suppliers: tiers, shipping modes, supplier teams, approval, `SellerScope` and the isolation matrix, including a supplier's masked `me` and `storeState` and seller-scoped `orderCounts` (§19); `mySupplierTeam` and the team mutations (Supplier admin only, never another supplier's team) | SAPI 4 |
| SAPI 6 | Markets, currencies, languages, translations, per-market prices and web addresses (one domain per store, #337) | SAPI 3 |
| SAPI 7 | Tax: classes, rates (India), Stripe Tax (US; on the merchant's own account through Connect, decided 2026-10-05; a PayPal-only US store enters its own state rates, decided 2026-10-05 on #337), invoices settings | SAPI 3 |
| SAPI 8 | Shop API catalogue and search, edge caching and purge; its isolation test: the tenant comes from the host or public key only, and the cache key carries store, language and currency, so store X's catalogue is never served on store Y's host | SAPI 3, SAPI 6 |
| SAPI 9 | Cart and checkout, shopper accounts (Customer accounts setting); delivery priced by SAPI 23; the isolation matrix (caller kind × store × shopper, the guest order token included): a shopper reads only their own `order`, `orderHistory`, `account` and `addresses`, and a token opens one order of one store; `applyCode` and mobile sign-in codes rate-limited per host and IP, with one refusal for a wrong and a missing code; a guest's cart token opens only that cart in that store, with one refusal for an unknown or expired token | SAPI 7, SAPI 8, SAPI 23 |
| SAPI 10 | Payments: Stripe, PayPal, Razorpay, Cashfree, PhonePe, cash on delivery, bank transfer; webhooks idempotent; stock reserved and re-checked at payment; cash on delivery, bank transfer, the unpaid-transfer release and "Mark as paid" **pending §21** (proposed in PLATFORM-PROMPT §5.4) | SAPI 9, SAPI 4 |
| SAPI 11 | Orders: state machine, supplier parts, fulfilment, returns, refunds with override and the supplier ledger, cancellations; `exportOrders`, masked for suppliers as §13 says; isolation: store A can't read, ship, refund or mark paid store B's order, and a supplier reads, ships and refunds only its own lines; `mySales` (`sales.read`): supplier A never sees supplier B's lines, no order total, customer fields by shipping mode; a Stock only or Products-and-stock supplier is refused `exportOrders` (`exports.orders` needs `orders.read`) | SAPI 10, SAPI 5 |
| SAPI 12 | Shipping after payment: labels, pickups and tracking sync, through SAPI 23's courier adapters | SAPI 11, SAPI 23 |
| SAPI 13 | Customers: groups, tags, notes, consent, `exportCustomers` (never to a supplier); shopper emails through SES (order, shipping, password) and order updates by SMS (#337); isolation: `customers`, `customer`, `customerGroups` and `exportCustomers` are store-scoped (no cross-store rows or counts) and refused to every supplier | SAPI 11 |
| SAPI 14 | Offers: the OFFERS-DESIGN engine, codes, combining, usage counting; `exportOfferCodes` with its isolation test; `checkCode` rate-limited per caller and store, with one answer for a wrong and a missing code | SAPI 9 |
| SAPI 15 | Abandoned carts: detection, reminder jobs, single-use codes, SES sending and WhatsApp through MSG91 in India (#337), unsubscribe; isolation: a reminder link (`cart/r/{token}`) or unsubscribe token opens or changes one cart or one consent in one store only; link lookups rate-limited per host and IP, with one refusal for a token that is unknown, expired or used; and `abandonedCarts` is store-scoped, read-only for Staff and refused to suppliers | SAPI 13, SAPI 14 |
| SAPI 16 | Import and export: CSV, Shopify, product and stock export jobs, supplier exports seller-scoped (§13); the Shopify connection and image fetches keep §19's outbound rules (SSRF-checked URLs, timeout, bounded retries), tested with a private and a metadata address; isolation: exports are store A's only, supplier A's never supplier B's, and a `to-store` supplier's export carries no customer field; a supplier's import writes only its own rows (`seller_id` from `SellerScope`, never the file), a row naming another supplier's or the store's product is rejected, and imported rows wait for approval while it's on | SAPI 5 |
| SAPI 17 | Storefront: provisioning steps 4–8, AI designer runs, publish, revert, Publish now, own storefront and public keys | SAPI 2, SAPI 8 |
| SAPI 18 | Reports and the custom report builder; `exportReport` with its isolation test (Staff and every supplier caller refused `report` and `exportReport`: suppliers have no Reports, only Your sales, `mySales`, §17); and `home`, store-scoped and refused to suppliers; `home` by role, withheld on the server: Staff get no sales, order-value or returning-customer figures (`reports.read`), and a Manager gets no Owner-only item (team requests, approval queue) | SAPI 11 |
| SAPI 19 | Billing for the store: the partner's plans, proration, usage meters, Choose what to keep, close store and `exportStoreData` (Owner) with its isolation test | SAPI 2, SAPI 3, SAPI 11, SAPI 13, #201 |
| SAPI 20 | Developers: API keys, webhooks from the outbox; Apps and grants; isolation: a key minted for store A never authenticates on, nor is listed or revoked from, store B; webhooks, deliveries and `replayDelivery` stay in their store; a key's secret is shown once and never returned again; a webhook URL is SSRF-checked when saved and on every delivery and `replayDelivery` (private, loopback, link-local and metadata hosts refused, tested), with a timeout and bounded backoff | SAPI 11 |
| SAPI 21 | Support access setting, the elevation Allow/Deny, the store activity log and `exportActivity` (Owner only) with its isolation test; `activityLog` read by Owner and Manager under `activity.read`, never the Settings permission, and a Manager refused `exportActivity` | SAPI 2, #202 |
| SAPI 22 | Product kinds: digital downloads, gift cards (issue, balance, redeem), services; isolation: a gift card code redeems or shows a balance in its own store only, and a download link serves one paid order's file, rate-limited, with one refusal for a link that is unknown, expired or used up; balance and redemption rate-limited per host and IP, with one refusal for a wrong and a missing code | SAPI 11, SUI 1 |
| SAPI 23 | Shipping methods and charges, before checkout: flat rate, free over a threshold, collect in person, delivery areas, and the live-rate quote through the couriers (Shiprocket, and the US aggregator, EasyPost, decided 2026-10-05 on #337); several methods at once | SAPI 3, SAPI 6 |

**Store UI (apps/ui/store)**

| # | Card | Needs |
|---|---|---|
| SUI 2 | Shell: brand from hostname, menu per role, store switcher, banners and states, `?state=` harness | SAPI 2 |
| SUI 3 | Getting in and My profile | SUI 2, SAPI 2 |
| SUI 4 | Products, editor, stock and history, approval | SUI 2, SAPI 5 |
| SUI 5 | Collections, filters, menus, size charts | SUI 4 |
| SUI 6 | Settings: Store info, People, Supplier, Warehouse, Markets, Catalogue, Tax | SUI 4, SAPI 6, SAPI 7 |
| SUI 7 | Orders, returns, refunds, Customers | SUI 2, SAPI 11, SAPI 13 |
| SUI 8 | Settings: Payment setup, Shipping, Customer accounts | SUI 6, SAPI 10, SAPI 23 |
| SUI 9 | Offers and Abandoned carts | SUI 7, SAPI 14, SAPI 15 |
| SUI 10 | Import and export | SUI 4, SAPI 16 |
| SUI 11 | Storefront | SUI 2, SAPI 17 |
| SUI 12 | Home and Reports | SUI 7, SAPI 18 |
| SUI 13 | Billing | SUI 2, SAPI 19 |
| SUI 14 | Developers, Apps, Support access, Activity log | SUI 6, SAPI 20, SAPI 21, SUI 1 |
| SUI 15 | Supplier views: Your products, To ship, Your sales, Your team | SUI 4, SUI 7, SUI 1 |
| SUI 16 | Product kinds in the editor (the storefront's side is ST 1's) | SUI 4, SAPI 22 |
| ST 1 | Storefront template on the Shop API: catalogue, cart, checkout, accounts, offers, every payment method, and the product kinds on the storefront (gift cards, downloads) | SAPI 9, SAPI 10, SAPI 14, SAPI 22 |

---

## 21. Open questions

- ~~**WhatsApp reminders** in India: which provider, and whether they ship with email (§18).~~
  MSG91, with email (decided 2026-10-05 on #337).
- ~~**Orders paid later reserve stock when placed**~~ **Decided 2026-10-05**: yes; a transfer unpaid after 3 days is cancelled. ~~*(proposed, PLATFORM-PROMPT §5.4)*: a cash-on-delivery
  or bank-transfer order reserves at placement after the usual re-check, and releases on
  cancellation or when a transfer stays unpaid past a limit *(decide: how long)*. Confirm, or say
  they reserve only when marked paid (and what then happens to an order whose stock has gone).~~
- ~~**Who may mark an order paid?**~~ **Owner and Manager** (decided 2026-10-05). ~~`orders.mark_paid` is proposed for Owner and Manager only, like
  refunds, since it records money received (ACCESS §5.1) *(confirm)*.~~
- ~~**May Staff export an offer's codes?**~~ **No: Owner and Manager** (decided 2026-10-05). ~~`offers.export` is proposed for Owner and Manager only
  (ACCESS §5.1, §13) *(confirm)*.~~
- ~~**Stripe Tax for merchants' US checkouts**~~ **On the merchant's own account through Stripe Connect** (decided 2026-10-05); a US store taking payments only through PayPal enters its own state rates (decided 2026-10-05 on #337). ~~*(decide)*: through the merchant's own connected Stripe
  account or DripFunnel's (whose account is then the tax-calculation vendor, with its cost and
  nexus), and what a US store taking payments only through PayPal uses (THIRD-PARTY-ACCESS §2.7).~~
- ~~What the storefront shows while the store is **past due** (SAAS §4.2 *(ask)*)~~ **It keeps selling** (decided 2026-10-05); its suppliers keep
  working (decided 2026-10-05 on #337).
- ~~**Dunning**: when past due becomes suspended (SAAS §7.3).~~ **After 14 days unpaid** (decided 2026-10-05).
- ~~**Gift cards**: expiry and liability rules per region, decided on SUI 1 with the design.~~
  The merchant sets the expiry, at least 1 year in India and 5 in the US (decided 2026-10-05 on #337).
- ~~**Services**: booking with times, or a service sold like a product with no shipping — SUI 1.~~
  Like a product with no shipping, no booking (decided 2026-10-05 on #337).
- ~~Whether "under two minutes" includes the first live build (SAAS §5).~~ No: the portal and
  the preview (decided 2026-10-05 on #337).
- ~~Apps: embedded pages or links only, and a public marketplace or private apps first
  (PLATFORM-PROMPT §10) — SUI 1 draws the first answer.~~ Private apps, as links (decided 2026-10-05 on #337).
