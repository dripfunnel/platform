# DATA-MODEL.md: tenancy, identity and roles

How the database stores the tenancy tree (DripFunnel → partners → stores → suppliers and
customers), every kind of user and their roles, and how Postgres row-level security backs
up the application's scoping. Commerce tables (catalogue, stock, orders, offers…) are
added here module by module as the engine is designed; each follows §2.

Rules behind this document: [ACCESS.md](ACCESS.md) (identities, roles, permissions),
[SAAS.md](SAAS.md) (partners and stores), [LOGGING.md](LOGGING.md) (activity log).
Table and column names are *(proposed)* until the first migration; the structure is decided.

Last updated: 2026-10-02.

---

## 1. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **Every table declares one scope**: platform, partner, store, or store-and-seller (§2) | Deciding per query | A table that is "global by accident" was the first platform's worst leak. The scope decides the columns, the scoped layer and the RLS policy. |
| **Store-level rows carry `store_id` only**, not `partner_id`; the partner is `store.partner_id` | Copying `partner_id` onto every row | Moving a store to another partner changes one row. Partner-level reads join through `store`, one indexed join. |
| **Four identity pools in separate tables** (§3) | One `users` table with a type column | Each pool signs in on its own host through its own API; a bug in one pool's checks can't grant another pool's power. |
| **Merchant and supplier accounts are per partner**: `user` unique by `(partner_id, email)` | One account platform-wide | White label never leaks across partners (ACCESS.md §2). |
| **Customer accounts are per store**, by email and/or phone | One shopper account across stores | Each store's customers are the merchant's, not the platform's. |
| **Roles are keys; permission sets live in code** | Role and permission tables; a role editor | Nothing to clone or drift; a change is reviewed like code and applies on the next request. |
| **One role per membership** (decided 2026-09-28): at most **one merchant-side membership per person per store**, and **one membership per supplier** a person works for; a person may work for several suppliers in the same store, but is never merchant-side and supplier-side in the same store | Several roles per membership; one membership per store in total | Merchant roles nest (Owner ⊃ Manager ⊃ Staff), so several roles add rules without adding power. A person may genuinely work for two suppliers that sell into one store; being the merchant's staff and a supplier there at once is a conflict of interest. |
| **Suppliers manage their own team** (decided 2026-09-28): the merchant sets the supplier's **access level**; the supplier's admins set their users' **team roles** within it | The merchant manages every supplier user | Suppliers are businesses with their own staff turnover; the merchant decides what the supplier may do, not who works there. |
| **Postgres row-level security as the backstop** (decided 2026-09-28) | Application filtering only | If `db/scoped` is bypassed by a bug, the database still refuses other stores', suppliers' and partners' rows. |

---

## 2. The tenancy tree and table scopes

```
platform            no row: DripFunnel itself; staff act here
 └─ partner         partner(id, …); DripFunnel's own offering is one row, is_house = true
     └─ store       store(id, partner_id, …); one merchant's store
         ├─ seller  seller(id, store_id, access_level, …); a supplier in that store
         └─ customer customer(id, store_id, …); a shopper account in that store
```

