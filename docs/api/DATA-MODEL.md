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
| **Platform** | none | Admin API only | `staff_user`, `staff_session`, `impersonation`, `partner_setup_session`, `partner_approval`, `platform_setting`, `entitlement_ceiling`, `feature_flag`, `store_note` |
| **Partner** | `partner_id` | Its partner's users; Admin API | `partner`, `partner_user`, `partner_session`, `partner_invitation`, `partner_domain`, `partner_setup_item`, `plan`, `plan_entitlement` |
| **Store (account level)** | `store_id` (and `store.partner_id`) | The store's people; its partner's users; Admin API | `store`, `store_subscription`, `custom_domain`, `job`, `storefront`; **`membership`, `user` and `seller` at account level** — names, roles and status, for the owner, contacts, the Users tab and support sessions (ui/admin/FIRST-RELEASE.md §5.2, ui/platform/FIRST-RELEASE.md §6.3, §12.1; corrected on #32). A supplier still reads only its own `seller` row (ACCESS.md §5.5) |
| **Store (inside the store)** | `store_id` | The store's people and callers only; **never** partner users, and staff only by impersonating | `invitation`, `order`, `return`, `collection`, `offer`, `customer_group`, `badge`, `access_request`, `api_key`, `webhook` (§2.2) |
| **Store (customer accounts)** | `store_id` | As inside the store, **plus a read-only `platform` branch** for the admin console's Customers menu (decided 2026-09-28); never a partner branch | `customer` |
| **Store and seller** | `store_id`, `seller_id` null (null = the merchant's own) | As above, and a supplier only its own `seller_id` | `product`, `warehouse`, `stock_level`, `stock_movement`, `order_part` (per-supplier part of an order), `return_line`, `refund`, `refund_line`, `supplier_ledger_entry` (§2.2: a supplier reads only the refunds of its own lines, overrides against it included, and only its own ledger entries; never another supplier's, nor their counts) |
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

The Store prototype's update (`designs/INCOMPLETE-FEATURES.md` §4) and the decisions recorded
in ACCESS.md §1 need these. **Named, not designed**: columns are the ones the prototype shows;
each table gets its full design on the engine card that builds it, following §2. Every
`amount` is an **integer in minor units** with the `currency` beside it (AGENTS.md "Data";
PLATFORM-PROMPT §5.4 Money), never a float or a bare number. Every store-and-seller row here
is one the isolation matrix (ACCESS.md §11.1) must cover: two suppliers in one store, each
reading refunds, return lines and ledger entries, and seeing only its own, with the
supplier-facing serializer omitting what the row's rule says it omits.

| Table | Scope | Holds | Decided by |
|---|---|---|---|
| `store` + `time_zone`, `unit_system` (`metric`, `imperial`), `order_prefix`, `next_order_number` | store | Settings › Store info | PLATFORM-PROMPT §3.3 |
| `seller.shipping_mode` (`to-store`, `to-shopper`), column added to the §3.3 block | store | How the supplier ships, set by the merchant | ACCESS.md §5.2, §7.3 |
| `customer` + `tags text[]`, `note`, `consent_state` (`opted_in`, `stopped`, `declined`, `not_asked`), `consent_at`, `consent_source` (`checkout`, `email`, `added_by_hand`, `recorded_by_store`), `added_by_user_id` null | store (customer accounts) | Tags, the team-only note, marketing consent, hand-added customers | PLATFORM-PROMPT §5.4 Customers |
| `customer_group(id, store_id, name, description)`, `customer_group_member(group_id, customer_id)` | store | Groups offers target; unique name per store | OFFERS-DESIGN fact 12 |
| `stock_movement(id, store_id, seller_id, product_id, version_id null, warehouse_id, delta, resulting_quantity, reason, source_kind, source_id, actor, created_at)` | store and seller | The ledger; reasons `received`, `returned`, `damaged`, `counted`, `typed`, `order`, `import`, `starting` | PLATFORM-PROMPT §5.4 Inventory |
| `return(id, store_id, order_id, state, reason, label_sent_at, received_at)` | store | The store's record; states `requested`, `received`, `refunded`, `cancelled`. **`reason` is coded** (`doesnt_fit`, `changed_mind`, `damaged`, `wrong_item`, `not_as_described`, the prototype's five), never free text, so nothing a supplier reads can name the shopper; any note the store adds is a store-only column the supplier serializer omits. A supplier reaches a return only through its own lines (a derived read, ACCESS.md §3.3), never the whole return | ACCESS.md §7.3 |
| `return_line(return_id, store_id, seller_id null, order_line_id, quantity, destination_warehouse_id)` | store and seller | `seller_id` is the line owner's, copied from the order line; the destination follows that owner's shipping mode | ACCESS.md §7.3 |
| `refund(id, store_id, seller_id null, order_id, amount, currency, reason, restock, override_of_seller_id null, by_user_id, created_at)`, `refund_line(refund_id, store_id, seller_id null, order_line_id, quantity, amount)` | store and seller | `seller_id` is the owner of the refunded lines (null = the merchant's own); a supplier reads its own, including an override the store made against it (`override_of_seller_id` = its id); never another supplier's. **The supplier serializer omits `by_user_id` (the supplier sees "the store") and, on override rows, the free-text `reason`**, which may name the shopper a `to-store` supplier must never see (ACCESS §7.3); the isolation matrix tests both omissions | ACCESS.md §7.3 |
| `supplier_ledger_entry(id, store_id, seller_id, amount, currency, kind, refund_id null, note, created_at)` | store and seller | What a supplier owes or is owed, settled outside the platform; the first `kind` is `refund_override`. A supplier reads only its own entries and balance, and **its serializer omits `note`** (the store's free text, which may name the shopper); the supplier sees the kind, the amount and the refund it points at. The isolation matrix tests the omission | PLATFORM-PROMPT §5.4 Payments |
| `product` + `hidden_by` (`seller_suspended`, `seller_removed`, null), `status_before_hide` | store and seller | Set when a supplier is suspended or removed; resuming restores `status_before_hide` where `hidden_by = 'seller_suspended'` and clears both | ACCESS.md §7.5 |
| `badge(id, store_id, label, rule, …)` and `product_badge(product_id, badge_id)` | store | Rules `new_30_days`, `top_5_this_month`, `below_compare_price`, `few_left`, `manual`; only `manual` badges are picked per product | CATALOG-DESIGN S5 |
| `product_market_price(product_id, market_id, amount, currency)` | store and seller | A fixed price per market for a product without versions (Business plan); absent means the main price with the market's adjustment | CATALOG-DESIGN O13 |
| `custom_domain` + `state` (`dns`, `verifying`, `cert`, `live`, `failed`), `last_checked_at`, `checks_until` | store (account level) | The portal's four steps; checked every 15 minutes for 3 days | SAAS.md §8 |
| `access_request(id, store_id, by_user_id, kind (`feature`, `area`), what, created_at, resolved_at null, resolution (`acted`, `dismissed`))` | store | A Manager's or Staff's "Send request" that lands on the Owner's Home | ACCESS.md §5.1 |
| `user` + `two_factor_method` (`app`, `sms`, null), `two_factor_enrolled_at`, `theme` (`light`, `dark`, null); `user_backup_code(user_id, code_hash, used_at null)`; `user_session` + `device_label`, `user_agent` | partner (people pool) | 2-factor, backup codes and "Where you're signed in" (§3.3) | ACCESS.md §2, §4 |

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
            -- decided 2026-10-02); copied onto the order's part at placement

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
| `app_request` | Every API request | DML under RLS; no `BYPASSRLS`; insert-only on `activity_log` and `outbox`; no `select` on credential columns (§2.1: password and 2-factor secret hashes, backup-code hashes, invitation token hashes) |
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
