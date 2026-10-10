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

Last updated: 2026-10-09 (#520, with Gaurav: public store repos built by GitHub Actions, files in R2
served by the edge Worker, previews on `webpreview.store`, drafts private until their publish is live; #493: no
in-app purchase in the merchant mobile app).

---

## 1. Decisions

Recorded so they aren't relitigated.

| Decision | Rejected | Why |
|---|---|---|
| **A repo per store**, created when the merchant first picks a template; **the AI writes the store's theme code** (`src/theme/**`, `content/**`, `routes.json`) behind a file allowlist, a code validator, sealed components and gates; each change that passes is a commit in the store's private draft, pushed to its **public** repo once its publish is live (decided 2026-10-08 with Gaurav on #470, "Plan A"; public repos and drafts decided 2026-10-09, [../storefront/LIVE-SHOP.md](../storefront/LIVE-SHOP.md) §1) | The AI editing a fixed site-data schema (`site.json`; decided earlier the same day, reversed); a design tree or HTML blocks | Merchants want any design they can describe or show; every schema caps that. Logic stays in core and the engine, and the walls don't depend on the AI behaving ([../storefront/ARCHITECTURE.md](../storefront/ARCHITECTURE.md) §1, §3). |
| **AI changes run in Cloudflare Containers**: one container per store with a studio open, held by one Durable Object per store that runs one change at a time (decided 2026-10-08 on #470). **Publish builds run in the store repo's locked GitHub Actions workflow**, inside the public build image, and upload to R2 through credentials minted after a GitHub OIDC check (decided 2026-10-09 with Gaurav) | GitHub Actions for AI changes (decided 2026-10-05 on #284; 30–90 s per change); builds in a container pool (2026-10-08, replaced); a third-party sandbox | Seconds per change, beside R2 and the Worker, and stores never share a machine ([../storefront/AI-STUDIO.md](../storefront/AI-STUDIO.md)). Builds cost nothing on public repos, and no repo holds a secret ([../storefront/LIVE-SHOP.md](../storefront/LIVE-SHOP.md) §1). |
| **Nothing reaches live that hasn't passed**: a deterministic build, a full gate, an atomic deploy, post-deploy checks and automatic rollback; repairs and bisecting before refusing; repairs and gate runs at the platform's cost (decided 2026-10-08 on #470) | Build on publish and hope | A failure leaves the live site as it was and never costs the merchant ([../storefront/ARCHITECTURE.md](../storefront/ARCHITECTURE.md) §4.2). |
| **Commerce in a versioned package**, `@dripfunnel/storefront-core`, which store repos pin (the build image has it preinstalled) | A `core/` folder in each repo guarded only by a CI path check | The AI can't edit a dependency, and a fleet upgrade is a version bump instead of a merge into 1,000 diverged folders (§10). The path check stays as a second line. |
| **Live storefront is a static build on Cloudflare**; preview is a client-rendered SPA | One runtime multi-tenant server-rendered storefront | Static plus edge is fast and cheap; SSR would trade that away. The cost is fleet maintenance and build volume, which §9 and §10 exist to control. |
| **A partner is a row above stores**, and DripFunnel is the **house partner**, configured on the same screens | DripFunnel special-cased; per-partner deployments | One code path for every partner; the house partner differs only in a badge and in not being deletable (CONSOLE-DESIGN §8). |
| **One partner, one brand, one look, one portal host** | Several brands per partner | Decided in [../USERS-AND-DOMAINS.md](../USERS-AND-DOMAINS.md) §2. |
| **Partners are invite only: Admin creates the partner and invites its Owner**, the partner sets itself up, and Admin approves before merchants can sign up under it (decided 2026-09-29) | Partner self-sign-up on `platform.dripfunnel.com` | Every partner is a business relationship DripFunnel has already started, so there is no public sign-up to abuse or screen. The partner still does its own setup; approval is where contract, KYC and billing are checked (USERS-AND-DOMAINS §3). |
| **Provisioning is a Cloudflare Workflow** with a compensation per step, mirrored in the `job` table | A polling job runner; one database transaction | Workers have no always-on process. Provisioning spans Postgres, GitHub and Cloudflare, so no single transaction covers it; failure midway is normal and must leave nothing behind (§5). |
| **Plans and entitlements are a first-class, server-enforced model** | Feature checks scattered through the UI | Hiding a button is not access control. Every limit is checked where the write happens (§6). |
| **Platform billing is its own Stripe Billing integration**, separate from merchants' checkout payments | Reusing the checkout payment adapters | Checkout Stripe takes shoppers' money on each merchant's own keys; platform billing charges partners and merchants. Mixing them mixes two ledgers. |
| **Custom hostnames through Cloudflare for SaaS** | AWS ACM + CloudFront (built in the first platform) | The whole platform is on Cloudflare ([../ARCHITECTURE.md](../ARCHITECTURE.md) §1). The verify, certificate, live flow and the portal's step-by-step experience carry over (§8). |
| **A GitHub App** for every repo operation, short-lived tokens per request, used by the platform only (never inside a sandbox). A store repo's build proves itself with GitHub OIDC and holds no token (decided 2026-10-09) | A personal access token per store; a Cloudflare token in each repo's secrets | A token per store means a secret per store; it breaks long before 1,000 stores. Done before onboarding in volume, because retrofitting credentials across a live fleet is much harder. |
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
   one priced plan, legal pages set. (A test signup was dropped from the checks on #421: sign-up
   opens only once a partner is Live, so it could never pass.)
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
- the merchant mobile app's icon, Android icon foreground and splash, which each partner's app
  build takes (#495; mobile-app/merchant/BUILD-CHECKLIST §2);
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

A partner owns three kinds of hostname (USERS-AND-DOMAINS §2), all verified through §8:

| Hostname | Example | Records |
|---|---|---|
| Portal host | `store.<partnerdomain>` | CNAME to our Cloudflare for SaaS target, plus verification |
| ~~Preview wildcard~~ | ~~`*.preview.<partnerdomain>`~~ | Retired: previews are on `{key}.webpreview.store` (decided 2026-10-09, [../storefront/PREVIEW.md](../storefront/PREVIEW.md)). Built on #197 and #306 as a domain kind; it goes with #518 |
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
- **Merchant links** (store invitations, password reset; #290) lead to the partner's live portal
  host; until it has one, the email waits, checked hourly and never counted toward giving up (`NotYet`). An invitation to an account that
  already has a password links to `/join`, any other to `/accept-invite` (ACCESS.md §6.2).
- **Suppression.** An address SES reports as a permanent bounce or a complaint gets no merchant
  notice again. Account email (staff and partner invitations, password reset, lock notice) is
  still sent: it is asked for, and one that never arrives locks someone out; SES's own
  account-level suppression still stops dead addresses. The list holds an HMAC of the address
  under `EMAIL_SUPPRESSION_KEY` (migrations/0034): pseudonymous, and unreadable without the key.
- **Shoppers** (#312) hear from the store: its name as the sender's, its partner's colours and "Powered by", and the
  store's contact email as the support line; the order confirmation and the shipping news (FIRST-RELEASE §19, SAPI 13).
- **Language:** English only until partners or stores have one.

---

## 4. Merchant accounts

### 4.1 Signup

A merchant signs up on the partner's portal host, in its look, **or the partner creates the
merchant** from the platform console and the Owner receives an invitation to set a password
(never a password by email). Either way the store is provisioned automatically (§5). Sign-up
is open only while the partner is Live. Signup answers live in a `signup` row between steps
(the password kept as its hash, never reversible, decided on #290); nothing else exists until
provisioning starts, and the row is deleted once the store exists, or by the cron a day after
it was started. **Built on #290** (`apis/store/signup.ts`): name, email and password; a code
emailed when the email is sent (made for every sign-up, so the next step answers alike; an
address that already has an account is emailed how to sign in instead, without it); starts
capped per typed address, per client address and per partner (500 an hour); store name, web address and country (the partner's live plans'
currencies decide which countries, the country decides the currency); a texted code (three per sign-up in ten minutes, three per number a day, 200 per partner an hour); then
steps 1–3. The store starts in Trial on the partner's cheapest live plan in that currency, for
the plan's trial days or 14 when it sets none (decided on #290). Signup, like every account endpoint, responds identically
whether or not the email has an account ([ACCESS.md](ACCESS.md)).

### 4.2 States

| State | Set by | Portal | Storefront |
|---|---|---|---|
| **Trial** | Signup; ends at `trial_ends_at` | Full use within the plan | Live |
| **Active** | A paid subscription | Full use | Live |
| **Past due** | A failed payment (billing webhook) | **Sign-in works, reads work, writes are blocked** with a clear notice and the way to pay (Owner); the store's suppliers keep their stock and shipping going and aren't told (below) | **Keeps selling** as normal (decided 2026-10-05 on #284) |
| **Suspended** | A person: Admin, or the partner (confirmed 2026-09-30: a partner's Owner and Admin may suspend and restore their own merchants, ACCESS §5.3), with a required reason; or dunning, **after 14 days past due** (decided 2026-10-05 on #284) | Sign-in shows why and whom to contact: **the partner's support, never DripFunnel's** (decided 2026-09-30), so white label holds; no writes | A degraded page served by an edge rule, without a rebuild. It tells shoppers to contact the store and carries no DripFunnel contact route |
| **Cancelled** | The Owner, or the end of billing | Read-only until the period ends, then export only | Live until the paid period ends, then offline; kept 90 days (decided 2026-10-05 on #337) |
| **Closed** | Staff or the partner, after export is offered | Gone | Gone; repo and assets kept **90 days**, then deleted (decided 2026-10-05 on #337) |

The row keeps the facts of each state (DATA-MODEL.md §2.1, built on #32); a suspended store
remembers the status it had, so Restore returns to it exactly (decided on #20).

- **Past due blocks writes, never sign-in** (PLATFORM-PROMPT §2 item 7). The gate is applied
  once, in the Store API's resolver scope, from the subscription status cached on the
  session and invalidated by the billing webhook. The store's **suppliers keep working** while it
  is past due (stock, shipping) and aren't told about its billing (decided 2026-10-05 on #337,
  Store FIRST-RELEASE §1). Built on #295 in the Store API's access policy: a supplier's
  `storeState` isn't read-only, and its stock, warehouse and fulfilment writes go on; its other
  writes (its products, its team) wait as the merchant's do. A cancelled store is read-only for everyone.
- **Past due, suspended, cancelled and closed are never confused** on any screen
  (CONSOLE-DESIGN §8). Suspended is a person's decision; past due is a billing fact.
- Every state change writes an audit entry and an outbox event (email to the Owner, cache
  purge of the storefront's degraded rule).
- **Built on #329, part 2**: `cancelStore` (the Owner's, never a support session's) makes the store
  cancelled and read-only at once. A paid plan ends at its period's end through Stripe's
  `cancel_at_period_end`, and the Shop API keeps selling until `cancel_at`; a trial or a free plan
  ends at once. The Owner gets `store-cancelled`, which says the data is kept 90 days, and
  `exportStoreData` works while read-only. The cron ends each trial past `trial_ends_at` with no plan
  chosen: it moves to the partner's free plan in the store's currency, with Choose what to keep
  applied (§6.2), or becomes past due where the partner has none. *Decided here*: that past-due
  store may still choose a plan while read-only, since paying is how it leaves (ui/store
  FIRST-RELEASE.md §3.3). The 90-day deletion is Closed's, not built here.

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
| 3 | **Hostnames**: reserve `{shop}` and register `{shop}.shops.<partnerdomain>` under the partner's wildcard as its own custom hostname (wildcard custom hostnames need Enterprise). The preview needs none: `{key}.webpreview.store` ([../storefront/PREVIEW.md](../storefront/PREVIEW.md) §2) | Release the reservation and routes |
| 4 | **Repo** (when the merchant first picks a template): the GitHub App creates an empty **public** repo with an opaque name in the `dripfunnel` org and copies `templates/storefront/` with the chosen template's theme and the locked build workflow into it through the GitHub API ([../storefront/LIVE-SHOP.md](../storefront/LIVE-SHOP.md) §3) | Delete the repo |
| 5 | **Store config**: generate `store.config.ts` (public store key, Shop API URL, hostnames, locales, currencies) and the route shims; pin the current `@dripfunnel/storefront-core` version. **The repo holds no secret or variable, and one locked workflow** that builds inside the public build image and uploads through GitHub OIDC ([../storefront/LIVE-SHOP.md](../storefront/LIVE-SHOP.md) §4); every Cloudflare credential stays with the platform | Revert the commit (removed with the repo) |
| 6 | **Hosting target**: the store's folder in R2, served by the edge Worker; nothing to create (decided 2026-10-09, replacing a Pages project per store: 100 projects per account; [../storefront/LIVE-SHOP.md](../storefront/LIVE-SHOP.md) §1) | Delete the store's folders in both storefront buckets, and its draft, source bundles and snapshots in the drafts bucket (storefront LIVE-SHOP §4 step 11) |
| 7 | **First preview**: the template's ready-made preview bundle copied into the store's preview folder in R2 (seconds, no container; [../storefront/PREVIEW.md](../storefront/PREVIEW.md) §4), **confirmed complete** from the copy's result, not assumed (the first platform's gap at this step). The first live build is the merchant's first Publish (§9) | Nothing to undo; a failed first preview leaves the store usable and shows "storefront build failed, retrying" |
| 8 | **Done**: write `storefront.core_version`, `template` and the repo name, `repo_state = 'ready'`, emit `storefront.created` | n/a |

- Steps 1–3 make a usable store: the merchant can enter the portal once they finish. **Built on
  #290** (`saas/provisioning/provisionStore.ts`): all three are database writes today, so they
  run in one transaction with the texted code that starts them, and a failure anywhere leaves
  nothing (tested at each step); step 2's defaults arrive with each settings table's card, and
  step 3's hostnames are the store's code under the partner's wildcards (built for both the
  preview and shops wildcards; the preview one goes with #518). Signup ends there:
  `store.provisioned`, the welcome email through the outbox, the `signup` row deleted.
- Steps 4–8 make the storefront **when the merchant first picks a template** (decided
  2026-10-08 on #470), as the `create-storefront` Workflow with their compensations (INF 1).
  They **never run for a store that uses its own frontend** (it gets a public store key and
  allowed origins instead; PLATFORM-PROMPT §5.6), and run whenever such a store first picks a
  template.
- **A custom domain is not part of signup**; the merchant connects it whenever they like (§8).
- "Under two minutes" means a **usable portal and preview** (decided 2026-10-05 on #337): the
  portal at signup, the preview within seconds of picking a template (steps 4–8); the first
  live build is the first Publish, shown as 'Publishing…'.
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
- **Four kinds of plan setting** (card #458; the keys are `apps/api/src/db/scoped/planKeys.ts`,
  51 rows in the order and groups of `designs/DF Store Pricing.dc.html`; `live_offers` added on #320): **on/off** (custom
  domain, offers, suppliers, "Powered by" removal, A+ content, size charts, badges, product
  video, imports, reports, white-label and more); **limit** (products, staff seats, suppliers,
  languages, currencies, photos, markets, couriers and more); **meter**, counted per billing
  period (**"Publish now" presses**, AI prompts); **choice** (support level, abandoned-cart
  reminders, AI mode), stored as an index. A limit of **Unlimited** is the int4 maximum
  (2147483647). A row is **enforced** when the server checks it where the write happens, or
  **Planned** when its feature isn't built: the value is stored and the console tags the row,
  and nothing checks it until the feature ships. Enforced today: the original 13 and badges,
  FAQs and related products, product video, spreadsheet import and Shopify import, and since #320 `live_offers`, `group_offers` (customer-group and chosen-customer offers,
  tiers, single-use codes) and `offer_results`; since #321 `cart_reminders` (decided there: `youSend` sends by hand only,
  one a cart; `onePerCart` sends the first reminder automatically; `automatic` sends all three, with codes and WhatsApp); a version
  written before the five catalogue rows existed starts with them on, and one written before `live_offers` with it
  unlimited, so no store loses a section or an offer.
- **Platform ceilings**: DripFunnel sets a maximum per entitlement in the Admin API; a partner
  can't configure a plan above it (G2, R3). **Built on #157** with the versioned catalogue,
  DripFunnel's wholesale fee per plan and the partner's contract (fee currency, the other
  currencies its plans may be priced in with an optional conversion rate, whether a plan may
  remove "Powered by"): DATA-MODEL.md §2.3. Admin sets the contract (admin FIRST-RELEASE §4.3).
- **Who sets what**: the partner sets its plans and their entitlement values, including the
  monthly "Publish now" allowance, in the Platform API (USERS-AND-DOMAINS §4); Admin can set
  them on the partner's behalf, and sets the ceilings. The automatic publish interval is an
  Admin setting with per-plan overrides; **a partner may set its own per plan, never more often
  than hourly** (decided 2026-10-05 on #337).
- **Per-store overrides**: a partner or Admin can raise or lower one store's entitlement
  (for example extra publishes this month), recorded and audited (`store_limit_override`,
  built on #212; the stored usage it is measured against is `store_usage`).
- Allowed storefront templates, regions, currencies, languages, payment and courier providers,
  whether vendors are offered, and defaults for new stores are partner-level settings within
  platform limits (fact 19, G4–G5).

### 6.2 Enforcement

- **Server-enforced, always.** One service, `saas/entitlements`, answers `can(store, key)` and
  `remaining(store, meter)`; the engine and the Store API call it at the write (creating the
  51st product, inviting a supplier on a plan without suppliers, pressing "Publish now"). The UI
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
- **What it covers.** A row tagged **Planned** (§6.1) is never checked, so no store can be over
  it and nothing pauses; the card that enforces a row adds its keep-or-pause rule. An
  **Unlimited** limit is never near and never over: usage reads it as no cap, whatever an
  override adds.
- **Built on #329, part 2, for products** (`planKeep`, `keepProducts(ids)`): the picks are for a
  scheduled smaller plan, the free plan a trial ends on, or else the plan the store is on, where
  they apply at once. What stays is every product with an order waiting to ship, then the Owner's
  picks, then the best sellers and the most recently changed. The rest gets `hidden_by = 'plan'` when
  the plan takes effect, and a bigger plan brings it back. `NOTHING_TO_KEEP` answers when the
  catalogue already fits. *Decided here*: only products pause here, because staff, gateways,
  couriers and markets get their keep rule with the card that enforces their limit (above).

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
- **Built on #329** (`saas/storeBilling`, `apis/store/billing.ts`), the store's own plan: one Stripe
  subscription per store on DripFunnel's account, priced from the plan version it buys, with the
  store, plan and version in its metadata. Leaving the trial starts the first period now (the
  prototype's "Choose plan"), and a free plan needs no card and nothing on Stripe. A plan at a
  higher monthly price, or monthly to yearly, may move now, prorated by Stripe and invoiced at once
  (`error_if_incomplete`: a declined card leaves the plan as it was); a lower one, or yearly to
  monthly, waits for the period's end as a Stripe subscription schedule, recorded as
  `next_plan_*` and applied when the subscription's metadata names it. Asking for the plan it has
  calls a scheduled change off. One change at a time per store (`billing_claim`, two minutes), and
  each Stripe write's idempotency key is the change and the store's `billing_revision`, which moves
  only when a change is recorded or Stripe refuses one: two tabs, or a retry after a commit that was
  lost once Stripe had answered, never charge twice.
  `customer.subscription.*` events set the subscription's status and period and the store's
  past due, paid and cancelled; merchant invoices are also kept as `invoice` rows with their lines.
  *Decided here*: Stripe's own PDF is the invoice's PDF (as the partner's), so no `pdf_asset_id`;
  the partner's Connect transfer and DripFunnel's fee on these subscriptions are a follow-up.
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
past due becomes suspended (H4): **after 14 days unpaid** (decided 2026-10-05 on #284). **Built on
#329**: the cron suspends every store 14 days past due, by `Billing` with the partner's support as
its contact, and emails the Owner. A suspended store can't pay in the portal (§4.2), so its reason
names no way to but that contact, which may restore it (ACCESS §5.3); Stripe reporting it paid
afterwards (its own retry) restores it and makes it active, while a person's suspension stays. Payouts to partners, when
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
   the ownership TXT is recorded for the certificate step. For the portal host, once
   DNS passes, the status is Cloudflare's own: verifying, issuing, live (`hostStatusOf`).
   **Edge routing (checked 2026-10-05, dev):** each environment's zone holds a proxied
   fallback-origin record, `portal.edge.<zone>` → the store Pages project, set as the zone's
   Cloudflare for SaaS fallback origin; `EDGE_ZONE` names the zone and so the CNAME targets
   partners are shown (`dripfunnel.ai` dev, `dripfunnel.com` prod). Custom hostnames need a
   token with *SSL and Certificates: Edit* on that zone. Adding one returns `pending` and an
   ownership record of Cloudflare's own (`_cf-custom-hostname.<host>`).
   **Origin routing (checked 2026-10-05, dev, free plan):** a SaaS hostname reaches the fallback
   origin with the partner's own `Host`, and Pages answers only hostnames added to its project,
   so it returns 522. Rewriting `Host` to the Pages name is an Origin Rule, **Enterprise only**;
   adding every partner host to the Pages project hits its per-project domain cap and cannot
   take wildcards. What works is a **Worker on a catch-all route** (`*/*` on the zone): it
   receives the partner host first, sends `/api/*` to the API Worker and the rest to Pages
   (whose own URL gives it the right `Host`), and keeps the partner's own `Host` on `/api/*`.
   Hosts on our own zone pass through untouched, and `dev-admin`, `dev-platform`, `dev-store`
   and `dev-hooks` answered as before.
   **Not built (#426):** the API Worker routes any other host's `/api/*` to the Store API
   without checking the host is registered (`resolveArea`). The decided design is a
   `PortalProxy` entrypoint reached only through the proxy's service binding, with the partner
   found in `partner_domain` by host.
   Removing a partner domain (`removePartnerDomain`) queues `domain.remove`, which deletes the
   SaaS hostname after commit; the console has no Remove button yet.
4. Once the certificate is issued the hostname is live and routed to the store's live site
   (merchant domain) or the portal (partner host).
   **The portal's four steps** (decided 2026-10-02, `SetStore`): *Add the record* → *We check
   it* → *Security certificate* → *Live*; their mapping onto the built states, the re-check
   schedule and removal are data facts in DATA-MODEL.md §7.2.
5. The hostname and its state live in `custom_domain` (merchant) or `partner_domain`
   (partner), never on the store row.

A merchant's custom domain is an entitlement (§6). Until one is connected the live site is at
`{shop}.shops.<partnerdomain>`.

**The merchant's side** (decided 2026-10-08 on #470, drawn in `PortalStorefront` › Site
settings › Domains, which replaces the Store info card planned on #300): the free address is
listed first and always works; the merchant connects **one** domain they own (a paid plan's
entitlement; on Free the button opens the upgrade), sees the records to add with Copy buttons,
and presses **Check now**; the states read *Waiting for DNS* → *Securing (SSL)…* → *Connected ·
secure*. A connected domain can be made **primary** (the other addresses redirect to it) or
**removed** (shoppers on it stop reaching the shop; the free address keeps working). Only one
domain waits for DNS at a time. Domain changes need no publish. The records shown are this
partner's (`EDGE_ZONE`, above); the prototype's values are examples. Built on #471 (the Store
API) and #468 (registration through Cloudflare for SaaS).

**Verify before building** (USERS-AND-DOMAINS §5):
- ~~**Wildcards**: can `*.preview.<partnerdomain>` and `*.shops.<partnerdomain>` be wildcard
  custom hostnames, on which Cloudflare plan?~~ Enterprise only (checked 2026-10-09): each
  store's shops hostname is registered on its own, and previews moved to `webpreview.store`.
- **Apex**: most DNS providers can't CNAME an apex (`merchantbrand.com`). Require `www` with a
  redirect from the apex, or support apex records (CNAME flattening, fixed IPs)?
- ~~**Limits and price** per custom hostname at thousands of merchants.~~ 100 included, then
  $0.10 a month each, up to 50,000 below Enterprise (checked 2026-10-09).

---

## 9. Storefront publishing and the AI designer

### 9.1 Publishing the live site

Specified in [../storefront/ARCHITECTURE.md](../storefront/ARCHITECTURE.md) §4.2 (the publish
pipeline: freeze, build, full gate, repair or bisect, deploy, post-deploy checks, rollback); the
SaaS layer owns the state and the rules:

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
  the allowance. Stores with no changes aren't rebuilt.
- **New and renamed products** get a **single-page render** at once (the page, its sitemap
  entry, the old address's redirect, IndexNow), using no allowance (decided 2026-10-08 on #470;
  storefront ARCHITECTURE §4.2).
- **Staff publishes**: Admin can run a publish without using the allowance, for example after a
  failure on our side (L5).
- **One build at a time per store**: a press during a build queues the next; changes made
  during a build go in the next one. Publish builds run in the store repo's workflow on GitHub
  Actions ([../storefront/LIVE-SHOP.md](../storefront/LIVE-SHOP.md) §4); "Publish now" goes
  ahead of automatic publishes.
- **Real status**: queued, building, checking, deploying, live, failed, rolled back, recorded in
  `publish_run` from the Workflow (`jobs/workflows/publish-storefront.ts`), the build's run and
  the switch of the live pointer, with the gate's report. A refused or rolled-back publish keeps the previous
  live site, says so plainly, and **never uses an allowance**.
- **Who pays for checking**: repair attempts and gate runs are the platform's cost, recorded
  for §12 and never counted on the merchant's meters (decided 2026-10-08 on #470).
- **Design changes** go live only when the merchant publishes them (§9.2).
- **Degraded store** (past due, suspended): an edge rule, no rebuild.
- Publishing is a capability, **separate from settings**: holding it grants nothing else
  (the lesson of the first platform's `UpdateChannel` trap, where one permission both published and
  could rewrite deploy credentials). Deploy credentials are never on a row a merchant can
  write, and never in a repo or a sandbox; a build gets only a 15-minute credential for a private
  staging folder, after a passing report, and never one that names a build folder
  ([../storefront/LIVE-SHOP.md](../storefront/LIVE-SHOP.md) §4 step 8, §9).

### 9.2 The AI designer loop

`saas/ai-designer`, with the storefront side in [../storefront/ARCHITECTURE.md](../storefront/ARCHITECTURE.md) §6.
**Decided 2026-10-08 with Gaurav on #470 ("Plan A")**: the AI writes the store's theme code in
the store's own sandbox, behind the walls of storefront ARCHITECTURE §3.

```
"Your brand" saved (shop name and logo at least)
  → chooseTemplate: the template becomes the theme; the first time, the store repo is created
    (§5 steps 4–8); later, "keep my words" or "use template text"
  → askDesign(text, image?, sampleSite?, page, device): the Worker asks the model with the
    store's theme files, core's theme API and its rules, the page and screen size, the last
    four requests, the brand and ~12 products (names, prices)
  → the store's Durable Object runs the diff in the store's container: the fast gate
    (allowlist, validator, typecheck, bundle, byte budgets, content checks)
      fail → the model repairs from the exact errors (≤3) → else refused: nothing changes
      and the reply says so
  → pass → a commit in the store's private draft; the studio frame shows it at once and the
    preview gets the same bundle ([../storefront/AI-STUDIO.md](../storefront/AI-STUDIO.md) §4)
  → undo (revert the latest change), discard (back to the live version's commit),
    Open preview (signed link)
  → publishDesign: the publish pipeline (§9.1) builds the draft from private storage → a new
    version in the history; once it is live, its tree is pushed to the store repo as one squashed
    commit with a platform-written message (GitHub App)
```

**Guardrails, in priority order** (PLATFORM-PROMPT §2 item 14):

1. **Walls, not prompting**: a change becomes the draft only after the file allowlist, the
   validator and the fast gate accept it, and goes live only after the full gate
   (storefront ARCHITECTURE §3.3, §4.2). Prices, stock, products, shipping and checkout
   behaviour are core's and the engine's, so asking for them changes nothing; the reply
   points to Products or Settings.
2. **Never trusted, never given anything**: the model's output is a file diff, data until the
   gates pass it. The sandbox has no network and no credential; the model call, the keys, the
   draft and the push to GitHub stay in the Worker and the Durable Object.
3. **Per-plan budgets**: AI tokens per month (or the merchant's own OpenAI or Anthropic key
   on plans without included AI) and build minutes (meters, §6). A budget reached stops new
   requests and publishes, never one in progress. Repairs and gate runs don't count (§9.1).
4. **Draft before publish, always**: the AI never writes straight to live.

**Studio sessions** (storefront ARCHITECTURE §6.1): one Durable Object and one container per
store with a studio open; one change at a time per store (a second tab waits); a container
stops after idle minutes and restarts from the last saved draft (private R2,
[../storefront/AI-STUDIO.md](../storefront/AI-STUDIO.md) §7); when the account's container limit
is reached, studios queue and show their place. Container time is recorded per request in
`ai_run.sandbox_ms`.

**Versions**: every publish is a numbered version holding its commit, template, core version,
gate report and build in R2. **Go back to this** makes that version's build live again by moving
the pointer (no build, no build minutes; a rebuild, uncharged, if the build is gone, **or if a security
release of core is newer than the version's core**, so a forced fix is never undone; a version
whose theme fails the gate on the fixed core can't be gone back to, and the merchant is told why), then resets
the draft to that version's commit (decided 2026-10-08 on #470). The history is kept for the plan's
number of days; the live version always stays.

**Brand and search and sharing** (`storefront_brand`, `storefront_seo`, #471) reach the theme
through core (`useStorefront()`), never through the AI's files; they go out with the next
publish of any kind, except the home page's search and sharing, which re-renders the home page
at once (a single-page render, no allowance).

**Metering**: every request writes an `ai_run` row: store, requesting user, prompt, model,
tokens in and out, cost (minor units and currency), container time, repair attempts and their
cost, outcome (changed, nothing changed, refused, failed). The merchant's meter counts the
request's own tokens; repairs are recorded as the platform's cost. It is the source for the AI
meter, usage billing and §12's metrics; build minutes come from `publish_run`.

~~**Open**: where the agent executes~~ **GitHub Actions** (decided 2026-10-05 on #284);
~~one Store API call, no agent run (2026-10-08 on #470)~~ **Cloudflare Containers**, one per
store with a studio open (decided 2026-10-08 on #470, "Plan A"); publish builds in the store
repo's GitHub Actions (decided 2026-10-09). ~~Whether the AI reads the
store's catalogue~~ **It reads a sample** (about 12 products: names and prices; photos dropped
on #470), metered in `ai_run` (decided 2026-10-05 on #337).

---

## 10. Fleet

This is where repo-per-store fleets normally die. The AI never touches core, so **core stays
upgradable across every store**, but every store's theme is its own code, so each upgrade is
built and gated per store, and the upgrade bot must exist from day one.

- **Core versions**: `@dripfunnel/storefront-core` follows semver on GitHub Packages
  (`core_release` records each one, with its sandbox image). Every store's pinned version is
  on its `storefront` row, so drift is visible (CONSOLE-DESIGN L1: "132 stores are 3+ versions
  behind").
- **Upgrade bot** (`jobs/workflows/core-upgrade.ts`): for a release, build each store's current
  published commit with the new core in its repo's workflow, in the new version's build image
  ([../storefront/LIVE-SHOP.md](../storefront/LIVE-SHOP.md) §8), apply the release's codemods, run the full
  gate and a visual diff against the live site; for a **patch or minor**, a store that passes
  goes live on the new core and its repo's `package.json` is committed; for a **major**, the
  result is recorded and the new core reaches the store only at its merchant's next publish
  (below); a store that fails gets the **migration agent**
  (the AI with the errors and the upgrade notes, under the same walls); a store still failing
  **stays on its old version**, pinned, with an alert (CONSOLE-DESIGN L1–L3).
- **Canaries, then waves**: a canary group first, then percentages, with pause and roll back
  per rollout; per-store gate result shown (L2). A rollout is a platform-level `job`.
- **Majors** may change the look or the theme contract and ship **upgrade notes** and
  codemods. Each published version is **pinned** to the core version it was built with
  (decided 2026-10-08 on #470); a major's new look reaches a store only at its merchant's next
  publish, so **the merchant** still approves visual changes (decided 2026-10-05 on #337).
- **Security fixes** are forced to every store as a patch. A store whose theme can't build on
  it, even after the migration agent, is served the **baseline theme** with its own colours,
  fonts and words until repaired or republished, and its merchant is told (decided 2026-10-08
  on #470).
- Without this, a checkout fix or a dependency CVE becomes 1,000 manual pull requests.

**Templates** are the starting themes of storefront ARCHITECTURE §2.3, and merchants **never
get direct repo access** (decided 2026-10-05 on #337).

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
- **AI tokens and cost**: the input to plan pricing, **container time and repairs included**
  (the platform's own cost, §9.1).

Also: provisioning success rate and **time to first store**, failed builds after AI edits,
**changes refused after repairs, publishes refused, bisected or rolled back, and stores pinned
or on the baseline theme** (storefront ARCHITECTURE §4.2, §7), studio queue waits, core version
drift, "Publish now" presses against allowance, automatic publish volume, domain
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
| Automatic publish interval | Read next run | Set per plan, never more often than hourly (decided 2026-10-05 on #337) | Set default and per-plan overrides |
| Merchant signup | Sign-up on the portal host | Create a merchant (invitation) | Create for any partner |
| Store state: trial extension, suspend, restore, close | Owner: cancel own | Own stores, account level *(ask suspend)* | Any; move to another partner (second approver) |
| Subscription and payment method | Owner: own | Own merchants, when it bills them | Finance: any |
| Billing with DripFunnel (partner invoices, payouts) | | Own (Finance, Owner) | Finance: any |
| Custom domain | Owner: connect, re-check | See status | Any; re-check |
| Provisioning progress and retry | Own signup progress | See status | Retry, undo and clean up |
| "Publish now", publish status | Publish capability | See status | Publish without allowance |
| AI designer runs, undo | Own store | Usage only | Usage and runs for support |
| Fleet: core releases, rollouts, drift, pinned stores and stores on the baseline theme | | | Engineer on call, Super admin |
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
- ~~What does past due mean for the store's vendors?~~ They keep working and aren't told (decided 2026-10-05 on #337; §4.2).
- Promotions on plans for merchant signups.
- ~~May partners set their own automatic publish interval, within a platform minimum?~~ Yes, per plan, minimum hourly (decided 2026-10-05 on #337).

**Provisioning, storefronts and fleet**
- ~~Does "under two minutes" include the first live build?~~ No: the portal and preview (decided 2026-10-05 on #337).
- ~~Cloudflare hosting model per store (Pages, Workers, Workers for Platforms).~~ A Pages project
  per store (decided 2026-10-05 on #284); replaced by R2 and one edge Worker for every store
  (decided 2026-10-09, [../storefront/LIVE-SHOP.md](../storefront/LIVE-SHOP.md)).
- ~~Wildcard custom hostnames~~ (Enterprise only) and ~~per-hostname limits and price~~ ($0.10
  after 100, up to 50,000) answered 2026-10-09; apex domains still open (§8).
- ~~Where the AI agent runs~~ (GitHub Actions, decided 2026-10-05 on #284; **Cloudflare
  Containers**, decided 2026-10-08 on #470; builds moved to store repos' GitHub Actions on
  2026-10-09); ~~does the AI read the catalogue~~ a sample of about
  12 products (decided 2026-10-05 on #337).
- The container limits and price at the expected number of open studios, and whether a plan caps
  simultaneous studio sessions *(decide, INF 0 #287 and the sandbox card)*.
- ~~Staging storefronts per store, or preview builds only?~~ Preview builds only (decided 2026-10-05 on #337).
- ~~One template, or several theme families?~~ One template (decided 2026-10-05 on #337), with
  six starting themes and "Start from scratch" in it (decided 2026-10-08 on #470).
- ~~Do merchants ever get direct repo access?~~ Never (decided 2026-10-05 on #337).
- ~~Who approves visual changes from a core major?~~ The merchant (decided 2026-10-05 on #337).

**Retention**
- ~~What happens to a store's repo, live site, assets and data on cancellation and on closure:
  retention window and export path?~~ Live to the end of the paid period, then everything kept 90 days with export, then deleted (decided 2026-10-05 on #337).