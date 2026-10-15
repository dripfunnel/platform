# mobile-app/merchant: design

What the merchant mobile app looks like and how it behaves, and which prototype decides what.
Scope is [FIRST-RELEASE.md](FIRST-RELEASE.md); code structure is [ARCHITECTURE.md](ARCHITECTURE.md).

**Status: decided, not built.**

Last updated: 2026-10-15 (#502: Settings, §5). Before: 2026-10-15 (#501: Collections, §5). Before: 2026-10-13 (#500: Products). Before: 2026-10-09 (#493: no Billing, offline banner, email links open the browser).

---

## 1. Which prototype decides

| Part | Decided by |
|---|---|
| **The app shell**: status bar, header, bottom tab bar, More, Home, the compact Storefront, bottom sheets, toasts, banners | `designs/mobile-app/merchant/DF Store App.dc.html` |
| **The content of every other screen** (Orders, Products, the product editor, Offers, Settings…) | `designs/DF Store Prototype.dc.html` at phone width (`device=phone`) |
| **Colour, type, spacing, radius** | `designs/DripFunnel Style Guide.dc.html` and `designs/design.md` §5–§7, with the mobile sizes in §4 below |

The screens in `designs/mobile-app/merchant/` other than `DF Store App` are copies of an older
snapshot of the Store prototype (from about 2026-09-29). The main Store prototype
is newer, and it's the one [store/FIRST-RELEASE.md](../../ui/store/FIRST-RELEASE.md) was planned
against. Six of its screens aren't in the mobile folder at all: `PortalProfile`, `SetAccess`,
`SetDev`, `StoreActivity`, `StorefrontContent` and `VendorViews`. So screen content comes from
the main prototype.

The copies stay in the folder only because `DF Store App` loads its screens from there by name,
and it won't run without them. Its own README says not to build from them (decided 2026-10-08
on #490). Pointing the shell at the current screens would need shell functions it doesn't have
yet.

As everywhere (docs/README.md §3), `docs/` decides scope and rules and the prototype decides
behaviour. If the two prototypes disagree about behaviour, **ask; don't pick one**.

---

## 2. The shell

**Status bar and header.** The status bar and the header share the navigation colour: the
partner's primary colour when white-labelled, otherwise navy `#0A2A4A`. The header is 54 px:

- **At a tab's root:** a store switcher (the store's initials in a 32 px tile, then its name).
- **Deeper:** a back button labelled with the parent screen ("‹ Orders").
- **On the right:** the avatar (32 px orange circle in a 44 px target). It opens a sheet with
  My profile, Switch store, and Sign out ("Signs you out of every store on this device").

**Bottom tab bar**, per role. Items a role can't use are absent, never disabled
(design.md §4):

| Role | Tabs |
|---|---|
| Owner, Manager, Staff | Home · Orders · Catalogue · Offers · More |
| Supplier, orders tiers (`vendor-orders-read`, `vendor-orders-fulfil`) | Products · To ship · More |
| Supplier, `vendor-stock` and `vendor-catalogue` | Products · More |

A supplier who cannot read orders has no To ship tab and no Your sales item, because the API
refuses it every order query (ACCESS.md §5.2). The tabs and the More items are data in
`apps/ui/mobile-app/merchant/src/nav.ts`, one list per role and tier.

- **Active tab:** navy, weight 800, on a `#E3ECF5` pill. Inactive tabs are `#5A6472`, weight 600.
- **Badges:** counts of waiting work.
- **Catalogue** opens a segmented control: Products | Collections.
- The tab bar is hidden only in the full storefront designer.

**More** shows the person (initials, name, role and store), then two groups:

- **Your shop:** every menu item the role has that isn't a tab, such as Customers, Abandoned
  carts, Reports and Storefront; for a supplier, Your sales (the orders tiers) and Your team
  (a Supplier admin).
- **Account:** My profile, Settings (Owner only), Switch store, Sign out. Billing is not in the
  app (FIRST-RELEASE.md §1).

In a development build a **Scenario** button opens a menu that picks which state, banner, role
and look the shell draws, so each can be screenshotted without a store in that state. It does
nothing in a store build.

A 58 px orange help button floats at the bottom right. It opens the **partner's** help centre
(SAAS.md §3.4), never DripFunnel's.

---

## 3. App-specific screens

**Home** (`DF Store App`, `homeApp`):
- Today's sales as a big number, with the order count.
- **Needs you**: orders to ship, products to approve, low on stock, each with its count. When
  nothing is waiting: "All caught up".
- **Add a product**, the one filled button, for roles that can edit.
- **Latest orders**: the three newest, with "See all".

A brand-new store with no products and no orders gets the main prototype's `PortalHome`
instead.

**Storefront** (`sfApp`):
- The live shop with a View button.
- **Change something:** a prompt to the AI designer makes a draft. The draft can be previewed,
  discarded or published. Publishing offers Undo in the toast.
