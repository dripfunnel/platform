# ACCESS.md

Identity, sessions, roles and permissions, invitations, vendors, support access, tenancy and
authorization in the DripFunnel engine: **who can sign in, where, how they get an account,
what they may do, and how every resolver proves it**. Ported on 2026-09-28 from the
first platform's AUTH-PLAN (§3, §4, §5.3, §7, §8.3–8.6, §9, §11) and
ARCHITECTURE (§4, §6.3, §7), with framework facts replaced by engine facts; AUTH-PLAN §2 and §6 were
framework-specific and survive only as §12's lessons. Where this document and
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) or
[`../USERS-AND-DOMAINS.md`](../USERS-AND-DOMAINS.md) disagree, those two win. Engine
requirements are in [PLATFORM-PROMPT.md](PLATFORM-PROMPT.md) (§2 items 2–5 and 16–20, §5.1–5.3,
§5.9); staff roles and the admin console's access parts are in
[../ui/admin/CONSOLE-DESIGN.md](../ui/admin/CONSOLE-DESIGN.md) (§4, parts A, J, O, P).

**Status: partly built.** The tenancy tables, `TenantContext`, the scoped layer and the
row-level security backstop landed with #12; staff identity and sessions with #13, and staff permissions and the resolver check with #14. Code lives in
`apps/api/src/auth` (identity, sessions, memberships, roles, keys, grants, staff identity),
**`apps/api/src/core/tenancy.ts`** (`TenantContext` and `SellerScope` — the type sits in
`core` because `db/` may import only `core`, and `db/scoped` is its consumer),
`apps/api/src/db/scoped` (the scoped query layer), `apps/api/src/apis/graphql/scope.ts` (the
per-resolver scope declaration) and `apps/api/src/saas` (support access, audit log).

Last updated: 2026-10-05.

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
| **How a supplier ships is a per-supplier setting the merchant controls** (decided 2026-10-02 on #182): `seller.shipping_mode` is **to the store's warehouse** (the supplier sees nothing of the shopper) or **to the shopper** (the supplier fulfils its own lines and sees name and delivery address only) (§7.3) | One model for every supplier; a store-wide switch; a store default with per-supplier override | A local maker sends stock to the store while a distant one drop-ships, and both happen in one store. One model loses a real case; a store-wide switch makes such a store pick; a default plus override is a third state for no clear gain. |
| **Each supplier refunds its own items; the store can override; the override goes to a ledger settled outside the platform** (decided 2026-10-02) | Payouts inside the platform (Stripe Connect, Razorpay Route); merchant-only refunds | No payout provider is chosen and onboarding one is months of work before the first sale; the ledger is what the override copy and the activity log need anyway. In-platform payouts stay a later card (PLATFORM-PROMPT §5.4 Payments). |
| **2-factor is required for Owners and optional for everyone else** in the people pool (decided 2026-10-02): authenticator app or SMS, ten single-use backup codes (§2, §4) | Everyone; nobody | The Owner holds billing and the customer list; the prototype's My profile designs the enrolment and backup flows in full. |
| **An approved supplier product goes back to pending only when its name, a price or its photos change, and is hidden until approved** (decided 2026-10-02) | Re-approve every edit; keep the last approved version live while the edit is pending | Only those three fields change what the shopper is sold. Keeping the old version live needs a pending copy of three fields; Gaurav chose the simpler model knowing a supplier can take its own product off sale by editing it (§7.2). |
| **On suspending a supplier the Owner chooses whether its products are hidden or keep selling from stock in hand; hidden ones return on resume. A removed supplier's products are hidden and kept, still marked as theirs** (suspend: decided 2026-10-02 on #186's review with the prototype's modal, replacing the morning's "always hidden"; remove: 2026-10-02) | Always hidden on suspend; delete on removal | A suspension is often about the relationship, not the stock: the merchant may hold weeks of the supplier's goods. Nothing the merchant may want to keep selling is lost (§7.5). |

---

## 2. Identities

Four pools. An email address in one pool says nothing about the others: a partner user and a
merchant with the same address are two unrelated accounts.

