# FIRST-RELEASE.md: the merchant portal

The first version of the merchant portal (`apps/ui/store`, each partner's portal host) and of
the storefront's Shop API behind it: **everything the Store prototype draws, plus the parts the
docs design and the prototype doesn't draw yet** (decided with Gaurav on 2026-10-04, on #184;
§1 records each answer). The prototype is `designs/DF Store Prototype.dc.html` with its child
screens (`designs/design.md` §1 maps them).

**Status: specification, not built.** The Store API and the Shop API answer `health` only, and
`apps/ui/store` is a sign-in title and a Home link. The strands that build this release are
§20; build order is not scope.

Last updated: 2026-10-10 (#326: the Home and Reports screens; #322: Home's figures per seat, and Reports).

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
| API keys, webhooks, apps, own storefront (PLATFORM-PROMPT §5.5, §10; DESIGN-BRIEF 75–77) | API keys, webhooks and apps **in**, drawn in `SetDev` (SUI 1, #286); the **own storefront is out** of the first release (decided 2026-10-08 on #470): every store uses the template and the studio |
| Settings › Support access, the store activity log, Settings › Customer accounts | **In**: drawn in `SetAccess` and `StoreActivity` (SUI 1, #286), to ACCESS §8, LOGGING §6 and ACCESS §2.1 |
| Staff export (README §3) | **Yes**: products, orders and customers |
| A read-only Offers list for Staff (README §3) | **Yes** (the prototype draws it) |
| Supplier import and export (README §3) | **Own only**: export for every tier, import for the catalogue tiers |
| Manager and the whole store log (README §3, LOGGING §6) | **Yes**, as the Owner sees it |

**Decided 2026-10-05 with Gaurav (#284), planning the build:**

| Question | Answer |
|---|---|
| The shopper storefront's pages (the prototype draws none) | **Designed in the prototype first** (card D1), then built as the baseline theme ("Start from scratch"), which the AI then rewrites freely (#470) |
| Hosting (PLATFORM-PROMPT §5.6, §10) | ~~**A Cloudflare Pages project per store**; the project limit per account is checked and raised (INF 0)~~ **Each build's files in R2, served for every store by one edge Worker** (2026-10-09: Pages allows 100 projects per account; storefront LIVE-SHOP §1) |
| Where the AI designer runs | ~~**GitHub Actions**, like the storefront builds~~ ~~One Store API call that edits the store's site data~~ **Cloudflare Containers**, one per store with a studio open, with the storefront builds (2026-10-08, #470) |
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
| Content pages and blog | **In**: about, FAQ, contact, lookbook and a blog, managed in the portal (SAPI 24, SUI 17); they share one set of paths with the AI's own pages (2026-10-08, #470) |
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

**Decided 2026-10-08 with Gaurav (#470), the Storefront redesign** (`designs/PortalStorefront`,
`SitePreview`, `storefront-lib.js`; storefront ARCHITECTURE §1, §6, SAAS §9.2):

| Question | Answer |
|---|---|
| What the AI edits | ~~The store's **site data** (theme, announcement bar, header, up to 12 home sections, footer, About, Contact), never code~~ **Reversed the same day**: the theme's code (below) |
| The store repo | Still one per store, **created when the merchant first picks a template**; ~~it holds the template and `site.json`, which publishing commits~~ it holds the store's theme, and the platform commits each AI change that passes (below) |
| Live hosting | A static build per store, ~~on its Pages project, built in Cloudflare Containers~~ in R2 behind the edge Worker, built by its public repo's GitHub Actions (2026-10-09, storefront LIVE-SHOP) |
| How a design starts | A required **"Your brand"** step, then a **template gallery** (six presets and "Start from scratch", each with a demo), replacing the three AI directions |
| Brand colours | Only a hint for the AI; templates keep their own |
| Content pages and blog | Kept, as Storefront's **Pages** and **Journal** tabs (`StorefrontContent`); content pages are FAQ, lookbook and the merchant's own |
| Catalogue "Publish now" | Kept with its allowance, in a bar on the Design tab; the automatic publish too |
| The preview host | Kept: **"Open preview"** in the studio opens the draft by a signed link, with test-mode checkout; every change that passes is deployed there (below) |
| The own storefront | Not in the first release |
| A new core release | Each published version is pinned to its core version; a new look reaches a store only at its merchant's next publish |
| The undrawn prototype files | The cards follow only the new Storefront files; the other Store screens stay as they were |

**Decided 2026-10-08 with Gaurav (#470), later the same day: "Plan A", the AI writes the theme's
code** (storefront ARCHITECTURE §1, §3, §4.2, §6; DESIGN §2–§3; SAAS §9.2, §10):

| Question | Answer |
|---|---|
| What the AI edits | The store's **theme code**: pages, components, CSS Modules, the words per language and its own pages (`src/theme/**`, `content/**`, `routes.json`), behind a file allowlist, a code validator, sealed components, CSP and gates. Full freedom over look and front-end behaviour (an image matched, a page featuring one product, any element anywhere, zoom, infinite scroll), none over commerce |
| Where changes and builds run | **Cloudflare Containers**: one per store with a studio open, held by one Durable Object per store (one change at a time); ~~publish builds in their own pool~~ publish builds in each store's public repo on GitHub Actions, and drafts stay private until their publish is live (2026-10-09, storefront LIVE-SHOP and AI-STUDIO) |
| A change that fails its check | The AI repairs it from the exact errors, at most three times, else "nothing changed"; repairs and gate runs are **the platform's cost**, never the merchant's meters |
| Publishing | A full gate before going live; repair, then "publish everything before this change", then refuse; automatic rollback if the live site breaks after deploy |
| Preview host | Every change that passes is deployed there, so "Open preview" always shows the draft |
| Go back to version N | ~~Redeploy its kept deployment~~ Make its kept build live again by moving the pointer (no build, free, live everywhere within a minute; 2026-10-09, storefront LIVE-SHOP), then reset the draft to that version |
| Brand and search and sharing | Read by the theme through core; the AI never copies them |
| Paths | One namespace: core's routes reserved; an AI page and a content page or post can't share a path |
| Templates | Kept as a gallery; each template is complete starting theme code |
| New and renamed products | A single-page render at once (page, sitemap, redirect, IndexNow), no allowance used |
| Languages | The AI writes every language the store offers; the merchant can correct any |
| Real-user speed data | Recorded only after the shopper's consent |
| A core security fix the theme can't take | The store gets the baseline theme with its own colours and words until repaired |

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
  the products waiting for approval; a failed count draws no badge. **Built on #314**: Orders' (and
  a supplier's To ship) badge is `navBadges.toShip`.

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
import banner is built on #302 from the caller's own `catalogImports`, not `storeState` (a run is its importer's); support's Allow / Deny is built on #331: `storeState.support` adds the session's id, its access, who allowed it and the agent's request (`writeRequest`: note, state), answered with `allowSupportWrite` and `denySupportWrite` (ACCESS §8).

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

**Built on #322, part 1** (`home`): a day is midnight to midnight in the store's time zone (Settings › Store
info), sent as UTC instants. A **sale** is a placed order whose money was taken (paid, partly or wholly refunded),
never a cancelled or test one, counted net of refunds as Customers' "spent" is; money comes **a figure a currency,
never converted**, the pricing currency first. Orders today and yesterday count the orders that went through, a
cash-on-delivery or bank-transfer one still to be paid included; returning customers are the shoppers with more than one
such order (an account, else a guest's email, else its number). "Needs you" answers to ship (and partly shipped, the
oldest's time), payments to collect (cash or transfer, `orders.mark_paid`), the approval queue while approval is on
(`approve`), low stock (the count and the first three names), and couriers whose login a test refused
(`shipping.configure`). A seat without a figure gets null: Staff no sales, average order, returning customers, order
totals or payments to collect (`reports.read`), a Manager no approval queue or couriers; the checklist (products,
collections, payments, shipping) only while the store has no order, each item for the seat that can do it.
**Not built:** team requests, which need `access_request` and a "Send request" (DATA-MODEL §7.10) no card builds yet;
"products missing details for some countries", which needs a store-wide readiness count; and the checklist's
storefront item, which waits for SAPI 17. The locale check reads `storeLocale` and `storeInfo`.

**Built on #326, part 1** (`apps/ui/store/src/features/home`): Home per seat as `home` answers it. "Needs you" in the
prototype's order, each opening its filtered list (Orders on To ship, Products on Waiting for approval or Low stock,
Settings › Shipping, and the oldest payment to collect's order), or "Nothing is waiting for you" once a store with orders
has none; the numbers and the latest orders while the store has orders, Staff's titled "Today" with items in place of
totals; the checklist with only the items the API gives the seat. Decided here: the API keeps no "confirmed" fact for the
locale check, so the Owner's line shows what sign-up set (country, pricing currency, main language) as done, with Change
opening Settings › Store info; and a Manager's note names "the store owner", since a Manager can't read who that is.

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
- **Built on #314, part 1** (`apps/ui/store/src/features/orders/`, `/orders`): the list with its chips and counts
  (a supplier's four, its part's), search, pages of 25 and Export as a job the shell follows, each row's number, time,
  shopper and city (a supplier's "For {store}" and where it sends them), status, total and payment; Staff see the money
  too, since ACCESS §5.1 gives them `orders.read` and the API answers them (PortalOrders hides it). Decided there: a row says how many items, not their names, since `orders` answers a count;
  times are the store's zone (`storeInfo.timeZone`; a supplier's UTC), named once above the list rather than on every
  row; "Copy your store link" waits for the portal to know the shop's address (§4). `?state=` per `orderStates.ts`.
- **Built on #314, part 2** (`/orders/$orderId`): an order's lines by who packs them, payment, the shopper and the
  history with team notes; **Ship items** per line and quantity from one of the caller's own locations, with a courier,
  tracking number and tracking link (https), a pickup handed over with neither, and a supplier's to-store items marked
  as sent; **Add tracking** to a shipment sent without it; **Mark as paid** for cash on delivery and transfers
  (`orders.mark_paid`; Staff see it disabled, with who can); **Cancel order** with a reason for every merchant
  seat, as `cancelOrder` takes `orders.write`. Decided there: the courier is typed, since booking a label is #311's
  and the courier list is the Owner's (`shippingSettings`); the tracking link is asked for because the shipping text
  waits for one; Print (packing slip, invoice) is left for its own card. `?state=` per `orderPageStates.ts`.
- **Built on #314, part 3**: **Start a return** (the shipped units no return holds and no refund outside one has
  taken, with the prototype's five reasons), each return's card (On its way back → Received · refund due → Refunded,
  or Cancelled), **Mark as received**, **Cancel return**, and **Refund**: units picked per line, grouped by who refunds
  them, each at what the shopper paid as the API works it out, or an amount on its own for goodwill (`extra`, the
  store's); the store picking a supplier's lines overrides it, "recorded against {supplier}, for you to settle with
  them" (§18); "Put the picked items back in stock" is `restock`. The toast says what went back from the refunds the
  API made. Decided there: picked items and a typed amount don't mix, since a typed figure would have to be split
  across lines; no return label is promised, since booking one is #311's; the refund reasons are the API's three.

## 7. Customers (`PortalOrders` › Customers, flows 40, 72)

List (name, city and tags, spent, orders) with search, **groups** as chips; detail with contact,
addresses, groups, tags, a team-only note, **marketing consent** (only the shopper opts in; the
team may record that they asked to stop) and their orders. Add a customer (order emails only),
edit, manage groups (showing where a group is used before it changes), **export** (Owner,
Manager and Staff, §1). "Suppliers never see this list."
- **Built on #314, part 4** (`apps/ui/store/src/features/customers/`, `/customers`, `?customer=` opens one, as an
  order's customer link does): People with search and the groups as chips, each row's city and tags, spend (Staff's
  too, ACCESS §5.1) and orders, pages of 25, and the customer beside the list: contact and default address, groups toggled in
  and out, tags (up to 20, 24 characters), the team's note, marketing consent with "Record that they asked to stop"
  while they're opted in, and the newest orders; **Add a customer** (name, email, phone; an email already a customer
  opens that one), **Edit details** (name, number, the default delivery address whole or not at all), Groups (make,
  rename, delete saying who leaves, "See people"), and Export as a job. Decided there: the address is typed as its
  parts, since `updateCustomer` takes them, where the prototype asks for one line; a group's description is kept as
  it is, since the prototype edits only the name. `?state=` per `customerStates.ts`.

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

**Built on #321 (SAPI 15), part 1** (DATA-MODEL §7.2, §7.6): the every-minute cron marks a cart abandoned 20 minutes after
its last change once the shopper gave an email or number or started checkout, with what its lines came to; queues each
cart's latest step now due, once (a step after the first, a code and WhatsApp need the plan's `automatic`, the first alone
`onePerCart`; `youSend` sends nothing by itself); and the `cart.remind` outbox row decides it as it is delivered: skipped
as recovered, stopped, no email, opted out, undeliverable (bounced or complained), out of stock, under the minimum (in the
minimum's own currency) or the weekly cap, held through quiet hours, else sent as one email from the store with its
lines, its code, **Return to your cart** (`https://{shop host}/cart/r/{token}`) and **Unsubscribe**
(`https://{shop host}/unsubscribe/{token}`). A placed live order recovers its shopper's carts left that week and stops
their reminders. **Decided here (#321):** a store in the EU or EEA reminds only shoppers who agreed to email; quiet hours
are the store's own time zone (a shopper's isn't known); the link gives a guest's cart to the browser that follows it (a
new cart token), and asks the shopper to sign in for an account's cart.

**Part 2 (#321):** a step set to WhatsApp, in an Indian store on the plan's `automatic`, goes by the partner's WhatsApp
Business number through MSG91 to a **signed-in** shopper who agreed to WhatsApp, at their account's own number (never a
number typed in the cart); anyone else, or a partner whose account can't be read yet (#275), gets the email, and so
does one whose account, template or number is gone by the time it goes, under the email's own rules checked then (the
shopper's answer for email and the suppression list). A provider's refusal for good marks it undeliverable. **Decided
here (#321):** a shopper who agreed to some channels and not email gets no reminder email, in any country. The Carts tab reads its list, counts, one cart and its figures, and writes
"Send reminder now", "Stop reminders", "Resume reminders" and "Send me a test". **Decided here (#321):** a test goes by
email to the person's own address only, never one typed in, so a store can't email strangers with it (the prototype's
field is prefilled with it); "Send reminder now" below `automatic` gives one reminder a cart and no code, checked under the
cart's lock.

## 10. Reports (`PortalReports`)

7, 30 or 90 days against the period before: takings (sales, refunds, net), what sold, where it
came from (by market), tax collected (by state in the US, by rate in India), suppliers (units,
never a supplier's own totals shown to another), and the **custom report builder** (rows and
columns). Every panel exports. Locked below Growth. Owner and Manager.

**Built on #322, part 2** (`report(days, currency)`): the last 7, 30 or 90 of the store's days, today included, against
as many days before, over Home's sales (§5), in **one currency at a time** (the pricing currency unless another is asked
for; `currencies` lists every one sold in), never converted. Panels: `takings` (sales, refunds, net, the period
before's net and orders), `sold` (products by money taken on their lines), `markets` (net by the market bought in),
`tax` (as charged at checkout: by delivery state for a US store, by line rate otherwise, delivery's tax as a row with no
rate), `suppliers` (units per owner, the store's own first, never money), and **top offers** (decided on #337: each
discount line's name as shoppers saw it, its orders, the discount and those orders' net); `sold`, `markets` and `offers`
answer their top rows (5 by default, up to 50), the tax rows and `suppliers` up to 50 (50 by default),
the tax total every order's. Locked below Growth by the plan's `reports_sales` and the supplier panel by
`reports_export` ("Export and supplier report", the pricing page), each refused as `PLAN_LIMIT` with the plan that
unlocks it; Staff and every supplier are refused.

**Built on #322, part 3** (`exportReport(panel, days, currency, custom)`, `reportExport(id)`, `reportExports`): every
panel's file as a job, its range and currency fixed when asked, read back only by the asker for an hour; `takings` is
the orders behind it (total, refunded, net, tax, market), so Reports' "Export all" asks for it. The **custom report
builder** is the same job with `panel: custom` and the prototype's two answers: a row an order (basic; plus refunds and
tax; or a row a line sold), a product (every product, units and takings; plus stock left and supplier) or a customer (who
bought in the range, orders and spend; plus groups and tags). It is a file, as the prototype downloads it, so the
proposed `customReport` query is not built. Up to 10,000 rows, saying where it was cut. Export needs the plan's
`reports_sales` and `reports_export`, and the builder `reports_custom` (Business) as well, each refused as `PLAN_LIMIT`; allowed while read-only,
never for a read-only support session.

**Built on #326, part 2** (`apps/ui/store/src/features/reports`): Reports as PortalReports draws it, over `report`, with
the range (7, 30 or 90 days), a currency picker when the store sold in more than one, each card's Export and Export all
(the takings file) as jobs the shell's watcher follows, and the builder's two steps. Locked below Growth shows the
prototype's locked view naming the plan `PLAN_LIMIT` gives, with See plans for the Owner and "Ask your store owner" for a
Manager. Decided here: the supplier card is read on its own, so a plan without `reports_export` locks that card (naming
its plan) and leaves the rest; it shows only when some units are a supplier's. Top offers comes after Suppliers, before
Custom reports. The tax card is "Sales tax collected" by state in the US, "GST you owe" in India and "Tax you owe"
elsewhere, rates as percentages and tax on delivery as its own row. The builder's plan (`reports_custom`) is known only
from a refusal, which the dialog says and the card then names. A range with no sales says "Nothing to export" without
asking, as the API can't make a file without a currency.

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
  market, product video upload, and Import and Export (§13). **The API for the first three is built on #323**
  (SAPI 22, part 1: `productKind`, `saveProductKind`, `addLicenceKeys`, `POST /api/assets?kind=download`;
  CATALOG-DESIGN T14); a gift card's amounts are its versions.

## 12. Collections, Filters, Menus, Size charts (`CatCollections`, `CatSizeCharts`)

Collections (automatic by rules, or hand-picked with a manual order; visible or hidden for
offers; seasonal suggestions per market), Filters (shopper-facing values with counts, merge
look-alikes, internal tags only the team sees), Menus (one main menu, nesting one level, desktop
and phone previews), Size charts (sizes × measurements, units, other size systems, fit note).
Staff view only.

**Built on #299**: Collections is a screen with its tabs (`/collections`; `?edit=` opens one, `new`
starts one). The rule builder writes a filter's values as one sentence, sent as one rule per value,
and the API reads them as alternatives under "all" (CATALOG H4). Rules the screen doesn't draw (a
product, a version, a price range) are kept as they are on save. The live preview is
`collectionPreview`. Seasonal ideas come from a dated table of occasions in the app, matched to the
countries the store's markets sell to (CATALOG H13); if markets don't load, the ideas are left out
and nothing else changes. Filters (`?tab=filters`): values are added, renamed and deleted through
`saveFacet`, which takes every value the filter keeps. Values that differ only by case, spaces or
punctuation are offered for merging (`mergeFacetValues`). A filter's shoppers-or-internal switch is the
tag beside its name. Deleting a whole filter isn't drawn, so it isn't offered. Menus (`?tab=menus`): each
change saves at once at the revision read, as the prototype's menu does. A top item moves with the
items under it, an item under one moves among its siblings, and removing an item moves the ones under it
up a level. Adding links to pages or addresses (J4) waits for a drawing; such items are kept and shown.
Size charts (`?tab=sizeCharts`, and a supplier's own under "Your products" at `/products/size-charts`, decided
on #337): each side lists and changes its own charts, up to 200. A chart starts from a template in the
store's unit (kurtas where it prices in rupees), converts cm ⇄ in, and sends an empty cell as "—", since the
API needs a value in every cell. "Other size systems" adds empty US, UK and EU columns, not the prototype's
made-up numbers. Saving a chart used on several products asks "change all" or "make a copy"; leaving one with
unsaved changes asks first. "How to measure" notes and model info, which the prototype doesn't draw, are kept
as they are.

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

Built on #302: `/products/import`, reached from the list's **Import & export** (`catalog.import`) and from a
new store's empty list. The list's **Export** (anyone who reads the catalogue but a Stock-only supplier, as CatList
draws it) exports what the list shows as a job, its link under the header. A run is followed outside the screen,
with the shell's banner on every other screen (a supplier's too: the run is theirs to follow) and a toast when it
ends; it is found again after a reload. Decided on #302:
- **CSV only.** An Excel file is refused with how to save it as CSV; reading `.xlsx` would add a parser to the bundle.
- **Shopify's picker** opens with its first page ticked, as CatImport does; up to 250 by hand, or **Select all**.
- **The "Problems" file** is offered once a run ends: the check lists the first problems and how many more there
  are, because the API writes the file at the end of the run (#301). Building it at the check is open on #302.
- **The plan's room** isn't said before the run (the check doesn't count it); products past the limit are listed
  in Done as `PLAN_LIMIT` problems.
- **Exports** list the caller's recent files by kind and size; the API keeps no label for "all" or "hidden only".

## 14. Storefront (`PortalStorefront`, DESIGN-BRIEF H, SAAS §9)

Redesigned 2026-10-08 (#470). The Owner changes it; the Manager sees every part read-only ("You
can look, but only the store owner can change the storefront."); Staff and suppliers have no
Storefront; a past-due store is view-only ("Your store is view-only until the payment goes
through. Your site stays live."), as is a support session.

- **Your brand** (not drawn; first visit only, before the gallery): one page, "Your brand",
  with the shop name and logo (required), favicon, primary and secondary colour, the home
  page's title and description, a tagline and a short description, social links (Instagram,
  Facebook, X, YouTube, TikTok, WhatsApp), the public email, phone and address (filled from
  Store info), and a tone of voice. "Continue to templates" stays disabled until the name and
  logo are set; everything else can be skipped.
- **Template gallery**: "Choose a starting point" (first time) or "Change template"; the six
  templates and "Start from scratch" previewed with the store's products, **View demo ↗** (a
  new tab, or the same tab with a Back link), **Use this template**, and "Your current look"
  on the one in use. Switching asks "Keep my words" or "Use template text"; the live site
  doesn't change until Publish.
- **Studio** (full screen, the portal's header and menu hidden): "← Storefront", the template
  and store name, the address, a status ("Unpublished changes", "Same as live site", "Not
  published"); the page picker lists every page of the store, its own pages included, and
  Desktop · Tablet · Phone (as selects below 1180 px; Chat and Preview tabs on a phone). The
  chat ("Design with AI", AI tokens left or "On your own AI key") takes words, a **pasted or
  uploaded image** and a **website address** to take inspiration from; it shows the merchant's
  requests, the AI's reply with what changed in plain words, "Undo this change" on the latest
  one, notes ("Switched to Linen", "Published as version 13", "Changes discarded"), up to four
  suggestions, and the error "I couldn't make that change — nothing on your site changed. Try
  again, or say it a different way." **Edit text** on any words in the preview opens them in
  every language the store offers. **Open preview ↗** (left of Discard, only with a draft)
  opens the draft on the preview host. **Discard** asks first. **End all preview links** (in
  Open preview's menu; `publish` only, so a Manager doesn't see it and the API refuses them)
  asks first: "Anyone you've shared a preview link with loses access now. Your team can open a
  new link from here." with **End links** and **Cancel**. It moves the store's revocation
  number, is recorded as `storefront.preview_links_ended`, and shows "Preview links ended"
  (storefront PREVIEW §5, §8; decided 2026-10-09, #520).
  **Drawn on #487** (`PortalStorefront`, `?state=` keys in designs/design.md §2; storefront
  ARCHITECTURE §6): "End all preview links" (`preview-menu`), its confirmation (`end-links`) and
  "Preview links ended" (`links-ended`); "Opening your studio…" over the current preview while
  the sandbox starts (`opening`); "You're next — about N seconds" while studios queue
  (`queued`); "Finishing your previous change…" when another tab is changing the store
  (`finishing`); "Checking your change…" while the change is checked and repaired
  (`checking`); "Your studio session ended. Reopen the studio to keep designing." with
  **Reopen** (`ended`); a pasted or uploaded image and a website address in the chat
  (`attach`); **Edit text** in every language (`edit-text`); the page picker listing every
  page (`pages`).
- **Publish** asks "Publish version N? We check your whole site first, then it goes live on
  {host} in a few minutes and uses about N build minutes. You can go back to version N−1 any
  time, for free.", shows "Building your site…", "Checking your site…", then "Checking it went
  live…", and ends with "Version N is live — we checked your site and it changed". **Drawn on
  #487**, with "Checking your site…" (`pub-checking`): a refused publish says what failed in plain words and that the live site is unchanged, and
  offers **Publish everything before this change** when one change is to blame (`pub-refused`;
  `pub-refused-all` when none is); a publish rolled back after going live says so ("We put
  version N−1 back: your new version broke the checkout on phones. We're fixing it.",
  `rolled-back`); neither uses a "Publish now" press.
- **Overview, Design tab**: "{host} · version N is live · {template} template", **View live site
  ↗**, **Change template**, **Open studio** or **Continue in studio**; the "Unpublished changes"
  notice with Discard and Continue in studio; the **catalogue Publish now bar** (not drawn;
  styled like that notice, only when catalogue changes wait): what changed and since when
  ("12 products changed since 10:40"), presses left this month, the next automatic publish, and
  **Publish now** (Owner; at zero it explains itself and points to the automatic publish and the
  upgrade); the live site at Desktop or Phone; "'Powered by DripFunnel' shows in your footer on
  {plan}. Remove it" (the upgrade).
- **Pages** and **Journal** tabs (not drawn in the new file; `StorefrontContent`'s drawing):
  content pages (FAQ, lookbook, the merchant's own) and the blog, SUI 17 on SAPI 24. Pages the
  AI made are listed too, opening the studio; a content page can't take a path one of them uses,
  and the reverse (storefront ARCHITECTURE §3.1).
- **Site settings tab**: **Brand** (not drawn; the brand step's fields); **Domains** (SAAS §8);
  **Search and sharing** (title with a /60 count, description /155, a share image from the
  product photos, Google and share previews, Save: "Saved — search engines pick it up within a
  few days. No publish needed."; saving renders the home page again at once, like a new
  product's single-page render, using no allowance, so the wording holds; the other pages pick
  it up with the next publish of any kind, decided 2026-10-08 on #470's review); **AI and build
  minutes** (this month's meters, AI requests, publishes in the last 30 days, recent requests);
  **Version history** (kept for the plan's days, Live, **Go back to this**, which uses no build
  minutes and makes the draft that version).
- **Not in the first release**: the own storefront (AI or own, flow 75).

---

## 15. Settings (Owner only)

| Tab | What ships |
|---|---|
| **Store info** (`SetStore`) | Name, legal name, description, contact, address, tax id, **time zone**, **units**, **order-number format**, logo; **currencies** (auto-converted or typed) and **languages**; the web address and **Connect your own domain** (record → we check → certificate → live, with failure; SAAS §8) |
| **People** (`SetTeam`) | Everyone who works in the store, with invitations waiting; invite, resend, revoke, change role, remove from this store (never the account); the last Owner can't be demoted. Supplier users belong to their company: counted on its row in Supplier, added there by the Owner ("Add a person") and managed by the supplier's own admin in Your team (#295) |
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

**Built on #300**: Settings is a screen (`/settings`, `?tab=` per tab), the Owner's (`settings`); anyone else is
told so and nothing is read, and a read-only store shows every tab without saving. Only the tabs built so far
are offered; each later card adds its own. Store info saves its card, its currencies and its languages
separately, as SetStore does. Converted currencies show an example at the reference rate in use (ECB); a
language shows how much is translated (`translationProgress`). **Your shop's web address and "Connect your own
domain"** moved to Storefront › Site settings › Domains on 2026-10-08 (#470; SAAS §8), built by SAPI 17b
(#471) and SUI 11; Store info doesn't show them.
People lists the store's own people and invitations (#290 part 5's `people`); the Supplier tab gives each
company's access level (all four of ACCESS §5.2, where SetTeam draws three), how it ships and who buys its labels,
suspend (hide or keep selling), reactivate and remove, and the approval switch.
Warehouse lists the store's own locations to manage (the same view as a supplier's tab) and its suppliers'
apart, named and read-only. Tax setup: how prices are typed, with what that means said in words naming the tax ("GST
is part of it" or "worked out at checkout and added"), not a computed amount: the portal never works out money
(ui/README §3); switching only moves the flag (`setPricesIncludeTax`), so the ask says the numbers typed stay and what
shoppers pay changes, and doesn't offer the prototype's "keep what shoppers pay", which nothing in the API does.
Categories show their rate in the home zone and change it there; "Add a rate" makes the category and its home
rate; a US store's rates come from the shopper's state, so it adds none here. Other places' zones are listed;
editing them waits for a drawing. The invoice card keeps the footer as it is (the prototype doesn't draw it).
Markets: the list with each market's countries, currency and state, "everywhere else", and the one picked
beside with what a shopper there sees; countries already in another market can't be picked; a market inside
another copies its currency and language; price adjustment, web address (the main address or a path on it,
never a market's own domain, decided on #337), products not sold there (`Market.excludedProducts`, named), and
duties by code or flat above a threshold. The prototype's delivery charge, tax registration and ways to pay per
market wait for SAPI 23, SAPI 7's follow-up and SAPI 10, which own them; they aren't drawn until those give the
API.
Catalogue: "What do you mostly sell?" switches a preset's sections on (saved with the rest), each product page
section with its switch and plan (the Owner sees "See plans"; anyone else "ask your store owner", P11), and the
badges when they're on: add, edit (what it says and when it shows) and delete. **Legal details used on every
product, store custom fields (decided on #337 to live here) and the "What you're using" meters wait for their
API**: custom fields and default legal details were left on #293, and plan usage comes with Billing (SUI 12).
They aren't drawn until then.

**Built on #315 (SUI 8), part 1**: Payment setup lists the region's providers as `gateways` answers them, the card
gateways apart from the ways paid later, each live, test only (the preview storefront's keys) or not connected, and one
the platform hasn't set up said so with nothing to press. **Stripe connects by OAuth** (decided 2026-10-05 on #337): "Connect"
asks `connectStripe` and follows the address only if it is https; Stripe's way back lands on `/settings/payments`, which opens
this tab, takes the one-time key out of the address and history at once and sends it to `finishStripeConnect` once, however
often the tab mounts. A cancel on Stripe, a failure and each refusal (`EXPIRED`, `ACCOUNT_IN_USE`, `SUPPORT_SESSION`) are said on
the gateways card. PayPal, Razorpay, Cashfree and PhonePe connect with **their own named keys** for live or test (the
prototype draws one "API key"), secrets masked and never read back, a refusal kept in the dialog with what was typed;
each connected mode's webhook address is shown to paste into the provider. Cash on delivery turns on after saying what it
means; a bank transfer asks for the details shoppers pay to, and can change them. Turning off or disconnecting restates what
stops; the only live way to pay can't go (`LAST_METHOD`). Customer accounts picks email, mobile or both, says what shoppers
see and through which text service codes go (MSG91 in India, Twilio in the US); codes go by text only, as the API sends them (the
prototype's WhatsApp waits for a sender). Dropping mobile warns with the count of phone-only shoppers that they can't sign in
while the store takes email only (ACCESS §2.1: the add-an-email step isn't built), rather than the prototype's promise to ask them.
**Part 2, Shipping**: one draft of what the shopper pays, when it's free and where the store delivers, saved over its
revision (`STALE` when someone saved since). The courier's rate, a flat rate and collection in person can be **on at once**
(decided on #337; the prototype draws a choice of one), the flat amount kept as the courier's fallback while only the courier
is on; collection asks for its hours; free over an amount says the amount in words, never a worked-out basket. The couriers
are the partner's accounts (THIRD-PARTY-ACCESS §4), so Connect asks for no key: pricing or standby, "Use for pricing",
Manage (pickups, label size, tracking emails), Disconnect saying who takes over, and Test all with each courier's answer
in the card. "Upload list" reads a CSV or text file in the browser, keeps only codes of the store's country's shape and
sends them at once (`replaceDeliveryArea`). A courier change or an upload reads the settings back without losing what is
typed: an edited field stays, the rest follows the server (a last courier going switches its rate off there).

**API side of Developers, #330 part 1** (SUI 14 draws it): `apiKeys` (name, prefix, scopes, supplier, who made it and whether
they're still an Owner, expiry, last used, until when a rotated-from secret works), `apiKeyChoices` (the scopes a key may hold,
the lifetimes 30, 90 and 365 days or never, the 50-key cap and the calls a minute and month), `createApiKey` and `rotateApiKey`
(each answering the secret once) and `revokeApiKey`. The prototype's "Change products", "Change stock" and "Update orders" aren't
offered yet: a key reads the catalogue, stock, orders and customers only (ACCESS §5.6, decided on #330).
**Part 2**: `webhookEvents` (the six SetDev draws), `webhooks`, `webhookDeliveries(endpointId)` (event, status, attempts, response
code, error code, time), `saveWebhook` (the signing secret answered when it is made), `removeWebhook`, `turnOnWebhook` (answers how
many waiting events it sends) and `replayDelivery`; Apps' `installableApp` (the consent screen), `apps`, `installApp(appId, scopes)`
and `uninstallApp`. The prototype's install link names its app: the portal takes the app's id from it.
**Built on #333 (SUI 14), part 1, Developers › API keys**: the keys newest first, each by its prefix only (`dfk_…`), with what it
can do, the whole store or one supplier, last used, who made it (or that they're no longer here), when it expires and until when
a rotated-from secret still works. "Create API key" asks a name, what it can do (`apiKeyChoices.scopes`), whole store or one
active supplier and a lifetime (`expiresInDays` or never); the secret from `createApiKey` or `rotateApiKey` is shown once, in a
card with Copy, until "I've stored it", and never read back. Rotate and Revoke each restate what happens first. The list reads
itself again after each write rather than the whole tab, so a secret on screen survives it; a refusal stays in the form or on the
card it came from. **Not drawn yet**: the prototype's storefront key and "Websites allowed to use it", which the Store API doesn't
read or change (an open question on #333); the 50-key cap is the API's to refuse (`TOO_MANY_KEYS`), not counted in the browser.
**Part 2, Developers › Webhooks**: each endpoint with its address, its events and its state (working, failing since when, or turned
off with "Turn back on", which says how many waiting events it sends). "Add endpoint" takes an https address and at least one of
`webhookEvents`; the API refuses a private or unreachable one, said in the form, and the signing secret is shown once like a key's.
"Recent deliveries" opens one endpoint's latest ten (when, event, the server's code or what stopped it, how long it took) with
"Send again" (`replayDelivery`); only the newest opening lands. Removing or
editing an endpoint waits for a drawing (SetDev draws neither; `removeWebhook` is in the API, an open question on #333).

## 16. Billing (`PortalBilling`, Owner only)

*Billing is not in the merchant mobile app, and the app's Close my store is in Settings › Store
info ([mobile-app/merchant/FIRST-RELEASE.md](../../mobile-app/merchant/FIRST-RELEASE.md) §1,
decided on #493). This section is the web portal's.*

The partner's plans with monthly or yearly prices and what each includes (from the Platform
API's plan catalogue, never hard-coded), switch now with **proration** or at period end, the
dates from the billing period; this month's usage (bandwidth, products, staff, AI tokens), where a
plan row that is **Unlimited** (SAAS §6.1) reads "Unlimited" with no bar and is never counted near a
limit; buy extra bandwidth; storefront setup by the partner's team where the plan offers it; the **card
that pays for the plan in a hosted field**, never the shoppers' payments; details on invoices;
invoices with PDF and export; **Close my store** with "Download my data first" (products, orders,
customers) and "Move to Free instead". Who charges is the partner or DripFunnel on its behalf
(SAAS §7.1) and the screen says which.

**Built on #329 (SAPI 19), part 1**: `subscription` (plan, status, period, a scheduled change, the
card's brand, last 4 and expiry, who collects, when Stripe last spoke), `planCatalogue` (the
partner's Live plans priced in the store's currency, each with every value it sets, Unlimited as
such), `usage` (products, staff and suppliers counted now; AI prompts and "Publish now" this
month; bandwidth has no meter yet, so it isn't answered), `planChangeQuote` (what is offered, the
charge, the credit, today's amount, from when, the next price), `changePlan`, `setPaymentMethod`
(a Stripe `pm_` token only; while past due it also tries the open invoice, and it works while
read-only), `billingDetails` and `saveBillingDetails` (a GSTIN in India, a VAT number in the EU),
`invoices` and `downloadInvoice`. The Owner's only (`billing`), never a support session's or an
impersonation's writes. A partner that bills its merchants itself answers `BILLED_BY_PARTNER`.
`buyBandwidth` and `buySetup` wait for a bandwidth meter and the partner's setup offer.

**Part 2**: `planKeep` and `keepProducts(ids)` (Choose what to keep, for products: SAAS §6.2),
`cancelStore` (SAAS §4.2: read-only now, the storefront selling until the paid period ends) and
`exportStoreData`, whose id `storeDataExport(id)` reads back as its products, orders and customers
parts (`store.export`, the Owner in person only, also while read-only). A trial that ends with no
plan moves to the free plan with the picks applied, or is past due where the partner has none.

**Built on #332 (SUI 13), part 1**: Billing (`/billing`, the Owner's, `billing`) reads `subscription`, `planCatalogue`
and `usage` in one request: the partner's plans for the period switched to, who charges, this month's usage and the
card. A plan change reads `planChangeQuote` first, `NOW` and, where offered, `PERIOD_END`, and the dialog states today's
charge, the credit, the date and the next price before `changePlan`; a refusal stays in the dialog. A support session
reads and changes nothing; while past due the Owner may still choose a plan. Decided here:
- **Prices are the API's, as charged**: the yearly price reads "/year", never split into months, and the switch claims
  no saving (ui/README §3). The button's words (Upgrade, Switch at period end) follow the API's ranking by monthly
  price; when it happens is the quote's.
- **A plan's card leads with products, staff, markets and bandwidth**, as the prototype's do, and "What each plan
  includes" lists every value the plan carries in the API's order (decided on #337), a choice by name and a monthly
  quota "a month". A usage row whose limit is 0 with nothing used is a feature the plan leaves out, not a meter.
- **Not drawn**: the prototype's AI card (own key), Storefront setup and Buy extra bandwidth, which the API doesn't
  offer (`buyBandwidth` and `buySetup` wait, above); and Billing's own trial and past-due strips, which the shell shows.
  A scheduled change has its strip, and the plan it keeps offers "Keep" (the API calls the change off).
- **The card is shown, not yet changed**: brand, last 4 and expiry. Stripe's hosted card field needs a publishable key
  the Store API doesn't answer, so adding or changing the card waits for it (open question on #332), and a paid plan
  without a card is held at the dialog with the reason rather than refused as `NO_CARD`.

**Part 2** adds the details on invoices (`billingDetails`, `saveBillingDetails`, the Owner's and not while read-only)
and the invoices (`invoices` ten a page with Show more, Export all, and `downloadInvoice` for the PDF), read with the
rest, with `storeInfo` to start the details from. Decided here: the details start from Store info's until saved, the
country is typed as two letters and the API checks the tax number; **Export all** is a CSV the browser builds from every
page, since the API has no invoice export; a PDF opens only at a Stripe https link.

**Part 3**: **Choose what to keep** (`/billing/keep`, PortalKeep) reads `planKeep` and the products by name, ten
a page with Show more, ticked as the API keeps them; what has an order waiting to ship is ticked and can't be unticked; one more than
the plan keeps is refused on the page; Save sends the Owner's picks to `keepProducts`, not while read-only. Reached from
the trial-ending strip, a scheduled change's strip and, in the trial, "Or choose what to keep on {free plan}".
**Close my store…** restates what closing does (a paid plan sells until its period's end, a trial or free plan closes
at once; everything kept 90 days) and offers Download my data first (`exportStoreData`, its three parts read back every
3 seconds until settled, each a download, the job's id kept per store for the tab so a reload picks it up, and forgotten once the API no longer answers for it), Move to {free plan}
instead (that plan's quote and change, then Choose what to keep) or Close my store (`cancelStore`). A closing store's
strip says until when, with Download my data. Decided here: **only products are chosen**, as the API pauses only
products (SAAS §6.2), so the prototype's team, supplier, market, payment, courier and location cards aren't drawn; the
rows carry no "N sold", which the API doesn't answer; and **no "Keep my store"** once closing, since the API has no way
back from `cancelStore` (open question on #332).

## 17. Supplier views

**Your products** (only theirs, with counts and empty states; stock only for the Stock-only tier;
add and edit for the catalogue tiers, waiting for approval when it's on; export; import for the
catalogue tiers), **To ship** (their lines by shipping mode), **Your sales** (own lines, no
totals) and **Your team** (Supplier admin: invite, change admin or member, resend, remove, never
the last admin; DATA-MODEL §4.2). Their own warehouses and stock. Never offers, customers beyond
§6, plans, other suppliers or the store's totals.

**Built on #327 (SUI 15)**: Your products and To ship are Products' and Orders' supplier views (#298, #314), and a
Stock-only supplier's menu row says "stock only" (§3.1). **Your sales** (`/sales`) reads `mySales` in pages of 25:
order and day, product and version, quantity, the line at the price sold, and its status; the note that the store
settles outside the portal; and Export CSV, the supplier's own orders export (`exportOrders`). It asks the API only
for a seat that holds `sales.read`, and tells every other seat it has no access. Decided here: **no status chips and no
shipping status on Your sales**, because `mySales` answers the order's state and the units refunded but not the part's
shipping, and has no filter: a line is Sold, "N of M refunded", Refunded or Cancelled, and its dates are UTC (a
supplier reads no store settings).
**Your team** (`/team`, part 2 of #327) reads `mySupplierTeam` and invites (member or admin), resends, cancels, changes
the role and removes (restating that they lose access at once); the last admin's menu explains why nothing can change,
and a refusal such as the server's `LAST_ADMIN` stays in the dialog that asked. It asks the API only for a seat that
holds `supplier.team`, and tells every other seat it has no access. Decided here: a member's invitation choice is worded
with the supplier's access level ("Supplier member — Stock only"), and the rows reuse Settings › People's (#290).

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
| Orders and Customers hide totals, payment and spend from Staff | Staff see them: ACCESS §5.1 gives Staff `orders.read`, `customers.read` and the customers export with spend, and the API answers them (decided on #314's review) | rule |
| ~~No "Your sales", "Your team", Customer accounts, Developers, Apps, Support access, store activity log, services, gift cards or digital file upload~~ | Drawn by SUI 1 (#286) | resolved |
| Abandoned-cart reminders by WhatsApp in India (MISSING-FEATURES) | WhatsApp reminders ship with email, through MSG91 (decided 2026-10-05 on #337) | scope, decided |
| Payment setup pastes one "API key" for every gateway, Stripe included | Stripe by OAuth (decided on #337); every other provider its own named keys for live or test (#315) | rule |
| Shipping's "What the shopper pays" is a choice of one, and a courier connects with a pasted account key | Any of the courier's rate, a flat rate and collection at once (#337); couriers on the partner's accounts, connected without a key (THIRD-PARTY-ACCESS §4) | rule |
| Payment setup offers PayPal and Klarna for Germany | The launch regions are India and the US (§1); the DE region stays a prototype control | scope |
| The sandbox's stock-reason values | The list #183 settled is what DATA-MODEL stores | behaviour, decided |
| Home shows Staff the returning customers, and a Manager the approval queue | Staff get no returning customers and a Manager no approval queue, withheld by the API (§20 SAPI 18, ACCESS §5.1 `reports.read`, `approve`; #322) | rule |

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
| | *Built on #293 (part 1): `products(filter, search, supplier)`, `productCounts`, `product(id)`, `saveProduct` (create, or update at the revision read; simple products as one version, up to 3 options and 100 versions, a price in the pricing currency required), `duplicateProduct` (a hidden copy, no product codes), `deleteProducts` (soft), `updateProducts(ids, patch: { visible })` (merchant side); amounts are minor units as strings with their currency. Part 2: photos (up to 20, in order, each for the product or one version) and a video (an upload or an https link) on `saveProduct`, the Missing info chip (no photo or no description), and `uploadAsset` as `POST /api/assets` with the raw file, read back at `GET /api/assets/{id}` in the caller's scope. That is an upload through the Worker, as the partner's brand files are, not a signed R2 URL, which needs S3 keys the local setup doesn't have. JPEG, PNG and WebP up to 20 MB, MP4 and WebM up to 30 MB, the type read from the bytes. The Low stock chip comes with stock. Part 3: `facets` (paged in the filters' order, each value with its product count in the caller's scope; a supplier reads them to tag its own products, the one structure query it reaches; up to 200 filters a store), `collections`, `collection(id)`, `collectionProducts(id)` (its products a page at a time in its order), `menu`, and `saveFacet`, `deleteFacet`, `mergeFacetValues`, `saveCollection` (hand-picked in order, or automatic by any or all of: a filter value, name contains, a product, a version, a price range; optionally only inside its parent), `deleteCollection`, `saveMenu` (the main menu, one level of nesting, links to a collection, a shop page or an https address), and `filterValues` on `saveProduct`. Part 4: `catalogueSettings` (each section's switch and, for the merchant side, whether the plan has it; a supplier hears only whether a section is there, P11), `saveCatalogueSettings` (Owner; a plan section switches on only when the plan has it), `saveBadge`, `deleteBadge`, `sizeCharts` (paged, without the rows), `sizeChart(id)`, `saveSizeChart`, `deleteSizeChart` (answering how many products lost it; a supplier makes and keeps its own, R13; `size_charts` on the plan), and `listing` and `sizeChartId` on `saveProduct` (specifications, highlights, FAQs, related products, manual badges, age check and hazard flags, legal fields per region, where it sells), each section left out kept as it is. Part 5: A+ content, `productStory(productId)` (the draft, its status `draft`, `live` or `changed`, and its revision; readable after a downgrade, Q12), `saveProductStory` (a draft saved unfinished, up to 10 modules of the CatAPlus kinds), `publishProductStory` (refused as `STORY_INCOMPLETE` with each module and field still to fill, a photo with no description among them; an empty draft takes the story off the page), `copyProductStory(fromProductId, toProductIds)` (into up to 50 products' drafts, Q6), and the merchant side's brand stories, `storyBlocks` (paged, each with how many products use it), `storyBlock(id)`, `saveStoryBlock`, `deleteStoryBlock` (refused while in use); writing needs `aplus` on the plan. A supplier's story is published as its product saves until approval (SAPI 5) reviews it with the product (Q11). **#294 (SAPI 4)**: `warehouses` (paged; the merchant side also reads suppliers' locations and their counts, never changing them), `saveWarehouse`, `setDefaultWarehouse`, `deleteWarehouse` (not the default, nor one holding stock; up to 20 an owner; every store starts with its "Main location"), `productStock(productId)` (on hand and reserved per version and location), `stockHistory(productId, versionId)` (paged, newest first, with the reason, who, where and the result), `adjustStock` (received, returned, damaged, counted), `setStock` (typed numbers, up to 100 in one save; a location's first count is "Starting stock"), `setLowStockThreshold` (default 5), the Low stock chip and the list's stock. Reserving at payment, releasing and the 3-day bank-transfer cancellation come with orders (SAPI 9, SAPI 11), which write `reserved` **#295 (SAPI 5)**: part 1, a supplier's requests run as their own database role, `app_supplier` (DATA-MODEL §5.3). Part 2, Settings › Supplier (Owner, `manage-vendors`): `suppliers(filter: all | active | suspended)` (paged, newest first, each with its users and products), `supplierCounts`, `supplier(id)`, `inviteSupplier` (the company and its first user, a Supplier admin, in one; a name unique in the store whatever its case; `suppliers_enabled` and the `suppliers` limit on the plan, refused with nothing written), `setSupplierAccess`, `setSupplierShippingMode(shippingMode, labelAccount)`, `suspendSupplier(hideProducts)`, `resumeSupplier` (what a suspension hid comes back as it was), `removeSupplier` (its people and invitations end, its products hidden and kept as its own, its name free again). The supplier is `invited` until its first user joins; an invitation into a suspended or removed one no longer works. Part 3: `addSupplierPerson(id, email, role)` (the Owner's "Add a person", a member by default, an admin to appoint one; refused while suspended) and Your team, a Supplier admin's (`supplier.team`) own supplier only: `mySupplierTeam` (paged; people and open invitations, each with `you` and `lastAdmin`), `inviteSupplierUser(email, role)`, `resendSupplierInvitation`, `revokeSupplierInvitation`, `changeSupplierRole`, `removeSupplierUser`; never the last admin (`LAST_ADMIN`). Part 4, approval (ACCESS §7.2, CATALOG L): `supplierApprovalRequired` (read by everyone in the store), `setApproval(on)`, `approveProduct`, `sendBackProduct(reason)` (the Owner's, `approve`), `navBadges { products }` (the merchant side's count of what waits); while it's on a supplier's new product is made hidden and pending, and its save of an approved one whose name, a price or photo set changed, of one sent back, or its A+ published (Q11), puts it back in the queue; `saveProduct` answers `approval` and `reviewed` (which of the three changed) for E3's wording. Turning approval off leaves the queue as it is. A Stock-only supplier proposes with `proposeProduct` (waiting for approval whatever the switch says; no edit after). While the store is past due its suppliers keep working and read `readOnly: false` (§1). Left on the card: a supplier's translations wait for approval with SAPI 6 (N16). **#296 (SAPI 6)**, part 1: `storeLocale` (the main language and pricing currency, the store's languages and currencies with removed ones kept, the offered languages; merchant side, `catalog.read`), `saveLanguages(languages, main)` (en-IN, en-US, hi-IN; the plan's `languages` counting the main one), `saveCurrencies` (each `convert` with a rounding or `manual`; the plan's `currencies` counting the pricing one), `markets` (paged), `market(id)`, `saveMarket` (at the revision read; countries no other top-level market has, a sub-market within its parent's and none of its siblings'; a currency and language the store offers; the main address or a path; all products or all but some; duties none, by code or flat), `deleteMarket` (never the primary Home market; its sub-markets become top-level), `setEverywhereElse(marketId)`; the Owner writes (`settings`). Markets on their own domain are left out (one domain per store, #337); payments per market wait for SAPI 10, delivery charges for SAPI 23. Part 2: `product.pricing(marketId)` (merchant side; each version's price in every currency the store sells in, typed or converted, and in the market named: its currency's price moved by its adjustment and rounded), `storeLocale.rates` (the reference rates in use and their date), `storeLocale.examples` (100 of the pricing currency in each currency with a rate under each rounding, worked out as a price is, for SetStore's example; added on #300's review), the `rates.refresh` job (ECB, every six hours), and a supplier's prices in the pricing currency only (O14). Fixed prices per market wait for the plan question on #296. Part 3, translations (facts 18–22, N): `productTranslation(productId, language)` and `saveProductTranslation` (name, web address, description, versions' names, and, for the merchant side, the shared option and choice names; each row with its main text and `translated`, `changed` or `missing`; a supplier its own products, waiting for approval while it's on, N16), `catalogueTranslation` and `saveCatalogueTranslation` (a collection, filter or filter choice; merchant side), `sharedNames(kind, language)` and `saveSharedNames` (N6), `translationProgress(language)` and `products(untranslatedIn)` (fact 19); into the store's other offered languages only. Per-language SEO, photo alt text (facts 21, 23) and suggested translations (fact 24) stay `(release: decide)`. Part 4, Store info: `storeInfo` (merchant side) and `saveStoreInfo` (Owner): name, legal name (in invoice settings), description, logo (one of the store's images), address in any format, contact, the home country's tax id (GSTIN; EIN or sales-tax permit; VAT number), time zone, units, order prefix and next number; the country is set at sign-up. **#297 (SAPI 7)**: `taxSetup` (prices including tax, the classes with their Stripe tax codes and how many versions each, the zones with their rates; merchant side), `setPricesIncludeTax`, `saveTaxClass` (and making one the default, products with none keeping their rate), `deleteTaxClass` (never the default or one in use), `saveTaxZone` (countries, regions, a rate per class), `deleteTaxZone`, `invoiceSettings` and `saveInvoiceSettings` (the Owner writes, `settings`); a version's `taxClassId` on `saveProduct` (the merchant side's; a supplier's take the default); `taxQuote(lines, shipTo)`, which carts (SAPI 9) price with: India's GST as CGST and SGST within the store's state and IGST across states, a US store's own state rates without Stripe (decided on #337), and Stripe Tax on its connected account once payments (SAPI 10) connects it. **#298 (SUI 4)**, what the list needs of the API: `products(sort:)` (created, updated, name, price either way, stock; each sort paged by its own cursor), `readiness` per market on each row and on the product (merchant side; CATALOG T2), `addProductsToCollection` and `setProductsTaxClass` (the bulk actions). What the editor needs: `productCollections(productId)` (the hand-picked and automatic collections a product is in) and `setProductCollections(productId, collectionIds)` (replaces its hand-picked set, answering the memberships), both merchant side only, a supplier refused; and `related { id name }` on `ProductListing`. `catalogueSettings` also answers the store's `pricingCurrency`, `unitSystem`, `mainLanguage` and `translationLanguages` to every seat in the store, a supplier included (N15). The editor's language tabs use `productTranslation` and `saveProductTranslation` (#296); Shoppers abroad reads `storeLocale.currencies` and `product.pricing` and saves a hand-priced currency's price, with its stored compare-at, on `saveProduct`; Price per market reads `product.pricing(marketId)` for every market in one request. Fixed prices per market are not built: they wait for the plan question on #296. **#299 (SUI 5)**, what the Collections screens need of the API: `collectionPreview(match, rules, parentId, inheritParent)` (the live preview: how many products the rules not yet saved would hold and the newest six, refused as a save of the same rules would be; merchant side), and rules read as CatCollections writes them: under "all", values of one filter are alternatives ("Fabric is Cotton or Linen and Occasion is Wedding", CATALOG H4); `collections` answer each one's rules, match and parent limit, for the list's wording; and a filter's `revision` (migration 0057): an update through `saveFacet` names the revision it read (refused as `INVALID_INPUT` without one) and a save from an older one is refused as `STALE_REVISION`, and a merge moves it on, so a save from an old read can't delete a value added since. **#301 (SAPI 16)**, part 1, exports: `requestCatalogExport(kind: products | stock, filter { filter, search, supplier })` (the list's chips, search and supplier filter; Staff and up on the merchant side, `exports`, every supplier tier its own, `exports.products`, its supplier filter ignored; allowed while read-only, never for a read-only support session), `catalogExport(id)` and `catalogExports` (the asker's own ten newest: `queued`, `done`, `failed` or `expired`, the CSV for an hour). The products file is one row a version in Shopify's shape, the product's own columns on its first row: handle, name, description, type, visible, three option names and values, SKU, barcode, price, compare-at price and cost in units, weight in grams, the count in the owner's default location, then `name:<language>` and `description:<language>` for each other store language and `price:<currency>` for each hand-priced currency (K10, K11); the stock file is a row a version and location with on hand and reserved. Up to 10,000 rows, saying where it was cut. Part 2, import (Owner and Manager; a supplier at a catalogue tier its own products, `catalog.import`): `catalogImportTemplate` (our columns with the store's language and hand-priced currency columns and an example row; no visibility or currency columns for a supplier), `startCatalogImport(file)` (a CSV of up to 5 MB, 20,000 rows and 5,000 products, ours or Shopify's product export, told apart by its header), `catalogImport(id)` (the check: products, ready, matched by SKU, and problems by line and column in plain words; then the run's created, updated, skipped and failed, and the error file), `catalogImports` (the asker's ten newest, for the shell's banner), `confirmCatalogImport(id, matching: update | skip, warehouseId)` (the importer's own location, its default if none). Nothing is written until it's confirmed. Each product goes through the same save as the editor, so plan limits, approval and validation are the editor's; an update keeps the web address and the versions the file doesn't name, and a currency the file doesn't price keeps its price. SKUs match only among the importer's own products: a supplier's row with a SKU the store or another supplier uses makes the supplier's own product, since SKUs are unique per owner and saying the SKU is taken would tell it another's catalogue. Photos (`image`, Shopify's `Image Src`) are fetched for new products only, from https addresses on public names that resolve only to public addresses, each redirect checked again, within 3.5 seconds, two tries, 20 MB; one that fails is listed against its line. Part 3, Connect Shopify (K7; the importer's own shop, the store's or a supplier's): `shopifyConnection` (`available` false where no Shopify app is set up, and the status: none, pending, connected or expired), `connectShopify(shop)` (a `*.myshopify.com` address only; answers the address to approve the app at, which comes back through `hooks.<host>/shopify/callback` and on to `/products/import?shopify=finish&key=…` or `=failed`), `finishShopifyConnect(key)` (the screen sends the callback's one-time key; only the person who started the connection, in their own session, finishes it, so a link can't attach someone else's shop), `shopifyProducts(after, search)` (the picker's pages of 25, newest first), `startShopifyImport(productIds | all)` (up to 250 picked, or every product, read a page at a time into the import, which is then checked and confirmed like a file; reading stops at a file's limits, 5 MB, 20,000 rows or 5,000 products, and the import ends saying which), `disconnectShopify`. The token is sealed and never shown; it goes once the import has read the shop, or after a day unused, so each import connects again; a token Shopify refuses makes the connection `expired`. Values to set: `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` from a Shopify app (THIRD-PARTY-ACCESS §3.4); locally `SHOPIFY_LOCAL=1` answers with an empty shop.* | |
| | *Built on #290: `brand`, sign-up (SAAS §4.1, steps 1–3 of §5), sign-in with 2-factor, invitations (`/accept-invite`, `/join`) and password reset under `/api/auth/*` (ACCESS §4), the Profile row (`profile`, `mySessions`, `myActivity` and its mutations, email confirmed at `/api/auth/confirm-email`), Settings › People (`people`, `peopleCounts`, `inviteMember`, `resendInvitation`, `revokeInvitation`, `changeRole`, `removeMember`), `me`, `myStores`, `storeState`, `switchStore`; `navBadges` comes with the tables it counts (SAPI 5's approvals, SAPI 11's orders), and `storeState`'s import job with SAPI 16* | |
| Profile | `profile`, `mySessions`, `myActivity` | `updateProfile`, `setTheme` (the theme alone), `changeEmail`, `changePassword`, `setSecondFactor`, `regenerateBackupCodes`, `signOutOtherSessions` |
| Home | `home` | |
| Orders | `orders(filter)`, `order(id)`, `orderCounts` | `shipItems`, `bookLabel`, `addTracking`, `startReturn`, `receiveReturn`, `cancelReturn`, `refund` (with `override`), `cancelOrder`, `markPaid`, `addOrderNote`, `exportOrders` (job) |
| Customers | `customers(filter)`, `customer(id)`, `customerGroups` | `addCustomer`, `updateCustomer`, `setCustomerTags`, `setCustomerNote`, `recordMarketingStop`, `createGroup`, `updateGroup`, `deleteGroup`, `exportCustomers` (job) |
| Offers | `offers(filter)`, `offer(id)`, `checkCode(code)`, `offerResults(id)` | `saveOffer`, `pauseOffer`, `endOffer`, `duplicateOffer`, `deleteOffer`, `generateCodes`, `exportOfferCodes` (job) |
| | *Built on #320 (part 2): `offers(status, kind, trigger, search)` (status `live`, `scheduled`, `off` or `ended`, Used up under Ended; kind `products`, `order`, `bxgy` or `shipping`; search by name, team note or any part of a shared code, never a single-use one), `offerCounts` (the tabs), `offer(id)`, `saveOffer(id, revision, input)` (a new offer without `id`; `enabled` and `startsAt` are Start now, Schedule and Keep off; `STALE_REVISION` with the revision, `CODE_TAKEN` with the offer holding it and its status, deleted included, `UNKNOWN_TARGET`, `CURRENCY_NOT_SOLD`, `PLAN_LIMIT` with `offers`, `group_offers` or `live_offers`), `pauseOffer`, `resumeOffer` ("Turn back on", held to the live limit), `endOffer`, `duplicateOffer`, `deleteOffer` (soft). A changed shared code stops working and stays the offer's. Owner and Manager write, Staff read; the live limit counts live and scheduled offers, under the store's lock, so a downgrade keeps them running and blocks one more.* | |
| | *Part 3: `generateCodes(offerId, count, prefix, length)` (a run of up to 5,000 single-use codes, readable with no 0/O or 1/I, from the Worker's random source, at most 100,000 an offer; `group_offers`; `NOT_A_CODE_OFFER` for an automatic one), `offerCodeBatches(offerId)` (cursor-paged, newest first) with each run's used count; `CODES_EXHAUSTED` when a prefix leaves too few new codes to draw, `exportOfferCodes(batchId)` (`offers.export`, a job read back by its asker with `offerCodesExport(id)`, never by a read-only support session), `checkCode(code)` (the offer, whether the code is single-use or used, and `answer`: `WORKS`, `INVALID`, `EXPIRED` or `USED_UP`, what a shopper meets; null alike for a malformed, a missing and another store's code; 30 a minute per person and store, `OFFER_CODE_RATE_LIMITER`, refused where unbound), `offerResults(id)` (uses, discount given, sales with the offer and the average order per currency, uses per day for 30 days in the store's time zone; `offer_results`).* | |
| Abandoned carts | `abandonedCarts(filter)`, `cartSummary(range)`, `reminderSettings` | `saveReminderSettings`, `remindNow(cartId, discount)`, `sendTestReminder` |
| | *Built on #321 (part 1): `reminderSettings` (the three steps, minimum, switches, `revision` and the plan's `level`; the prototype's starting words until the store saves) and `saveReminderSettings(revision, input)` (`carts.write`; `STALE_REVISION`; `PLAN_LIMIT` with `key: cart_reminders` for anything the plan doesn't allow that wasn't saved already; WhatsApp in India only). Shop API: `restoreCart(token)` (the cart, a guest's new `cartToken`, or `signInRequired`) and `unsubscribe(token)`, each limited per host and address with one refusal, `LINK_INVALID`.* | |
| | *Part 2: `abandonedCarts(tab: open\|recovered\|lost, search)` (cursor-paged, newest left first, each with its `status`: recovered, stopped, no_contact, opted_out, skipped, not_recovered, reminded or waiting), `abandonedCartCounts`, `abandonedCart(id)` (its lines as they would be bought now and its reminders), `cartSummary(days)` (14 unless asked, at most 90; a recovery counts once its order is paid); `remindNow(cartId, discountPercent)` (`CANT_REMIND` for a cart bought, stopped, expired or with no email; `PLAN_LIMIT` for a second one or a code below `automatic`), `stopCartReminders(cartId, note)`, `resumeCartReminders(cartId)`, `sendTestReminder(position)` (to the person's own email, limited per person and store). All `carts.read` or `carts.write`, merchant side only.* | |
| Reports | `report(days, currency)` with its panels, `reportExport(id)`, `reportExports` (built on #322) | `exportReport(panel, days, currency, custom)` (job; `panel: custom` is the custom report builder) |
| Products | `products(filter, sort)`, `productCounts`, `product(id)`, `productStock(productId)`, `stockHistory(productId, versionId)`, `readiness(productId)`, `catalogExport(id)`, `catalogExports`, `catalogImport(id)`, `catalogImports`, `catalogImportTemplate` | `saveProduct`, `updateProducts(ids, patch)`, `deleteProducts`, `adjustStock(versionId, warehouseId, delta, reason)`, `setStock(entries)`, `setLowStockThreshold`, `approveProduct`, `sendBackProduct(reason)`, `uploadAsset` (signed upload), `writeDescription` (AI, metered), `requestCatalogExport(kind)` (job: products or stock), `startCatalogImport(file)`, `confirmCatalogImport(id, matching, warehouseId)` (jobs) |
| Collections | `collections`, `facets` (the one a supplier reaches too, counting its own products only), `menu`, `sizeCharts`, `productCollections` (merchant side) | `saveCollection`, `deleteCollection`, `saveFacet`, `mergeFacetValues`, `saveMenu`, `saveSizeChart`, `deleteSizeChart`, `setProductCollections` (merchant side) |
| Import | `catalogImport(id)`, `catalogImports`, `catalogImportTemplate`, `shopifyConnection`, `shopifyProducts` | `startCatalogImport(file)`, `confirmCatalogImport(id, matching, warehouseId)`, `connectShopify`, `finishShopifyConnect`, `disconnectShopify`, `startShopifyImport`. No pause: a run carries on on the server, chunk by chunk |
| Storefront (SAPI 17, #318) | `storefront` (live version, draft, history, usage, publishing status), `storefrontTemplates`, `designChat`, `studioSession` (starting, queued with its place, ready, busy), `publishRun(id)` (steps and the gate's plain-words result), `designText(page, locale)`, `previewLink` | `chooseTemplate(key, keepWords)` (refused until the brand is ready), `askDesign(text, imageAssetId, sampleUrl, page, device)` (AI request, run in the store's sandbox), `saveDesignText(locale, key, text)`, `undoDesignChange`, `discardDraft`, `publishDesign`, `publishBefore(messageId)`, `goBackToVersion(n)`, `publishNow` |
| Storefront site settings (SAPI 17b, #471) | `storefrontBrand` (with `brandReady`), `storefrontSeo`, `storefrontDomains` | `saveStorefrontBrand`, `saveStorefrontSeo`, `connectDomain`, `checkDomain`, `makeDomainPrimary`, `removeDomain` |
| Settings | `storeInfo`, `people`, `suppliers`, `gateways`, `shipping`, `warehouses`, `tax`, `markets`, `catalogueSettings`, `customerAccounts`, `apiKeys`, `webhooks(…deliveries)`, `apps`, `supportAccess` (+ log) | `saveStoreInfo`, `saveCurrencies`, `saveLanguages`, `inviteMember`, `changeRole`, `removeMember`, `inviteSupplier`, `setSupplierAccess`, `setSupplierShippingMode`, `suspendSupplier(hide)`, `removeSupplier`, `setApproval`, `connectGateway`, `disconnectGateway`, `saveShipping`, `connectCourier`, `testCouriers`, `saveWarehouse`, `setDefaultWarehouse`, `saveTax`, `saveInvoiceSettings`, `saveMarket`, `saveCatalogueSettings`, `saveBadge`, `saveLegalDefaults`, `setCustomerSignIn`, `createApiKey` (secret shown once), `rotateApiKey`, `revokeApiKey`, `saveWebhook`, `replayDelivery`, `installApp`, `uninstallApp`, `setSupportAccess`, `answerSupportElevation(allow)` |
| Activity (Owner, and Manager as Store activity) | `activityLog(filter)` (`activity.read`, Owner and Manager, shoppers included), never behind the Settings permission; `activityExport(id)` reads the job back (built on #331: the filter is person, what, result, search and dates, 50 a page) | `exportActivity` (job, `activity.export`, Owner only) |
| Billing | `subscription`, `planCatalogue` (the partner's), `usage`, `invoices`, `billingDetails`, `planChangeQuote(plan, period, when)`, `downloadInvoice` (a read, as the partner's), `planKeep`, `storeDataExport(id)` | `changePlan(plan, period, when)`, `setPaymentMethod(token)`, `saveBillingDetails`, `buyBandwidth`, `buySetup`, `keepProducts(ids)` (Choose what to keep), `cancelStore`, `exportStoreData` (job) |
| Supplier | Only these, seller-scoped, by ACCESS §5.2's tier: `me` and `storeState` **masked** to what the shell needs (person, role, tier, store name, the read-only flag; never the plan, trial or billing state, §2), `myStores`, `navBadges`, the Profile queries; `products`, `productCounts`, `product`, `facets` (to tag its own products; each value's count is of its own products only), `productStory`, `productStock`, `warehouses` (their own), `stockHistory`, `readiness` (`catalog.read`, `stock.read`); `catalogExport` and `catalogExports`, its own exports only (`exports.products`); `catalogImport`, `catalogImports` and `catalogImportTemplate`, its own imports only (`catalog.import`); `shopifyConnection` and `shopifyProducts`, its own connected shop (`catalog.import`); `orders`, `order` and `orderCounts` for their own lines only, so the To ship chips count nothing else (`orders.read`); `mySales` (`sales.read`, no totals); `mySupplierTeam` (Supplier admin). **Every other query is refused**: `home`, `customers`, `offers`, `abandonedCarts`, `report`, Collections but `facets`, Settings, Billing | Only these, by tier: `saveProduct`, its `filterValues` tagging its own products with the store's filter values, `saveProductStory`, `publishProductStory`, `copyProductStory` (`catalog.write`), `adjustStock`, `setStock`, `setLowStockThreshold`, `saveWarehouse`, `setDefaultWarehouse`, `deleteWarehouse` (`stock.write`, `warehouses.write`), `shipItems`, `addTracking` on their own shipments, `refund` on their own lines (`orders.fulfil`, `orders.refund`), `requestCatalogExport` (`exports.products`, its own rows), `exportOrders` (`exports.orders`, the two order tiers only), `startCatalogImport`, `confirmCatalogImport` (`catalog.import`, writing only its own rows), `connectShopify`, `finishShopifyConnect`, `startShopifyImport`, `disconnectShopify` (`catalog.import`, its own shop), the Profile mutations; `inviteSupplierUser`, `changeSupplierRole`, `removeSupplierUser` (Supplier admin). Every other mutation is refused |

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
**Built on #306 (SAPI 8), part 1:** the store comes from the host (`{code}.` under the partner's shops or preview wildcard,
or the live custom domain) or the `X-Shop-Key` header (the public store key, `storefront.public_store_key`); a key naming
another store on a store's own host is refused (`WRONG_STORE_KEY`), an unknown host answers 404. The language, currency
and market come from `X-Shop-Language`, `X-Shop-Currency` and `X-Shop-Market`, falling back to the store's own when it
doesn't offer them. Every call is rate-limited per host and address (600 a minute); a suspended or closed store answers
`STORE_UNAVAILABLE`, a past-due one keeps selling. Shoppers run as `app_shop` (DATA-MODEL §5.3, §7.11). Queries: `store`,
`menu`, `collections` (paged, at most 50), `collection(slug)` (in the shopper's language or the main one), and the files
they show at `GET /shop-api/assets/{id}`.
**Part 2:** `products(collection, filters, search, sort, first, after, before)` (at most 50; newest first, by price either
way or by name, or a collection's own order; a filter's values are alternatives and filters all apply; only what the
shopper's market sells and can price in the cart's currency; `facets` counts each value before the choice), `search(query)`,
and `product(slug)`: each version's price in the cart's currency and market (typed, or converted at the reference rate and
rounded, moved by the market's adjustment), compare-at, stock left (`shop_stock()`, migration 0065) and whether it can be
bought, the badges whose rule holds (none for best sellers until reports count sales), options, the sections Settings ›
Catalogue switches on (specs, highlights, FAQs, related, video, size chart, A+ with its brand stories and compared
products), legal details, filters, and `soldHere` (the market sells it, a price here, the legal details its countries need,
CATALOG T2).
**Part 3:** a query of catalogue fields only (`store`, `menu`, `collections`, `collection`, `products`, `search`, `product`) is
answered from the data centre's cache for 5 minutes, keyed by store, `storefront.catalog_version`, host, language,
currency and market; every write a storefront shows moves the version, which is the purge (a section switched on or off
included), and a republished reference rate moves a converting store's. Stock is left out on purpose, since every sale
would otherwise empty the store's cache: a page may show it up to 5 minutes old, while the cart and placement check it
again under lock, so nothing is oversold. Two more things change with no write and follow within those 5 minutes: a
product whose `publish_at` comes, and the "new" badge as a product ages. An answer with errors is never
kept, and the store is still found and rate-limited first. Anything else (carts, accounts, from SAPI 9) is never cached.
Every answer goes out `private, no-store`: only the data centre's copy is kept, since nothing in front of it sees the
version move or the headers the key reads.
**Built on #308 (SAPI 9), part 1, the guest's cart:** `cart`, `addToCart(versionId, quantity)` (a guest's first add hands out
`cartToken` once, sent back as `X-Shop-Cart`; a signed-in shopper's cart is its account's), `setCartQuantity` (0 removes),
`setCartContact(email, phone, note)`, `setShippingAddress`, `setBillingAddress` (null bills the delivery address),
`setShippingOption` (one of the cart's `shippingOptions`: courier, flat or pickup, SAPI 23's quote) and `checkout`, which
moves the cart to payment or refuses `NOT_READY` with its `problems`. The cart holds what the shopper chose and nothing
priced; each read prices it now: lines at today's price with what stops one being bought (gone, not sold here, unpriced,
more than is left), delivery, tax from the store's rates (GST across or within states; Stripe Tax on a US address once
Stripe is connected, #309), and the total. A change after reaching payment goes back to delivery. Up to 100 lines of up to 999; a cart lives 30
days from its last change. A guest's new carts are limited per store and address (`CART_RATE_LIMITER`, 20 a minute). The names above replace §19's `updateLine` and `setShipping`.
**Offers, #320 (SAPI 14) part 4:** each read also prices the store's offers (OFFERS-DESIGN §3.1): `discounts` (each offer
taken, by the name shoppers see, its code and amount), `discount`, `lines.discount`, `shippingDiscount` and `codes` (each
code the cart holds and its state: `APPLIED`, `NOT_ELIGIBLE`, `DOESNT_COMBINE`, `SIGN_IN_REQUIRED`, `INVALID`, `EXPIRED`,
`USED_UP` or `ALREADY_USED`); tax is on what the lines and delivery come to after them. `applyCode(code)` answers the
code's state with the cart: one that can't work whatever is added comes straight back off, a code no offer of the store
holds is `INVALID` like a malformed one, and codes are tried at most 30 a minute per store and address
(`OFFER_CODE_RATE_LIMITER`); `removeCode(code)`; at most five codes a cart. A once-per-customer or first-order offer needs a signed-in shopper (`SIGN_IN_REQUIRED` for every guest, whatever email they
typed, so no answer reveals another shopper's history; OFFERS-DESIGN §3.1). Placing a live order takes each offer's use
under its row lock (an offer used up or ended meanwhile refuses `OFFER_CHANGED`, and the cart, read again, no longer has
it), the shopper's own uses under a lock of their own, a single-use code's one use, and records the discount on the
lines, as a line per offer (`order.discounts`) and in `promotion_usage`; a preview's test order takes no use. A
cancellation before fulfilment gives every use back; a refund doesn't (#337).
**Part 2, shopper accounts:** `signInOptions` (Settings › Customer accounts: email, mobile or both, India starting with
both), `requestSignInCode(channel, to)` (a 6-digit code by text, MSG91 or Twilio, or by email; the same answer whether or not
the address has an account; 3 per address in 10 minutes, 10 a minute per requester, 50 texts a store in 10 minutes), `verifySignInCode(channel, to, code, name,
password)` (proves the email or number: signs in, making the account when there's none; with an email, a password sets or
resets it; one refusal for a wrong, used or expired code, 5 tries), `signIn(email, password)` (one refusal for any mismatch,
rate-limited per store and IP and per email), `signOut`, `account`, `updateAccount(name)`, `saveAddress`, `deleteAddress`. The
session token is handed out once and sent back as `X-Shop-Session`; signing in with a guest cart's token makes that cart the
account's. The Store API's `customerAccounts` (the mode and how many accounts have an email, a number, only a number) and
`saveCustomerAccounts(mode)` are the Owner's (`settings`).
**Built on #309 (SAPI 10), part 1:** `paymentOptions` (the ways the store takes payment, in its region's order, a
transfer's bank details with it), `placeOrder(provider)` (a ready cart becomes an order numbered `order_prefix` + the
next number, its lines, parts per owner, delivery and tax snapshotted at today's price; cash on delivery and bank transfer
hold the stock at once, checked again under lock, `OUT_OF_STOCK` when it's gone; a transfer is due in 3 days), and
`order(id)` (the shopper's own, a guest's by its cart token; `shippingOption` and a courier's `shippingMethod`, worded by the
storefront in the shopper's language). The Store API's `gateways` (the region's providers),
`connectGateway` (cash on delivery in India, bank transfer with its details) and `disconnectGateway` (never the store's only
live way to pay, `LAST_METHOD`) are the Owner's (`payments.configure`); `markOrderPaid` is the Owner's and Manager's
(`orders.mark_paid`). The cron cancels a transfer unpaid after 3 days and gives its stock back.
**Part 2, Stripe:** `connectStripe` (the address on Stripe to approve DripFunnel's app at; Stripe returns to
`hooks.<host>/stripe/connect/callback`, which sends the merchant to `/settings/payments?stripe=finish&key=…`, or
`stripe=cancelled` / `stripe=failed`) and `finishStripeConnect(key)` (the person who started, within 10 minutes) are the
Owner's; a support session can't. On the Shop API a card provider's `placeOrder` starts the payment first and answers
`payment` (`providerRef`, `publicKey`, `accountId`, `clientSecret`, `sessionId`, `redirectUrl`, as the provider needs), the
order placed unpaid with no stock held; `confirmPayment(orderId)` reads it back on the shopper's return and answers the order;
`payOrder(orderId)` starts a new attempt after a decline, cancelling the one it replaces at the provider (`ALREADY_PAID` once paid, `PAYMENT_MISMATCH` while a wrong amount waits for the merchant, `PAYMENT_PENDING` while the earlier one is still going through, `MODE_MISMATCH` from the other storefront's mode). The sweep cancels a card order only once its provider has closed the attempt. Paid, from the webhook, the return or
the sweep, the order holds its stock; a card order unpaid for a day is cancelled (`unpaid`). Preview storefronts pay in
test mode and never hold stock. A US address on a store with Stripe connected is taxed by Stripe Tax, delivery included;
the store's own rates leave delivery untaxed (decided on #309). A Stripe account takes payment for one store only
(`ACCOUNT_IN_USE`).
**Part 3, pasted keys:** `connectGateway(provider, mode, keys)` connects Razorpay, Cashfree, PhonePe or PayPal for `LIVE` or
`TEST` (the preview storefront). The keys are checked, tried once with the provider, sealed and never shown again (`INVALID_KEYS`,
`KEYS_REFUSED`, `PROVIDER_UNAVAILABLE`). `gateways` lists each mode's `connections` with the webhook address to paste
into the provider. At checkout `placeOrder` answers Razorpay's order and key id, Cashfree's `sessionId`, PhonePe's
`redirectUrl` (the shopper returns to `/checkout/complete?order=…` and the storefront calls `confirmPayment`) or PayPal's order
and client id. Cashfree refuses with `PHONE_REQUIRED` until the cart has a mobile number.
**Built on #310 (SAPI 11), part 1, reading orders:** `orders(filter, search)` (newest first, at most 50; the chips `ALL`,
`TO_SHIP` (unshipped or partly shipped, and gone through: paid, or cash on delivery or transfer), `PARTLY_SHIPPED`, `SHIPPED`,
`CANCELLED_REFUNDED`, `PAYMENT_PENDING`; search by number, or the shopper's name on the merchant side), `orderCounts`,
`order(id)` (the parts by who packs them, each line's price, discount, tax and total, the payments, adjustments, the
shopper and the history newest first) and `navBadges { toShip }`, for `orders.read`; `addOrderNote(orderId, note)` for
`orders.write` (up to 1,000 characters, a line in the history, `order.note_added`). A preview storefront's test order is
listed and flagged `test`, never to ship. A supplier with `orders.read` sees only orders holding its lines that went through
on the live storefront, its own part and lines at the price sold, no total, payment or contact, and the shopper's name and
delivery address only where its part was placed `to-shopper`; its chips are its part's, and its history only its own entries.
**Part 2, shipping:** `shipItems(orderId, warehouseId, lines: [{ lineId, quantity }], courierName, trackingNumber, trackingUrl)`
and `addTracking(shipmentId, courierName, trackingNumber, trackingUrl)` (`orders.fulfil`: every merchant seat, since
`orders.write` includes fulfilment, and the `vendor-orders-fulfil` tier for its own part, which keeps shipping while the store is
past due). Per line and quantity from one of the caller's own locations; partial is normal. The store ships its own lines and a
to-store supplier's once handed over; a supplier ships its own lines to the shopper (`to-shopper`) or hands them to the store
(`to-store`, a `sent_to_store` shipment), by the mode its part was placed under. Stock leaves the location it was shipped from,
with an `order` movement, and what the order held is given back; a tracked version the location hasn't enough of is refused
(`NOT_ENOUGH_STOCK`). A cancelled, test, still-unpaid card or fully refunded order never ships (`NOT_SHIPPABLE`); a pickup order's is a
`pickup` handed over, refused with a courier or tracking (`INVALID_INPUT`). The store shipping a transfer before it's paid lets its due date go, so the 3-day sweep leaves it; a supplier's shipment doesn't. `order`
answers its `shipments` (a supplier's own only, so the store's onward tracking stays the store's) and each line's
`sentToStoreQuantity`. A tracking address is https only.
**Built on #311 (SAPI 12), part 1, labels and pickups:** `bookLabel(orderId, warehouseId, lines, courier)` and
`requestPickup(shipmentId)` (`orders.fulfil`, as `shipItems`): one part's lines, as one parcel, from one of the caller's
locations to the shopper, its label bought through the store's connected courier on its partner's account (THIRD-PARTY-ACCESS
§4) at that courier's cheapest service. The courier is asked inside the shipment's transaction, as a refund asks its
provider: a parcel it won't take (`UNSERVED`), a refused account (`COURIER_REJECTED`) or no answer (`COURIER_UNAVAILABLE`)
writes nothing, and two bookings of the same units book one label (`TOO_MANY` for the second). A courier the store hasn't
connected, its partner doesn't hold or the store's country doesn't use is `NOT_CONNECTED`; a location or shopper address
that isn't whole is `NO_ADDRESS` (the store's own locations leave from Store info's address when they have none). The
shipment is `booked`, with the courier's tracking number and link, and the shopper hears of it as of any shipment; its
label is kept as the order's document, read at `GET /api/documents/{id}` (`orders.read`; a supplier only its own).
With scheduled pickups the courier is asked to collect with the label (Shiprocket; a US carrier's daily pickup is the
merchant's own arrangement); on request, `requestPickup` asks once (`PICKUP_ASKED`), only for a label booked here
(`NOT_BOOKED`). `order` answers each shipment's `courier`, `labelDocumentId`, `pickupRequestedAt`, `pickupDate` and
`pickupReference`. Decided there: a label is one part's (`ONE_PART`), so a refusal never leaves one parcel bought for
another; a to-store supplier's hand-off is entered by hand; a to-shopper supplier books only on the store's account
(`OWN_LABELS` with `label_account = own`, since DripFunnel holds only the partner's); labels are booked prepaid, since cash
a courier collects would be remitted to the partner's account (asked as an open question, §21); a label's tracking can't be
corrected by hand; Shiprocket's parcel goes as a 10 cm box, since an order line carries no dimensions.
**Part 2, tracking sync:** each partner account's courier posts to `hooks.<host>/couriers/{shiprocket|easypost}/{partnerId}`
(Shiprocket with its webhook token as `x-api-key`, EasyPost signing the body with its webhook secret); a hook not proved
with the partner's secret is refused (400) whatever the reason, and one is applied only to that partner's booked parcels.
A parcel's status (`in_transit`, `out_for_delivery`, `delivered`, `exception`, `returned`, `cancelled`) moves only forward
in the courier's time, so a hook sent twice or late changes nothing; the first `delivered` sets `deliveredAt`, logs
`order.delivered` (the store's and, on a supplier's parcel, its own) and tells the shopper once (`order.delivered`: an
email of what arrived, and a text with the tracking link), unless the store switched that courier's tracking emails off.
`order` answers each shipment's `trackingStatus` and `deliveredAt`. Decided there: no polling, since both couriers
resend a hook they couldn't deliver; statuses before the courier has the parcel are ignored.
**Part 3, returns and refunds:** `startReturn(orderId, lines, reason, note)`, `receiveReturn(returnId)` and
`cancelReturn(returnId)` (the store's, `orders.refund`: shipped units only, each back to its owner's location by its part's
mode; cancelled only while on its way back), and `refund(orderId, returnId, lines: [{ lineId, quantity, amount }], extra,
reason, note, restock, override)` (`orders.refund`: Owner, Manager and the `vendor-orders-fulfil` tier on its own lines). A
line's refund covers units that have shipped (unshipped ones go back by cancelling), its share of what the shopper paid for
the line unless an amount is named, or money only with 0 units, up to what the line's shipped units are worth; `extra` is the store's alone (delivery, goodwill). One
refund an owner: the store refunds its own lines, a supplier its own, and the store a supplier's only with `override`, which
`supplierLedger(supplierId)` records against the supplier (the supplier's own ledger and balance for a supplier, settled
outside DripFunnel). A return is refunded only once received, and is done once all of it is. The money goes back on the
order's payment: the card provider's refund (`PROVIDER_UNAVAILABLE` or `PROVIDER_REFUSED` keep nothing), or the store's own
hand for cash and transfers; `restock` puts shipped units back as "Returned", the store's own and a to-shopper supplier's (a
to-store supplier counts its own once the store sends them back). `order` answers its `returns` and `refunds`, a supplier
only those with its lines, without the store's note or the money's state at the provider.
**Part 4:** `cancelOrder(orderId, reason: shopper | store | out_of_stock)` (`orders.write`, so every merchant seat): only an
order nothing has left from, shipped or handed to the store (`NOT_CANCELLABLE`); its stock released and everything paid given
back on its payment, one refund an owner as `cancelled`, never on the supplier ledger; a card attempt still open is closed at
the provider first, and one still going through is refused (`PAYMENT_PENDING`). `exportOrders(filter, search)` (a job, read
back with `orderExport(id)` and `orderExports`; the merchant side's `exports`, Staff included, and a supplier's
`exports.orders`): one row a line, the merchant side's with the shopper, payment and order total, a supplier's its own lines at
the price sold, no totals, and the shopper only where its part ships to the shopper; up to 10,000 rows, saying where it was cut.
`mySales` (`sales.read`, the two order tiers): a supplier's own sold lines at the price sold, newest first, paged, no totals.
**Built on #312 (SAPI 13), part 1, customers:** `customers(groupId, search)` (newest first, at most 50; search by name,
email, number or tag), `customerCount`, `customer(id)` (contact and whether each is proven, the account, tags, the team note,
marketing consent, group ids, saved addresses, the newest 20 orders and how many there are, and what they've paid less refunds,
a figure a currency) and `customerGroups` (by name, each with its members; up to 100 a store), for `customers.read`;
`addCustomer(name, email, phone)` (no email goes to them; an email already a customer answers that one, `existed`),
`updateCustomer(id, name, phone, address)` (the default delivery address; a number the shopper proved is theirs,
`VERIFIED`), `setCustomerTags` (up to 20, 24 characters each), `setCustomerNote` (up to 2,000 characters),
`recordMarketingStop` (consent `stopped`, recorded by the store; order and delivery emails still go), `setCustomerGroups(id,
groupIds)`, `createGroup`, `updateGroup`, `deleteGroup` (its members leave it) for `customers.write`; `exportCustomers(groupId,
search)` (a job, read back with `customerExport(id)` and `customerExports`, `customers.export`): one row a customer, or a row a
currency for one who has paid in more than one, up to 10,000. Owner, Manager and Staff alike (ACCESS §5.1); every supplier is
refused. Everyone who has bought is a customer: a live guest order makes an unverified row from its email (or, with none, its
number), never linked to the order, so an account takes it over only by proving that email or number (ACCESS §2.1). Only the
shopper opts in to marketing; the checkout box that records it comes with the storefront's checkout.
**Part 2, the shopper's order emails and texts:** the order confirmation once an order goes through (placed for cash on
delivery or a transfer, paid for a card), and the shipping news once a shipment leaves for the shopper (the store's, or a
to-shopper supplier's; never a hand-off to the store or a pickup) and once more when its tracking first comes. Each is an
email, from the store's name in its partner's look with the store's contact, and a text where the order has a number
(`order.confirmed`, `order.shipped` with the courier and the tracking link, which waits until both exist). A test order, a
cancelled one and a correction of tracking tell nobody. The engine queues an `order.notify` row of ids only; its deliverer
reads the order when it runs and queues the email and the text, each once. The password email is #308's shopper code (a
forgotten password signs in by code and sets a new one). `order.delivered` comes with tracking sync (#311 part 2).

**The Shop API** (`/shop-api`, PLATFORM-PROMPT §5.5) — what the storefront template needs to sell
what the portal publishes:
`store` (info, policies, legal, markets, currencies, languages), `menu`, `collections`,
`collection`, `products(filter, facets, search)`, `product` (with A+, size chart, sections,
badges, readiness per market), `search`; cart (`cart`, `addToCart`, `updateLine`,
`applyCode`, `setAddress`, `shippingOptions`, `setShipping`, `paymentOptions` per region:
Stripe, PayPal, Razorpay, Cashfree, PhonePe, cash on delivery, bank transfer), `checkout`
(prices, Stripe Tax or the store's rates, offers and totals computed by the engine, stock
checked at payment), `order` and `orderHistory`; shopper `signUp`, `signIn` by email or mobile
code (ACCESS §2.1), `account`, `addresses`; **gift card balance and redemption** (built on #323: `giftCardBalance`, `applyGiftCard`, CATALOG-DESIGN T14); digital
downloads after payment; services sold with no booking (§1); marketing consent at
checkout; the abandoned-cart return link (`cart/r/{token}`) and single-use codes. Catalogue
queries are edge-cached per store, catalogue version, language, currency and market, the version's move being the purge (§5.5 there).

---

## 20. The strands that build this release

**Build order (decided 2026-10-05, #284): 53 cards, created on the board as #285–#335, plus
#338–#339 added on #337, built straight through.** The table below describes the cards #184 drafted; the cards added on #284
(D1, INF 0–2, SMS 1, SC 0–1, ST 1a–c replacing ST 1, L1–2) and on #337 (SAPI 24, SUI 17)
are described in their issues.

- **0. Design and accounts:** #285 D1, #286 SUI 1, #287 INF 0, #470 (the storefront docs after the 2026-10-08 redesign)

**The storefront strand's order after the redesign** (2026-10-08, #470, "Plan A"): #470 → #303 →
#304 → #480 SC 2 (the validator) → #481 SC 3 (sealed components, CSP) → #287 → #316 → #468 → #317 → #482 INF 3 (the
sandbox service) → #483 INF 4 (the publish gate, repair and bisect) → #484 INF 5 (deploy checks,
rollback, single-page render) → #471 → #318 → #319 → #307 → #313 → #338 → #339 → #324 → #486 ST 0
(the starting themes, which need every required route) → #485 INF 6 (the upgrade bot); #487 D2 (the studio's new states in the prototype)
any time before #319.

- **1. Merchant identity:** #288 SAPI 1, #289 SMS 1, #290 SAPI 2, #291 SUI 2, #292 SUI 3
- **2. Catalogue:** #293 SAPI 3, #294 SAPI 4, #295 SAPI 5, #296 SAPI 6, #297 SAPI 7, #298 SUI 4, #299 SUI 5, #300 SUI 6, #301 SAPI 16, #302 SUI 10
- **3. Storefront base:** #303 SC 0, #304 SC 1, #305 SAPI 23, #306 SAPI 8, #307 ST 1a
- **4. Checkout and orders:** #308 SAPI 9, #309 SAPI 10, #310 SAPI 11, #311 SAPI 12, #312 SAPI 13, #313 ST 1b, #314 SUI 7, #315 SUI 8
- **5. Publishing:** #316 INF 1, #317 INF 2, #318 SAPI 17, #319 SUI 11, #471 SAPI 17b (added on #470); and, from #470's "Plan A": #480 SC 2, #481 SC 3, #482 INF 3, #483 INF 4, #484 INF 5, #485 INF 6, #486 ST 0, #487 D2
- **6. Growth:** #320 SAPI 14, #321 SAPI 15, #322 SAPI 18, #323 SAPI 22, #324 ST 1c, #325 SUI 9, #326 SUI 12, #327 SUI 15, #328 SUI 16, #338 SAPI 24, #339 SUI 17
- **7. Business and admin:** #329 SAPI 19, #330 SAPI 20, #331 SAPI 21, #332 SUI 13, #333 SUI 14
- **8. Launch:** #334 L1, #335 L2

The draft, as #184 left it, in the shape PAPI 1–9 and PC 2–12 took. **Needs** is
what must merge first. **Who builds each §19 operation**: Brand, sign-in, Shell (`me`, `myStores`,
`navBadges`, `storeState`, `switchStore`) and Profile, SAPI 2; Home (`home`) with Reports, SAPI 18;
Orders, SAPI 11 (labels and tracking SAPI 12, `markPaid` SAPI 10); Customers, SAPI 13; Offers,
SAPI 14; Abandoned carts, SAPI 15; Products and Collections, SAPI 3 (stock SAPI 4, approval
SAPI 5, `writeDescription` SAPI 17); Import and export, SAPI 16; Storefront, SAPI 17; its brand,
search and sharing and domains, SAPI 17b (#471); Settings by tab (Store info,
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
| SAPI 17 | Storefront (redesigned on #470, "Plan A"): templates, the AI studio (the model call, the store's sandbox, commits, undo, discard), publish through the gate, go back, Publish now, the signed preview link, `ai_run` metering | #470, INF 1, INF 2, INF 3, INF 4, INF 5, SAPI 8, SAPI 17b |
| SAPI 17b | Storefront site settings (#471): brand, search and sharing, domains | #470, SAPI 8, #468 |
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
| SUI 11 | Storefront: brand step, template gallery, studio (images, sample sites, edit text, the sandbox's states), publish with the gate's results, site settings (#470) | SUI 2, SAPI 17, SAPI 17b |
| SUI 12 | Home and Reports | SUI 7, SAPI 18 |
| SUI 13 | Billing | SUI 2, SAPI 19 |
| SUI 14 | Developers, Apps, Support access, Activity log | SUI 6, SAPI 20, SAPI 21, SUI 1 |
| SUI 15 | Supplier views: Your products, To ship, Your sales, Your team | SUI 4, SUI 7, SUI 1 |
| SUI 16 | Product kinds in the editor (the storefront's side is ST 1's) | SUI 4, SAPI 22 |
| ST 1 | Storefront template on the Shop API: catalogue, cart, checkout, accounts, offers, every payment method, and the product kinds on the storefront (gift cards, downloads) | SAPI 9, SAPI 10, SAPI 14, SAPI 22 |

**Storefront walls and pipeline** (#470's "Plan A"; created 2026-10-08 as #480–#487)

| # | Card | Needs |
|---|---|---|
| SC 2 (#480) | Core's validator (`./guard`): the file allowlist, the type-aware code rules, CSS and content rules, the routes namespace, a corpus of forbidden code with a case per rule (storefront ARCHITECTURE §3.4) | #304 |
| SC 3 (#481) | Sealed components in a closed Shadow DOM with their visibility self-check, the top-layer banners, `Money`/`Stock`/`Rating`/`Badge` as branded types, CSP and Trusted Types, section error boundaries and the switch to the baseline checkout, which #313 writes (§3.5) | #304 |
| INF 3 (#482) | The sandbox service: `apps/sandbox`'s image per core version, the `StudioSession` Durable Object (one change at a time, idle stop, cold start from the last commit, the queue), the fast gate and the repair loop, commits through the GitHub App, the preview build and deploy (§6) | SC 2, #287, #316, #317 |
| INF 4 (#483) | The publish gate: the catalogue snapshot, the deterministic offline build, the full gate (contract, visibility, checkout smoke, axe, budgets, no-JS render, crawl, content scan, visual diff, the edge-case catalogue), repair and bisect (§4.2, §9, §10) | INF 3, SC 3, #317 |
| INF 5 (#484) | Going live safely: atomic deploy, post-deploy checks from the edge, automatic rollback, the single-page render for new and renamed products, redirects, IndexNow, real-user vitals after consent (§4.2, §8, §9) | INF 4 |
| INF 6 (#485) | The upgrade bot: the sandbox image per release, codemods, the migration agent, canaries and waves, pinning, the baseline-theme fallback for security fixes (§7; SAAS §10) | INF 4, INF 5 |
| D2 (#487) | Draw the studio's Plan A parts in `PortalStorefront`: §14's "Not drawn" items | #470 |
| ST 0 (#486) | The starting themes: "Start from scratch" from D1 and the six templates as theme code in `templates/storefront/themes/`, each passing every gate (§2.3) | SC 2, SC 3, #307, #313, #324 |

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
- **Cash on delivery through a courier's label** (#311): labels are booked prepaid for now, since the courier would remit
  the cash it collects to the partner's own account, and nothing settles it on to the store. Collect through the label, and
  how the partner pays it on?
