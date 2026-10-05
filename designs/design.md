# DF Platform — design notes

How the DripFunnel platform prototypes in this project are built, so a new
screen can be added without re-reading 10,000 lines of source.

Last updated: 2026-10-05.

---

## 0. What this project is

DripFunnel is a white-label commerce platform with three tiers of users. Each
tier has its own clickable prototype. Everything is dummy data. Nothing talks
to a backend.

| Tier | Who | Prototype | Entry file |
| --- | --- | --- | --- |
| **Store** | A merchant running one shop, plus their staff and suppliers | Merchant portal | `DF Store Prototype.dc.html` |
| **Platform** | A partner reselling DripFunnel under their own brand, e.g. *Northstar Shops* | Partner console | `DF Platform Prototype.dc.html` |
| **Admin** | DripFunnel's own staff, running every partner and store | Admin console | `DF Admin Prototype.dc.html` |
| **Shopper** | A store's customers, on its storefront | The baseline storefront theme (`templates/storefront`) | `DF Storefront Prototype.dc.html` |

Plus two supporting files:

- `DripFunnel Style Guide.dc.html` — the brand specimen: colour, type, buttons, forms, cards, badges, icons. Light/dark via the `defaultTheme` prop. **It is the source of truth for tokens.**
- `DF Store Pricing.dc.html` — public pricing page for the Store product (plans, feature comparison, FAQ, month/year toggle).

The source specs are in `uploads/`: `DESIGN-BRIEF.md` (flows A–I),
`AUTH-PLAN.md` (roles, invitations, vendors), `ARCHITECTURE.md` (BFF and
tenancy), `BUILD-PROMPT.md` (hand-off to Claude Code). **The specification is
`docs/` in this repo; start at `docs/README.md`** (docs/README.md §7).

---

## 1. File map

### Store — one shell, many screens

`DF Store Prototype.dc.html` owns all state and mounts one child DC per page.
Every child receives a single `app` prop (see §3).

| Screen | File | Notes |
| --- | --- | --- |
| Sign in, sign up, invite | `PortalAuth` | Signup builds a store; views `login` / `tfa` / `enrol` (an Owner without 2FA) / `su1…` / `invite` / `inviteBad` |
| Home | `PortalHome` | Landing screen; what is waiting, then today's numbers; locale picker for new stores |
| Orders + customers | `PortalOrders` | Filters, detail, ship with courier/tracking, refund, customer email |
| Offers list | `Offers` | Live / scheduled / ended tabs, results, single-use codes |
| Offer editor | `OfferEditor` | Guided setup: type → reward → trigger → requirement → audience → schedule → stacking |
| Abandoned carts | `Carts` | Open carts, reminder sequence, cart detail |
| Reports | `PortalReports` | 30-day range; locked below Growth |
| Products | `CatList` | Search, filter, sort, bulk select, quick edit, approval review |
| Product editor | `CatEditor` | Largest screen (~890 lines); variants, markets, languages, AI copy, legal fields |
| A+ content | `CatAPlus` | Rich product modules, desktop/phone preview |
| Collections / Filters / Menus | `CatCollections` | Three tabs of one destination; mounts `CatSizeCharts` |
| Size charts | `CatSizeCharts` | Child of Collections |
| Import & export | `CatImport` | CSV, Shopify import, match rules, progress, pause |
| Storefront | `PortalStorefront` | AI "describe your shop", preview widths, publish |
| Settings | `PortalSettings` | Tab host → `SetStore`, `SetTeam`, `SetOps`, `CatSettings`, `SetMarkets` |
| Billing | `PortalBilling` | Plan, card, invoices, downgrade, cancel |
| Choose what to keep | `PortalKeep` | Trial-ended downgrade: pick which products stay live |
| My profile | `PortalProfile` | Name, email, password, two-step sign-in, backup codes, appearance (light/dark) |

Helper: `offers-lib.js` → `window.DFOffers` (offer maths, per-region wording
such as *coupon* vs *voucher*, *shipping* vs *delivery*). Loaded by `Offers`
and `OfferEditor`.

### Platform — single file