| Pool | Who | Signs in at | Credentials | Unique by |
|---|---|---|---|---|
| **People** | Merchants (Owner, Manager, Staff) and vendor users | Their partner's **portal host** (e.g. `store.<partnerdomain>`), Store API at `/api` | Password (argon2id or the KDF chosen under Workers CPU limits, ARCHITECTURE §8), Google sign-in, 2-factor **required for Owners and optional for everyone else** (decided 2026-10-02): an authenticator app or an SMS code to the person's own mobile number, plus ten single-use backup codes shown once when made; an Owner without it is sent to set it up at their next sign-in and can change the method but never turn it off (§4) | `(partner, email)`: the same email under two partners is two unrelated accounts |
| **Partner users** | A partner's own team | `platform.dripfunnel.com`, Platform API | Password (**built on #156**: PBKDF2-SHA256, 100,000 iterations — the most the Workers runtime allows — a 16-byte salt and a 32-byte key, `auth/password.ts`; one decoy derivation when no account matches, so an unknown email costs what a wrong password does); 2-factor (authenticator app) **optional per user, and the partner's Owner may require it for the whole team** (decided 2026-10-01 on #109: a user without it enrols at their next sign-in once required). No Google sign-in in the first release. **Invitation only, no self-signup**: the Owner is invited by Admin when the partner is created, everyone else by the partner's Owner or Admin (SAAS §3.2) | Email, within the partner |
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
  merchant portal (Settings › Customer accounts); the partner **may not** limit the choices per
  plan (decided 2026-10-05 on #337).
- `customer(id, store_id, email null, email_verified_at, phone null, phone_verified_at,
  password_hash null, ...)`, unique `(store_id, email)` and unique `(store_id, phone)` where
  set. Phone numbers are stored in E.164. At least one verified identifier is required.
- With **both**, one customer may hold an email and a phone; adding the second one verifies
  it. A guest checkout with a phone links to an account with that phone **once the shopper proves
  the number with a code** at sign-in, never by number alone (decided 2026-10-05 on #337).
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
| **API key** | Store API | `Authorization` header, key hashed and looked up | The key's store | `seller` if the key is vendor-bound, else `all` | The key's scopes: capped by its creator's role when created, and by the supplier's current tier on every request if vendor-bound (§5.6) |
| **App grant** | Store API | The app's grant token | The grant's store | `all`: apps are always store-wide; only API keys may be supplier-bound (decided 2026-10-05 on #337) | The scopes the merchant approved |
| **Staff impersonation** | Store API or Platform API, on the target's host | Impersonation cookie from a handoff (§8.1) | The target membership's store, or none for a partner user | From the target membership | The target's own permissions |
| **Support session** | Store API, on the store's portal host | Support cookie from a support handoff (§8) | The one store the session was opened for | `all` | The read-only support set; the write set only after the merchant allows it |
| **Staff setup session** | Platform API, on `platform.dripfunnel.com` | Setup cookie from a handoff (§8.2) | None: a `PartnerContext` for the one partner, with no partner user | none | The partner Owner's set, minus payment method, payout details and team ownership |
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
  | { kind: 'impersonation'; impersonationId: string; staffId: string; userId: string }
  | { kind: 'support'; supportSessionId: string;
      partnerUserId: string; access: 'read' | 'write' };   // partner users only (§8)

interface TenantContext {
  caller: StoreCaller;
  partnerId: string;                         // the store's partner; must match the host's
  storeId: string;                           // resolved server-side, never from input as authority
  sellerScope: SellerScope;
  permissions: ReadonlySet<Permission>;
  subscription: 'trial' | 'active' | 'past_due' | 'cancelled' | 'suspended';  // DATA-MODEL §7.9's spellings (#212)
}
```

The properties that do the work (the first platform's ARCHITECTURE §4.1, PLATFORM-PROMPT §2 item 18):

- **`SellerScope` is a discriminated union with no default.** Forgetting the vendor filter is a
  type error; every `{ kind: 'all' }` is a deliberate, greppable statement.
- **Everything scoped hangs off the acting store, never off the user.** There is no "this
  user's `seller_id`" or "this user's permissions", only theirs *in this store*.
- **No caller borrows another's power.** An API key is created within its creator's role; a
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

**Built on #14** (`apis/graphql/scope.ts`). The declaration is the field's `access` extension:
`api`, `scope`, `permission`, and on every field that needs a permission a `target`: the
partner or store it acts on, or `'none'` for a list, which filters its own rows. `secureSchema`
wraps every Query and Mutation field so the check runs before the body. It **throws while the
schema is built** if a field declares nothing, names another API, uses a scope its API doesn't
serve, pairs a permission with `public` or `session` (or omits one elsewhere), or omits the
target, or names a permission outside its own API's catalogue (§5.3 for the Platform API, §5.4
for the Admin API). So the Worker, `pnpm schema` and every test refuse to start; a missing
declaration never means allowed. The Platform API serves `public`, `session` and `partner`
from #155 (`apis/platform/access.ts`: the partner role's permission, always within the
session's own partner); the Store and Shop APIs serve only `public` until their cards add a
policy. A field on any other type may declare a stricter permission and then reads as `null`
when refused. Full contact details are the exception (built on #36): `Customer.email` and
`phone` are masked rather than null for a role without `customers.contact.read`: the service
reads the stored values and masks them (`saas/customers/mask.ts`) before the response, and
`contactsMasked` says so.
`audit` is declared from the first audited mutation on.

Refusals carry a fixed message and one of two stable codes, whatever the target, so neither
says whether it exists:

| Code | When |
|---|---|
| `UNAUTHENTICATED` | No valid staff session. The console sends the caller to sign-in. `me` is `public` and reads `null` instead. |
| `FORBIDDEN` | Signed in, but the role lacks the permission, or a Partner manager isn't assigned to the target's partner (§5.4). The console shows its permission-denied state. |

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
- **Field-level serializing**: what a vendor may see of a customer on a sub-order, which
  depends on the supplier's shipping mode (§7.3), and the fields a support session may read
  (§8).
- **Cross-row writes**: fulfilment of a sub-order from a named warehouse, where the warehouse,
  the sub-order and the lines must all belong to the caller's `seller_id`; and, since
  2026-10-02, a supplier's **refund** (every line refunded, and the amount's ceiling, must be
  its own), including a refund of its own lines in a **return**. A supplier never starts,
  marks or cancels a return, so a return's state is never a supplier write (§7.3); the
  return line's destination warehouse is set by the store from the line owner's shipping
  mode.
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
  checks them, creates a `user_session` row ([DATA-MODEL.md](DATA-MODEL.md) §3.3, which owns
  the columns), and returns only an opaque cookie: `__Host-` prefixed,
  `httpOnly`, `Secure`, `SameSite=Lax`, no `Domain` attribute. The cookie name carries no
  DripFunnel branding (white label). Nothing else reaches the browser.
- **The membership set** is the user's active memberships in stores of the host's partner.
  One membership goes straight in; several show the store chooser, with the last store
  offered as one button above the full list. The remembered store id is a client-side
  convenience only (the first platform's AUTH-PLAN §11, settled by the build).
- **Every request** names its acting store, and for a person who works for more than one
  supplier in that store the acting supplier, in headers: **`X-Store`** and **`X-Supplier`** (built on #288,
  `auth/storeCaller.ts`; without `X-Supplier` a person with one membership there acts as it, one with
  two is asked, `SUPPLIER_REQUIRED`, as is one naming a supplier they don't work for in a store they hold, which is not a crossing; a merchant-side member, never also a supplier there, ignores the header). The cookie is `__Host-portal_session`, the session a `user_session`
  row read on the host's own partner only, so a cookie never works on another partner's host. The
  engine reads the session, checks the idle and absolute bounds, **looks up the membership
  row for (user, acting store, acting supplier)** and builds the `TenantContext` from it. Memberships and role
  permission sets are read per request (or from a cache invalidated by every membership
  write), so a role change, a vendor tier change or a removal applies on the next request.
  **Built on #288**: memberships are read on every request, in `system` scope; a suspended or
  removed supplier, an inactive membership and a closed store all count as not held.
- **Merchant sign-in, built on #290** (`apis/store/auth.ts`, on the portal host): `POST /api/auth/sign-in`
  (with `remember`), `send-code`, `second-factor`, `backup-code`, `enrol-second-factor` (`app` or
  `sms`), `sign-out`. As the partner console's: one password derivation, a decoy when there's no
  account, `INVALID_CREDENTIALS` alike for both, rate-limited per host and address and per typed
  email; five wrong passwords or codes, one count, lock for 15 minutes and queue the `user-locked` email to the person, while every wrong password still answers `INVALID_CREDENTIALS`; `switchStore` naming a store not held is logged as a crossing. A texted code is 6 digits, hashed with its row, 10
  minutes, five tries, at most three texts per person in 10 minutes; the authenticator's issuer is
  the partner's brand name. An Owner without 2-factor gets a session good only for enrolling,
  which ends with the ten backup codes shown once. `myStores` and `switchStore` read memberships in `system` scope, as the caller's own resolution does: they come before any acting store, so there is no `TenantContext` yet, and each read is pinned to the session's user and the host's partner. The support banner in `storeState` is read in the acting store's own scope (`open_support_banner`, migrations/0036). **Invitations and reset, built on #290** (`apis/store/invitations.ts`): `POST /api/auth/invitation` reads a link by its token's hash on the host's partner only and says which path it takes (`new` or `join`); `accept-invitation` takes a name and a password of 10 characters or more for a new person, proves the address, activates the membership and opens the session as sign-in would (an Owner enrols first); `join` needs the invited account's own full session on this host, changes nothing on the account, and holds a new Owner without 2-factor at set-up. Refusals: `INVITATION_USED`, `INVITATION_REPLACED`, `INVITATION_EXPIRED` (with the inviter's name, for the prototype's "Ask Priya for a new invite"), else `INVITATION_INVALID`, including someone else's link. `request-password-reset` answers the same for any email and writes one outbox row; the relay finds at most the host partner's account; `reset-password` works once within 30 minutes, ends every session of that person, lifts a sign-in pause, and signs in here as far as 2-factor allows. The links are minted when the email is sent, to the partner's live portal host (an email waits until one is live, never given up). Only an `invited` membership is activated: a link never restores a suspended member or changes a live member's role (`INVITATION_INVALID`). **My profile, built on #290** (`apis/store/profile.ts`, scope `session`, system scope pinned to the session's user like `myStores`): `profile`, `mySessions` (the newest 50, this one marked, a device name rather than the header; no cursor, since one would carry a session hash), `myActivity` (own entries, never a staff-only one); `updateProfile` (name and full international number; the number a texted sign-in code goes to changes only through `setSecondFactor`, which texts it first), `setTheme` (light or dark alone, so a details save never undoes a theme set on another device; allowed while read-only, audited as `person.profile_updated`), `changeEmail` (the current password first; a link to the new address for 24 hours, a notice to the old, the newest request only, three a day; the same answer for an address in use, whose link then changes nothing; confirmed at `POST /api/auth/confirm-email`), `changePassword` (the current one first, counted with sign-in's wrong tries; every other session ends), `setSecondFactor` (`app` or `sms`, started without a code and confirmed with one; every start and every `off` needs the password, counted the same way, so a stolen session can neither swap nor plant a factor; ten backup codes when it is first turned on, kept on a switch; `off` for anyone but an Owner), `regenerateBackupCodes`, `signOutOtherSessions` (it and a password change also cancel an email change in flight). **Sign-up, built on #290** (`POST /api/auth/sign-up`, `…/sign-up/verify-email`, `…/sign-up/store`, `…/sign-up/send-phone`, `…/sign-up/verify-phone`, a `__Host-portal_signup` cookie for a day): the same answer whether or not the address has an account; open only while the partner is Live (`SIGNUP_CLOSED`); a sign-up never works on another partner's host; the new Owner is then held at 2-factor set-up, as at sign-in.
- **A request naming a store the session doesn't hold** is not a 404: it is an attempted
  tenant crossing. Answer 403, and log it with both store ids and the user, because it is a
  client bug or someone probing. At most five crossings a minute are logged per person, whatever stores they name; past that they are refused without an entry, so a looping client can't flood the log (#288).
- **Timings**: idle **2 h**, absolute **12 h**. "Remember me" extends the absolute bound
  to **30 days** on that device, idle limit 7 days, with 2-factor still asked on a new device (decided 2026-10-05 on #337). Sessions are never year-long.
- **The second factor** (decided 2026-10-02; the prototype's `PortalAuth` and `PortalProfile`
  decide the screens): after the password, a person with 2-factor on enters a 6-digit code
  from their authenticator app or texted to their own mobile number; a **backup code** (one of
  ten, each usable once, stored hashed) stands in for it, and the sign-in says how many are
  left. An **Owner with 2-factor off is signed in only as far as the set-up screen**: nothing
  else answers until it is on. Setting up shows the authenticator secret and the backup codes
  **once**, at creation, and never again (ui/README.md §3). Codes are rate-limited like
  passwords; a used backup code is spent in the same transaction that admits the session.
- **Where you're signed in**: a person lists their own sessions (device label, last used,
  this one marked) and may end **every other session at once**; ending one chosen session is
  not offered. [DATA-MODEL.md](DATA-MODEL.md) §3.3 owns the columns.
- **Sign out is global** across every store in the session: one session, one row, deleted.
  **A password change or reset ends every other session of that user on every host**
  (decided 2026-10-02; the profile screen says so before the change).
- **CSRF**: `SameSite=Lax` plus a check that `Origin` matches the host on every mutation, and
  GraphQL accepting only `application/json` POSTs for mutations.
- **Staff re-authentication** (CONSOLE-DESIGN A2): `/api/auth/reauth` sends the staff member
  back to the provider with `prompt=login`, so its own session cannot answer for them, and
  stamps `staff_session.reauth_at` on the session they already hold — a second staff member
  cannot refresh someone else's. A credential counts as fresh for 5 minutes
  (`auth/session.ts`), which is what #40's impersonation checks.
- **A refused staff sign-in** sends the browser to `/sign-in?outcome=<state>`, the screens #17
  built. Everything about whether an account exists collapses to `refused`, so the outcome
  cannot enumerate staff (CONSOLE-DESIGN A1); only causes that happened at the provider
  (`cancelled`, `denied`, `blocked`, `unavailable`) are told apart. The reason is kept in the
  activity entry instead (LOGGING.md §4.2).
- **Redirects after sign-in** (`next`) are same-origin only: parse against the host and compare
  origins; a protocol-relative `//host` is refused (the first platform's Google callback bug, §12).
- **Rate limits** on sign-in, signup, invitation, password reset and code entry, per IP and per
  account (Workers rate-limit bindings and WAF, ARCHITECTURE §7).
- **Partner users** use the same session model on `platform.dripfunnel.com`, with no acting
  store. **Built on #155**: the `__Host-df_platform_session` cookie, a `partner_session` row
  (idle 2 h, absolute 12 h; no "Remember me": no partner screen offers it, FIRST-RELEASE §3), `POST /api/auth/sign-out`
  logged as `partner_user.signed_out`, and `me` null for a missing, expired, suspended-user or
  closed-partner session, as for an unknown one. **Sign-in, built on #156**
  (`apis/platform/auth.ts`): `POST /api/auth/sign-in` answers `INVALID_CREDENTIALS`
  byte for byte the same for an unknown email and a wrong password, after the same three
  password derivations whatever the email (decoys make up the count); the same email may hold
  an account under up to three partners (a trigger refuses a fourth, so no account is ever
  beyond what sign-in checks), and the password decides which (the most recently used first
  when two match). A password alone opens a session at stage `second-factor` (a user with
  2-factor) or `enrol` (one whose partner requires it), good for 10 minutes and for nothing but
  `second-factor` or `enrol-second-factor`. TOTP (RFC 6238, SHA-1, 30 s, 6 digits) accepts one
  step of drift; a code up to five minutes old or already used is `CODE_EXPIRED` and not
  counted; every wrong or stale code is logged as `partner_user.second_factor_refused`, which
  the partner sees; five wrong codes lock the account for 15 minutes (`LOCKED`, with minutes, even for
  a right code), log `partner_user.sign_in_locked` and queue the notice email. The secret is
  sealed with AES-256-GCM under `CREDENTIALS_KEK` (THIRD-PARTY-ACCESS §5); without the key the
  second-factor routes answer `NOT_CONNECTED`. Every route except sign-out takes an attempt per
  address, and sign-in one per typed email too (`RATE_LIMITED`). **Accepted on #207's review**:
  the per-email bucket is spent before the password is checked, so someone hammering an
  address can hold its owner off sign-in while they keep at it (10 attempts a minute, the
  minute after they stop). Counting only failures would let a correct guess through a spent
  bucket, which is what the limit is for; the lock after five wrong codes, the per-address
  limit and the activity log are what show and stop the attacker. `next` is replaced by
  `/dashboard` on the server unless it is a path on this host. **Invitations and password
  reset, built on #208** (`apis/platform/invitations.ts`): `POST /api/auth/invitation` reads an
  invitation by its token's hash and answers `INVITATION_USED`, `INVITATION_REPLACED` (revoked
  for a newer one), `INVITATION_EXPIRED` or `INVITATION_INVALID` (unknown, revoked, removed user,
  closed partner); `accept-invitation` takes a name (`NAME_REQUIRED` when blank) and a password
  of 10 characters or more (`WEAK_PASSWORD`), activates the account and opens an `enrol` session: step 2 of 2 either
  enrols or calls `skip-second-factor`, refused with `SECOND_FACTOR_REQUIRED` when the partner
  requires it. `request-password-reset` answers byte for byte the same for any email, takes an
  attempt per typed email, and does the same work for any email, so its timing reveals nothing
  either: one outbox row (`partner_password_reset.request`). The relay then writes a reset per
  active account the email has, once per request, each queued as an email with its activity
  entry; `reset-password` works once, within 30 minutes of the email being sent, and ends
  every session of that user (`RESET_INVALID` otherwise). Tokens are minted when the email is
  sent (`auth/partnerTokens.ts`), so none rests in the outbox. **Staff** sessions come from SSO on `admin.dripfunnel.com` and are **shorter than every
  other pool: idle 1 h, absolute 8 h** (decided 2026-10-01). A staff session is the one that
  can suspend a store and impersonate a merchant, so it is the most valuable to steal; 8
  hours still covers a working day. They **re-authenticate before dangerous actions**: suspend, refund, delete, open a support session, change a price (CONSOLE-DESIGN
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
The first release's answers (Manager stock but not warehouses, no "Publish now" for Managers,
Staff exports and a read-only offers and carts view, the whole store log for Managers) were
decided on #184 (ui/store/FIRST-RELEASE.md §1).

| Permission | Owner | Manager | Staff |
|---|:--:|:--:|:--:|
| `catalog.read`: products, versions, photos, collections, filters | ✓ | ✓ | ✓ |
| `catalog.write` | ✓ | ✓ | |
| `stock.read` | ✓ | ✓ | ✓ |
| `stock.write`: quantities in the merchant's own warehouses | ✓ | ✓ | |
| `warehouses.write`: the merchant's own warehouses (Settings › Warehouse) | ✓ | | |
| `orders.read`, `customers.read` | ✓ | ✓ | ✓ |
| `orders.write` (including fulfilment and cancellation), `customers.write` (add, edit, groups, tags, notes, recording that a customer asked to stop marketing) | ✓ | ✓ | ✓ |
| `orders.refund`: refunds, returns (start, mark received), and **overriding a supplier's refund** (§7.3) | ✓ | ✓ | |
| `orders.mark_paid`: marking a cash-on-delivery or bank-transfer order paid, audited with the actor (decided 2026-10-05) | ✓ | ✓ | |
| `customers.export`, `exports`: product and order exports. Staff's include orders with the customer's name and address, deliberately: Staff already reads and fulfils them (`orders.read`, `orders.write`) | ✓ | ✓ | ✓ |
| `catalog.import` | ✓ | ✓ | |
| `offers.read`, `carts.read`: the offers list and abandoned carts, view only | ✓ | ✓ | ✓ |
| `offers.write`, `carts.write`: offers, reminder settings, remind now | ✓ | ✓ | |
| `reports.read`, including `exportReport` of the panels it reads | ✓ | ✓ | |
| `offers.export`: `exportOfferCodes`, a batch's codes as a file; Staff reads offers but may not export their codes (decided 2026-10-05) | ✓ | ✓ | |
| `store.export`: `exportStoreData`, everything the store holds, for leaving or a data request | ✓ | | |
| `activity.read`: the whole store's activity log, shoppers included | ✓ | ✓ | |
| `activity.export`: that log as a CSV, with LOGGING §6's cap and expiry | ✓ | | |
| `payments.configure`, `shipping.configure`, `tax.configure` | ✓ | | |
| `support.allow_write`: Allow or Deny a support agent's write request inside an open session (§8) (decided 2026-10-05 on #337) | ✓ | ✓ | |

**Owner-only capabilities**, checked for the acting store; someone may be an Owner in one
store and a vendor in another:

| Capability | Covers |
|---|---|
| `invite` | People: invite, resend, revoke, change role, remove (flows 8–12) |
| `manage-vendors` | Create, invite, change tier, suspend, remove vendors (flows 14–17) |
| `approve` | The approval setting and queue (flows 18–19) |
| `publish` | Storefront: describe, preview, approve, publish, undo (flows 48–52) and catalogue **Publish now**; a Manager sees the Storefront read-only |
| `billing` | Plan, subscription, invoices, the subscription payment method (flows 59–64) |
| `settings` | Store info, payment, shipping and tax setup, custom domain, **Support access** (the On/Off switch; Allow/Deny is `support.allow_write`), and **Settings › Developers** (public store key, allowed origins, API keys, webhooks) and app installs |

A Manager reaching an Owner-only screen gets the designed permission-denied state (flow 67);
the resolver refuses regardless of the screen.

### 5.2 Vendor tiers

The merchant picks one **access level per supplier** (`seller.access_level`) and can change it
later (§7.5); it applies to every user of that supplier. The merchant also picks the supplier's
**shipping mode** (`seller.shipping_mode`, decided 2026-10-02): **`to-store`**, the supplier
sends its items to the store's default warehouse and the store ships to the shopper, or
**`to-shopper`**, the supplier ships its own lines itself. The mode decides what the order
permissions below reveal (§7.3); it never adds a permission. **Inside it, the supplier manages
its own team** with the team roles **Supplier admin** `supplier-admin` (the access level plus
inviting, changing and removing its own users) and **Supplier member** `supplier-member`
(the access level only) (decided 2026-10-02; the merchant may also add a person to a supplier
directly, SetTeam "Add a person"); the membership's `role_key` holds the team role
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
| `orders.fulfil`: their own sub-orders — ship to the shopper, or mark as sent to the store, by shipping mode | | | ✓ | |
| `orders.refund`: their own lines only, up to their value; never a return's start or an override (§7.3) | | | ✓ | |
| `sales.read`: Your sales (`mySales`), their own sold lines, no totals; never `reports.read` | | | ✓ | ✓ |
| `exports.products`: their own products and stock | ✓ | ✓ | ✓ | ✓ |
| `exports.orders`: their own order lines, masked as their screens are (no totals; customer fields by shipping mode, §7.3); only with `orders.read` | | | ✓ | ✓ |
| `catalog.import`: their own products (decided on #184) | | ✓ | ✓ | ✓ |
| Own activity (profile) | ✓ | ✓ | ✓ | ✓ |
| Offers, customers (beyond what §7.3 lets a `to-shopper` supplier see), payments, shipping, tax, people, vendors, billing, settings | never | never | never | never |

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

### 5.3 Partner roles (platform console) — decided 2026-10-01 on #109

Derived from USERS-AND-DOMAINS §4. A partner acts **on its own merchants only, at account
level**; it never reads a merchant's customers, orders or catalogue except in a support
session, and never sees another partner. **Confirmed 2026-10-01** against the DF Platform
prototype's permission table and ui/platform/README.md §2; the first release is
[../ui/platform/FIRST-RELEASE.md](../ui/platform/FIRST-RELEASE.md).

| Can | Owner | Admin | Support | Finance | Read-only |
|---|:--:|:--:|:--:|:--:|:--:|
| See merchant accounts, plans, billing status, domain, provisioning, publishing status, usage | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create a merchant (Owner invitation) | ✓ | ✓ | | | |
| Change a merchant's plan, price, limits, entitlements ("Publish now" allowance), trial | ✓ | ✓ | | ✓ *(trial and billing fields only)* | |
| Suspend and restore a merchant **(confirmed 2026-09-30)** | ✓ | ✓ | | | |
| Open a read-only **support session** (§8) | ✓ | ✓ | ✓ | | |
| Request write elevation inside a support session | ✓ | ✓ | ✓ | | |
| Branding, portal host, preview and shop domains, email sender domain | ✓ | ✓ | | | |
| Plans and prices offered to merchants | ✓ | ✓ | | ✓ *(prices only)* | |
| The partner's own billing with DripFunnel: invoices, payment method, payouts | ✓ | view | | ✓ | view |
| Partner users: invite, change role, remove | ✓ | ✓ *(not Owners)* | | | |
| Require 2-factor for the whole team (Settings › Security) | ✓ | | | | |
| Close or offboard the partner, transfer partner ownership | ✓ | | | | |

The last Owner of a partner can't be removed or demoted, as for merchants and staff.

**Permission names** (decided 2026-10-01 on #109), one per screen need in
ui/platform/FIRST-RELEASE.md, the way the staff set was derived on #14, and matching the
prototype's own permission table. Every one is scoped to the caller's own partner by the
session; `partner.read` is what every role holds. **Built on #155** as fixed sets per role in
`auth/partnerPermissions.ts`, held to this table row for row by `partnerPermissions.test.ts`.

| Permission | Screen (FIRST-RELEASE) | Owner | Admin | Support | Finance | Read-only |
|---|---|:--:|:--:|:--:|:--:|:--:|
| `partner.read`: dashboard, stores, plans, branding, domains, reports, activity log, settings | every screen | ✓ | ✓ | ✓ | ✓ | ✓ |
| `onboarding.submit` (submit, run the test signup) | §4 | ✓ | ✓ | | | |
| `branding.write` (look, words, emails, publish, schedule, roll back) | §8 | ✓ | ✓ | | | |
| `domains.write` (add or change a hostname) | §9 | ✓ | ✓ | | | |
| `domains.recheck` | §9, §6.3 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `plans.write` (plans, defaults for new stores) | §7 | ✓ | ✓ | | | |
| `plans.price` (prices only) | §7 | ✓ | ✓ | | ✓ | |
| `stores.create` | §6.2 | ✓ | ✓ | | | |
| `stores.plan` (change plan, limit overrides) | §6.4 | ✓ | ✓ | | | |
| `stores.trial` | §6.4 | ✓ | ✓ | | ✓ | |
| `stores.suspend` (suspend and restore) | §6.4 | ✓ | ✓ | | | |
| `stores.invite.resend` | §6.4 | ✓ | ✓ | | | |
| `setup.retry` (retry a stuck signup step) | §6.3, §5 | ✓ | ✓ | | | |
| `stores.billingStatus` (only when the partner bills its merchants) | §6.1, §6.3 | ✓ | ✓ | | ✓ | |
| `billing.read` (payments, payouts, invoices, settings) | §11 | ✓ | ✓ | | ✓ | ✓ |
| `billing.write` (who bills the merchants) | §11.4 | ✓ | | | ✓ | |
| `payout.write`, `card.write` (payout account, payment method) | §14.3 | ✓ | | | ✓ | |
| `support.session` (start, return to, end own; request write elevation) | §12 | ✓ | ✓ | ✓ | | |
| `exports` (stores, reports) | §6.1, §10 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `activity.export` (the activity CSV, and reading an export back; LOGGING §6) | §13 | ✓ | ✓ | | | |
| `team.manage` (invite, change role, remove; never an Owner unless the caller is one) | §14.2 | ✓ | ✓ | | | |
| `team.transfer` | §14.2 | ✓ | | | | |
| `security.manage` (the 2-factor switch) | §14.4 | ✓ | | | | |

The Billing menu is absent for Support and the Support menu for Finance and Read-only
(FIRST-RELEASE §2.1): a role with no permission on a whole screen does not see its row,
while a control inside a screen it can see is disabled with the reason (ui/README.md §5).

### 5.4 Staff roles (admin console)

From CONSOLE-DESIGN §4. A control a role can't use is visible and disabled with the reason
("Finance can issue refunds"). Destructive actions may require a **second approver**
*(ask which, CONSOLE-DESIGN O3)*.

| Staff role | Can |
|---|---|
| **Super admin** | Everything, including staff management, platform settings and deleting. At least two people; never a shared account. The last Super admin can't be removed or demoted (O2). |
| **Partner manager** | Create, approve and configure partners, their plans and prices, including the whole onboarding through a setup session (§8.2); see their partners' stores and billing. Acts **only on the partners a Super admin assigned to them** (below), and sees nothing of the others. |
| **Support** | Search everything; see store detail; **impersonate** any partner or store user (§8.1); retry failed jobs; resend emails. No billing changes, no suspensions, no setup sessions (§8.2). |
| **Finance** | Billing, invoices, credits, refunds, dunning, revenue reports. No store configuration. |
| **Engineer on call** | Jobs, fleet, builds, domains, integration health; suspend a store in an emergency. |
| **Read-only** | Sees partners, stores, customers (masked) and the activity log; changes nothing. No Provisioning menu and no full contact details (FIRST-RELEASE §2, §5.4; corrected on #14 from "everything Support sees"). |

**Permissions (decided on #14).** One per screen need in [FIRST-RELEASE](../ui/admin/FIRST-RELEASE.md);
the sets live in `apps/api/src/auth/permissions.ts` and are tested against this table.
SA Super admin, PM Partner manager, Su Support, Fi Finance, En Engineer on call, RO Read-only.

| Permission | SA | PM | Su | Fi | En | RO |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| `partners.read`, `stores.read`, `customers.read` (masked), `activity.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `customers.contact.read` (full email and phone on a customer's page) | ✓ | | ✓ | | | |
| `partners.create`, `partners.approve` (and send back), `partners.setup` (setup session), `partners.invite` | ✓ | ✓ | | | | |
| `partners.invite.resend` | ✓ | ✓ | ✓ | | | |
| `partners.pause` (and resume) | ✓ | | | | | |
| `stores.suspend` | ✓ | | | | ✓ | |
| `stores.restore`, `stores.trial.extend` | ✓ | | | | | |
| `stores.invite.resend` | ✓ | | ✓ | | | |
| `stores.notes.write` | ✓ | ✓ | ✓ | | ✓ | |
| `domains.recheck` | ✓ | | | | ✓ | |
| `provisioning.read`, `provisioning.retry` | ✓ | | ✓ | | ✓ | |
| `provisioning.undo` | ✓ | | | | ✓ | |
| `impersonate` (start, return to, end and extend your own, §8.1) | ✓ | | ✓ | | | |
| `setupSessions.read` | ✓ | ✓ | ✓ | | | |
| `staffSessions.endAny` (end someone else's session) | ✓ | | | | | |
| `activity.export` | ✓ | | | | ✓ | |
| `staff.manage` | ✓ | | | | | |
| `partners.assign` (assign and unassign a Partner manager, #60) | ✓ | | | | | |

| Decision (#14) | Rejected | Why |
|---|---|---|
| Finance holds Read-only's set in this release | Billing permissions now | Billing is out of the first release (FIRST-RELEASE §11 H); no screen needs them. |
| A Partner manager acts only on partners assigned in `staff_partner_assignment` (DATA-MODEL §3.1); a field with a `target` refuses an unassigned or unknown one with `FORBIDDEN` | Every partner | "Their partners" in CONSOLE-DESIGN §4 and the admin README. Lists (`target: 'none'`) must filter to the assignment themselves. Assignments are written by `assignPartnerManager` and `unassignPartnerManager` (#60). |
| `domains.recheck` for Super admin and Engineer on call | Every role that sees the tab | The admin README gives domains to those two and "view" to the rest. |

**How a partner becomes a manager's** (decided 2026-10-02 on #60):

| Question | Answer |
|---|---|
| Who assigns | **Super admin only** (`partners.assign`), with a reason, audited. A manager never takes a partner for themselves. |
| How many managers | **Any number**, usually one plus one as cover; a partner with none is Super admins' alone. |
| The manager is away | A **Super admin always may act**; steady cover is a second assigned manager. No "away" state. |
| The manager leaves | `removeStaff` (#39) **refuses `HOLDS_PARTNERS`** while a live assignment names them; a Super admin unassigns or reassigns first. Nothing is reassigned silently. |
| A partner that is not theirs | **Invisible**: lists filter to the assignment, `partner(id)` and every targeted field refuse `FORBIDDEN`. Seeing every partner is Support's and Read-only's job, not this role's. |
| Approvals | Scoped like everything else. When a Partner manager ran the setup, the second approver is a Super admin or the partner's **other assigned manager**. |

An assignment is never deleted: unassigning sets `removed_at` and who, so the history stays
with the row and `isAssigned` reads only live rows.

Staff have **account-level** access to every partner and merchant through the Admin API
(a Partner manager to its assigned partners),
and **read-only access to customer accounts** across every store (decided 2026-09-28;
masked contact details in lists, full on the detail page for Super admin and Support
(confirmed 2026-09-30), each detail view logged; never addresses, order contents or payment
details). Inside
a store they act only by impersonating a user (§8.1: Super admin and Support); inside a
partner console, by impersonating a partner user, or through a setup session for onboarding
(§8.2: Super admin and Partner manager). **Staff never open a support session** —
that is a partner capability (§8). Every staff write is audited (§10).

### 5.5 Never in any merchant or vendor role

Rewritten from the first platform's list of framework permissions as engine rules. Each has a structural
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
  Scopes can't exceed the creator's role when created; when its creator leaves or is demoted the key
  **keeps working** (it belongs to the store); the Owner is notified and the list shows the creator
  as gone (decided 2026-10-05 on #337). This is accepted because only an Owner creates keys and
  a vendor-bound key is re-capped on every request to the supplier's current tier, so it never
  outlives a narrowed tier, and stops with a removed or suspended supplier (§7.5).
- **Vendors' own keys: later** (decided 2026-09-28). Until then only the merchant's Owner
  creates a vendor-bound key; when they come, a Supplier admin creates them within the
  supplier's access level.
- **App grants** are per store, with the scopes the merchant approved at install, revocable on
  uninstall; the app runs out of process and reaches the Store API like any other caller.
- Creating, rotating and revoking keys, and installing and uninstalling apps, are audited.
- **Webhook and key rules as drawn** (`SetDev`, #286; *proposed* for SAPI 20 to confirm): a rotated key's old secret keeps working for **24 hours**; an endpoint failing for **3 days** is disabled automatically and the Owner told; events for a disabled endpoint are kept **7 days** for replay.

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
- **Revoke** sets the invitation `revoked`; the `invited` account is kept, never deleted
  (a store's, built on #290, stays `invited`; **a partner team's, built on #199**, is marked `removed`), since the activity log names it; inviting the address again
  invites that account anew. Partner invitations and resends are throttled: 20 an hour per
  inviter and 3 a day per address (`RATE_LIMITED`).
- **Staff invitations** (admin console) work the same way, except that accepting binds the
  invitee's company SSO account instead of setting a password (ui/admin/FIRST-RELEASE.md §10). **Built on #39**: the email's link is `/api/auth/accept-invitation?token=…`, which starts
  SSO with the token's hash in the handshake cookie; the callback binds the SSO account only
  when its email is the invited address and the invitation is still open (else the sign-in is
  refused like any other), activates the member and signs them in. The last accepted Super
  admin can't be demoted or removed, checked under a lock so two demotions at once can't both
  pass (`LAST_SUPER_ADMIN`); removing a member ends their sessions.
- **Expiry**: 7 days for merchant and vendor invitations (decided 2026-10-05 on #337), the same as platform staff
  invitations (#45). Pending invitations show their expiry; expired ones are
  obvious and offer resend (flow 10).
- **Already a member here** is the only error, and it reveals nothing the Owner can't already
  see in their own People list.
- **Change role** writes the membership's `role_key`; it applies on the next request.
- **Removing someone** (flow 12) removes the membership for this store only: it stays as a
  `removed` row the activity log names (built on #290), and the account is never deleted by a
  removal, whether or not they belong elsewhere (erasing a person is an erasure request's, LOGGING.md §8).
  Their open requests in this store fail on the next request.
- **Owner invariant**: refuse to remove or demote the last active Owner of a store.
- **Merchant People, built on #290** (`apis/store/people.ts`, Settings › People, Owner only through
  `invite`, every statement in the acting store's scope): `people` (active merchant members and open
  invitations, cursor-paged; supplier users are SAPI 5's) and `peopleCounts`; `inviteMember` (Owner,
  Manager or Staff; "already a member here" the only refusal about the person, checked first; the
  account found or made `invited` by `store_invitee`, migrations/0040, the same call whether or not it
  exists; the plan's `staff` limit counts Managers and Staff, active or invited, never an Owner);
  `resendInvitation` (a new link revokes the old) and `revokeInvitation`; `changeRole` and
  `removeMember`, the last Owner kept under a lock (`LAST_OWNER`). Invitations are capped at 20 an
  hour per inviter and 3 a day per address in the store. A removed membership stays as `removed`
  (requests never delete), and a revoked invitation's `invited` account is kept, as the partner team
  keeps its rows (#199).

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
- A **Stock only** vendor may **propose** new products, which the merchant approves; it changes
  nothing else, and the merchant may also assign products to it (decided 2026-10-05 on #337).

### 7.2 Approval is a per-store setting

`store.vendor_products_require_approval` (Owner, `approve`):

- **Off**: a vendor's product is created visible and reaches the storefront at the next
  publish.
- **On**: the engine creates it hidden with `approval_status = 'pending'`, whatever the vendor
  sent. The queue lists `pending`; approving sets `approved` and makes it visible; rejecting
  records a reason the vendor sees.
- Vendor input can't carry visibility or `approval_status` (§3.2).
- **Editing an approved product** (decided 2026-10-02): it goes back to `pending`, and is
  **hidden from the storefront until approved**, only when the vendor changed its **name, a
  price (the product's or a version's) or its photo set**. Any other edit goes live at the
  next publish. The engine compares the three against the approved values on save; the
  portal says which change needs approval. Accepted with the decision: a vendor can take its
  own product off sale by editing one of those fields, which the Owner sees in the queue and
  the activity log.

### 7.3 Orders: vendor sub-orders

The engine owns orders, so an order is split into **per-vendor sub-orders** with their own
lines, fulfilment and (later) payouts (PLATFORM-PROMPT §3.3, §5.4). This replaces the
first platform's constructed view.

- **Read** (`vendor-orders-read`, `vendor-orders-fulfil`): the vendor lists its own sub-orders
  through the scoped layer. **A vendor never sees an order total**: shipping, discounts and tax
  that span vendors can't honestly be attributed to one. Show their lines and line amounts;
  whether a sub-order carries its own attributable totals is part of the order design.
- **Fulfil** (`vendor-orders-fulfil`) follows the **shipping mode stored on the order part**
  (`order_part.shipping_mode`, copied from the supplier's `seller.shipping_mode` at placement;
  §5.2, decided 2026-10-02). An order keeps the mode it was placed under: changing a
  supplier's mode (`supplier.shipping_mode_changed`) applies to orders placed afterwards, and
  open orders ship, show the customer and take returns as they did when placed, which the
  Supplier tab says before the change. **`to-shopper`**: the vendor ships lines of its own sub-orders from its own
  warehouses, booking a courier or entering tracking. **`to-store`**: the vendor marks its lines
  as **sent to the store's default warehouse**, and the store ships the order; the sub-order's
  fulfilment is the store's. In both, every line and warehouse must carry the caller's
  `seller_id`. Still the highest-risk vendor write; it gets explicit tests even though the
  scoped layer filters it.
- **Customer data**, applied in the serializer and never in the UI (PLATFORM-PROMPT §5.4),
  **by the part's stored mode**: a **`to-store`** part shows the supplier **nothing** of the
  customer, not even a name; the order shows "For <store>". A **`to-shopper`** part shows
  **name and delivery address, never email or phone**. The merchant's order view says which
  mode each part is in. The isolation matrix includes a supplier switched from `to-store` to
  `to-shopper` still seeing nothing on the orders placed before the switch.
- **Returns and refunds** (decided 2026-10-02; the prototype's `PortalOrders` decides the
  screens). A **return** is started by the store (`orders.refund`), per line and quantity, with
  a reason; the shopper gets a return label; items come back to the store's default warehouse
  (`to-store` lines and the merchant's own) or to the supplier's warehouse (`to-shopper`
  lines). States `requested → received → refunded`, with `cancelled` while still requested.
  Marking received is the store's. **Refunds are per line and grouped by owner**: the store
  refunds its own lines; **each supplier refunds its own lines**, up to their value, and the
  store is told. **The store may refund a supplier's lines itself**: that is an **override**,
  recorded against the supplier in the **supplier ledger** with the amount, and the supplier is
  told. Restocking a refund writes a stock movement "Returned". Stock-only suppliers have no
  orders and so never refund. **The ledger is settled outside the platform** for now; payouts
  inside it are later (PLATFORM-PROMPT §5.4 Payments). A refund of a shared shipping charge or
  discount is the store's alone.

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
- **Suspend** (decided 2026-10-02 on #186's review, recorded on #182): the vendor's memberships stop resolving and its API keys
  stop working. The Owner chooses, in the suspend dialog, whether the vendor's products are
  **hidden while it is suspended** (`seller.hide_products_while_suspended`) or **keep
  selling** from the stock in hand; hidden products return to the status they had when the
  merchant resumes it. Each product keeps its `seller_id`.
- **Remove** (decided 2026-10-02): its users lose access at once; its products are **hidden
  and kept**, still marked as the removed supplier's, for the merchant to publish (they then
  become the merchant's to maintain) or delete. The portal says the count and offers the
  hidden list; the activity log records the removal and the products it hid.
- **One role per membership** (decided 2026-09-28): one merchant-side membership per person
  per store, and one per supplier. A person **may work for two suppliers in the same store**
  (two memberships, and the store chooser lists "Store · Supplier"), but is **never both the
  merchant's staff and a supplier in the same store** (DATA-MODEL.md §3.3).

---

## 8. Support access sessions

From USERS-AND-DOMAINS §4.1 (decided) and CONSOLE-DESIGN part J. **Partner users** open a
merchant's portal for support **only** through a support session; there is no other way into a
store's data for them. **Staff never use one** (decided 2026-09-30): they impersonate (§8.1),
with the user's full access and a full audit trail. The Rules below already said this; the
opening sentence and the flow did not, and now do.

**The setting.** *Settings › Support access* in the portal: "Allow [partner name] support to
view my store: On / Off". **On by default**; the Owner (`settings`) can switch it off at any
time, which ends any open support session immediately. When it's off, support can only ask the
merchant to switch it on.

**Opening one:**

```
Partner console: store page → "Open support session"
   │  checks: the partner user's role allows it (§5.3); the store belongs to their partner;
   │          the store's setting is On; re-authentication (A2);
   │          a reason or ticket number
   ▼
support_session(store_id, partner_user_id, reason, access 'read',
                started_at, expires_at = +30 min, ended_at)  + audit row
   │  one-time handoff token, short-lived, single use
   ▼
Browser → https://<store's portal host>/support/enter?token=…
   → Store API exchanges it for a support cookie on that host (separate from any person session)
   → TenantContext { caller: support, sellerScope: all, permissions: support read set }
```

**Rules:**

- **Read-only** by default: the support read set is the Owner's read permissions, minus
  anything credential-shaped (credentials are never readable anyway, §5.5).
- **Time-limited**: 30 minutes (decided 2026-10-05 on #337), no silent extension; a new session needs
  a new reason.
- **Visible**: while it is open, every person signed in to that store sees a banner: "[Partner]
  support (Priya) is viewing your store. Read-only. Ends in 28 min." The support agent sees an
  unremovable bar naming the store, their role and the time left (J3). Staff don't use
  support sessions; their impersonation banner says "Support", never "DripFunnel" (§8.1).
- **Logged**: every session appears in the store's *Support access log* (who, when, why, how
  long) and in the platform audit log; the store's Owners are emailed when one starts (decided 2026-10-05 on #337).
  Every read in the session is attributed to the real agent, not to the merchant.
- **Write elevation**: support requests write access; the merchant clicks "Allow" or "Deny";
  the elevation applies to that one session and is logged. **An Owner or a Manager** may allow it
  (`support.allow_write`, §5.1) (decided 2026-10-05 on #337). It only exists inside a session the Owner's On/Off
  switch let start; a Manager's Allow emails the Owners like a session start does.
- **Never, even elevated**: change passwords or sign-in methods, payment methods, payouts,
  ownership or roles; create API keys or install apps. A support session is not a person, so it
  can't act as one.
- **Staff don't use support sessions**: they impersonate (§8.1).
- A partner's support session never reaches a store of another partner; the host check (§9
  check 0) and the partner check at opening both refuse it.

**Built on #202** (the Platform API half; ui/platform/FIRST-RELEASE.md §16 lists the fields):
the session is on one **membership**, so the agent acts as that user ("Priya as Jenna", §12 of
the console's FIRST-RELEASE), one agent per user and one session per agent at a time;
re-authentication (A2) is the partner user's 2-factor code, which buys a proof valid five
minutes and spent by the one start it allows; the agent, or the partner's Owner or Admin, may
end a session. Returning to a session mints a fresh link only while a start would still be
allowed (support on, store not cancelled, user not suspended). Elevation, the exchange and the
support caller stay with the Store strand; the exchange spends a link only while the start's
codes still allow a session.

### 8.1 Staff impersonation (decided 2026-09-28, USERS-AND-DOMAINS §4.2)

Staff sign in **as a specific user** with that user's full permissions. It is the only way
staff act inside a store or a partner console.

- **Targets**: any `partner_user`, and any store user (`user` with a membership: Owner,
  Manager, Staff, supplier admin or member). Never a `staff_user`, never a `customer`.
- **Who**: `staff-super-admin` and `staff-support` only. Re-authentication (A2) and a reason
  or ticket are required. **No consent check**: the store's Support access setting doesn't
  apply.
- **Access**: the target's own permissions in full, including writes. For a store user,
  within the membership chosen (one store, and one supplier where relevant).
- **Flow**:

```
Admin console: Impersonate → pick a user (and, for a store user, which membership)
   │  checks: staff role; re-auth; reason
   ▼
impersonation(staff_user_id, target_kind, target_id, membership_id NULL, reason,
              started_at, expires_at = +30 min, ended_at)  + activity entry
   │  one-time handoff token, short-lived, single use
   ▼
Browser → target's host: the partner console (platform.dripfunnel.com) or the store's
          portal host → /impersonate/enter?token=…
   → the host's API exchanges it for an impersonation cookie (separate from any real session)
   → PartnerContext, or TenantContext, built from the target exactly as for the real user,
     with caller { kind: 'impersonation', staffId, targetId, impersonationId }
```

- **Visible** on the impersonated side (a banner to everyone signed in to that store or
  partner console) and to the staff member (an unremovable bar with the time left).
- **Logged**: every entry has the target as `actor` and the staff member as `on_behalf_of`,
  with the impersonation id (LOGGING.md §4). Starting and ending are entries too.
- **Ends** at 30 minutes, when the staff member ends it, or when the target's account or
  membership is suspended or removed. **Extendable once, by 30 minutes** (decided
  2026-09-30), logged as its own entry; beyond that a staff member starts a new session,
  which carries a new reason.
- Only **active** users can be impersonated (not invited-but-not-accepted, not suspended),
  and a staff member has **one open impersonation at a time** (decided 2026-10-01, #46); the
  console offers to return to the open one, or to end it first.
- **Ending and extending** (decided 2026-10-01, #46): the staff member who started it or any
  Super admin may end it; only the staff member who started it may extend it.
- **Blocked even while impersonating** (decided 2026-09-28): changing the user's password, 2-factor or sign-in methods, payment or payout details, or ownership (transferring the store or partner, or changing the Owner); in the partner console, also the user's support access to a merchant (decided on #243, §8.3). These resolvers
  refuse any `impersonation` caller with a clear message ("Only Priya can change this"),
  and a structural test lists them.
- The banner says **"Support"**, never "DripFunnel" (white label). Partners' and
  merchants' terms disclose staff impersonation (wording by legal).
- **Built on #40** (the Admin API half): the `impersonation` row, 30 minutes from start, one
  extension of 30 set on the row, one open per staff member at the index, the hashed one-time
  handoff (five minutes, a return mints a fresh one and the old stops working), and the
  entries `impersonation.started`, `.extended`, `.ended` (staff as the actor, the impersonation
  in `access_ref`). Supplier users wait for the Store strand's `app_supplier`
  (`SUPPLIER_NOT_SUPPORTED`). In the partner console, the exchange, the `impersonation` caller
  and the blocked list's structural test are built on #243 (§8.3). The store portal's half waits
  for the Store API.

### 8.2 Staff setup session (decided 2026-09-29, USERS-AND-DOMAINS §3)

For staff doing a partner's onboarding, or any part of it, when the partner needs help.
Impersonation (§8.1) can't do this: it needs an active partner user, and a partner being set
up by DripFunnel may have none yet because the Owner's invitation is held or not accepted.

- **Who**: Super admin and Partner manager. **Not Support** (confirmed 2026-09-30): a setup
  session can set the partner's plans and prices, which §5.4 keeps with Partner manager and
  which Support's "no billing changes" excludes. Support uses impersonation (§8.1) instead.
  Started from the partner's page in the admin
  console, with a reason or ticket and re-authentication.
- **Where**: the real partner console on `platform.dripfunnel.com`, on the same screens the
  partner uses, through a one-time handoff exactly as in §8.1. The session is recorded as
  `partner_setup_session(staff_user_id, partner_id, reason, started_at, expires_at = +2 h,
  ended_at)`. The caller is `{ kind: 'staff_setup', staffId, partnerId, setupSessionId }`.
  It acts as staff, never as a partner user.
- **Access**: everything the partner's Owner can do in the console (the checklist, look,
  words, domains, email sender, plans and prices, legal pages, test merchant signup, and
  **Submit for approval**), in any state except Closed. **Blocked**: the partner's payment
  method and payout details, changing the Owner or ownership, and a partner user's support
  access to a merchant (decided on #243, §8.3). These resolvers refuse a `staff_setup` caller
  with "The partner enters this itself", and a structural test lists them. Staff may invite
  partner users (the Owner and others).
- **Visible**: a bar for the staff member with the partner's name and the time left; a
  banner to any partner user signed in at the same time ("DripFunnel is setting up your
  console: Priya, until 16:30"). The partner is DripFunnel's own customer, so the banner
  names DripFunnel. Checklist items show who completed them.
- **Logged**: every entry has the staff member as `actor` and the setup session id in
  `access_ref` (LOGGING.md §4); starting and ending are entries too, on both the partner's and the
  platform's activity log.
- **Ends** after 2 hours (confirmed 2026-09-30), when the staff member ends it, or when the
  partner is closed. **Not extendable** — two hours is already the longest session on the
  platform; more means a new one, with a new reason. One open setup session per staff member
  at a time; a second attempt is refused rather than ending the first. The staff member who
  started it or any Super admin may end it (decided 2026-10-01, #46).

### 8.3 The staff-session contract (decided 2026-10-01 on #46, for #40)

Between the admin console, the Admin API and the two portals, for both kinds of session.

- **Refusals** from the Admin API, as stable codes the console words: `STAFF_ROLE_NOT_ALLOWED`,
  `TARGET_NOT_ACTIVE`, `PARTNER_CLOSED`, `IMPERSONATION_ALREADY_OPEN`,
  `SETUP_SESSION_ALREADY_OPEN`, `IMPERSONATION_ALREADY_EXTENDED`,
  `SETUP_SESSION_NOT_EXTENDABLE`, `NOT_SESSION_OWNER`, `REASON_REQUIRED`, `REAUTH_REQUIRED`,
  `SESSION_ENDED`, `SESSION_EXPIRED`, `NOT_FOUND`.
- **In the portals**: a blocked resolver (§8.1, §8.2) refuses with
  `BLOCKED_WHILE_IMPERSONATING` or `PARTNER_ENTERS_THIS_ITSELF`; a spent, expired or unknown
  handoff with `HANDOFF_INVALID`, shown as "This link no longer works".
- **Each session record** says what the caller may do to it (`end`, `extend`, `return`),
  allowed or refused with one of the codes above; the console never works it out.
- **The handoff token** is single use and exists only in the link that opens the portal:
  never on a session record, in a page or in a log. The portal drops it from the address bar
  as it exchanges it. Returning to an open session asks for a fresh link.
- **Sync** comes from the server, never from browser storage. The portal reads its session and
  the member notice every 15 seconds and whenever the tab regains focus, and counts down
  locally from `expiresAt`; the console's strip and Sessions list read the same way. An end
  on either side shows on the other at its next read.
- **Who sees which**: Super admin and Support see both kinds. A Partner manager sees setup
  sessions only, by their page, with no Impersonate menu, Users list or Sessions list.
- **Built on #243** (the partner console's half, for a partner user's impersonation and a setup
  session):
  - **The exchange.** The console's `/impersonate/enter` page posts the token, in the body, to
    `POST /api/auth/handoff`. That spends it once and sets `__Host-df_platform_staff`, a cookie
    of its own beside any partner user's. Only the cookie's hash is kept, on the session's row.
    A return's fresh link replaces it.
  - **The routes.** `POST /api/auth/staff-session` answers the cookie's session, open or how it
    ended. `POST /api/auth/end-staff-session` ends it from the console, logs `.ended` with the
    staff member as actor. The cookie stays, acting as nobody, so the console can say how the
    session ended. Signing out of the console ends it the same way, and an end that ends nothing
    answers `SESSION_NOT_ENDED`. Both routes sit outside the sign-in bucket, since the console
    polls them. One poll every 15 s serves all of a browser's tabs (shared over a
    BroadcastChannel, `shared/ui/sharedSessionReads.ts`); a hidden tab doesn't poll; and once the
    answer is "no session" the console stops asking until a tab enters or ends one. A read in flight
    when a session starts or ends is dropped, and signing in or out clears every tab's answers. A request
    without a staff cookie reads nothing. One with it counts against
    `STAFF_SESSION_RATE_LIMITER` (120 a minute per address, enough for many tabs). The console
    keeps its last answer when it's refused.
  - **The two callers.** An impersonation resolves to the user acted as, with `staff` beside it,
    and runs with their role, `app.user_id` and `app.impersonation_id`. A setup session has no
    user and runs with the Owner's role. It is no team member, so it never transfers ownership.
  - **The member notice.** `staffSessionNotice` tells the partner's own users who is in their
    console. It names an impersonation of one of them before any setup session. A staff member
    sees their own bar instead, and no setup banner.
  - **Ends.** Every read ends a session whose partner has closed (`partner_closed`), or whose
    user is no longer active (`target_gone`). It logs `.ended` with `job` as the actor and the
    code as the reason. An export a staff session starts is built in that
    session's own scope.
  - **The blocked lists** are declared on each field (`blockedFor`), and the policy refuses them
    before it looks at the role. Both kinds are refused `transferOwnership` and the merchant
    support area: `supportTargets`, `supportSessions`, `mySupportSession`, `reauthenticate`,
    `startSupportSession`, `returnToSupportSession` and `endSupportSession`. Support access is a
    partner user's own, proved with their own second factor; staff impersonate the store user
    instead (decided on #243). An impersonation is also refused `setSecondFactorPolicy`, how the
    whole team signs in, which a setup session (the Owner's powers) may set (decided on #193). In the team service, inviting an Owner, changing a role to or from
    Owner, or removing an Owner refuses both kinds with their codes.
  - **Not yet.** The password, second factor and sign-in methods are `/api/auth/*` routes that
    read only a partner user's cookie, so no staff session reaches them. Payment method and
    payout details declare `blockedFor` when billing arrives (#201).

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
   line and warehouse in a fulfilment or a refund.
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
layer and a real Postgres (the local one, a fresh database per run — docs/api/README.md §7),
never a mocked data layer.

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
- a partner user gets nothing from the Store API outside a support session, and a staff
  member nothing outside an impersonation (§8.1) — a staff caller presenting a support
  session is itself a failure;
- the Staff-in-A / vendor-in-B person leaks neither way (§9).

**Rows added with DATA-MODEL.md §7 (2026-10-02, #187)**, each a test the engine card that
builds the table must ship:

- two suppliers in one store, each reading its own products and every child row (options,
  prices and price history, per-market prices, photos, compliance, specs, FAQs, filter
  assignments, badges, translations), stock levels and movements, fulfilment lines, return
  lines, refunds and ledger entries, and seeing nothing of the other's, counts and search
  included (DATA-MODEL §7.1, §7.11);
- a supplier's view of orders and returns: a `to-store` supplier's search and count by a
  shopper's email return nothing; a `to-shopper` supplier sees the name and shipping address
  of its own parts and no total; `app_supplier` selecting from `"order"` or `"return"`
  directly is refused by the grant, and the views return only the columns DATA-MODEL §7.11
  lists; a supplier switched `to-store → to-shopper` still sees nothing on orders placed
  before the switch; a `to-store` supplier never reads the store's onward shipment of its
  lines (`fulfilment` with a null owner); `app_supplier` selecting an `*_amount`, tax rate or
  zone column of `order_line` is refused by the grant, and `order_line_for_supplier` returns
  its own lines' unit and line amounts with the currency and never a discount, tax or total
  (§7.3; DATA-MODEL §7.6, §7.11);
- a supplier reading its own refunds never receives `by_user_id`, an override's `note`, a
  return's `note` or a ledger entry's `note` (DATA-MODEL §7.6, §5.3);
- a shopper reads only visible catalogue rows and never a cost, a stock movement, a refund,
  a ledger entry or a job (DATA-MODEL §7.11 shop branches);
- a supplier reads only the labels it printed for its own parts, never an invoice or packing
  slip (`order_document`); a partner or staff query on `import_job` or `export_job` returns
  nothing (DATA-MODEL §7.10, §7.11);
- a supplier reads the settings rows §7.11 names (`filter`, `filter_value`, `tax_class`,
  `store_language`, `store_currency`, `store_feature`, `badge`, `market` without duties and
  domain) and no other settings table, no `tax_rate`, and no `*_enc` column;
- two guests in one store, each reading only the cart and order whose token it presents,
  snapshots included, and only its own data request; a Shop API query can never return
  `product_version.cost_amount` (DATA-MODEL §7.11);
- a partner-scope or platform-scope query on `design_version` or `ai_run` returns metering
  columns and never a prompt, summary, preview or gate result (DATA-MODEL §7.11);
- a shopper selecting an `asset` by id gets a product photo of a visible product and never an
  invoice, label, export or import file (DATA-MODEL §7.11);
- user A, holding user B's id, can neither read nor write B's phone through the own-row
  functions, and an empty `app.user_id` returns and changes nothing (DATA-MODEL §2.1);
- a partner user reads no row of `user_backup_code` or `user_session` (DATA-MODEL §3.3);
- **supplier writes are refused where they must be**: `app_supplier` updating
  `order_line.unit_amount` or `quantity` on its own line, inserting or updating a
  `return_line` or a `"return"`, updating an `order_part`, or inserting a `refund` or
  `refund_line` directly, is refused by the grant; `supplier_refund()` refuses a line that is
  not its own, a quantity above the refundable one and an amount above its lines' value, and
  succeeds within them; inserting a `fulfilment` for its own part succeeds (DATA-MODEL §5.3);
- a guest inserting a cart whose `access_token_hash` is not the hash of the token it
  presented is refused, and so is an insert with no token presented at all
  (`current_order_token_hash()` returns null) (DATA-MODEL §7.11);
- a shopper filing a data request for another person's email can insert it only in the
  acting store, bound to the token minted for it, and cannot set `subject_verified_at`,
  `state`, `expires_at` or `file_asset_id` (the expiry is the column default, and a filer
  setting it is refused); a second filing for the same subject is accepted with the
  same response as the first (nothing reveals that a request exists) and the unverified ones
  expire; a code verifies only the request whose token accompanies it, so the victim's own
  code never fulfils the anonymous filer's request; a filer setting `requested_by`, `state`
  or an unknown `kind` is refused; no export is built until the engine verifies the code
  sent to that email; the filing token stops working at verification, and the file is
  reachable only by the signed-in customer or by the new token sent to the verified subject,
  so a hostile filer whose victim confirms still collects nothing (DATA-MODEL §7.5, §7.11);
- a shopper reads and writes `shopper_note` on its own cart and never reads `"order".notes`
  (DATA-MODEL §7.6);
- **shopper writes are bounded**: `app_shop` inserting an `order_line` or updating any
  `*_amount`, `state` or `payment_state` on `"order"` is refused; the same through the
  `app_definer` cart functions succeeds and writes the engine's figures; a shopper updating
  another shopper's `customer_address` is refused; a shopper updating a placed order's
  address, email or pickup flag is refused (`state = 'cart'` in `USING` and `WITH CHECK`); a
  shopper writing `currency`, `market_id` or `shipping_method_id` directly after a line was
  added is refused, and `cart_set_currency` reprices every line; a shopper inserting a cart
  with another customer's id, or with `state <> 'cart'`, is refused (DATA-MODEL §5.3, §7.11);
- the AI metering view returns partner A's stores to partner A and none of partner B's, every
  store to platform scope, and nothing in shop scope (DATA-MODEL §5.3).

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
- A test runs a query with the scoped layer bypassed and proves the database refuses another
  store's rows (DATA-MODEL §5.4).

Playwright covers a small set of journeys: sign-in, store switching, accept-invitation (new
and existing account), and a support session with its banner.

---

## 12. Lessons from the first platform

The first platform's design was shaped by its commerce framework's limits (AUTH-PLAN §2, §6). The workarounds are gone
(PLATFORM-PROMPT §3.1); the lessons they taught are product rules here.

- **Unscoped list queries leak.** The framework's administrator, seller and tax-rate lists
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
- ~~**Who may mark an order paid?**~~ **Owner and Manager** (decided 2026-10-05, §5.1).
- ~~**May Staff export an offer's codes?**~~ **No: Owner and Manager** (decided 2026-10-05, §5.1).
- ~~**2-factor**: Owners only, or everyone?~~ **Settled 2026-10-02**: required for Owners,
  optional for everyone else (§2, §4). ~~And for partner users?~~ **Partner users settled
  2026-10-01**: optional, the Owner may require it (§2).
- ~~**Does editing an approved vendor product send it back to `pending`?**~~ **Settled
  2026-10-02**: only for name, price or photo changes, hidden until approved (§7.2).
- ~~**What may a vendor see of a customer?**~~ **Settled 2026-10-02**: by shipping mode;
  nothing, or name and delivery address (§7.3).
- ~~**What happens to a removed or suspended vendor's products?**~~ **Settled 2026-10-02**: removed → hidden and kept; suspended → the Owner chooses (§7.5).
- ~~**Refunds, returns and cancellations across vendors**: first release or later?~~ **Designed
  2026-10-02** (§7.3); whether they are in the first release is ui/store/FIRST-RELEASE.md's (written on #184: all of it ships, §1)
  (#184).
- ~~Can someone be a vendor and merchant staff in the same store?~~ **Settled 2026-09-28**: never
  both in the same store (DATA-MODEL §1, §7.5).
- ~~**Does a vendor see which other stores a product of theirs is in?**~~ **No** (decided 2026-10-05 on #337).
- ~~**Past due and vendors**~~: vendors **keep working** while the store is past due, unaware of
  its billing (decided 2026-10-05 on #337). Whether a suspended store allows sign-in at all stays open (§9 check 11).
- ~~Can vendors have their own API keys?~~ Later (§5.6).

**Raised by this port**
- ~~A person with stores under two partners~~ **Settled 2026-09-28**: accounts are per
  partner, so each partner's portal is its own account in its own look (§2).
- ~~Shopper sign-in: may partners restrict the per-store choice by plan? Which SMS/WhatsApp
  provider?~~ No plan restriction; MSG91 (India) and Twilio (US) (#284, #337). (§2.1)
- ~~**Partner roles**: confirm the proposed matrix (§5.3).~~ **Settled 2026-10-01** on #109
  (§5.3).
- ~~**Invitation expiry**~~: 7 days (decided 2026-10-05 on #337) (§6.3).
- ~~**Manager permissions**: stock and warehouse writes; catalogue "Publish now" (§5.1).~~
  **Settled 2026-10-04** on #184 (§5.1): stock yes, warehouses and Publish now no.
- ~~**Stock only vendors**: how their products come to exist~~: they propose, the merchant approves (decided 2026-10-05 on #337) (§7.1).
- ~~**Support sessions**: default length; the email notice; who may allow write elevation~~:
  30 minutes, Owners emailed, an Owner or Manager allows (decided 2026-10-05 on #337) (§8). The investigation exception and the staff banner's wording are moot: staff
  never open a support session (decided 2026-09-30), and §8.1 fixes their banner to "Support".
- **Staff session bounds** and which actions need a second approver (§4, §5.4).
- ~~**API keys** when their creator leaves; whether apps can be vendor-bound~~: keys keep
  working; apps never vendor-bound, keys may be (decided 2026-10-05 on #337) (§3, §5.6).
- ~~**Password change** ending every other session on every host (§4).~~ **Settled 2026-10-02**:
  it does.
- ~~**Whether vendors see any audit entries**~~: their own team's actions on their own rows (decided 2026-10-05 on #337) (§10).
