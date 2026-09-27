# CONSOLE-DESIGN.md

The prompt for a design session that produces a **clickable prototype of DF Admin**: the
internal console DripFunnel staff use to run the whole platform. It manages **white-label
brands** (partners who resell the platform under their own name and look), every **store**
under every brand, **billing** at both levels, and the configuration that decides what each
brand and store can do. **DripFunnel's own offering is one brand in this console, managed
exactly like the others**, and DF Admin replaces the Vendure Dashboard as the operations
console.

It builds on `df-store-archived/SAAS-PLAN.md`, `df-store-archived/ARCHITECTURE.md`, `df-store-archived/AUTH-PLAN.md` and
`df-store-archived/DESIGN-BRIEF.md`, and follows the conventions of `df-store-archived/CATALOG-DESIGN-PROMPT.md`.
Paste §1 to start. Then name a part from §6, or say "all of it, in order".


> **Decided since this was written (2026-09-27), see `../USERS-AND-DOMAINS.md`:** this
> console lives at **`platform.dripfunnel.com`** and serves **both Admin (DripFunnel staff)
> and Partner users**. "Brand" in this document means a **partner**; DripFunnel is also a
> partner. Partners **self-sign-up**, and **Admin approves** them before merchants can sign up
> under them. Partners manage their merchants **at account level, plus audited, consented,
> read-only support access**. So the "brand admin console" in §4 is in scope now: every part
> below needs a Partner view scoped to that partner, with Admin-only controls removed.

---

## 1. The prompt

