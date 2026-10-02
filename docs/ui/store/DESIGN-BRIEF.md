# DESIGN-BRIEF.md: the merchant portal

The prompt to give Claude when designing the **merchant portal** (`apps/ui/store`), plus the
full list of flows to work through one at a time. It was ported from the
first platform's DESIGN-BRIEF on 2026-09-28, with its framework facts replaced by facts about our own headless engine
([`../../api/PLATFORM-PROMPT.md`](../../api/PLATFORM-PROMPT.md) §6). Users, flows 1–69, their
numbers and section letters are kept so that citations such as "flow 58" or "§E" stay valid;
new flows start at 70 in part L. Where this document disagrees with
[`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) or
[`../../USERS-AND-DOMAINS.md`](../../USERS-AND-DOMAINS.md), those two win.

Last updated: 2026-10-02.

Paste §1 to start a design session, then name a flow from §3.

---

## 1. The prompt

> You are designing the **DripFunnel merchant portal**: the web app merchants and
> vendors use to run their store. It is a new build on a new engine; the visual baseline is
> `.design/settings-tabs.html`, but nothing in this repo is built yet.
>
> **Read these first.** They are the specification, and they settle questions you
> would otherwise have to guess at:
>
> - [ARCHITECTURE.md](../../ARCHITECTURE.md) and [USERS-AND-DOMAINS.md](../../USERS-AND-DOMAINS.md):
>   the five kinds of user, where each signs in, and how the platform is deployed. These win
>   over everything else.
> - [SAAS.md](../../api/SAAS.md): what the platform is and what it does (partners,
>   provisioning, plans, billing, domains, publishing)
> - [ACCESS.md](../../api/ACCESS.md): who the users are, what each may do, and the rules the
>   UI must not contradict
> - [PLATFORM-PROMPT.md](../../api/PLATFORM-PROMPT.md): the engine and its APIs, if you need
>   them
> - [CATALOG-DESIGN.md](CATALOG-DESIGN.md) and [OFFERS-DESIGN.md](OFFERS-DESIGN.md): the
>   catalogue and offers screens in detail
>
> **The system in one paragraph.** DripFunnel hosts online stores, sold directly and through
> white-label *partners*. A *merchant* signs up on their partner's portal host, gets their own
> store, pays a subscription, and either designs their storefront by describing changes in
> words rather than editing code, or builds their own storefront on our public Shop API. A
> merchant can invite *vendors* (the UI calls them **Suppliers**): suppliers whose products
> appear in the merchant's catalogue, and who see only their own. Shoppers never see this
> portal; they see the storefront, which is a separate site.
>
> **Design one flow at a time.** I will name one. Produce the screens for it,
> including the states that are not the happy path: empty, loading, error,
> permission-denied, and the degraded state when a subscription has lapsed. Ask me
> when the specification is silent rather than inventing an answer; when it does
> decide something, follow it.
>
> **Fourteen facts that shape the interface.** These are not implementation trivia:
> each one changes what a screen must show.
>
> 1. **A person can belong to several stores at once** under the same partner, and can be
>    staff in one and a vendor in another (under another partner it is a separate account). Every screen is scoped to one store, and
>    the app must never pick for them when more than one is available. There is a
>    store switcher, and the current one must always be visible.
> 2. **Vendors and staff appear in the same user list** and must be visually
>    distinct: they have different powers and different risks.
> 3. **A vendor's access level is chosen by the merchant**, one of three offered tiers:
>    **Stock only** (they update quantities, nothing else), **Products and stock**, or
>    **Products, stock and their orders** (fulfilling their own order lines). A fourth,
>    read-only orders tier is defined but not offered. The navigation itself differs
>    between them. **The merchant also chooses how each supplier ships** (decided
>    2026-10-02): **to your warehouse**, so the supplier sees nothing of the shopper and the
>    store delivers, or **to the shopper**, so the supplier ships its own lines and sees the
>    name and delivery address only (ACCESS.md §7.3).
> 4. **The merchant can edit a vendor's product, and the vendor sees that edit**:
>    it is one shared record, not a copy. The interface has to say so on both
>    sides, or it reads as a bug.
> 5. **Whether vendor products need approval is a per-store setting.** Design
>    both journeys: straight to the storefront, and held in a review queue.
> 6. **An order can contain several vendors' products**, and the engine splits it into
>    per-vendor sub-orders. A vendor sees only their own sub-order and lines. Never show
>    them an order total: shipping, discounts and tax span sellers and cannot honestly be
>    attributed to one.
> 7. **The AI storefront designer never publishes straight to production.** The
>    shape is: describe a change → preview → approve → publish. Undo is a
>    first-class action.
> 8. **Signup is meant to take under two minutes and involve no staff**, but it is
>    several slow steps behind the scenes. It needs a real progress experience, and
>    a way to fail gracefully.
> 9. **When a subscription lapses the portal blocks changes but does not lock the
>    merchant out**, and the storefront degrades rather than disappearing. That is a
>    designed state, not an error page.
> 10. **Every merchant and every vendor has their own warehouses.** Stock is held
>     per warehouse, not per product, and a product saved without a warehouse goes
>     to that owner's default one, so the common case must not feel like filling in
>     a grid. A vendor must never see how much stock the merchant or another vendor
>     holds; quantities are commercially sensitive.
> 11. **Offers are the merchant's alone**: coupon codes and automatic discounts,
>     with date windows and usage limits. **Vendors cannot create or edit them and
>     have no offers screen at all**; discounting the merchant's store is the
>     merchant's decision. A scheduled offer, a live one and an expired one are three
>     different things on screen and are routinely confused.
> 12. **Every screen renders in the partner's look** (white label). DripFunnel is only the
>     house partner; never hard-code its name, colours or domain.
> 13. **Stores are global.** Tax, currency, units, date and number formats, languages and
>     product compliance follow the store's home country and the markets it sells to, never
>     India or anywhere else by default (CATALOG-DESIGN §3 facts 36–48). Wherever a screen
>     differs by region, show a US, an EU and an Indian store.
> 14. **A store may have no AI storefront at all.** A merchant can use their own
>     storefront on the Shop API instead. Storefront screens (part H) must know which kind
>     the store has, and say what does and doesn't apply.
>
> **What to call it.** The portal is the **merchant portal**; the API it calls is the
> **Store API**. Do not call either "the BFF" or "DF Store".
>
> **Two things the interface must never do**, both for security rather than taste:
>
> - **Never reveal whether an email address already has an account.** Inviting
>   someone who already has one is normal: they may belong to another store.
>   The response must look identical either way.
> - **Never show a vendor anything belonging to the merchant or to another
>   vendor**, including in search results, counts, empty states and exports.
>
> Start by telling me what you understand the system to be and who its users are,
> in your own words, and name anything the specification leaves genuinely open.
> Then wait for me to pick a flow.

---

## 2. Who the users are

| Role | Key | Who they are | Where they work |
|---|---|---|---|
| **Owner** (merchant) | `owner` | Runs the store. The only role that invites people, manages vendors, approves products and publishes the storefront. | Merchant portal |
| **Manager** (merchant) | `manager` | Runs catalogue and orders day to day. No billing, no user management, no payment/shipping configuration. | Merchant portal |
| **Staff** (merchant) | `staff` | Handles orders and customers. Read-only on catalogue. | Merchant portal |
| **Supplier · Stock only** | `vendor-stock` | Updates quantities in their own warehouses. Reads the catalogue only to find their own versions. Never sees orders. | Merchant portal |
| **Supplier · Products and stock** | `vendor-catalogue` | Supplies products and their stock. Never sees orders. | Merchant portal |
| **Supplier · Products, stock and their orders** | `vendor-orders-fulfil` | As above, plus sees and fulfils their own order lines: ships them to the shopper, or marks them as sent to the store's warehouse, by the shipping mode the merchant set (fact 3). Refunds their own lines. | Merchant portal |
| **Supplier · Read-only orders** (defined, not offered) | `vendor-orders-read` | As Products and stock, plus sees which of their products sold, without fulfilling. Not offered in the Supplier tab today. | Merchant portal |
| **Supplier admin / Supplier member** (team roles, decided 2026-10-02) | `supplier-admin`, `supplier-member` | Inside one supplier, at whatever access level the merchant set: the admin also manages the supplier's own team; the member doesn't. The merchant's first invited supplier user is its admin. | Merchant portal |
| **DripFunnel staff and partner users** | Admin: Super admin, Partner manager, Support, Finance, Engineer on call, Read-only. Partner: Owner, Admin, Support, Finance, Read-only (proposed) | Staff run the platform from the **admin console** (`admin.dripfunnel.com`); partner users manage their merchants at account level from the **partner console** (`platform.dripfunnel.com`). Neither signs in to the merchant portal. They reach a store only through audited, read-only support access that the Owner controls ([USERS-AND-DOMAINS](../../USERS-AND-DOMAINS.md) §4.1; flow 79). | Admin console / partner console, **not** this portal |

Roles are fixed templates, permission sets in code. There is no role editor, and nothing is
cloned per store.

---

## 3. The flows

**Nothing in this repo is built yet.** Where a flow is marked *Built in the first platform*,
the first platform had working screens for it; their design survives in
[`../../../../.design/settings-tabs.html`](../../../../.design/settings-tabs.html), which is the
visual baseline: keep their look and words unless the engine changes what they can say
(PLATFORM-PROMPT §6). That covers flows 1–13 (§A *Getting in* and §B *People*), flows 14–19
(§C *Vendors*, bar the vendor's own product list), flows 30–32 (§E, the warehouse list and its
default) and flows 54–58 (§I *Store settings*, including the custom domain).

Two structural decisions from the first platform's Settings design (`Portal G Settings Tabs`) carry
over:

- **People is a Settings tab, not a screen with its own nav row.** Owner's left bar is 11 rows.
- **Suppliers, warehouses and the approval queue live in Settings too**, which is why §C and
  §E have no screens of their own.

Ordered roughly by dependency: earlier ones are needed to reach later ones. Each
line says who it is for and the thing most likely to be missed.

### A. Getting in

*Built in the first platform; its screens are the visual baseline (PLATFORM-PROMPT §6).*

1. **Sign up / store provisioning**: new merchant, on their partner's portal host and in
   the partner's look. Under two minutes, no staff. Needs a genuine progress state and a
   failure path that does not leave a half-made store. A partner that is not yet approved
   can't take sign-ups (USERS-AND-DOMAINS §3).
2. **Log in**: everyone. Must handle the person who belongs to no store at
   all, which is refused rather than empty.
3. **Choose a store**: anyone in more than one. The app must not pick.
4. **Switch store**: same. Always-visible current context; consider what
   happens to a half-finished form.
5. **Forgot password → reset**: everyone. Must not reveal whether the address
   exists.
6. **Accept an invitation**: new user setting a password; and the existing
   account simply joining another store, which skips the password step. Includes the
   Owner of a store a partner created from the partner console, who receives an
   invitation rather than a password by email (USERS-AND-DOMAINS §3).
7. **Log out**: everyone. One session across all stores, not one each.

### B. People

*Built in the first platform; its screens are the visual baseline (PLATFORM-PROMPT §6).*

8. **User list**: Owner. Staff and vendors together, visibly distinct, with
   pending invitations shown alongside active people.
9. **Invite a user**: Owner. Email, name, role from a fixed list. Identical
   response whether or not the account already existed.
10. **Pending invitation: resend, revoke, expiry**: Owner. Invitations expire
    after seven days; expired ones must be obvious and recoverable.
11. **Change someone's role**: Owner. Includes refusing to demote the last Owner.
12. **Remove someone**: Owner. Removing from *this* store, not deleting the
    person, who may belong to others.
13. **My profile**: everyone (`PortalProfile`, designed 2026-10-02). Name, email (changed
    through a link to the new address), mobile number, password (changing it signs out every
    other device), **two-step sign-in** (required for Owners, optional for everyone else;
    authenticator app or SMS; ten backup codes shown once), appearance (light or dark) and
    **where you're signed in** with "Sign out everywhere else" (ACCESS.md §2, §4).

### C. Vendors

*Flows 14–19: built in the first platform's portal; its screens are the visual baseline
(PLATFORM-PROMPT §6).*

14. **Vendor list**: Owner. Each vendor's access level and product count.
15. **Invite a vendor**: Owner. Heavier than a user invite: it creates the vendor
    as well as their first user.
16. **Change a vendor's access level**: Owner. Takes effect on the vendor's next request
    (PLATFORM-PROMPT §5.2); say so, and say what the vendor loses or gains.
17. **Suspend or remove a vendor**: Owner. Decided 2026-10-02 (ACCESS.md §7.5): suspending
    **hides** their products until the vendor is resumed; removing hides them and keeps them,
    still marked as theirs, for the merchant to publish or delete. The screen states the
    count and offers the hidden list.
18. **Approval setting**: Owner. The per-store switch that decides whether
    vendor products go live immediately.
19. **Approval queue**: Owner, only when that setting is on. Review, approve,
    reject with a reason.
20. **Vendor's own product list**: vendor. Strictly their own, including counts
    and empty states.

### D. Catalogue

21. **Product list**: merchant sees everything with vendor attribution; vendor
    sees only their own. One screen, two very different views.
22. **Create a product**: merchant and vendor. The vendor's version has no
    control over publication status when approval is required, and picks a
    warehouse (or silently gets their default, flow 32).
23. **Edit a product**: both. The merchant's version must say that the vendor
    will see these edits.
24. **Versions and pricing**: both. Prices are stored per currency the store sells in and
    are tax-inclusive or tax-exclusive according to the store's setting; the form shows the
    store's currencies and its tax mode, never an assumed one (CATALOG-DESIGN §3 facts 5–6,
    25–26, 37). The "was" price is labelled and validated by region (fact 41).
25. **Images and media**: both.
26. **Collections**: merchant.
27. **Facets and filters**: merchant.
28. **Import products from a file**: merchant. Long-running, partial-failure
    reporting, and every imported row needs a warehouse.
29. **Export products**: merchant. Long-running, produces a download.

### E. Inventory and warehouses

*Flows 30–32: built in the first platform's portal; its screens are the visual baseline
(PLATFORM-PROMPT §6).*

30. **Warehouse list**: merchant sees every warehouse in their store with its
    owner; a vendor sees only their own.
31. **Create or edit a warehouse**: merchant, and vendor for their own (settled, see §4).
    Name, description, address.
32. **Choose the default warehouse**: per owner. This is what a product gets when
    nobody picks one, so it must be obvious which it is and impossible to end up
    with none.
33. **Stock for a product**: quantities per warehouse. Most sellers have exactly
    one, and that case must stay a single number rather than a matrix; several
    warehouses is the expansion, not the default.
34. **Stock overview and low stock**: merchant across their own stock, vendor
    across theirs. The screen most likely to leak a competitor's numbers if the
    filter is wrong.
35. **Moving stock between warehouses**: **decide whether this exists.** The engine keeps
    stock as a ledger of movements with reasons (PLATFORM-PROMPT §5.4), so a transfer can be
    one recorded movement rather than two unexplained adjustments; whether merchants need
    it, and what stock "in transit" looks like, is still a product decision. See flow 73.

### F. Orders and customers

36. **Order list**: merchant sees all; vendor sees only orders containing their
    products.
37. **Order detail**: merchant sees the whole order. **The vendor sees only their
    own lines and no order total.**
38. **Fulfil an order**: merchant fulfils anything, booking a courier label or entering
    tracking; a vendor on the top tier fulfils only their own lines, **shipping them to the
    shopper or marking them as sent to the store's warehouse, by the shipping mode the
    merchant set** (fact 3, decided 2026-10-02). Partial fulfilment is normal, and the stock
    comes out of a specific warehouse, which the screen should make visible. See flow 70.
39. **What a vendor may see of a customer** (settled 2026-10-02, ACCESS.md §7.3): a vendor
    shipping to the store's warehouse sees **nothing**, not even a name; a vendor shipping to
    the shopper sees the name and delivery address, never email or phone. Design 37 with both.
40. **Customer list and detail**: merchant only. Designed 2026-10-02: add and edit, groups,
    tags, a team-only note, marketing consent, export.
41. **Refunds, cancellations and returns**: designed 2026-10-02 (`PortalOrders`; ACCESS.md
    §7.3): a return per line with a reason and a label, states on its way back → received →
    refunded; refunds per line grouped by owner, each supplier refunding its own, the store
    able to override into the supplier ledger; restock really restocks. See flow 71.

### G. Marketing and offers

**Merchant-only, throughout.** A vendor never sees any of these screens, and
"Marketing" does not appear in their navigation.

42. **Offers list**: merchant. Live, scheduled and expired are three states people
    confuse; the list has to separate them at a glance.
43. **Create an automatic discount**: merchant. Applies at checkout with no code,
    e.g. 10% off a collection, or free shipping above a threshold.
44. **Create a coupon code**: merchant. The code itself, who may use it, how often
    in total and per customer.
45. **Schedule an offer**: merchant. Start and end dates, including the "starts in
    three days" state, which is neither live nor expired.
46. **Enable, disable, expire**: merchant. Turning a live offer off is a
    high-consequence action and should feel like one.
47. **What the shopper sees**: merchant. An offer is invisible in the portal;
    somewhere the merchant needs to see its effect on the storefront.

### H. Storefront

For a store with an AI storefront. A store using its own storefront sees flow 75 and the
catalogue publishing status (flow 80) only where it applies.

48. **Storefront overview**: Owner. Current state, last published, what changed.
49. **Describe a change**: Owner. The AI prompt surface; the heart of the product.
50. **Preview and approve**: Owner. Before and after, and what to do when the
    change broke the build.
51. **Publish**: Owner. Progress, then confirmation the live site has changed.
52. **History and undo**: Owner. Every change is revertible; make that obvious
    rather than buried.
53. **Usage against the plan**: Owner. Prompts, build minutes and "Publish now" catalogue
    publishes are metered, and running out must not be a surprise.

### I. Store settings

*Built in the first platform; its screens are the visual baseline (PLATFORM-PROMPT §6).* It
had eight tabs (`Portal G Settings Tabs`): Store info, People, Supplier, Payment setup,
Shipping, Warehouse, Tax setup, and custom domain (58). The new platform adds Settings ›
Developers (flow 76) and Settings › Support access (flow 78).

54. **Shipping methods**: Owner. The archive allowed only one active method at a time, a
    rule enforced by the old backend; confirm whether it survives now that the engine has
    shipping zones *(ask)*. Whatever the rule, the interface has to make it visible rather
    than surprising.
55. **Shipping charges**: Owner. Free, charged, or free above a threshold.
56. **Payment methods**: Owner. The merchant's own provider credentials (Stripe and
    Razorpay first), offered according to the store's region.
57. **Taxes and tax registrations**: Owner. Home country and selling markets, tax
    registrations per country (VAT number, EU OSS, US sales-tax permits, GSTIN…), tax
    classes and their rates by zone, and tax-inclusive or tax-exclusive pricing
    (CATALOG-DESIGN §3 facts 36–38). Product classification codes (`hsCode`) are optional
    and neutral; India's HSN codes and GSTIN are one regional example, not the model.
    Required for real orders.
58. **Custom domain**: Owner. Enter a domain → prove ownership via a DNS record →
    wait for a certificate → live (Cloudflare for SaaS). Multi-day, asynchronous, easy to
    get lost in.

### J. Billing

59. **Choose a plan**: Owner. At signup and when changing later. Plans and prices are the
    partner's (USERS-AND-DOMAINS §3).
60. **Subscription and invoices**: Owner.
61. **Payment method for the subscription**: Owner. Distinct from the store's own
    payment methods; do not let the two be confused.
62. **Past due**: Owner. The designed degraded state, not an error.
63. **Trial ending**: Owner.
64. **Cancel**: Owner. What happens to the store, the products and the domain.

### K. States that cut across everything

Not screens of their own, but they must be designed once and applied everywhere:

65. **Empty states**: no products, no orders, no vendors, no users, no warehouses.
    A new store is empty at every screen, so this is the merchant's actual first
    impression.
66. **Loading and slow operations**: imports, exports, publishes, AI runs.
67. **Permission denied**: a Manager reaching an Owner-only screen, or a vendor
    reaching anything that is not theirs.
68. **Read-only mode**: everything above while a subscription is past due.
69. **Something went wrong**: including the case where the Store API itself is
    unreachable.

### L. Added by the new platform

Flows the engine now makes possible (PLATFORM-PROMPT §3.3, §6) and the headless model adds.
Merchant-side unless stated. The developer-facing flows (75–77) are written for a
non-technical merchant who needs to hand details to a developer, not for the developer.

70. **Vendor sub-orders and fulfilment**: merchant and top-tier vendor. An order splits into
    one sub-order per vendor with its own lines, status and fulfilment; the merchant needs
    to see the whole order and each part's progress at once, and the vendor sees only their
    part, still with no order total.
71. **Refunds and returns**: merchant (Owner and Manager) starts returns and refunds its own
    lines; a top-tier vendor refunds its own lines, up to their value (decided 2026-10-02,
    ACCESS.md §7.3). A refund or return can touch several vendors' lines and a shared
    shipping charge or discount; show exactly which lines, amounts and stock return, group
    lines by who refunds them, and warn before the store overrides a supplier ("the amount
    comes off their next payout", meaning the supplier ledger).
72. **Customer groups**: merchant only. Groups used by offers and pricing (OFFERS-DESIGN §3
    fact 12); the thing most missed is showing where a group is used before it is edited or
    deleted. A vendor never sees groups.
73. **Stock movements**: merchant for their stock, vendor for theirs. A history of every
    change with its reason (sale, return, adjustment, import, transfer if flow 35 exists)
    and who made it; must never show another owner's movements, even in totals.
74. **Plans and entitlements**: Owner. What the plan includes, what is locked and why, and
    how close the store is to each limit; locked features say so plainly instead of
    disappearing, and only the Owner is offered the upgrade.
75. **Choose the storefront: AI or own**: Owner, at signup or later. "Design it with AI" or
    "Use my own storefront", switching between them, and what each costs on each plan;
    switching must not lose orders, customers or web addresses *(ask how the choice is
    offered, and whether plans differ)*.
76. **Settings › Developers**: Owner. The public store key, allowed origins, API keys
    (create, scope, bind to a vendor, rotate, revoke, last used) and webhooks (endpoints,
    events, delivery log, replay, failing-endpoint alerts); a new key's secret is shown once
    and never again, and the store key is the only credential safe to put in a browser.
77. **Apps**: Owner. Browse, install with scope consent, configure, uninstall, and what an
    app can see; the consent screen must say in plain words what the app can read and
    change, and uninstall must say what stops working *(ask: embedded pages or links
    only, and where Apps sits in the nav)*.
78. **Vendor's own API key** (*later*, decided 2026-09-28): Supplier admin. A key for their stock or
    catalogue integration, bound to their own `seller_id` and never more than their tier
    allows; the merchant must be able to see and revoke it.
79. **Settings › Support access and the support-session banner**: Owner for the setting,
    everyone for the banner. "Allow [partner name] support to view my store: On / Off" (on
    by default), the Support access log, and the banner every signed-in person sees while a
    read-only support session is open, with the "Allow / Deny" prompt when support asks for
    write access (USERS-AND-DOMAINS §4.1). Easy to miss: the setting covers the partner's
    support only; the screen must say that DripFunnel staff can still sign in as a user
    for support, and show the banner the store sees when they do (USERS-AND-DOMAINS §4.2).
80. **Catalogue "Publish now" and publishing status**: Owner (and Manager *(ask)*), for a
    store with an AI storefront. What is waiting ("12 products changed since 10:40"),
    publishes left this month, when the next automatic publish is due, and a real status
    (queued, building, deploying, live, failed); a failed build keeps the old live site and
    never uses up an allowance, and at zero the button explains itself
    ([storefront ARCHITECTURE](../../storefront/ARCHITECTURE.md) §4.2).
81. **Customer accounts**: Owner. Settings › Customer accounts: shoppers sign in by email,
    mobile number or both (ACCESS.md §2.1). Easy to miss: what happens to existing customers
    when the choice changes.
82. **Supplier team**: Supplier admin. Invite colleagues into their own supplier, choose
    Supplier admin or member, resend, remove. Easy to miss: they can never grant more than
    the access level the merchant set, the merchant's Owner still sees and can remove every
    supplier user, and a supplier can't lose its last admin (DATA-MODEL.md §4.2).

---

## 4. Open questions the design will force

These are unresolved in the specification unless marked settled. Designing the relevant flow
will probably settle them; flag them when you hit one rather than assuming:

- ~~What a vendor may see of a customer (flow 39).~~ **Settled 2026-10-02:** it depends on the
  supplier's shipping mode, set by the merchant: nothing when the supplier ships to the
  store's warehouse; name and delivery address, not email or phone, when it ships to the
  shopper; applied in the engine's serializer rather than the UI (ACCESS.md §7.3). This
  replaces the 2026-09-28 answer, which assumed every supplier ships to the shopper.
- ~~Whether editing an approved product sends it back for re-approval (flow 23).~~ **Settled
  2026-10-02:** only for name, price or photo changes, and the product is hidden until
  approved; a vendor can take its own product off sale that way, accepted (ACCESS.md §7.2).
- ~~What happens to a removed or suspended vendor's products (flow 17).~~ **Settled
  2026-10-02:** hidden; restored on resume, kept after removal (ACCESS.md §7.5).
- ~~Whether refunds spanning vendors are the merchant's problem alone (flows 41, 71).~~
  **Settled 2026-10-02:** each supplier refunds its own lines, the store can override into a
  supplier ledger settled outside the platform (ACCESS.md §7.3). Whether returns are in the
  first release is FIRST-RELEASE.md's (#184).
- ~~Whether the portal remembers the last store or asks every time (flow 3).~~ **Settled by
  the first platform's build:** the portal remembers the last store and offers it as one button with
  the full list underneath, an offer rather than a choice made for the person; one membership
  skips the screen. The remembered id is a client-side convenience only; the server checks
  the acting store against the session's memberships on every request (the first platform's AUTH-PLAN
  §3.2 and its settled questions, now [ACCESS.md](../../api/ACCESS.md)).
- ~~Whether two-factor authentication applies to Owners only or everyone (flow 13).~~
  **Settled 2026-10-02:** required for Owners, optional for everyone else (ACCESS.md §2).
- ~~Whether a vendor may create their own warehouses, or the merchant creates them on
  the vendor's behalf (flow 31).~~ **Settled by the first platform's Settings design and build:** a
  supplier's locations are the supplier's. The merchant sees them in the Warehouse tab, in
  their own labelled group (they need to know where their catalogue ships from) but cannot
  rename or remove one, and supplier locations are never offered as the default for new
  products, because a supplier product is stocked by its supplier.
- Whether stock can move between warehouses at all (flows 35, 73).
- Whether the first platform's one-active-shipping-method rule survives (flow 54).
- How the portal offers the AI-or-own storefront choice, and whether plans differ (flow 75;
  PLATFORM-PROMPT §5.6, §10).
- ~~Whether vendors can have their own API keys~~: later (flow 78; ACCESS.md §5.6).
- Apps: embedded UI in the portal or links only (flow 77; PLATFORM-PROMPT §5.5).
- Support session length and the email notice when a session starts (flow 79;
  USERS-AND-DOMAINS §4.1, §7).
- ~~A person with stores under two partners: which look?~~ **Settled 2026-09-28**: accounts
  are per partner, so each partner's portal is a separate account (ACCESS.md §2).
- Does past due block sign-in, and what happens to that store's vendors (flows 62, 68;
  PLATFORM-PROMPT §10).
