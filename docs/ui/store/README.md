# ui/store: the merchant portal

`apps/ui/store`: the web app merchants, their staff and their vendors use to run a store.
It is served on **each partner's portal host** (e.g. `store.northstar.com`, and
`store.dripfunnel.com` for the house partner), always **in that partner's look**, and it
calls the **Store API** at `/api` on the same host.

Shoppers never see it; they see the store's storefront (docs/storefront/). DripFunnel staff
and partner users never sign in to it; they reach a store only through an audited, read-only
support session (§6).

**Status: skeleton** (sign-in and home routes). **What the first release contains is
[FIRST-RELEASE.md](FIRST-RELEASE.md)** (decided on #184): every screen the prototype draws plus
the parts it doesn't draw yet, and what the Store and Shop APIs need. The first platform's portal
built sign-up, sign-in, store choice, invitations, profile and the eight Settings tabs; those
screens are the visual baseline (PLATFORM-PROMPT §6).

**The prototype is `designs/DF Store Prototype.dc.html`** — open it in a browser and click
through the screen you are building before you build it; its Role, Plan, Region and Scenario
controls reach the states. `designs/DF Store Pricing.dc.html` says what each plan includes,
which is what the portal's plan gates and upgrade prompts follow. The prototype decides
**behaviour**, `docs/` decides **scope and rules** ([../../README.md](../../README.md) §3).

Last updated: 2026-10-05.

| Document | Covers |
|---|---|
| This guide | Purpose, users, roles and permissions, navigation, areas, code specifics, rules |
| [FIRST-RELEASE.md](FIRST-RELEASE.md) | What the first release contains, screen by screen, what the Store and Shop APIs need, and the cards that build it |
| [DESIGN-BRIEF.md](DESIGN-BRIEF.md) | The design prompt for the portal: the facts that shape it, users, and every flow (1–69 and the new ones) |
| [CATALOG-DESIGN.md](CATALOG-DESIGN.md) | The catalogue in depth: products, versions, stock, collections, filters, menus, import/export, vendors and approval, languages, currencies, plans, regions |
| [OFFERS-DESIGN.md](OFFERS-DESIGN.md) | Offers in depth: automatic discounts, coupon codes, conditions, scheduling, limits, combining, results |
| [../README.md](../README.md) | How every SPA is built (structure, API calls, text, navigation, states, adding a screen) |
| [../../api/ACCESS.md](../../api/ACCESS.md) | Identity, sessions, roles and every authorization check behind this portal |

---

## 1. What it does

A merchant signs up (in the partner's look, or is created by the partner), gets a store in
under two minutes, and runs it here:

- **Catalogue**: products with options and versions, photos, stock per warehouse,
  collections, filters, menus, languages and currencies, import and export.
- **Orders and customers**: orders (with per-vendor parts), fulfilment, customers.
- **Offers**: automatic discounts and coupon codes. Merchant-only.
- **Storefront**: describe changes to the AI, preview, approve, publish; catalogue
  publishing ("Publish now" and automatic); history and undo; own domain.
- **Suppliers**: invite vendors, set their access level, approve their products.
- **Settings**: store info, people, suppliers, payments, shipping, warehouses, tax, custom
  domain, developers (store key, API keys, webhooks), support access.
- **Billing**: the store's plan and subscription with its partner (or DripFunnel on the
  partner's behalf).

---

## 2. Who uses it

| User | Who | Sees |
|---|---|---|
| **Owner** | Runs the store; the business that pays | Everything in the store |
| **Manager** | Runs catalogue, offers and orders day to day | No billing, people, suppliers, payment/shipping/tax setup or publishing |
| **Staff** | Handles orders and customers | Catalogue read-only |
| **Vendor** ("Supplier" on screen) | A supplier the merchant invited, at one of four access levels | **Only their own** products, stock, warehouses and (by level) order lines |

- **One person, one login, many stores, within this partner.** A person can be Staff in one
  store and a vendor in another, and can work for several suppliers in the same store (the
  store chooser then lists "Store · Supplier"), but is never both the merchant's staff and
  a supplier in one store. One role per membership. Accounts belong to one partner: the same email under
  another partner is a different account (ACCESS.md §2). Every screen is scoped to one **acting store**;
  when a person has more than one, the portal never picks for them, and the current store
  is always visible.
- **Roles are fixed templates**; there is no role editor. Changing a role takes effect on
  the next request.

---

## 3. Roles and permissions

What the portal shows each role. The API enforces the same rules (ACCESS.md §5 is
authoritative; this table must match it).

| Area | Owner | Manager | Staff | Vendor · Stock only | Vendor · Products and stock | Vendor · + their orders |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Home | ✓ | ✓ | ✓ | | | |
| Orders | all | all | all | | | own lines; the shopper's name and address only when the supplier **ships to the shopper**, nothing when it **ships to your warehouse** (ACCESS.md §7.3) |
| Refunds and returns | ✓ | ✓ | | | | own lines, up to their value; the store can override |
| Mark an order paid (cash on delivery, bank transfer) | ✓ | ✓ | | | | |
| Customers | all, add and edit | all, add and edit | all, add and edit | | | |
| Customers export | ✓ | ✓ | ✓ | | | |
| Reports and their export | ✓ | ✓ | | | | |
| Abandoned carts | ✓ | ✓ | read-only | | | |
| Products | all, edit | all, edit | all, **read-only** | own, **quantity only** | own, create and edit | own, create and edit |
| Collections, filters, menus | edit | edit | read-only | | | |
| Import / export | ✓ | ✓ | export | own export | own | own |
| Approve products (the "Waiting for approval" chip in Products, when approval is on; FIRST-RELEASE §3.1) | ✓ | | | | | |
| Offers | ✓ | ✓ (no plan prompts) | read-only list | **never** | **never** | **never** |
| Offer codes export | ✓ | ✓ | | | | |
| Storefront (AI designer, publish) | ✓ | read-only | | | | |
| Suppliers | ✓ | | | | | |
| Settings (all tabs) | ✓ | | | | | |
| Billing, plan prompts | ✓ | | | | | |
| Stock in the merchant's warehouses | edit | edit | read-only | | | |
| The merchant's warehouses (Settings › Warehouse) | ✓ | | | | | |
| Own warehouses and stock | | | | ✓ | ✓ | ✓ |
| Own supplier team (Supplier admin only) | | | | ✓ | ✓ | ✓ |
| Activity log: whole store, shoppers included (Settings; Store activity for a Manager) | ✓ | ✓ | | | | |
| Activity on a customer's page | ✓ | ✓ | | | | |
| Own activity (profile) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Your sales (own lines, **no totals**) | | | | | | ✓ |
| To ship (own lines: to the shopper, or marked as sent to the store's warehouse, by the supplier's shipping mode) | | | | | | ✓ |
| My profile (details, password, 2-factor, appearance, signed-in devices) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Keys: `owner`, `manager`, `staff`; supplier access levels `vendor-stock`, `vendor-catalogue`,
`vendor-orders-fulfil`, set by the merchant **per supplier**, as is the supplier's **shipping
mode**, `to-store` or `to-shopper` (ACCESS.md §5.2, decided 2026-10-02). Inside a supplier,
its own team roles: **Supplier admin** (manages the supplier's team) and **Supplier member**
(DATA-MODEL.md §4.2, decided 2026-10-02). **2-factor is required for Owners and optional for
everyone else** (ACCESS.md §2).
A fourth vendor tier, `vendor-orders-read` (own sales, no fulfilment), is defined but not
offered on the Suppliers screen (ACCESS.md §5).

**Owner-only capabilities**: invite people, manage vendors, approve vendor products,
publish the storefront, billing, settings.

---

## 4. Navigation

Rows per role, as the prototype draws them and FIRST-RELEASE.md §3.1 decides (#184; this replaces
the first platform's baseline, whose separate "To approve" and "Suppliers" rows are now
Products' approval chip and a Settings tab). Items a role can't use are **absent**.

| Role | Rows |
|---|---|
| **Owner** | Home · Orders · Customers · Offers · Abandoned carts · Reports · **Catalogue:** Products, Collections · **Your shop:** Storefront · **Admin:** Settings, Billing |
| **Manager** | Home · Orders · Customers · Offers · Abandoned carts · Reports · **Catalogue:** Products, Collections · **Your shop:** Storefront (view only) |
| **Staff** | Home · Orders · Customers · Offers (view only) · Abandoned carts (view only) · **Catalogue:** Products (view only), Collections (view only) |
| **Vendor · Stock only / Products and stock** | Your products |
| **Vendor · + read-only orders** | Your products · Your sales |
| **Vendor · + their orders** | Your products · To ship · Your sales |
| + **Supplier admin**, any level | + Your team |

- **People is a Settings tab**, not a row. Suppliers and warehouses live in Settings too; the
  approval queue is Products' "Waiting for approval" chip.
- **Collections, Filters and Menus** are three tabs of one destination.
- Settings tabs, in order: Store info (now with time zone, units and order numbers), People,
  Supplier, Payment setup, Shipping, Warehouse, Tax setup (the custom domain is in Store info), **Catalogue**
  (rich-listing features and badges, CATALOG-DESIGN P1) and **Markets** (CATALOG-DESIGN part
  T), then Customer accounts (email, mobile or both for shopper sign-in, ACCESS.md §2.1),
  Developers, Apps, Support access and Activity log (new; FIRST-RELEASE.md §15). **My profile** is in the user menu, not
  Settings (`PortalProfile`).
- Where vendors manage their own warehouses *(decide)*; the merchant sees them in the
  Warehouse tab in a labelled group but can't rename or remove them.

---

## 5. Areas and where they are specified

| Area | Flows (DESIGN-BRIEF) | Detail |
|---|---|---|
| Getting in: sign-up and provisioning, sign-in, choose and switch store, reset, invitations, sign out | A, 1–7 | ACCESS.md §4, §6; SAAS.md §5 |
| People | B, 8–13 | ACCESS.md §5, §6 |
| Vendors and approval | C, 14–20 | CATALOG-DESIGN part L; ACCESS.md §7 |
| Catalogue | D, 21–29 | CATALOG-DESIGN parts A–K, M–T |
| Inventory and warehouses | E, 30–35 | CATALOG-DESIGN part G |
| Orders and customers | F, 36–41 | PLATFORM-PROMPT §5.4 (orders, vendor sub-orders) |
| Offers | G, 42–47 | OFFERS-DESIGN |
| Storefront | H, 48–53 | docs/storefront/; SAAS.md §9 |
| Store settings | I, 54–58 | CATALOG-DESIGN part T (tax, regions) |
| Billing | J, 59–64 | SAAS.md §4, §7 |
| Cross-cutting states | K, 65–69 | §7 below; ../README.md §6 |
| Activity log: store log, customer activity, own activity | new | ../../api/LOGGING.md §6–7 |
| Added by the new platform | L, 70+ | DESIGN-BRIEF §3 L |

---

## 6. What is special about this app's code

The shared structure is in [../README.md](../README.md) §2. On top of it:

- **`src/brand/`** resolves the partner's look from the hostname (through the Store API's
  public brand query) and applies its tokens, logo and words **before anything renders**,
  including sign-in, sign-up, reset and invitation screens. No DripFunnel branding unless
  the partner's "Powered by" setting shows it.
- **Acting store**: a store switcher in the shell; the chosen store id travels with every
  Store API request and the server checks it against the session. It is remembered in
  `localStorage` as a convenience only.
- **Role-shaped screens**: one screen, different views per role (a product list shows
  supplier attribution to the merchant and only own products to a vendor). The role comes
  from the session context the API returns, never from local state.
- **Past due** puts the whole portal in a read-only state with a banner linking to billing;
  it never locks the merchant out.
- **Support session banner**: while a **partner** support session is open, every person
  signed in to that store sees "[Partner] support (name) is viewing your store. Read-only.
  Ends in 28 min." (USERS-AND-DOMAINS.md §4.1). DripFunnel staff never open one; when a staff
  member is impersonating, the banner says "Support (name) is signed in as …" (§4.2).
- **Regional by default**: every screen that differs by region is designed for a US, an EU
  and an Indian store; tax words, units and formats come from the store's settings.
- **Phone first**: every screen works at 360 px, with camera upload for photos.

```
apps/ui/store/src/
  brand/                    partner look from hostname
  features/
    auth/  signup/  home/  people/  suppliers/  products/  collections/  stock/
    orders/  customers/  offers/  storefront/  settings/  billing/  vendor/
  api/                      one file per Store API area
  nav.ts                    rows per role (§4)
```

---

## 7. Rules this app must never break

From DESIGN-BRIEF §1, CATALOG-DESIGN §8 and OFFERS-DESIGN §8:

- **Never show a vendor anything of the merchant's or another vendor's**: products, stock,
  counts, search results, filter counts, empty states ("0 of 340"), exports, order totals,
  offers. A vendor opening a URL that isn't theirs sees "not found".
- **Never offer a vendor** a visibility, approval or supplier control.
- **Never reveal whether an email has an account**: invitations, sign-up and reset respond
  identically.
- **Offers are the merchant's alone**: vendors have no row, no URL, no mention.
- **Never show a vendor an order total**: shipping, discounts and tax span vendors.
- **Shared records say so**: the merchant sees "This is [Supplier]'s product. They will see
  your changes."; the vendor sees "Your store owner can also edit this product."
- **Never show raw backend terms or errors**; prices never in minor units or with the wrong
  tax inclusion; dates in the store's named time zone; no country hard-coded.
- **Never gate only in the UI**; never paywall legally required information; name the plan
  that unlocks a feature; never delete content because a plan changed.
- **The AI storefront never publishes straight to live**: describe, preview, approve,
  publish; undo is always available.

---

## 8. Open questions

Carried from DESIGN-BRIEF §4, CATALOG-DESIGN §9, OFFERS-DESIGN §9 and ACCESS.md, where
they change this portal:

- ~~What a vendor may see of a customer.~~ **Settled 2026-10-02**: by the supplier's shipping
  mode (ACCESS.md §7.3).
- ~~Whether editing an approved product sends it back for approval.~~ **Settled 2026-10-02**:
  only name, price or photo changes, hidden until approved (ACCESS.md §7.2).
- ~~What happens to a removed or suspended vendor's products.~~ **Settled 2026-10-02**: removed → hidden and kept; suspended → the Owner chooses (ACCESS.md §7.5).
- ~~Refunds and returns across vendors.~~ **Designed 2026-10-02** (ACCESS.md §7.3); the release
  is FIRST-RELEASE.md's (written on #184: all of it ships, §1).
- ~~Staff: export, and a read-only offers list?~~ **Decided 2026-10-04 on #184**: both yes.
- Vendors: ~~import/export~~ (own only, #184), translations, other-currency prices, collections?
- ~~2-factor for Owners only, or everyone.~~ **Settled 2026-10-02**: Owners required, others
  optional (ACCESS.md §2).
- Whether past due blocks sign-in, and what happens to the store's vendors.
- Shopper sign-in options may be limited by the partner's plans? (ACCESS.md §2.1)
