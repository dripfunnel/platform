# ACCESS.md

Identity, sessions, roles and permissions, invitations, vendors, support access, tenancy and
authorization in the DripFunnel engine: **who can sign in, where, how they get an account,
what they may do, and how every resolver proves it**. Ported on 2026-09-28 from the
first (Vendure-based) platform's AUTH-PLAN (§3, §4, §5.3, §7, §8.3–8.6, §9, §11) and
ARCHITECTURE (§4, §6.3, §7), with Vendure facts replaced by engine facts; AUTH-PLAN §2 and §6 were
Vendure-specific and survive only as §12's lessons. Where this document and
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) or
[`../USERS-AND-DOMAINS.md`](../USERS-AND-DOMAINS.md) disagree, those two win. Engine
requirements are in [PLATFORM-PROMPT.md](PLATFORM-PROMPT.md) (§2 items 2–5 and 16–20, §5.1–5.3,
§5.9); staff roles and the admin console's access parts are in
[../ui/admin/CONSOLE-DESIGN.md](../ui/admin/CONSOLE-DESIGN.md) (§4, parts A, J, O, P).

**Status: specification.** Nothing here is built. Code lives in `apps/api/src/auth`
(identity, sessions, memberships, roles, keys, grants, staff identity, `TenantContext`),
`apps/api/src/db/scoped` (the scoped query layer), `apps/api/src/apis/graphql/scope.ts` (the
per-resolver scope declaration) and `apps/api/src/saas` (support access, audit log).

Last updated: 2026-09-28.

---

## 1. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **Four identity pools, kept separate**: merchant and vendor people; partner users; DripFunnel staff; shoppers per store (§2) | One users table with flags; staff as merchants with a superuser flag | Each pool signs in on its own host with its own rules. A staff or partner identity can never be a merchant session with a flag (PLATFORM-PROMPT §5.2), and a bug in one pool's checks can't grant another pool's power. |
| **One account per person per partner** in the merchant/vendor pool: `user` unique by `(partner_id, email)` (decided 2026-09-28) | An account per store; one account platform-wide | One person, one login, many stores **within a partner** (PLATFORM-PROMPT §2 item 3). Accounts never cross partners, so no password, 2-factor, Google sign-in, reset or "you already have an account" email reveals that two brands run on one platform. The cost: someone with stores under two partners has two unrelated logins. |
| **`membership(user_id, store_id, seller_id, role_key)`**; vendor identity is a property of the pair (user, store) | Vendor identity on the user | A person can be Staff in one store and a vendor in two others, with a different `seller_id` in each. |
| **Roles are fixed permission sets in code**, keyed by `role_key` | Role rows per store; cloning at provisioning; a role editor | Nothing to clone or drift; a change is reviewed and deployed like code; a role change takes effect on the next request. |
| **Permissions are checked per resolver and per row** | Per-store permissions only | A vendor's "write catalogue" means its own products. The scoped query layer applies `store_id` and `SellerScope` to every read and write (PLATFORM-PROMPT §5.1, §5.5). |
| **The acting store is named on every request and checked against the membership set** | One "active store" stored on the session | Two browser tabs on two stores must not fight; the check is against a server-held allowlist, not trust in input. |
| **Server-side sessions behind an `httpOnly`, host-only cookie**; idle 2 h, absolute 12 h | Tokens in the browser; long-lived sessions | Revocable at once; the browser holds no privileged token (PLATFORM-PROMPT §2 item 16). |
| **Invitations create an account with no password** and a hashed, single-use, expiring token | A generated password emailed; a throwaway password | The invitee chooses their own password; nothing usable sits in an inbox. |
| **Vendor orders are vendor sub-orders** in the order model | A view assembled outside the order model | The engine owns orders now (PLATFORM-PROMPT §3.3); ownership of a sub-order is a row filter, not a hand-written check. |
| **Support access is its own caller kind**, read-only, consented, time-limited, on the merchant's portal host | "Sign in as" a person | It never acts as a person, so it can't change passwords, payment methods, payouts or ownership, and every action is attributed to the real support agent (USERS-AND-DOMAINS §4.1). |
| **Every resolver declares its API, permission and tenant scope**, and a test walks the schema | Review discipline | An unscoped field can't exist (PLATFORM-PROMPT §2 item 17; ARCHITECTURE §1 Pothos decision). |
| **Audit rows are written in the same transaction as the change**, append-only | Logs; a best-effort async write | A privileged change without its audit row can't commit. |
| **Postgres row-level security as the backstop** (decided 2026-09-28; policies in [DATA-MODEL.md](DATA-MODEL.md) §5) | Application filtering only | If the scoped layer is bypassed by a bug, the database still refuses other stores', suppliers' and partners' rows (PLATFORM-PROMPT §5.1). |
| **Suppliers manage their own team** (decided 2026-09-28): the merchant sets the supplier's access level; Supplier admins manage its users' team roles within it | The merchant manages every supplier user | The merchant decides what a supplier may do, not who works there ([DATA-MODEL.md](DATA-MODEL.md) §4.2). |

---

## 2. Identities

Four pools. An email address in one pool says nothing about the others: a partner user and a
merchant with the same address are two unrelated accounts.

| Pool | Who | Signs in at | Credentials | Unique by |
|---|---|---|---|---|
| **People** | Merchants (Owner, Manager, Staff) and vendor users | Their partner's **portal host** (e.g. `store.<partnerdomain>`), Store API at `/api` | Password (argon2id or the KDF chosen under Workers CPU limits, ARCHITECTURE §8), Google sign-in, optional 2-factor *(ask: Owners only, or everyone)* | `(partner, email)`: the same email under two partners is two unrelated accounts |
| **Partner users** | A partner's own team | `platform.dripfunnel.com`, Platform API | Password, 2-factor *(ask: required or optional)* | Email, within the partner |
| **Staff** | DripFunnel employees | `admin.dripfunnel.com`, Admin API | **Company SSO with 2-factor** only; no self-signup, no password of ours (CONSOLE-DESIGN A1). Cloudflare Access in front of the host as an extra gate (recommended, ARCHITECTURE §7) | SSO subject |
| **Shoppers** | A merchant's customers | The merchant's storefront, Shop API | Email + password and/or mobile + one-time code (SMS or WhatsApp), **as the store chooses** (§2.1) | Each identifier **per store**: a person buying from two stores has two customer accounts (USERS-AND-DOMAINS §1) |

