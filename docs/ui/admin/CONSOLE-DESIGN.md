# CONSOLE-DESIGN.md

The prompt for a design session that produces a **clickable prototype of the admin console**
(`apps/ui/admin` at `admin.dripfunnel.com`; older documents call it DF Admin): the internal
console DripFunnel staff use to run the whole platform. It manages **partners** and their
white-label **brands** (a partner resells the platform under its own name and look, and has
exactly one brand), every **store** under every partner, **billing** at both levels, and the
configuration that decides what each partner and store can do. **DripFunnel's own offering is
one partner in this console (the house partner), managed exactly like the others**, and the
admin console is the only operations console: there is no separate back office.

Paste §1 to start. Then name a part from §6, or say "all of it, in order". It follows the
conventions of [`../store/CATALOG-DESIGN.md`](../store/CATALOG-DESIGN.md).

> **Status (updated 2026-09-28).** This document was rewritten on 2026-09-28 for the platform's
> own engine: §3 now states engine facts instead of the first platform's framework facts, and nothing in it is built
> yet. [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) and
> [`../../USERS-AND-DOMAINS.md`](../../USERS-AND-DOMAINS.md) win wherever this document
> disagrees with them. There are **two consoles**. The **admin console** is `apps/ui/admin`
> at **`admin.dripfunnel.com`**, for DripFunnel staff only, calling the Admin API; it manages
> every partner and the platform. The **partner console** is `apps/ui/platform` at
> **`platform.dripfunnel.com`**, for Partner users only, calling the Platform API; the two
> never share screens or endpoints. "Brand" in this document means a **partner**'s
> white-label identity; DripFunnel is also a partner. Partners are **invite only**: **Admin
> creates** a partner and invites its Owner (there is no partner sign-up), the partner sets
> itself up, and **Admin approves** it before merchants can sign up under it. Partners manage their merchants
> **at account level, plus audited, consented, read-only support access**. Every part in §6
> is designed for the admin console and carries a **"Partner console:"** line saying what
> the partner console shows instead: nothing, or a counterpart scoped to that partner's own
> merchants, with Admin-only controls left out.
>
> Last updated: 2026-10-09 (previews off the partner domain; fleet parts for AI-written themes on #470).

---

## 1. The prompt

> You are designing the **admin console**, the internal console of the **DripFunnel**
> commerce platform, as a **clickable prototype** with realistic sample data. Nothing of it
> exists yet.
>
> **The platform in one paragraph.** DripFunnel hosts online stores on its own headless
> commerce engine. A *merchant* signs up, gets a store (its own `store` row in the engine,
> and, unless they bring their own frontend, its own storefront repo deployed to
> Cloudflare), pays a subscription, and runs the store from the **merchant portal**. A
> merchant can invite *vendors* whose products appear in their catalogue. Shoppers see only
> the storefront.
>
> **White-label brands.** DripFunnel sells the platform to **partners** (agencies, resellers,
> payment companies, marketplaces, large retailers) who offer it to their own merchants
> **under their own name**. A partner's merchants sign up at the partner's portal host, see
> the partner's logo, colours and emails, pay the partner's prices, and may never see the
> word "DripFunnel". Each partner has exactly one **brand**. Partners sign themselves up in
> the **partner console** and go live only once DripFunnel staff approve them here.
> **DripFunnel itself is the house partner**: the direct-signup offering, configured on the
> same screens as every other partner, never special-cased in the UI except that it cannot
> be deleted.
>
> So the hierarchy has four levels, and every screen is clear about which level it is on:
> **Platform** (DripFunnel staff, this console) → **Brand** (a partner, or DripFunnel) →
> **Store** (one merchant's store) → **Vendor** (a supplier inside a store).
>
> **Who uses the admin console.** DripFunnel staff only: founders, support agents, finance,
> partner managers and engineers on call. Partner users have their own console. Staff are
> competent but busy, often in the middle of a customer's problem, and they hold
> **dangerous power**: suspending a store takes a business offline, and a wrong billing
> action charges a real card. The standard is **Stripe Dashboard's clarity with Shopify
> Partners' structure**: search first, everything one click from a customer's name, and
> every destructive action slowed down on purpose.
>
> **What a brand controls** (each is a part in §6):
> - **Look**: portal name, logo, colours, fonts, favicon, sign-in and sign-up pages, and
>   whether "Powered by DripFunnel" shows.
> - **Addresses**: the portal host (e.g. `store.northstarcommerce.com`), the email sender
>   domain, and the storefront shop wildcard (`*.shops.northstar.com`). Previews are on
>   DripFunnel's own `{key}.webpreview.store`, not the partner's domain (2026-10-09).
> - **Messages**: emails (verification, invitations, billing receipts, alerts), legal pages,
>   and support contacts.
> - **Offer**: which plans its merchants can buy, at what prices, with which features, limits,
>   storefront templates, regions, currencies, languages, payment and courier providers, and
>   AI allowance.
> - **Money**: how DripFunnel bills the partner, and how the partner's merchants are billed.
>
> **Read first.** [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) (the admin console is
> `apps/ui/admin`, a static SPA on Cloudflare Pages, calling the Admin API at `/api` on
> `admin.dripfunnel.com`), [`../../USERS-AND-DOMAINS.md`](../../USERS-AND-DOMAINS.md) (the
> five kinds of user, hostnames, partner onboarding and approval, what a partner can see,
> support access), [`../../api/SAAS.md`](../../api/SAAS.md) (partners, provisioning, plans,
> billing, domains, publishing, fleet, metrics) and [`../../api/ACCESS.md`](../../api/ACCESS.md)
> (identity, staff identity, roles, tenancy). §3 below states what the platform provides and why it shapes the interface.
> **Nothing is built yet.** Where a screen depends on something whose release is undecided,
> design it and **label it "(release: decide)"**, so it is a decision rather than a surprise.
>
> **How to work.** One part at a time (§6). For each screen, produce:
> 1. The clickable happy path, then **every** state in §7: empty, loading, error, permission
>    denied (the staff role can't), partial failure, a third-party service down (Stripe,
>    GitHub, Cloudflare, email), and a narrow-laptop layout. The admin console is
>    desktop-first; on a phone it must still let an on-call engineer **find a store and see
>    its status**.
> 2. The **actual words**: labels, helper text, confirmations, errors, empty states.
> 3. A short table mapping each control to the data behind it (engine table and field,
>    Stripe object, GitHub resource, Cloudflare resource, or "(release: decide)").
> 4. The scenarios from §6 that the screen covers, ticked off, and what the part's partner
>    console counterpart leaves out.
>
> Use the sample data in §5 throughout, so the prototype feels like a real platform on a real
> day. Ask me when the spec is silent (§9). When it decides something, follow it. Start by
> restating in your own words what a brand is, what a store is, and who uses the admin
> console. Then wait for me to pick a part.

---

## 2. Vocabulary

The admin console is for insiders, so it may use platform terms, but it uses them
**consistently**, and brand-facing previews use the brand's own words.

| Say this | Behind it | Meaning |
|---|---|---|
| **Platform** | the admin console and Admin API; platform-scoped tables | Everything DripFunnel runs. |
| **Brand** | the brand fields on the engine's `partner` row (look, words, domains, offer) | A partner's white-label identity, or DripFunnel's (the **house brand**). |
| **Partner** | engine `partner` row, with its Partner users | The company behind a brand: its contacts, contract, and billing account. A partner has exactly one brand (decided, USERS-AND-DOMAINS §2). |
| **Partner user** | a Partner identity with a partner role: Owner, Admin, Support, Finance, Read-only (proposed) | A partner's own staff, who use the partner console (`apps/ui/platform`). |
| **Store** | engine `store` row; every tenant-owned row carries its `store_id` | One merchant's store. Never "tenant" or "channel" on screen. |
| **Merchant** | the Owner membership of a store | The business that pays for the store. |
| **Vendor** | a vendor in a store; its rows carry `seller_id` (UI word: "Supplier") | A supplier inside a store. The admin console shows counts, rarely individuals. |
| **Portal** | `apps/ui/store` and the Store API, on the partner's portal host | What merchants and vendors sign in to, shown in the brand's look. |
| **Storefront** | per-store public repo holding the AI-written theme on `@dripfunnel/storefront-core`, built by its GitHub Actions workflow, served from R2 by one edge Worker (live), with the preview on `{key}.webpreview.store` | What shoppers see. A store may use its own frontend instead. |
| **Plan** | engine `plan` table, per partner | What a merchant buys. Each brand has its own plan list. |
| **Entitlement** | engine `entitlement` rows on a plan, enforced on the server | One feature or limit inside a plan (on/off, a limit, or a meter). |
| **Wholesale price** | partner contract terms (release: decide) | What DripFunnel charges the partner per store or per plan. |
| **Retail price** | the partner's plan prices | What the partner charges its merchant. |
| **Subscription status** | the store's subscription status, from Stripe Billing | Trial · Active · Past due · Cancelled · Suspended. |
| **Template** | the storefront template (`templates/storefront`) | The code a store's storefront repo starts from. |
| **Template version** | the `@dripfunnel/storefront-core` version a store repo uses | How up to date a store's storefront is (docs/storefront/ARCHITECTURE.md §7). |
| **Job** | engine `job` table, written by Workflows and Queues | Background work: provisioning, domains, builds, publishing. |
| **Sign in as** | support access session (USERS-AND-DOMAINS §4.1) | A staff member viewing a merchant's portal for support, under the merchant's consent. |

---

## 3. Facts that shape the interface

Nothing below is built yet. Each fact is what the platform provides (or will provide), and
why it shapes the interface. The engine is specified in
[`../../api/PLATFORM-PROMPT.md`](../../api/PLATFORM-PROMPT.md).

### Platform facts

1. **The store is our own `store` row**, and every tenant-owned row carries its `store_id`
   (PLATFORM-PROMPT §5.1). A **brand is a partner's identity above stores**, not a second
   kind of tenant: every store belongs to exactly one partner. Screens are therefore always
   either about a partner or about a store, and say which.
2. **Signup is automatic and staff-free**, but only under a partner Admin has approved
   (USERS-AND-DOMAINS §3). Provisioning is a Workflow with these steps: store and membership
   rows, defaults, repo from the template, secrets and variables, Cloudflare project or
   worker, first build, domain (PLATFORM-PROMPT §5.7). The AI storefront steps can be
   skipped for a store that brings its own frontend. Every step has a compensation, is
   recorded in the `job` table (state, attempts, last error, compensation), and is
   resumable. The admin console is where a stuck or failed signup is seen and retried.
3. **Every hostname is a Cloudflare for SaaS custom hostname** with an automatic certificate
   (USERS-AND-DOMAINS §5): DNS records to add, verification, certificate, live. Partner
   domains (portal host, preview and shop wildcards, email sender domain) and merchants'
   own domains follow the same verify → certificate → live pattern, so one set of status
   words serves every domain screen. Wildcard and apex support are still to be verified
   (release: decide).
4. **The portal is one app (`apps/ui/store`) for every store**, served on each partner's
   portal host. It resolves the partner **from the hostname** and applies the brand's look,
   words and emails before anything renders, including sign-in, sign-up, password reset and
   invitation emails. The portal host a merchant signs up on decides which partner the new
   store belongs to. The two consoles are DripFunnel-branded for every user.
5. **One person, one login, many stores, within a partner** (DESIGN-BRIEF fact 1;
   ACCESS.md §2). Accounts are per partner (decided 2026-09-28): someone who owns a store
   under Northstar and supplies a store under DripFunnel has two unrelated accounts, and no
   brand's sign-in can reveal another's stores. Staff search by email finds both; C3 lists
   each account with its stores.
6. **Email goes through Amazon SES** with one verified sender domain per partner (DKIM, SPF,
   DMARC records the partner adds). While a partner's domain is not verified, a fallback
   sender is used, and the screens say so.
7. **Billing is Stripe Billing** for subscriptions, separate from the per-merchant checkout
   payments that take shoppers' money. Stripe webhooks are processed idempotently, so a
   store's status can be minutes behind Stripe. **Plans and entitlements are engine
   tables** (CATALOG-DESIGN §3 fact 27), enforced on the server, not only hidden in the UI.
   White label adds a second billing relationship (DripFunnel → partner) on top of the first
   (someone → merchant). Which parts of billing ship first is (release: decide).
8. **"Past due" is a designed state, not a lock-out** (DESIGN-BRIEF fact 9): the portal blocks
   writes, the storefront degrades at the edge rather than disappearing. The engine caches
   the gate on the session and invalidates it when billing changes. The admin console shows
   which stores are in this state and why, and must not confuse it with **Suspended** (a
   staff or partner decision).
9. **The storefront is a repo per store** created from the template, its theme written by
   the AI behind walls and gates and its commerce logic in the published
   `@dripfunnel/storefront-core` package (docs/storefront/ARCHITECTURE.md). Every AI change runs
   in the platform's **Cloudflare Containers**; every build runs in the store's public repo on
   GitHub Actions, passes a full gate there, and goes live by an atomic switch of the store's
   build in R2, with automatic rollback (decided 2026-10-08 on #470; builds and hosting
   2026-10-09, docs/storefront/LIVE-SHOP.md). An
   **upgrade bot** rolls `storefront-core` upgrades across the fleet with canaries, codemods and
   a migration agent; a store that can't take one stays pinned, or gets the baseline theme for a
   security fix. The admin console is where fleet drift, rollouts, refused publishes, rollbacks
   and pinned stores are watched.
10. **Two numbers decide whether the business works**: **build minutes** and **AI tokens /
    cost** per store per month, metered in the engine's `ai_run` table and emitted where the
    work happens (PLATFORM-PROMPT §5.7, §5.8). Also: template drift, provisioning success
    rate, time to first store, failed builds after AI edits, repairs (the platform's own AI
    cost), rollbacks. These belong on the admin console's home, per brand and per store.
11. **The admin console is the only operations console.** There is no framework dashboard and
    no other back office: every operation staff need is a screen here, or it does not exist.
    Engineers who need raw data get an engineer-only raw data view inside the admin console,
    audited like every other read of tenant data *(ask)*.
12. **Staff are a separate identity** (PLATFORM-PROMPT §5.2, ACCESS): company SSO with
    2-factor (Cloudflare Access in front of `admin.dripfunnel.com` is recommended,
    ARCHITECTURE §7), their own **staff roles** (§4), and an **audit log** of every write.
    Staff are never a merchant session with a flag, and the admin console never shares
    screens or endpoints with the partner console. Inside a store, staff follow the same
    consented, read-only support rules as partners (USERS-AND-DOMAINS §4.1).
13. **Secrets never reach a browser** (ARCHITECTURE §7): Stripe keys, the GitHub App key, the
    Cloudflare API token, SES credentials, the AI provider key and the Neon connection all
    live in Workers secrets; merchants' API keys and public store keys are hashed at rest.
    The admin console shows **that** a credential is set, when it was rotated and whether it
    works, never the value.
14. **Privacy rules from the portal still hold.** Never reveal whether an email has an account
    (DESIGN-BRIEF §1). In the admin console staff *can* see that, but a **Partner user**
    must never learn that their merchant also has a store under another partner
    (USERS-AND-DOMAINS §1: partners never see other partners).
15. **Vendors belong to a store, never to a brand.** Their rows carry `seller_id` inside the
    store, and they have no billing record (ACCESS). The admin console shows vendor counts
    per store and finds a vendor user in support search, but has no vendor management of its
    own.
16. **Platform-wide settings affect every partner and must say so.** Every engine table is
    declared platform, brand, store or store-and-seller scoped (PLATFORM-PROMPT §5.1).
    Platform-scoped settings (feature flag defaults, platform limits, the automatic publish
    schedule default) change every partner's stores at once, and the screen that edits them
    says "every brand" before saving.

### What white label adds (release: decide)

17. **Brand look** is a set of design tokens applied to the portal and emails: name, logo
    (light and dark), mark/favicon, primary and accent colours, font, corner style, sign-in
    background. Contrast is checked (WCAG AA) before saving.
18. **Brand words**: product name ("Northstar Shops"), support email and URL, help centre link,
    terms, privacy policy, data-processing agreement, and the "Powered by DripFunnel" line
    (on, off, or plan-dependent for the partner).
19. **Brand offer**: plans, prices and entitlements for its merchants; allowed storefront
    templates; allowed regions, currencies and languages; allowed payment and courier
    providers; AI allowance; whether vendors (multi-seller) are offered; default settings for
    new stores.
20. **Brand money**: DripFunnel bills the partner (per store, per plan, revenue share, minimum
    commitment, or a flat fee: *ask*), and the merchant is billed either **by the partner**
    (the partner invoices its merchants; DripFunnel never sees them as payers) or **by
    DripFunnel on the partner's behalf** (Stripe Connect or similar, with a payout to the
    partner). These are different products; design both and ask which is first.
21. **A store belongs to exactly one brand.** Moving a store between brands (a partner buys
    another's customers, a merchant leaves an agency) changes its look, emails, plans and
    billing. It is rare and dangerous, and gets its own guided flow.
22. **Brand lifecycle** (USERS-AND-DOMAINS §3): Draft (being set up) → Awaiting approval →
    Live → Paused (no new signups) → Offboarding (stores being moved or closed) → Closed.
    What happens to a closed brand's stores is **open** and contractual.

---

## 4. Who uses it

| Staff role | Can |
|---|---|
| **Super admin** | Everything, including staff management, platform settings and deleting. Two people at least; never a shared account. |
| **Partner manager** | Approve, create and configure partners, their brands, plans and prices; see their partners' stores and billing. |
| **Support** | Search everything; see store detail; **sign in as** a merchant under support access (§6 J); retry failed jobs; resend emails. No billing changes, no suspensions. |
| **Finance** | Billing, invoices, credits, refunds, dunning, revenue reports. No store configuration. |
| **Engineer on call** | Jobs, fleet, builds, domains, integration health; suspend a store in an emergency. |
| **Read-only** | Sees everything a Support agent sees, changes nothing (auditors, new hires). |

Every write shows who may do it. A control a role can't use is **visible and disabled with the
reason** ("Finance can issue refunds"), so staff know whom to ask. Destructive actions can
require a **second approver** *(ask which)*.

The **partner console** exists (`apps/ui/platform` at `platform.dripfunnel.com`), for Partner
users with the partner roles Owner, Admin, Support, Finance and Read-only (decided 2026-10-01
on #109). Its first release is [FIRST-RELEASE.md](../platform/FIRST-RELEASE.md); every part in
§6 marks its partner console counterpart: what a partner sees and does there for its
own merchants only, with Admin-only controls left out.

---

## 5. Sample data for the prototype

Use fictional companies only. Money in each brand's currency, formatted with
`Intl.NumberFormat`.

| Brand | Kind | Region | Stores | Notes |
|---|---|---|---|---|
| **DripFunnel** | House brand | Global | 1,240 | Direct signups. Cannot be deleted. |
| **Northstar Commerce** | Agency | US, Canada | 86 | Own portal host live; email domain verified; "Powered by" hidden. |
| **Bazaar Cloud** | Reseller | India, UAE | 312 | INR and AED plans; billing by DripFunnel on its behalf; one failed domain. |
| **Kaufladen Digital** | Payments company | Germany, Austria | 40 | Draft brand: look done, plans not priced, email domain pending DNS. |
| **Loom & Thread** | Marketplace operator | UK | 1 store, 64 vendors | A single large store white-labelled for itself. |

Sample stores should include: a healthy store; one on trial ending tomorrow; one past due for
9 days; one suspended for a chargeback; one stuck at "storefront build" in provisioning; one
with a custom domain waiting for DNS; one 4 template versions behind; one with AI cost well
above its plan.

---

## 6. Parts and scenarios

Numbered so coverage can be ticked off. *(ask)* marks a decision needed first (§9).

### A. Signing in and staying safe

**Partner console:** scoped counterpart: Partner users sign in at `platform.dripfunnel.com`
with their own identity, separate from staff and merchants. No self-signup: partner users
arrive only by invitation (USERS-AND-DOMAINS §3). Re-authentication before dangerous actions
and disabled-with-reason controls work the same way; no SSO requirement; an environment
marker on non-production hosts only (decided 2026-10-01). First release:
[FIRST-RELEASE.md](../platform/FIRST-RELEASE.md) §3.

- A1. Sign in with company SSO and 2-factor. No self-signup. Unknown or removed staff are
  refused with no detail.
- A2. Session timeout, re-authentication before dangerous actions (suspend, refund, delete,
  sign in as, change a price).
- A3. An always-visible **environment marker** (Production in red; Dev, Feature or Local in grey, #65) and the signed-in
  staff member's name and role.
- A4. Staff with no access to a section see it disabled with the reason (§4).

### B. Home

**Partner console:** scoped counterpart: for its own merchants only, new stores, signups
failing, stores past due and suspended, domains stuck, publishing failures, usage against
plans, and revenue with its wholesale cost. No platform integration health, no other partners,
no brand filter. First release: [FIRST-RELEASE.md](../platform/FIRST-RELEASE.md) §5.

- B1. Today at a glance: new stores (by brand), signups failing, stores past due, suspended,
  jobs failing, builds failing, domains stuck, integration health (Stripe, GitHub,
  Cloudflare, Neon, email, AI provider).
- B2. The two business numbers (§3 fact 10): build minutes and AI cost per store per month,
  trend and outliers, per brand.
- B3. Revenue: MRR by brand, wholesale vs retail where known, trials converting, churn.
- B4. "Needs attention" list with one action each ("Retry build", "Contact merchant").
- B5. Brand filter at the top: the whole platform, or one brand, applied to every number.

### C. Global search

**Partner console:** scoped counterpart: search its own merchants' stores by name, domain,
code or owner email, and its own invoices. A person's result lists only their stores under
this partner, never that they have stores elsewhere (§3 fact 14). First release:
[FIRST-RELEASE.md](../platform/FIRST-RELEASE.md) §2.2 (stores; invoices are on Billing, §11.3).

- C1. One search box, everywhere (keyboard shortcut): stores by name, domain, code or owner
  email; people by email; brands; invoices by number; jobs by id.
- C2. Results grouped by type, each showing its brand.
- C3. A person's result lists every store they belong to, in every brand, with their role in
  each (§3 fact 5).

### D. Brands list and brand overview

**Partner console:** scoped counterpart: no list; the partner sees its own brand overview
(D2) with its status and setup checklist, without internal staff notes. First release:
[FIRST-RELEASE.md](../platform/FIRST-RELEASE.md) §2.3 (the state banners), §4.

- D1. List: logo, name, kind, status (Draft · Awaiting approval · Live · Paused · Offboarding
  · Closed), stores, MRR, setup completeness ("Email domain not verified"), partner manager.
- D2. Brand overview: health, stores, revenue, usage, setup checklist, recent changes, and
  quick links to each configuration part (E–H).
- D3. The **house brand** looks the same, with a "House brand" badge, and no delete, pause or
  offboard actions.

### E. Create a brand (partner onboarding)

**Partner console:** scoped counterpart: the partner's own onboarding checklist, which its
invited Owner sees on first sign-in (USERS-AND-DOMAINS §3), ending in "Submit for approval"
instead of going live. Contract and billing terms are shown read-only once Admin sets them;
Admin creates the partner (invite only) and approves it here in the admin console. When staff
work through the checklist for the partner (E5), the partner console shows DripFunnel's
banner and marks the items staff completed. First release:
[FIRST-RELEASE.md](../platform/FIRST-RELEASE.md) §4.

- E1. A guided checklist, not a wizard: partner details, contract and billing terms, look,
  addresses, messages, offer, go live. It can be saved and resumed; the brand stays **Draft**
  until submitted, then **Awaiting approval**.
- E2. Start from a copy of another brand's offer (usually DripFunnel's).
- E3. Go-live checks: portal host live, email domain verified (or fallback accepted), at
  least one priced plan, legal pages set (the test signup was dropped on #421). Each failed check explains
  itself and links to the fix. Approval also covers contract, KYC and billing.
- E4. The go-live moment: "Northstar Shops is live at store.northstarcommerce.com. New
  signups there become Northstar stores."
- E5. **Staff-assisted onboarding** (decided 2026-09-29): **Set up for partner** opens the
  partner console for that partner in a staff setup session (ACCESS §8.2). Staff can do any
  or all of the checklist and submit for approval, on the same screens the partner uses,
  before or after the Owner has accepted. **Create partner** offers "Send the Owner
  invitation now" or "Hold it until setup is done" *(proposed)*, and a held invitation is sent
  later with one action. The partner enters its own payment method and payout details.

### F. Branding studio (look, addresses, messages)

**Partner console:** scoped counterpart: all of F for its own brand, with the "Powered by"
choice limited to what its contract allows. First release:
[FIRST-RELEASE.md](../platform/FIRST-RELEASE.md) §8, all of it.

- F1. **Look**: logo (light and dark backgrounds), mark and favicon, colours, font, corner
  style, sign-in background. Contrast checked, with an explanation when a colour fails.
- F2. **Live preview** of the real portal screens in the brand's look: sign-in, sign-up,
  home, product list, settings, on desktop and phone, light and dark. Switch between brands
  side by side.
- F3. **Name and words**: product name, support email and URL, help centre, terms, privacy,
  data-processing agreement, "Powered by DripFunnel" (on / off / by partner's plan).
- F4. **Portal host**: enter it, show the DNS records to add, verification and certificate
  progress, live (§3 fact 3). What the portal shows at the old address after a change.
- F5. **Email**: sender name and address, SPF / DKIM / DMARC records with status, fallback
  sender while pending (§3 fact 6), and a test send.
- F6. **Email templates**: verification code, invitation, password reset, trial ending,
  payment failed, store suspended, receipts. Edit subject and a small set of blocks, preview
  in the brand's look, per language *(ask which languages)*. Variables shown as chips, never
  raw braces.
- F7. **Storefront defaults**: preview and shop wildcards (`{store}.preview.northstar.com`,
  `{store}.shops.northstar.com`), default template, default "Powered by" on storefronts.
- F8. Versioning: every brand change is recorded and can be rolled back; changes can be
  scheduled (e.g. a rebrand on 1 Nov).
- F9. What merchants see when their brand's look changes (a notice, or nothing) *(ask)*.

### G. Brand offer: plans, features and limits

**Partner console:** scoped counterpart: its own plans, prices and entitlements (including
"Publish now" allowances), within the platform ceiling and its contract; wholesale cost shown
read-only; allowed templates, regions and providers chosen from what DripFunnel allows it.
First release: [FIRST-RELEASE.md](../platform/FIRST-RELEASE.md) §7 (G8, promotions, is not
drawn).

- G1. **Plan catalogue per brand**: name, description, monthly and yearly price per currency,
  trial length, and entitlements (§3 fact 19; the on/off, limit and meter kinds from
  CATALOG-DESIGN §3 fact 27).
- G2. An **entitlement matrix**: plans as columns, features as rows (products, staff seats,
  vendors, languages, currencies, A+ content, size charts, AI allowance, custom domain, offers,
  "Powered by" removal, **"Publish now" presses per month**…), with the platform maximum
  shown as a ceiling a brand cannot exceed. The partner sets the "Publish now" allowance per plan in the partner console; staff
  see it here, can set it on the partner's behalf, and set its ceiling (../../api/SAAS.md
  §6.1, docs/storefront/ARCHITECTURE.md §4.2). Failed builds never count against it.
- G3. Wholesale cost beside each retail price, and the partner's margin (§3 fact 20).
- G4. Allowed templates, regions, currencies, languages, payment providers and couriers for
  the brand's merchants.
- G5. Defaults for new stores (tax behaviour, units, sample product on or off).
- G6. Changing a plan that stores are on: "314 stores are on Growth. Apply to new signups only,
  or to everyone at renewal?" Grandfathering is explicit.
- G7. Retiring a plan: hidden from signup, existing stores keep it or move on a date.
- G8. Promotions on plans (first 3 months half price, coupon for signups) *(ask)*.

### H. Billing

**Partner console:** scoped counterpart: its own billing with DripFunnel (H1: invoices,
payment method, status), payouts to itself (H5), and its merchants' billing status, trials
and plan changes (H2, H4, H6). Which merchant billing actions a partner takes when DripFunnel
bills on its behalf is *(ask)*. First release: [FIRST-RELEASE.md](../platform/FIRST-RELEASE.md)
§11.

Two relationships, never mixed on one screen without labels (§3 fact 20).

- H1. **Partner billing** (DripFunnel → partner): contract terms, invoices, what each invoice
  counts (stores × plan, usage over allowance, revenue share, minimum commitment), payment
  status, credit notes, tax invoices per the partner's country (VAT, GST).
- H2. **Merchant billing** (per store): plan, price, next charge, payment method (last 4
  digits only), invoices, trial end, status history. Labelled with **who bills the merchant**:
  "Billed by Bazaar Cloud" or "Billed by DripFunnel for Bazaar Cloud".
- H3. **Actions** (Finance): change plan, extend trial, apply credit, issue a refund, retry a
  failed payment, mark an invoice paid (bank transfer), cancel at period end or now. Each
  shows the money effect before confirming ("Refund ₹4,999.00 to card ending 4242").
- H4. **Dunning**: stores past due by age (1–7, 8–14, 15+ days), retry schedule, emails sent,
  and the moment a store moves from past due to suspended *(ask the policy)*.
- H5. **Payouts to partners** when DripFunnel bills on their behalf: period, gross, fees,
  payout, status.
- H6. **Usage billing**: AI and build overage per store, shown before it is invoiced.
- H7. Stripe is down or a webhook is delayed: what the screens show, and that a store's
  status may be minutes behind (§3 fact 7).

### I. Stores

**Partner console:** scoped counterpart: its own merchants' stores at account level: the list
and store detail (without staff notes or raw data), suspend and restore, change plan, extend
trial, and create a merchant (the Owner is invited to set a password). No move to another
brand, and no view of customers, orders or catalogue outside a support session. First release:
[FIRST-RELEASE.md](../platform/FIRST-RELEASE.md) §6.

- I1. **Stores list** across brands: name, brand, owner, plan, subscription status,
  storefront status, domain, template version, created, last active, MRR. Filters for every
  column, saved views ("Past due in Bazaar Cloud").
- I2. **Store detail**, one page with sections:
  - identity (name, code, brand, owner, created, country);
  - subscription and billing (H2);
  - portal people (counts by role, owner contact) and vendors (count);
  - storefront (repo, template and version, last build, last publish, preview and live URLs,
    custom domain status), or "Own storefront" when the store has no AI storefront;
  - usage (products, orders, build minutes, AI runs and cost, storage) against the plan;
  - provisioning history and jobs (part K);
  - activity and audit (part P);
  - notes from staff (internal only).
- I3. **Actions**, each with its consequence stated first:
  - **Suspend** (reason required, message to the merchant, storefront shows a maintenance
    page or keeps selling: *ask*) and **Restore**;
  - change plan, extend trial (H3);
  - **Move to another brand** (§3 fact 21): shows what changes (look, emails, plans, billing,
    domain) and needs a second approver;
  - transfer ownership to another person (when the owner has left);
  - retry provisioning, rebuild or republish the storefront;
  - **Close** a store: export offered first, retention period stated, and deletion only after
    it (*ask the retention window*);
  - open the store's raw data view (engineers only, audited, §3 fact 11) *(ask)*.
- I4. Suspended vs past due vs cancelled vs closed, each unmistakable (§3 fact 8).

### J. Impersonate (sign in as a user)

**Partner console:** partners don't impersonate. Their support opens the merchant's portal
through a read-only, consented support session (USERS-AND-DOMAINS §4.1), started from the
store's page. First release: [FIRST-RELEASE.md](../platform/FIRST-RELEASE.md) §12.

Decided 2026-09-28 (USERS-AND-DOMAINS §4.2, ACCESS.md §8.1):

- J1. **Impersonate** lists the users staff can sign in as: every partner user and every
  store user (Owner, Manager, Staff, supplier admins and members), searchable by name or
  email, filterable by partner, store and role. Never staff, never shoppers. The same action
  is on each partner's Team tab and each store's Users tab.
- J2. **Super admin and Support only**; re-authentication and a reason or ticket first; 30
  minutes, **extendable once by 30** as an explicit, logged action and never silently.
  **No consent needed**: the merchant's Support access setting doesn't apply to staff.
- J3. **Full access as the user**: the staff member sees and does exactly what that user can,
  **except** changing the user's password, 2-factor or sign-in methods, payment or payout details, or ownership (transferring the store or partner, or changing the Owner); those controls show disabled with "Only Priya can change this".
  For a person in several stores (or several suppliers in one store), staff pick which one.
- J4. An unremovable bar for the staff member ("You are signed in as Priya Mehta (Owner,
  Mehta Textiles). Ends in 28 min. End now"), and a banner on the impersonated side for
  everyone signed in to that store or partner console ("Support (Arjun) is signed in as
  Priya. Ends in 28 min."). Always "Support", never "DripFunnel".
- J5. Every action is logged as "Arjun as Priya" in the activity log, the store's or
  partner's log, and the user's own activity.

### K. Provisioning and jobs

**Partner console:** scoped counterpart: its own merchants' signups in progress and failed,
with the step reached in plain words (K1). A partner **may retry** a failed step: Owner and
Admin (decided 2026-10-01 on #109); no raw errors, no queue health. First release:
[FIRST-RELEASE.md](../platform/FIRST-RELEASE.md) §6.3.

- K1. Signups in progress and failed, per brand, with the step reached (§3 fact 2): store and
  membership rows, defaults, repo from template, secrets and variables, Cloudflare project or
  worker, first build, domain.
- K2. A failed job: error in plain words first, raw error behind "Details", attempts,
  compensation already run, and **Retry** or **Undo and clean up**.
- K3. Time to first store and success rate, trended (§3 fact 10).
- K4. Job queue health: pending, running, stuck (running too long).

### L. Fleet and storefronts

**Partner console:** scoped counterpart: publishing status and "Publish now" presses used for
its own merchants (L5, read-only), and which templates its brand offers (L4, read-only). No
rollouts and no build internals. First release:
[FIRST-RELEASE.md](../platform/FIRST-RELEASE.md) §6.3 (the Storefront tab), §10 (Usage).

- L1. Template versions across all stores, with drift ("132 stores are 3+ versions behind"),
  **pinned stores** (an upgrade failed) and **stores on the baseline theme** (a security fix
  their theme couldn't take), each with the reason.
- L2. **Rollouts** of a `@dripfunnel/storefront-core` upgrade: canary group, then percentages,
  with pause and roll back; per-store gate result (passed, migrated by the agent, pinned,
  baseline) (§3 fact 9).
- L3. **The ops queue**: publishes refused after repair and bisect, automatic rollbacks and
  the check that caused them, changes the AI couldn't repair, sealed-component violations
  reported by live sites; each with the store, the commit and the gate's report, and a
  **Rebuild** that uses no allowance.
- L6. **Studio capacity**: open studio sessions, the queue and its waits, container time per
  day against the account's limits (storefront AI-STUDIO §7), and the GitHub org's Actions
  jobs at once against its plan (storefront LIVE-SHOP §10).
- L4. Templates catalogue: which templates exist, which brands may use them (G4).
- L5. **Catalogue publishing**: stores with unpublished changes, the next automatic run,
  builds in progress and failed, and "Publish now" presses used against each store's monthly
  allowance. Staff can run a publish for a store without using its allowance (for example,
  after a failure caused on our side).

### M. Domains

**Partner console:** scoped counterpart: its own brand's domains (portal host, preview and
shop wildcards, email sender domain) with the records to add and "Re-check now", and its
merchants' custom domain status, read-only. First release:
[FIRST-RELEASE.md](../platform/FIRST-RELEASE.md) §9.

- M1. All domains: brand portal hosts, email domains, storefront preview and shop wildcards,
  merchant custom domains, with status (waiting for DNS · verifying · issuing certificate ·
  live · failed · expiring).
- M2. A stuck domain: the exact record expected vs what DNS returns, and "Re-check now".

### N. Usage and costs

**Partner console:** scoped counterpart: usage against plan for its own merchants (N1, N2),
and what it pays DripFunnel; never DripFunnel's own costs (N3). First release:
[FIRST-RELEASE.md](../platform/FIRST-RELEASE.md) §5, §10 (Usage), §11.

- N1. Per brand and per store: build minutes, AI tokens and cost, storage, bandwidth *(if
  measured)*, orders and sales volume.
- N2. Outliers and alerts ("AI cost 6× plan allowance this month").
- N3. Cost vs revenue per brand, where both are known.

### O. Staff and roles

**Partner console:** scoped counterpart: its own Partner users with the partner roles (Owner,
Admin, Support, Finance, Read-only; decided 2026-10-01 on #109): invite, change role, remove;
the last Owner cannot be removed or demoted. First release:
[FIRST-RELEASE.md](../platform/FIRST-RELEASE.md) §14.2.

- O1. Staff list, roles (§4), last sign-in, 2-factor status. Invite, change role, remove.
- O2. The last super admin cannot be removed or demoted.
- O3. Approval rules: which actions need a second approver *(ask)*.

### P. Audit log

**Partner console:** scoped counterpart: entries for its own brand and merchants, including
its users' actions and support sessions. DripFunnel staff actions on its partner account and
its merchants' accounts do appear there (LOGGING.md §6, settled). First release:
[FIRST-RELEASE.md](../platform/FIRST-RELEASE.md) §13.

- P1. Every write in the admin console, every staff impersonation and setup session, and
  every **partner** support session (staff never open one, ACCESS §8): who, when, what,
  which brand and store, before and after values, reason.
- P2. Filter by staff member, brand, store, action. Export. Cannot be edited or deleted.
- P3. The same entries appear on the store and brand pages they concern.

### Q. Communication

**Partner console:** scoped counterpart: announcements to its own merchants (all, or one
plan's) in its own look (Q1), and its own contact details (Q3); no platform-wide banners and no
staff notes. Not in the first release: the prototype draws no Announcements screen
([FIRST-RELEASE.md](../platform/FIRST-RELEASE.md) §15).

- Q1. Announcements to all merchants, one brand's merchants, or one plan's, shown in the
  portal and/or by email, in each brand's look and name.
- Q2. Incident banner ("Payments are delayed") by brand or platform-wide.
- Q3. Partner contacts and a log of notes per brand.

### R. Platform settings and integrations

**Partner console:** none.

- R1. Integration health and credentials: Stripe (platform billing), the GitHub App, the
  Cloudflare API token, SES, the AI provider, Neon. Status, last check, rotated on, **never
  the value** (§3 fact 13).
- R2. Platform-wide feature flags (on for DripFunnel only, for chosen brands, or for a
  percentage of stores), with "affects every brand" warnings (§3 fact 16).
- R3. Platform limits a brand cannot exceed (G2).
- R4. Platform legal documents (the partner agreement) and DripFunnel's own entity details
  for invoices.
- R5. **Automatic publish schedule**: how often every store with unpublished catalogue
  changes is published to its live site. A platform default interval, with an override per
  plan (docs/storefront/ARCHITECTURE.md §4.2). Show the build-minute cost the setting
  implies across the fleet before saving.

### S. Data and compliance

**Partner console:** scoped counterpart: retention dates on its own merchants' pages (S3). No
store data exports (a partner never exports a merchant's customers, orders or catalogue,
USERS-AND-DOMAINS §4); how partners take part in personal-data requests is *(ask)*.

- S1. Store data export (catalogue, orders, customers) for a closing store or a data request.
- S2. Personal-data requests (access, deletion) for a merchant, a vendor or a shopper, with
  the stores and brands involved *(ask the process)*.
- S3. Retention after cancellation and after brand closure, shown as dates on the store page.

---

## 7. States that apply to every screen

- **Empty**: with an explanation and the action that fills it.
- **Loading**: skeletons for lists and numbers; never a zero that later becomes real.
- **Partial**: one integration down while the rest works ("Stripe unavailable: billing
  figures from 10:42").
- **Stale**: webhooks or metrics behind, with the time of the last update.
- **Permission**: disabled with the reason and the role that can (§4).
- **Confirmation**: destructive actions restate the consequence, name the store or brand, and
  ask the staff member to type the name for the most dangerous ones.
- **Second approval pending**: who asked, who can approve, expiry.
- **Undo**: where an action is reversible, a short undo; where it is not, say so before.
- **Environment**: Production, Dev, Feature or Local, from the hostname, always visible (#65).
- **Brand context**: the current brand filter is always visible, and never silently kept
  when opening a store from another brand.

---

## 8. What the interface must never do

- Show a secret, a full card number, a password or a session token.
- Let an action on one brand's stores quietly affect another brand (or say it does when it
  doesn't): platform-wide changes say "every brand".
- Confuse **past due**, **suspended**, **cancelled** and **closed**.
- Confuse partner billing with merchant billing, or show a price without its currency and who
  charges it.
- Let impersonation be silent, unbounded in time, or writable by default.
- Delete a store or a brand without an export offered and a retention period stated.
- Treat DripFunnel as special in the UI other than the "House brand" badge and not being
  deletable.
- Show a Partner user anything from another partner, including that a person also has a
  store elsewhere.
- Perform any write without an audit entry.
- Show raw errors first; plain words first, detail behind a click.

---

## 9. Open questions: ask, don't assume

- **What "white-labelled customer" means first**: partners reselling to many merchants, a
  single large merchant white-labelling their own portal (Loom & Thread), or both?
- ~~Do partners get their own console in the first release?~~ **Settled**: yes, the partner
  console at `platform.dripfunnel.com` (USERS-AND-DOMAINS §1). Which parts ship in its first
  release is still open; each part's "Partner console:" line says what it would contain.
- ~~How do partners join?~~ **Settled (2026-09-29)**: invite only. Admin creates the partner
  and invites its Owner; there is no partner sign-up. The partner sets itself up and Admin
  approves it (contract, KYC, billing) before merchants can sign up under it
  (USERS-AND-DOMAINS §3).
- **Money model**: does DripFunnel bill the partner only, bill merchants on the partner's
  behalf (Stripe Connect), or both? Wholesale pricing: per store, per plan, revenue share,
  minimums? (§3 fact 20)
- Can a partner hide DripFunnel completely (portal, emails, storefront, invoices), or is
  "Powered by" sometimes required?
- ~~One login across brands~~ **Settled**: accounts are per partner (§3 fact 5).
- ~~Can a partner own several brands?~~ **Settled**: no; one partner has exactly one brand,
  one look and one portal host (USERS-AND-DOMAINS §2). Still open: can a brand span several
  countries and currencies?
- Storefront preview and shop wildcards per brand (`*.shops.partner.com`) depend on
  Cloudflare for SaaS wildcard support (USERS-AND-DOMAINS §5): verify, then decide the
  release.
- Which email templates and languages are editable per brand?
- Dunning policy: when does past due become suspended? What does a suspended storefront show?
- Which actions need a second approver? ~~Is the merchant told about "sign in as"?~~
  **Settled**: yes, by a banner, the Support access log and (to confirm) an email
  (USERS-AND-DOMAINS §4.1).
- Retention after cancellation and brand closure; what happens to a closed brand's stores?
- ~~Does the admin console fully replace the first platform's dashboard?~~ **Settled**: yes,
  there is no other dashboard (§3 fact 11). Still open: whether engineers get a raw data view.
- Plan promotions for merchant signups (G8)?