| Scope | Columns | RLS allows | Examples |
|---|---|---|---|
| **Platform** | none | Admin API only | `staff_user`, `staff_session`, `impersonation`, `partner_setup_session`, `platform_setting`, `entitlement_ceiling`, `feature_flag` |
| **Partner** | `partner_id` | Its partner's users; Admin API | `partner`, `partner_user`, `partner_session`, `partner_domain`, `plan`, `plan_entitlement` |
| **Store (account level)** | `store_id` (and `store.partner_id`) | The store's people; its partner's users; Admin API | `store`, `store_subscription`, `custom_domain`, `storefront`, `support_access_setting` |
| **Store (inside the store)** | `store_id` | The store's people and callers only; **never** partner users, and staff only by impersonating | `membership`, `order`, `collection`, `offer`, `api_key`, `webhook`, `seller` (a supplier reads only its own row — ACCESS.md §5.5) |
| **Store (customer accounts)** | `store_id` | As inside the store, **plus a read-only `platform` branch** for the admin console's Customers menu (decided 2026-09-28); never a partner branch | `customer` |
| **Store and seller** | `store_id`, `seller_id` null (null = the merchant's own) | As above, and a supplier only its own `seller_id` | `product`, `warehouse`, `stock_level`, `order_part` (per-supplier part of an order) |
| **Cross-scope, append-only** | `partner_id`, `store_id`, `seller_id`, `customer_id` where relevant | Per LOGGING.md §6; `outbox` is insert-only for requests and read by the relay alone | `activity_log`, `outbox` |

- **Unique constraints are per scope**: SKU, web address and coupon code per store; customer
  email and phone per store; user email per partner. Never global.
- **"Inside the store" vs "account level"** is what keeps partners and staff out of a
  merchant's catalogue, orders and customers (USERS-AND-DOMAINS §4): the RLS policy on
  those tables has no partner or platform branch at all.

---

## 3. Identity pools

### 3.1 DripFunnel staff (platform)

```
staff_user     (id, sso_subject UNIQUE, email, name, role_key, status, created_at)
staff_session  (id_hash, staff_user_id, created_at, last_seen_at, expires_at, reauth_at)
staff_partner_assignment (staff_user_id, partner_id, created_at)   -- PK both; Partner managers only
```

`role_key` ∈ `staff-super-admin`, `staff-partner-manager`, `staff-support`, `staff-finance`,
`staff-engineer`, `staff-read-only` (ACCESS.md §5.4). Company SSO only; no password column.
`staff_partner_assignment` lists the partners a Partner manager acts on (ACCESS.md §5.4, #14); read in
`platform` and `system` scope, written by no request scope.

### 3.2 Partner users (partner)

```
partner_user     (id, partner_id, email, password_hash NULL, name, role_key, status,
                  two_factor_secret_enc NULL, created_at)
                 UNIQUE (partner_id, email)
partner_session  (id_hash, partner_user_id, created_at, last_seen_at,
                  absolute_expires_at, remember)   -- same session model as user_session
```

`role_key` ∈ `partner-owner`, `partner-admin`, `partner-support`, `partner-finance`,
`partner-read-only` (ACCESS.md §5.3, proposed). A partner's first user is its Owner.

### 3.3 Merchants and supplier users (people pool, per partner)

```
user        (id, partner_id, email, email_verified_at, password_hash NULL, name, phone NULL,
             two_factor_secret_enc NULL, status, created_at)
            UNIQUE (partner_id, email)
user_session(id_hash, user_id, partner_id, created_at, last_seen_at,
             absolute_expires_at, remember)
            -- idle 2 h from last_seen_at, absolute 12 h (ACCESS.md §4); "remember me"
            -- extends the absolute bound, never removes it

seller      (id, store_id, name, access_level, status, created_at)
            -- access_level set by the merchant: vendor-stock | vendor-catalogue
            --                                    | vendor-orders-read | vendor-orders-fulfil

membership  (id, user_id, store_id, seller_id NULL, role_key, status, invited_by, created_at)
            UNIQUE (user_id, store_id) WHERE seller_id IS NULL     -- one merchant-side role per store
            UNIQUE (user_id, seller_id) WHERE seller_id IS NOT NULL -- one role per supplier
            -- and no merchant-side and supplier-side membership for the same (user, store): trigger
            CHECK (seller_id IS NULL     AND role_key IN ('owner','manager','staff'))
               OR (seller_id IS NOT NULL AND role_key IN ('supplier-admin','supplier-member'))
            -- and membership.store.partner_id = user.partner_id (trigger or composite FK)

invitation  (id, store_id, seller_id NULL, email, role_key, token_hash, expires_at,
             invited_by_user_id, accepted_at NULL, revoked_at NULL)
```

- A **merchant-side** membership (`seller_id` null) holds Owner, Manager or Staff.
- A **supplier-side** membership (`seller_id` set) holds a **team role** inside that
  supplier. Its permissions are the supplier's `access_level` (§4.2).
- A person may have memberships in many stores **of the same partner**: Staff in one, a
  user of one or more suppliers in another. Under another partner they have a separate
  `user` row.
- **The acting context is a membership**, not just a store: a person who works for two
  suppliers in one store picks which one they are acting as, and the request names that
  membership (ACCESS.md §4).
- Password, Google sign-in and verification codes as in ACCESS.md §2; codes in
  `verification_code(id, subject_kind, subject_id, purpose, code_hash, attempts, expires_at)`.

### 3.4 Customers (store)

```
customer          (id, store_id, email NULL, email_verified_at, phone NULL, phone_verified_at,
                   password_hash NULL, name, status, created_at)
                  UNIQUE (store_id, email), UNIQUE (store_id, phone)
                  CHECK (email IS NOT NULL OR phone IS NOT NULL)
customer_session  (id_hash, customer_id, created_at, last_seen_at, expires_at)
store_customer_auth (store_id PK, email_enabled, phone_enabled)   -- Settings › Customer accounts
```

The same email or phone may exist in any number of stores, as unrelated rows (ACCESS.md
§2.1). Phone numbers in E.164.

### 3.5 Machine callers and session records

```
api_key    (id, store_id, seller_id NULL, name, prefix, secret_hash, scopes, created_by_user_id,
            expires_at NULL, last_used_at, revoked_at NULL)
app_grant  (id, store_id, app_id, scopes, installed_by_user_id, revoked_at NULL)
support_session (id, store_id, partner_user_id, reason, access, started_at, expires_at,
                 elevated_at NULL, elevation_approved_by NULL, ended_at NULL)
                 -- partner support into a store (ACCESS.md §8). Partner users only:
                 -- staff never open one, they impersonate (§8.1), so there is no agent kind

impersonation   (id, staff_user_id, target_kind, target_id, membership_id NULL, reason,
                 started_at, expires_at, extended_at NULL, ended_at NULL, ended_by NULL)
                 -- staff signed in as a partner user or store user (ACCESS.md §8.1);
                 -- extended_at records the single permitted 30-minute extension, so
                 -- "once" is enforced by the row, not by counting log entries;
                 -- platform scope: written and listed by the Admin API only

partner_setup_session
                (id, staff_user_id, partner_id, reason, started_at, expires_at,
                 ended_at NULL, ended_by NULL)
                 -- staff doing a partner's onboarding as themselves (ACCESS.md §8.2),
                 -- 2 hours and not extendable, so no extended_at; one open per staff
                 -- member, enforced by a partial unique index on (staff_user_id)
                 -- where ended_at is null
```

---

## 4. Roles and permissions

### 4.1 Where they live

Role keys are checked text columns (§3). Their permission sets are code, in
`apps/api/src/auth/roles.ts`, typed so a key from one pool can't be used in another:

```ts
type StaffRole = 'staff-super-admin' | 'staff-partner-manager' | 'staff-support'
               | 'staff-finance' | 'staff-engineer' | 'staff-read-only'
type PartnerRole = 'partner-owner' | 'partner-admin' | 'partner-support'
                 | 'partner-finance' | 'partner-read-only'
type MerchantRole = 'owner' | 'manager' | 'staff'
type SupplierAccessLevel = 'vendor-stock' | 'vendor-catalogue' | 'vendor-orders-read' | 'vendor-orders-fulfil'
type SupplierTeamRole = 'supplier-admin' | 'supplier-member'
```

A test checks every set against the matrices in ACCESS.md §5.

### 4.2 Supplier permissions: access level × team role

**The merchant decides what the supplier may do** (`seller.access_level`, ACCESS.md §5.2).
**The supplier decides who on its team may do it:**

| Team role *(proposed)* | Gets |
|---|---|
| **Supplier admin** `supplier-admin` | Everything the supplier's access level allows, **plus** managing the supplier's team: invite, change team role, remove, resend invitations; see the supplier's own activity log |
| **Supplier member** `supplier-member` | Everything the supplier's access level allows; no team management |

- Effective permissions = the access level's set (+ team management for admins). A team
  role can never exceed the access level; lowering the access level lowers every supplier
  user on the next request.
- **The merchant keeps control of its store**: the Owner (`manage-vendors`) sees every
  supplier user, can suspend or remove any of them or the whole supplier, and changes the
  access level. The Owner doesn't manage the supplier's team day to day.
- **The first supplier user** is invited by the merchant's Owner when creating the supplier
  and becomes its Supplier admin. A supplier always keeps at least one admin; if the last
  one leaves, the merchant's Owner appoints another.
- Supplier admins invite only into **their own supplier in that store**; the invitation row
  carries `seller_id`, and the server sets it from the inviter's membership, never from input.
- **Supplier API keys: later** (decided 2026-09-28). When they come, a Supplier admin creates
  them, bound to the supplier, within its access level. Until then only the merchant's Owner
  creates a supplier-bound key.

### 4.3 Resolving permissions per request

| Caller | Permissions = |
|---|---|
| Staff | `roles[staff_user.role_key]` |
| Partner user | `roles[partner_user.role_key]`, scoped to `partner_user.partner_id` |
| Merchant person | `roles[membership.role_key]` in the acting store |
| Supplier user | `roles[seller.access_level]` (+ team management if `supplier-admin`), `SellerScope = seller` |
| Customer | the fixed shopper set, in `customer.store_id` |
| API key / app | its scopes, never more than its creator's permissions |
| Support session (partner) | the read-only support set, or the write set after the merchant approves |
| Staff impersonation | exactly the target user's permissions, as above; RLS settings are the target's, plus `app.impersonation_id` |

---

## 5. Row-level security (decided: the backstop)

`db/scoped` applies scope in every query; RLS refuses whatever it misses.

### 5.1 Per-transaction settings

Every transaction opens with `SET LOCAL`, set by `db/` from the caller's context, never from
request input:

| Setting | Values |
|---|---|
| `app.scope` | `store`, `partner`, `platform`, `shop`, `system` |
| `app.partner_id` | The partner (store and partner scopes) |
| `app.store_id` | The acting store (store and shop scopes) |
| `app.seller_id` | The supplier, or empty for the merchant side |
| `app.customer_id` | The signed-in customer (shop scope), or empty |
| `app.support` | `read` or `write` during a support session, else empty |
| `app.impersonation_id` | The impersonation id while staff act as a user, else empty (for the activity log; grants nothing) |

`SET LOCAL` lives only for the transaction, so it is safe with Hyperdrive's pooled
connections; every request's work runs inside a transaction for this reason.

### 5.2 Policies by table scope

```sql
-- Inside the store (e.g. order, customer, offer, collection)
USING (current_setting('app.scope') IN ('store','shop')
       AND store_id = current_setting('app.store_id')::uuid
       AND <table rule for suppliers and shoppers>)

-- Store and seller (e.g. product, warehouse, stock_level, order_part)
USING (current_setting('app.scope') IN ('store','shop')
       AND store_id = current_setting('app.store_id')::uuid
       AND (current_setting('app.seller_id') = ''          -- merchant side sees all
            OR seller_id = current_setting('app.seller_id')::uuid))

-- Account level (e.g. store, store_subscription, custom_domain)
USING ( (current_setting('app.scope') = 'store'    AND id/store_id = current_setting('app.store_id')::uuid)
     OR (current_setting('app.scope') = 'partner'  AND partner_id  = current_setting('app.partner_id')::uuid)
     OR  current_setting('app.scope') = 'platform')

-- Partner (e.g. partner_user, plan)
USING ( (current_setting('app.scope') = 'partner' AND partner_id = current_setting('app.partner_id')::uuid)
     OR  current_setting('app.scope') = 'platform')
```

- **Suppliers**: tables a supplier must never read (offers, customers, the store's people
  outside its own team, settings) add `AND current_setting('app.seller_id') = ''`.
- **Shoppers** (`shop` scope): read policies return only what the Shop API may show
  (visible products, the customer's own orders and addresses via `app.customer_id`).
- **Support sessions** run in `store` scope for the one store; `app.support = 'read'` makes
  every write refuse. **Per command, not one `FOR ALL` policy** (corrected on #12): `WITH
  CHECK` does not apply to `DELETE`, so a single policy written that way refuses updates and
  inserts while letting a read-only session delete the row outright. `UPDATE` and `INSERT`
  use `WITH CHECK`, which raises; `DELETE` uses `USING`, which can only filter — the delete
  then affects no rows rather than failing, and Postgres offers no way to make it raise.
- **Inside-the-store tables have no `partner` or `platform` branch** (the one exception:
  `customer` has a read-only `platform` SELECT policy for the Customers menu; no platform
  write policy), so a partner or staff
  query can't read a catalogue or order even by mistake.
- **`system` scope** (jobs, webhooks, migrations of data) is granted per job to the tables it
  needs, through a separate database role; the request role never has it.

### 5.3 Database roles

| Role | Used by | Can |
|---|---|---|
| `app_request` | Every API request | DML under RLS; no `BYPASSRLS`; insert-only on `activity_log` |
| `app_system` | Jobs, webhooks, retention | Named tables, under RLS with `app.scope = 'system'` |
| `app_migrate` | Migrations only | DDL; never used by the Worker at run time |

The table owner isn't used by the application, so RLS always applies (`FORCE ROW LEVEL
SECURITY` on every tenant table).

### 5.4 Tests

- With `db/scoped` bypassed, a raw query in each scope returns nothing outside its scope
  (ACCESS.md §11).
- Every tenant table has RLS enabled and forced, and a policy for each scope that may reach
  it; a test lists tables without one and fails.
- `SET LOCAL` values come only from the context: a structural test forbids setting them
  anywhere but `db/`.
- Performance: every policy's columns are the leading columns of an index.

---

## 6. Open questions

- Confirm the names of the two supplier team roles, Supplier admin and Supplier member (§4.2).
  (No read-only team role: decided 2026-09-28.)