Rules for the **people** pool:

- `user(id, partner_id, email, email_verified_at, password_hash null, status, created_at)`,
  unique `(partner_id, email)`. `password_hash`
  is null for an invited person who hasn't accepted yet (§6). Email and phone verification
  codes are stored hashed with an attempt counter (PLATFORM-PROMPT §5.2).
- Google sign-in authenticates an existing account whose email matches Google's verified
  email. It never skips signup or accepts an invitation on its own.
- **The portal resolves the partner from the hostname before sign-in**; sign-in, signup,
  reset and invitation pages and emails are in that partner's look and from its sender
  domain (PLATFORM-PROMPT §5.3).
- **Accounts belong to one partner** (decided 2026-09-28). A person with stores under two
  partners has two accounts, one on each portal host, with their own passwords, 2-factor
  and emails in each partner's look. A session on a portal host only ever lists that
  partner's stores, and signing up with an email another partner already has is an
  ordinary new sign-up (CONSOLE-DESIGN §3 fact 14). Every membership's store belongs to the
  user's partner (a check constraint through `store.partner_id`).
- Staff can see that two accounts share an email in the admin console (search by email);
  partners never can.

### 2.1 Shopper sign-in (decided 2026-09-28)

- **Each store chooses** how its shoppers register and sign in: **email + password**,
  **mobile + one-time code** (SMS or WhatsApp), or **both**. The setting lives in the
  merchant portal (Settings › Customer accounts); the partner may limit the choices per
  plan *(ask)*.
- `customer(id, store_id, email null, email_verified_at, phone null, phone_verified_at,
  password_hash null, ...)`, unique `(store_id, email)` and unique `(store_id, phone)` where
  set. Phone numbers are stored in E.164. At least one verified identifier is required.
- With **both**, one customer may hold an email and a phone; adding the second one verifies
  it. Whether a guest checkout with a phone later links to an account with that phone is
  *(decide)*.
- **The same email or mobile may register in any number of stores**: each store's account is
  separate, with its own password, addresses and orders, and no store can see another's.
- Codes are hashed, short-lived, attempt-counted and rate-limited per number, per store and
  per IP; sign-up and "send code" respond identically whether or not the account exists.
- Changing the setting never locks existing customers out: a store that drops mobile sign-in
  asks phone-only customers to add an email at their next sign-in *(confirm)*.

Two more **caller kinds** reach the engine without being a pool of people (§3):

- **API keys**: created in a store for an integration; belong to servers, never browsers.
- **App grants**: an installed app's per-store grant with the scopes the merchant approved.

The Shop API's **public store key** identifies a store to a storefront and is the only
credential a browser may hold; it grants nothing a shopper shouldn't see.

---

## 3. Caller kinds and `TenantContext`

Every request resolves to exactly one caller before any resolver runs. Store-level callers
resolve to the same `TenantContext`; partner users and staff resolve to their own contexts
and **never** to a `TenantContext`, except through a support session.

| Caller | Reaches | Resolved from | Store | `SellerScope` | Permissions |
|---|---|---|---|---|---|
| **Person** | Store API | Session cookie + acting store named on the request | The acting store, which must be in the membership set | From the membership's `seller_id` | The membership's `role_key` |
| **Shopper** | Shop API | Public store key or storefront hostname, plus an optional customer session | The key's store | `all`, visibility-filtered to what shoppers may see | The fixed shopper set |
| **API key** | Store API | `Authorization` header, key hashed and looked up | The key's store | `seller` if the key is vendor-bound, else `all` | The key's scopes, never more than its creator's role allows (§5.6) |
| **App grant** | Store API | The app's grant token | The grant's store | `all` *(ask whether apps can be vendor-bound)* | The scopes the merchant approved |
| **Support session** | Store API, on the store's portal host | Support cookie from a support handoff (§8) | The one store the session was opened for | `all` | The read-only support set; the write set only after the merchant allows it |
| **Partner user** | Platform API | Session cookie on `platform.dripfunnel.com` | None: a `PartnerContext` (partner, user, partner role) | none | Partner role (§5.3) |
| **Staff** | Admin API | SSO session on `admin.dripfunnel.com` | None: a `StaffContext` (staff member, staff role) | none | Staff role (§5.4) |

```ts
type SellerScope =
  | { kind: 'all' }                          // merchant side of this store
  | { kind: 'seller'; sellerId: string };    // one vendor in this store

type StoreCaller =
  | { kind: 'person'; userId: string; sessionId: string }
  | { kind: 'shopper'; customerId: string | null }
  | { kind: 'api-key'; keyId: string; createdByUserId: string }
  | { kind: 'app'; grantId: string; appId: string }
  | { kind: 'support'; supportSessionId: string;
      actor: { kind: 'partner-user' | 'staff'; id: string }; access: 'read' | 'write' };

interface TenantContext {
  caller: StoreCaller;
  partnerId: string;                         // the store's partner; must match the host's
  storeId: string;                           // resolved server-side, never from input as authority
  sellerScope: SellerScope;
  permissions: ReadonlySet<Permission>;
  subscription: 'trialing' | 'active' | 'past_due' | 'canceled' | 'suspended';
}
```

