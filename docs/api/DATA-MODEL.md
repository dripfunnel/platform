# DATA-MODEL.md: tenancy, identity and roles

How the database stores the tenancy tree (DripFunnel → partners → stores → suppliers and
customers), every kind of user and their roles, how Postgres row-level security backs
up the application's scoping, and (§7) the merchant-side tables: settings, catalogue, stock,
customers, orders, offers, storefront, billing and integrations, each following §2.

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
| **Platform** | none | Admin API only | `staff_user`, `staff_session`, `impersonation`, `partner_setup_session`, `partner_approval`, `platform_setting`, `entitlement_ceiling`, `feature_flag`, `store_note` |
| **Partner** | `partner_id` | Its partner's users; Admin API | `partner`, `partner_user`, `partner_session`, `partner_invitation`, `partner_domain`, `partner_setup_item`, `plan`, `plan_entitlement` |
| **Store (account level)** | `store_id` (and `store.partner_id`) | The store's people; its partner's users; Admin API | `store`, `store_subscription`, `custom_domain`, `job`, `storefront`; **`membership`, `user` and `seller` at account level** — names, roles and status, for the owner, contacts, the Users tab and support sessions (ui/admin/FIRST-RELEASE.md §5.2, ui/platform/FIRST-RELEASE.md §6.3, §12.1; corrected on #32). A supplier still reads only its own `seller` row (ACCESS.md §5.5) |
| **Store (inside the store)** | `store_id` | The store's people and callers only; **never** partner users, and staff only by impersonating | `invitation`, `order`, `return`, `collection`, `promotion`, `customer_group`, `badge`, `access_request`, `api_key`, `webhook_endpoint`: the full list is §7.11's second and third classes |
| **Store (customer accounts)** | `store_id` | As inside the store, **plus a read-only `platform` branch** for the admin console's Customers menu (decided 2026-09-28); never a partner branch | `customer` |
| **Store and seller** | `store_id`, `seller_id` null (null = the merchant's own) | As above, and a supplier only its own `seller_id` | `product` and its children, `warehouse`, `stock_level`, `stock_movement`, `order_line`, `order_part`, `fulfilment`, `return_line`, `refund`, `refund_line`, `supplier_ledger_entry`, `import_job`, `export_job`: the full list is §7.11's first class (a supplier reads only the refunds of its own lines, overrides against it included, and only its own ledger entries; never another supplier's, nor their counts) |
| **Cross-scope, append-only** | `partner_id`, `store_id`, `seller_id`, `customer_id` where relevant | Per LOGGING.md §6; `outbox` is insert-only for requests and read by the relay alone | `activity_log`, `outbox` |

- **Unique constraints are per scope**: SKU, web address and coupon code per store; customer
  email and phone per store; user email per partner. Never global.
- **"Inside the store" vs "account level"** is what keeps partners and staff out of a
  merchant's catalogue, orders and customers (USERS-AND-DOMAINS §4): the RLS policy on
  those tables has no partner or platform branch at all.

### 2.1 Partners and stores as built (#32)

Migration `0007` gives `partner` and `store` their business columns and adds the account-level
tables above (`partner_user`, `partner_invitation`, `partner_domain`, `partner_setup_item`,
`plan`, `custom_domain`, `user`, `membership`, `invitation`, `job`, `store_note`).

- **Partner**: `name`, `is_house` (one row, by a partial unique index), `kind`, `region`,
  `country`, `state` (SAAS.md §3.1) with the facts of each state (`submitted_at/by`,
  `sent_back_reason`, `approved_at`, `paused_at`, `pause_reason`), the published look the admin
  console shows (`product_name`, colours, `powered_by`) and `fallback_sender_accepted`. PAPI 3
  adds the versioned branding and prices.
- **Store**: `name`, `code` (unique per partner, used in hostnames), `country`, `status`
  (SAAS.md §4.2 plus `closed`) with its facts (`trial_ends_at`, `past_due_since`, the
  suspension's time, reason, who and **the status it had before**, so Restore returns to it),
  `plan_id`, `storefront_kind` (`ai` or `own`), `build_state`, `core_version`, last build and
  publish, and `support_access_allowed` (the merchant's standing consent, USERS-AND-DOMAINS §4.1,
  a column rather than the `support_access_setting` table named above).
- **Setup checklist**: the ten items of ui/platform/FIRST-RELEASE.md §4, one row each with
  status, detail and who did it (a partner user, or staff in a setup session). The admin console's
  "Owner accepted" is read from `partner_user.status`, not an item.
- **Signup job**: SAAS.md §5's steps as the run's own list (three for a store with its own
  frontend), the current step and when it started, attempts and the error in plain words. The
  raw detail and the compensation log are `job_detail`, a table staff alone read (FIRST-RELEASE
  §7). Stuck is derived from a limit per step (`saas/provisioning/stuck.ts`), never stored.
- **Credentials are granted column by column**: `password_hash`, `two_factor_secret_enc`,
  `user_backup_code.code_hash` (§3.3) and the `token_hash` of both invitation tables are
  readable by `app_system` (sign-in, acceptance, the second factor) and never by
  `app_request`, whatever the row policy admits (§5.3). `user.phone` is granted
  the same way, with one exception decided 2026-10-02: **a person may read and change their
  own number** (My profile; SMS 2-factor is sent to it), through a request scope limited to
  the session's own `user` row. No other screen shows a merchant user's phone.
- **State history is the activity log** (LOGGING.md): `partner.*` and `store.*` entries with
  the partner or store as target, visibility `partner`. No history table.
- **Transitions** are enforced in `saas/partners/states.ts` and `saas/stores/states.ts`, which
  write the facts with the state; the house partner is never paused, offboarded or closed.
- **Seed**: `pnpm --filter ./apps/api seed` replaces everything it owns on a local database with
  the prototype's partners and stores in every state (`apps/api/scripts/seed/`), every address
  under a reserved `.example` domain. It runs against a loopback host only, with none of the CI
  opt-in `migrate` has, since it truncates.

### 2.2 Entities named by the 2026-10-02 design decisions (#182)

Folded into §7 on #187, so each table has one home: the supplier shipping mode (§3.3) and the
custom-domain states (§7.2), badges, per-market prices and the approval snapshot (§7.3),
stock movements (§7.4), customer groups, tags, notes and consent (§7.5), returns, refunds
and the supplier ledger (§7.6), access requests (§7.10); the 2-factor, backup-code and
session columns are in §3.3.

---

## 3. Identity pools

### 3.1 DripFunnel staff (platform)

```
staff_user     (id, sso_subject UNIQUE, email, name, role_key, status, created_at)
staff_session  (id_hash, staff_user_id, created_at, last_seen_at, expires_at, reauth_at)
staff_partner_assignment (id, staff_user_id, partner_id, created_at, assigned_by_staff_id,
                          removed_at NULL, removed_by_staff_id NULL)
                 -- Partner managers only; one live row per pair (partial unique where
                 -- removed_at is null); never deleted (#60)
```

`role_key` ∈ `staff-super-admin`, `staff-partner-manager`, `staff-support`, `staff-finance`,
`staff-engineer`, `staff-read-only` (ACCESS.md §5.4). Company SSO only; no password column.
`staff_partner_assignment` lists the partners a Partner manager acts on (ACCESS.md §5.4, #14); read in
`platform` and `system` scope, written in `platform` scope by Super admins only (#60).

### 3.2 Partner users (partner)

```
partner_user     (id, partner_id, email, password_hash NULL, name, role_key, status,
                  two_factor_secret_enc NULL, created_at)
                 UNIQUE (partner_id, email)
partner_session  (id_hash, partner_user_id, created_at, last_seen_at,
                  absolute_expires_at, remember)   -- same session model as user_session
```

`role_key` ∈ `partner-owner`, `partner-admin`, `partner-support`, `partner-finance`,
`partner-read-only` (ACCESS.md §5.3, decided on #109). A partner's first user is its Owner.
**Built on #32**: `partner_user` (with `status`, `last_sign_in_at`) and `partner_invitation`
(token hash, expiry, `sent_at` null while held, who invited, accepted, revoked); PAPI 1 adds
`partner_session`, PAPI 2 fills the password and 2-factor columns.

### 3.3 Merchants and supplier users (people pool, per partner)

```
user        (id, partner_id, email, email_verified_at, password_hash NULL, name, phone NULL,
             two_factor_secret_enc NULL, two_factor_method NULL, two_factor_enrolled_at NULL,
             theme NULL, status, created_at)
            UNIQUE (partner_id, email)
            -- two_factor_method: 'app' | 'sms'; required for an Owner, optional otherwise
            -- (ACCESS.md §2, decided 2026-10-02); theme: the person's light/dark choice
user_backup_code (id, user_id, partner_id, code_hash, used_at NULL)
            -- ten per enrolment, shown once; making new ones deletes the old (ACCESS.md §4);
            -- partner_id denormalised from user so the §5.2 partner policy applies directly
user_session(id_hash, user_id, partner_id, created_at, last_seen_at,
             absolute_expires_at, remember, device_label, user_agent)
            -- idle 2 h from last_seen_at, absolute 12 h (ACCESS.md §4); "remember me"
            -- extends the absolute bound, never removes it; device_label and user_agent
            -- are what "Where you're signed in" lists

seller      (id, store_id, name, access_level, shipping_mode, status, created_at)
            -- access_level set by the merchant: vendor-stock | vendor-catalogue
            --                                    | vendor-orders-read | vendor-orders-fulfil
            -- shipping_mode set by the merchant: to-store | to-shopper (ACCESS.md §5.2, §7.3,
            -- decided 2026-10-02); copied onto order_part.shipping_mode at placement, and
            -- an order follows the mode it was placed under, never the live seller row

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
                (id, staff_user_id, partner_id, reason, ticket NULL, started_at, expires_at,
                 ended_at NULL, ended_by_staff_id NULL,
                 handoff_hash NULL UNIQUE, handoff_expires_at NULL, handoff_used_at NULL)
                 -- staff doing a partner's onboarding as themselves (ACCESS.md §8.2),
                 -- 2 hours and not extendable, so no extended_at; one open per staff
                 -- member, enforced by a partial unique index on (staff_user_id)
                 -- where ended_at is null. The handoff (ACCESS.md §8.3) is hashed here,
                 -- spent on exchange and cleared when the session ends. Built on #33.

partner_approval (partner_id, staff_user_id, submitted_at, note, approved_at)
                 -- PK all of the first three: one approval per staff member per submission
                 -- (ui/admin/FIRST-RELEASE.md §4.3); sending back and resubmitting starts
                 -- the count again. Built on #33.
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

| Team role (decided 2026-10-02 on #182) | Gets |
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
| `app.order_token_hash` | The hash of the guest cart or order token presented on this request (shop scope), else empty; binds a guest to its own `"order"` rows (§7.11) |

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
| `app_request` | Every API request | DML under RLS; no `BYPASSRLS`; insert-only on `activity_log` and `outbox`; no `select` on credential columns (§2.1: password and 2-factor secret hashes, backup-code hashes, invitation token hashes; and §7's `credentials_enc`, `webhook_secret_enc`, `secret_enc` and `token_enc` on courier, payment, webhook and external-connection rows) |
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

- ~~Confirm the names of the two supplier team roles, Supplier admin and Supplier member (§4.2).~~
  **Settled 2026-10-02**: those names. (No read-only team role: decided 2026-09-28.)
- From §7 (2026-10-02, #187): when stock is reserved (cart, checkout or payment, §7.4);
  whether a fixed product discount is per line or per unit, and whether codes match
  case-insensitively (§7.7, OFFERS facts 4 and 6); whether a `to-shopper` supplier books
  labels through the store's courier account or its own (§7.6 `fulfilment.courier_account_id`);
  the version and option limits per product (§7.3, CATALOG fact 4); whether A+ reusable
  blocks (`story_block`) ship; whether `menu_item` may point at pages and URLs (CATALOG J4);
  one active shipping method at a time or several (DESIGN-BRIEF flow 54).

---

## 7. Commerce, settings, storefront and billing tables

The merchant-side model, designed on #187 (2026-10-02) from PLATFORM-PROMPT §3.3 and §5.4–5.7,
CATALOG-DESIGN §3, OFFERS-DESIGN §3, DESIGN-BRIEF §3, SAAS §4–9, ACCESS §5 and §7, and the
Store prototype. **The structure is decided; names and columns are *(proposed)* until each
module's migration**, as §3 was before #32. Which module ships first is
ui/store/FIRST-RELEASE.md's (#184); anything the specs mark `(release: decide)` keeps the mark
here. The model's own open points are in §6.

### 7.1 Conventions every table below follows

- **Scope first** (§2): every table names its scope; store tables carry `store_id`, supplier-
  readable tables carry `seller_id` (null = the merchant's own), and RLS gets the matching
  policy from §5.2. Each store-and-seller table is a row of the isolation matrix (ACCESS §11.1).
- **Supplier ownership reaches every child row** (review on #188): a table whose parent a
  supplier may own (`product`, `product_version`, `warehouse`, `order_part`, `fulfilment`,
  `size_chart`, `product_story`, `import_job`) carries the parent's `seller_id` denormalised,
  set by a trigger from the parent and never from input, so the store-and-seller policy
  applies to it directly and never joins. `translation` carries the `seller_id` of the entity
  it translates (null for a store-owned entity). The isolation matrix (ACCESS §11.1) lists
  every such child, `translation` included: two suppliers in one store, each reading prices,
  photos, compliance text, translated names, stock and shipped quantities, seeing only its own.
- **Keys**: `id uuid` primary keys; `created_at`; `updated_at` and a `revision integer` on
  anything two people may edit at once, so a save can refuse a stale revision (CATALOG E4,
  OFFERS N6). Unique constraints are per store (SKU, web address, coupon code, group name),
  per language for web addresses, never global.
- **Money**: every column named `amount` or `*_amount` is `bigint` in minor units with a
  `currency char(3)` on the same row, every time, whatever table it is in, subscriptions,
  invoices and every line included; the one allowed inheritance is the order's two children,
  `order_line` and `order_adjustment`, whose amounts are in `"order".currency`, because an
  order has exactly one currency and a presentment currency, if one ever exists, is a column
  on the order, not on its lines (PLATFORM-PROMPT §5.4 Money; AGENTS.md "Data").
  Percentages are basis points (`_bps integer`).
- **Time**: every `*_at` column is `timestamptz`, stored in UTC; display converts and names
  the zone (api/README.md; the store's `time_zone` is for display and scheduling only).
- **Soft delete** (`deleted_at`) where history points at the row: products, versions,
  collections, promotions, customers, warehouses. Orders are never deleted.
- **Translations** live in one table, `translation(store_id, entity, entity_id, field,
  language, text)`, unique on the first five, for every translatable field CATALOG fact 18
  lists (product, option, option value, version, collection, filter, filter value, menu
  item, story module text, size-chart labels, promotion names, compliance fields). The
  main-language text stays on the row itself and is required; other languages fall back to
  it (facts 19–20). Compliance fields may be translated into a language the store does not
  offer (fact 47).
- **Snapshots, not references, on orders**: a line records the name, SKU, price, tax class
  and classification code as sold; a discount records the promotion's shopper-facing name
  (OFFERS fact 13). Catalogue rows may change or be soft-deleted afterwards.
- **History is the activity log** (LOGGING.md), as §2.1 decided: no per-table history, apart
  from the ledgers the business needs (stock movements, price history, the supplier ledger).
- **Indexes** lead with the scope columns (`store_id`, then `seller_id` where present), then
  the list screen's filter; full-text search over products, customers and orders is a
  generated `tsvector` per table, store-scoped (PLATFORM-PROMPT §5.4 Search).

### 7.2 Store settings

Store-scoped, Owner-written (`settings`, ACCESS §5.1), read by every catalogue and order
screen (CATALOG fact 36). `store` keeps what #32 built (§2.1); the rest is split by concern so
no row becomes a wall of columns.

```
store (+ columns)   home_country, tax_inclusive boolean, time_zone, unit_system ('metric'|'imperial'),
                    order_prefix, next_order_number, pricing_currency,
                    main_language, vendor_products_require_approval boolean,
                    track_stock_default boolean, continue_selling_default boolean,
                    low_stock_threshold_default integer,
                    pickup_enabled boolean, pickup_hours text,
                    legal_name, legal_address jsonb, customer_care jsonb        -- Store info
                    -- pricing_currency is locked once the first order exists (CATALOG §Currencies)

store_language      (store_id, language, status, position)   UNIQUE (store_id, language)
                    -- offered on the storefront; main_language is one of them

seller.shipping_mode   see §3.3 (to-store | to-shopper); copied onto order_part at placement (§7.6)
custom_domain (+ columns) last_checked_at, checks_until, removed_at
                    -- as built on #34: status ∈ waiting | verifying | issuing | live | failed |
                    -- expiring | broken (migration 0007). The portal's four steps map onto it
                    -- (SAAS §8): "Add the record" = waiting, "We check it" = verifying,
                    -- "Security certificate" = issuing, "Live" = live; failed shows the record
                    -- looked for. checks_until = first check + 3 days (every 15 minutes)
store_currency      (store_id, currency, mode ('manual'|'convert'), rounding ('none'|'nearest'|'ends-99'),
                     rate_source, rate_updated_at)            UNIQUE (store_id, currency)
                    -- CATALOG facts 25–26; converted prices (release: decide)

market              (id, store_id, name, countries text[], currency, price_adjustment_bps,
                     custom_domain_id NULL, duties_mode ('none'|'by_code'|'flat'),
                     duties_rate_bps, duties_threshold_amount, status)
                    -- SetMarkets: a market sells one currency into its countries; a market's
                    -- own domain is a custom_domain row (SAAS §8, Business plan); duties per
                    -- CATALOG part T. A country is in at most one market (trigger).

tax_registration    (id, store_id, country, kind ('vat'|'oss'|'gst'|'sales_tax_permit'|'ein'|'abn'|…),
                     number, valid_from)                       -- CATALOG fact 36
tax_class           (id, store_id, key, name, is_default)      -- Standard, Reduced, Zero, Exempt… (fact 37)
tax_zone            (id, store_id, name, countries text[], regions text[])
tax_rate            (id, store_id, tax_class_id, tax_zone_id, rate_bps, valid_from)
                    UNIQUE (tax_class_id, tax_zone_id, valid_from)
                    -- class × zone (fact 37); a tax service for US sales tax (decide) would
                    -- add tax_code on product_version and bypass tax_rate for that zone

compliance_default  (store_id, region, field, value)           -- manufacturer, importer,
                    UNIQUE (store_id, region, field)            -- responsible person… (fact 34)

store_feature       (store_id, key, enabled boolean)           -- Settings › Catalogue switches
                    UNIQUE (store_id, key)                      -- (CATALOG P1): aplus, size_charts,
                                                                -- specs, faqs, badges, related…
badge               (id, store_id, label, rule ('new_30_days'|'top_5_this_month'|'below_compare_price'
                     |'few_left'|'manual'), created_at)         -- CATALOG S5; label ≤ 18 chars

shipping_zone       (id, store_id, name, countries text[], regions text[])
shipping_method     (id, store_id, zone_id, name, kind ('free'|'fixed'|'free_over'|'courier_rate'),
                     amount, currency, threshold_amount, position, status)
                    -- DESIGN-BRIEF flows 54–55; whether one active method at a time survives
                    -- is (ask) and would be a partial unique index, not a column
delivery_area       (store_id PK, mode ('everywhere'|'list'), postal_codes text[],
                     source_file_asset_id NULL, updated_at)     -- SetOps "Where you deliver"
courier_account     (id, store_id, provider ('shiprocket'|'usps'|'ups'|'fedex'|'dhl'|'dpd'|'hermes'|…),
                     credentials_enc, role ('pricing'|'standby'|'off'), paused_by_plan boolean,
                     pickup_mode ('scheduled'|'on_request'), pickup_window text,
                     label_size ('a6'|'a4'|'4x6'|'letter'), tracking_emails boolean,
                     status ('connected'|'login_rejected'|'not_connected'),
                     last_tested_at, last_test_result jsonb)
                    -- SetOps Delivery partners; one 'pricing' row per store (partial unique);
                    -- Choose-what-to-keep sets paused_by_plan (PortalKeep)
payment_provider_account
                    (id, store_id, provider ('stripe'|'razorpay'|'cashfree'|'paypal'|'klarna'|'phonepe'
                     |'adyen'|'cod'|'bank_transfer'), mode ('test'|'live'), credentials_enc,
                     webhook_secret_enc, public_key, bank_details jsonb, status, position)
                    -- the merchant's own providers (flow 56; THIRD-PARTY-ACCESS §3.1); never
                    -- the subscription's payment method (§7.9)
invoice_settings    (store_id PK, legal_name, address jsonb, tax_id, tax_per_line boolean,
                     footer text, updated_at)                   -- SetOps "Save invoice settings";
                                                                -- issued invoices never change
store_customer_auth (store_id PK, email_enabled, phone_enabled)  -- §3.4, ACCESS §2.1
```

### 7.3 Catalogue

Store-and-seller scoped: a supplier's rows carry its `seller_id` and it reads nothing else,
counts and search included (ACCESS §7.1, §7.4). Everything is one shared record between the
merchant and the supplier that owns it (DESIGN-BRIEF fact 4).

```
asset               (id, store_id, seller_id NULL, r2_key, kind ('image'|'video'|'file'|'document'),
                     mime, bytes, width, height, checksum, created_by, created_at)
                    -- every upload; photos, A+ images, labels, invoices, export files

product             (id, store_id, seller_id NULL, name, slug, description, product_type
                     ('physical'|'digital'|'service'), category, visibility ('visible'|'hidden'),
                     approval_status ('approved'|'pending'|'sent_back') NULL, sent_back_reason,
                     hidden_by ('seller_suspended'|'seller_removed') NULL, status_before_hide,
                     publish_at NULL, size_chart_id NULL, seo_title, seo_description,
                     search tsvector, revision, created_at, updated_at, deleted_at)
                    UNIQUE (store_id, slug) WHERE deleted_at IS NULL     -- fact 15; per language in translation
                    -- approval_status is null when the store does not require approval
                    -- (ACCESS §7.2); re-approval compares name, prices and photos with
                    -- product_approved_snapshot; product_type and publish_at (release: decide)
product_approved_snapshot
                    (product_id PK, store_id, seller_id NULL, name, prices jsonb, photo_ids uuid[], approved_at, approved_by)
                    -- what the last approval accepted, so a save knows whether it must go
                    -- back to pending (ACCESS §7.2, decided 2026-10-02)
product_option      (id, product_id, store_id, seller_id NULL, name, position)         -- "Size", "Colour" (fact 3)
product_option_value(id, option_id, store_id, seller_id NULL, name, position)
product_version     (id, product_id, store_id, seller_id NULL, sku, barcode, name,
                     option_value_ids uuid[], visibility, tax_class_id, hs_code, weight_grams,
                     length_mm, width_mm, height_mm, cost_amount, cost_currency,
                     track_stock boolean NULL, continue_selling boolean NULL,
                     position, revision, deleted_at)
                    UNIQUE (store_id, sku) WHERE sku IS NOT NULL AND deleted_at IS NULL
                    -- every product has at least one (fact 1); price, stock, SKU, code, tax
                    -- class and weight live here (fact 2); nulls inherit the store default
                    -- (fact 10); barcode check digit validated (fact 44, release: decide)
version_price       (version_id, store_id, seller_id NULL, currency, amount, compare_at_amount NULL,
                     source ('manual'|'converted'), updated_at)
                    PRIMARY KEY (version_id, currency)                    -- fact 25
price_history       (id, version_id, store_id, seller_id NULL, currency, amount, compare_at_amount, from_at, to_at)
                    -- the EU 30-day reference price (fact 41, release: decide); written on
                    -- every version_price change
product_market_price(product_id, market_id, store_id, seller_id NULL, amount, currency)
                    PRIMARY KEY (product_id, market_id)
                    -- a fixed price per market for a product without versions (Business
                    -- plan; CatEditor "Price per market"); absent = main price + adjustment
product_photo       (id, product_id, version_id NULL, store_id, seller_id NULL, asset_id, position, alt)
                    -- alt per language in translation (fact 23, release: decide)
product_video       (product_id, store_id, seller_id NULL, asset_id NULL, url NULL)      -- plan-gated (CATALOG F9, S7)
product_market_rule (product_id, store_id, seller_id NULL, mode ('only'|'except'), countries text[])
                    -- "Where you sell" per product (fact 42, release: decide)
product_flag        (product_id, store_id, seller_id NULL, age_restricted boolean, hazardous boolean)   -- fact 43
product_compliance  (product_id, store_id, seller_id NULL, region, field, value)
                    UNIQUE (product_id, region, field)                     -- facts 34, 45–46
product_spec        (id, product_id, store_id, seller_id NULL, name, value, filterable boolean, position)
                    -- filterable rows mirror a filter_value (fact 30)
product_faq         (id, product_id, store_id, seller_id NULL, question, answer, position)
product_related     (product_id, related_product_id, store_id, seller_id NULL, mode ('manual'|'auto_collection'))
product_badge       (product_id, badge_id, store_id, seller_id NULL)             -- manual badges only (S5)

collection          (id, store_id, name, slug, description, kind ('manual'|'automatic'),
                     match ('all'|'any'), parent_id NULL, inherit_parent boolean,
                     visibility, image_asset_id, sort ('manual'|'newest'|'price_asc'|'price_desc'
                     |'best_selling'), seo_title, seo_description, revision, deleted_at)
                    UNIQUE (store_id, slug) WHERE deleted_at IS NULL
                    -- H6 inherit_parent and H12 price rules are (release: decide)
collection_rule     (id, collection_id, store_id, kind ('filter_value'|'name_contains'|'product'
                     |'version'|'price_range'), args jsonb, position)
collection_product  (collection_id, product_id, store_id, position, source ('manual'|'rule'),
                     computed_at)                                  PRIMARY KEY (collection_id, product_id)
                    -- hand-picked rows and the recomputed result of rules, one table, so the
                    -- storefront reads one list; recomputed from the outbox (fact 11, 14)

filter              (id, store_id, name, position, shopper_visible boolean)   -- I1; internal tags
filter_value        (id, filter_id, store_id, name, position)                   -- are shopper_visible = false
product_filter_value(product_id, version_id NULL, filter_value_id, store_id, seller_id NULL)
                    -- product-level or version-level (fact 13)

menu                (id, store_id, key ('main'), name)
menu_item           (id, menu_id, store_id, parent_id NULL, label, kind ('collection'|'page'|'url'),
                     collection_id NULL, url NULL, position)      -- J4 pages and URLs (ask)

product_story       (product_id PK, store_id, seller_id NULL, status ('draft'|'live'),
                     template, draft jsonb, live jsonb, updated_at)
                    -- A+ content (CATALOG Q): ordered modules as a document, draft separate
                    -- from live (Q9); module kinds limited to what the store's core version
                    -- renders (fact 28); text per language in translation (Q10)
story_block         (id, store_id, kind ('brand_story'), content jsonb, updated_at)
                    -- a reusable block shared by many products (Q5, release: decide)

size_chart          (id, store_id, seller_id NULL, name, unit ('cm'|'in'), systems text[],
                     rows jsonb, measurements jsonb, how_to_measure jsonb, fit_notes, model_info,
                     revision, deleted_at)                          -- CATALOG R
size_chart_rule     (id, size_chart_id, store_id, seller_id NULL, kind ('collection'|'filter_value'|'category'),
                     target_id NULL, value NULL)                    -- R6 (release: decide)

translation         (store_id, seller_id NULL, entity, entity_id, field, language, text, updated_at)
                    PRIMARY KEY (store_id, entity, entity_id, field, language)
                    -- §7.1: seller_id is the translated entity's owner, denormalised
```

Rules the tables encode: visibility is on the product **and** on each version, and a visible
product with no visible version is reported as "not buyable" (fact 8); a version with no price
in a manual currency is not buyable in it (fact 26); the version count per product and the
option count are limited by the engine (fact 4, limit *(decide)*); the storefront's search index
and `collection_product` are rebuilt from outbox events, never in the request (fact 14).

### 7.4 Inventory

Store-and-seller scoped; a supplier never sees another owner's quantities, movements or
totals (DESIGN-BRIEF fact 10, flow 73).

```
warehouse           (id, store_id, seller_id NULL, name, address jsonb, is_default boolean,
                     status, deleted_at)
                    -- one default per owner: a partial unique index on
                    -- (store_id, coalesce(seller_id, '00000000-0000-0000-0000-000000000000'))
                    -- where is_default, so the merchant's null owner counts once too;
                    -- deleting needs on_hand = 0 everywhere (SetOps)
stock_level         (version_id, warehouse_id, store_id, seller_id NULL, on_hand integer,
                     reserved integer, low_stock_threshold integer NULL, updated_at)
                    PRIMARY KEY (version_id, warehouse_id)
                    -- reserved = sold, not yet fulfilled (PLATFORM-PROMPT §5.4, decided);
                    -- when it is reserved (cart, checkout or payment) is (decide)
stock_movement      (id, store_id, seller_id NULL, version_id, warehouse_id, delta integer,
                     resulting_quantity integer, reason ('received'|'returned'|'damaged'|'counted'
                     |'typed'|'order'|'import'|'starting'|'transfer'), source_kind, source_id,
                     actor_kind, actor_id, created_at)
                    -- the ledger (flow 73): every change, by hand, by orders, by suppliers and
                    -- by imports; 'transfer' only if flow 35 ships (release: decide)
```

### 7.5 Customers

Store-scoped customer accounts (§2: the Admin API's Customers menu reads them through a
read-only platform branch, masked). Never readable by a supplier; a `to-shopper` supplier sees
a name and address only through its own order parts (ACCESS §7.3).

```
customer (+ columns) tags text[], note text, consent_state ('opted_in'|'stopped'|'declined'|'not_asked'),
                     consent_at, consent_source ('checkout'|'email'|'added_by_hand'|'recorded_by_store'),
                     consent_channels text[] ('email'|'sms'), added_by_user_id NULL,
                     default_address_id NULL, search tsvector, deleted_at
                    -- §3.4 has the identity columns; "Record that they asked to stop" writes
                    -- consent_state = 'stopped' with the recording user (LOGGING §3)
customer_address    (id, customer_id, store_id, name, line1, line2, city, region, postal_code,
                     country, phone, is_default_shipping, is_default_billing, deleted_at)
customer_group      (id, store_id, name, description, deleted_at)   UNIQUE (store_id, name)
customer_group_member (group_id, customer_id, store_id, added_at)   PRIMARY KEY (group_id, customer_id)
                    -- OFFERS fact 12; a group in use by a promotion warns before deletion (flow 72)
customer_data_request (id, store_id, customer_id NULL, subject_email NULL, subject_phone NULL,
                     subject_verified_at, kind ('export'|'delete'), requested_by,
                     state ('requested'|'ready'|'done'|'refused'), file_asset_id NULL, created_at, done_at)
                    -- a guest has no customer row: the request names the email or phone the
                    -- orders were placed with, proved by a code sent to it
                    -- (subject_verified_at), and the rule below matches "order" rows with
                    -- customer_id null and promotion_usage rows on that identifier as well
                    -- as everything the customer row reaches
                    -- GDPR / DPDP (AGENTS.md "Data"). Export gathers the customer row (if
                    -- any), customer_address, every order placed under the customer id or,
                    -- for a guest, under the verified email or phone, with their email, phone
                    -- and address snapshots, promotion_usage rows and consent history. Deletion
                    -- keeps orders and usage rows (money history) and applies one rule:
                    -- EVERY column on these tables that can hold personal data is blanked or
                    -- replaced by a placeholder, and every search tsvector built from one is
                    -- rebuilt. Named so the migration and its test cover them: customer
                    -- name, email, phone, note, tags, consent_source, added_by_user_id and
                    -- search; customer_address rows; "order" email, phone, shipping_address,
                    -- billing_address, notes, cancel_reason, access_token_hash and search;
                    -- promotion_usage.customer_email; refund.reason and "return".note;
                    -- fulfilment.courier_label and tracking_url; every order_document asset
                    -- of those orders (invoices, packing slips, labels and return labels, the
                    -- only place a label file is referenced, all carry the name and address)
                    -- deleted from R2, the rows keeping kind, number and date; any export_job or customer_data_request file not yet expired
                    -- that contains the person, deleted from R2, and the export_job.filter
                    -- that named them blanked; the shopper's activity entries' personal
                    -- fields (LOGGING §8). The request row itself is blanked too once done:
                    -- subject_email, subject_phone and subject_verified_at go, and customer_id
                    -- with them, so it keeps only kind, dates and state (requested_by is a
                    -- kind, 'customer' or 'store', never an identity). Every other free-text column on these tables is checked
                    -- against this rule when its migration is written. A supplier never saw
                    -- any of it.
```

### 7.6 Carts, orders, fulfilment, returns, refunds and the supplier ledger

An order is store-scoped and the store's; its **parts** and **lines** carry the owning
`seller_id`, which is the only way a supplier reads any of it (ACCESS §7.3). A cart is an
order in state `cart` (PLATFORM-PROMPT §5.5 "cart, an active order").

```
"order"             (id, store_id, number NULL, state ('cart'|'placed'|'paid'|'partly_fulfilled'
                     |'fulfilled'|'cancelled'|'refunded'), customer_id NULL, email, phone,
                     language, currency, market_id NULL, tax_inclusive boolean,
                     shipping_address jsonb, billing_address jsonb,
                     subtotal_amount, discount_amount, shipping_amount, tax_amount, duties_amount,
                     total_amount, refunded_amount,
                     shipping_method_id NULL, shipping_method_label, pickup boolean,
                     placed_at, paid_at, cancelled_at, cancel_reason, cart_expires_at,
                     promotion_ids uuid[], notes, access_token_hash NULL,
                     search tsvector, revision, created_at)
                    UNIQUE (store_id, number) WHERE number IS NOT NULL
                    -- access_token_hash: a guest's cart or order (customer_id null) is reachable
                    -- in the shop scope only with the hashed token the Shop API handed the
                    -- browser (a cookie or the order-status link); the policy is in §7.11
                    -- number = store.order_prefix + next_order_number, assigned at placement
                    -- in one transaction; totals are the engine's, stored at placement and
                    -- recomputed only by refunds (immutable snapshot, PLATFORM-PROMPT §5.4)
order_line          (id, order_id, store_id, seller_id NULL, version_id, product_id,
                     name, version_name, sku, hs_code, tax_class_key, quantity,
                     unit_amount, discount_amount, tax_amount, line_total_amount,
                     weight_grams, fulfilled_quantity, returned_quantity, refunded_quantity)
                    -- the snapshot (§7.1); seller_id is the product's owner at placement
order_adjustment    (id, order_id, order_line_id NULL, store_id, kind ('discount'|'shipping'
                     |'tax'|'duties'|'rounding'), promotion_id NULL, promotion_code_id NULL,
                     label, amount)
                    -- discounts as adjustments carrying the shopper-facing name (OFFERS fact 13);
                    -- order-level discounts spread across lines by the engine (fact 11);
                    -- amount in "order".currency (§7.1)
order_part          (id, order_id, store_id, seller_id NULL, shipping_mode ('store'|'to-store'
                     |'to-shopper'), state ('to_ship'|'sent_to_store'|'partly_shipped'|'shipped'
                     |'delivered'|'cancelled'), warehouse_id NULL)
                    UNIQUE NULLS NOT DISTINCT (order_id, seller_id)
                    -- one part per owner, the merchant's null owner included (DESIGN-BRIEF
                    -- fact 6, flow 70); shipping_mode is the supplier's seller.shipping_mode
                    -- at placement and the order follows it, never the live seller row
                    -- (ACCESS §7.3); 'store' for the merchant's own
fulfilment          (id, order_part_id, order_id, store_id, seller_id NULL, kind ('booked'|'manual'
                     |'sent_to_store'|'pickup'), warehouse_id, courier_account_id NULL, courier_label,
                     tracking_number NULL, tracking_url NULL,
                     booked_at, shipped_at, delivered_at, created_by)
                    -- the printed label is an order_document row (kind 'label', fulfilment_id),
                    -- never a column here, so erasure has one list to follow;
                    -- 'booked' through the store's or supplier's courier account; 'manual' with
                    -- or without a tracking number (PortalOrders "Label and tracking");
                    -- 'sent_to_store' is a to-store supplier's hand-off; shipped lines come out
                    -- of warehouse_id as stock_movement 'order'
fulfilment_line     (fulfilment_id, order_line_id, store_id, seller_id NULL, quantity)

payment             (id, order_id, store_id, provider, provider_account_id, provider_ref, kind
                     ('card'|'wallet'|'upi'|'cod'|'bank_transfer'|…), state ('pending'|'authorised'
                     |'captured'|'failed'|'refunded'), amount, currency, created_at, captured_at)
                    -- webhooks idempotent through provider_ref (PLATFORM-PROMPT §5.4 Payments)
payment_refund      (id, refund_id, payment_id, store_id, provider_ref, state, amount, currency, created_at)

"return"            (id, store_id, order_id, number, state ('requested'|'received'|'refunded'
                     |'cancelled'), reason ('doesnt_fit'|'changed_mind'|'damaged'|'wrong_item'
                     |'not_as_described'), note NULL, label_sent_at,
                     received_at, cancelled_at, created_by, created_at)
                    -- the return label is an order_document row (kind 'return_label', return_id)
                    -- store-scoped; a supplier reaches a return only through its return_line
                    -- rows (ACCESS §7.3) and its serializer omits note, the store's free text;
                    -- number = 'R' + order number + '-' + n
return_line         (return_id, order_line_id, store_id, seller_id NULL, quantity,
                     destination_warehouse_id)
                    PRIMARY KEY (return_id, order_line_id)
                    -- destination follows the line owner's shipping mode (ACCESS §7.3)
refund              (id, store_id, seller_id NULL, order_id, return_id NULL, amount, currency,
                     reason ('returned'|'goodwill'|'cancelled'|'other'), restock boolean,
                     override_of_seller_id NULL, by_user_id, created_at)
                    -- seller_id = owner of the refunded lines (null = the merchant's own);
                    -- override_of_seller_id set when the store refunded a supplier's lines;
                    -- a supplier reads its own, overrides included, never another's, and
                    -- its serializer omits by_user_id ("the store") and, on override rows,
                    -- the free-text reason, which may name the shopper (ACCESS §7.3);
                    -- the isolation matrix tests both omissions
refund_line         (refund_id, order_line_id, store_id, seller_id NULL, quantity, amount, currency)
supplier_ledger_entry (id, store_id, seller_id, amount, currency, kind ('refund_override'
                     |'adjustment'), refund_id NULL, note, created_by, created_at)
                    -- what a supplier owes or is owed, settled outside the platform
                    -- (PLATFORM-PROMPT §5.4 Payments, decided 2026-10-02); a supplier reads
                    -- only its own entries and balance
```

```
order_document      (id, order_id, store_id, seller_id NULL, kind ('invoice'|'packing_slip'
                     |'label'|'return_label'|'gst_copy'), number NULL, asset_id, issued_at,
                     return_id NULL, fulfilment_id NULL)
                    -- every printable rendered from the order and invoice_settings, stored as
                    -- an asset so an issued invoice never changes; the link a deletion job
                    -- follows to purge them (§7.5). Store-and-seller class (§7.11): seller_id
                    -- is set only on a label or return_label a supplier printed for its own
                    -- part, so a supplier reads exactly those; invoices, packing slips and the
                    -- GST copy have seller_id null and are the merchant's alone
```

Order events (placed, paid, shipped, return started, refunded, "sent to warehouse by
Northwind") are activity-log entries with the order as target (LOGGING §3), which both the
order's timeline and the shopper's order history read; there is no `order_event` table.

### 7.7 Promotions (offers)

Store-scoped and the merchant's alone: no supplier branch in the policy, no supplier screen
(OFFERS fact 15). Status is derived, never stored (fact 9).

```
promotion           (id, store_id, name, internal_name NULL, description, enabled boolean,
                     starts_at NULL, ends_at NULL, total_uses_limit NULL, per_customer_limit NULL,
                     uses_count integer, combines_with jsonb, priority integer,
                     revision, created_at, updated_at, deleted_at)
                    -- OFFERS fact 1; uses_count maintained atomically with promotion_usage
                    -- (fact 8); combines_with per fact 7 (release: decide); internal_name
                    -- (release: decide); soft delete keeps past orders' adjustments (fact 14)
promotion_condition (id, promotion_id, store_id, operation, args jsonb, position)
                    -- operation ∈ OFFERS fact 3's keys: minimum_order_amount (amount per
                    -- currency in args), contains_products, at_least_n_with_filter_values,
                    -- customer_group, buy_x_get_y, contains_collection, first_order,
                    -- specific_customers, shipping_country…
promotion_action    (id, promotion_id, store_id, operation, args jsonb, position)
                    -- fact 4's keys; per-currency amounts in args (fact 10); targets resolve
                    -- at pricing time (fact 5, decide)
promotion_code      (id, promotion_id, store_id, code, single_use boolean, used_at NULL,
                     used_by_customer_id NULL, created_at)
                    UNIQUE (store_id, lower(code)) WHERE used_at IS NULL OR single_use = false
                    -- one row for a shared code, many for bulk single-use codes (fact 6);
                    -- matched case-insensitively (decide)
promotion_usage     (id, promotion_id, promotion_code_id NULL, store_id, order_id,
                     customer_id NULL, customer_email, discount_amount, currency, created_at)
                    UNIQUE (promotion_id, order_id)
                    -- counted from placed orders; guests recognised by email (fact 8, decide);
                    -- results (part P) aggregate this table
```

### 7.8 Storefront, publishing, design history and AI runs

Store-scoped (account level: the partner and staff read the publishing state, never the
content). Specified in SAAS §9 and storefront/ARCHITECTURE §4.2.

```
storefront          (store_id PK, kind ('ai'|'own'), repo, hosting_target, core_version,
                     preview_url, live_url, public_store_key, allowed_origins text[],
                     has_unpublished_changes boolean, changes_since NULL, changed_kinds text[],
                     changed_count integer, next_auto_publish_at, updated_at)
                    -- change detection as a table, not memory (SAAS §9.1); public_store_key
                    -- is the one credential safe in a browser (PLATFORM-PROMPT §5.5)
publish_run         (id, store_id, kind ('manual'|'automatic'|'staff'|'design'), state ('queued'
                     |'building'|'deploying'|'live'|'failed'), uses_allowance boolean,
                     started_by, started_at, finished_at, deploy_ref, error, build_minutes)
                    -- one running per store (partial unique); a failed run never uses the
                    -- allowance (decided); uses_allowance only for 'manual'
design_version      (id, store_id, number, commit, summary, prompt, preview_asset_ids uuid[],
                     state ('previewed'|'approved'|'live'|'discarded'|'reverted'), approved_at,
                     live_at, reverted_to_id NULL, created_at)
                    -- PortalStorefront history: "Go back to version N" is a revert commit
                    -- and a new live version (SAAS §9.2 undo)
ai_run              (id, store_id, requested_by, design_version_id NULL, prompt, model,
                     tokens_in, tokens_out, cost_amount, cost_currency, build_minutes,
                     gate_results jsonb, outcome ('approved'|'discarded'|'failed'), created_at)
                    -- SAAS §9.2 metering; the AI budget meter reads it
store_usage         (store_id, period_start, meter ('publish_now'|'ai_prompts'|'build_minutes'
                     |'ai_cost'), count bigint)   PRIMARY KEY (store_id, period_start, meter)
                    -- SAAS §6.2: atomic, reset per billing period
store_entitlement_override (id, store_id, key, value, reason, set_by_kind, set_by_id,
                     expires_at NULL, created_at)   -- SAAS §6.1 per-store overrides
```

### 7.9 Merchant billing

Store-scoped at account level (the partner reads status; staff read everything). The money
model is SAAS §7: Stripe Billing on DripFunnel's account, the partner's or DripFunnel's own
plans. Distinct from the store's own `payment_provider_account` rows (flow 61).

```
store_subscription  (store_id PK, plan_id, plan_version, status ('trial'|'active'|'past_due'
                     |'cancelled'), interval ('month'|'year'), currency, amount,
                     period_start, period_end, trial_ends_at, cancel_at NULL,
                     stripe_customer_id, stripe_subscription_id, payment_method_label,
                     payment_method_brand, payment_method_last4, payment_method_expires,
                     updated_at)
                    -- currency is the store's when USD, EUR or INR, else USD (SAAS §6.1);
                    -- the card is Stripe's: brand, last 4 and expiry only
store_billing_details (store_id PK, legal_name, address jsonb, tax_id NULL, tax_id_kind
                     ('gstin'|'vat'|NULL), email, updated_at)   -- SAAS §7.2, Owner-only
invoice             (id, store_id, number, kind ('subscription'|'proration'|'setup'|'usage'
                     |'credit'), status ('paid'|'open'|'void'|'refunded'), amount, tax_amount,
                     currency, tax_label, reverse_charge boolean, billing_details jsonb,
                     issued_at, paid_at, pdf_asset_id NULL, stripe_invoice_id)
                    -- billing_details is a snapshot; issued invoices never change
invoice_line        (id, invoice_id, store_id, label, amount, currency, period_start NULL, period_end NULL,
                     kind ('plan'|'proration_charge'|'proration_credit'|'setup'|'usage'))
                    -- a plan change is one invoice with a charge and a credit line (SAAS §7.2)
billing_event       (id PK = Stripe event id, store_id NULL, partner_id NULL, type, received_at,
                     handled_at)                                   -- SAAS §7.2 idempotency
```

**Built, and to reconcile**: `plan.trial_days` (migration `0007`) is checked against
`(0, 7, 14, 30)`, while the house partner's plans carry a 10-day trial (SAAS §6.1, decided
2026-10-02). PAPI 3 (#157) widens the constraint, or makes it a positive integer, when it adds
the plan's prices and entitlements.

### 7.10 Integrations, jobs and requests

```
api_key, app_grant  §3.5 (store-scoped, optional seller binding)
webhook_endpoint    (id, store_id, url, events text[], secret_enc, status ('active'|'disabled'
                     |'failing'), failing_since NULL, created_by, created_at)
webhook_delivery    (id, endpoint_id, store_id, outbox_id, event, attempt, status ('pending'
                     |'delivered'|'failed'), response_code, delivered_at, next_attempt_at)
                    -- PLATFORM-PROMPT §5.5: delivered from the outbox, replayable, endpoint
                    -- disabled after repeated failure
external_connection (id, store_id, provider ('shopify'), token_enc, shop_domain, status,
                     connected_by, connected_at, expires_at)       -- CATALOG K7
import_job          (id, store_id, seller_id NULL, kind ('csv'|'shopify'), state ('validating'
                     |'ready'|'running'|'paused'|'done'|'failed'), source_asset_id NULL,
                     connection_id NULL, warehouse_id, match_mode ('update'|'skip'),
                     total integer, done integer, imported integer, skipped integer,
                     problems_asset_id NULL, started_by, started_at, finished_at)
                    -- CATALOG K; runs in the background and survives the page (CatImport);
                    -- every imported row writes stock_movement 'import'
export_job          (id, store_id, seller_id NULL, kind ('products'|'orders'|'customers'
                     |'offer_uses'|'codes'|'report'|'store_data'), filter jsonb, columns text[],
                     state, row_count, file_asset_id NULL, expires_at, started_by, created_at)
                    -- every CSV the prototype downloads; a supplier's export is its own rows
                    -- only; files expire (expires_at, days not weeks) and a deletion request
                    -- purges earlier the ones that contain the person (§7.5)
access_request      (id, store_id, by_user_id, kind ('feature'|'area'), what, created_at,
                     resolved_at NULL, resolution ('acted'|'dismissed') NULL, resolved_by NULL)
                    -- "Send request" from a Manager or Staff, shown on the Owner's Home
```

`job` and `job_detail` (§2.1) stay the SaaS layer's: provisioning and fleet. Import and export
have their own tables because the merchant reads them, a supplier may own one, and their
columns are nothing like a provisioning run's.

### 7.11 Row-level security and indexes for §7

Three policy classes, named per table so the isolation tests (ACCESS §11.1) are written
against this list and nothing else:

- **Store-and-seller** (§5.2; a supplier reads and writes `seller_id = app.seller_id` only,
  the merchant everything): `product` and every child in §7.3 that carries `seller_id`
  (options and values, versions, prices and price history, per-market prices, photos, video,
  market rules, flags, compliance, specs, FAQs, related, badges, filter assignments, the
  approval snapshot), `product_story`, `size_chart`, `size_chart_rule`, `translation`,
  `asset`, `warehouse`, `stock_level`, `stock_movement`, `order_line`, `order_part`,
  `fulfilment`, `fulfilment_line`, `return_line`, `refund`, `refund_line`,
  `supplier_ledger_entry`, `order_document` (a supplier reads only the labels it printed for
  its own parts; invoices and packing slips carry a null owner and never reach it, a matrix
  row of its own), `import_job`, `export_job`. **No partner or platform branch** on
  any of them: a partner never reads a supplier's import problems or a store's catalogue.
- **Inside the store, with a supplier read branch through its own parts**: `order` and
  `return`. The policy admits a row to a supplier role only when a part or line of its own
  exists for it: `app.seller_id = '' OR EXISTS (SELECT 1 FROM order_part p WHERE p.order_id =
  "order".id AND p.seller_id = app.seller_id)` (and the same over `return_line` for
  `return`), indexed on `(order_id, seller_id)`. The supplier's serializer then applies the
  rule of the mode **stored on the part** (`order_part.shipping_mode`) to the fields it
  returns (ACCESS §7.3): nothing of the shopper for
  `to-store`, name and delivery address for `to-shopper`, never totals, never
  `order_adjustment`.
- **Inside the store, no supplier branch at all**: `order_adjustment`, `payment`,
  `payment_refund`, `customer`, `customer_address`, `customer_group`,
  `customer_group_member`, `customer_data_request`, `promotion` and its children,
  `collection` and its children, `menu`, `menu_item`, `badge` (definitions), `story_block`,
  `access_request`, `webhook_endpoint`, `webhook_delivery`, `external_connection`, every
  settings table in §7.2, `store_billing_details`. The
  credential columns among them (`webhook_endpoint.secret_enc`,
  `external_connection.token_enc`, the `credentials_enc` and `webhook_secret_enc` of
  courier and payment accounts) follow §2.1: readable by `app_system` only. `filter` and `filter_value` are the one exception: a supplier reads them
  (it assigns values to its own products) and writes none (CATALOG L9 keeps whether it may
  see collections *(ask)*).
- **Account level** (the partner and platform branches §2 gives account-level tables, for
  state only, never content): `storefront`, `publish_run`, `design_version` and `ai_run`
  **with a column rule, as §5.3 has for credentials**: the partner and platform branches
  read state, dates, numbers, cost, tokens, build minutes and outcome through a metering
  view, and never `design_version.prompt`, `design_version.summary`,
  `design_version.preview_asset_ids`, `ai_run.prompt` or `ai_run.gate_results`, which only
  the store scope selects (a merchant's design prompts are store content, USERS-AND-DOMAINS
  §4); `store_usage`,
  `store_entitlement_override`, `store_subscription`, `invoice` and `invoice_line` (status
  and amounts for the partner that bills; `store_billing_details` stays store-only),
  `custom_domain`, and `billing_event`, which is cross-scope and
  append-only like §2's `activity_log` row (a Stripe event names a store or a partner, and
  only the SaaS layer writes it). Nothing else in §7: a table in none of these classes is a
  gap the structural test (§5.4) reports.
- **The Shop API's `shop` scope** reads visible catalogue rows, filters, collections and
  menus, its own customer's rows, and its own cart and orders. "Its own" on `"order"` is
  `customer_id = app.customer_id OR (customer_id IS NULL AND access_token_hash =
  app.order_token_hash AND app.order_token_hash <> '')`, so a guest holds exactly the carts
  and orders whose token it presents and never another guest's; the children (`order_line`,
  `order_adjustment`, `order_part`, `fulfilment`) follow through the order. The isolation
  matrix has the row: two guests in one store, each reading only its own cart and order,
  including the email, phone and address snapshots. It never reads `seller_id` as data, only
  as attribution where the merchant shows it.
- Every policy's columns lead an index; list screens get a composite on
  `(store_id, <filter>, created_at desc, id desc)` for keyset paging (ui/admin/FIRST-RELEASE
  §12); the supplier-branch `EXISTS` on orders and returns is backed by `order_part
  (order_id, seller_id)` and `return_line (return_id, seller_id)`.
