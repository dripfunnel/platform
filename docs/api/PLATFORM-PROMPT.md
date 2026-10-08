# PLATFORM-PROMPT.md

The prompt for the session that designs the **new DripFunnel platform**: its architecture, data
model, build order and product design. It replaces the first platform's plan, which was
built on a third-party commerce framework (removed from the workspace 2026-09-28; what still
held is ported into this repo).

Last updated: 2026-10-08 (#490: the mobile app's bearer session, §2 item 16).

**The change, in one line:** DripFunnel no longer runs on a third-party commerce framework.
**We build our own headless commerce engine, architected like established headless engines**
(a GraphQL Shop API and an admin-side Store API, configurable operations, custom fields, an
event bus and job queue), but designed for
multi-tenancy, vendors and white label from the first line. Everything else in the plan
still holds: merchants and vendors, repo-per-store storefronts, white-label brands and DF
Admin, and the stack. The one other change is that **storefronts are hosted on Cloudflare,
not AWS**.

**Deployment has since moved entirely to Cloudflare** (one `platform` repo; portal and DF
Admin as static SPAs on Pages; APIs and jobs on Workers; Postgres on Neon via Hyperdrive;
R2; SES). **[`../ARCHITECTURE.md`](../ARCHITECTURE.md) records those decisions and wins
wherever this document still mentions AWS containers, separate repos or a polling job
runner.**

**Headless means two kinds of storefront.** A merchant either lets DF Store's AI design and
host their storefront, or builds their own frontend on the public Shop API. Both are ordinary
API clients. **The AI-designed storefront is fully separate from the engine**, which is what
gives us complete freedom to change its design and behaviour without touching commerce.

Paste §1 to start a session. Everything after §1 is also specification.

---

## 1. The prompt

> You are the lead architect and product designer for **DripFunnel**, a multi-tenant commerce
> platform. Merchants sign up, get an online store, pay a subscription, and design their
> storefront by describing changes in words to an AI. A merchant can invite **vendors**
> (suppliers) whose products appear in the merchant's catalogue and who see only their own.
> **Partners** can resell the platform under their own brand (white label). DripFunnel staff
> run everything from **DF Admin**.
>
> **It is a headless platform, like Shopify.** The commerce engine exposes a
> **Shop API** (public, for storefronts) and a **Store API** (authenticated, for managing a
> store), both GraphQL. Everything else is a client of those APIs:
> - **the AI-designed storefront** DF Store builds and hosts for a merchant (repo per store on
>   Cloudflare);
> - **a merchant's own storefront** (any framework, any host) using the same Shop API;
> - **the merchant portal and DF Admin**, which are ordinary clients of the Store API;
> - **integrations and apps** (ERP, POS, marketplaces, third-party apps) through API keys,
>   webhooks and app installs.
>
> The AI storefront gets **no private door into the engine**: it uses the same public Shop
> API a merchant's own frontend would. That separation is deliberate. It lets the AI change
> the storefront's design and functionality freely, because nothing the storefront does can
> bypass the engine's rules on price, stock, tax, offers or tenancy.
>
> **What changed.** The first version of the platform used a **third-party commerce
> framework** as its backend. Every workaround in the old plan came from that framework not
> being built for this: permissions per channel rather than per row, list queries that leak across
> tenants, no vendor orders, promotions without collections or stacking rules, and a proof
> header so vendors couldn't bypass the portal. **That plan is archived. We now build our own
> commerce engine**, in our own Postgres database, so tenancy, vendors, white label and every
> "needs backend" item in the design prompts become things we design properly rather than
> work around.
>
> **What did not change** (§2 lists it in detail): the merchant/vendor model and its privacy
> rules, the roles, one login across many stores, the repo-per-store storefront with an
> AI-editable theme and a locked commerce core, the AI designer's preview-then-publish loop,
> white-label brands and DF Admin, and the stack (Next.js, Drizzle, Postgres, the GitHub App,
> Stripe Billing), now with **GraphQL** for the public APIs. **Storefronts move to
> Cloudflare.**
>
> **Read first**, in this order. The archived documents were written against the old
> framework; what still holds of them has been ported into this repo (2026-09-28), with
> framework facts replaced by engine facts:
> 1. [`SAAS.md`](SAAS.md): partners, merchant accounts, provisioning, plans, billing,
>    domains, publishing, fleet, metrics (was the first platform's SAAS-PLAN).
> 2. [`ACCESS.md`](ACCESS.md): identity, sessions, roles, invitations, vendors, tenancy and
>    the authorization checks (was AUTH-PLAN §3–5, §7–9, §11 and the first platform's ARCHITECTURE §4,
>    §6.3, §7).
> 3. [`../ui/store/DESIGN-BRIEF.md`](../ui/store/DESIGN-BRIEF.md): the portal's users and
>    the complete list of flows.
> 4. [`../ui/store/CATALOG-DESIGN.md`](../ui/store/CATALOG-DESIGN.md) and
>    [`OFFERS-DESIGN.md`](../ui/store/OFFERS-DESIGN.md): the catalogue and offers UX. Their
>    *(release: decide)* items are **engine requirements**.
> 5. [`../ui/admin/CONSOLE-DESIGN.md`](../ui/admin/CONSOLE-DESIGN.md): partners (white label)
>    and the admin console, with each part's partner-console counterpart.
> 6. [`README.md`](README.md) and `../code/`: where code lives (`apps/api` layers,
>    `apps/ui/shared/`, the one published package). Decided.
> 6b. `../storefront/`: the storefront's architecture and design (core
>    package, theme contract, preview and live modes). Already decided; design the engine
>    and hosting to serve it.
> 7. `../../AGENTS.md`: the ground rules (carried over from the first platform's BUILD-PROMPT).
> 8. §3.2 and §5.10 below: the commerce features the engine must cover, and the headless
>    patterns to copy (the Shop/Store API split, configurable operations and strategies,
>    custom fields, an event bus and a job queue). Copy the ideas, and not the parts §5.10
>    lists as mistakes for a multi-tenant platform.
>
> **What to produce.** Work in this order, and stop after each for my review:
> 1. **Restate** the platform, its users and the change in your own words, and list what you
>    think is still open. Then wait.
> 2. **`ARCHITECTURE.md`**: deployables, topology, repository layout, module boundaries,
>    tenancy and isolation, identity, the commerce engine's modules and their contracts, the
>    public APIs, storefront hosting on Cloudflare, jobs and events, billing,
>    config and secrets, deploy, observability, testing, and risks (§4–5 below are the
>    requirements). Record each decision with the alternative rejected and why, as the
>    the first platform's ARCHITECTURE.md §1 does.
> 3. **`DATA-MODEL.md`**: every table, grouped by module, with its tenant and seller scoping,
>    money and currency columns, translation strategy, soft-delete and audit behaviour, and
>    the indexes the main list screens need.
> 4. **`API.md`**: the public contracts (§5.5). The **Shop API** (catalogue, search, cart,
>    checkout, customer account, content) with caching rules; the **Store API** and its
>    permission model; **API keys**, **webhooks** and **apps**; versioning and deprecation;
>    and the SDK the storefront core package and merchants' own frontends use.
> 5. **`BUILD-PLAN.md`**: slices in dependency order, each with its gates (§8).
> 6. **`DESIGN-BRIEF.md`**: the portal and DF Admin design brief, rewritten for the new
>    engine (§6), plus updated catalogue, offers and admin prompts with their framework
>    facts replaced by the engine's own.
>
> **How to work.**
> - Where the archived documents decided something that is **not** framework-specific,
>   follow it. The alternatives were considered and rejected for recorded reasons.
> - Where a decision existed only because of the old framework, **say so and redesign it**. Don't carry
>   a workaround forward out of habit.
> - Prefer boring, proven designs. We are replacing a mature framework, and every module we
>   own is one we maintain. Scope the first release honestly (§8), and name what is deferred.
> - Ask me when the specification is silent or when §10 lists the question. Don't invent
>   product answers. Recommend one, then ask.

---

## 2. What carries over (binding)

Each item is a decision already made. Its source is in brackets; archive sources now live
in this repo: AUTH-PLAN and the first platform's ARCHITECTURE §4 in [ACCESS.md](ACCESS.md), SAAS-PLAN
in [SAAS.md](SAAS.md), DESIGN-BRIEF, CATALOG-DESIGN-PROMPT and OFFERS-DESIGN-PROMPT in
`../ui/store/` (as DESIGN-BRIEF, CATALOG-DESIGN, OFFERS-DESIGN).

**Product and people**
1. **Merchants, vendors and shoppers.** A merchant owns a store; vendors supply products into
   that store and see only their own; shoppers see only the storefront. [DESIGN-BRIEF §1]
2. **Roles**: merchant **Owner**, **Manager**, **Staff**; vendor **Stock only**, **Products and
   stock**, **Products, stock and their orders** (and a read-only orders tier). Fixed
   templates; **there is no role editor**. [AUTH-PLAN §5.3]
3. **One person, one login, many stores, within a partner.** A person can be Staff in one
   store and a vendor in another. Accounts never cross partners (decided 2026-09-28,
   ACCESS.md §2). Everything is scoped to the **acting store**, checked on every request against the
   session's membership set, never to the user. [AUTH-PLAN §3–4, ARCHITECTURE §4.1]
4. **Never reveal whether an email has an account**: invitations, sign-up and password reset
   respond identically either way. [AUTH-PLAN §7.2]
5. **Never show a vendor anything of the merchant's or another vendor's**, including counts,
   search results, empty states, exports and stock totals. A vendor never sees an order total.
   **Offers are merchant-only.** [DESIGN-BRIEF §1 facts 6, 10, 11]
6. **Vendor approval is a per-store setting**; the merchant can edit a vendor's product and the
   vendor sees the edit (one shared record). [DESIGN-BRIEF facts 4–5, AUTH-PLAN §8.4]
7. **Past due blocks writes but never locks the merchant out**, and the storefront degrades
   rather than disappearing. [DESIGN-BRIEF fact 9]
8. **Signup is automated, under two minutes, with no staff**, with a real progress experience
   and no half-made store on failure. [SAAS-PLAN §4]
9. **Stores are global**: region-driven tax, units, formats, languages, currencies and product
   compliance, never hard-coded to India. [CATALOG-DESIGN §3 facts 36–48]
10. **White label**: brands above stores, DripFunnel as the house brand, DF Admin for staff.
    [CONSOLE-DESIGN]

**Storefront and AI**
11. **A repo per store** from a shared template, an AI-written theme vs locked commerce.
    [SAAS-PLAN §1–2] **Now decided and specified in `../storefront/`**:
    commerce ships as a versioned package, `@dripfunnel/storefront-core`, which the AI
    can't edit; the AI writes the store's **theme code** inside a file allowlist, a code
    validator, sealed components and gates (decided 2026-10-08 on #470, "Plan A"), and changes
    **look and front-end behaviour, not commerce**; the template is internal and fully
    automated, so merchants never see code.
12. **A sync bot** (the upgrade bot) keeps the core package version current across the
    fleet, with canaries, codemods, a migration agent per store, and upgrade notes for majors. [SAAS-PLAN §5, docs/storefront/ARCHITECTURE.md §7]
13. **Two links per store** (docs/storefront/ARCHITECTURE.md §4): a **preview** SPA on
    the brand's preview subdomain with live data and no SSR or SSG, and a **live** static
    (SSG) site on the customer's domain. The live site stays current through a
    single-page render for each new or renamed product (decided 2026-10-08 on #470), a
    client-rendered fallback until it lands, catalogue publishing (a "Publish now" button
    limited to a monthly number of builds per plan, plus automatic periodic publishing of
    every store with changes), and edge
    rules for removed products. This replaces SAAS-PLAN §6's "catalogue changes never
    rebuild" for the live site only.
14. **AI never publishes straight to production**: describe → check in the store's sandbox
    (Cloudflare Containers) → commit → preview → approve → publish through the full gate, with
    undo as `git revert` and automatic rollback after deploy. Guardrails: file allowlist, the
    validator, build and typecheck, budgets, the checkout smoke test, sealed components, CSP,
    per-plan budgets ([`../storefront/ARCHITECTURE.md`](../storefront/ARCHITECTURE.md) §3,
    §4.2, §6). [SAAS-PLAN §7]

**Engineering**
15. **Stack**: React, Drizzle, Postgres (Neon via Hyperdrive), zod, Vitest, Playwright;
    APIs and jobs on **Cloudflare Workers**, UIs on **Cloudflare Pages**, files on **R2**,
    email through **SES**; Next.js for the storefront template; the GitHub App for repos;
    Stripe Billing for subscriptions (`../ARCHITECTURE.md` §1).
    [ARCHITECTURE §1] **The public APIs are GraphQL** (§5.5). Whether tRPC
    survives for portal-only screens (aggregated dashboards, platform operations) or the
    portal uses the Store API alone is a decision to make and record (§10).
16. **The browser holds no privileged token.** Portal and DF Admin sessions are server-side,
    behind an `httpOnly` cookie; idle 2 h, absolute 12 h. [ARCHITECTURE §7] API keys belong to
    servers, never to browsers; the Shop API's public store key is the only credential a
    browser may hold. The merchant mobile app is not a browser: it carries the same server-side
    session as a bearer token in the phone's secure storage (ACCESS.md §4, decided on #490).
17. **Every endpoint declares its scope, structurally.** The first platform's design did it with tRPC
    procedure bases and a test walking the router tree [ARCHITECTURE §4.2]. In GraphQL the
    same rule applies to resolvers: each one declares its API (Shop, Store, Platform or Admin), its
    permission and its tenant scope (a permission decorator, but tenant- and seller-aware),
    and a test walks the schema to prove no field is missing one.
18. **`SellerScope` is a discriminated union with no default**, so a forgotten vendor filter is
    a type error. [ARCHITECTURE §4.1]
19. **Vendor input can't carry ownership or visibility fields**: they are omitted from vendor
    input types and rejected rather than stripped silently. [ARCHITECTURE §4.3]
20. **Every privileged write is audited** with the real actor. [ARCHITECTURE §6.3]
21. **Durable jobs with per-step compensation**, idempotent handlers, a runner that can become
    its own process. [ARCHITECTURE §8]
22. **Typed config validated at boot; secrets never in images or client bundles.**
    [ARCHITECTURE §9]
23. **Migrations are reviewed SQL, backward-compatible for one release**, run before the new
    container replaces the old. Health checks check the database. [ARCHITECTURE §10]
24. **Build minutes and AI cost per store per month** are tracked from the first store.
    [SAAS-PLAN §14]
25. **Tests against real infrastructure**: a real Postgres (the local one, a fresh database
    per run — docs/api/README.md §7; no Docker), an authorization
    matrix run against the real API layer, no mocked data layer. [ARCHITECTURE §12]

---

## 3. What the old framework gave us, what goes away, and what we now own

### 3.1 Gone, and good riddance

These existed only because of the old framework. None of them may reappear in the new design:

- the `X-DF-Store-Proof` HMAC header and `DfStoreGuardPlugin`, which stopped vendors from
  signing in to the framework directly;
- per-store role **cloning** and namespaced role codes;
- the service-account-plus-channel-token model, and framework admin tokens held in sessions;
- `requiresDfStoreProof`, `channelAdministrators`, the invite plugin's throwaway password;
- cross-tenant leaks in unscoped queries (`administrators`, `Seller`, `TaxRate`), the
  default-channel-sees-everything behaviour, and store-wide `GlobalSettings`;
- the five-minute permission cache delay;
- "a simple product is a product with one variant" leaking into the UI;
- vendor order views stitched together outside the order model;
- the deployment-tracker rebuild on every catalogue change.

### 3.2 Now ours to build (the cost)

The old framework provided these, and the new engine must replace each one. The ported design docs
(`../ui/store/`) describe what the portal expects of them.

| Area | Must cover in the first release | Reference |
|---|---|---|
| **Catalogue** | Products, options, versions, photos, collections (automatic and hand-picked), filters, internal tags, menus, SEO, web addresses | CATALOG prompt parts B–J |
| **Inventory** | Warehouses per merchant and per vendor, stock per (version, warehouse), reserved stock, default warehouse | DESIGN-BRIEF §E |
| **Pricing and money** | Integer minor units, a currency on every amount, tax-inclusive or -exclusive stores, per-currency prices | CATALOG §3 facts 5–6, 25–26 |
| **Tax** | Tax class on the product, rate by class × shopper's zone, store-scoped rates | CATALOG §3 facts 37–38 |
| **Promotions** | Automatic and code offers, conditions, actions, dates, limits | OFFERS prompt |
| **Cart and checkout** | Guest and signed-in carts, addresses, shipping selection, tax and discounts, payment, order placement | new |
| **Orders** | Order lifecycle, payments, fulfilment, cancellations, per-vendor views | DESIGN-BRIEF §F |
| **Payments** | Stripe, PayPal, Razorpay, Cashfree, PhonePe, cash on delivery and bank transfer per merchant (merchant's own keys), webhooks, refunds | §5.4 Payments |
| **Shipping** | Methods, zones, charge strategy (free, fixed, pass-through, free over a threshold), Shiprocket and other couriers | §5.4 Shipping |
| **Customers** | Shopper accounts, addresses, customer groups | OFFERS §3 fact 12 |
| **Search** | Storefront search and filters, portal search | SAAS-PLAN §12 |
| **Assets** | Upload, storage, image variants | §5.6 Assets |
| **Import/export** | CSV and Shopify import with validation before write; export | CATALOG part K |
| **Email** | Shopper emails (order confirmation, shipping, password) and portal emails, per brand | SAAS §3.6 |

### 3.3 Now possible, and expected

Owning the engine turns these archived "needs backend" items into ordinary requirements.
Decide for each whether it is in the first release (§8):

- **Vendor sub-orders**: an order split into per-vendor parts with their own fulfilment,
  lines and (later) payouts. This replaces AUTH-PLAN §8.5's constructed view.
- **Isolation in the database**, not only in the API (§5.1).
- Catalogue: compare-at price with price history (EU 30-day rule), cost price, weight and
  dimensions, barcodes, product type (physical, digital, service), manual ordering in
  collections, price-range collections, scheduled publishing, per-language SEO, a nullable
  and neutral classification code (`hsCode`), and compliance fields by market.
- Offers: collections as targets, exclusions, combination rules, bulk unique codes, first
  order only, specific customers, per-currency fixed amounts, tiered discounts and caps, an
  internal name separate from the shopper-facing one.
- Stores: home country and selling markets, and tax registrations per country. **Decided
  2026-10-02 (first release, designed in Settings › Store info)**: a real **time zone** (offer
  schedules, reports and order times use it), a **unit system** (metric or imperial) and an
  **order-number format** (an upper-case prefix of up to six characters plus the next number).
- Plans and entitlements as a first-class, server-enforced model.

---

## 4. Target shape (decided)

Deployables, hostnames, repository layout and the Workers runtime rules are in
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) §2–4. In short:

| Deployable | Where |
|---|---|
| Portal (`apps/ui/store`), partner console (`apps/ui/platform`) and DF Admin (`apps/ui/admin`) | Static SPAs on **Cloudflare Pages** |
| Store API, Platform API, Admin API, Shop API, inbound webhooks (one Worker, `apps/api`) | **Cloudflare Workers**, at `/api` on each UI's own hostname |
| Jobs, event delivery, schedules (`apps/api/src/jobs`) | **Queues**, **Workflows** and **Cron Triggers** |
| Postgres | **Neon**, through **Hyperdrive** |
| Files | **R2** |
| AI storefronts | One repo per store (preview SPA + live SSG) on Cloudflare |
| Merchants' own storefronts | Anywhere, calling the Shop API |

Everything is one repo, [`dripfunnel/platform`](https://github.com/dripfunnel), with shared
code in `apps/api` (`../code/ARCHITECTURE.md`); only generated store repos are separate.
Business logic never lives in an app.

This is the usual headless split between the engine (with its Shop and admin-side APIs,
here `apps/api/src/engine`) and its dashboards (Store API clients among many, here the
portal and DF Admin). The engine has explicit
module boundaries: modules talk through their public services and events, never through each
other's tables. The engine and the platform are libraries composed by several Workers
(`../ARCHITECTURE.md` §2).

---

## 5. Architecture requirements

### 5.1 Tenancy and isolation (the core)

Every lesson in AUTH-PLAN §2 and SAAS-PLAN §11 was a tenant leak. The new design must make
leaks structurally hard:

- **Every tenant-owned row carries `store_id`**; vendor-owned rows also carry `seller_id`
  (null = the merchant's own). No table is "global by accident": each table is declared
  platform, brand, store, or store-and-seller scoped.
- **A scoped query layer** is the only way application code reads or writes tenant tables. It
  takes the `TenantContext` (acting store, `SellerScope`) and applies both filters. Raw table
  access is importable only by that layer, enforced by lint and a test.
- **Postgres Row-Level Security as the backstop** (decided 2026-09-28, DATA-MODEL.md §5): the request sets
  `app.store_id` and `app.seller_id` for its transaction, and policies refuse other rows even
  if the application forgets. Evaluate connection pooling, performance and migration impact.
- **Vendor scoping reaches every derived read**: stock totals, search facets and counts,
  collection contents, exports, reports, notifications.
- **Isolation tests**: two stores and two vendors per test; every endpoint asserts nothing
  crosses. The archived `e2e:settings` two-store check is the model.
- Unique constraints are per store (web address, coupon code), per owner for a SKU (#293), never global.

### 5.2 Identity, sessions, roles

- Our own users table: one account per person per partner (email unique within a partner,
  ACCESS.md §2), password hashes
  (argon2id), Google sign-in, email and phone verification codes stored hashed with attempt
  counters, 2-factor **required for Owners and optional for everyone else** (authenticator app
  or SMS, backup codes; decided 2026-10-02, ACCESS.md §2 and §4).
- `membership(user_id, store_id, seller_id, role_key)`: role keys map to **permission sets in
  code**. Nothing is cloned; changing a role takes effect on the next request.
- Invitations: token hashed, expiring, resendable, revocable, with the identical response
  whether or not the account exists. The join path for existing accounts carries over.
- Capabilities (invite, manage vendors, approve, publish, billing, settings) are checked for
  the **acting store**.
- **Staff (DF Admin) are a separate identity**: company SSO with 2-factor, their own roles,
  and every action audited. Never a merchant session with a flag.
- **Brand-aware auth**: the portal resolves the brand from the hostname before sign-in; emails
  and links use that brand's domain. A person with stores under two brands has two accounts
  (decided, ACCESS.md §2).
- Rate limits on sign-in, sign-up, invitation, password reset and code entry.
- **Four kinds of caller** reach the engine, and each resolves to the same `TenantContext`
  (acting store, `SellerScope`, permissions) before any resolver runs:
  - a **person** in the portal (session → membership in the acting store);
  - a **shopper** on a storefront (public store key, plus an optional customer session);
  - an **API key** a merchant creates for an integration (store-bound, permission-scoped,
    optionally seller-bound for a vendor's own integration, hashed at rest, rotatable,
    last-used shown);
  - an **installed app** (an OAuth-style grant per store with the scopes the merchant
    approved, revocable on uninstall).

  Never let one kind borrow another's power: an API key can't do what its creator's role
  can't, and a vendor's key can't see outside its `seller_id`.

### 5.3 White-label brands

- `brand` sits above `store`; every store belongs to exactly one brand; DripFunnel is the house
  brand.
- Brand look (design tokens), words, portal domain, email sender domain (SPF, DKIM, DMARC),
  storefront subdomain pattern, plans and entitlements, allowed templates, regions,
  currencies, languages and providers. All specified in CONSOLE-DESIGN §3 facts 17–22.
- Resolution by hostname at the edge of every app; a cache with explicit invalidation.

### 5.4 The commerce engine

Design each module's responsibilities, tables, public API, events and invariants:

- **Money**: integer minor units with a currency code on every amount; `Intl` formatting at
  the edges only; zero- and three-decimal currencies; rounding rules in one place.
- **Catalogue**: product with **versions** and **options**, where a simple product needs no
  visible version; photos; collections (rule-based and hand-picked, with background
  recomputation and a manual order); filters and internal tags; translations per language
  with fallback to the main language; per-language web addresses; the listing sections in
  CATALOG parts P–T behind entitlements.
- **Inventory**: stock per (version, warehouse), on hand and reserved, stock movements with
  reasons (a ledger, so history exists), default warehouse per owner, low-stock thresholds.
  **Decided 2026-10-02**: every change is a movement with a reason, who, where and the
  resulting quantity; a typed number is recorded as "Typed a new number"; orders, returns,
  imports and suppliers write movements too; the portal shows the history per product and per
  version. **Reserved** is "sold, not shipped yet": units in paid orders not yet fulfilled.
- **Tax**: tax classes; zones; rates per store, class and zone; inclusive or exclusive pricing;
  exemptions. **US sales tax uses Stripe Tax** (decided 2026-10-04 on #184), on the merchant's own Stripe
  account through Connect (decided 2026-10-05 on #284); India's GST uses the
  store's own rates.
- **Promotions**: the OFFERS prompt's full model. Conditions with AND/OR, actions on products,
  collections, order and shipping, combination rules, deterministic application order,
  per-currency amounts, bulk codes, usage counting that survives concurrency.
- **Cart and checkout**: pricing is computed server-side, always. Carts expire; prices and
  offers are re-evaluated on change; **stock is reserved when the order is paid** ("reserved" is
  sold and not yet shipped, Inventory above) and checkout re-checks availability at payment
  (decided 2026-10-04 on #184). **Orders paid later** (cash on delivery, bank transfer; decided
  2026-10-05 on #284): the order is accepted when placed, so it reserves then, after the same
  re-check; cancelling it releases the stock, and so does a bank transfer left unpaid for **3
  days**, a system cancellation logged with the system as actor (LOGGING §3); "Mark as paid"
  (Owner and Manager, ACCESS §5.1) doesn't re-check stock the order already holds.
- **Orders**: a state machine (placed, paid, partly fulfilled, fulfilled, cancelled, refunded),
  immutable price snapshots on lines, **vendor sub-orders**, partial fulfilment from a named
  warehouse, cancellations and refunds. **Returns and refunds across vendors were decided
  2026-10-02**: per-line returns and refunds, each supplier refunding its own lines, the store
  able to override into a supplier ledger, fulfilment by the shipping mode stored on the
  order part. ACCESS.md §7.3 owns the rules; DATA-MODEL.md owns the tables.
- **Payments**: provider adapters (the first release's seven: Stripe, PayPal, Razorpay, Cashfree,
  PhonePe, cash on delivery, bank transfer, §8) using each merchant's own
  credentials, encrypted at rest; webhooks idempotent; refunds. **Vendor payouts, decided
  2026-10-02**: not in the platform for now; a per-store supplier ledger, settled outside
  (ACCESS.md §7.3 owns the rule, DATA-MODEL.md §2.2 names the table); a marketplace model is later.
- **Shipping**: methods, zones, the charge strategies (free, fixed, the courier's rate passed
  through, free over a threshold), courier adapters (Shiprocket first, the archived
  `courier_partner` model), tracking status sync. **Designed 2026-10-02** (`SetOps`,
  `PortalOrders`): booking a label through the courier or entering tracking by hand, pickup
  schedule (every working day or on request), label size, tracking emails on or off,
  collection hours for pickup in person, a postcode list for where the store delivers, and
  per-supplier shipping mode (ACCESS.md §5.2).
- **Customers**: accounts, addresses, **groups** (named, with members; used by offers),
  **tags**, a **note** only the team sees, **marketing consent** (opted in at checkout or by
  email, asked to stop, declined by not ticking the box, never asked; recorded with when and
  where; only the shopper opts in,
  the store may record a stop), customers added by hand (order emails only), export. What a
  vendor sees of a customer is decided by the supplier's shipping mode and applied in the
  serializer (ACCESS.md §7.3): nothing, or name and delivery address.
- **Search**: Postgres full-text first, Typesense later if needed, behind one interface;
  vendor-scoped in the portal, visibility-scoped in the storefront.
- **Import/export**: CSV and Shopify, validate before any write, partial-failure reports,
  translations and currency columns.
- **Events, jobs, operations and custom fields** follow the headless-engine patterns in §5.10.

### 5.5 The public APIs (headless)

Modelled on the usual headless split into a Shop API and an admin-side API (ours: the **Store API**), both **GraphQL**, served by the
engine. Each has its own schema, its own auth and its own rate limits.

**Shop API** (`/shop-api`), for every storefront, ours or the merchant's:
- Catalogue, collections, filters and search; cart (an active order);
  shipping and payment options; checkout; customer sign-up, sign-in, account, addresses and
  order history; content the storefront needs (menus, store info, policies).
- Identifies the store by a **public store key** or the hostname, never by a secret. It holds
  no merchant or vendor data a shopper shouldn't see, and returns vendor attribution only
  where the merchant chooses to show it.
- **The engine computes everything that matters**: prices, tax, discounts, shipping, stock
  and totals. A storefront can display them but never assert them. This is what makes the
  AI-designed storefront safe to change freely, and a merchant's own storefront safe to
  allow at all.
- Catalogue queries are **edge-cacheable**, keyed by store, its catalogue version, host,
  language, currency and market, and the query itself (a POST body hashed); a change a
  storefront shows moves the version, which is the purge (built on #306; FIRST-RELEASE §19). Cart, checkout and account queries are uncached and rate-limited per shopper and
  per store.
- **Stable across the fleet**: a thousand AI storefronts and every merchant's own frontend
  depend on it. Additive changes only; deprecation with a published timeline; schema diffs
  checked in CI.

**Store API** (`/api`), for the portal, read-only support sessions opened from the partner
or admin console (ACCESS.md §8), integrations and apps:
- Everything a merchant can do in the portal, and nothing more: **the portal is a Store API
  client**, so any screen can be automated by an integration
  with the right key.
- Permissions are checked per resolver **and per row**: every query is tenant- and
  seller-scoped by the context (§5.1), unlike the old framework's per-channel permissions. A vendor
  caller can only ever see and change its own rows.
- Platform operations above a store (brands, plans, billing, provisioning, staff) are **not**
  in the Store API. They live in the Platform API (partners) and the Admin API (staff) (§4).

**API keys, webhooks and apps** *(design all three now; §10 asks which ship first)*:
- **API keys**: created by an Owner in Settings, with named permission scopes, an optional
  vendor binding, expiry, rotation, last-used time and an audit trail.
- **Webhooks**: subscriptions per store to engine events (order placed, paid, fulfilled;
  product, stock and customer changes). Signed payloads, retries with backoff, a delivery
  log the merchant can see and replay, and automatic disabling of an endpoint that keeps
  failing. Delivered from the outbox, so an event is never lost or sent for a rolled-back
  change.
- **Apps**: a third party registers an app; a merchant installs it with consent to named
  scopes; the app gets a per-store grant, receives webhooks, and may add UI to the portal
  *(ask: embedded pages, or links only)*. Apps are **out-of-process**, unlike in-process
  framework plugins: a multi-tenant engine never runs third-party code in its own process.
- **A Shop API client** inside `@dripfunnel/storefront-core`, typed from the Shop API
  schema. No separate SDK for now: merchants building their own storefront use the Shop
  API's GraphQL directly, with a starter example.
- **Developer docs**: schema reference, guides for a custom storefront, keys, webhooks and
  apps. Branded per brand where a partner resells the platform *(ask)*.

### 5.6 Storefronts on Cloudflare

- **The storefront itself is specified in `../storefront/`** (ARCHITECTURE.md and
  DESIGN.md): the core package, the theme contract, the preview and live modes, the AI loop and
  fleet upgrades. This section covers only the hosting side.
- **Unchanged**: repo per store, AI-written theme vs locked core, the file allowlist (the old
  CI path guard), dependency allowlist, upgrade bot, AI loop with preview before publish,
  `git revert` undo.
- **Two deployments per store**: the preview SPA and the live static site, each with its own
  hostname and cache rules.
- **Changed**: builds deploy to **Cloudflare** instead of S3 + CloudFront. Evaluate and
  recommend one:
  - a Cloudflare Pages project per store;
  - Workers with static assets per store;
  - **Workers for Platforms** (a dispatch worker routing each hostname to its store's
    worker), designed for multi-tenant hosting.

  Compare account limits at 1,000+ stores, deploy API, preview URLs, rollback, cost, and how
  run-time catalogue fetches and caching work. **Verify every limit against Cloudflare's
  current documentation**; don't rely on memory. **Decided 2026-10-05 on #284: a Cloudflare Pages
  project per store**; INF 0 checks and raises the per-account project limit. The comparison
  above stays as the reasoning. Builds run in Cloudflare Containers (decided 2026-10-08 on
  #470), not the store repo's GitHub Actions.
- **Custom domains** through **Cloudflare for SaaS** (custom hostnames with automatic
  certificates), replacing the first platform's AWS ACM + CloudFront work (`provision-domain`). Keep
  the portal's step-by-step domain experience (DESIGN-BRIEF flow 58), and cover brand
  storefront wildcards (`*.shops.partner.com`).
- **Builds** run in the platform's sandbox containers (`apps/sandbox`, decided 2026-10-08 on
  #470) from the store's commit and a catalogue snapshot, and the platform's publish Workflow
  deploys the gated output to the store's Pages project (Pages direct upload) with its own
  token, so no deploy token ever reaches a repo or a container
  ([`../storefront/ARCHITECTURE.md`](../storefront/ARCHITECTURE.md) §4.2).
- **Cache purge** on catalogue change: the Shop API's own answers by the catalogue version in their key (§5.5); the static storefront files by URL on publish.
- **Assets** on R2, served through **Cloudflare image resizing** (decided 2026-10-05 on #337).
- Degraded storefront for past-due or suspended stores, served at the edge.
- **A store may have no AI storefront at all.** A merchant using their own frontend gets a
  public store key, allowed origins (CORS), checkout and account URLs they control, and no
  repo or Cloudflare project. Provisioning makes the AI storefront a step that can be skipped
  or added later, and switching between the two must not lose orders, customers or URLs
  *(ask how the portal offers the choice, and whether plans differ)*.
- **Checkout for own storefronts**: either fully in the merchant's frontend through the Shop
  API, or a hosted checkout page we serve on the store's domain *(recommend; hosted checkout
  lowers the burden of payment-provider integration and PCI scope)*.

### 5.7 Jobs, AI runs and billing

- Jobs: **Cloudflare Queues** for outbox delivery and single-step jobs, **Workflows** for
  multi-step jobs with retries and compensation, **Cron Triggers** for schedules. The
  archived `job` table (state, attempts, last error, compensation) stays in Postgres as the
  record DF Admin reads (`../ARCHITECTURE.md` §5).
- Provisioning becomes: store and membership rows, defaults, repo from template, secrets and
  variables, Cloudflare project or worker, first build, domain. Each step has a compensation.
- AI runs: the model is called by the Worker and its changes run in the store's container
  (Cloudflare Containers, decided 2026-10-08 on #470, replacing GitHub Actions), budgets per
  plan, `ai_run` metering with container time and repairs (the platform's cost).
- Billing: Stripe Billing for subscriptions, webhooks with idempotency, `past_due` gating
  cached on the session with invalidation. Plus the two-level white-label money model from
  CONSOLE-DESIGN §3 fact 20 *(ask which comes first)*.

### 5.8 Config, deploy, observability

- Typed config validated from the Worker `env`; secrets in Workers secrets; migrations from
  `apps/api/migrations` before the Worker deploys; manual gated promotion and rollback
  (`../ARCHITECTURE.md` §4, §6).
- Every log line carries store, seller and brand ids. Tracing across API, worker and edge.
- The §14 metrics from the first store: build minutes, AI cost, provisioning success, time to
  first store, failed builds after AI edits, repairs, refused and rolled-back publishes, core
  drift and pinned stores.

### 5.9 Testing

- Authorization and isolation matrix: every endpoint × role (Owner, Manager, Staff, each
  vendor tier, staff roles) × acting store, including a person in two stores under two
  brands.
- The matrix covers every **caller kind** too: person, shopper, API key (store-wide and
  vendor-bound), installed app, and staff.
- Structural tests: every GraphQL field declares its API, permission and scope; the scoped
  query layer is the only table access; no Shop API field returns an Admin-only type.
- **Engine correctness**: property-based tests for money, tax, promotions and stock
  (concurrency on usage limits and reservations), golden tests for order totals per region
  (US tax-exclusive, EU VAT-inclusive, India GST).
- Shop API contract tests the template runs in CI, and schema-diff checks that fail on a
  breaking change to either public API.
- Webhook delivery tests: signature, retry, ordering per resource, no delivery for a
  rolled-back transaction.
- Playwright for a small set of journeys, as before.

### 5.10 What to copy from established headless engines, and what not to

Mature headless commerce engines have settled on a few patterns. Copy these ideas
deliberately:

| Copy | The established pattern | Change for DripFunnel |
|---|---|---|
| **Shop API / Store API split** | Two GraphQL schemas and endpoints, different auth, a permission declared per resolver | Every resolver also declares its **tenant and seller scope**, enforced by the context, not only a permission (§5.1, §2 item 17). A Platform API sits above both (§4). |
| **Configurable operations** | Operation definitions with typed `args`: promotion conditions and actions, shipping eligibility checkers and calculators, payment handlers, fulfilment handlers | A registry of **platform-defined** operations with typed, validated args and UI hints, instantiated **per store**. Add the ones the OFFERS and CATALOG prompts need (collections, first order, shipping country, tiered, per-currency amounts) as ordinary operations. Merchants configure them; they never upload code. |
| **Strategies** | Pluggable strategies (tax zone, price calculation, stock allocation, order code, order process state machine) | The same seams, chosen per store or per brand where regions differ (e.g. tax behaviour by country). |
| **Custom fields** | Config-level custom fields on entities, exposed on the schema automatically | Two layers: **platform custom fields** (our own, defined in code with migrations, typed in the schema) and **store custom fields** (defined by a merchant at run time, like Shopify metafields, stored as typed JSON with a definitions table, validated, translatable where marked, and **filterable**). The first platform's lesson: relation and struct custom fields couldn't be filtered (AUTH-PLAN §2.8). Design filtering and indexing in from the start. Decide how store custom fields appear in GraphQL (a typed `customFields` object per store is impractical; a `metafields`-style list or a JSON scalar with definitions is likelier) *(recommend)*. |
| **Event bus** | An event bus with async subscribers and **blocking** handlers that run inside the transaction | Both kinds, with the rule that blocking handlers stay small and never call out. Async events go through an **outbox** so webhooks, emails, search indexing and cache purges never fire for a rolled-back change and never get lost. |
| **Job queue** | A job queue with a pluggable backend (Postgres by default, a broker later) | The archived `job` table (with per-step compensation) plus a queue with the same pluggable backend, in the worker process. |
| **Plugin structure internally** | Plugin modules that add entities, schema extensions, services and operations | Organise our own modules the same way (each registers its tables, schema, services, operations and event handlers). Third-party extension is **apps over the API** (§5.5), never in-process plugins. |
| **Active order as the cart** | The cart is an order in an early state; the same line and adjustment model follows it to payment | Keep it: one model from cart to fulfilment, with price snapshots on lines and discounts as adjustments. |

**Do not copy** (each was a real problem in the archived plan):
- permissions per channel with no row scoping, and a "default channel" that sees every
  tenant's data (AUTH-PLAN §2.5–2.6);
- list queries whose tenant scoping differs from entity to entity (SAAS-PLAN §11.3);
- entities that are global when they should be per store (tax rates, sellers, global settings);
- per-person admin fields that can't vary by store (AUTH-PLAN §2.12);
- order splitting that only works with a channel per vendor (AUTH-PLAN §2.7);
- a single integer amount applied in every currency (OFFERS §3 fact 10);
- a year-long session and a cache that delays permission changes (AUTH-PLAN §2.11).

---

## 6. Design deliverables

The UX specifications remain the design source. **Done 2026-09-28**: each is ported into
`../ui/` with the changes below applied; keep updating them there as the engine is
designed, don't restart:

- **DESIGN-BRIEF.md** (archived): keep §2 users and §3 flows 1–69. Replace the framework with the
  engine. Remove India-only assumptions ("prices tax-inclusive in rupees", flow 24; "HSN
  codes", flow 57) in favour of the regional model. Add the flows the engine now enables:
  vendor sub-orders and fulfilment, refunds and returns, customer groups, stock movements,
  plans and entitlements.
- **CATALOG-DESIGN-PROMPT.md** and **OFFERS-DESIGN-PROMPT.md**: keep §2 vocabulary, §4 roles,
  §5 principles, §6 parts, §7 states and §8 "never do". **Rewrite each §3** from "framework
  facts" into "engine facts" and turn "needs backend" into "first release" or "later".
- **CONSOLE-DESIGN.md**: §3 "what exists today" changes: stores are our own `store` rows,
  not framework channels; storefronts and domains are on Cloudflare; DF Admin replaces the
  framework dashboard completely.
- **Built screens** (signup, sign-in, choose store, invitations, profile, the eight Settings
  tabs, suppliers, custom domain; `../../../.design/settings-tabs.html`) are the visual
  baseline. Keep their look and words unless the engine
  changes what they can say.
- Every portal screen renders in the **brand's look** (white label), and every design shows a
  US, an EU and an Indian store where the screen differs by region.
- **New flows the headless model adds**, merchant-side unless stated:
  - choosing the storefront at signup or later: "Design it with AI" or "Use my own
    storefront", switching between them, and what each costs on each plan;
  - **Settings › Developers**: public store key, allowed origins, API keys (create, scope,
    bind to a vendor, rotate, revoke, last used), webhooks (endpoints, events, delivery log,
    replay, failing-endpoint alerts);
  - **Apps**: browse, install with scope consent, configure, uninstall, and what an app can
    see;
  - a vendor-bound API key, created by the Owner for a supplier's stock or catalogue
    integration (ACCESS §5.6) (decided 2026-10-05 on #337); a supplier creating its own stays later (DESIGN-BRIEF 78);
  - in DF Admin: app registrations and review, API usage and abuse limits per store.
  Write these for a non-technical merchant who needs to hand details to a developer, not for
  the developer.

---

## 7. Reuse from the first platform

| Take across (adapt) | Rewrite | Drop |
|---|---|---|
| UI components, nav model (`nav.ts`), `?state=` screen states, the portal screens | Sessions (no framework token), provisioning (no framework steps), settings routers | The framework client code, role templates as framework permissions, `permissions.generated.ts` |
| `TenantContext`, `SellerScope`, the idea behind `procedures.ts` and its structural test (now applied to GraphQL resolvers) | Auth against our users table; invitations; the portal's data layer as a Store API client | The proof header and secret |
| Job runner, `provision-storefront` (GitHub App), `notify.ts` | `provision-domain` for Cloudflare for SaaS | AWS ACM / CloudFront / per-store AWS resources |
| Drizzle setup, typed config, Dockerfile and deploy workflow, e2e journey style | Courier and payment credential handling inside the engine | Any runtime dependency on the first platform's backend or its plugins (removed from the workspace) |

Name each file you port and what changed.

---

## 8. Build plan expectations

Propose slices in dependency order. Each slice ends with passing gates: typecheck clean,
Vitest green (unit, integration on a real Postgres, isolation matrix, structural tests), the
app actually running and exercised, and nothing regressed. A suggested skeleton to improve:

1. Monorepo, db package, typed config, deploy pipeline, health gate.
2. Engine skeleton: module structure, event bus with outbox, job queue and worker,
   configurable-operation registry, platform custom fields, the GraphQL server with Shop and
   Admin schemas and the per-resolver scope declarations plus their structural test.
3. Tenancy core: brands, stores, users, memberships, sessions, the caller kinds (§5.2),
   scoped query layer, RLS decision, audit log, isolation tests.
4. Signup and provisioning (without storefront), sign-in, invitations, the built portal
   screens ported onto the Store API.
5. Catalogue, inventory, money and tax. Vendors and approval.
6. Shop API (catalogue), the SDK, the storefront core package and baseline theme built against it,
   Cloudflare hosting, provisioning of the storefront, custom domains.
7. Cart, checkout, payments, shipping, orders, vendor sub-orders, emails.
8. Offers.
9. AI designer loop (the sandbox, the validator, the gates), upgrade bot.
10. Headless for merchants: public store keys and allowed origins, own-storefront stores,
    API keys, webhooks; then store custom fields; then apps.
11. Billing and plans; DF Admin; white-label brands.
12. Search, import/export, reporting, scale hardening.

State what the smallest sellable first release is, and what is explicitly deferred.

**The first release (decided 2026-10-04 on #184; ui/store/FIRST-RELEASE.md is the screen-by-screen
scope and §20 there the card list).** Gaurav took the larger answer to every scope question: the
release is everything the Store prototype draws plus the designed-but-undrawn parts.
- **Commerce modules**: catalogue with versions, photos, collections, filters, menus, size
  charts, A+ content and the listing sections; inventory with the movement ledger; money;
  tax; **all four product kinds** (physical, digital, services, gift cards; the last three
  designed first); markets, currencies and languages; suppliers and approval; offers; cart
  and checkout; orders with supplier parts, returns and refunds; customers with groups and
  consent; abandoned carts; import and export (CSV and Shopify); reports with a custom
  builder; the AI storefront and the merchant's own; API keys, webhooks and apps.
- **Stock reservation**: at payment; cash on delivery and bank transfer at placement (a transfer
  unpaid after 3 days is cancelled; decided 2026-10-05)
  (§5.4 Cart and checkout).
- **Regions**: **India and the US**.
- **Payment providers**: Stripe, PayPal (US); Razorpay, Cashfree, PhonePe, cash on delivery
  (India); bank transfer (both). **US sales tax**: Stripe Tax, on the merchant's own Stripe account
  through Connect (decided 2026-10-05 on #284).
- **Couriers**: Shiprocket (India); USPS, UPS and FedEx through one aggregator, **EasyPost**
  (decided 2026-10-05 on #337).
- **Email**: Amazon SES for shopper and portal email, abandoned-cart reminders included.
- **WhatsApp reminders** ship with email in India, through MSG91 (decided 2026-10-05 on #337).
- **Deferred**: other regions (the prototype's DE pack
  stays a demo control), in-platform supplier payouts (§5.4 Payments), Typesense (§5.4 Search).

---

## 9. Ground rules (carry over)

- **Don't commit, branch or push unless I ask in that message.** Finish the work, leave it in
  the working tree, and tell me what's ready. "Keep going" is not permission to commit.
- **Local databases only.** Nothing in development points at `dbpg01.softobotics.org` until I
  say otherwise.
- **Never weaken a test to make it pass.** If a gate can't pass, stop and report.
- **Verify, don't trust memory**: library APIs, Cloudflare limits, Stripe and Razorpay
  behaviour, tax rules. Cite where you checked.
- Where an archived document is wrong for the new world, say so in the new document rather
  than silently diverging.

---

## 10. Open questions: ask, don't assume

**The change itself**
- ~~Is there **live data on the first platform** (the existing DripFunnel store, any tenant
  stores) that must be migrated, and is there a cut-over date?~~ **No: a fresh start** (decided
  2026-10-05 on #284).
- ~~Existing tenant storefront repos: rewrite their `core/` against the new API, or recreate
  them?~~ None: a fresh start (#284).
- ~~Does anything else still depend on the first platform's backend?~~ **Settled
  2026-09-29**: its projects are removed from the workspace; nothing depends on them.

**Architecture**
- Does tRPC survive for portal-only screens, or does the portal use the Store API alone?
- ~~Is the Platform API GraphQL too, or internal only?~~ Decided 2026-10-03 on #155: GraphQL, like the Admin API.
- ~~Postgres RLS as defence in depth?~~ Decided: yes, the backstop (DATA-MODEL.md §5).
- One database for all brands and stores, or a shard or database per brand later?
- ~~Cloudflare hosting model: Pages per store, Workers per store, or Workers for Platforms?~~
  **A Pages project per store** (decided 2026-10-05 on #284; limits checked on INF 0).
- ~~Cloudflare Images or our own image variants?~~ **Cloudflare image resizing** (decided 2026-10-05 on #337).
- ~~Where does the AI agent execute, and where do builds run?~~ ~~**Both in GitHub Actions**
  (decided 2026-10-05 on #284).~~ **Both in Cloudflare Containers** (decided 2026-10-08 on #470).

**Headless**
- ~~Which of **API keys, webhooks and apps** ship in the first release?~~ **All three**, with the
  merchant's own storefront (decided 2026-10-04 on #184, §8).
- ~~Own storefronts: our hosted checkout, their own checkout on the Shop API, or both?~~ **Both**: our hosted, partner-branded checkout by default, their own on the Shop API if they choose (decided 2026-10-05 on #337).
- ~~Can a store switch between an AI storefront and its own, and do plans differ?~~ **Switch any time**; the partner decides per plan whether 'own' is included (decided 2026-10-05 on #337).
- ~~Can vendors have their own API keys?~~ Later (ACCESS.md §5.6).
- ~~Apps: public marketplace or private per-store apps first? Embedded UI in the portal?~~ **Private apps first**, shown as links to their own site, no embedded pages, no marketplace (decided 2026-10-05 on #337).
- ~~Developer docs and the SDK: branded per white-label brand, or always DripFunnel?~~ **Always DripFunnel** for now (decided 2026-10-05 on #337).
- ~~API rate limits and quotas per plan?~~ **Per plan from day one**, as entitlements (SAPI 19) enforced on API keys and the Shop API (SAPI 20) (decided 2026-10-05 on #337).

**Commerce scope for the first release**
- ~~Which regions at launch? Which payment providers and couriers?~~ ~~US sales tax?~~ **Decided
  2026-10-04 on #184** (§8): India and the US, the providers and couriers listed there, Stripe Tax.
- ~~Vendor payouts: does DripFunnel or the merchant pay vendors (Stripe Connect, Razorpay
  Route), or is it outside the platform?~~ **Settled 2026-10-02**: outside, from a per-store
  supplier ledger (§5.4 Payments); in-platform payouts later.
- ~~Refunds, returns and cancellations across vendors: first release or later?~~ **Designed
  2026-10-02** (§5.4 Orders, ACCESS.md §7.3); the release is ui/store/FIRST-RELEASE.md's (written on #184: all of it ships, §1).
- ~~Digital products, services, gift cards: first release or later?~~ ~~Which "needs backend" items
  from the catalogue and offers prompts are first release?~~ **All of them** (decided 2026-10-04
  on #184, §8; ui/store/FIRST-RELEASE.md §1).
- ~~When is stock reserved: added to cart, checkout started, or payment?~~ **At payment** (decided
  2026-10-04 on #184, §5.4 and §8).

**Brand and billing**
- White label's money model (partner billed, merchants billed on the partner's behalf, or
  both) and which comes first.
- ~~A person with stores under two brands: which look?~~ Settled: one account per partner
  (ACCESS.md §2).
- Plans and their entitlements: names and contents. (Decided: the partner sets the monthly
  "Publish now" allowance per plan within DripFunnel's ceiling; the automatic publish
  interval is an admin console setting with per-plan overrides; failed builds never count.
  See SAAS.md §6, §9.)

**Carried from the first platform, still open**
- ~~Does editing an approved vendor product send it back for approval?~~ **Settled 2026-10-02**:
  only for name, price or photo changes, hidden until approved (ACCESS.md §7.2).
- ~~What happens to a removed or suspended vendor's products?~~ **Settled 2026-10-02**: removed →
  hidden and kept; suspended → the Owner chooses hide or keep selling (ACCESS.md §7.5).
- ~~2-factor for Owners only, or everyone?~~ **Settled 2026-10-02**: required for Owners,
  optional for everyone else (ACCESS.md §2).
- What happens to a past-due store's vendors? (Past due never blocks sign-in: §2 item 7.)
- ~~Retention and export on cancellation (SAAS-PLAN §15).~~ The storefront stays live to the end of the paid period; data, assets and repo kept **90 days** with export offered, then deleted; orders and invoices as the law requires (decided 2026-10-05 on #337).