The properties that do the work (the first platform's ARCHITECTURE §4.1, PLATFORM-PROMPT §2 item 18):

- **`SellerScope` is a discriminated union with no default.** Forgetting the vendor filter is a
  type error; every `{ kind: 'all' }` is a deliberate, greppable statement.
- **Everything scoped hangs off the acting store, never off the user.** There is no "this
  user's `seller_id`" or "this user's permissions", only theirs *in this store*.
- **No caller borrows another's power.** An API key can't do what its creator's role can't; a
  vendor-bound key can't see outside its `seller_id`; a support session can't do what the
  merchant hasn't allowed; a partner user or staff member has no store permissions at all
  outside a support session.

### 3.1 Resolver scope declarations

Each GraphQL field is defined with a scope declaration beside it (Pothos, ARCHITECTURE §1).
The declaration replaces the first platform's tRPC procedure bases:

| Declaration | Archive base | Guarantees |
|---|---|---|
| `api` | (one tRPC router) | Which schema the field lives in: `shop`, `store`, `platform` or `admin`. The router already refuses other hosts (ARCHITECTURE §2); this stops a field being mounted in the wrong schema. |
| `scope: 'public'` | `publicProcedure` | No session: sign-in, signup, accept-invitation, forgot and reset password, Shop API catalogue. |
| `scope: 'session'` | `sessionProcedure` | A valid person session and **no acting store**: which stores I belong to, my profile, sign out. Nothing declared this way may read store data. |
| `scope: 'store'` | `tenantProcedure` | Acting store verified (§9 checks 1 and 10), `TenantContext` built, subscription gate applied. |
| `scope: 'store-seller'` | `scopedProcedure` | `store` plus the `SellerScope` handed to the scoped query layer, so vendor reads and writes are filtered without the resolver asking. Every catalogue, inventory and order field uses this. |
| `permission: <key>` | `capabilityProcedure(cap)` | The permission (or Owner-only capability, §5.1) must be in `TenantContext.permissions` for the acting store. |
| `audit: <action>` | `privilegedProcedure(cap)` (never built) | The resolver's writes and its audit row commit in one transaction (§10). Required on every field that needs a capability, and on every Platform and Admin API mutation. |
| `scope: 'partner'`, `scope: 'platform'` | (none) | Platform API fields see only the caller's partner; Admin API fields see every partner, per staff role. |

A test walks every schema and fails on a field missing `api`, `scope` or `permission`, and on
a capability field missing `audit` (§11.2).

### 3.2 Vendor input can't carry ownership or visibility

A vendor's product input types **omit** `seller_id`, the product's visibility or status, and
`approval_status` (PLATFORM-PROMPT §2 item 19). GraphQL rejects unknown input fields, so a
vendor client sending them gets an error rather than a silent strip, which is a signal worth
seeing. Where one input type serves both merchant and vendor, the resolver rejects those fields
when `sellerScope.kind === 'seller'`. `seller_id` on a vendor's writes always comes from the
`TenantContext`.

### 3.3 What still can't be structural

The scoped layer filters rows; it can't know everything. These need explicit tests (§11):

- **Derived reads**: counts, facets, stock totals, search results, empty states, exports,
  reports and notifications must be computed through the scoped layer, never by a raw
  aggregate (PLATFORM-PROMPT §5.1).
- **Field-level serializing**: what a vendor may see of a customer on a sub-order (§7.3), and
  the fields a support session may read (§8).
- **Cross-row writes**: fulfilment of a sub-order from a named warehouse, where the warehouse,
  the sub-order and the lines must all belong to the caller's `seller_id`.
- **Cross-store lookups** the engine does on purpose: finding an existing account by email on
  the invitation join path (§6.2), and the membership set at sign-in. Neither may return data
  about another store to the caller.

---

## 4. Sessions

```
Browser ──(httpOnly cookie, host-only)──▶ /api on the same host ──▶ session row (Postgres)
          (X-Store: <store id>)                                      └─ membership rows, read per request
```

- **Sign-in.** The browser posts credentials to the Store API on the portal host. The engine
  checks them, creates a `session(id, user_id, partner_id, created_at, last_seen_at,
  absolute_expires_at, remember)` row, and returns only an opaque cookie: `__Host-` prefixed,
  `httpOnly`, `Secure`, `SameSite=Lax`, no `Domain` attribute. The cookie name carries no
  DripFunnel branding (white label). Nothing else reaches the browser.
- **The membership set** is the user's active memberships in stores of the host's partner.
  One membership goes straight in; several show the store chooser, with the last store
  offered as one button above the full list. The remembered store id is a client-side
  convenience only (the first platform's AUTH-PLAN §11, settled by the build).
- **Every request** names its acting store, and for a person who works for more than one
  supplier in that store the acting supplier, in a header (`X-Store`, name proposed). The
  engine reads the session, checks the idle and absolute bounds, **looks up the membership
  row for (user, acting store, acting supplier)** and builds the `TenantContext` from it. Memberships and role
  permission sets are read per request (or from a cache invalidated by every membership
  write), so a role change, a vendor tier change or a removal applies on the next request.
- **A request naming a store the session doesn't hold** is not a 404: it is an attempted
  tenant crossing. Answer 403, and log it with both store ids and the user, because it is a
  client bug or someone probing.
- **Timings**: idle **2 h**, absolute **12 h**. "Remember me" extends the absolute bound
  *(confirm by how much)* rather than removing it. Sessions are never year-long.
- **Sign out is global** across every store in the session: one session, one row, deleted.
  A password change or reset ends every other session of that user on every host *(confirm)*.
- **CSRF**: `SameSite=Lax` plus a check that `Origin` matches the host on every mutation, and
  GraphQL accepting only `application/json` POSTs for mutations.
- **Redirects after sign-in** (`next`) are same-origin only: parse against the host and compare
  origins; a protocol-relative `//host` is refused (the first platform's Google callback bug, §12).
- **Rate limits** on sign-in, signup, invitation, password reset and code entry, per IP and per
  account (Workers rate-limit bindings and WAF, ARCHITECTURE §7).
- **Partner users** use the same session model on `platform.dripfunnel.com`, with no acting
  store. **Staff** sessions come from SSO on `admin.dripfunnel.com`, have a timeout
  *(confirm: the same 2 h / 12 h, or shorter)*, and **re-authenticate before dangerous
  actions**: suspend, refund, delete, open a support session, change a price (CONSOLE-DESIGN
  A2). **Support sessions** have their own cookie and bounds (§8).
- **Past due** blocks writes in that store but never signs anyone out (PLATFORM-PROMPT §2
  item 7); the gate is evaluated per acting store, from `subscription` on the context,
  invalidated by the billing webhook.

---

## 5. Roles and permissions

Roles are fixed; a store's People and Supplier screens offer them from a dropdown; nothing
creates, edits or clones a role (PLATFORM-PROMPT §2 item 2). A role key maps to a permission
set in `apps/api/src/auth`. **Permission names below are proposed; the sets are decided.**
In the vendor columns, every permission is limited to the vendor's own rows by `SellerScope`.

### 5.1 Merchant roles: Owner `owner`, Manager `manager`, Staff `staff`

From the first platform's AUTH-PLAN §5.3 and DESIGN-BRIEF §2.

| Permission | Owner | Manager | Staff |
|---|:--:|:--:|:--:|
| `catalog.read`: products, versions, photos, collections, filters | ✓ | ✓ | ✓ |
| `catalog.write` | ✓ | ✓ | |
| `stock.read` | ✓ | ✓ | ✓ |
| `stock.write`: quantities in the merchant's own warehouses | ✓ | ✓ *(confirm)* | |
| `warehouses.write`: the merchant's own warehouses | ✓ | ✓ *(confirm)* | |
| `orders.read`, `customers.read` | ✓ | ✓ | ✓ |
| `orders.write` (including fulfilment and cancellation), `customers.write` | ✓ | ✓ | ✓ |
| `offers.read`, `offers.write` | ✓ | ✓ | |
| `payments.configure`, `shipping.configure`, `tax.configure` | ✓ | | |

**Owner-only capabilities**, checked for the acting store; someone may be an Owner in one
store and a vendor in another:

| Capability | Covers |
|---|---|
| `invite` | People: invite, resend, revoke, change role, remove (flows 8–12) |
| `manage-vendors` | Create, invite, change tier, suspend, remove vendors (flows 14–17) |
| `approve` | The approval setting and queue (flows 18–19) |
| `publish` | Storefront: describe, preview, approve, publish, undo (flows 48–52). Whether a Manager may press catalogue **Publish now** is *(confirm)* |
| `billing` | Plan, subscription, invoices, the subscription payment method (flows 59–64) |
| `settings` | Store info, payment, shipping and tax setup, custom domain, **Support access**, and **Settings › Developers** (public store key, allowed origins, API keys, webhooks) and app installs |

A Manager reaching an Owner-only screen gets the designed permission-denied state (flow 67);
the resolver refuses regardless of the screen.

### 5.2 Vendor tiers

The merchant picks one **access level per supplier** (`seller.access_level`) and can change it
later (§7.5); it applies to every user of that supplier. **Inside it, the supplier manages its
own team** with the team roles **Supplier admin** `supplier-admin` (the access level plus
inviting, changing and removing its own users) and **Supplier member** `supplier-member`
(the access level only) *(proposed)*; the membership's `role_key` holds the team role
([DATA-MODEL.md](DATA-MODEL.md) §4.2). The merchant's Owner still sees, suspends and removes any
supplier user. The Supplier tab offers the
first three levels; `vendor-orders-read` is defined but not offered, for a merchant who wants a
supplier who can look and not touch.

| Permission (own rows only) | Stock only `vendor-stock` | Products and stock `vendor-catalogue` | Products, stock and their orders `vendor-orders-fulfil` | Read-only orders `vendor-orders-read` |
|---|:--:|:--:|:--:|:--:|
| `catalog.read` | ✓ | ✓ | ✓ | ✓ |
| `catalog.write` | | ✓ | ✓ | ✓ |
| `stock.read`, `stock.write`, `warehouses.write` | ✓ | ✓ | ✓ | ✓ |
| `orders.read`: their own sub-orders | | | ✓ | ✓ |
| `orders.fulfil`: their own sub-orders | | | ✓ | |
| Offers, customers (beyond §7.3), payments, shipping, tax, people, vendors, billing, settings | never | never | never | never |

- **Stock only** is "they update quantities. Nothing else." Catalogue read is included because
  stock is meaningless without finding the version to count. It must never grant catalogue
  write; mapping it onto `vendor-catalogue` would let a supplier add and edit products while
  the screen promised otherwise.
- **Unlike the first platform, these ticks are the enforced boundary.** Because permissions apply per
  row, `catalog.write` for a vendor is "write my own products" at the engine, not only in the
  portal.
- A vendor's warehouses are the vendor's: the merchant sees them in their own labelled group
  but can't rename or remove one, and they are never offered as the default for new merchant
  products (DESIGN-BRIEF §4, settled).

### 5.3 Partner roles (platform console) — PROPOSED 2026-09-28

Derived from USERS-AND-DOMAINS §4. A partner acts **on its own merchants only, at account
level**; it never reads a merchant's customers, orders or catalogue except in a support
session, and never sees another partner. **Proposed, confirm before building.**

| Can | Owner | Admin | Support | Finance | Read-only |
|---|:--:|:--:|:--:|:--:|:--:|
| See merchant accounts, plans, billing status, domain, provisioning, publishing status, usage | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create a merchant (Owner invitation) | ✓ | ✓ | | | |
| Change a merchant's plan, price, limits, entitlements ("Publish now" allowance), trial | ✓ | ✓ | | ✓ *(trial and billing fields only)* | |
| Suspend and restore a merchant | ✓ | ✓ | | | |
| Open a read-only **support session** (§8) | ✓ | ✓ | ✓ | | |
| Request write elevation inside a support session | ✓ | ✓ | ✓ | | |
| Branding, portal host, preview and shop domains, email sender domain | ✓ | ✓ | | | |
| Plans and prices offered to merchants | ✓ | ✓ | | ✓ *(prices only)* | |
| The partner's own billing with DripFunnel: invoices, payment method | ✓ | | | ✓ | |
| Partner users: invite, change role, remove | ✓ | ✓ *(not Owners)* | | | |
| Close or offboard the partner, transfer partner ownership | ✓ | | | | |

The last Owner of a partner can't be removed or demoted, as for merchants and staff.

### 5.4 Staff roles (admin console)

From CONSOLE-DESIGN §4. A control a role can't use is visible and disabled with the reason
("Finance can issue refunds"). Destructive actions may require a **second approver**
*(ask which, CONSOLE-DESIGN O3)*.

| Staff role | Can |
|---|---|
| **Super admin** | Everything, including staff management, platform settings and deleting. At least two people; never a shared account. The last Super admin can't be removed or demoted (O2). |
| **Partner manager** | Create, approve and configure partners, their plans and prices; see their partners' stores and billing. |
| **Support** | Search everything; see store detail; **open a support session** under §8's rules (read-only by default); retry failed jobs; resend emails. No billing changes, no suspensions. |
| **Finance** | Billing, invoices, credits, refunds, dunning, revenue reports. No store configuration. |
| **Engineer on call** | Jobs, fleet, builds, domains, integration health; suspend a store in an emergency. |
| **Read-only** | Sees everything Support sees, changes nothing. |

Staff have **account-level** access to every partner and merchant through the Admin API. Inside
a store they follow the same support-access rules as partners (USERS-AND-DOMAINS §4). Every
staff write is audited (§10).

### 5.5 Never in any merchant or vendor role

Rewritten from the first platform's list of Vendure permissions as engine rules. Each has a structural
test (§11.2).

- **No permission above the store.** Partners, plans, entitlements, provisioning, billing
  with DripFunnel, fleet and staff live in the Platform and Admin APIs, which don't exist on a
  portal host. No Store API field reads or writes them.
- **No role editing.** There is no role editor and no permission to change a permission set.
- **No reading people outside the acting store.** People are listed through memberships of
  the acting store only; no field lists users platform-wide (the `administrators` leak, §12).
- **No write to store lifecycle fields.** Subscription state, plan, partner, repo and deploy
  settings, template version and suspension are written only by the platform (provisioning,
  billing webhooks, Platform and Admin APIs). The `settings` capability covers the merchant's
  own settings, field by field, never the store record as a whole (the `UpdateChannel` trap).
- **No global settings.** Every setting is declared platform, partner, store or store-and-seller
  scoped; none is shared across stores by accident. Tax rates, vendors and settings are store
  rows.
- **No credential reads.** Payment provider and courier credentials are write-only, encrypted
  at rest, and never returned by any field; the screen shows that a credential is set and
  whether it works.
- **No offers in any vendor tier**, not even read. Discounting the store is the merchant's
  decision (PLATFORM-PROMPT §2 item 5).
- **No vendor list for a vendor.** A vendor reads only its own vendor record, never the store's
  list of vendors.
- **No tax, payment or shipping configuration for a vendor.**

### 5.6 API keys and app grants

- **API keys** are created by an Owner (`settings`), with named scopes drawn from §5.1–5.2's
  permissions, an optional vendor binding (the key then carries `SellerScope` `seller` and may
  hold only that vendor's tier permissions), an expiry, rotation, and a last-used time. The
  secret is shown once, stored hashed, and carries a visible prefix for identification.
  Scopes can't exceed the creator's role when created; what happens to a key when its creator
  leaves or is demoted is *(ask)*.
- **Vendors' own keys: later** (decided 2026-09-28). Until then only the merchant's Owner
  creates a vendor-bound key; when they come, a Supplier admin creates them within the
  supplier's access level.
- **App grants** are per store, with the scopes the merchant approved at install, revocable on
  uninstall; the app runs out of process and reaches the Store API like any other caller.
- Creating, rotating and revoking keys, and installing and uninstalling apps, are audited.

---

## 6. Invitations

### 6.1 Why not email a password

Emailing a generated password puts a working credential in an inbox with no expiry and
nothing forcing a change. The invitee chooses their own password; the emailed secret is
single-use and time-bounded.

### 6.2 Sequence

```
Portal: "Invite" (email, name, role from dropdown [, vendor])
   │
   ▼  Store API inviteMember, scope 'store', permission 'invite' (or 'manage-vendors'), audit
Engine, one transaction:
   ├─ 1. role_key is a merchant role (or, for a vendor, a vendor tier); only an Owner assigns owner
   ├─ 2. already a member of THIS store? → the only genuine error
   ├─ 3. account for this email in the people pool?
   │        no  ⇒ create user(status 'invited', password_hash null)
   │        yes ⇒ JOIN path: no account change
   ├─ 4. invitation(store_id, user_id, role_key, seller_id null|set, token_hash,
   │                expires_at, invited_by, status 'pending')
   └─ 5. outbox: invitation email, from the partner's sender domain, in its look
               new account      → https://<portal host>/accept-invite?token=…  (set a password)
               existing account → https://<portal host>/join?token=…           (sign in, then join)
   │
   ▼
Response: "Invitation sent", identical in both paths
   │
   ▼
Accept: token + password (new) or token + signed-in session (existing)
   → membership(user, store, seller_id, role_key) active, invitation 'accepted',
     email verified (the token proves the address), session created
```

- **Never reveal whether the email has an account** (PLATFORM-PROMPT §2 item 4). The response,
  the timing and the People list must be identical either way, so **both paths stay "Pending"
  until the invitee accepts**; never render "that user already exists".
- **No throwaway password.** Our users table allows an account without one.
- **The token** is 32 bytes from a CSPRNG, stored only as a hash, single-use, and only in the
  email. Steps 1–5 are one transaction, so a half-invited person can't exist, and the email
  is sent only after commit (outbox).
- **Vendor invitations** (flow 15) are heavier: `manage-vendors` creates the vendor row and
  invites its first user with that `seller_id` and a vendor tier in the same transaction.
- **Partner-created merchants** (USERS-AND-DOMAINS §3): provisioning creates the store and an
  Owner invitation through the same mechanism, attributed to the partner user who asked.
- Rate-limited per store, per inviter and per address, so invitations can't be an
  email-bombing tool.

### 6.3 Lifecycle

- **Resend** mints a fresh token; the previous one stops working.
- **Revoke** sets the invitation `revoked`. An `invited` account with no other pending
  invitation and no membership is deleted.
- **Expiry**: 7 days *(confirm)*. Pending invitations show their expiry; expired ones are
  obvious and offer resend (flow 10).
- **Already a member here** is the only error, and it reveals nothing the Owner can't already
  see in their own People list.
- **Change role** writes the membership's `role_key`; it applies on the next request.
- **Removing someone** (flow 12) removes the membership for this store only. The account
  survives if they belong elsewhere and is deleted only when the last membership goes. Their
  open requests in this store fail on the next request.
- **Owner invariant**: refuse to remove or demote the last active Owner of a store.

---

## 7. Vendors

A vendor supplies products that the merchant sells. A vendor is a `vendor` row in the store
(UI word: **Supplier**); its users are people with a membership carrying its `seller_id`; its
products, warehouses and stock are ordinary store rows carrying the same `seller_id`. The
merchant sees everything; a vendor sees only its own. **A vendor never sees anything of the
merchant's or another vendor's**, including counts, search results, empty states, exports and
stock totals (PLATFORM-PROMPT §2 item 5).

### 7.1 Ownership

- A vendor creates a product ⇒ `seller_id` comes from the `TenantContext`, never the input.
- `seller_id` null ⇒ the merchant's own. Vendor queries filter `seller_id = <theirs>`, so
  merchant rows never match.
- A person who is a vendor in several stores has a **different `seller_id` in each**.
  Resolving it from the user rather than from (user, store) would show them another store's
  products; the context shape makes that unspellable.
- Merchant queries use `SellerScope` `all` and show the vendor name.
- The merchant may edit any product, vendor-owned included, and **the vendor sees the edit**:
  one shared record, not a copy (PLATFORM-PROMPT §2 item 6).
- **A vendor may never change a product's `seller_id`** (§3.2).
- Versions, stock and photos resolve ownership through their product; stock and warehouses
  carry `seller_id` of their own because warehouses are per owner.
- How products come to belong to a **Stock only** vendor, who can't create them (does the
  merchant assign ownership?), is *(ask)*.

### 7.2 Approval is a per-store setting

`store.vendor_products_require_approval` (Owner, `approve`):

- **Off**: a vendor's product is created visible and reaches the storefront at the next
  publish.
- **On**: the engine creates it hidden with `approval_status = 'pending'`, whatever the vendor
  sent. The queue lists `pending`; approving sets `approved` and makes it visible; rejecting
  records a reason the vendor sees.
- Vendor input can't carry visibility or `approval_status` (§3.2).
- Whether editing an approved product sends it back to `pending` is open (§13).

### 7.3 Orders: vendor sub-orders

The engine owns orders, so an order is split into **per-vendor sub-orders** with their own
lines, fulfilment and (later) payouts (PLATFORM-PROMPT §3.3, §5.4). This replaces the
first platform's constructed view.

- **Read** (`vendor-orders-read`, `vendor-orders-fulfil`): the vendor lists its own sub-orders
  through the scoped layer. **A vendor never sees an order total**: shipping, discounts and tax
  that span vendors can't honestly be attributed to one. Show their lines and line amounts;
  whether a sub-order carries its own attributable totals is part of the order design.
- **Fulfil** (`vendor-orders-fulfil`): a vendor fulfils lines of its own sub-orders, from its
  own warehouses. Every line and the warehouse must carry the caller's `seller_id`. Still the
  highest-risk vendor write; it gets explicit tests even though the scoped layer filters it.
- **Customer data**: a vendor shipping directly needs a name and delivery address, which belong
  to the merchant's customer. The rule, applied in the serializer and never in the UI: **name
  and delivery address, not email or phone** (PLATFORM-PROMPT §5.4) *(confirm, §13)*.
- Refunds, cancellations and returns spanning vendors: design them now or scope them out
  explicitly (PLATFORM-PROMPT §5.4, §10).

### 7.4 Search, stock and derived reads

Vendor scoping reaches every derived read: search results and facets, collection contents
shown in the portal, stock totals and low-stock alerts, exports, reports and notifications.
Stock quantities are commercially sensitive: a vendor never sees how much the merchant or
another vendor holds (DESIGN-BRIEF fact 10).

### 7.5 Lifecycle

- **Create** (`manage-vendors`): the vendor row and its first user's invitation, one
  transaction (§6.2). That first user becomes its **Supplier admin**.
- **Team** (Supplier admin): invite colleagues into its own supplier, change their team
  role, remove them. The invitation's `seller_id` comes from the inviter's membership. A
  supplier always keeps one admin; if the last one leaves, the merchant's Owner appoints one.
- **Change access level**: write `seller.access_level`. It applies to all of the supplier's
  users on the next request; there is
  no cache delay, so the portal can say it is immediate (this changes flow 16's "it can take a
  few minutes").
- **Suspend**: the vendor's memberships stop resolving and its API keys stop working; its
  products stay, tagged with its `seller_id`. Whether they stay on the storefront is *(ask)*.
- **Remove**: what happens to its products is open (§13). They sit in the merchant's store
  already, so leaving them is probably right, but the merchant then owns products no vendor
  maintains.
- **One role per membership** (decided 2026-09-28): one merchant-side membership per person
  per store, and one per supplier. A person **may work for two suppliers in the same store**
  (two memberships, and the store chooser lists "Store · Supplier"), but is **never both the
  merchant's staff and a supplier in the same store** (DATA-MODEL.md §3.3).

---

## 8. Support access sessions

From USERS-AND-DOMAINS §4.1 (decided) and CONSOLE-DESIGN part J. Partner users and staff open
a merchant's portal for support **only** through a support session; there is no other way into
a store's data for either.

**The setting.** *Settings › Support access* in the portal: "Allow [partner name] support to
view my store: On / Off". **On by default**; the Owner (`settings`) can switch it off at any
time, which ends any open support session immediately. When it's off, support can only ask the
merchant to switch it on.

**Opening one:**

```
Console (platform or admin): store page → "Open support session"
   │  checks: actor's role allows it (§5.3, §5.4); the store belongs to the actor's partner
   │          (staff: any partner); the store's setting is On; re-authentication (A2);
   │          a reason or ticket number
   ▼
support_session(store_id, actor_kind, actor_id, reason, access 'read',
                started_at, expires_at = +30 min (confirm), ended_at)  + audit row
   │  one-time handoff token, short-lived, single use
   ▼
Browser → https://<store's portal host>/support/enter?token=…
   → Store API exchanges it for a support cookie on that host (separate from any person session)
   → TenantContext { caller: support, sellerScope: all, permissions: support read set }
```

**Rules:**

- **Read-only** by default: the support read set is the Owner's read permissions, minus
  anything credential-shaped (credentials are never readable anyway, §5.5).
- **Time-limited**: 30 minutes by default *(confirm)*, no silent extension; a new session needs
  a new reason.
- **Visible**: while it is open, every person signed in to that store sees a banner: "[Partner]
  support (Priya) is viewing your store. Read-only. Ends in 28 min." The support agent sees an
  unremovable bar naming the store, their role and the time left (J3). What a staff session's
  banner calls DripFunnel under a white-label partner is *(ask, §13)*.
- **Logged**: every session appears in the store's *Support access log* (who, when, why, how
  long) and in the platform audit log; the merchant is emailed when one starts *(confirm)*.
  Every read in the session is attributed to the real agent, not to the merchant.
- **Write elevation**: support requests write access; the merchant clicks "Allow" or "Deny";
  the elevation applies to that one session and is logged. Who in the store may allow it
  (the Owner only, or anyone with the matching permission) is *(confirm)*.
- **Never, even elevated**: change passwords or sign-in methods, payment methods, payouts,
  ownership or roles; create API keys or install apps. A support session is not a person, so it
  can't act as one.
- **Staff** follow the same rules. A suspended store or a legally required investigation is the
  only exception, audited with the reason *(confirm)*.
- A partner's support session never reaches a store of another partner; the host check (§9
  check 0) and the partner check at opening both refuse it.

---

## 9. Authorization checks

Every resolver path makes these, through the scope declaration (§3.1) and the scoped layer,
not by hand. Numbering 1–9 follows the first platform's AUTH-PLAN §9 so cross-references stay valid;
0 and 10–14 are new.

0. **Host and API**: the router serves each API only on its hosts and answers 404 elsewhere
   (ARCHITECTURE §2); the partner is resolved from the host.
1. **Caller is valid**: a person session inside its idle and absolute bounds; an API key or app
   grant that exists, isn't expired or revoked; a support session that is open, unexpired and
   whose store setting is still On. **And the acting store is in the caller's set**: the
   person's membership set, or the store the key, grant or support session is bound to.
2. **The permission or capability is held in the acting store**, from the membership's
   `role_key`, the key's scopes or the grant's scopes. An Owner in one store and a vendor in
   another gets each role only in its own store.
3. **Every target role key is a valid key for its kind**: a merchant role for a person, a vendor
   tier for a vendor user, from the fixed catalogue; never an arbitrary string, and `owner` only
   from an Owner.
4. **The target is in this store**: every id in the input is resolved through the scoped layer,
   so another store's id is "not found", never a hit.
5. **`seller_id` comes from the `TenantContext`**, never from the input.
6. **Vendor reads are filtered** on every path: product list, product by id, versions, photos,
   stock, warehouses, sub-orders, search, facets, counts, exports. One unfiltered path exposes
   the whole store.
7. **Vendor writes are validated** against ownership: products, stock, warehouses, and every
   line and warehouse in a fulfilment.
8. **Vendor input carries no ownership or visibility fields** (`seller_id`, visibility,
   `approval_status`): rejected, not stripped (§3.2).
9. **Owner count invariant**: never remove or demote the last active Owner of a store (and of a
   partner, and the last Super admin).
10. **The store belongs to the host's partner**: a membership in a store under partner B is
    never usable on partner A's portal host.
11. **Store state gate**: past due allows reads and blocks writes; suspended *(ask what it
    allows)*; cancelled and closed per [SAAS.md](SAAS.md).
12. **Caller-kind limits**: a key or grant never exceeds its scopes; a vendor-bound key never
    leaves its `seller_id`; a support session never exceeds read unless elevated, and never does
    §8's "never" list.
13. **Rate limits** on sign-in, signup, invitation, password reset and code entry. A
    non-enumerable response isn't enough; an unthrottled endpoint is still an email-bombing
    tool.
14. **Audit**: the capability-gated write commits with its audit row (§10).

**Multi-store membership raises the stakes on checks 1, 2 and 5.** A person in two stores is a
live bridge between two tenants with one session valid in both. Test the crossings explicitly:
a person who is Staff in store A and a vendor in store B must not see A's catalogue while
acting in B, must not carry A's permissions into B, and must not resolve B's `seller_id` while
acting in A.

---

## 10. Audit

Specified in [LOGGING.md](LOGGING.md): the **activity log** is the audit log. In short:

- Every write and every sign-in by every caller (staff, partner users, merchants, vendors,
  API keys, apps, support sessions, shoppers, jobs) writes one entry in `activity_log`, in
  the same transaction as the change, from the resolver's scope declaration (§3.1).
- Each entry records the real actor (and, for a support session, the agent behind it), the
  partner, store, seller and customer it concerns, the action, target, changes, reason and
  request id. Secrets and payloads never go in.
- Append-only; 13 months searchable, then archived for 7 years.
- Who sees what, and the search by person, are in LOGGING.md §6–7. Security events
  (failed sign-ins for unknown accounts, rate-limit hits, attempted tenant crossings) are
  entries with staff-only visibility.

---

## 11. Testing

Authorization tests are the priority (PLATFORM-PROMPT §5.9). They run against the real API
layer and a real Postgres (Testcontainers), never a mocked data layer.

### 11.1 Isolation matrix

Fixtures: **two partners**, each with **two stores**, each store with **two vendors**; a person
who is Staff in store A1 and a vendor in store A2; the same email with an account under each partner (two unrelated accounts);
store-wide and vendor-bound API keys; an app grant; read-only and elevated support sessions
opened by a partner user and by staff; a partner user of each partner; each staff role.

Enumerate every field × caller kind × role or tier × acting store × seller × host, and assert:

- nothing of another store, partner or vendor is returned, counted, faceted, exported or
  mentioned in an error, and ids from elsewhere read as "not found";
- each role and tier can do exactly what §5 says, and is refused the rest;
- vendor input with `seller_id`, visibility or `approval_status` is rejected;
- every fulfilment line and warehouse is checked against the vendor's `seller_id`;
- the invitation response, timing and People list are identical for new and existing emails;
- a role change, tier change, removal and suspension apply on the very next request;
- the last-Owner invariant holds for stores, partners and staff;
- a support session can't read another partner's store, can't write before elevation, and
  can't do §8's "never" list even after it;
- a partner user and staff member get nothing from the Store API outside a support session;
- the Staff-in-A / vendor-in-B person leaks neither way (§9).

### 11.2 Structural tests

- Every GraphQL field in every schema declares `api`, `scope` and `permission`; every
  capability field declares `audit` (§3.1).
- Only `db/scoped` reads or writes tenant tables; raw table access is importable only there
  (lint plus test).
- Every table is declared platform, partner, store or store-and-seller scoped.
- No Shop API field returns a Store-, Platform- or Admin-only type.
- Every API answers 404 on every host it doesn't belong to.
- The role catalogue's permission sets are snapshot-tested, so any change shows in review, and
  §5.5's rules are asserted: no vendor tier holds any `offers.*`, `payments.*`, `shipping.*`,
  `tax.*` or capability; no store role holds a platform permission; no field returns a
  credential.
- The audit table rejects update and delete from the application role.
- If row-level security is adopted, a test runs a query with the scoped layer bypassed and
  proves the database refuses another store's rows.

Playwright covers a small set of journeys: sign-in, store switching, accept-invitation (new
and existing account), and a support session with its banner.

---

## 12. Lessons from the Vendure build

The first platform's design was shaped by Vendure's limits (AUTH-PLAN §2, §6). The workarounds are gone
(PLATFORM-PROMPT §3.1); the lessons they taught are product rules here.

- **Unscoped list queries leak.** Vendure's `administrators`, `Seller` and `TaxRate` lists
  returned every tenant's rows, and a superadmin holding a role in every channel showed up in
  every store's people list. Every list goes through one scoped layer; nothing is global by
  accident; platform identities never appear in a store's People (§5.5, §11.2).
- **Permissions must be per row.** Per-store permissions meant a vendor with "write catalogue"
  could write the whole store, and separation existed only in the portal plus a proof header.
  Here `SellerScope` is enforced by the engine for every caller (§5.2).
- **A session of a year and a permission cache delay are unacceptable.** A year-long session
  and five minutes before a suspension or downgrade applied. Sessions are 2 h idle / 12 h
  absolute, and role changes apply on the next request (§4).
- **Per-person fields can't hold per-store facts.** Vendor identity on the account forced one
  identity across every store; it lives on the membership (§1).
- **A service account makes the underlying guards inert and the history anonymous.** There is
  none; the caller is always the real actor, and the audit log names them (§10).
- **One permission can hide several powers.** `UpdateChannel` gated publishing but also every
  channel field, including secrets. Store fields are written field by field under specific
  capabilities, and lifecycle fields only by the platform (§5.5).
- **Hiding a control isn't a control; sanitising writes matters as much as filtering reads.**
  Vendor input can't carry ownership or visibility fields at all (§3.2).
- **Invitations need a pending account, not a throwaway password**, and the join path for
  existing accounts is normal, not an error (§6).
- **Email links must know their audience.** A reset link that pointed everyone at the staff
  dashboard taught that every email is sent from, and links to, the right host for its
  recipient: the partner's portal host and sender domain for people (§2).
- **Mocks would have passed the leaks.** Only tests against the real API and a real database
  caught them (§11).
- **Redirect targets must be same-origin.** A `startsWith('/')` check admitted `//evil.com`
  after Google sign-in (§4).

---

## 13. Open questions

Carried from the first platform's AUTH-PLAN §11 and PLATFORM-PROMPT §10, plus those this port raised.

**Carried, still open**
- **2-factor**: Owners only, or everyone? And for partner users?
- **Does editing an approved vendor product send it back to `pending`?** Safer, but it lets a
  vendor pull a live product off the storefront by editing it (§7.2).
- **What may a vendor see of a customer?** Name and address to ship; email and phone probably
  not (§7.3).
- **What happens to a removed or suspended vendor's products?** (§7.5)
- **Refunds, returns and cancellations across vendors**: first release or later? (§7.3)
- **Can someone be a vendor and merchant staff in the same store?** One membership per (user,
  store) says no; make it deliberate (§7.5).
- **Does a vendor see which other stores a product of theirs is in?** Products are per store,
  so nothing leaks by default; a "sell this in my other store" feature needs its own design.
- **Past due and vendors**: past due never locks the merchant out (decided); what happens to
  that store's vendors, and does a suspended store allow sign-in at all? (§9 check 11)
- ~~Can vendors have their own API keys?~~ Later (§5.6).

**Raised by this port**
- ~~A person with stores under two partners~~ **Settled 2026-09-28**: accounts are per
  partner, so each partner's portal is its own account in its own look (§2).
- Shopper sign-in: may partners restrict the per-store choice by plan? Which SMS/WhatsApp
  provider? (§2.1)
- **Partner roles**: confirm the proposed matrix (§5.3).
- **Invitation expiry**: 7 days, carried from the first platform's default (§6.3).
- **Manager permissions**: stock and warehouse writes; catalogue "Publish now" (§5.1).
- **Stock only vendors**: how their products come to exist (§7.1).
- **Support sessions**: default length; the email notice; who in the store may allow write
  elevation; the investigation exception; what a staff session's banner names under a
  white-label partner (§8).
- **Staff session bounds** and which actions need a second approver (§4, §5.4).
- **API keys** when their creator leaves or is demoted; whether apps can be vendor-bound (§3,
  §5.6).
- **Password change** ending every other session on every host (§4).
- **Row-level security** as defence in depth: yes or no (§1).
- **Whether vendors see any audit entries** (§10).
