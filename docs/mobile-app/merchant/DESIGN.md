# mobile-app/merchant: design

What the merchant mobile app looks like and how it behaves, and which prototype decides what.
Scope is [FIRST-RELEASE.md](FIRST-RELEASE.md); code structure is [ARCHITECTURE.md](ARCHITECTURE.md).

**Status: decided, not built.**

Last updated: 2026-10-08.

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
| Supplier (catalogue tiers) | Products · To ship · More |
| Supplier (stock only) | Products · More |

- **Active tab:** navy, weight 800, on a `#E3ECF5` pill. Inactive tabs are `#5A6472`, weight 600.
- **Badges:** counts of waiting work.
- **Catalogue** opens a segmented control: Products | Collections.
- The tab bar is hidden only in the full storefront designer.

**More** shows the person (initials, name, role and store), then two groups:

- **Your shop:** every menu item the role has that isn't a tab, such as Customers, Abandoned
  carts, Reports and Storefront.
- **Account:** My profile, Settings and Billing (Owner), Switch store, Sign out.

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
- **Banners** sit under the header, full width, each with one action: trial, trial ending,
  trial ended, bandwidth at 80% or more, white label on, offline ("Changes are kept on this
  device and will save when you're back").
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

- **Billing.** The prototype mounts the web Billing (a card in a hosted field, upgrade prompts
  to a card payment). The app buys plans and extra bandwidth through in-app purchase, with no
  card field (FIRST-RELEASE.md §2–§3).
- **The help button.** The prototype opens `help.dripfunnel.com/store`; the app opens the
  partner's help centre (white label).
- **"Email me a link"** (decided 2026-10-08). The prototype's Best on the web sheet offers to
  email a link to the web portal. The app instead **opens the web portal in the phone's
  browser**, on the partner's portal host. "Open here anyway" stays. Emailing
  a link would need a new Store API call, and the API isn't changed without permission
  (ARCHITECTURE.md §1).
