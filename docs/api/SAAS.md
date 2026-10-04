# SAAS.md: the platform layer

The specification of the SaaS layer, `apps/api/src/saas/` ([README.md](README.md) §3): partners, merchants' accounts, plans and entitlements, "Publish now" allowances and the
publish schedule, billing, provisioning, domains, storefront publishing, the AI designer, the
fleet, support access, the activity (audit) log ([LOGGING.md](LOGGING.md)) and the platform metrics. It sits above the commerce
engine (`src/engine`) and below the entry points (`src/apis`, `src/hooks`, `src/jobs`). It was
ported from the first platform's SAAS-PLAN (with the job, domain and
`ai_run` parts of its ARCHITECTURE) on 2026-09-28, with
framework, AWS and tRPC facts replaced by engine facts. Where this document disagrees with
[../ARCHITECTURE.md](../ARCHITECTURE.md) or [../USERS-AND-DOMAINS.md](../USERS-AND-DOMAINS.md),
those two win.

**Status: specification only.** `apps/api/src/saas/` is an empty folder. Nothing below is
built; which release each part ships in is **(release: decide)** unless it says otherwise.

Last updated: 2026-10-04.

---

## 1. Decisions

Recorded so they aren't relitigated.

| Decision | Rejected | Why |
|---|---|---|
| **A repo per store**, the AI editing real theme code inside a bounded surface (`src/theme/**`) | A sections-and-blocks theme schema (Shopify-style) | A schema over-constrains design and brings its own long-term complexity. Real code keeps design open, and every AI change is a reviewable, revertable commit ([../storefront/ARCHITECTURE.md](../storefront/ARCHITECTURE.md) §1). |
| **Commerce in a versioned package**, `@dripfunnel/storefront-core`, which store repos install | A `core/` folder in each repo guarded only by a CI path check | The AI can't edit a dependency, and a fleet upgrade is a version bump instead of a merge into 1,000 diverged folders (§10). The path check stays as a second line. |
| **Live storefront is a static build on Cloudflare**; preview is a client-rendered SPA | One runtime multi-tenant server-rendered storefront | Static plus edge is fast and cheap; SSR would trade that away. The cost is fleet maintenance and build volume, which §9 and §10 exist to control. |
| **A partner is a row above stores**, and DripFunnel is the **house partner**, configured on the same screens | DripFunnel special-cased; per-partner deployments | One code path for every partner; the house partner differs only in a badge and in not being deletable (CONSOLE-DESIGN §8). |
| **One partner, one brand, one look, one portal host** | Several brands per partner | Decided in [../USERS-AND-DOMAINS.md](../USERS-AND-DOMAINS.md) §2. |
| **Partners are invite only: Admin creates the partner and invites its Owner**, the partner sets itself up, and Admin approves before merchants can sign up under it (decided 2026-09-29) | Partner self-sign-up on `platform.dripfunnel.com` | Every partner is a business relationship DripFunnel has already started, so there is no public sign-up to abuse or screen. The partner still does its own setup; approval is where contract, KYC and billing are checked (USERS-AND-DOMAINS §3). |
| **Provisioning is a Cloudflare Workflow** with a compensation per step, mirrored in the `job` table | A polling job runner; one database transaction | Workers have no always-on process. Provisioning spans Postgres, GitHub and Cloudflare, so no single transaction covers it; failure midway is normal and must leave nothing behind (§5). |
| **Plans and entitlements are a first-class, server-enforced model** | Feature checks scattered through the UI | Hiding a button is not access control. Every limit is checked where the write happens (§6). |
| **Platform billing is its own Stripe Billing integration**, separate from merchants' checkout payments | Reusing the checkout payment adapters | Checkout Stripe takes shoppers' money on each merchant's own keys; platform billing charges partners and merchants. Mixing them mixes two ledgers. |
| **Custom hostnames through Cloudflare for SaaS** | AWS ACM + CloudFront (built in the first platform) | The whole platform is on Cloudflare ([../ARCHITECTURE.md](../ARCHITECTURE.md) §1). The verify, certificate, live flow and the portal's step-by-step experience carry over (§8). |
| **A GitHub App** for every repo operation, short-lived tokens per request | A personal access token per store | A token per store means a secret per store; it breaks long before 1,000 stores. Done before onboarding in volume, because retrofitting credentials across a live fleet is much harder. |
| **Catalogue changes don't rebuild on every edit**; they are published by "Publish now" (limited per plan) and an automatic schedule | Rebuild on every product change (the old deployment tracker) | Build volume would dominate cost at 1,000 stores. New pages still work at once through a client-rendered fallback (§9). |

---

## 2. The hierarchy and table scope

```
Platform (DripFunnel staff, admin console, Admin API)
  └── Partner (a white-label reseller, or DripFunnel as the house partner; platform console, Platform API)
        └── Store (one merchant's store; merchant portal, Store API)
              └── Vendor (a supplier inside a store; UI word "Supplier"; seller_id)
```

- **A store belongs to exactly one partner** (CONSOLE-DESIGN §3 fact 21). Moving it is a
  guided, audited, second-approver flow (§4.4).
- **Vendors belong to a store, never to a partner.** They have no billing record, no repo and
  no build; the SaaS layer only counts them (CONSOLE-DESIGN §3 fact 15).
- **Customers are per store** (USERS-AND-DOMAINS §1) and are the engine's concern, not this
  layer's.