> You are designing **DF Admin**, the internal console of the **DripFunnel** commerce
> platform, as a **clickable prototype** with realistic sample data. Nothing of it exists yet.
>
> **The platform in one paragraph.** DripFunnel hosts online stores. A *merchant* signs up,
> gets a store (a Vendure channel, its own storefront repo and CDN site), pays a subscription,
> and runs the store from the **merchant portal** (DF Store). A merchant can invite *vendors*
> whose products appear in their catalogue. Shoppers see only the storefront.
>
> **What is new: white-label brands.** DripFunnel also sells the platform to **partners**
> (agencies, resellers, payment companies, marketplaces, large retailers) who offer it to
> their own merchants **under their own name**. A partner's merchants sign up at the
> partner's address, see the partner's logo, colours and emails, pay the partner's prices, and
> may never see the word "DripFunnel". Each such partner is a **brand**. **DripFunnel itself
> is the house brand**: the direct-signup offering, configured on the same screens as every
> other brand, never special-cased in the UI except that it cannot be deleted.
>
> So the hierarchy has four levels, and every screen is clear about which level it is on:
> **Platform** (DripFunnel staff, this console) → **Brand** (a white-label partner, or
> DripFunnel) → **Store** (one merchant's marketplace) → **Vendor** (a supplier inside a store).
>
> **Who uses DF Admin.** DripFunnel staff only: founders, support agents, finance, partner
> managers and engineers on call. They are competent but busy, often in the middle of a
> customer's problem, and they hold **dangerous power**: suspending a store takes a business
> offline, and a wrong billing action charges a real card. The standard is **Stripe
> Dashboard's clarity with Shopify Partners' structure**: search first, everything one click
> from a customer's name, and every destructive action slowed down on purpose.
>
> **What a brand controls** (each is a part in §6):
> - **Look**: portal name, logo, colours, fonts, favicon, sign-in and sign-up pages, and
>   whether "Powered by DripFunnel" shows.
> - **Addresses**: the portal's own domain (e.g. `admin.northstarcommerce.com`), the email
>   sender domain, and storefront subdomains (`*.shops.northstar.com`).
> - **Messages**: emails (verification, invitations, billing receipts, alerts), legal pages,
>   and support contacts.
> - **Offer**: which plans its merchants can buy, at what prices, with which features, limits,
>   storefront templates, regions, currencies, languages, payment and courier providers, and
>   AI allowance.
> - **Money**: how DripFunnel bills the partner, and how the partner's merchants are billed.
>
> **Read first.** `../ARCHITECTURE.md` (decided: DF Admin is `apps/platform`, a static SPA on
> Cloudflare Pages, calling the Platform API Worker at `/api`), `SAAS-PLAN.md` (§1 target shape, §4 provisioning, §5 fleet, §9 domains,
> §10 billing, §14 metrics), `ARCHITECTURE.md` (the tenant, job and domain tables),
> `AUTH-PLAN.md` (roles, the superadmin caveat in §6). §3 below states what is built and what
> is not. **Almost everything in DF Admin is new.** Where a screen depends on something that
> does not exist, design it and **label it "needs backend"**, so it is a decision rather than a
> surprise.
>
> **How to work.** One part at a time (§6). For each screen, produce:
> 1. The clickable happy path, then **every** state in §7: empty, loading, error, permission
>    denied (the staff role can't), partial failure, a third-party service down (Stripe,
>    GitHub, AWS, email), and a narrow-laptop layout. DF Admin is desktop-first; on a phone it
>    must still let an on-call engineer **find a store and see its status**.
> 2. The **actual words**: labels, helper text, confirmations, errors, empty states.
> 3. A short table mapping each control to the data behind it (Vendure field, DF Store table,
>    Stripe object, GitHub or AWS resource, or "needs backend").
> 4. The scenarios from §6 that the screen covers, ticked off.
>
> Use the sample data in §5 throughout, so the prototype feels like a real platform on a real
> day. Ask me when the spec is silent (§9). When it decides something, follow it. Start by
> restating in your own words what a brand is, what a store is, and who uses DF Admin. Then
> wait for me to pick a part.

---

## 2. Vocabulary

DF Admin is for insiders, so it may use platform terms, but it uses them **consistently**, and
brand-facing previews use the brand's own words.

| Say this | Behind it | Meaning |
|---|---|---|
| **Platform** | DF Admin itself | Everything DripFunnel runs. |
| **Brand** | new DF Store table (needs backend) | A white-label partner, or DripFunnel (the **house brand**). |
| **Partner** | the company behind a brand | Its contacts, contract, and billing account. One partner could own several brands *(ask)*. |
| **Brand admin** | needs backend | A partner's own staff, if partners get a console (§9). |
| **Store** | Vendure `Channel` + DF Store `tenant` row | One merchant's marketplace. Never "tenant" or "channel" on screen. |
| **Merchant** | the Owner of a store | The business that pays for the store. |
| **Vendor** | Vendure `Seller` in a store | A supplier inside a store. DF Admin shows counts, rarely individuals. |
| **Portal** | `df-store` app | What merchants and vendors sign in to, shown in the brand's look. |
| **Storefront** | per-store repo → S3 → CloudFront | What shoppers see. |
| **Plan** | proposed `planId` (SAAS-PLAN §10) | What a merchant buys. Each brand has its own plan list. |
| **Entitlement** | needs backend | One feature or limit inside a plan (on/off, a limit, or a meter). |
| **Wholesale price** | needs backend | What DripFunnel charges the partner per store or per plan. |
| **Retail price** | needs backend | What the partner charges its merchant. |
| **Subscription status** | proposed `subscriptionStatus` | Trial · Active · Past due · Cancelled · Suspended. |
| **Template** | storefront template repo | The code a store's storefront starts from. |
| **Template version** | proposed `templateVersion` | How up to date a store's `core/` is (SAAS-PLAN §5). |
| **Job** | DF Store `job` table | Background work: provisioning, domains, builds. |
| **Sign in as** | impersonation (needs backend) | A staff member acting in a merchant's portal for support. |

---

## 3. Facts that shape the interface

Verify anything doubtful against the code in `df-store` and `vendure-backend` before relying
on it.

### What exists today

1. **The store is a Vendure `Channel`**, with a DF Store `tenant` row beside it (`channelId`,
   `channelToken`, `code`, repo name). SAAS-PLAN §1: "Do not introduce a parallel tenant
   entity." A **brand is a grouping above stores**, not a second kind of tenant; it lives in
   DF Store's database (needs backend).
2. **Signup is automatic and staff-free** (SAAS-PLAN §4): `provision-tenant` creates the
   channel, roles, owner and defaults; `provision-storefront` creates the repo from the
   template and pushes its secrets; `provision-domain` handles custom domains. Every step has a
   compensation, is recorded in the `job` table (`state`, `attempts`, `lastError`,
   `compensation`), and is resumable. **The first build completing is not confirmed end to
   end.** DF Admin is where a stuck or failed signup is seen and retried.
3. **Custom domains are built** (SAAS-PLAN §9): DNS TXT verification, then an ACM certificate,
   stored in DF Store's `customDomain` table with a status (`pending_verification` onwards).
   Brand-level domains (portal domain, email domain, storefront wildcard) are **new** (needs
   backend), but reuse the same verify → certificate → live pattern.
4. **The portal is one app for every store.** Today it looks like DripFunnel everywhere. For
   white label it must pick the brand **from the address it was opened on** and apply the
   brand's look, words and emails before anything renders, including sign-in, sign-up,
   password reset and invitation emails (needs backend). The sign-up page decides which brand
   a new store belongs to.
5. **One person, one login, many stores** (DESIGN-BRIEF fact 1). A person can own a store under
   Northstar and be a vendor in a store under DripFunnel. Which brand's look they see, and
   whether one brand's sign-in can reveal another's stores, is **open (§9)** and a privacy
   question, not a styling one.
6. **Email is sent by DF Store** (`nodemailer`) from one sender. Per-brand sender domains need
   SPF, DKIM and DMARC records verified per brand (needs backend), with a fallback sender while
   they are not verified.
7. **Billing does not exist yet.** SAAS-PLAN §10 proposes Stripe Billing, separate from the
   per-merchant checkout Stripe that takes shoppers' payments, with `planId`,
   `subscriptionStatus` and `trialEndsAt` on the channel and a `billing_event` table for
   webhook idempotency. **Plans and entitlements do not exist either**
   (CATALOG-DESIGN-PROMPT §3 fact 27). White label adds a second billing relationship
   (DripFunnel → partner) on top of the first (someone → merchant). Every billing screen is
   needs backend.
8. **"Past due" is a designed state, not a lock-out** (DESIGN-BRIEF fact 9): the portal blocks
   writes, the storefront degrades rather than disappearing. DF Admin shows which stores are in
   this state and why, and must not confuse it with **Suspended** (a staff decision).
9. **The storefront is a repo per store** built from a template (SAAS-PLAN §1–2), with an
   AI-editable `theme/` and a locked `core/`. A **sync bot** rolls `core/` updates across the
   fleet with canaries (SAAS-PLAN §5, proposed). DF Admin is where fleet drift, rollouts and
   build failures are watched.
10. **Two numbers decide whether the business works** (SAAS-PLAN §14): **build minutes** and
    **AI tokens / cost** per store per month. There is an `aiRun` table with token counts.
    Also: template drift, provisioning success rate, time to first store, failed builds after
    AI edits. These belong on DF Admin's home, per brand and per store.
11. **DripFunnel staff use the Vendure Dashboard today** (SAAS-PLAN §1, AUTH-PLAN §1 "out of
    scope"). DF Admin **replaces** it as the operations console. The Dashboard remains an
    engineers' tool for raw data, reached from DF Admin by a deliberate link *(ask)*.
12. **The platform superadmin holds a role in every channel** (AUTH-PLAN §6, the
    `__super_admin_role__` caveat). Staff power is therefore real and global. DF Admin needs
    its **own sign-in** (company SSO with 2-factor), its own **staff roles** (§4), and an
    **audit log** of every write (ARCHITECTURE §4.2's privileged-procedure base is not built).
    None of it may run through a merchant's portal session.
13. **Secrets never reach a browser** (ARCHITECTURE §Secrets): Vendure service credentials,
    Stripe keys, the GitHub App key, DNS/TLS tokens, channel tokens. DF Admin shows **that** a
    credential is set, when it was rotated and whether it works, never the value.
14. **Privacy rules from the portal still hold.** Never reveal whether an email has an account
    (DESIGN-BRIEF §1). In DF Admin staff *can* see that, but a **brand admin** (if they exist)
    must never learn that their merchant also has a store under another brand.
15. **Vendors belong to a store, never to a brand.** They have no billing record (AUTH-PLAN
    §8). DF Admin shows vendor counts per store and finds a vendor user in support search, but
    has no vendor management of its own.
16. **Some store data is not channel-scoped in Vendure** (SAAS-PLAN §11: tax rates, some
    shipping config). Any platform-wide setting that touches them affects every brand at once,
    and the screen must say so.

### What white label adds (all needs backend)

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
22. **Brand lifecycle**: Draft (being set up) → Live → Paused (no new signups) → Offboarding
    (stores being moved or closed) → Closed. What happens to a closed brand's stores is **open**
    and contractual.

---

## 4. Who uses it

| Staff role | Can |
|---|---|
| **Super admin** | Everything, including staff management, platform settings and deleting. Two people at least; never a shared account. |
| **Partner manager** | Create and configure brands, plans and prices; see their brands' stores and billing. |
| **Support** | Search everything; see store detail; **sign in as** a merchant (read-only by default, §6 J); retry failed jobs; resend emails. No billing changes, no suspensions. |
| **Finance** | Billing, invoices, credits, refunds, dunning, revenue reports. No store configuration. |
| **Engineer on call** | Jobs, fleet, builds, domains, integration health; suspend a store in an emergency. |
| **Read-only** | Sees everything a Support agent sees, changes nothing (auditors, new hires). |

Every write shows who may do it. A control a role can't use is **visible and disabled with the
reason** ("Finance can issue refunds"), so staff know whom to ask. Destructive actions can
require a **second approver** *(ask which)*.

A **brand admin console** (partners managing their own brand and stores) is a likely follow-up.
Design every brand screen so it could later be shown to a brand admin **with platform-only
controls removed**, and mark which controls those are.

---

## 5. Sample data for the prototype

Use fictional companies only. Money in each brand's currency, formatted with
`Intl.NumberFormat`.

| Brand | Kind | Region | Stores | Notes |
|---|---|---|---|---|
| **DripFunnel** | House brand | Global | 1,240 | Direct signups. Cannot be deleted. |
| **Northstar Commerce** | Agency | US, Canada | 86 | Own portal domain live; email domain verified; "Powered by" hidden. |
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

- A1. Sign in with company SSO and 2-factor. No self-signup. Unknown or removed staff are
  refused with no detail.
- A2. Session timeout, re-authentication before dangerous actions (suspend, refund, delete,
  sign in as, change a price).
- A3. An always-visible **environment marker** (Production in red, Staging) and the signed-in
  staff member's name and role.
- A4. Staff with no access to a section see it disabled with the reason (§4).

### B. Home

- B1. Today at a glance: new stores (by brand), signups failing, stores past due, suspended,
  jobs failing, builds failing, domains stuck, integration health (Stripe, GitHub, AWS, email,
  Vendure).
- B2. The two business numbers (§3 fact 10): build minutes and AI cost per store per month,
  trend and outliers, per brand.
- B3. Revenue: MRR by brand, wholesale vs retail where known, trials converting, churn.
- B4. "Needs attention" list with one action each ("Retry build", "Contact merchant").
- B5. Brand filter at the top: the whole platform, or one brand, applied to every number.

### C. Global search

- C1. One search box, everywhere (keyboard shortcut): stores by name, domain, code or owner
  email; people by email; brands; invoices by number; jobs by id.
- C2. Results grouped by type, each showing its brand.
- C3. A person's result lists every store they belong to, in every brand, with their role in
  each (§3 fact 5).

### D. Brands list and brand overview

- D1. List: logo, name, kind, status (Draft · Live · Paused · Offboarding · Closed), stores,
  MRR, setup completeness ("Email domain not verified"), partner manager.
- D2. Brand overview: health, stores, revenue, usage, setup checklist, recent changes, and
  quick links to each configuration part (E–H).
- D3. The **house brand** looks the same, with a "House brand" badge, and no delete, pause or
  offboard actions.

### E. Create a brand (partner onboarding)

- E1. A guided checklist, not a wizard: partner details, contract and billing terms, look,
  addresses, messages, offer, go live. It can be saved and resumed; the brand stays **Draft**.
- E2. Start from a copy of another brand's offer (usually DripFunnel's).
- E3. Go-live checks: portal domain live, email domain verified (or fallback accepted), at
  least one priced plan, legal pages set, a test signup completed. Each failed check explains
  itself and links to the fix.
- E4. The go-live moment: "Northstar Shops is live at admin.northstarcommerce.com. New
  signups there become Northstar stores."

### F. Branding studio (look, addresses, messages)

- F1. **Look**: logo (light and dark backgrounds), mark and favicon, colours, font, corner
  style, sign-in background. Contrast checked, with an explanation when a colour fails.
- F2. **Live preview** of the real portal screens in the brand's look: sign-in, sign-up,
  home, product list, settings, on desktop and phone, light and dark. Switch between brands
  side by side.
- F3. **Name and words**: product name, support email and URL, help centre, terms, privacy,
  data-processing agreement, "Powered by DripFunnel" (on / off / by partner's plan).
- F4. **Portal domain**: enter it, show the DNS records to add, verification and certificate
  progress, live (§3 fact 3). What the portal shows at the old address after a change.
- F5. **Email**: sender name and address, SPF / DKIM / DMARC records with status, fallback
  sender while pending (§3 fact 6), and a test send.
- F6. **Email templates**: verification code, invitation, password reset, trial ending,
  payment failed, store suspended, receipts. Edit subject and a small set of blocks, preview
  in the brand's look, per language *(ask which languages)*. Variables shown as chips, never
  raw braces.
- F7. **Storefront defaults**: storefront subdomain pattern (`{store}.shops.northstar.com`,
  needs backend), default template, default "Powered by" on storefronts.
- F8. Versioning: every brand change is recorded and can be rolled back; changes can be
  scheduled (e.g. a rebrand on 1 Nov).
- F9. What merchants see when their brand's look changes (a notice, or nothing) *(ask)*.

### G. Brand offer: plans, features and limits

- G1. **Plan catalogue per brand**: name, description, monthly and yearly price per currency,
  trial length, and entitlements (§3 fact 19; the on/off, limit and meter kinds from
  CATALOG-DESIGN-PROMPT §3 fact 27).
- G2. An **entitlement matrix**: plans as columns, features as rows (products, staff seats,
  vendors, languages, currencies, A+ content, size charts, AI allowance, custom domain, offers,
  "Powered by" removal, **"Publish now" presses per month**…), with the platform maximum
  shown as a ceiling a brand cannot exceed. The "Publish now" allowance is set here, per
  brand and per plan (docs/storefront/ARCHITECTURE.md §4.2); failed builds never count
  against it.
- G3. Wholesale cost beside each retail price, and the partner's margin (§3 fact 20).
- G4. Allowed templates, regions, currencies, languages, payment providers and couriers for
  the brand's merchants.
- G5. Defaults for new stores (tax behaviour, units, sample product on or off).
- G6. Changing a plan that stores are on: "314 stores are on Growth. Apply to new signups only,
  or to everyone at renewal?" Grandfathering is explicit.
- G7. Retiring a plan: hidden from signup, existing stores keep it or move on a date.
- G8. Promotions on plans (first 3 months half price, coupon for signups) *(ask)*.

### H. Billing

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
  status may be minutes behind (`billing_event`, §3 fact 7).

### I. Stores

- I1. **Stores list** across brands: name, brand, owner, plan, subscription status,
  storefront status, domain, template version, created, last active, MRR. Filters for every
  column, saved views ("Past due in Bazaar Cloud").
- I2. **Store detail**, one page with sections:
  - identity (name, code, brand, owner, created, country);
  - subscription and billing (H2);
  - portal people (counts by role, owner contact) and vendors (count);
  - storefront (repo, template and version, last build, last publish, live URL, custom
    domain status);
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
    it (*ask the retention window*, SAAS-PLAN §15);
  - open in Vendure Dashboard (engineers only, §3 fact 11).
- I4. Suspended vs past due vs cancelled vs closed, each unmistakable (§3 fact 8).

### J. Sign in as (support impersonation)

- J1. Starts from a store, requires a reason (and a ticket link), and is time-limited.
- J2. **Read-only by default**; write access is a separate, logged elevation.
- J3. The portal shows a bright, unremovable bar: "You are viewing Mehta Textiles as
  DripFunnel Support (Priya). Read-only. Ends in 28 min."
- J4. Whether the merchant is told, and how (an entry in their activity, an email) *(ask)*.
- J5. Impersonation never works on another staff account, and never changes passwords,
  payment methods or ownership.

### K. Provisioning and jobs

- K1. Signups in progress and failed, per brand, with the step reached (§3 fact 2): account,
  store, roles, defaults, repo, secrets, first build, domain.
- K2. A failed job: error in plain words first, raw error behind "Details", attempts,
  compensation already run, and **Retry** or **Undo and clean up**.
- K3. Time to first store and success rate, trended (§3 fact 10).
- K4. Job queue health: pending, running, stuck (running too long).

### L. Fleet and storefronts

- L1. Template versions across all stores, with drift ("132 stores are 3+ versions behind").
- L2. **Rollouts** of a `core/` update: canary group, then percentages, with pause and
  roll back; per-store PR and CI status (§3 fact 9).
- L3. Build failures, especially after AI edits, with a link to the store and the commit.
- L4. Templates catalogue: which templates exist, which brands may use them (G4).
- L5. **Catalogue publishing**: stores with unpublished changes, the next automatic run,
  builds in progress and failed, and "Publish now" presses used against each store's monthly
  allowance. Staff can run a publish for a store without using its allowance (for example,
  after a failure caused on our side).

### M. Domains

- M1. All domains: brand portal domains, email domains, storefront wildcards, merchant custom
  domains, with status (waiting for DNS · verifying · issuing certificate · live · failed ·
  expiring).
- M2. A stuck domain: the exact record expected vs what DNS returns, and "Re-check now".

### N. Usage and costs

- N1. Per brand and per store: build minutes, AI tokens and cost, storage, bandwidth *(if
  measured)*, orders and sales volume.
- N2. Outliers and alerts ("AI cost 6× plan allowance this month").
- N3. Cost vs revenue per brand, where both are known.

### O. Staff and roles

- O1. Staff list, roles (§4), last sign-in, 2-factor status. Invite, change role, remove.
- O2. The last super admin cannot be removed or demoted.
- O3. Approval rules: which actions need a second approver *(ask)*.

### P. Audit log

- P1. Every write in DF Admin and every impersonated session: who, when, what, which brand and
  store, before and after values, reason.
- P2. Filter by staff member, brand, store, action. Export. Cannot be edited or deleted.
- P3. The same entries appear on the store and brand pages they concern.

### Q. Communication

- Q1. Announcements to all merchants, one brand's merchants, or one plan's, shown in the
  portal and/or by email, in each brand's look and name.
- Q2. Incident banner ("Payments are delayed") by brand or platform-wide.
- Q3. Partner contacts and a log of notes per brand.

### R. Platform settings and integrations

- R1. Integration health and credentials: Vendure service account, Stripe (platform billing),
  GitHub App, AWS, email provider, AI provider. Status, last check, rotated on, **never the
  value** (§3 fact 13).
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
- **Environment**: Production vs Staging, always visible.
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
- Show a brand admin (if they exist) anything from another brand, including that a person also
  has a store elsewhere.
- Perform any write without an audit entry.
- Show raw errors first; plain words first, detail behind a click.

---

## 9. Open questions: ask, don't assume

- **What "white-labelled customer" means first**: partners reselling to many merchants, a
  single large merchant white-labelling their own portal (Loom & Thread), or both?
- Do partners get their own **brand admin console** in the first release, and which parts
  (look, plans, their stores, their merchants' billing)?
- **Money model**: does DripFunnel bill the partner only, bill merchants on the partner's
  behalf (Stripe Connect), or both? Wholesale pricing: per store, per plan, revenue share,
  minimums? (§3 fact 20)
- Can a partner hide DripFunnel completely (portal, emails, storefront, invoices), or is
  "Powered by" sometimes required?
- **One login across brands**: when a person has stores under two brands, which look do they
  see after sign-in, and may one brand's sign-in page list the other brand's stores? (§3
  fact 5)
- Can a partner own several brands? Can a brand span several countries and currencies?
- Storefront subdomains per brand (`*.shops.partner.com`) in the first release?
- Which email templates and languages are editable per brand?
- Dunning policy: when does past due become suspended? What does a suspended storefront show?
- Which actions need a second approver? Is the merchant told about "sign in as"?
- Retention after cancellation and brand closure; what happens to a closed brand's stores?
- Does DF Admin fully replace the Vendure Dashboard, or link to it for engineers?
- Plan promotions for merchant signups (G8)?