`DF Platform Prototype.dc.html` (~1,200 lines) plus `partner-data.js` →
`window.PC`. Hash-routed (`#/stores`, `#/stores/:id`, `#/plans/:id`…).
Screens: Sign in / accept invitation, setup session bar, Dashboard,
Onboarding checklist, Stores, Store detail, Create store, Plans, Plan editor,
Compare plans, Plan defaults, Branding, Domains, Add domain, Reports, Billing
and payouts, Support, Activity log, Settings, Support-session tab.

### Admin — single file

`DF Admin Prototype.dc.html` (~1,600 lines) plus `admin-data.js` →
`window.DFA`. Hash-routed. Screens: Dashboard, Partners (+ detail with a
**Setup** tab, approval and go-live checks), Stores, Customers, Approvals,
Provisioning, Impersonate, Activity log, Staff (Super admin only).

**The Setup tab is prototype-only.** The admin console has none (decided on
#19, 2026-09-30): the checklist sits on the partner's Overview and the setup
session starts from the header. See §8.

### Storefront — single file

`DF Storefront Prototype.dc.html` plus `shop-data.js` → `window.SHOP` (the
Store prototype's two launch stores, Kesari Threads in India and Juniper &
Co. in the US, as a shopper sees them). It is the **baseline theme** the AI
designer starts from (storefront DESIGN §4): layout, states and wording are
decided here; colours, type and composition are the AI's to change per store.
Drawn on #285 (D1).

Pages, one per core route (storefront ARCHITECTURE §3.1): Home, Collection
(filters as a sidebar on wide screens and a drawer on narrow ones, sort,
active-filter chips, empty result), Product (gallery with video, swatches and
size buttons with sold-out versions, size chart, stock line, delivery check by
PIN or ZIP, highlights, accordions with the legal fields, A+ modules, related
products, a sticky buy bar on phones), the gift card, download and service
product pages, Search (overlay with suggestions, results, no results), Cart
(drawer and page, the automatic offer, codes, the free-delivery bar),
Checkout (contact → address → delivery → payment → review, with the summary
collapsible on phones), Order confirmation (paid, cash on delivery, bank
transfer with its 3-day deadline, download, gift card, service), Sign in
(email and password, or a mobile code), Register, Verify, Forgot and Reset,
Account (orders with tracking, cancel and return, details, addresses, what we
send you, gift card balance, downloads, download or delete my data), the five
Policies, About, FAQ, Contact, Lookbook, Journal and a post, 404, and the
suspended-shop page.

Controls: Store (IN/US) · Device · Theme · Site (live or preview by signed
link) · Shopper (guest or signed in) · Shopper sign-in (email, mobile or both,
ACCESS §2.1) · Card gateway (India: Razorpay or Cashfree) · Page · Scenario
(slow, won't load, offline, shop suspended, payment fails, payment slow to
confirm) · Cookie choice · "Powered by" (shown or removed by plan) · Mark
required parts. Every control also reads from the URL
(`?region=US&device=phone&page=product&arg=p1`), so a state can be linked
and captured.

**Required components** carry `data-req` and show an orange dashed outline
with **Mark required parts**: the price with its tax label, the payment
element, legal and compliance notices, the consent banner, the preview
banner, the "Powered by" line, and the checkout steps. The AI restyles them
and never removes or rewords them (storefront DESIGN §3); everything else is
the baseline the AI may change. The pages are styled with one stylesheet and
container queries on the frame, so the same markup is right in the phone frame
and at any desktop width (breakpoints 640, 760 and 1080 px).

**Returns and cancelling, as drawn**: a shopper may cancel an order until it ships (a bank
transfer not yet paid, or a paid order still being packed), and may ask for a return until the
store's returns window closes, counted from delivery. The window is the store's own returns
policy (CATALOG-DESIGN S8), never the theme's: 14 days in the India sample, 30 in the US one
(`returnDays` in `shop-data.js`; download limits likewise, `downloads`). The rules are written
in storefront ARCHITECTURE §2.1.

`ImpBanner.dc.html` is the one shared child: the staff-session banner that
the Platform and Store prototypes mount at the top of their frame (see §8).

---

## 2. Prototype controls

Every prototype opens with the same dark strip: `#14181F` ground, a mono
orange `PROTOTYPE CONTROLS` label, and 28px selects on `#232A33` with
`#3A424E` borders. It sits outside the product frame and is not part of the
design. Add a new state as a control option before adding UI to reach it.

| Prototype | Controls |
| --- | --- |
| Store | Role · Region · Plan · Store (stocked / empty / signup) · Scenario · toggles (Languages, Currencies, Approval, Offline…) · Desktop/Phone · Reset data |
| Platform | Partner (Northstar live, Kaufladen draft / set up by DF / awaiting / sent back / just approved) · Role · Theme · Screen · Signed in · Invitation · Scenario |
| Admin | Signed in as · Theme · Environment · Screen · Data · Sign-in |

**Device frames:** desktop fills the viewport. Phone is 375–390px wide,
780–800px tall, with a 8–10px `#14181F` bezel and a 28–40px radius. Platform
and Admin also have a narrow laptop frame (1100px / 1024px).

### Scenarios every prototype covers
Loading (skeleton), load error, save error, empty, not found, offline,
session expired. Store adds slow page, removed from store, invite and
expired invite. Platform adds paused, offboarding, closed, contract warning
/ grace / lapsed, payout failed, card declined, DNS failing. Admin adds
partial/stale data and every Microsoft sign-in failure (MFA denied, device
blocked, provider down, access refused).

---

## 3. How the Store shell works

### State lives in the shell; screens receive `app`
The shell's `renderVals()` builds one `app` object and passes it as
`app="{{ app }}"` to whichever child is showing. A child reads what it needs
and calls back through it. **A child never owns shared data.**

Key members of `app`:

- **Data:** `st` (full shell state), `products` (scoped to role), `allProducts`, `orders`, `collections`, `facets`, `menu`, `sizeCharts`, `exports`, `data(key)` for settings blobs (`storeInfo`, `shipping`, `people`, `warehouses`, `suppliers`, `brand`…)
- **Region:** `R` — the region pack (below); `fmt` formats money in the region's currency and locale
- **Permission:** `caps` — role and plan flags (`isOwner`, `isVendor`, `canEdit`, `canManage`, `P` = current plan, `trial`, `suppliersOn`…); `allow(key, label)` and `within(key, n, label)` gate a feature or a limit and open the upgrade prompt if not allowed; `paused()` lists products paused by a downgrade
- **Navigation:** `go(screen, extra)`, `openProduct(id)`, `newProduct()`, `openOrder(id)`
- **Mutation:** `set(key, fn)`, `saveProduct`, `updateProducts(ids, patch)`, `deleteProducts`, `addProducts`, `setCollections`, `setFacets`, `setPlan`, `setLocale`
- **Feedback:** `toast(msg, action?, fn?)`, `modal(spec)`, `closeModal()`, `upgrade(feature, plan)`, `upgradeTo`
- **AI:** `needAI()` checks the plan's AI mode and quota before a run; `aiLeft()` returns the label
- **Auth:** `signIn(role?)`, `signOut()`, `finishSignup(info)`
- **Profile:** `me` (the signed-in role's profile: name, email, phone, `tfa` of `off` / `sms` / `app`, backup codes) and `setMe(patch)`; `theme` and `setTheme`
- **Output:** `download(name, header, rows)` writes a real CSV (the shell's `dl`); `doc(spec)` opens a printable document (invoice, packing slip, label); `preview(spec)` opens the storefront preview
- **Work:** `startJob(job)`, `job` and `clearJob()` run a background job with its banner; `request(what)` sends a team request to the owner's Home; `removeSupplier(id)`; `logStock(entry)` adds to the stock history

### Regions
`REG(key)` returns a region pack; switching region rebuilds the whole store.

| | US | DE | IN |
| --- | --- | --- | --- |
| Store | Juniper & Co. | Leinen & Licht | Kesari Threads |
| Currency · tax | USD · sales tax, **excl.** | EUR · VAT 19%, **incl.** | INR · GST 5%, **incl.** |
| Compare price | MSRP — no made-up "was" prices | Lowest 30-day price, auto, not typeable | MRP — selling price can't exceed it |
| Product code | HTS, optional | CN, optional | HSN, **required** |
| Units · sizes | lb/in · S–XL | kg/cm · 36–42 | kg/cm · S–XL |
| Payments | Stripe, PayPal | Stripe, PayPal, Klarna, bank transfer | Cashfree, PhonePe, COD, bank transfer |
| Couriers | USPS, UPS, FedEx | DHL, DPD, Hermes | Shiprocket |
| Markets | US | DE, NL, AT, FR, IT | IN, AE |

**Rule:** any label that differs by country comes from `R`, never a
literal — `R.priceLabel`, `R.taxName`, `R.postalLabel`, `R.taxIdLabel`,
`R.codeLabel`. Offer wording comes from `DFOffers`.

### Plans
Defined once in `PLANS()`. Internal keys differ from display names — use
the name.

| Key | Name | Products | Staff | Notable unlocks |
| --- | --- | --- | --- | --- |
| `free` | Starter (Free) | 10 | 0 | 1 market/currency/language; "Powered by" badge; AI on your own key |
| `starter` | Growth | 100 | 2 | Own domain, import, reports, badges |
| `growth` | Growth Pro | 5,000 | 5 | Manager role, AI included (200/mo), Shopify import, A+ (50), video, export |
| `business` | Business | ∞ | 15 | **Suppliers**, 10 markets, duties, market domains, custom fields |
| `enterprise` | Partner | ∞ | ∞ | White label, partner features |

Plan states in the control: `trial` (day 3, full Business), `trial9`
(ends tomorrow), `trialEnded` (drops to Free and pauses extra products →
`PortalKeep`), `pastdue` (read-only everywhere).

### Roles and the left menu
| Role | Menu |
| --- | --- |
| Owner | Home, Orders, Customers, Offers, Abandoned carts, Reports · *Catalogue:* Products, Collections · *Your shop:* Storefront · *Admin:* Settings, Billing |
| Manager | Same minus the Admin group; Storefront is view only |
| Staff | Home, Orders, Customers, Offers (view only), Abandoned carts (view only) · *Catalogue:* Products, Collections (view only) |
| Supplier (catalogue) | Your products, To ship |
| Supplier (stock only) | Your products (stock only) |

Supplier roles exist only on Business and above; picking one on a lower
plan falls back to Owner with a toast.

---

## 4. Shared chrome (all three prototypes)

**App header** — 56px, same ground as the side bar. Left: logo (DripFunnel
inverse, or the partner's mark and name when white-labelled) and a store /
partner switcher button. Right: Help link, then avatar (30px orange circle,
`#4A1B0C` initials) with name and role. Phone gets a 40px menu button.

**Side bar** — 232–248px, `#0A2A4A` (dark mode `#050D14`, or the partner's
brand colour when white-labelled). Admin collapses to a 64px icon rail on
narrow screens; phone turns it into an overlay drawer with a scrim.

- Group headings: IBM Plex Mono 10px, 0.12em, uppercase, `#B8C7D6`.
- Rows are **full-bleed** — no radius, no inset — so the hit target is the whole strip. 18px outline icon, 1.6px stroke. Hover is 6–8% white.
- **Active row:** 10% white ground + **3px `#EC844F` left marker** + white Manrope 700. Never an orange fill — orange means action, and an active row is a location. (Platform uses a 16% orange ground with the same marker.)
- **Badges:** small orange fill with a count — the one orange fill allowed in the bar, because it is work waiting. Every badge has a spoken label (`3 need attention`).
- **Notes:** `view only`, `stock only`, `7 days left` in 11px `#B8C7D6`, right-aligned.
- Items a role cannot use are **absent, not disabled**. Items that exist but can't be opened *yet* (during provisioning) show a padlock at 60% opacity. Locked means "not yet"; absent means "not for you".

**Banners** sit under the header, full width: provisioning, trial ending,
past due, offline, partner draft / awaiting approval / sent back, the
Platform "setting up for" session bar, and the Admin environment strip
(Production in red, with a warning that changes reach real partners; Dev, Feature or Local
in grey, decided on #65).

**Toast** — bottom centre, one line, optional action. 4.2s, or 8s with an
action (for undo).

**Modal** — one generic spec object: `title`, `body`, optional `input`
(with `label`, `placeholder`, `required`, `error`), `choices`, `confirm`,
`alt` + `onAlt`, `danger`. Use it for confirmations, upgrade prompts, and
single-field asks rather than building a bespoke dialog.

**Upgrade prompt** — every plan-gated control stays visible and opens
`upgrade(feature, plan)`: what the feature is, which plan has it, and the
price. Never hide a paid feature from the Owner.

---

## 5. Tokens

The product surfaces use the style-guide palette. Store screens use literal
hex (the most common are listed); Platform and Admin define CSS variables on
their root (`[data-pc]`, `[data-adm]`) with a `[data-theme="dark"]` override.

| Role | Light | Dark | Notes |
| --- | --- | --- | --- |
| Page | `#FDFAF7` | `#0A1622` | `--paper` |
| Card | `#FFFFFF` | `#12222F` | `--card` |
| Desk (behind the frame) | `#E8E2DC` / `#F3EDE8` | — | Outside the product |
| Heading | `#0A2A4A` | `#FFFFFF` | `--head` |
| Body | `#14181F` | `#D6DEE7` | `--text` |
| Muted | `#5A6472` | `#8A9AAB` | `--muted` |
| Strong secondary | `#434A55` | — | Table text, labels |
| Hairline | `#E8E2DC` | `#1E3242` | `--border` |
| Field border | `#D7D3CD` | — | Inputs and selects |
| Hover | `#F7F2ED` | `#16293A` | `--hover` |
| Side bar | `#0A2A4A` | `#050D14` | `--side` |
| Side bar secondary | `#B8C7D6` | — | 8.4:1 on navy |
| Link | `#B8541F` → `#8F4017` | `#EC844F` → `#F09A6D` | `--link`, `--link-h` |
| Focus | `#00519F` | `#2E7BD1` | `--focus`, and inside the side bar always `#2E7BD1` |
| Action | `#EC844F`, label `#4A1B0C` | same | The primary button |

**Status sets** — each is a bg / fg / border triple:

| | Light | Dark |
| --- | --- | --- |
| ok | `#EEF7F2` / `#1D6B47` / `#CBE6D6` | `#0F2A1E` / `#7FD1A5` / `#1F4A35` |
| warn | `#FFF6E5` / `#7A4B00` / `#F2D9A6` | `#2E2208` / `#F2C36B` / `#5A4212` |
| bad | `#FDECEC` / `#A1261B` / `#F3C7C2` | `#34110F` / `#F29A90` / `#5E231E` |
| info | `#EAF1F8` / `#00325F` / `#C6D9EC` | `#132B3F` / `#9CC3EC` / … |
| neutral | `#F1EEEA` / `#4A5360` / `#E0DAD3` | … |
| peach (vendor, warning, refusal) | `#FDF0E8` / `#8F4017` or `#6B3312` / `#F0D4BF` | `#2A1810` / `#EC844F` |

Suspended uses a solid `#A1261B` pill with white text.

### The action rule
Orange `#EC844F` with the `#4A1B0C` label is the primary button in both
modes. Hover deepens to `#D96C33` on light surfaces and lifts to `#F09A6D`
on dark ones. One filled button per view; everything else is an outline or
a text link. Orange is never body text on a light surface — use `#B8541F`.
Navy is headings, focus, charts and the side bar, not actions.

---

## 6. Type

Manrope (structure), Inter (prose and UI), IBM Plex Mono (eyebrows, codes,
IDs, badges). Loaded once per prototype from Google Fonts. The Platform
prototype also loads Nunito, Source Sans, Lora and DM Sans — **only** so a
partner can preview their own brand font in Branding.

| Role | Font | Size | Weight |
| --- | --- | --- | --- |
| Page title | Manrope | 24–28 | 800, −0.02em |
| Section / card title | Manrope | 16–20 | 700 |
| Big number | Manrope | 28–44 | 800, −0.03em |
| Body / table | Inter | 14–15 | 400 |
| Label | Inter | 13 | 600 |
| Help / meta | Inter | 12–13 | 400, muted |
| Eyebrow, ID, code | IBM Plex Mono | 10–12 | 400–500, 0.1–0.12em, uppercase for eyebrows |

Base: Inter 15px / 1.5 in the Store, 14px in Platform and Admin.
`text-wrap:pretty` on body.

---

## 7. Shape and layout

- Radii: 6px small controls, **8px buttons and fields**, 12px cards, 16px dialogs and the sign-in card, pills fully round, badges 5px.
- Fields 40px tall in consoles, 44–48px on phone and in auth. Buttons match field height.
- Content padding 28px desktop, 14–16px phone.
- Lists are tables on desktop and stacked cards on phone; the first column carries the name and a muted second line.
- Detail pages: title + status pill + actions row, then tabs, then cards in a 2- or 3-column grid (`repeat(n,minmax(0,1fr))`, collapsing to one column).
- Editors (product, offer, plan): long single column of cards on the left, sticky summary or preview on the right, sticky save bar that appears only when something has changed (`orig` snapshot compared to the draft).
- Shadows only on floating things — menus, dialogs, toasts.
- `gap` for spacing between siblings, never margins.

---

## 8. Screen patterns

**Empty states** explain what the screen will hold and give one action
(*Add a product*, *Load sample products*). A brand-new store and a
brand-new partner both have a complete empty path.

**Loading** is a skeleton in `--skel` shapes that match the real layout.
Never a spinner on a whole page.

**Errors** say what failed and what to do, in the place it failed. Field
errors under the field in `bad-fg`; save errors in a bar above the save
button; load errors replace the content with a retry.

**Read-only** (past due, lapsed contract, staff "view only") keeps every
screen reachable and every value readable, disables the controls, and
says why in one banner. Never a blank page.

**Destructive actions** go through `modal` with a `danger` confirm that
names the thing (*Delete 3 products*). Anything reversible offers undo in
the toast instead.

**Guided setup** — onboarding (Platform), signup provisioning (Store),
go-live checks (Admin) use the same checklist card: step, state pill, one
action per row, and a clear "what happens next".

**Staff sessions open the real portal in the same tab.** Admin (and the
Platform's own merchant impersonation) never renders another tier's screen
itself. Starting a session writes a record to `localStorage['df-imp-bus-v1']`
(with `ret`, the URL to come back to) and navigates to the target prototype
with `?imp=<id>`. Before leaving, the prototype saves its state to
`sessionStorage` (`df-admin-snap` / `df-platform-snap`) and restores it on
return, so sessions, activity and edits survive the round trip. The token stays out of anything shown on screen: the banner
shows only the host.

| Session | Opens | Host shown | Role in the portal | Length |
| --- | --- | --- | --- | --- |
| Partner-user impersonation | `DF Platform Prototype` `#/dashboard` | platform.dripfunnel.com | The user's role (Owner, Admin, Support, Finance, Read-only) | 30 min, extend once |
| Setup session | `DF Platform Prototype` onboarding, as staff | platform.dripfunnel.com | Staff setup powers: everything the partner's Owner can do **except** its payment method, payout details and ownership (ACCESS §8.2) | 2 h, no extension |
| Merchant-user impersonation | `DF Store Prototype` | partner's store host + store code; DripFunnel partner → shop.dripfunnel.com | Owner / Manager / Staff | 30 min, extend once |
| Supplier-user impersonation | `DF Store Prototype`, Business plan | same as merchant | Supplier admin → catalogue supplier, Supplier member → stock only | 30 min, extend once |

**Corrected 2026-09-30.** The prototype's fifth row, a read-only *store support session*, is
**gone**: staff have no read-only route into a store, because the prototype's own note —
"banner only; saves aren't blocked yet" — is the whole problem with one. Staff impersonate,
with full access and a full audit trail. A read-only, **consented** support session into a
store still exists, but it is a **partner** capability governed by the merchant's *Settings ›
Support access* switch (ACCESS §8), not a staff one.

- **Setup sessions** are drawn here with no reason, ticket or re-authentication step. **The
  product requires all three** (ACCESS §8.2, confirmed 2026-09-30) — the prototype is wrong on
  this and the flow needs the same two steps impersonation has. **Super admin and Partner
  manager** may start one, not Support; one is open at a time per staff member, and a second
  attempt is refused. *Open setup session* sits on the partner header (there is no Setup tab, decided on #19); *Create partner*
  opens one as step 2.
- **In the portal**, `ImpBanner` shows a yellow striped bar with who you're
  acting as, who started the session, the host, a countdown and *End
  session*, plus a *Back to …* link that returns while the session keeps
running. *End session* closes the record and goes back. When the session ends it shows a full-screen "session ended"
  card. A reused or unknown link shows "This link no longer works". The
  prototype keeps its own sample partner and store; only the banner names
  the real one.
- **In Admin**, every page shows a strip for each session you have open
  ("…is still open · host · 28 min left"), with *Return to session* and *End*.
  The Impersonate → Sessions page keeps the full list.
- **Live sync, both ways.** Ending in Admin, ending in the portal, or expiry
  marks the record closed; the other side picks it up from the `storage`
  event and a tick. Admin writes `endedBy:'admin'`; the portal writes
  `'portal'` or `'expired'`.
- **Why same tab:** new tabs from the preview were blocked and threw errors, so every
  hand-off is a same-tab navigation. **This is a limitation of the prototype preview, not a
  product decision** (2026-09-30): the console opens the target portal in a **new tab**
  (FIRST-RELEASE.md §8), so staff keep their place in Admin. The `localStorage` bus and the
  `sessionStorage` snapshots are prototype mechanics for the same reason; the product holds
  the session on the server.
- **Create partner** asks when to send the owner invitation: *now*, *when
  setup is submitted* (`inv:'queued'`, sent automatically when the partner
  is submitted for approval) or *I'll send it myself* (`inv:'held'`). The product offers
  two: *now* or *hold* (decided 2026-09-30; "when submitted" was not adopted). It is a page
  at `/partners/new`, not a dialog, and lands on the new partner's page, where *Open setup
  session* starts step 2 with its own re-authentication (#61).
- The admin console has **no Setup tab** (decided on #19, 2026-09-30): the setup checklist
  is on the partner's Overview, and the session starts from the header. Saves in a setup
  session are logged as the staff member, tagged "Setup session".

Every action in any session is written to the activity log.

**Activity log** — who, what, where, when, result (`success` / `denied` /
`failed`), filterable. Present in Platform and Admin.

---

## 9. Content voice

Plain and specific. Talk to a shopkeeper, not a developer. Say what
happens next and what it costs. Numbers instead of adjectives.

- Label things by what they do for the merchant: *To ship*, *Choose what to keep*, *Who gets reminded*.
- Explain why a control is off: *view only*, *stock only*, *On Growth the AI runs on your own OpenAI or Anthropic key. From Growth Pro it's included.*
- Use regional words from `R` / `DFOffers`.
- Dates and times say which timezone (*New York time*).

**Never:** emoji, flag emoji (use text or inline SVG), countdown or scarcity
tactics, fake "was" prices, greyed-out menu items for things a role can't
have, orange fills on navigation.

---

## 10. Accessibility

- 2px focus ring in `--focus` with offset on every interactive element; `#2E7BD1` wherever the ground is navy.
- `aria-current="page"` on the active nav row; `aria-label` on icon-only buttons; `role="alert"` on error messages; `aria-haspopup` on menus.
- Dialogs close on Escape, trap focus, and return focus to the trigger.
- Hit targets 40px minimum in consoles, 44–48px on phone.
- Text 4.5:1 minimum. Status colours are always paired with a word, never colour alone.
- Theme choice persists (`df-admin-theme` in Admin).

---

## 11. Assets

- `assets/dripfunnel-logo.svg` (light grounds) and `dripfunnel-logo-inverse.svg` (dark grounds, side bar, header); `dripfunnel-mark*.svg` for the prototype strip.
- `assets/favicon/` — full favicon set: `round-light/dark`, `favicon-light/dark` at 16–512px, `apple-touch-icon-180.png`, `maskable-dark-512.png`. Every prototype links the round light/dark pair by `prefers-color-scheme`.
- `assets/icon-ink-512.png` — app icon shown in the Style Guide.
- `uploads/logo-light.png`, `logo-dark.png` — partner-brand samples for Branding.

---

## 12. Adding a new screen

1. **Store:** create `Something.dc.html` with a logic class that reads `this.props.app`. Keep local UI state (`tab`, `q`, `sel`, `draft`, `orig`) in the child; write shared data back with `app.set` / `app.update*`. Add the screen key to the shell's `nav`, `crumbs` and the `<sc-if>` mount list, and a scenario/control if it needs one.
2. **Platform / Admin:** add a route key to `NAV`, a permission to `CAN` / `PAGE_PERM` if role-limited, and dummy data to `partner-data.js` / `admin-data.js`.
3. Copy an existing screen's card, table and pill markup rather than inventing new ones.
4. Cover empty, loading, error and read-only before calling it done.
5. Check it at phone width via the Screen/Device control.

---

## 13. Known gaps

- Support sessions are read-only only in wording: the Store prototype doesn't block saves yet.
- The Admin prototype's **Environment** control offers only Production and Staging. The product
  has four environments, named by hostname (Production, Dev, Feature, Local; decided on #65), and
  the console builds those; the prototype is behind it.