Every table declares its scope; none is "global by accident" (PLATFORM-PROMPT §5.1; the lesson
of SAAS-PLAN §11.3: which rows are tenant-scoped must be declared, not discovered). The SaaS
layer's tables, by scope:

| Scope | Tables (proposed names) | Read and written through |
|---|---|---|
| **Platform** | `staff_user`, platform settings (automatic publish interval, entitlement ceilings, feature flags), `core_release`, storefront templates, integration credentials (references only) | Admin API only |
| **Partner** (`partner_id`) | `partner`, `partner_user`, `partner_look` (versioned), `partner_words`, `partner_domain`, `partner_email_sender`, `email_template`, `plan`, `plan_entitlement`, `plan_price`, partner billing account and invoices | Platform API for that partner; Admin API for staff |
| **Store** (`store_id`, with its `partner_id` for account-level reads) | `store` (with `partner_id`), `store_subscription`, `store_limit_override`, `store_trial_extension`, `store_usage` (DATA-MODEL §2.4), `custom_domain`, `storefront` (repo, hosting target, core version, publish state), `publish_run`, `ai_run`, `support_session`, `job` rows for the store (the merchant's support-access consent is the `store.support_access_allowed` column, DATA-MODEL §2.1, not a table) | Store API for the merchant; Platform API at account level for its partner; Admin API for staff |
| **Store and seller** | None of its own. Audit entries and usage attributed to a vendor carry `seller_id` for filtering | n/a |
| **Cross-scope, append-only** | `activity_log` (actor, partner, store, seller, customer where relevant; [LOGGING.md](LOGGING.md)), `billing_event` (Stripe event ids), `job` (platform-wide rows such as fleet rollouts carry no `store_id`) | Written by the SaaS layer only; read per scope |

A partner reads its stores **at account level**: plan, status, usage, domains, provisioning and
publishing state, never catalogue, orders or customers (USERS-AND-DOMAINS §4). The scoped data
layer enforces that as a scope, not as a UI choice.

---

## 3. Partners

### 3.1 Lifecycle

| State | Meaning | Merchants can sign up | Portal host serves |
|---|---|---|---|
| **Draft** | Signed up, setting up | No | A "not open yet" page |
| **Awaiting approval** | Setup submitted; Admin reviewing contract, KYC, billing | No | The same |
| **Live** | Approved | Yes | The portal in the partner's look |
| **Paused** | No new merchant signups; existing stores run normally | No | The portal, sign-up closed |
| **Offboarding** | Stores being moved to another partner or closed | No | The portal |
| **Closed** | No stores remain | No | Nothing |

What happens to a closed partner's stores is contractual and open (§14). The house partner
can't be paused, offboarded or closed.

### 3.2 Onboarding

Invite only (USERS-AND-DOMAINS §3); `platform.dripfunnel.com` has no sign-up:

1. **Admin creates the partner** in the Admin API (Partner manager or Super admin): name,
   Owner email, country. This creates the `partner` (Draft) and an invitation for its first
   `partner_user` as **Owner**. The Owner accepts it on `platform.dripfunnel.com`, sets a
   password and 2-factor, and signs in. Admin can resend the invitation; the old link stops
   working.
2. It works through a **checklist that can be saved and resumed** (CONSOLE-DESIGN E1): partner
   details, look, words, portal host, preview and shop wildcard domains, email sender domain,
   plans and prices, billing with DripFunnel. Each domain shows the records to add and live
   status. It can start from a copy of the house partner's offer (E2).
3. It submits for approval. **Go-live checks** run first and each failure links to its fix
   (E3): portal host live, email domain verified (or the fallback sender accepted), at least
   one priced plan, legal pages set, a test signup completed.
4. **Admin approves** in the Admin API (Partner manager or Super admin), or sends it back with
   a reason. Approval moves the partner to Live and opens merchant sign-up on its portal host.
5. **Staff-assisted onboarding** (decided 2026-09-29): Partner managers and Super admins can
   do any or all of steps 2 and 3 for the partner, including submitting it, through a
   **setup session** into the partner console (ACCESS §8.2). It uses the same screens and
   the same go-live checks, needs no partner user to exist, and every write is attributed
   to the staff member. At creation, staff choose whether to send the Owner invitation now
   or hold it until the setup is done (decided 2026-09-30, per partner). The partner's payment method and payout
   details are the one exception: only a partner user can enter them. They aren't go-live
   checks, but payouts wait for them.

Partner users hold one of **Owner, Admin, Support, Finance, Read-only** (decided 2026-10-01 on #109);
their permissions are fixed sets in code, as for merchants ([ACCESS.md](ACCESS.md)).

### 3.3 Look

Design tokens applied to the portal and to emails before anything renders, including sign-in,
sign-up, password reset and invitation emails (CONSOLE-DESIGN §3 facts 4, 17; part F):

- name, logo (light and dark), mark and favicon, primary and accent colours, font, corner
  style, sign-in background;
- **contrast checked to WCAG AA before saving**, with an explanation when a colour fails;
- **versioned**: every change is recorded, can be rolled back, and can be scheduled (F8)
  (`partner_branding`, built on #211, DATA-MODEL §2.5; publishing is #162);
- resolved **by hostname** at the edge of every request, cached with explicit invalidation on
  change (PLATFORM-PROMPT §5.3).

### 3.4 Words

Product name ("Northstar Shops"), support email and URL, help centre, terms, privacy policy,
data-processing agreement (an **Impressum** too where the law requires one: a partner in DE, AT
or CH, built on #162), and the **"Powered by DripFunnel"** line: on, off, or by the
partner's plan with DripFunnel (fact 18). Whether a partner may hide DripFunnel everywhere is
open (§14). Email templates (verification code, invitation, password reset, trial ending,
payment failed, store suspended, receipts) are editable in subject and a small set of blocks,
per language *(ask which languages)*, with variables shown as chips (F6).

### 3.5 Domains

A partner owns four kinds of hostname (USERS-AND-DOMAINS §2), all verified through §8:

| Hostname | Example | Records |
|---|---|---|
| Portal host | `store.<partnerdomain>` | CNAME to our Cloudflare for SaaS target, plus verification |
| Preview wildcard | `*.preview.<partnerdomain>` | One wildcard record |
| Shop wildcard | `*.shops.<partnerdomain>` | One wildcard record |
| Email sender domain | `mail.<partnerdomain>` | SES DKIM, SPF, DMARC (§3.6) |

The house partner uses the same pattern on `dripfunnel.com`. Changing a live portal host keeps
the old one redirecting for a period *(ask how long)* (F4).

### 3.6 Email sender

Email is sent through **Amazon SES** from the partner's own verified sender domain. Until the
DKIM, SPF and DMARC records verify, email goes from a **fallback sender** on a DripFunnel
domain with the partner's name as display name (fact 6). The partner console shows each
record's status and offers a test send (F5). Every email a merchant, vendor or customer
receives uses the partner of the store (or portal host) it concerns, never another partner's.

**Built on #274** (`saas/email`, `jobs/queues/deliverers/email.ts`):

- **Who speaks.** Email to partner users and staff (invitations, resets, lock, domain and
  billing notices) comes from DripFunnel, in DripFunnel's look, since both consoles are
  DripFunnel-branded. Email to merchants (plan changes, suspension, restore) comes from the
  store's partner, in its live branding: product name, primary and accent colours, its support
  contact (never DripFunnel's), and "Powered by" unless the partner's setting is off (§3.4). No logo
  until brand files have a public address.
- **From.** Until partners' own domains get SES identities (slice 11), the fallback
  `no-reply@<label>.<SES_SENDER_DOMAIN>` (THIRD-PARTY-ACCESS §2.4); the label is that of the
  partner's portal host, else its shops, preview or email host.
- **Recipients.** Domain live: the Owner. Card declined and payout account failed: the Owner
  and every active Finance user. Store notices: the store's Owners.
- **Links** are minted when the email is sent, in the transaction that sends it.
- **Held:** the store owner invitation waits in the outbox until merchant sign-in can accept it
  (the Store card that follows #274).
- **Suppression.** An address SES reports as a permanent bounce or a complaint gets no merchant
  notice again. Account email (staff and partner invitations, password reset, lock notice) is
  still sent: it is asked for, and one that never arrives locks someone out; SES's own
  account-level suppression still stops dead addresses. The list holds an HMAC of the address
  under `EMAIL_SUPPRESSION_KEY` (migrations/0034): pseudonymous, and unreadable without the key.
- **Language:** English only until partners or stores have one.

---

## 4. Merchant accounts

### 4.1 Signup

A merchant signs up on the partner's portal host, in its look, **or the partner creates the
merchant** from the platform console and the Owner receives an invitation to set a password
(never a password by email). Either way the store is provisioned automatically (§5). Sign-up
is open only while the partner is Live. Signup answers live in a `signup` row between steps
(a password encrypted at rest); nothing else exists until provisioning starts, and the row is
deleted once the store exists. Signup, like every account endpoint, responds identically
whether or not the email has an account ([ACCESS.md](ACCESS.md)).

### 4.2 States

| State | Set by | Portal | Storefront |
|---|---|---|---|
| **Trial** | Signup; ends at `trial_ends_at` | Full use within the plan | Live |
| **Active** | A paid subscription | Full use | Live |
| **Past due** | A failed payment (billing webhook) | **Sign-in works, reads work, writes are blocked** with a clear notice and the way to pay (Owner) | **Keeps selling** as normal (decided 2026-10-05 on #284) |
| **Suspended** | A person: Admin, or the partner (confirmed 2026-09-30: a partner's Owner and Admin may suspend and restore their own merchants, ACCESS §5.3), with a required reason; or dunning, **after 14 days past due** (decided 2026-10-05 on #284) | Sign-in shows why and whom to contact: **the partner's support, never DripFunnel's** (decided 2026-09-30), so white label holds; no writes | A degraded page served by an edge rule, without a rebuild. It tells shoppers to contact the store and carries no DripFunnel contact route |
| **Cancelled** | The Owner, or the end of billing | Read-only until the period ends, then export only | Kept until period end *(ask)* |
| **Closed** | Staff or the partner, after export is offered | Gone | Gone; repo and assets kept for the retention window, then deleted *(ask the window, §14)* |

The row keeps the facts of each state (DATA-MODEL.md §2.1, built on #32); a suspended store
remembers the status it had, so Restore returns to it exactly (decided on #20).

- **Past due blocks writes, never sign-in** (PLATFORM-PROMPT §2 item 7). The gate is applied
  once, in the Store API's resolver scope, from the subscription status cached on the
  session and invalidated by the billing webhook. What past due means for the store's
  vendors is open (§14).
- **Past due, suspended, cancelled and closed are never confused** on any screen
  (CONSOLE-DESIGN §8). Suspended is a person's decision; past due is a billing fact.
- Every state change writes an audit entry and an outbox event (email to the Owner, cache
  purge of the storefront's degraded rule).

### 4.3 What the partner can do to an account

For its own stores only: change plan and entitlement overrides, extend a trial, suspend and
restore, see billing status, domains, provisioning, publishing and usage, create a merchant,
and open support access under §11. It can't change anything inside the store.

**Suspend and restore are confirmed** (2026-09-30, ACCESS §5.3: Owner and Admin): a partner
owns the commercial relationship with its merchants and often bills them, so waiting on a
DripFunnel ticket to stop a non-paying merchant doesn't scale. A reason is required and the
action is audited, as for staff.

### 4.4 Moving a store to another partner

Rare and dangerous (fact 21): it changes the store's look, emails, portal host, plans, billing
and storefront subdomains. A guided Admin API flow that states each change, needs a second
approver, re-points hostnames, moves the subscription, and is recorded as one audited job.

---

## 5. Provisioning

**Signup is automated, with no staff, target under two minutes, and never leaves a half-made
store** (PLATFORM-PROMPT §2 item 8). The merchant sees a real progress experience driven by the
job's actual steps.

`jobs/workflows/provision-store.ts` runs it as a **Cloudflare Workflow**. Each step is
idempotent (a retry after a crash must not create a second store or repo), records itself in
the `job` table (`state`, `attempts`, `last_error`, compensation log), and registers its
compensation before moving on. On an unrecoverable failure the compensations run in reverse,
and the console offers **Retry** or **Undo and clean up** (CONSOLE-DESIGN K2).

| # | Step | Compensation |
|---|---|---|
| 1 | **Account and store**: the user (if new), the `store` row under the partner, the Owner `membership`, `store_subscription` in Trial on the chosen plan. One database transaction | Delete the store and its rows; delete the user only if this signup created it |
| 2 | **Defaults**: store settings from the partner's defaults for new stores (region, currency, languages, tax behaviour, units, sample product), default warehouse, shipping and payment placeholders. **Per-store rows only**, never a shared one (the first platform's `TaxRate` lesson) | Deleted with the store |
| 3 | **Hostnames**: reserve `{shop}` and register `{shop}.preview.<partnerdomain>` and `{shop}.shops.<partnerdomain>` under the partner's wildcards | Release the reservation and routes |
| 4 | **Repo**: the GitHub App creates an empty repo in the `dripfunnel` org and copies `templates/storefront/` into it through the GitHub API | Delete the repo |
| 5 | **Store config**: generate `store.config.ts` (public store key, Shop API URL, hostnames, locales, currencies) and the route shims; pin the current `@dripfunnel/storefront-core` version; set the repo's variables. **No platform secret goes into the repo**: the Cloudflare deploy token stays with the platform (PLATFORM-PROMPT §5.6) | Revert the commit (removed with the repo) |
| 6 | **Hosting target**: the store's Cloudflare project or worker (the hosting model is open, PLATFORM-PROMPT §10) | Delete it |
| 7 | **First build**: preview deploy (seconds, no catalogue), then the first live build, dispatched explicitly and **confirmed complete** from the deploy result, not assumed from a push (the first platform's gap at this step) | Nothing to undo; a failed first build leaves the store usable and shows "storefront build failed, retrying" |
| 8 | **Done**: write `storefront.core_version` and the repo name, emit `store.provisioned`, send the welcome email through the outbox, delete the `signup` row | n/a |

- Steps 1–3 make a usable store: the merchant can enter the portal once they finish. Steps
  4–8 make the storefront, and **are skipped for a store that uses its own frontend** (it gets
  a public store key and allowed origins instead; PLATFORM-PROMPT §5.6). A skipped storefront
  can be added later by running steps 3–8.
- **A custom domain is not part of signup**; the merchant connects it whenever they like (§8).
- Whether "under two minutes" includes the first live build or only a usable portal and
  preview is a judgement to confirm *(ask)*; the live build is the step most likely to exceed
  it.
- The test that matters: inject a failure at every step and assert nothing survives (archived
  ARCHITECTURE §12).

---

## 6. Plans and entitlements

### 6.1 The model

- **Plans are per partner.** Each has a name, description, monthly and yearly price per
  currency, trial length, and entitlements (CONSOLE-DESIGN G1). The house partner's plans are
  DripFunnel's retail plans. Plan names and contents are open (§14). **Decided 2026-10-02**: the
  house partner's plans carry a **10-day trial** (`designs/DF Store Pricing.dc.html`), trial
  length staying a per-plan value; and DripFunnel's own prices to a merchant are quoted and
  invoiced **in the store's currency when it is USD, EUR or INR, and in USD for any other
  currency**. Rejected: a nearest-regional-currency mapping (one more table to explain) and
  restricting sign-up to the three currencies.
- **Three entitlement kinds**: **on/off** (custom domain, offers, vendors, "Powered by"
  removal, A+ content, size charts); **limit** (products, staff seats, vendors, languages,
  currencies); **meter**, counted per billing period (**"Publish now" presses**, AI prompts,
  build minutes, AI cost).
- **Platform ceilings**: DripFunnel sets a maximum per entitlement in the Admin API; a partner
  can't configure a plan above it (G2, R3). **Built on #157** with the versioned catalogue,
  DripFunnel's wholesale fee per plan and the partner's contract (fee currency, conversion
  rates, whether a plan may remove "Powered by"): DATA-MODEL.md §2.3.
- **Who sets what**: the partner sets its plans and their entitlement values, including the
  monthly "Publish now" allowance, in the Platform API (USERS-AND-DOMAINS §4); Admin can set
  them on the partner's behalf, and sets the ceilings. The automatic publish interval is an
  Admin setting with per-plan overrides (§9.2).
- **Per-store overrides**: a partner or Admin can raise or lower one store's entitlement
  (for example extra publishes this month), recorded and audited (`store_limit_override`,
  built on #212; the stored usage it is measured against is `store_usage`).
- Allowed storefront templates, regions, currencies, languages, payment and courier providers,
  whether vendors are offered, and defaults for new stores are partner-level settings within
  platform limits (fact 19, G4–G5).

### 6.2 Enforcement

- **Server-enforced, always.** One service, `saas/entitlements`, answers `can(store, key)` and
  `remaining(store, meter)`; the engine and the Store API call it at the write (creating the
  51st product, inviting a vendor on a plan without vendors, pressing "Publish now"). The UI
  shows the same answer but never decides it.
- **Meters count atomically** and reset per the store's billing period. A **failed build never
  counts** against the "Publish now" allowance (decided).
- A limit reached explains itself and points to the upgrade, shown to the Owner only.
- **Lowering a limit below current usage pauses what is over it, never deletes it, and the
  Owner chooses what stays** (decided 2026-10-02 with Gaurav on #186's review, recorded on #182, with the prototype's *Choose what to keep*;
  this reverses "existing items keep working"): before the smaller plan takes effect, the
  Owner picks which products, staff, payment gateways, couriers and markets remain within
  the new limits; the rest is paused, invisible to shoppers and kept intact, and comes back
  on an upgrade. Adding more is blocked with a clear explanation. Rejected: everything
  existing keeps selling (over-limit catalogues would make the limit meaningless).

### 6.3 Changing and retiring plans

- **Grandfathering is explicit** (G6): changing a plan that stores are on asks "Apply to new
  signups only, or to everyone at renewal?". Plans are versioned so a store's subscription
  points at the version it bought (built on #157: an edit writes the next `plan_version`).
- **Retiring a plan** (G7) hides it from signup; existing stores keep it or move on a stated
  date.
- Promotions on plans (first months discounted, signup coupons) are open (G8).

---

## 7. Billing

### 7.1 Two relationships

Never mixed on one screen without labels, and never a price without its currency and who
charges it (fact 20, H1–H2):

| Relationship | Payer | Payee | What it counts |
|---|---|---|---|
| **Partner billing** | Partner | DripFunnel | Contract terms: per store, per plan, revenue share, minimum commitment or flat fee *(ask)*; usage over allowance |
| **Merchant billing** | Merchant | Either **the partner** (it invoices its merchants itself; DripFunnel never sees them as payers) or **DripFunnel on the partner's behalf** (Stripe Connect or similar, paying the partner out) | The store's plan, overage (AI, builds) |

These are different products. **Decided 2026-09-28: both are designed; DripFunnel billing on
the partner's behalf ships first** (merchant payments, monthly payouts to the partner, the
partner's margin shown against DripFunnel's wholesale cost), and "the partner bills its own
merchants" follows as a per-partner setting. For the house
partner, DripFunnel bills its merchants directly, which is the second model with DripFunnel as
the partner.

**Built on #212**: `partner.billing_mode` (`dripfunnel` | `own`) and `store.billing_status`
(DATA-MODEL §2.4). When the partner bills its merchants itself, the platform still needs the store's status.
How it learns it (the partner sets status through the Platform API, a webhook from the
partner's billing, or both) is open (§14).

### 7.2 Mechanics

- **Stripe Billing** for subscriptions, invoices and payment methods, on DripFunnel's
  platform Stripe account; card details never touch our servers, and screens show the last 4
  digits only.
- **Webhooks** arrive at `hooks.dripfunnel.com/stripe` (`src/hooks/stripe.ts`), are verified
  by signature, and are **idempotent through `billing_event`**: the Stripe event id is
  inserted first, and a duplicate is acknowledged and ignored. Webhooks arrive more than once
  and out of order; the handler reads the current object from Stripe rather than trusting the
  event's order.
- **Built on #201** (`hooks/stripe.ts`, `saas/billing`): the signature is checked within five
  minutes, the object is read back from Stripe before anything is written, and the event id and
  its effects are one transaction, so a replay or a late event changes nothing twice. A merchant's
  subscription invoice is one `merchant_charge` row whichever retry paid it, a refund its own row;
  each Connect payout is its own row for the month before it arrives, carrying what the month's
  other live payouts don't (a failed one carries none), so a month is counted once; whatever its
  charges don't explain is the adjustment. Money in a currency the contract doesn't pay out in is
  logged as `currency_mismatch` with the partner, marks its feed stale, isn't kept and is answered
  503 so Stripe keeps delivering it; never shown as handled. A read that
  commits after a newer one never takes a paid charge, Billing's attempt count, a failed payout or
  a decided test deposit back. Stripe ids are committed before the calls that make Stripe
  send events about them, and an event no partner holds the ids of is therefore not ours: it isn't
  kept and is answered 200, so it never holds the endpoint up. Stripe slow answers 503 so Stripe delivers again, and marks the partner's
  feed stale, found by the event's Connect account or customer. Store-side writes (`store_subscription`, the merchant's invoices) are the Store
  strand's (ui/store/FIRST-RELEASE.md §20, SAPI 19).
- The webhook updates `store_subscription` (or the partner's account), invalidates the cached
  status on sessions, and writes outbox events for emails and storefront rules, in one
  transaction.
- **What was charged and paid out** is stored as rows (built on #163, DATA-MODEL §7.9):
  `merchant_charge` with DripFunnel's fee and the partner's share in the payout currency,
  `partner_payout` per month, and `store_sales_month`. The Dashboard and Reports sum these, never
  a plan price times a count.
- **Trials** end at `trial_ends_at`, with a "trial ending" email from the partner's templates.
- **A paid-to-paid plan change is prorated** (decided 2026-10-02, `PortalBilling`): the
  merchant is charged today for the days left in the period on the new plan minus the unused
  part of the old one, then the new price from the next period; the screen states both amounts
  and the date before confirming. The change is one invoice with a charge line and a credit
  line (DATA-MODEL §2.2's billing row; the tables in full on #187). A downgrade is scheduled for the period end and the chosen plan is
  recorded on the subscription until then (§6.3).
- **The merchant's billing details** on DripFunnel's invoices (decided 2026-10-02): legal name,
  address, email and an optional tax number (GSTIN for India, VAT number for the EU), editable
  by the Owner. Where the number is valid, the invoice applies the local rule (reverse charge
  in the EU; input tax credit on the GST invoice in India). New invoices follow new details;
  issued ones are never rewritten.
- **Finance actions** (H3): change plan, extend trial, apply credit, refund, retry a failed
  payment, mark an invoice paid, cancel at period end or now. Each states the money effect
  before confirming and is audited. Money is integer minor units with a currency.
- **Usage billing** (H6): AI and build overage per store is shown before it is invoiced.
- **Tax invoices** per the payer's country (VAT, GST) for partner billing.
- **Stripe down or late**: screens say the status may be minutes behind, with the time of the
  last event (H7). Nothing blocks a merchant because a webhook is late.

### 7.3 Dunning

Past due stores by age (1–7, 8–14, 15+ days), the retry schedule, emails sent, and the moment
past due becomes suspended (H4): **after 14 days unpaid** (decided 2026-10-05 on #284). Payouts to partners, when
DripFunnel bills on their behalf, show period, gross, fees, payout and status (H5).

---

## 8. Domains

Every partner and merchant hostname is a **Cloudflare for SaaS custom hostname** on our zone,
with the certificate issued automatically (USERS-AND-DOMAINS §5). `saas/domains` calls the
Cloudflare API through `integrations/cloudflare`; **no provider call ever comes from a
browser.**

**States** (CONSOLE-DESIGN M1): waiting for DNS → verifying → issuing certificate → live, or
failed; a live hostname can become expiring or broken if its records change.

1. The merchant (portal) or partner (platform console) enters the hostname.
2. The platform creates the custom hostname and shows the exact records to add: the CNAME
   target and the ownership record Cloudflare asks for.
3. A check runs on a schedule and on "Re-check now"; a stuck domain shows the record expected
   next to what DNS returns (M2). The portal keeps the step-by-step experience of DESIGN-BRIEF
   flow 58. **Partner addresses on #197**: each address's records (DATA-MODEL §2.1), all of
   which must match for live; waiting addresses are re-checked every 10 minutes from the
   per-minute cron, and `partner-domain-live` is queued for the partner when one goes live
   (delivered once SES's `email` deliverer is wired). **Built on #33 for partner hostnames**: the console queues the check through the
   outbox and `jobs/queues/deliverers/domainRecheck.ts` asks one fixed DNS-over-HTTPS resolver
   for the record after commit, so a user's hostname never becomes a host the Worker connects
   to; it moves waiting → live, or failed, or broken once a live record changes. **Merchant
   domains the same way on #34** (`custom_domain.recheck`): the CNAME decides the status and
   the ownership TXT is recorded for the certificate step. The certificate states (verifying,
   issuing) arrive with the Cloudflare for SaaS integration (THIRD-PARTY-ACCESS §2.1).
4. Once the certificate is issued the hostname is live and routed to the store's live site
   (merchant domain) or the portal (partner host).
   **The portal's four steps** (decided 2026-10-02, `SetStore`): *Add the record* → *We check
   it* → *Security certificate* → *Live*; their mapping onto the built states, the re-check
   schedule and removal are data facts in DATA-MODEL.md §7.2.
5. The hostname and its state live in `custom_domain` (merchant) or `partner_domain`
   (partner), never on the store row.

A merchant's custom domain is an entitlement (§6). Until one is connected the live site is at
`{shop}.shops.<partnerdomain>`.

**Verify before building** (USERS-AND-DOMAINS §5):
- **Wildcards**: can `*.preview.<partnerdomain>` and `*.shops.<partnerdomain>` be wildcard
  custom hostnames, on which Cloudflare plan?
- **Apex**: most DNS providers can't CNAME an apex (`merchantbrand.com`). Require `www` with a
  redirect from the apex, or support apex records (CNAME flattening, fixed IPs)?
- **Limits and price** per custom hostname at thousands of merchants.

---

## 9. Storefront publishing and the AI designer

### 9.1 Publishing the live site

Specified in [../storefront/ARCHITECTURE.md](../storefront/ARCHITECTURE.md) §4.2; the SaaS layer
owns the state and the rules:

- **Change detection**: engine events (product, version, collection, filter, menu, content,
  storefront-visible settings) mark the store's `storefront` **"has unpublished changes"**,
  with what changed and since when. This is an engine table, not in-memory state (the old
  tracker broke with more than one instance).
- **"Publish now"**: the merchant presses it (a `publish` capability, [ACCESS.md](ACCESS.md));
  it uses one press from the plan's **monthly allowance** (§6). The button shows what is
  waiting, presses left, and the next automatic publish. At zero it explains itself.
- **Automatic publish** (`jobs/cron.ts`): every store with unpublished changes is published on
  the **schedule set in the Admin API**: a platform default interval with per-plan overrides
  (CONSOLE-DESIGN R5, which shows the fleet build-minute cost before saving). It never uses
  the allowance. Stores with no changes aren't rebuilt. Whether partners may set their own
  interval is open (§14).
- **Staff publishes**: Admin can run a publish without using the allowance, for example after a
  failure on our side (L5).
- **One build at a time per store**: a press during a build queues the next; changes made
  during a build go in the next one.
- **Real status**: queued, building, deploying, live, failed, recorded in `publish_run` from the
  Workflow (`jobs/workflows/publish-storefront.ts`) and the Cloudflare deploy result. A failed
  build keeps the previous live site, says so plainly, and **never uses an allowance**.
- **Design changes** go live only when the merchant approves them (§9.2).
- **Degraded store** (past due, suspended): an edge rule, no rebuild.
- Publishing is a capability, **separate from settings**: holding it grants nothing else
  (the lesson of the first platform's `UpdateChannel` trap, where one permission both published and
  could rewrite deploy credentials). Deploy credentials are never on a row a merchant can
  write.

### 9.2 The AI designer loop

`saas/ai-designer`, with the storefront side in [../storefront/ARCHITECTURE.md](../storefront/ARCHITECTURE.md) §6:

```
merchant describes a change in the portal
  → agent edits src/theme/** in a sandbox checkout of the store repo
  → typecheck, lint, contract tests, a11y, performance budget, smoke test, visual diff
  → preview deploy with screenshots and a diff for the merchant
  → merchant approves (or asks again, or discards)
  → commit to main → live build → publish → cache purge
```

**Guardrails, in priority order** (PLATFORM-PROMPT §2 item 14):

1. **Path allowlist**: the agent's tool may write only `src/theme/**`, and CI fails any change
   outside it. Enforced by tooling, not by prompting.
2. **Build and typecheck must pass**: never deploy a broken store.
3. **Smoke test the critical path**: home → product → add to cart → checkout loads → payment
   element renders in test mode. Core is locked, but CSS can still hide a button.
4. **Dependency allowlist**: no arbitrary installs.
5. **Per-plan budgets**: prompts per month and build minutes (meters, §6), or build compute
   eats the margin. A budget reached stops new runs, never a run in progress.
6. **Preview before publish, always**: the AI never writes straight to live.

**Undo last change** is `git revert` of the approved commit and a rebuild. A change that fails
a gate is reported in plain words and the preview stays at the last good version.

**Metering**: every run writes an `ai_run` row: store, requesting user, prompt, model, tokens
in and out, cost (minor units and currency), build minutes, gate results, resulting commit,
preview URL, outcome (approved, discarded, failed). It is the source for the AI budget meter,
usage billing and the metrics in §12.

**Open**: where the agent executes (GitHub Actions, Cloudflare Containers, or elsewhere;
[../ARCHITECTURE.md](../ARCHITECTURE.md) §8); whether the AI reads the store's catalogue
(real product imagery) and what that costs per prompt.

---

## 10. Fleet

This is where repo-per-store fleets normally die. Because the AI never touches core, **core
stays upgradable across every store indefinitely**, but only if the sync bot exists from day
one, not later.

- **Core versions**: `@dripfunnel/storefront-core` follows semver on GitHub Packages
  (`core_release` records each one). Every store's pinned version is on its `storefront` row,
  so drift is visible (CONSOLE-DESIGN L1: "132 stores are 3+ versions behind").
- **Sync bot** (`jobs/workflows/core-upgrade.ts`): for a release, open a version bump on each
  store repo through the GitHub App, run the store's CI, and auto-merge when gates pass, then
  rebuild both modes.
- **Canaries, then waves**: a canary group first, then percentages, with pause and roll back
  per rollout; per-store PR and CI status shown (L2). A rollout is a platform-level `job`.
- **Majors** may change the theme contract and ship **upgrade notes**; an agent reconciles
  each theme against them, runs the gates and produces a preview and visual diff. Unchanged
  visuals auto-merge; changed ones go to the merchant or to staff *(ask who approves)*.
- **Security fixes** can be forced to every store as a patch.
- Without this, a checkout fix or a dependency CVE becomes 1,000 manual pull requests.

Open: one template or several theme families (several multiply the bot's work); whether
merchants ever get direct repo access (it would break the bot's assumptions; today they
never see code).

---

## 11. Support access and audit

Specified in [ACCESS.md](ACCESS.md) §8 (support access) and §10 (audit), from
USERS-AND-DOMAINS §4.1. In short, and not to be restated elsewhere:

- A standing merchant setting, **On by default**, that the Owner can switch off; sessions are
  **read-only, time-limited, need a reason or ticket**, show a banner to everyone in the store,
  and appear in the merchant's support access log and the audit log. Write access is a
  one-session elevation the merchant approves. **This is a partner capability only**: staff
  never open a support session, they impersonate (ACCESS §8.1).
- **Every write and every sign-in is logged** with the real actor, scope, action, target,
  changes and reason, in the activity log ([LOGGING.md](LOGGING.md)). It can't be edited or
  deleted, and its entries appear on the store and partner pages they concern
  (CONSOLE-DESIGN P1–P3).

The SaaS layer owns `store.support_access_allowed`, the `support_session` table and the `activity_log`
and the services that write them; every Platform and Admin API write goes through a resolver
scope that writes the activity entry structurally, so "did this write log?" is never a review
question.

---

## 12. Metrics from day one

The model's viability rests on two numbers, tracked **per store per month from the first
store** (PLATFORM-PROMPT §2 item 24). They need a home at the moment the work runs, which is
why `ai_run`, `publish_run` and `job` are tables, not logs:

- **Build minutes**: if not roughly flat per store, repo-per-store doesn't reach 1,000 stores.
- **AI tokens and cost**: the input to plan pricing.

Also: provisioning success rate and **time to first store**, failed builds after AI edits,
core version drift, "Publish now" presses against allowance, automatic publish volume, domain
time to live. Each is available per partner and per store (CONSOLE-DESIGN B2, K3, N1–N3), with
outlier alerts ("AI cost 6× plan allowance this month"). Every log line carries request,
partner, store and seller ids.

---

## 13. Which API exposes what

The SaaS layer is services; the APIs expose them with a declared API, permission and scope per
resolver (PLATFORM-PROMPT §2 item 17). The Store API never carries platform operations above a
store (§5.5 there).

| Capability | **Store API** (merchant, portal host) | **Platform API** (partner, `platform.dripfunnel.com`) | **Admin API** (staff, `admin.dripfunnel.com`) |
|---|---|---|---|
| Create a partner and invite its Owner (no partner sign-up) | | | Partner manager, Super admin |
| Partner checklist, go-live checks, submit for approval | | Own partner | Any, through a setup session (ACCESS §8.2): Partner manager, Super admin |
| **Approve** or send back a partner; pause, offboard, close | | Request only | Partner manager, Super admin |
| Look, words, email templates, email sender | | Own | Any |
| Partner domains (portal host, wildcards) | | Own | Any; re-check |
| Plans, prices, entitlement values, "Publish now" allowance | Read own plan and usage | **Edit own**, within ceilings | Any; set ceilings |
| Automatic publish interval | Read next run | Read *(ask whether partners may override)* | Set default and per-plan overrides |
| Merchant signup | Sign-up on the portal host | Create a merchant (invitation) | Create for any partner |
| Store state: trial extension, suspend, restore, close | Owner: cancel own | Own stores, account level *(ask suspend)* | Any; move to another partner (second approver) |
| Subscription and payment method | Owner: own | Own merchants, when it bills them | Finance: any |
| Billing with DripFunnel (partner invoices, payouts) | | Own (Finance, Owner) | Finance: any |
| Custom domain | Owner: connect, re-check | See status | Any; re-check |
| Provisioning progress and retry | Own signup progress | See status | Retry, undo and clean up |
| "Publish now", publish status | Publish capability | See status | Publish without allowance |
| AI designer runs, undo | Own store | Usage only | Usage and runs for support |
| Fleet: core releases, rollouts, drift | | | Engineer on call, Super admin |
| Support access setting and log | Owner: setting; everyone: log | Start a session (own stores) | See the setting and every session; **staff never start one** — they impersonate (ACCESS §8.1) or open a setup session (§8.2) |
| Activity log ([LOGGING.md](LOGGING.md) §6) | The store's entries, shoppers' included (Owner); own actions (everyone) | Own users, own partner account and merchants' accounts; never inside stores or shoppers | Everything |
| Metrics and usage | Own usage against plan | Own partner and stores | Everything |
| Integration credentials | | | Status only, never the value |

The Platform API is GraphQL like the others (decided 2026-10-03 on #155;
`apps/api/schema/platform.graphql`).

---

## 14. Open questions

**Partners and accounts**
- What happens to a closed partner's stores (contractual)?
- Can a partner hide DripFunnel completely (portal, emails, storefront, invoices)?
- Which partner-console actions need a second approver?
- How long does an old portal host keep redirecting after a change?
- Which email templates and languages are editable per partner?

**Plans and billing**
- Plan names and contents (house partner and defaults for new partners).
- The merchant billing model: by the partner, by DripFunnel on its behalf, or both, and
  **which comes first**. Wholesale pricing: per store, per plan, revenue share, minimums?
- When the partner bills its merchants, how does the platform learn a store's status?
- ~~Dunning policy: when does past due become suspended, and what does a suspended or past-due
  storefront show?~~ After 14 days; past due keeps selling, suspended shows the unavailable page
  (decided 2026-10-05 on #284).
- What does past due mean for the store's vendors?
- Promotions on plans for merchant signups.
- May partners set their own automatic publish interval, within a platform minimum?

**Provisioning, storefronts and fleet**
- Does "under two minutes" include the first live build?
- ~~Cloudflare hosting model per store (Pages, Workers, Workers for Platforms).~~ A Pages project
  per store (decided 2026-10-05 on #284).
- Wildcard custom hostnames, apex domains, and per-hostname limits and price (§8).
- ~~Where the AI agent runs~~ (GitHub Actions, decided 2026-10-05 on #284); does the AI read the
  catalogue, and at what cost? (SAPI 17 asks)
- Staging storefronts per store, or preview builds only?
- One template, or several theme families?
- Do merchants ever get direct repo access?
- Who approves visual changes from a core major?

**Retention**
- What happens to a store's repo, live site, assets and data on cancellation and on closure:
  retention window and export path?