- **Recent versions**, with Restore.
- Managers see it view only.
- "Templates and full designer" opens a **Best on the web** sheet. It offers to open the web
  portal in the phone's browser (§5), or "Open here anyway", which opens the full designer in
  the app.

---

## 4. Mobile patterns

- **Dialogs are bottom sheets**: top corners 24 px, a grab handle, full-width buttons 50 px
  tall, stacked with the confirm button on top. They follow design.md §4's modal spec (title,
  body, choices, one input, `danger`).
- **Toasts** sit above the tab bar: one line, an optional action (Undo), dark ground.
- **Banners** sit under the header, full width, in the portal's words (FIRST-RELEASE.md §3.3):
  provisioning, past due, trial, trial ending, trial ended, bandwidth at 80% or more, white
  label on, suspended, cancelled, a support session, offline ("You're offline. Changes need a
  connection.", decided 2026-10-09: no offline write queue in the first release,
  ARCHITECTURE.md §5). They carry no button, since plans and billing are not in the app (§5).
  While the phone is offline every button that saves is off. Trial ended, bandwidth and white
  label come from the Scenario menu only until the API sends the data for them.
- **Sizes:** hit targets 44 px or more; fields and buttons 44–50 px; content padding 16 px; list
  cards 16 px radius, quick tiles 14 px, buttons 12 px.
- **Lists are stacked cards**: the name, a muted second line, and the value or status on the
  right.
- **States**, as the prototype's Scenario control draws them: skeleton loading, "We couldn't
  load …" with a reference to quote to support, access denied (who can open it, and whom to
  ask), 404, session expired, removed from this store, invitation and expired invitation,
  offline, slow.
- **Native behaviour:** honour the safe areas, the system back gesture and button, and the
  keyboard (fields scroll into view). Light or dark follows the person's choice saved on
  their account (ui/README.md §4).

---

## 5. Where the app differs from the prototype

These follow decisions in `docs/`, so the prototype needs redrawing here:

- **Billing** is not in the app (decided 2026-10-09, FIRST-RELEASE.md §1). The prototype's
  Billing screen and its upgrade prompts aren't built. **Plan gates and plan banners** show their
  message with no buy or upgrade action. **Close my store** is at the end of Settings › Store
  info, Owner only.
- **The offline banner** says "You're offline. Changes need a connection." instead of the
  prototype's "Changes are kept on this device…" (§4).
- **Invitation and password-reset email links open the web portal** in the phone's browser, as
  today (decided 2026-10-09). Opening them in the app (universal or app links) would need files
  served on every partner's portal host, an API and hosting change that ARCHITECTURE.md §6
  doesn't list, so it is not in this release.
- **The help button.** The prototype opens `help.dripfunnel.com/store`; the app opens the
  partner's help centre (white label).
- **Products** (#500). The prototype's **Change with a reason** holds the change until Save; the API applies it at once (`adjustStock`), as the web portal does,
  so the sheet says it is saved right away. The prototype's "much higher than usual" price check needs the store's other prices, which the app doesn't
  read, so only "Selling for free?" is asked. A download, a service or a gift card opens read-only until MA 14 (#507). Quick edit and bulk actions are not
  on the phone (`designs/INCOMPLETE-FEATURES.md`).
- **Collections** (#501). The prototype's parts (Collections, Filters, Menus, Size charts) are a scrolling tab bar under the Catalogue segment. A menu item is changed from the sheet its row opens (move, nest, remove), not by four small buttons, and its desktop and phone previews stack. Changing a filter between shoppers and internal, and removing a menu item, ask in a sheet first, which the prototype does not. A size chart is a grid that scrolls sideways, and the size-chart limit and plan messages show with no "See plans" action, since plans are not in the app (§5). A supplier's own size charts are not in the app. A collection opens on its own screen with the shell's Back, not beside the list. Hand-picked products show what is picked above the search, and the live preview sits under the
  rules. Deleting asks in a sheet first, which says whether the collection is in the menu. A collection's image, SEO and sort order are not in the app.
- **Settings** (#502). The prototype's scrolling tab bar is a list of rows that each open on their own screen, as the card says, without the counts on its tabs. A write that loses or changes something says so in a bottom sheet first, and a refusal is worded by its code on the card it came from. Currencies and languages are on Store info, as docs/ui/store/FIRST-RELEASE.md §15 has them, not on Markets as the card lists them. The time-zone list shows names, not the time now in each. Not in the app: the shop's web address and Connect your own domain (docs/ui/store/FIRST-RELEASE.md §15).
- **"Email me a link"** (decided 2026-10-08). The prototype's Best on the web sheet offers to
  email a link to the web portal. The app instead **opens the web portal in the phone's
  browser**, on the partner's portal host. "Open here anyway" stays. Emailing
  a link would need a new Store API call, and the API isn't changed without permission
  (ARCHITECTURE.md §1).
