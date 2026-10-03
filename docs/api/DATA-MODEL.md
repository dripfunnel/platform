# DATA-MODEL.md: tenancy, identity and roles

How the database stores the tenancy tree (DripFunnel → partners → stores → suppliers and
customers), every kind of user and their roles, how Postgres row-level security backs
up the application's scoping, and (§7) the merchant-side tables: settings, catalogue, stock,
customers, orders, offers, storefront, billing and integrations, each following §2.

Rules behind this document: [ACCESS.md](ACCESS.md) (identities, roles, permissions),
[SAAS.md](SAAS.md) (partners and stores), [LOGGING.md](LOGGING.md) (activity log).
Table and column names are *(proposed)* until each module's migration (§2.1 and §3 for what is built, §7 for the rest); the structure is decided.

Last updated: 2026-10-03.

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
| **Platform** | none | Admin API only | `staff_user`, `staff_session`, `impersonation`, `partner_setup_session`, `partner_approval`, `platform_setting`, `plan_ceiling` (§2.3; read by partners too), `feature_flag`, `store_note`, `app` (§7.10) |
| **Partner** | `partner_id` | Its partner's users; Admin API | `partner`, `partner_user`, `partner_session`, `partner_invitation`, `partner_domain`, `partner_setup_item`, `plan`, `plan_version`, `plan_price`, `plan_entitlement`, `plan_fee`, `partner_contract`, `partner_contract_rate` (§2.3), `partner_branding` (§2.5), `partner_domain_record` (§2.1), `export_job` (§2.6), `signup` (§7.10) |
| **Store (account level)** | `store_id` (and `store.partner_id`) | The store's people; its partner's users; Admin API | `store`, `store_subscription`, `store_limit_override`, `store_trial_extension`, `store_usage` (§2.4), `custom_domain`, `job`, `storefront`; **`membership`, `user` and `seller` at account level** — names, roles and status, for the owner, contacts, the Users tab and support sessions (ui/admin/FIRST-RELEASE.md §5.2, ui/platform/FIRST-RELEASE.md §6.3, §12.1; corrected on #32). A supplier still reads only its own `seller` row (ACCESS.md §5.5) |
| **Store (inside the store)** | `store_id` | The store's people and callers only; **never** partner users, and staff only by impersonating | `invitation`, `order`, `return`, `collection`, `promotion`, `customer_group`, `badge`, `access_request`, `api_key`, `webhook_endpoint`: the full list is §7.11's second and third classes |
| **Store (customer accounts)** | `store_id` | As inside the store, **plus a read-only `platform` branch** for the admin console's Customers menu (decided 2026-09-28); never a partner branch | `customer` |
| **Store and seller** | `store_id`, `seller_id` null (null = the merchant's own) | As above, and a supplier only its own `seller_id` | `product` and its children, `warehouse`, `stock_level`, `stock_movement`, `order_line`, `order_part`, `fulfilment`, `return_line`, `refund`, `refund_line`, `supplier_ledger_entry`, `import_job`, `export_job`: the full list is §7.11's first class (a supplier reads only the refunds of its own lines, overrides against it included, and only its own ledger entries; never another supplier's, nor their counts) |
| **Cross-scope, append-only** | `partner_id`, `store_id`, `seller_id`, `customer_id` where relevant | Per LOGGING.md §6; `outbox` is insert-only for requests and read by the relay alone; `billing_event` is written by the SaaS layer alone | `activity_log`, `outbox`, `billing_event` (§7.9) |

- **Unique constraints are per scope**: SKU, web address and coupon code per store; customer
  email and phone per store; user email per partner. Never global.
- **"Inside the store" vs "account level"** is what keeps partners and staff out of a
  merchant's catalogue, orders and customers (USERS-AND-DOMAINS §4): the RLS policy on
  those tables has no partner or platform branch at all.

### 2.1 Partners and stores as built (#32)

Migration `0007` gives `partner` and `store` their business columns and adds the account-level
tables above (`partner_user`, `partner_invitation`, `partner_domain`, `partner_setup_item`,
`plan`, `custom_domain`, `user`, `membership`, `invitation`, `job`, `store_note`).

- **Partner**: `name` (unique among partners that aren't closed, ignoring case and outer
  spaces, `0031`, #61), `is_house` (one row, by a partial unique index), `kind`, `region`,
  `country`, `state` (SAAS.md §3.1) with the facts of each state (`submitted_at/by`,
  `sent_back_reason`, `approved_at`, `paused_at`, `pause_reason`), the published look the admin
  console shows (`product_name`, colours, `powered_by`) and `fallback_sender_accepted`. PAPI 3
  adds the versioned branding and prices.
- **Partner team** (`0022`, #199): `partner_user.status` gains `removed` (signed out, never signed
  in again, still named in the log); a partner reads `two_factor_enrolled_at` and sets
  `partner.second_factor_required`; `end_partner_user_sessions(user)` (owned by `app_definer`)
  ends its own users' sessions, since a partner role never touches `partner_session`.
- **Partner addresses' records** (`0020`, #197): `partner_domain_record` (domain, partner,
  position, `purpose` pointer | ownership | spf | dkim | dmarc, `record_type` CNAME | TXT | A,
  the name to resolve, `expected`, `found`, `checked_at`). The portal and wildcards have one
  pointer record (an A record for a root portal domain); the email sender has SPF, DKIM and DMARC
  (SAAS §3.6); every address added from #197 on also has an ownership TXT
  (`_dripfunnel.{host}` = `dripfunnel-verify={token}`, a token per address). An address is live
  once every record matches, SPF by including ours and DMARC by being one. Since a claim proves
  nothing until its token is found, `partner_domain_host_key` holds a host only for addresses
  past waiting and failed; a second claim that verifies later fails. `partner_domain.record_type`/`expected` stay
  the first record's. A partner inserts its own address (waiting and unchecked only, by a
  restrictive policy) and records but holds no `update` on
  `partner_domain`, so only the check (`app_system`) and staff write a status. A trigger keeps
  a record on its address's partner.
- **Store**: `name`, `code` (unique per partner, used in hostnames), `country`, `status`
  (SAAS.md §4.2 plus `closed`) with its facts (`trial_ends_at`, `past_due_since`, the
  suspension's time, reason, who and **the status it had before**, so Restore returns to it),
  `plan_id`, `storefront_kind` (`ai` or `own`), `build_state`, `core_version`, last build and
  publish, and `support_access_allowed` (the merchant's standing consent, USERS-AND-DOMAINS §4.1,
  a column; there is no support-access table).
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
  own number** (My profile; SMS 2-factor is sent to it). **Not built yet; the design is**: a
  column grant cannot be limited to one row, so the exception is a pair of `security definer`
  functions owned by the migration role, `own_phone()` and `set_own_phone(text)`, that act
  only on the row whose `id` equals the session's `app.user_id` (§5.1, a setting the
  `RlsSettings` in `db/rls/settings.ts` gains with it). Because `"user"` is `FORCE ROW LEVEL
  SECURITY` and its update policy admits only the platform and system scopes, the definer
  needs an own-row policy too: `user_update_own` for store scope on `id = app.user_id`.
  Written the way such functions must be: a pinned `search_path` (`pg_catalog, public`, as
  0007's `membership_check_parents()` pins its own), `revoke execute … from public` then
  `grant execute` to the two roles a signed-in person of the people pool runs as,
  `app_request` and `app_supplier` (§5.3), `set_own_phone` validating E.164 and refusing
  anything else, and an empty `app.user_id` matching no row (no session, no phone).
  `app_request` keeps no `select` or `update` on the column. The isolation matrix has the
  rows: user A, holding user B's id, can neither read nor write B's phone; and a call with an
  empty `app.user_id` returns nothing and changes nothing. No other screen shows a merchant
  user's phone.
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

### 2.3 The plan catalogue (built on #157)

Migration `0013`, from SAAS §6.1 and §6.3 and the prototype's Plans screens:

```
plan_version         (plan_id, partner_id, version, trial_days, created_at, created_by_kind,
                      created_by_label)          PK (plan_id, version); plan.version is current
plan_price           (plan_id, partner_id, version, currency, monthly_amount NULL,
                      yearly_amount NULL)        -- minor units; null is "Not priced"
plan_entitlement     (plan_id, partner_id, version, key, enabled NULL, amount NULL)
                     -- a switch key holds enabled, a limit or monthly allowance holds amount
plan_fee             (plan_id PK, partner_id, amount, currency)   -- DripFunnel's wholesale fee
                     -- per store per month; (partner_id, currency) references the contract's
                     -- fee currency, which cannot change while fees are stated in it; no
                     -- store policy at all
plan_ceiling         (key PK, amount)                   -- DripFunnel's maximum per limit
partner_contract     (partner_id PK, fee_currency, powered_by_removable, powered_by_note
                      ('contract'|'firstYear'))
partner_contract_rate (partner_id, currency, per_fee_unit numeric)   -- a rate, not money
```

- **Keys**: switches `custom_domain`, `offers`, `suppliers_enabled`, `powered_by_removal`,
  `aplus`, `size_charts`; limits `products`, `staff`, `suppliers`, `languages`, `currencies`;
  monthly allowances `publish_now`, `ai_prompts` (the prototype's thirteen rows). Build
  minutes and AI cost are meters with no plan value yet.
- **An edit is a version** (`db/scoped/plans.ts` `insertPlanVersion`): prices, trial and
  entitlements are written under `plan.version + 1`, taken under the plan's row lock, and
  `plan.version` moves to it. Versions are **insert-only**: no role holds `update` on the three
  version tables, so a subscription keeps exactly the version it bought (§7.9's
  `store_subscription.plan_version`). `plan.version` always names an existing version (a
  deferred foreign key): a trigger owned by `app_definer` writes version 1 for every plan
  inserted, by whatever role, so the release still live keeps working, and `0013` gave every
  plan already built a version 1 with its trial and no prices. Name, description and status
  stay on `plan`; `retire_move_to_plan_id` can only name a plan of the same partner.
- **Ceilings are enforced in the database**: a trigger refuses any `plan_entitlement` amount
  above `plan_ceiling` for its key, whoever writes it (SAAS §6.1), and `powered_by_removal`
  switched on unless the partner's contract allows it (no contract: not allowed). Another
  refuses any request role moving `plan.version` other than forward by one, or changing
  `plan.trial_days` without a new version. A merchant reads `plan_version` by column, never
  `created_by_*`. A check holds each key to
  its kind: a switch has `enabled` and no `amount`, a limit or allowance the reverse.
- **The entitlements are authoritative.** `plan.max_products` and `max_staff` (#32) are what
  the admin console's plan list still reads; they stop being written once #161 serves the
  catalogue, and a later migration drops them.
- `plan.trial_days` is `0..90` (was `0, 7, 14, 30`), so the house plans' 10 days fit.
- **Who reads what**: the partner reads and writes its own versions, and reads its own fee,
  contract and rates and every ceiling; the fee, the ceilings and the contract are written by
  staff only. A merchant reads its own store's plan versions in store scope only (SAAS §13
  "read own plan"; never a storefront, never a supplier) and never the fee. Every child carries `partner_id`, held to the plan's by composite keys, and
  the four role pins (§5.3).
- The paused-by-plan state of SAAS §6.2 is on the paused rows themselves (§7.1), so the
  catalogue holds only values; `saas/entitlements` counts paused items outside the limit.

### 2.4 Store account fields (built on #212)

Migration `0014`, for what the partner console's Stores list and store detail read beyond #32:

- **`store_subscription`** exactly as §7.9 designs it, pointing at the plan **version** (§2.3),
  with `next_plan_id`, `next_plan_version` and `change_at` for a scheduled change. It carries
  `partner_id` so its composite keys hold the store and both plan versions to one partner
  (foreign keys skip RLS). Billing (`app_system`) and staff write it; a partner writes only the
  schedule (`next_plan_id`, `next_plan_version`, `change_at`, migration `0015`, #161), when
  a plan change applies at renewal or a retired plan moves its stores, and since migration
  `0018` (#160) a trial's end. A plan change "now" goes through `partner_move_subscription`
  (owned by `app_definer`): its own store, a Live plan of its own, that plan's current version
  at that version's price, never an amount the caller names. It adds what the move prorates,
  which it holds to the price difference's sign and size and to zero on trial,
  to `proration_amount` (minor units of the subscription's currency, above zero charged,
  below zero credited, with `proration_at`) for billing (#201) to collect. A partner reads it by
  column (status, amounts, periods, the scheduled change, the card's last four); the merchant
  also reads the card's brand and expiry; neither reads the Stripe ids or the payment-method
  label. A store built before #212 has no row until billing (#201) creates one. `core/tenancy.ts`'s
  `Subscription` now uses §7.9's spellings (`trial`, `cancelled`).
- **`store_limit_override`** (key, amount, `month` or `always` with the month it applies to,
  reason, who, when, `removed_at`) and **`store_trial_extension`** (days, the new end,
  reason, who, when): SAAS §6.1's per-store overrides, added by the partner for its own
  stores or by staff, and never rewritten. A trigger pins `created_by_kind` to the writing
  role (a partner writes `partner_user`, staff `staff`) and lets an override be removed once,
  with who removed it, and not changed after. The merchant reads both by column (key,
  amount, duration, month, days, dates), never the partner's reason or who wrote it.
  `selectOverrides` and `selectTrialExtensions` (`db/scoped/storeAccount.ts`) are the partner's
  and staff's reads, with why and who, paged newest first by keyset; the merchant's own read
  arrives with the Store API card that serves it.
- **`store_usage`** (store, key, used, `period_start` for a meter): the stored counter behind
  "4,210 of 5,000 products", written where the work happens (by `app_system`), never a
  count across tenants. Paused items (§7.1) are not counted.
- **`partner.billing_mode`** (`dripfunnel` | `own`, SAAS §7.1) and **`store.billing_status`**
  (`active` | `past_due` | `suspended`). A trigger refuses any change to the status unless
  the store's partner bills its own merchants, whoever the writer is.
- Account level (§2): the store's merchant side reads its own rows in store scope; a supplier
  or a storefront reads none; the partner its own stores' (through the store policy); staff
  and jobs everything. The four role pins are on each table.
- The store actions (`0018`, #160, ui/platform/FIRST-RELEASE.md §6.4): a partner may also insert
  an owner invitation on its own store and revoke one (never a team member's or a supplier's,
  never the token), and restart its own store's latest setup job when it is failed or running
  (state, step start, attempts, error), back to running only.
- Indexes for FIRST-RELEASE §6.1: `(partner_id, status)`, `(partner_id, plan_id, created_at)`,
  `(partner_id, created_at)`, `(partner_id, storefront_kind, build_state)`, `store_usage (key,
  store_id)`, and the trigram indexes on store name and code, owner email and domain host.

### 2.5 The partner's look and words (built on #211)

Migration `0016`, from SAAS §3.3–§3.4 and the prototype's Branding screens:

```
partner_branding  (id, partner_id, state ('draft'|'published'|'cancelled'), product_name, primary_color,
                   accent_color, font, corner, background, logo_light_key, logo_dark_key,
                   mark_key, favicon_key, support_email, support_url, help_url, terms_url,
                   privacy_url, dpa_url, impressum, powered_by, created_by_kind,
                   created_by_label, created_at, published_at, published_by_label)
```

- **At most one draft per partner** (a partial unique index). The **live** version is the newest
  published one whose `published_at` has passed; one published with a later time is
  scheduled (F8). Every published version is kept, which is the history FIRST-RELEASE §8.4
  reads; a rollback publishes a copy.
- **What changes** is held by a trigger, for the partner, staff and jobs alike. A version
  starts as a draft. A draft is edited or published no earlier than now, so history is never
  back-dated. A scheduled version (published, not live yet) may only be **cancelled**, nothing
  else about it changing. A live or past version is never changed. Anything not a draft carries
  who published it and when (a check constraint).
- The files are R2 object keys, never a URL a browser was given; colours are `#RRGGBB`; the font,
  corner and background come from the prototype's lists.
- The partner reads and writes its own, inserting under its own kind (`partner_user`); staff and
  jobs reach every partner's; no merchant role has a grant (the portal's look is resolved by
  hostname, SAAS §3.3, on the Store API card that serves it). The four role pins are on the
  table.
- `partner.product_name`, `primary_color`, `accent_color` and `powered_by` (#32) stay what the
  admin console's lists read; a publish (#162) keeps them equal to the live version, the
  partner role holding `update (powered_by)` for it (`0017`). A trigger holds that write to the
  contract: a partner never sets or leaves `house`, and turns it `off` only when
  `partner_contract.powered_by_removable` allows it. A second trigger holds `partner_branding`
  the same way: a partner may draft without the line, but publishes it off only when allowed.

---

### 2.6 Export jobs (built on #198)

`export_job` (migration `0021`; `report` added by `0023`, #200; `stores` by `0026`, #221;
`staff_activity` by `0028`, #38): the partner (null only for a staff export, a check holds it),
`kind` (`activity`, `report`, `stores`, `staff_activity`), the filter as asked, `state` (queued,
done, failed, or `too_large` for a staff export past its cap), the row count and whether it was
cut, the CSV, the `cursor` a chunked export resumes from, who asked, and when it was created,
finished and expires.

- **A partner's export** (`activity`, `report`, `stores`): the partner inserts and reads its own,
  and its `export.*` job runs in that partner's scope and writes the result in one delivery
  (`stores` cuts at 10,000 rows and says so).
- **A staff export** (`staff_activity`): no partner; asked for, and read back by its id, by staff
  holding `activity.export` (Super admin and Engineer on call, who see every partner). Its job
  reads the log as the staff member who asked, a chunk per delivery, keeping the file so
  far and the `cursor` on the row between chunks; past LOGGING §6's 100,000 entries it ends
  `too_large`, never as a partial file. Every chunk first checks that the requester is still
  active and still holds `activity.export`, and fails the job if not.

Any export ends `failed` after the outbox's last attempt (the cron also fails a queued job whose
`export.*` outbox row the relay gave up on, a timeout included); the per-minute cron deletes an
export an hour after it finishes (failed included), and one never finished after a day. The CSV
lives on the row because no R2 bucket is bound yet; a file key replaces it when one is. The four
role pins are on the table.

## 3. Identity pools

### 3.1 DripFunnel staff (platform)

```
staff_user     (id, sso_subject NULL UNIQUE, email, name, role_key, status, last_sign_in_at NULL,
                two_factor NULL, created_at)
                 -- status: active | invited | suspended | removed. An invited member has no
                 -- sso_subject until they accept; a removed one keeps the row the log names (#39).
                 -- A staff request may set status only to removed; activation is sign-in's
staff_invitation (id, staff_user_id, token_hash NULL UNIQUE, sent_at, expires_at, accepted_at NULL,
                  revoked_at NULL, invited_by_staff_id, created_at)
                 -- 7 days, single use, a resend revokes the open one (#39); the email's
                 -- deliverer writes the hash, never readable by a staff request
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
                  absolute_expires_at)   -- same session model as user_session; no "Remember me"
```

`role_key` ∈ `partner-owner`, `partner-admin`, `partner-support`, `partner-finance`,
`partner-read-only` (ACCESS.md §5.3, decided on #109). A partner's first user is its Owner.
**Built on #32**: `partner_user` (with `status`, `last_sign_in_at`) and `partner_invitation`
(token hash, expiry, `sent_at` null while held, who invited, accepted, revoked); PAPI 2 fills
the password and 2-factor columns (**built on #156**, with `two_factor_enrolled_at`,
`failed_code_count`, `locked_until`, `last_code_step` beside them, granted to no request role,
`partner.second_factor_required` for the Owner's switch, and `partner_session.stage` and
`pending_secret_enc` for the step between password and code). **Built on #155**: `partner_session` as above, its hash
read and written by `app_system` alone (no request role has a grant). A partner adds team
members and invitations by column only: never a password hash, a 2-factor secret, a lock
column or an invitation token, which only sign-in and the deliverer write (as `app_system`).
`partner_session` has no `remember` column: the partner sign-in screen offers no "Remember
me" (ui/platform/FIRST-RELEASE.md §3). An email may belong to at most three partners' teams,
refused by a trigger at the fourth (ACCESS.md §2) with a refusal that names no other partner,
counted under a per-email lock; `lower(email)` is indexed for it and for sign-in.
**Built on #208**: `partner_password_reset(id, request_id, partner_id, partner_user_id,
token_hash NULL UNIQUE, expires_at NULL, used_at NULL, created_at)`, `app_system` alone, unique
on `(request_id, partner_user_id)`: one row per account a reset request finds, written by the
relay from the request's outbox row (`request_id`) so a redelivery adds none; the email's deliverer sets the token hash and the 30-minute expiry when it
sends, and a reset spends every open row of that user.

### 3.3 Merchants and supplier users (people pool, per partner)

```
user        (id, partner_id, email, email_verified_at, password_hash NULL, name, phone NULL,
             two_factor_secret_enc NULL, two_factor_method NULL, two_factor_enrolled_at NULL,
             theme NULL, locale NULL, time_zone NULL, status, created_at)
            UNIQUE (partner_id, email)
            -- two_factor_method: 'app' | 'sms'; required for an Owner, optional otherwise
            -- (ACCESS.md §2, decided 2026-10-02); theme: the person's light/dark choice;
            -- locale and time_zone: the portal UI follows the person (CATALOG fact 40)
user_backup_code (id, user_id, partner_id, code_hash, used_at NULL)
            -- ten per enrolment, shown once; making new ones deletes the old (ACCESS.md §4).
            -- Policy: own rows only, in store scope, on user_id = app.user_id, plus system;
            -- NO partner branch (a partner user never reads a merchant's 2-factor state);
            -- code_hash readable by app_system alone (§2.1)
user_session(id_hash, user_id, partner_id, created_at, last_seen_at,
             absolute_expires_at, remember, device_label, user_agent)
            -- idle 2 h from last_seen_at, absolute 12 h (ACCESS.md §4); "remember me"
            -- extends the absolute bound, never removes it; device_label and user_agent
            -- are what "Where you're signed in" lists. Policy as user_backup_code: own
            -- rows on user_id = app.user_id in store scope, plus system; no partner branch

seller      (id, store_id, name, access_level, shipping_mode, status, suspended_at NULL,
             hide_products_while_suspended boolean NULL, removed_at NULL, created_at)
            -- status: invited | active | suspended | removed (0002 has no check yet; the
            -- next migration adds it); the row survives removal so products stay marked
            -- as the removed supplier's (ACCESS.md §7.5); hide_products_while_suspended is
            -- the Owner's choice at suspension (decided 2026-10-02 on #186's review, recorded on #182)
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
             invited_by_user_id, sent_at, accepted_at NULL, revoked_at NULL)
            -- sent_at moves on resend ("Last sent …", SetTeam), as partner_invitation's does
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
§2.1). Phone numbers in E.164. **Built on #36**: `last_sign_in_at` (the Shop API's sign-in will write it), and three
stored forms a search compares, each indexed: `phone_digits`, `phone_country_code` (the E.164
calling code, by `calling_code_of()`) and `phone_national`, so a phone matches on its digits with
or without the calling code, never on a part of it (decided on #42).

### 3.5 Machine callers and session records

```
api_key    (id, store_id, seller_id NULL, name, prefix, secret_hash, scopes, created_by_user_id,
            expires_at NULL, last_used_at, revoked_at NULL)
app_grant  (id, store_id, app_id, scopes, installed_by_user_id, revoked_at NULL)
support_session (id, partner_id, store_id, membership_id, partner_user_id, reason, ticket NULL,
                 started_at, expires_at, ended_at NULL, ended_by_partner_user_id NULL,
                 handoff_hash NULL UNIQUE, handoff_expires_at NULL, handoff_used_at NULL)
                 -- partner support into a store as one of its users (ACCESS.md §8). Partner
                 -- users only: staff never open one, they impersonate (§8.1). Built on #202:
                 -- one open per partner user and one per membership (partial unique indexes),
                 -- 30 minutes; the partner inserts only its own, on a store allowing support
                 -- (policy). `access`, `elevated_at` and `elevation_approved_by` arrive with
                 -- the Store strand's Allow/Deny. The handoff as on partner_setup_session.
partner_user.reauth_proof_hash, reauth_proof_expires_at
                 -- the single-use proof `reauthenticate` issues (#202), spent by the
                 -- app_definer function spend_partner_reauth(); no request role reads them

impersonation   (id, staff_user_id, target_kind, target_id, membership_id NULL, partner_id,
                 store_id NULL, reason, ticket NULL, started_at, expires_at, extended_at NULL,
                 ended_at NULL, ended_by NULL, end_reason NULL, handoff_hash NULL UNIQUE,
                 handoff_expires_at NULL, handoff_used_at NULL)
                 -- built on #40: one open per staff member (partial unique index on
                 -- staff_user_id where ended_at is null); a staff member inserts only their
                 -- own (`app.staff_id`); end_reason: staff | portal | target_gone | partner_closed
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
request input, with one exception: the guest cart or order token, hashed before it reaches
`db/`, which admits only rows already holding that hash (§7.11):

| Setting | Values |
|---|---|
| `app.scope` | `store`, `partner`, `platform`, `shop`, `system` |
| `app.partner_id` | The partner (store and partner scopes) |
| `app.store_id` | The acting store (store and shop scopes) |
| `app.seller_id` | The supplier, or empty for the merchant side |
| `app.customer_id` | The signed-in customer (shop scope), or empty |
| `app.support` | `read` or `write` during a support session, else empty |
| `app.impersonation_id` | The impersonation id while staff act as a user, else empty (for the activity log; grants nothing) |
| `app.user_id` | The signed-in person's `user.id` (store scope) or `partner_user.id` (partner scope), else empty; the own-row functions and policies of §2.1 and §3.3 read it and nothing else does |
| `app.staff_id` | The signed-in staff member (platform scope), else empty; read by the policy that lets a staff member start an impersonation only as themselves (#40) |
| `app.order_token_hash` | The hash of the guest cart or order token presented on this request (shop scope), else empty; read only by `order_token_matches()` and `current_order_token_hash()` (§7.11). `StoreCaller.shopper` (`core/tenancy.ts`) and `RlsSettings` gain it with the first Shop API card |
| `app.request_token_hash` | The hash of the token on a guest's data-request link, or of the token just minted for a new request (shop scope), else empty; read only by `request_token_matches()` and `current_request_token_hash()` (§7.11) |

`SET LOCAL` lives only for the transaction, so it is safe with Hyperdrive's pooled
connections; every request's work runs inside a transaction for this reason. Every policy
and function reads a setting as `nullif(current_setting('app.<name>', true), '')`, cast
after the `nullif`, so an empty setting (a guest's `app.customer_id`, a merchant's
`app.seller_id`) compares as null and never raises a cast error; the §5.2 templates are
written short for reading and mean this.

### 5.2 Policies by table scope

```sql
-- Inside the store (e.g. order, customer, offer, collection)
USING (current_setting('app.scope') IN ('store','shop')
       AND store_id = current_setting('app.store_id')::uuid
       AND <table rule for suppliers and shoppers>)

-- Store and seller (e.g. product, warehouse, stock_level, order_part)
USING (current_setting('app.scope') = 'store'              -- never 'shop' here: in shop scope
       AND store_id = current_setting('app.store_id')::uuid -- app.seller_id is '' and would
       AND (current_setting('app.seller_id') = ''          -- admit a shopper to every owner's
            OR seller_id = current_setting('app.seller_id')::uuid))   -- rows (§7.11 adds the
                                                          -- shop policies table by table)

-- Account level (e.g. store, store_subscription, custom_domain)
USING ( (current_setting('app.scope') = 'store'    AND id/store_id = current_setting('app.store_id')::uuid)
     OR (current_setting('app.scope') = 'partner'  AND partner_id  = current_setting('app.partner_id')::uuid)
     OR  current_setting('app.scope') = 'platform')

-- Partner (e.g. partner_user, plan)
USING ( (current_setting('app.scope') = 'partner' AND partner_id = current_setting('app.partner_id')::uuid)
     OR  current_setting('app.scope') = 'platform')
```

- **Every policy names its role** (`CREATE POLICY … TO app_request`, `TO app_supplier`, `TO
  app_shop`, `TO app_partner`, `TO app_platform`, `TO app_system`): a shop branch is a policy
  `TO app_shop` and nothing else can use it, a supplier branch a policy `TO app_supplier`, and
  the templates above are the merchant-side (`app_request`) ones. The structural test (§5.4)
  checks that no policy is `TO PUBLIC`.
- **Suppliers**: tables a supplier must never read (offers, customers, the store's people
  outside its own team, settings) have no `TO app_supplier` policy at all.
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

**One role per caller kind** (decided 2026-10-02 on #188's review, replacing the single request role).
Row policies cannot tell a supplier from the merchant or a shopper from either (all three were
`app_request` with different settings), and column grants are per role, so every "this column
never reaches a supplier or a shopper" rule in §7 needs a role to grant against. `withScope`
(`db/scoped/index.ts`) issues `set local role <role>` from the caller kind. **Built on #205**: staff requests
run as `app_platform`, partner users and staff setup sessions as `app_partner` (#155; it updates its own `partner`
row by column only, and a trigger lets it change `state` only from Draft to Awaiting approval,
#214), every
other request as `app_request`, and `app_definer` exists (owning
only 0007's membership trigger, which checks parents the caller may not see); the first
supplier and shopper cards add `app_supplier` and `app_shop` the same way (api/README.md §7).
Every tenant table carries a restrictive pin per role holding it to its own `app.scope`
values (`request_scope`: `store`, `shop`; `partner_scope`; `platform_scope`; `system_scope`), so a policy shared by two roles never lets one use the other's branch.
**Until #210** `app_request` also keeps every platform branch and `platform` in its pin: the
Worker live when 0010 runs serves staff as `app_request` (api/README.md §7, expand then
contract).

| Role | Used by | Can |
|---|---|---|
| `app_request` | Merchant-side people (Owner, Manager, Staff) in store scope, and partner support sessions into a store (ACCESS §8) | DML under RLS; no `BYPASSRLS`; `select` and `insert` on `activity_log` (as 0006 grants; never update or delete) and `insert` on `outbox`; no `select` on credential columns (§2.1: password and 2-factor secret hashes, backup-code hashes, invitation token hashes; `"order".access_token_hash`; §7's `credentials_enc`, `webhook_secret_enc`, `secret_enc`, `token_enc` and `key_enc` on courier, payment, webhook, connection and AI-account rows) nor on `user.phone`, reached only through `own_phone()` and `set_own_phone()` (§2.1) |
| `app_supplier` | Supplier users (store scope with `app.seller_id` set) | **Writes only what a supplier does** (ACCESS §5.2, §7.3), under the store-and-seller policies: DML on its own catalogue rows and their children (§7.3), `asset`, `warehouse`, `stock_level`, `stock_movement`, `size_chart`, `product_story`, `translation`, `import_job`, `export_job`; `insert` on `fulfilment` and `fulfilment_line` for its own parts and on `order_document` for its own labels; **its refunds only through `supplier_refund()`**, an `app_definer` function that checks, inside the database, that every line is the caller's, that the quantity does not exceed the line's refundable quantity and that the amount does not exceed the lines' value (`order_line_for_supplier`), then inserts the `refund` and `refund_line` rows: `app_supplier` has no direct `insert` on either, so the ceiling is a mechanism, not a promise; **`select` only, no write**, on `order_part`, `return_line`, `supplier_ledger_entry`, the refunds and documents the store wrote (its own refunds and labels it inserts, as above, and never updates), and on `order_line` **by column without any `*_amount`, tax rate or zone** (id, order and part ids, owner, version, product, name, version name, SKU, classification code, quantity, weight, the three fulfilled/returned/refunded quantities: what fulfilling needs); the money of its own lines it reads through `order_line_for_supplier` (§7.11), which carries the currency. The order's snapshot and a return's state are never a supplier's to change. **No `select` on `"order"` or `"return"`**, which it reads through `order_for_supplier` and `return_for_supplier`; **no `select` on `refund.by_user_id`, `refund.note`, `supplier_ledger_entry.note`, `"return".note`**; `select` only on the settings tables §7.11 names; nothing on every other table |
| `app_shop` | Shoppers and guests (shop scope) | `select` on the catalogue columns the Shop API serves, **never `product_version.cost_amount`, `cost_currency` or any `*_enc`**; `select` on the shop-readable settings §7.11 lists, by column (`store` and `market` public columns, languages, currencies, `store_policy`, `badge`, `shipping_zone`, `shipping_method`, and of `payment_provider_account` only `provider`, `mode` and `public_key`); its own `customer` row and children; its own `"order"` rows and children under the guest rule (§7.11), **by column** on the children (§7.11: no supplier ids, tax rates, zones or codes on lines; part state and mode only; the shopper-facing fulfilment columns of shopper-facing fulfilments only), and on `"order"` never `notes`, `cancel_reason`, `reminders_stopped_note`, `reminders_stopped_by_user_id`, `recovered_by_*`, `device`, `search` or `access_token_hash`. **Writes**: `insert` and `update` on its own `customer` and `customer_address` rows (never `status` or the credential columns); `insert` on `customer_data_request`; on `"order"` only the contact and checkout columns of its own **carts** (`email`, `phone`, `language`, the two addresses, `pickup`, `shopper_note`, `checkout_step`; on insert also `store_id`, `customer_id` and `access_token_hash`), under the write policy §7.11 states: `state = 'cart'` in both `USING` and `WITH CHECK`, `customer_id` equal to `app.customer_id` or null, the guest token rule for a guest. **Everything that prices the cart goes through engine functions owned by `app_definer`** (`cart_set_currency` and `cart_set_market`, which validate against `store_currency` and `market` and reprice every line; `cart_set_shipping_method`; `cart_add_line`, `cart_set_line_quantity`, `cart_apply_code`, `cart_place` and the like), which compute prices, discounts, tax, shipping and totals, write `order_line`, `order_adjustment`, `order_part`, `currency`, `market_id`, `shipping_method_id` and the `*_amount` and state columns, and run under the shopper's `app.*` settings; `app_shop` has no direct write on those tables or columns, so a shopper can never set a price, a total, a state or the currency the stored line amounts are in (PLATFORM-PROMPT §5.5 "the engine computes everything that matters") |
| `app_partner` | Every partner-user request (partner scope): its own partner's tables and the account-level store tables | DML under RLS on the partner tables (§2); `select` on the account-level store tables (§2, §7.11) with the column rule of §7.11: never `design_version.prompt`, `summary`, `preview_asset_ids`, `ai_run.prompt` or `gate_results`; writes only what ACCESS §5.3 allows a partner (creating a store, built on #221: an invited `user`, an invited Owner `membership`, the store's first `job`, and a `store_subscription` at its plan's own price, each granted by column and held by a policy); the same credential exclusions as `app_request` |
| `app_platform` | Every staff request (platform scope; the Admin API) | DML under RLS on the platform and partner tables and the account-level store tables; the read-only `platform` branch on `customer` (§2); **the same column rule as `app_partner` on the AI prompt columns** (staff see a merchant's content only by impersonating, ACCESS §8.1, which runs as the target's role); the same credential exclusions |
| `app_definer` | Nobody directly: owns the narrow views (`order_for_supplier`, `order_line_for_supplier`, `return_for_supplier`, the AI metering view), the token functions `order_token_matches()`, `request_token_matches()`, `current_order_token_hash()`, `current_request_token_hash()`, the cart functions above and `supplier_refund()` | `BYPASSRLS`, no login. Every view and function filters on the settings of the scope it serves and is `security barrier`, so none is wider than the policy it replaces: the two supplier views on `app.store_id` and `app.seller_id`; **the AI metering view by scope**: `store` → `store_id = app.store_id`, `partner` → `store.partner_id = app.partner_id` (joined through `store`), `platform` → every store, anything else → nothing; the token functions pin `search_path`, are executable by `app_shop` alone, and return false on an empty setting; the cart functions are executable by `app_shop` alone and write only the shopper's own cart (§7.11); `supplier_refund()` by `app_supplier` alone, enforcing the refund ceiling (§7.6); `current_order_token_hash()` returns the hash a guest's own insert must carry, and **null when the setting is empty**, so a tokenless insert fails the `WITH CHECK` comparison, which is never true against null (§7.11). The structural test (§5.4) lists each with its filter |
| `app_system` | Jobs, webhooks, retention | Named tables, under RLS with `app.scope = 'system'` |
| `app_migrate` | Migrations only | DDL; owns the tables and the functions of §2.1; never used by the Worker at run time |

The table owner isn't used by the application, so RLS always applies (`FORCE ROW LEVEL
SECURITY` on every tenant table). A view owned by `app_definer` is the one place RLS is
bypassed, which is why each view carries its own scope filter and a structural test (§5.4)
lists every view and checks the filter is there.

### 5.4 Tests

- With `db/scoped` bypassed, a raw query in each scope returns nothing outside its scope
  (ACCESS.md §11).
- Every tenant table has RLS enabled and forced, and a policy for each scope that may reach
  it; a test lists tables without one and fails. Every table in §7 is in a §7.11 class, and
  a table in none fails the same test.
- `SET LOCAL` values come only from the context: a structural test forbids setting them
  anywhere but `db/`. Every `app_definer` view filters on the settings.
- Performance: every policy's columns are the leading columns of an index.

---

## 6. Open questions

- ~~Confirm the names of the two supplier team roles, Supplier admin and Supplier member (§4.2).~~
  **Settled 2026-10-02**: those names. (No read-only team role: decided 2026-09-28.)
- From §7 (2026-10-02, #187): when stock is reserved (cart, checkout or
  payment, §7.4); whether a fixed product discount is per line or per unit, and whether codes
  match case-insensitively (§7.7, OFFERS facts 4 and 6); whether a `to-shopper` supplier books
  labels through the store's courier account or its own (§7.6); the version and option limits
  per product (§7.3, CATALOG fact 4); whether A+ reusable blocks (`story_block`) ship; whether
  `menu_item` may point at pages and URLs (CATALOG J4); one active shipping method at a time
  or several (DESIGN-BRIEF flow 54); whether a **market may have its own domain** at all, which
  needs several `custom_domain` rows per store while SAAS §8 and the built admin API assume one
  *(ask)*; whether **store custom fields** (§7.3) are first release; whether product video is
  supported (CATALOG F9); whether report schedules (the Custom reports note) are designed at
  all, which #183 decides.

---

## 7. Commerce, settings, storefront and billing tables

The merchant-side model, designed on #187 (2026-10-02, revised the same day after three reviews on #188) from
PLATFORM-PROMPT §3.3 and §5.4–5.7, CATALOG-DESIGN §3, OFFERS-DESIGN §3, DESIGN-BRIEF §3, SAAS
§4–9, ACCESS §5 and §7, and the Store prototype. **The structure is decided; names and columns
are *(proposed)* until each module's migration**, as §3 was before #32. Which module ships
first is ui/store/FIRST-RELEASE.md's (to be written on #184); anything the specs mark
`(release: decide)` keeps the mark here. The model's own open points are in §6.

### 7.1 Conventions every table below follows

- **Scope first** (§2): every table names its scope; store tables carry `store_id`, supplier-
  readable tables carry `seller_id` (null = the merchant's own), and §7.11 puts every table in
  one policy class. Each store-and-seller table is a row of the isolation matrix (ACCESS
  §11.1, "rows added with §7").
- **Supplier ownership reaches every child row.** Every table in §7.11's first class carries
  `seller_id`; on a child it is the parent's, copied by a trigger from the row it points at
  (`product` → options, values, versions, prices, photos, compliance, specs, FAQs, highlights,
  filter assignments, badges, the approval snapshot; `product_version` → prices, option
  values, stock levels; `warehouse` → stock levels, where the version's owner must be the
  warehouse's or the merchant's; `order_part` → return lines and refund lines; `fulfilment`
  → its lines; `product_photo` → its `asset`), never from input. **`fulfilment` is the one
  exception**: its `seller_id` is the **actor's** owner, set by the engine from the caller
  that creates it (a supplier's `sent_to_store` hand-off carries its id; the store's onward
  shipment of the same part carries null), so a to-store supplier never reads the shopper's
  tracking (§7.6, §7.11). `translation` carries the
  owner of the entity it translates (null for a store-owned entity). `import_job`,
  `export_job`, `size_chart`, `product_story` and `supplier_ledger_entry` carry the owner
  directly.
- **Keys**: `id uuid` primary keys; `created_at`; `updated_at` and a `revision integer` on
  anything two people may edit at once, so a save can refuse a stale revision (CATALOG E4,
  OFFERS N6). **The blocks below omit `id`, `created_at`, `updated_at` and `revision` where
  this rule implies them.** Unique constraints are per store (SKU, web address, coupon code,
  group name), per language for web addresses, never global.
- **Money**: every column named `amount` or `*_amount` is `bigint` in minor units with a
  `currency char(3)` on the same row, every time, whatever table it is in, subscriptions,
  invoices and every line included; the one allowed inheritance is the order's two children,
  `order_line` and `order_adjustment`, whose amounts are in `"order".currency`, because an
  order has exactly one currency and a presentment currency, if one ever exists, is a column
  on the order, not on its lines (PLATFORM-PROMPT §5.4 Money; AGENTS.md "Data").
  Percentages are basis points (`_bps integer`). Meters that count money (`store_usage`) do
  not exist: cost is summed from the rows that carry it.
- **Time**: every timestamp column, whatever its name (`*_at`, `*_since`, `*_until`,
  `period_start`, `period_end`, `changes_since`), is `timestamptz` in UTC; `date` is used
  only where the business fact is a calendar date (`valid_from` on tax rows,
  `payment_method_expires`). Display converts and names the zone (api/README.md; the store's
  `time_zone` is for display and scheduling only).
- **Soft delete** (`deleted_at`) where history points at the row: products, versions,
  collections, promotions, warehouses, size charts. `customer` uses its built `status =
  'deleted'` (0002) instead. Orders are never deleted. A soft-deleted entity's `translation`
  rows for `slug` are deleted with it, so a dead row never blocks a web address (fact 15).
- **Translations** live in one table, `translation` (§7.3), for every translatable field:
  CATALOG fact 18's list (product, option, option value, version, collection, filter and
  filter value names and texts) plus, from Q10, R11, S9, fact 21, fact 47, OFFERS fact 13 and
  S2: story module text, size-chart labels and notes, specification names and values, FAQs,
  highlights, warranty and returns text, badge labels, `seo_title` and `seo_description`,
  policies, compliance fields, and a promotion's shopper-facing name and description. The
  main-language text stays on the row itself and is required; other languages fall back to
  it (facts 19–20). Compliance fields may be translated into a language the store does not
  offer (fact 47).
- **Snapshots, not references, on orders**: a line records the name, SKU, price, tax class,
  tax rate and zone, and classification code as sold; a discount records the promotion's
  shopper-facing name (OFFERS fact 13). Catalogue rows may change or be soft-deleted
  afterwards.
- **History is the activity log** (LOGGING.md), as §2.1 decided: no per-table history, apart
  from the ledgers the business needs (stock movements, price history, the supplier ledger).
- **Search**: the portal searches products, customers and orders through a generated,
  store-scoped `tsvector` on each table in the store's main language (PLATFORM-PROMPT §5.4
  Search); the storefront's per-language index is `product_search` (§7.3), rebuilt from the
  outbox (CATALOG facts 14, 19).
- **Indexes** lead with the scope columns (`store_id`, then `seller_id` where present), then
  the list screen's filter.
- **Plan-paused state** (decided 2026-10-02 on #186's review, SAAS §6.2): what a smaller plan can no longer
  hold is paused, never deleted, and the Owner chooses what stays. The pause is a state on the
  row it pauses: `product.hidden_by = 'plan'`, `membership.status = 'paused_by_plan'`,
  `payment_provider_account.paused_by_plan`, `courier_account.paused_by_plan`,
  `market.status = 'paused_by_plan'`. An upgrade clears them.

### 7.2 Store settings

Store-scoped, Owner-written (`settings`, ACCESS §5.1), read by every catalogue and order
screen (CATALOG fact 36). `store` keeps what #32 built (§2.1); the rest is split by concern so
no row becomes a wall of columns. `store_customer_auth` is §3.4's; `seller.shipping_mode` and
the supplier's status columns are §3.3's.

```
store (+ columns)   description, logo_asset_id NULL, address jsonb, contact_email, contact_phone,
                    customer_care jsonb, home_country, tax_inclusive boolean, time_zone,
                    unit_system ('metric'|'imperial'), order_prefix, next_order_number,
                    pricing_currency, main_language, fallback_market_id NULL,
                    vendor_products_require_approval boolean, track_stock_default boolean,
                    continue_selling_default boolean, low_stock_threshold_default integer,
                    pickup_enabled boolean, pickup_hours text,
                    locale_confirmed_at NULL, shipping_saved_at NULL
                    -- Store info (SetStore): description is "used in search results and link
                    -- previews"; the legal name and tax number for shopper invoices are
                    -- invoice_settings and tax_registration, the payer identity for
                    -- DripFunnel's invoices is store_billing_details (§7.9); one home each.
                    -- pricing_currency is locked once the first order exists (CATALOG
                    -- §Currencies). The two *_at columns drive the Home checklist's two
                    -- non-derived items (PortalHome). plan_id, trial_ends_at and the
                    -- storefront columns built on #32 are read-only mirrors of
                    -- store_subscription and storefront (§7.8, §7.9), written by the same
                    -- transaction that writes the owner row.

store_language      (store_id, language, status, position)   UNIQUE (store_id, language)
                    -- offered on the storefront; main_language is one of them
store_currency      (store_id, currency, mode ('manual'|'convert'), rounding ('none'|'nearest'|'ends-99'),
                     rate_source, rate_updated_at)            UNIQUE (store_id, currency)
                    -- CATALOG facts 25–26; converted prices (release: decide)

custom_domain (+ columns) checks_until, removed_at
                    -- as built on #32 (migration 0007): host, status ∈ waiting | verifying |
                    -- issuing | live | failed | expiring | broken, expected and found CNAME,
                    -- ownership token, checked_at. The portal's four steps map onto the
                    -- states (SAAS §8): "Add the record" = waiting, "We check it" =
                    -- verifying, "Security certificate" = issuing, "Live" = live; failed
                    -- shows the record looked for and checked_at. checks_until = first
                    -- check + 3 days (every 15 minutes); one row per store today (§6 asks
                    -- about a market's own domain)

market              (id, store_id, parent_id NULL, name, is_primary boolean, countries text[],
                     currency, language NULL, price_adjustment_bps, web_mode ('main'|'path'|'domain'),
                     path_prefix NULL, custom_domain_id NULL, products ('all'|'some'),
                     tax_registration_id NULL, duties_mode ('none'|'by_code'|'flat'),
                     duties_rate_bps, duties_threshold_amount, status ('active'|'inactive'|'paused_by_plan'))
                    -- SetMarkets: a market sells one currency into its countries, in one
                    -- language, at the main address, a path or its own domain (§6 ask);
                    -- sub-markets share their parent's countries, so "a country is in at
                    -- most one market" is a trigger over top-level markets only; duties per
                    -- CATALOG part T (duties_threshold_amount in the market's currency);
                    -- store.fallback_market_id is "Everywhere else"
market_excluded_product (market_id, product_id, store_id)    -- products = 'some'
market_payment_provider (market_id, payment_provider_account_id, store_id)

tax_registration    (id, store_id, country, kind ('vat'|'oss'|'gst'|'sales_tax_permit'|'ein'|'abn'|…),
                     number, valid_from date)                  -- CATALOG fact 36
tax_class           (id, store_id, key, name, is_default)      -- Standard, Reduced, Zero, Exempt… (fact 37)
tax_zone            (id, store_id, name, countries text[], regions text[])
tax_rate            (id, store_id, tax_class_id, tax_zone_id, rate_bps, valid_from date)
                    UNIQUE (tax_class_id, tax_zone_id, valid_from)
                    -- class × zone (fact 37); a tax service for US sales tax (decide) would
                    -- add tax_code on product_version and bypass tax_rate for that zone

compliance_default  (store_id, region, field, value)           -- manufacturer, importer,
                    UNIQUE (store_id, region, field)            -- responsible person… (fact 34)
store_policy        (store_id, kind ('refund'|'privacy'|'terms'|'shipping'|'imprint'), body)
                    UNIQUE (store_id, kind)
                    -- the policies the Shop API serves (PLATFORM-PROMPT §5.5; storefront
                    -- ARCHITECTURE §2.1, §3.2); body per language in translation

store_feature       (store_id, key, enabled boolean)           -- Settings › Catalogue switches
                    UNIQUE (store_id, key)                      -- (CATALOG P1): aplus, size_charts,
                                                                -- specs, faqs, badges, related…
badge               (id, store_id, label, tone ('ok'|'peach'|'neutral'),
                     rule ('new_30_days'|'top_5_this_month'|'below_compare_price'|'few_left'|'manual'))
                    -- CATALOG S5; label ≤ 18 chars; tone is the prototype's colour set

shipping_zone       (id, store_id, name, countries text[], regions text[])
shipping_method     (id, store_id, zone_id, name, kind ('free'|'fixed'|'free_over'|'courier_rate'),
                     amount, currency, threshold_amount, position, status)
                    -- DESIGN-BRIEF flows 54–55; whether one active method at a time survives
                    -- is (ask) and would be a partial unique index, not a column
delivery_area       (store_id PK, mode ('everywhere'|'list'), postal_codes text[],
                     source_file_asset_id NULL)                 -- SetOps "Where you deliver"
courier_account     (id, store_id, provider ('shiprocket'|'usps'|'ups'|'fedex'|'dhl'|'dpd'|'hermes'|…),
                     credentials_enc, role ('pricing'|'standby'|'off'), paused_by_plan boolean,
                     pickup_mode ('scheduled'|'on_request'), pickup_window text,
                     label_size ('a6'|'a4'|'4x6'|'letter'), tracking_emails boolean,
                     status ('connected'|'login_rejected'|'not_connected'),
                     last_tested_at, last_test_result jsonb)
                    -- SetOps Delivery partners; one 'pricing' row per store (partial unique);
                    -- paused_by_plan per §7.1 (PortalKeep)
payment_provider_account
                    (id, store_id, provider ('stripe'|'razorpay'|'cashfree'|'paypal'|'klarna'|'phonepe'
                     |'adyen'|'cod'|'bank_transfer'), mode ('test'|'live'), credentials_enc,
                     webhook_secret_enc, public_key, bank_details jsonb, status, paused_by_plan boolean,
                     position)
                    -- the merchant's own providers (flow 56; THIRD-PARTY-ACCESS §3.1); never
                    -- the subscription's payment method (§7.9)
invoice_settings    (store_id PK, legal_name, address jsonb, tax_id NULL, tax_per_line boolean,
                     email_with_dispatch boolean, footer text)
                    -- SetOps "Save invoice settings" and the "from" block of a shopper's
                    -- invoice; issued invoices never change (§7.6 order_document)
store_ai_account    (store_id PK, provider ('openai'|'anthropic'), key_enc, key_prefix,
                     connected_by, connected_at)
                    -- "connect your own AI account" on plans without AI included (Pricing,
                    -- PortalBilling); key_enc readable by app_system only (§5.3)

cart_reminder_flow  (store_id PK, enabled boolean, min_amount NULL, currency, skip_out_of_stock boolean,
                     quiet_hours jsonb, weekly_cap integer)
cart_reminder_step  (id, store_id, position, enabled boolean, delay_minutes integer,
                     channel ('email'|'whatsapp'), subject, body, discount_bps NULL)
                    -- the abandoned-cart sequence (Carts); up to three steps; the sent
                    -- reminders are §7.6 cart_reminder; WhatsApp needs the consent channel
                    -- and the provider of THIRD-PARTY-ACCESS §2.8
```

### 7.3 Catalogue

Store-and-seller scoped: a supplier's rows carry its `seller_id` and it reads nothing else,
counts and search included (ACCESS §7.1, §7.4). Everything is one shared record between the
merchant and the supplier that owns it (DESIGN-BRIEF fact 4).

```
asset               (id, store_id, seller_id NULL, r2_key, kind ('image'|'video'|'file'|'document'),
                     mime, bytes, width, height, checksum, created_by)
                    -- every upload; photos, A+ images, labels, invoices, export files.
                    -- seller_id is the owner of the row that references it, set when
                    -- linked (a photo the merchant adds to a supplier's product is the
                    -- supplier's to read, ACCESS §7.1); unlinked uploads are the uploader's

product             (id, store_id, seller_id NULL, name, slug, description, product_type
                     ('physical'|'digital'|'service'), category, visibility ('visible'|'hidden'),
                     approval_status ('approved'|'pending'|'sent_back') NULL, sent_back_reason,
                     hidden_by ('seller_suspended'|'seller_removed'|'plan') NULL, status_before_hide,
                     publish_at NULL, size_chart_id NULL, related_mode ('manual'|'auto_collection'),
                     warranty_text NULL, returns_text NULL, is_sample boolean,
                     seo_title, seo_description, search tsvector, deleted_at)
                    UNIQUE (store_id, slug) WHERE deleted_at IS NULL     -- fact 15; per language in translation
                    -- approval_status is null when the store does not require approval
                    -- (ACCESS §7.2); re-approval compares name, prices and photos with
                    -- product_approved_snapshot; hidden_by = 'plan' is the pause of §7.1;
                    -- is_sample marks the provisioning sample (SAAS §5 step 2), hidden and
                    -- outside the plan count; product_type, publish_at, warranty and
                    -- returns text (CATALOG S8) are (release: decide)
product_approved_snapshot
                    (product_id PK, store_id, seller_id NULL, name, prices jsonb, photo_ids uuid[],
                     approved_at, approved_by)
                    -- prices is [{version_id, currency, amount, compare_at_amount}], one entry
                    -- per version_price row at approval, every amount with its currency (§7.1)
                    -- what the last approval accepted, so a save knows whether it must go
                    -- back to pending (ACCESS §7.2, decided 2026-10-02)
product_option      (id, product_id, store_id, seller_id NULL, name, position)   -- "Size", "Colour" (fact 3)
product_option_value(id, option_id, store_id, seller_id NULL, name, position)
product_version     (id, product_id, store_id, seller_id NULL, sku, barcode, name, visibility,
                     tax_class_id, hs_code, customs_description, weight_grams, length_mm, width_mm,
                     height_mm, net_quantity NULL, net_quantity_unit NULL, unit_price_reference NULL,
                     cost_amount, cost_currency, track_stock boolean NULL, continue_selling boolean NULL,
                     position, deleted_at)
                    UNIQUE (store_id, sku) WHERE sku IS NOT NULL AND deleted_at IS NULL
                    -- every product has at least one (fact 1); price, stock, SKU, code, tax
                    -- class and weight live here (fact 2); cost_amount and cost_currency are
                    -- never granted to app_shop (§5.3); nulls inherit the store default
                    -- (fact 10); barcode check digit validated (fact 44, release: decide);
                    -- net quantity and reference unit give the EU unit price (T7);
                    -- customs_description for cross-border labels (C9, T5)
product_version_option_value
                    (version_id, option_id, value_id, store_id, seller_id NULL)
                    UNIQUE (version_id, option_id)
                    -- one value per option per version, enforceable, so adding an option
                    -- can demand a value for every existing version (fact 3, D8–D9)
version_price       (version_id, store_id, seller_id NULL, currency, amount, compare_at_amount NULL,
                     source ('manual'|'converted'))
                    PRIMARY KEY (version_id, currency)                    -- fact 25
price_history       (id, version_id, store_id, seller_id NULL, currency, amount, compare_at_amount,
                     from_at, to_at)
                    -- the EU 30-day reference price (fact 41, release: decide); written on
                    -- every version_price change
version_market_price(version_id, market_id, store_id, seller_id NULL, amount, currency)
                    PRIMARY KEY (version_id, market_id)
                    -- a fixed price per market (an entitlement, SAAS §6.1; CatEditor "Price
                    -- per market"); per version because price lives on the version (fact 2);
                    -- absent = main price + the market's adjustment
product_photo       (id, product_id, version_id NULL, store_id, seller_id NULL, asset_id, position, alt)
                    -- alt per language in translation (fact 23, release: decide)
product_video       (product_id, store_id, seller_id NULL, asset_id NULL, url NULL)
                    -- CATALOG F9 (ask: supported at all) and S7 (hosted or linked)
product_market_rule (product_id, store_id, seller_id NULL, mode ('only'|'except'), countries text[])
                    -- "Where you sell" per product (fact 42, release: decide)
product_flag        (product_id, store_id, seller_id NULL, age_restricted boolean, hazardous boolean)  -- fact 43
product_compliance  (product_id, store_id, seller_id NULL, region, field, value)
                    UNIQUE (product_id, region, field)                     -- facts 34, 45–46
product_spec        (id, product_id, version_id NULL, store_id, seller_id NULL, name, value,
                     filter_value_id NULL, position)
                    -- a row marked "shoppers can filter by this" points at the filter_value
                    -- it mirrors (fact 30); version_id for per-version values (S1)
product_highlight   (id, product_id, store_id, seller_id NULL, text, position)         -- S2
product_faq         (id, product_id, store_id, seller_id NULL, question, answer, position)
product_related     (product_id, related_product_id, store_id, seller_id NULL, position)
                    -- manual picks only; product.related_mode = 'auto_collection' ignores them
product_badge       (product_id, badge_id, store_id, seller_id NULL)             -- manual badges only (S5)

collection          (id, store_id, name, slug, description, kind ('manual'|'automatic'),
                     match ('all'|'any'), parent_id NULL, inherit_parent boolean,
                     visibility, image_asset_id, sort ('manual'|'newest'|'price_asc'|'price_desc'
                     |'best_selling'), seo_title, seo_description, deleted_at)
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
                    UNIQUE NULLS NOT DISTINCT (product_id, version_id, filter_value_id)
                    -- product-level or version-level (fact 13)

menu                (id, store_id, key ('main'), name)
menu_item           (id, menu_id, store_id, parent_id NULL, label, kind ('collection'|'page'|'url'),
                     collection_id NULL, url NULL, position)      -- J4 pages and URLs (ask)

product_story       (product_id PK, store_id, seller_id NULL, status ('draft'|'live'),
                     template, draft jsonb, live jsonb)
                    -- A+ content (CATALOG Q): ordered modules as a document, draft separate
                    -- from live (Q9); module kinds limited to what the store's core version
                    -- renders (fact 28); text per language in translation, keyed by the
                    -- module id inside the document (Q10)
story_block         (id, store_id, kind ('brand_story'), content jsonb)
                    -- a reusable block shared by many products (Q5, release: decide)

size_chart          (id, store_id, seller_id NULL, name, unit ('cm'|'in'), systems text[],
                     rows jsonb, measurements jsonb, how_to_measure jsonb, fit_notes, model_info,
                     deleted_at)                                    -- CATALOG R
size_chart_rule     (id, size_chart_id, store_id, seller_id NULL, kind ('collection'|'filter_value'|'category'),
                     target_id NULL, value NULL)                    -- R6 (release: decide)

custom_field_definition (id, store_id, entity, key, type, translatable boolean, filterable boolean, position)
custom_field_value  (store_id, entity, entity_id, definition_id, value jsonb)
                    PRIMARY KEY (entity, entity_id, definition_id)
                    -- PLATFORM-PROMPT §5.10 "store custom fields … filterable"; (release:
                    -- decide, §6); indexed per definition when filterable

translation         (store_id, seller_id NULL, entity, entity_id, field, language, text)
                    PRIMARY KEY (store_id, entity, entity_id, field, language)
                    UNIQUE (store_id, entity, language, text) WHERE field = 'slug'
                    -- §7.1: seller_id is the translated entity's owner, denormalised; the
                    -- partial unique index is what makes a web address unique per language
                    -- (CATALOG fact 22); slug rows go when their entity is soft-deleted
product_search      (product_id, store_id, language, document tsvector)
                    PRIMARY KEY (product_id, language)
                    -- the storefront's per-language index with main-language fallback
                    -- (facts 14, 19), written by the outbox consumer; visibility-scoped
                    -- reads only (§7.11)
```

Rules the tables encode: visibility is on the product **and** on each version, and a visible
product with no visible version is reported as "not buyable" (fact 8); a version with no price
in a manual currency is not buyable in it (fact 26); the version count per product and the
option count are limited by the engine (fact 4, limit *(decide)*); `collection_product` and
`product_search` are rebuilt from outbox events, never in the request (fact 14).

### 7.4 Inventory

Store-and-seller scoped; a supplier never sees another owner's quantities, movements or
totals (DESIGN-BRIEF fact 10, flow 73).

```
warehouse           (id, store_id, seller_id NULL, name, address jsonb, is_default boolean, deleted_at)
                    -- one default per owner: a partial unique index on
                    -- (store_id, coalesce(seller_id, '00000000-0000-0000-0000-000000000000'))
                    -- where is_default, so the merchant's null owner counts once too;
                    -- deleting needs on_hand = 0 everywhere (SetOps)
stock_level         (version_id, warehouse_id, store_id, seller_id NULL, on_hand integer,
                     reserved integer, low_stock_threshold integer NULL)
                    PRIMARY KEY (version_id, warehouse_id)
                    -- seller_id is the warehouse's; the trigger refuses a version whose
                    -- owner is neither the warehouse's nor the merchant (a Stock-only
                    -- supplier may hold the merchant's versions, ACCESS §7.1); reserved =
                    -- sold, not yet fulfilled (PLATFORM-PROMPT §5.4, decided); when it is
                    -- reserved (cart, checkout or payment) is (decide)
stock_movement      (id, store_id, seller_id NULL, version_id, warehouse_id, delta integer,
                     resulting_quantity integer, reason ('received'|'returned'|'damaged'|'counted'
                     |'typed'|'order'|'import'|'starting'|'transfer'), source_kind, source_id,
                     actor_kind, actor_id)
                    -- the ledger (flow 73): every change, by hand, by orders, by suppliers and
                    -- by imports; seller_id is the warehouse's; 'transfer' only if flow 35
                    -- ships (release: decide)
```

### 7.5 Customers

Store-scoped customer accounts (§2: the Admin API's Customers menu reads them through a
read-only platform branch, as `app_platform`, masked by the Admin API's serializer). Never
readable by a supplier; a `to-shopper` supplier sees a name and address only through its own
order parts (ACCESS §7.3). A shopper (`app_shop`) reads and writes its own row and children.

```
customer (+ columns) tags text[], note text, consent_state ('opted_in'|'stopped'|'declined'|'not_asked'),
                     consent_at, consent_source ('checkout'|'email'|'added_by_hand'|'recorded_by_store'),
                     consent_channels text[] ('email'|'sms'|'whatsapp'), added_by_user_id NULL,
                     default_address_id NULL, search tsvector
                    -- §3.4 has the identity columns and status ('active'|'unverified'|'deleted',
                    -- built in 0002), which is the deletion marker; "Record that they asked
                    -- to stop" writes consent_state = 'stopped' with the recording user
                    -- (LOGGING §3); consent_channels feeds the cart reminders (§7.2)
customer_address    (id, customer_id, store_id, name, line1, line2, city, region, postal_code,
                     country, phone, is_default_shipping, is_default_billing, deleted_at)
customer_group      (id, store_id, name, description, deleted_at)   UNIQUE (store_id, name)
customer_group_member (group_id, customer_id, store_id, added_at)   PRIMARY KEY (group_id, customer_id)
                    -- OFFERS fact 12; a group in use by a promotion warns before deletion (flow 72)
customer_data_request (id, store_id, customer_id NULL, subject_email NULL, subject_phone NULL,
                     subject_verified_at, expires_at, access_token_hash NULL, kind ('export'|'delete'),
                     requested_by ('customer'|'store'), state ('requested'|'ready'|'done'|'refused') DEFAULT 'requested',
                     file_asset_id NULL, done_at)
                    -- access_token_hash: a guest reaches its own request only through the
                    -- token in the link it was sent (§7.11); never selected by a request role.
                    -- Shop writes are bounded (§7.11): app_shop inserts with customer_id =
                    -- app.customer_id (a signed-in shopper) or, for a guest, customer_id null
                    -- and a subject_email or subject_phone; it never writes
                    -- subject_verified_at, state or file_asset_id. The engine (app_system)
                    -- sends the code to the subject, sets subject_verified_at on a correct
                    -- code, and builds the export only for a verified request; the file is
                    -- reachable only by that customer or that token. A shopper can therefore
                    -- file a request naming someone else's email, and nothing follows
                    -- GDPR / DPDP (AGENTS.md "Data"). Filed by the store, or by the shopper
                    -- from the storefront (app_shop may insert, and reads its own request by
                    -- customer_id or by the request's own token, §7.11). A guest has no
                    -- customer row: the request names the email or phone the orders were
                    -- placed with, proved by a code sent to it (subject_verified_at).
                    -- Export gathers the customer row (if any), customer_address, every
                    -- order placed under the customer id or, for a guest, under the
                    -- verified email or phone, with their email, phone and address
                    -- snapshots, promotion_usage rows, cart reminders and consent history.
                    -- Deletion keeps orders and usage rows (money history) and applies one
                    -- rule: EVERY column on these tables that can hold personal data is
                    -- blanked or replaced by a placeholder, every search tsvector built from
                    -- one is rebuilt, and every file that carries the person is deleted from
                    -- R2. Named so the migration and its test cover them: customer name,
                    -- email, phone, note, tags, consent_source, added_by_user_id and search;
                    -- customer_address rows; "order" email, phone, shipping_address,
                    -- billing_address, notes, cancel_reason, access_token_hash and search;
                    -- promotion_usage.customer_email; refund.note and "return".note;
                    -- fulfilment.tracking_number and tracking_url (a tracking page can
                    -- identify the person); cart_reminder rows' sent subjects; every
                    -- order_document asset of those orders (invoices, packing slips, labels
                    -- and return labels all carry the name and address), the rows keeping
                    -- kind, number and date; any export_job or customer_data_request file
                    -- not yet expired that contains the person, and the export_job.filter
                    -- that named them blanked; outbox rows not yet delivered that name the
                    -- person (LOGGING §9); the shopper's activity entries' personal fields
                    -- (LOGGING §8). The request row itself is blanked once done:
                    -- subject_email, subject_phone, subject_verified_at and customer_id go,
                    -- so it keeps only kind, dates and state. Every other free-text column
                    -- on these tables is checked against this rule when its migration is
                    -- written. A supplier never saw any of it.
```

### 7.6 Carts, orders, fulfilment, returns, refunds and the supplier ledger

An order is store-scoped and the store's; its **parts** and **lines** carry the owning
`seller_id`, which is the only way a supplier reads any of it (ACCESS §7.3). A cart is an
order in state `cart` (PLATFORM-PROMPT §5.5 "cart, an active order"). Payment and fulfilment
are two states, because a cash-on-delivery or bank-transfer order ships before it is paid
(SetOps "Unpaid until you mark it paid"); PLATFORM-PROMPT §5.4's single list is the derived
view of the two.

```
"order"             (id, store_id, number NULL, state ('cart'|'placed'|'cancelled'),
                     payment_state ('pending'|'authorised'|'paid'|'partly_refunded'|'refunded'),
                     fulfilment_state ('unfulfilled'|'partly_fulfilled'|'fulfilled'),
                     customer_id NULL, email, phone, language, currency, market_id NULL,
                     tax_inclusive boolean, shipping_address jsonb, billing_address jsonb,
                     subtotal_amount, discount_amount, shipping_amount, tax_amount, duties_amount,
                     total_amount, refunded_amount,
                     shipping_method_id NULL, shipping_method_label, pickup boolean,
                     checkout_step ('contact'|'ship'|'pay') NULL, abandoned_at NULL, device NULL,
                     reminders_stopped_at NULL, reminders_stopped_by_user_id NULL, reminders_stopped_note NULL,
                     recovered_by_order_id NULL, recovered_by_reminder_id NULL,
                     placed_at, paid_at, cancelled_at, cancel_reason, cart_expires_at,
                     shopper_note NULL, notes NULL, access_token_hash NULL, search tsvector)
                    UNIQUE (store_id, number) WHERE number IS NOT NULL
                    -- shipping_address and billing_address carry {name, line1, …}: the
                    -- shopper's name lives there, not in a column of its own. shopper_note is
                    -- the shopper's own message at checkout (read and written by app_shop on
                    -- its cart); notes is the merchant's internal note, never a shopper's.
                    -- access_token_hash: a guest's cart or order (customer_id null) is
                    -- reachable in the shop scope only with the hashed token the Shop API
                    -- handed the browser (a cookie or the order-status link); compared in
                    -- the policy (§7.11), never selected by any request role (§5.3).
                    -- checkout_step, abandoned_at, device and the reminders_* and
                    -- recovered_* columns are the abandoned-cart facts (Carts); a cart that
                    -- becomes an order clears abandoned_at and the recovered order points
                    -- back at it. number = store.order_prefix + next_order_number, assigned
                    -- at placement in one transaction; totals are the engine's, stored at
                    -- placement and recomputed only by refunds (immutable snapshot,
                    -- PLATFORM-PROMPT §5.4); which promotions applied is order_adjustment
                    -- and promotion_usage, nothing here
order_line          (id, order_id, store_id, seller_id NULL, version_id, product_id,
                     name, version_name, sku, hs_code, tax_class_key, tax_rate_bps, tax_zone_id NULL,
                     quantity, unit_amount, discount_amount, tax_amount, line_total_amount,
                     weight_grams, fulfilled_quantity, returned_quantity, refunded_quantity)
                    -- the snapshot (§7.1), tax rate and zone included so reports and GST
                    -- copies split tax by jurisdiction (CATALOG fact 37); seller_id is the
                    -- product's owner at placement
order_adjustment    (id, order_id, order_line_id NULL, store_id, kind ('discount'|'shipping'
                     |'tax'|'duties'|'rounding'), promotion_id NULL, promotion_code_id NULL,
                     label, amount, tax_rate_bps NULL, tax_zone_id NULL)
                    -- discounts as adjustments carrying the shopper-facing name (OFFERS fact 13);
                    -- order-level discounts spread across lines by the engine (fact 11);
                    -- amount in "order".currency (§7.1)
order_part          (id, order_id, store_id, seller_id NULL, shipping_mode ('store'|'to-store'
                     |'to-shopper'), state ('to_ship'|'sent_to_store'|'partly_shipped'|'shipped'
                     |'delivered'|'cancelled'))
                    UNIQUE NULLS NOT DISTINCT (order_id, seller_id)
                    -- one part per owner, the merchant's null owner included (DESIGN-BRIEF
                    -- fact 6, flow 70); shipping_mode is the supplier's seller.shipping_mode
                    -- at placement and the order follows it, never the live seller row
                    -- (ACCESS §7.3); 'store' for the merchant's own; the warehouse is per
                    -- fulfilment, since a part may ship from several
fulfilment          (id, order_part_id, order_id, store_id, seller_id NULL, kind ('booked'|'manual'
                     |'sent_to_store'|'pickup'), warehouse_id, courier_account_id NULL,
                     courier_name NULL, tracking_number NULL, tracking_url NULL,
                     booked_at, shipped_at, delivered_at, created_by)
                    -- seller_id is the ACTOR's owner, not the part's: a to-store supplier's
                    -- 'sent_to_store' hand-off carries its seller_id, and the store's onward
                    -- shipment of those lines to the shopper carries null, so the supplier
                    -- never reads the shopper's tracking (ACCESS §7.3; a matrix row).
                    -- courier_name is the carrier's name as shown ("Shiprocket"); the printed
                    -- label is an order_document row (kind 'label', fulfilment_id), never a
                    -- column here, so erasure has one list to follow; 'booked' through the
                    -- store's courier account (whether a to-shopper supplier may use its own
                    -- is §6); 'manual' with or without a tracking number (PortalOrders "Label
                    -- and tracking"); shipped lines come out of warehouse_id as
                    -- stock_movement 'order'
fulfilment_line     (fulfilment_id, order_line_id, store_id, seller_id NULL, quantity)
                    -- seller_id as the fulfilment's

payment             (id, order_id, store_id, provider, provider_account_id, provider_ref, kind
                     ('card'|'wallet'|'upi'|'cod'|'bank_transfer'|…), state ('pending'|'authorised'
                     |'captured'|'failed'|'refunded'), amount, currency, captured_at)
                    -- webhooks idempotent through provider_ref (PLATFORM-PROMPT §5.4 Payments)
payment_refund      (id, refund_id, payment_id, store_id, provider_ref, state ('pending'|'done'|'failed'),
                     amount, currency)

"return"            (id, store_id, order_id, number, state ('requested'|'received'|'refunded'
                     |'cancelled'), reason ('doesnt_fit'|'changed_mind'|'damaged'|'wrong_item'
                     |'not_as_described'), note NULL, label_sent_at, received_at, cancelled_at,
                     created_by)
                    UNIQUE (store_id, number)
                    -- the return label is an order_document row (kind 'return_label', return_id);
                    -- store-scoped; a supplier reaches a return only through
                    -- return_for_supplier (§7.11), which never carries note, the store's free
                    -- text (ACCESS §7.3); number = 'R' + order number + '-' + n
return_line         (return_id, order_line_id, store_id, seller_id NULL, quantity,
                     destination_warehouse_id)
                    PRIMARY KEY (return_id, order_line_id)
                    -- destination follows the line owner's shipping mode (ACCESS §7.3)
refund              (id, store_id, seller_id NULL, order_id, return_id NULL, amount, currency,
                     reason ('returned'|'goodwill'|'cancelled'|'other'), note NULL, restock boolean,
                     override_of_seller_id NULL, by_user_id)
                    -- one refund per owner: a refund covering several owners' lines is split
                    -- at creation into one row per owner, so seller_id is never ambiguous;
                    -- every refund_line.seller_id equals its refund's (check), and
                    -- refund.amount equals the sum of its lines plus any goodwill amount the
                    -- store adds to its own row (trigger); seller_id null = the merchant's own;
                    -- override_of_seller_id set when the store refunded a supplier's lines;
                    -- a supplier reads its own, overrides included, never another's; it
                    -- creates one only through supplier_refund() (§5.3), which enforces the
                    -- line ownership, the refundable quantity and the value ceiling; and
                    -- app_supplier has no select on by_user_id ("the store") or note, the
                    -- store's free text, which may name the shopper (§5.3, ACCESS §7.3);
                    -- reason is coded. The isolation matrix tests both omissions
refund_line         (refund_id, order_line_id, store_id, seller_id NULL, quantity, amount, currency)
supplier_ledger_entry (id, store_id, seller_id, amount, currency, kind ('refund_override'
                     |'adjustment'), refund_id NULL, note, created_by)
                    -- what a supplier owes or is owed, settled outside the platform
                    -- (PLATFORM-PROMPT §5.4 Payments, decided 2026-10-02); a supplier reads
                    -- only its own entries and balance, and app_supplier has no select on
                    -- note (§5.3)

order_document      (id, order_id, store_id, seller_id NULL, kind ('invoice'|'packing_slip'
                     |'label'|'return_label'|'gst_copy'), number NULL, asset_id, issued_at,
                     return_id NULL, fulfilment_id NULL)
                    -- every printable rendered from the order and invoice_settings, stored as
                    -- an asset so an issued invoice never changes; the link a deletion job
                    -- follows to purge them (§7.5). Store-and-seller class (§7.11): seller_id
                    -- is set only on a label or return_label a supplier printed for its own
                    -- part, so a supplier reads exactly those; invoices, packing slips and the
                    -- GST copy have seller_id null and are the merchant's alone

cart_reminder       (id, store_id, order_id, step_id NULL, channel ('email'|'whatsapp'), sent_at,
                     sent_by_user_id NULL, promotion_code_id NULL, opened_at NULL, clicked_at NULL)
                    -- the sent reminders of the Carts screen, automatic (step_id) or by hand
                    -- (sent_by_user_id); attribution of a recovered order is the last
                    -- reminder clicked or the code used ("order".recovered_by_reminder_id);
                    -- the reminder's code is a promotion_code bound to the cart and
                    -- expiring 48 h after sent_at (§7.7)
```

Order events (placed, paid, shipped, return started, refunded, "sent to warehouse by
Northwind") are activity-log entries with the order as target (LOGGING §3), which both the
order's timeline and the shopper's own order history read (LOGGING §6); there is no
`order_event` table.

### 7.7 Promotions (offers)

Store-scoped and the merchant's alone: no supplier branch in the policy, no supplier screen
(OFFERS fact 15). Status is derived, never stored (fact 9). The engine's application order is
fixed and documented (fact 7); nothing here reorders promotions.

```
promotion           (id, store_id, name, internal_name NULL, description, enabled boolean,
                     disabled_reason ('past_due') NULL, starts_at NULL, ends_at NULL,
                     total_uses_limit NULL, per_customer_limit NULL, uses_count integer,
                     combines_with jsonb, show_on_product_page boolean, deleted_at)
                    -- OFFERS fact 1; uses_count maintained atomically with promotion_usage
                    -- (fact 8); combines_with per fact 7 holds the Shopify-style flags, and
                    -- the M3 "best only" and M4 "one code per order" choices, each (release:
                    -- decide); disabled_reason lets "Turn back on" be offered after past due
                    -- (Offers); show_on_product_page is fact 17 / O4 (release: decide);
                    -- internal_name (release: decide); soft delete keeps past orders'
                    -- adjustments (fact 14, settled 2026-10-02 on #188's review: soft)
promotion_condition (id, promotion_id, store_id, operation, args jsonb, position)
                    -- operation ∈ OFFERS fact 3's keys: minimum_order_amount (amount per
                    -- currency in args), contains_products, at_least_n_with_filter_values,
                    -- customer_group, buy_x_get_y, contains_collection, first_order,
                    -- specific_customers, shipping_country…; recurrence (OfferEditor
                    -- "repeat") is a condition too
promotion_action    (id, promotion_id, store_id, operation, args jsonb, position)
                    -- fact 4's keys; per-currency amounts in args (fact 10); targets resolve
                    -- at pricing time (fact 5, decide)
promotion_code_batch(id, promotion_id, store_id, prefix, length integer, count integer)
                    -- a bulk run of single-use codes (fact 6, H4), so the list shows the
                    -- batch and its used/unused counts
promotion_code      (id, promotion_id, store_id, batch_id NULL, code, single_use boolean,
                     expires_at NULL, customer_id NULL, order_id NULL, used_at NULL,
                     used_by_customer_id NULL)
                    UNIQUE (store_id, code)
                    -- one row for a shared code, many for bulk single-use codes (fact 6);
                    -- unique per store including spent and deleted ones (H2), so a receipt's
                    -- code never names another offer later; customer_id and order_id bind a
                    -- cart-reminder code to one shopper and cart, expires_at ends it (§7.6);
                    -- whether matching is case-insensitive is open (§6); the UI upper-cases
                    -- on save meanwhile, and a decision for insensitive adds lower(code)
promotion_usage     (id, promotion_id, promotion_code_id NULL, store_id, order_id,
                     customer_id NULL, customer_email, discount_amount, currency)
                    UNIQUE (promotion_id, order_id)
                    -- counted from placed orders; guests recognised by email (fact 8, decide);
                    -- results (part P) aggregate this table
```

### 7.8 Storefront, publishing, design history and AI runs

Store-scoped (account level: the partner and staff read the publishing state, never the
content). Specified in SAAS §9 and storefront/ARCHITECTURE §4.2. **One home per fact with
`store`**: `store.storefront_kind`, `core_version`, `build_state`, `last_build_at` and
`last_publish_at` (built on #32, §2.1) are the account-level mirror the consoles list; this
table owns the rest and every write to it updates the mirror in the same transaction.

```
storefront          (store_id PK, repo, hosting_target, preview_url, live_url, public_store_key,
                     allowed_origins text[], checkout_url NULL, account_url NULL,
                     has_unpublished_changes boolean, changes_since NULL, changed_kinds text[],
                     changed_count integer, next_auto_publish_at,
                     setup_service_state ('booked'|'done') NULL)
                    -- change detection as a table, not memory (SAAS §9.1); public_store_key
                    -- is the one credential safe in a browser (PLATFORM-PROMPT §5.5);
                    -- checkout_url and account_url are a store with its own frontend
                    -- (PLATFORM-PROMPT §5.6); setup_service_state records the one-time
                    -- "storefront setup by our team" (Pricing, PortalBilling)
publish_run         (id, store_id, kind ('manual'|'automatic'|'staff'|'design'), state ('queued'
                     |'building'|'deploying'|'live'|'failed'), uses_allowance boolean,
                     started_by_kind, started_by_id, started_at, finished_at, deploy_ref, error,
                     build_minutes)
                    -- one running per store (partial unique); a failed run never uses the
                    -- allowance (decided); uses_allowance only for 'manual'
design_version      (id, store_id, number, commit, summary, prompt, preview_asset_ids uuid[],
                     state ('previewed'|'approved'|'live'|'discarded'|'reverted'), approved_at,
                     live_at, reverted_to_id NULL)
                    -- PortalStorefront history: "Go back to version N" is a revert commit
                    -- and a new live version (SAAS §9.2 undo); prompt, summary and previews
                    -- are the merchant's (§5.3 app_partner)
ai_run              (id, store_id, kind ('design'|'description'|'translation'), requested_by,
                     design_version_id NULL, prompt, model, tokens_in, tokens_out, cost_amount,
                     cost_currency, build_minutes, gate_results jsonb,
                     billed_to ('plan'|'own_key'), outcome ('approved'|'discarded'|'failed'))
                    -- SAAS §9.2 metering for design runs; CATALOG C2 and N9 for text; the
                    -- AI meters below and the cost figure both read it; prompt and
                    -- gate_results are the merchant's (§5.3)
store_usage         (store_id, key, used, period_start NULL, updated_at)
                    PRIMARY KEY (store_id, key)                 -- built on #212 (§2.4)
                    -- one row per limit and per monthly allowance (the plan keys of §2.3);
                    -- an allowance's period_start says which period it counts, reset per
                    -- billing period (SAAS §6.2). The meters with no plan value
                    -- (ai_tokens, build_minutes, bandwidth_bytes) and a history per period
                    -- are added by the card that first writes them. AI cost is not a meter
                    -- but the sum of ai_run.cost_amount for the period (§7.1 Money)
store_limit_override (id, store_id, key, amount, duration ('month'|'always'), month NULL,
                     reason, created_by_*, created_at, removed_at, removed_by_label)
                    -- built on #212 (§2.4); SAAS §6.1 per-store overrides; purchased extra
                    -- bandwidth will be a 'month' override
```

### 7.9 Merchant billing

Store-scoped at account level (the partner reads status and amounts; staff read everything
but `store_billing_details`, which stays store-only). The money model is SAAS §7: Stripe
Billing on DripFunnel's account, the partner's or DripFunnel's own plans. Distinct from the
store's own `payment_provider_account` rows (flow 61). `store.plan_id` and `trial_ends_at`
(built on #32) are mirrors of this table, written by the same transaction. **`store_subscription`
is built on #212** (§2.4); `store_billing_details`, `invoice`, `invoice_line` and
`billing_event` are #201's.

**Built on #163** (migration `0019`), what the partner Dashboard, Billing and Reports read, filled
by Stripe Connect's sync later (THIRD-PARTY-ACCESS §2.7) and by the seed until then. Each is
partner-scoped: a partner reads its own rows, staff and jobs every row, `app_system` writes, and
no merchant branch exists yet. The four role pins are on each table. Money columns are `bigint`
minor units, and every payout currency is the contract's `fee_currency` by foreign key, so a
sum never mixes or drops currencies.

```
merchant_charge     (id, partner_id, store_id, kind ('subscription'|'proration'|'refund'),
                     status ('paid'|'failed'|'refunded'|'recovered'), amount, currency,
                     payout_currency, payout_gross, fee_amount, partner_amount
                     (= payout_gross - fee_amount), card_last4, failure_reason, invoice_id,
                     charged_at)          -- (store_id, partner_id) keyed to the store's partner;
                    -- a refund's amounts are positive and subtracted when summed
partner_payout      (id, partner_id, period_start, period_end, currency, gross, fee,
                     adjustments, amount (= gross - fee + adjustments), stores,
                     status ('scheduled'|'paid'|'held'), scheduled_for, paid_at, held_reason,
                     adjustment_note)     -- one per partner and period
store_sales_month   (store_id, partner_id, month, currency, amount, payout_currency,
                     payout_amount, orders)  -- payout_amount ranks stores across currencies
                    -- the engine's monthly totals: all a partner sees of a merchant's orders
partner_billing_feed (partner_id PK, synced_at, stale_since)
                    -- the sync job's last run; the Dashboard's asOf and staleSince
```

```
store_subscription  (store_id PK, plan_id, plan_version, status ('trial'|'active'|'past_due'
                     |'cancelled'), interval ('month'|'year'), currency, amount,
                     period_start, period_end, trial_ends_at, cancel_at NULL,
                     next_plan_id NULL, next_plan_version NULL, change_at NULL,
                     stripe_customer_id, stripe_subscription_id, payment_method_label,
                     payment_method_brand, payment_method_last4, payment_method_expires date,
                     proration_amount NULL, proration_at NULL)
                    -- status uses store.status's spellings (0007: trial, active, past_due,
                    -- cancelled), which core/tenancy.ts's Subscription type and ACCESS §3
                    -- use since #212. currency is the store's when USD, EUR or INR, else
                    -- USD (SAAS §6.1); the card is Stripe's: brand, last 4 and expiry only;
                    -- next_plan_* and change_at are a scheduled downgrade (SAAS §6.3,
                    -- PortalBilling "You'll move to Growth on 27 Oct"), and the Owner's
                    -- Choose-what-to-keep picks are stored as the §7.1 pause states before
                    -- change_at
store_billing_details (store_id PK, legal_name, address jsonb, tax_id NULL, tax_id_kind
                     ('gstin'|'vat'|NULL), email)                -- SAAS §7.2, Owner-only
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

**Reconciled on #157**: `plan.trial_days` is `0..90` (migration `0013`; it was `(0, 7, 14,
30)`), so the house partner's 10-day trial fits (SAAS §6.1), and the seed's house plans carry
it.

### 7.10 Integrations, jobs and requests

```
api_key, app_grant  §3.5 (store-scoped, optional seller binding); api_key gains
                    rotated_from_id NULL, so a rotation keeps the old key's audit trail (ACCESS §5.6)
app                 (id, name, developer, scopes text[], webhook_url, status)
                    -- platform-scoped registry the grants point at (PLATFORM-PROMPT §5.5,
                    -- DESIGN-BRIEF flow 77); Admin API only
webhook_endpoint    (id, store_id, url, events text[], secret_enc, status ('active'|'disabled'
                     |'failing'), failing_since NULL, created_by)
webhook_delivery    (id, endpoint_id, store_id, outbox_id, event, attempt, status ('pending'
                     |'delivered'|'failed'), response_code, error text NULL, delivered_at, next_attempt_at)
                    -- PLATFORM-PROMPT §5.5: delivered from the outbox, replayable, endpoint
                    -- disabled after repeated failure
external_connection (id, store_id, provider ('shopify'), token_enc, shop_domain, status,
                     connected_by, connected_at, expires_at)       -- CATALOG K7
import_job          (id, store_id, seller_id NULL, kind ('csv'|'shopify'), state ('validating'
                     |'ready'|'running'|'paused'|'done'|'failed'), source_asset_id NULL,
                     connection_id NULL, selection jsonb NULL, warehouse_id,
                     match_key ('sku'|'barcode'), match_mode ('update'|'skip'),
                     total integer, done integer, imported integer, skipped integer,
                     problems_asset_id NULL, started_by, started_at, finished_at)
                    -- CATALOG K; selection is the external ids picked on a Shopify connect
                    -- (K7); K4 keeps "matched by SKU (confirm)"; runs in the background and
                    -- survives the page (CatImport); every imported row writes
                    -- stock_movement 'import'
export_job          (id, store_id, seller_id NULL, kind ('products'|'orders'|'customers'
                     |'offer_uses'|'codes'|'report'|'store_data'), filter jsonb, columns text[],
                     state ('queued'|'running'|'done'|'failed'), row_count, file_asset_id NULL,
                     expires_at, started_by)
                    -- every CSV the prototype downloads; a supplier's export is its own rows
                    -- only; files expire (expires_at, days not weeks) and a deletion request
                    -- purges earlier the ones that contain the person (§7.5)
signup              (id, partner_id, email, password_enc, name, store_name, country, plan_id,
                     storefront_kind, job_id NULL, expires_at)
                    -- partner-scoped; SAAS §4.1's row between the signup steps, deleted by
                    -- SAAS §5 step 8; password_enc readable by app_system only (§2.1)
access_request      (id, store_id, by_user_id, kind ('feature'|'area'), what,
                     resolved_at NULL, resolution ('acted'|'dismissed') NULL, resolved_by NULL)
                    -- "Send request" from a Manager or Staff, shown on the Owner's Home
```

`job` and `job_detail` (§2.1) stay the SaaS layer's: provisioning and fleet. Import and export
have their own tables because the merchant reads them, a supplier may own one, and their
columns are nothing like a provisioning run's.

### 7.11 Row-level security, roles and indexes for §7

The policy classes, named per table so the isolation tests (ACCESS §11.1) are written against
this list and nothing else. Row policies decide which rows a scope reaches; **the roles of §5.3
decide which columns and which tables each caller kind may select at all**. `app.scope` and
`app.seller_id` keep working as before; the role is set beside them.

- **Store-and-seller** (§5.2 template, for `store` scope: a supplier reads and writes
  `seller_id = app.seller_id` only, the merchant everything; **no `shop` branch** except where
  the next paragraph says): `product` and every child in §7.3 that carries `seller_id`
  (options and values, versions and their option values, prices and price history, per-market
  prices, photos, video, market rules, flags, compliance, specs, highlights, FAQs, related,
  badges, filter assignments, the approval snapshot), `product_story`, `size_chart`,
  `size_chart_rule`, `translation`, `asset`, `warehouse`, `stock_level`, `stock_movement`,
  `order_line`, `order_part`, `fulfilment`, `fulfilment_line`, `return_line`, `refund`,
  `refund_line`, `supplier_ledger_entry`, `custom_field_value` (the owner of the entity it
  values), `order_document` (a supplier reads only the labels
  it printed for its own parts; invoices and packing slips carry a null owner and never reach
  it), `import_job`, `export_job`. **No partner or platform branch** on any of them: a partner
  never reads a supplier's import problems or a store's catalogue. `app_supplier` has no
  `select` on `refund.by_user_id`, `refund.note` or `supplier_ledger_entry.note` (§5.3).
  **Shop branches, explicit**: `product`, its children, `collection`, `collection_product`,
  `product_filter_value`, `product_story` (live only), `story_block` (when a live story
  embeds it), `size_chart` and `custom_field_value` (of a visible entity) get a `shop` read
  policy on
  visibility (`visibility = 'visible'`, `deleted_at IS NULL`, the product not hidden, the
  version priced in the shopper's currency); **`asset`** has no such columns, so its `shop`
  branch is `EXISTS` a `product_photo`, `product_story`, `collection.image_asset_id`,
  `story_block` or `store.logo_asset_id` reference whose owner row passes that visibility
  rule, and **never** an asset referenced by `order_document`, `invoice.pdf_asset_id`,
  `export_job`, `customer_data_request`, `import_job` or `delivery_area` (the matrix row: a
  shopper selecting an invoice or export asset by id gets nothing); `order_line`, `order_part`
  and `fulfilment` get a `shop` read policy of `EXISTS (SELECT 1 FROM "order" o WHERE o.id =
  order_id)`, which carries the guest rule below through the order's own policy (and
  `order_adjustment`, an inside-the-store table, gets the same one: see the next class).
  **By column, for `app_shop`** (§5.3): on `order_line` never `seller_id`, `tax_rate_bps`,
  `tax_zone_id` or `hs_code` (supplier attribution reaches the storefront only where the
  merchant shows it, through the Shop API, never as a column); on `order_part` only `state`
  and `shipping_mode`, never `seller_id`; on `fulfilment` only `courier_name`,
  `tracking_number`, `tracking_url`, `shipped_at` and `delivered_at`, and only rows of kind
  `booked`, `manual` or `pickup` (a supplier's `sent_to_store` hand-off is the store's
  internal step and has no shop branch). **`translation`** and **`product_search`** have no
  visibility columns of their own: their `shop` branch is `EXISTS` on the translated or
  indexed row passing its own shop rule (a visible, unhidden, undeleted product or
  collection; a shopper-visible filter; a live story; a policy), so a hidden product's slug
  or translated name never reaches a shopper, and the matrix has that row. Every other table
  in this class has **no `shop` branch**, and `app_shop` has no `select` on it either.
- **Catalogue structure: inside the store, merchant-written, shop-readable**: `collection`,
  `collection_rule`, `collection_product`, `filter`, `filter_value`, `menu`, `menu_item`,
  `custom_field_definition`, `badge` definitions, `product_search` (written by the outbox
  consumer as `app_system`; its shop branch is the indexed product's rule, above). No
  supplier branch except the read-only
  ones listed below (`filter`, `filter_value`, `badge`); a `shop` read branch on visibility
  (`collection.visibility = 'visible'`, `deleted_at IS NULL`, `filter.shopper_visible`, every
  menu item, every definition and badge), `collection_rule` excepted, which the shop never
  reads (the result is `collection_product`); `app_shop` has `select` on these and no write.
- **Inside the store, no supplier branch** (and no shop branch unless this bullet names
  one): `"order"` and `"return"` (base
  tables: `app_supplier` has no `select`; it reads `order_for_supplier`,
  `order_line_for_supplier` and `return_for_supplier`, three `security barrier` views owned by `app_definer` that filter on
  `app.store_id` and `EXISTS` a part or line with `seller_id = app.seller_id`, indexed on
  `order_part (order_id, seller_id)` and `return_line (return_id, seller_id)`, and whose
  columns are, for every mode: id, number, state, placed_at, currency, the part's state and
  shipping mode; and, **only where the part's stored mode is `to-shopper`**, the shopper's
  name and `shipping_address`; never email, phone, `billing_address`, any order `*_amount`,
  `notes`, `cancel_reason`, `search`, `access_token_hash`, `"return".note` or any
  `order_adjustment`. **`order_line_for_supplier`** is the one place a supplier sees money:
  for its own lines only, `quantity`, `unit_amount`, `line_amount = unit_amount × quantity`
  and the order's `currency`, so "Your sales" and the refund ceiling have a figure with its
  currency (DESIGN-BRIEF fact 6; the price before the merchant's discount, since who pays a
  discount is open, OFFERS fact 18); never `discount_amount`, `tax_amount`,
  `line_total_amount` or a tax rate or zone, which carry the shopper's order-level discount
  and tax spread across lines), **`order_adjustment`** itself (the shopper's whole-order discounts,
  shipping, tax and duties: `app_supplier` has no `select`; **it has the shop read branch**
  `EXISTS` on its own order, so a shopper's order page shows its discount, shipping and tax
  lines, and `app_shop` has `select` on it), `payment`, `payment_refund`,
  `promotion` and its children,
  `customer_group`, `customer_group_member`, `story_block` (inside the store for writes; its
  shop read branch is above), `access_request`, `webhook_endpoint`, `webhook_delivery`,
  `external_connection`, `api_key`, `app_grant`, `invitation` (§3.3), `cart_reminder`,
  `cart_reminder_flow`, `cart_reminder_step`, `store_ai_account`, `store_billing_details`,
  and every settings table in §7.2 not named in the next class. `"order"` alone also has
  the **shop branch** `customer_id = app.customer_id OR (customer_id IS NULL AND
  order_token_matches(id))`, where `order_token_matches(uuid)` is a `security definer`
  function owned by `app_definer` that compares the row's `access_token_hash` with
  `app.order_token_hash` and is false when the setting is empty; so no request role selects
  the hash column (§5.3) and a guest still holds exactly the carts and orders whose token it
  presents, never another guest's. **Its shop write policy** (`INSERT` and `UPDATE` for
  `app_shop`, on the columns §5.3 grants): `state = 'cart'` in both `USING` and `WITH CHECK`,
  so a placed order is never writable by a shopper and a cart cannot be placed by a direct
  write; `store_id = app.store_id`; `customer_id = app.customer_id`, or null for a guest. The
  guest test differs by command, because `WITH CHECK` on an `INSERT` cannot look the new row
  up: the `UPDATE` `USING` clause uses `order_token_matches(id)` on the stored row, and the
  `INSERT` `WITH CHECK` clause requires `access_token_hash = current_order_token_hash()`,
  an `app_definer` function returning the hash of the token this request presented, or null
  when none was, so a tokenless guest insert is refused (null compares as unknown) (the
  Shop API mints the token, sets `app.order_token_hash` to its hash for the transaction, and
  inserts the cart with that hash), so a guest can create only a cart it holds the token for.
  Currency, market and shipping method change only through the engine functions, which
  reprice the lines, so the inheritance of §7.1 holds.
  `customer_data_request` gets the same shape for a guest's own request: its `access_token_hash` and `request_token_matches(uuid)` against
  `app.request_token_hash` (§5.1), with the matrix row guest A vs guest B.
  **Read-only supplier branches, listed in the matrix**: a supplier editing its own products
  reads `filter` and `filter_value` (it assigns values; CATALOG L9 keeps whether it may see
  collections *(ask)*), `tax_class` (to pick one), `store_language` and `store_currency` (to
  translate and price), `store_feature` and `badge` (to know which sections and manual badges
  exist), and `market` without its duties, domain and payment columns (to see which currencies
  a price is needed in); `app_supplier` has `select` on nothing else here.
- **Shop-readable settings** (a `shop` read branch on `store_id = app.store_id`, with
  `app_shop` granted the public columns only, §5.3): `store` (name, description, logo,
  address and contact for pickup and receipts, `time_zone`, `pricing_currency`,
  `main_language`, `tax_inclusive`, the pickup fields; never the order counter or the
  defaults), `store_language`, `store_currency` (currency and rounding), `market` (name,
  countries, currency, language, web mode, path and status; never duties rates or payment
  links), `store_policy`, `badge` (label and tone), `shipping_zone`, `shipping_method`,
  `payment_provider_account` (`provider`, `mode`, `public_key` only: the storefront mounts
  the provider's element with them). Duties, tax and delivery-area checks are the engine's
  (PLATFORM-PROMPT §5.5): the shop reads none of `tax_*`, `delivery_area`, `compliance_default`
  or `store_feature`. The matrix row: a shopper selecting `payment_provider_account` gets the
  three columns and nothing else, and no row of any other settings table.
- **Customer accounts**: `customer`, `customer_address`, `customer_data_request`: inside the
  store, plus the read-only `platform` branch of §2 on `customer`, plus a **shop branch** on
  `customer_id = app.customer_id` (`customer_data_request` also by its own token for a guest),
  and `insert` for `app_shop` on all three; a guest's own `customer_data_request` through
  `request_token_matches(id)`. The `customer_data_request` insert `WITH CHECK` has the
  cart's shape: `store_id = app.store_id`, `customer_id = app.customer_id OR (customer_id IS
  NULL AND (subject_email IS NOT NULL OR subject_phone IS NOT NULL) AND access_token_hash =
  current_request_token_hash())`, the function returning the hash of the token the Shop API
  minted for this request (null when none), so an anonymous filing is bound to the store and
  to a token only its filer holds; `app_shop` has no write on `subject_verified_at`, `state`,
  `expires_at` or `file_asset_id`, so verification, the expiry and the export are the
  engine's alone (§7.5); and the
  Shop API rate-limits filings per subject and per client (ACCESS §4). **No uniqueness on
  the subject**: a unique index would let an anonymous filer block the person's own request
  and would reveal, through the refusal, that a request exists for an email (ACCESS §2
  "never reveal whether an account exists"). Instead every filing is accepted with the same
  response, an unverified request expires after 24 hours (`expires_at` has `DEFAULT now() +
  interval '24 hours'`, `app_shop` has no write on it, and the `WITH CHECK` requires
  `subject_verified_at IS NULL AND state = 'requested'`, so a filer sets neither the expiry
  nor the state). **Verification is bound to one request, not to the subject**: the code the
  engine sends names the request's own token in its link, and verifying requires that token
  and the code together, so a code fulfils only the request the person holds the link for;
  another filer's request for the same email can never be fulfilled by the victim's code, and
  lapses at its `expires_at`. **The filing token dies at verification**: the filer knows it,
  and the verification link carrying it went to the subject, so on a correct code the engine
  replaces `access_token_hash` with the hash of a new token it sends only to the verified
  subject (in the "your export is ready" message, or for a deletion the confirmation), and
  the file is reachable with that token alone, or by the signed-in customer; the filer's
  token opens nothing after that. The `WITH CHECK` also pins `requested_by = 'customer'` and `kind
  IN ('export', 'delete')`, and `state` has `DEFAULT 'requested'`. After verification the
  engine sets `expires_at` again, to the file's retention (7 days for an export, cleared for
  a deletion once done), so the column always means "when this row stops mattering". No
  supplier branch.
- **Account level** (the partner and platform branches §2 gives account-level tables, for
  state only, never content): `storefront`, `publish_run`, `design_version` and `ai_run`
  (`app_partner` and `app_platform` read them through the metering view of §5.3 and never a
  prompt, summary, preview or gate result; a merchant's design prompts are store content,
  USERS-AND-DOMAINS §4), `store_usage`, `store_limit_override`, `store_subscription`, `invoice` and
  `invoice_line` (status and amounts for the partner that bills), `custom_domain`, and
  `billing_event`, which is cross-scope and append-only like `activity_log` (§2; a Stripe
  event names a store or a partner, and only the SaaS layer writes it).
- **Partner and platform scope**: `signup` (partner); `app` (platform). Nothing else in §7:
  a table in none of these classes is a gap the structural test (§5.4) reports.
- **Column rules**, all by role (§5.3): `product_version.cost_amount` and `cost_currency`
  never to `app_shop`; `access_token_hash` and every `*_enc` and `key_enc` to no request
  role; the AI prompt columns never to `app_partner` or `app_platform`; the refund, return and ledger free
  text never to `app_supplier`. The Shop API schema has no field for a cost, and the matrix
  has the row that proves a shopper query cannot return one.
- Every policy's columns lead an index; list screens get a composite on
  `(store_id, <filter>, created_at desc, id desc)` for keyset paging with the maximum page
  size `db/scoped` already applies to every list (`maxPageSize`, ui/admin/FIRST-RELEASE §12:
  no page numbers, no totals; the Shop API's catalogue lists use the same bound); the views' `EXISTS` on orders and returns is backed by `order_part
  (order_id, seller_id)` and `return_line (return_id, seller_id)`, and
  `order_line_for_supplier` by `order_line (order_id, seller_id)`; the structural test (§5.4)
  lists all three views, the metering view and every `app_definer` function with its filter.
