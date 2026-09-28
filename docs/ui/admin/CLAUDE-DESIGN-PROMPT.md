# CLAUDE-DESIGN-PROMPT.md: design the admin console (first release)

The prompt to paste into a **Claude Design** session to design the first release of the
admin console. It is self-contained: the design session doesn't read this repo. Its source
is [FIRST-RELEASE.md](FIRST-RELEASE.md); where they disagree, FIRST-RELEASE wins and this
prompt should be updated.

Paste everything below the line.

Last updated: 2026-09-29.

---

You are designing the **DripFunnel admin console**: the internal web app DripFunnel staff
use to manage the partners who resell our platform and the stores those partners' merchants
run. Produce a **clickable, high-fidelity prototype** with realistic sample data. Nothing
exists yet; you are defining how it looks and behaves.

## 1. The platform in one paragraph

DripFunnel is a white-label commerce platform. **Partners** (agencies, resellers, payment
companies, marketplace operators) sell it to their own merchants under their own brand.
**DripFunnel itself is also a partner**, the "house partner", for merchants who sign up with
us directly. Each **merchant** runs one **store**: a portal in the partner's look, and an
online storefront. The hierarchy is **Platform (this console) → Partner → Store**. Every
screen must make clear which level it is on.

Partners set up their own branding, domains and plans in **their own console**. This admin
console is for DripFunnel staff to **oversee and act**: approve partners, look after stores,
fix stuck signups, sign in as a partner's or store's user to help them, and see who did
what.

## 2. Who uses it

DripFunnel staff only: founders, support agents, finance, partner managers, engineers on
call. They are competent but busy, often in the middle of a customer's problem, and they
hold dangerous power (suspending a store takes a business offline). The standard is
**Stripe Dashboard's clarity with Shopify Partners' structure**: search first, everything
one click from a partner or store name, and every destructive action slowed down on purpose.

Staff roles (show the signed-in role in the header; design the permission-denied state):

| Role | Can |
|---|---|
| Super admin | Everything, including staff management |
| Partner manager | Create, approve and send back partners |
| Support | Search, see detail, impersonate users, retry failed setup, resend invitations |
| Finance | See everything; no store or partner actions in this release |
| Engineer on call | Retry failed setup; suspend a store in an emergency |
| Read-only | See everything, change nothing |

**A control a role can't use stays visible but disabled, with the reason and who can**
("Only a Super admin can pause a partner"), so staff know whom to ask.

## 3. Look and feel

- **DripFunnel-branded**, calm and dense, like a serious internal tool. Primary colour indigo
  `#4f46e5` on white; text `#111827`; muted text `#6b7280`; radius 8 px; system font stack.
  Design **light and dark** themes.
- **Desktop first** (1280–1440 px), with a narrow-laptop layout. On a phone an on-call
  engineer must still be able to **search for a store and see its status**; design that one
  flow at 375 px.
- Left sidebar navigation, a top header, content area with lists and detail pages.
- **Status is always word + colour + icon**, never colour alone. WCAG 2.2 AA contrast.
- **Money** always with its currency (`$`, `₹`, `€`, `£`, `AED`), formatted per locale.
  **Dates** show the time zone.
- Plain words, sentence case, no jargon ("Waiting for DNS", not "PENDING_VERIFICATION").

## 4. The shell

- **Header**, always visible:
  - an **environment marker**: a red "Production" badge (and a grey "Staging" variant);
  - a **search box** with a keyboard shortcut (⌘K), searching partners and stores by name,
    domain, code or owner email, with results grouped by type and each result showing its
    partner;
  - the signed-in staff member's name and role, with a menu (My activity, Sign out).
- **Sidebar**, in this order, with badges only for work waiting:

| # | Menu | Badge |
|---|---|---|
| 1 | Dashboard | |
| 2 | Partners | partners awaiting approval |
| 3 | Stores | |
| 4 | Customers | |
| 5 | Approvals | partners awaiting approval |
| 6 | Provisioning | failed or stuck signups |
| 7 | Impersonate | sessions open now |
| 8 | Activity log | |
| 9 | Staff (Super admin only) | |

## 5. Screens to design

### 5.1 Sign in

Company single sign-on only: one "Sign in with Google Workspace" button, then a 2-factor
step. States: signing in, access refused (no detail about why), session expired. No sign-up,
no password field.

### 5.2 Dashboard

Today at a glance. **Every number is a link** to the list it counts, already filtered.

| Card | Shows |
|---|---|
| Partners | Count by state: Live, Awaiting approval, Draft, Paused |
| Awaiting approval | The oldest waiting partner and how long it has waited |
| Stores | Total, and new this week by partner |
| Needs attention | Stores past due, suspended, failed or stuck in setup, each with a one-click action ("Retry setup", "Open store") |
| Signups | Started, completed and failed in the last 7 days; median time to a ready store |

A **partner filter** at the top ("All partners" by default) applies to every card, and stays
visible so staff never forget it's on. No revenue or usage charts in this release.

### 5.3 Partners

**List**: columns Partner (logo, name, "House partner" badge for DripFunnel), State,
Stores (count, links to Stores filtered), Portal host (e.g. `store.northstar.com` with its
status), Setup ("5 of 7" or "Complete"), Owner (name, email), Created. Filters: state, setup
complete. Search. Newest first. Filters live in the URL, shown as removable chips.

Partner **states** (design a badge for each): Draft · Awaiting approval · Live · Paused ·
Offboarding · Closed.

**Detail page**: header with logo, name, state badge, portal host, and an actions menu.
Tabs:

| Tab | Contents |
|---|---|
| Overview | Partner details and contacts, state history (timeline), setup checklist with each item's status |
| Stores | This partner's stores (the Stores list, pre-filtered) |
| Branding | **Read-only** preview of the partner's look: logo, colours, product name, a thumbnail of their sign-in page, "Powered by DripFunnel" on or off |
| Domains | Portal host, preview and shop wildcards (`*.preview.northstar.com`, `*.shops.northstar.com`), email sender domain: each with the DNS records expected, what was found, a status, and "Re-check now" |
| Plans | **Read-only** list of the partner's plans, prices and limits (edited in the partner console, by the partner or by staff through "Set up for partner"; say so) |
| Team | The partner's users and their roles, last sign-in, with an **Impersonate** button on each |
| Activity | Everything done about this partner (see 5.8) |

**Actions** (each opens a confirmation that states the consequence first):

| Action | Needs | Confirmation says |
|---|---|---|
| Create partner | Name, Owner email, country; send the owner invitation now or hold it until setup is done | "Creates Kaufladen Digital as a draft and invites its owner to the partner console." (or "…and holds the owner's invitation") |
| Set up for partner | A reason or ticket; re-enter password or 2-factor | "Opens Northstar's partner console for you for 2 hours. You can do its whole setup and submit it for approval. Its payment and payout details stay with Northstar." |
| Send owner invitation | (only when held) | "Sends Kaufladen Digital's owner their invitation. They'll see the setup you've done." |
| Approve | Go-live checks pass, a note on contract and KYC | "Merchants can sign up at store.northstar.com from now on." |
| Send back | A reason, shown to the partner | "Northstar goes back to Draft with your reason." |
| Pause | A reason | "No new merchant signups. Its 86 stores keep running." |
| Resume | | "Sign-ups open again." |
| Resend owner invitation | | "A new link is sent; the old one stops working." |

The house partner has no Pause action (show why if hovered).

### 5.4 Stores

**List**, across all partners: Store (name, code), Partner, Owner, Plan (the partner's plan
name), Status, Storefront ("AI storefront: live / building / failed" or "Own storefront"),
Domain (live link, or custom domain with its status), Created. Filters: partner, status,
storefront state, created date. Search. Saved in the URL.

Store **statuses** must be unmistakable from each other: **Trial** (with days left) ·
**Active** · **Past due** (with days, "writes blocked, still selling") · **Suspended** (with
the reason; a staff decision) · **Cancelled**. Past due and Suspended are the pair most
often confused: make them look clearly different.

**Detail page**: header with name, partner, status, live link, actions menu. Tabs:

| Tab | Contents |
|---|---|
| Overview | Name, code, partner, owner, country, created; plan and status with history; counts of people by role, suppliers, products, orders |
| Storefront | AI or own storefront, last build and publish, live and preview links, version |
| Domains | Custom domain, expected vs found DNS records, "Re-check now" |
| Setup | The signup steps and their result (account, store, defaults, hostnames, repo, first build, done), with Retry on a failed step |
| Users | Everyone in the store: the merchant's Owner, Managers and Staff, and each supplier's users (grouped by supplier), with role, last sign-in, status and an **Impersonate** button |
| Support | The merchant's support access setting (it applies to the partner's support team, not to DripFunnel staff); the partner's support sessions; staff impersonations of this store's users |
| Activity | Everything done in or about this store (see 5.8) |
| Notes | Internal staff notes, never shown to the partner or merchant; label it so |

**No catalogue, orders or customer lists here**: staff see inside a store only by
impersonating one of its users. Say so on the Overview tab.

**Actions**:

| Action | Who | Needs | Confirmation says |
|---|---|---|---|
| Suspend | Super admin; Engineer on call (emergency) | A reason, shown to the owner; type the store name to confirm | "Mehta Textiles can't make changes and its storefront shows a notice." |
| Restore | Super admin | A reason | "Back to Active." |
| Extend trial | Super admin | New end date | "Trial now ends 14 Oct 2026." |
| Retry setup | Super admin, Support, Engineer on call | A failed step | "Runs 'First build' again." |
| Impersonate a user | Super admin, Support | A user from the Users tab, a reason or ticket link, re-authentication | "Full access as Priya Mehta for 30 minutes. Everyone signed in to Mehta Textiles sees a banner." |
| Resend owner invitation | Super admin, Support | | "A new link is sent." |

### 5.5 Approvals

Partners awaiting approval, oldest first: partner, submitted, go-live checks (portal host
live, email domain verified, at least one priced plan, legal pages set, test signup done)
with pass/fail for each, reviewer. Opens the partner with Approve and Send back.

### 5.6 Provisioning

New stores whose setup is in progress, failed or stuck (running too long), across partners:
store, partner, step reached, started, attempts, the error **in plain words first**
("GitHub didn't respond while creating the storefront"), raw details behind "Details".
Actions: **Retry**, **Undo and clean up** (with a strong confirmation). Filters: partner,
state, step.

### 5.7 Impersonate

Staff (Super admin and Support only) can **sign in as any partner user or store user** to
see and do exactly what that person can: **full access, for 30 minutes, no consent needed**,
**except** changing the user's password, 2-factor or sign-in methods, payment or payout details, or ownership (transferring the store or partner, or changing the Owner): design those controls disabled with "Only Priya can change this".
Never as another staff member, never as a shopper. The banner always says "Support", never
"DripFunnel" (partners' merchants mustn't see our name).

- **Users list**: every person who can be impersonated, one searchable list. Columns: name
  and email; type (Partner user, Store user, Supplier user); partner; store and role for
  each place they belong ("Mehta Textiles · Owner", "Juniper & Co. · Supplier admin for
  Loomcraft"); last sign-in; status. Filters: type, partner, store, role, status. An
  **Impersonate** button on each row.
- **Starting**: pick the user; if they belong to several stores or suppliers, pick which
  one; enter a reason or ticket link; re-authenticate. The confirmation states it plainly:
  "You'll be signed in as Priya Mehta (Owner, Mehta Textiles) with her full access for 30
  minutes. Everyone signed in to Mehta Textiles sees a banner. Everything you do is logged as
  Arjun acting as Priya."
- **While impersonating**: the target's portal or console opens in a new tab. Design the
  **unremovable bar** the staff member sees at the top ("You are signed in as Priya Mehta
  (Owner, Mehta Textiles) · Ends in 28 min · End now"), and the **banner** the impersonated
  side sees ("Support (Arjun) is signed in as Priya. Ends in 28 min."). Design both on the
  merchant portal (in the partner's look) and on the partner console.
- **Sessions**: open now (user, where, staff member, reason, time left, End) and history,
  filterable by staff member, partner, store and date, each linking to its activity entries.
- The same Impersonate action appears on a partner's Team tab and a store's Users tab.

### 5.8 Activity log

The platform-wide record of **every change and every sign-in, by anyone, at every level**:
staff, partner users, merchants, suppliers, API keys, support sessions, shoppers' account
events and the system. It is the most important search tool in the console.

- **Search by person first**: a large typeahead ("Find a person: name or email"). Choosing
  someone shows **their timeline across every partner and store** they belong to, with a
  header card (name, email, account type, the stores and partners they're in).
- **Filters** (chips, all in the URL): who (actor type), level (Admin, Partner, Store,
  Storefront, System, Security), action, result (success / denied / failed), partner, store,
  date range, IP address.
- Each row: time, who (linked), what in plain words ("Priya suspended Mehta Textiles:
  chargeback"), where (partner and store, linked), result. Expand a row to see before/after
  values, the reason, and, for impersonation and support sessions, the person behind them
  ("Arjun as Priya").
- Newest first; load more as you scroll. Export the filtered view as CSV.
- Read-only: nothing can be edited or deleted. Say so quietly.
- Security entries (failed sign-ins, blocked access attempts) have their own subtle styling.

The same component appears as the **Activity** tab on partner and store pages, pre-filtered,
and as **My activity** from the header menu.

### 5.9 Staff (Super admin only)

Staff list: name, email, role, last sign-in, 2-factor on/off. Invite (company email and
role), change role, remove. The last Super admin can't be removed or demoted: show the
disabled control with the reason.

## 6. States to design on every screen

- **Empty**: an explanation and the action that fills it (a new platform has no partners).
- **Loading**: skeletons; never a zero that later becomes a real number.
- **Error**: plain words first, details behind a click, a retry; keep what was typed.
- **Permission denied**: disabled control with the reason and the role that can.
- **Partial or stale**: "GitHub is slow: setup status from 10:42".
- **Confirmation**: consequence first, the target named, a reason where needed, typing the
  name for suspend and undo.
- **Success**: a short toast with an undo where the action allows one.

## 7. Sample data

Use these fictional partners throughout, and make the data feel like a real day:

| Partner | Kind | Region | Stores | Notes |
|---|---|---|---|---|
| DripFunnel | House partner | Global | 1,240 | Direct signups; can't be paused |
| Northstar Commerce | Agency | US, Canada | 86 | Portal host `store.northstar.com` live; email domain verified |
| Bazaar Cloud | Reseller | India, UAE | 312 | INR and AED plans; one failed domain |
| Kaufladen Digital | Payments company | Germany, Austria | 40 | **Awaiting approval**: look done, one go-live check failing (email domain pending DNS) |
| Loom & Thread | Marketplace operator | UK | 1 | One large store with 64 suppliers |

Stores to include: a healthy store (Mehta Textiles, Bazaar Cloud, ₹ plans); one on trial
ending tomorrow; one past due for 9 days; one suspended for a chargeback; one stuck at
"First build" in setup; one with a custom domain waiting for DNS; one using its own
storefront. Staff: Priya (Support), Arjun (Super admin), Lena (Engineer on call), Tom
(Finance).

## 8. The interface must never

- Show a secret, password, token or full card number.
- Let an action on one partner's stores quietly affect another; anything platform-wide says
  "every partner".
- Confuse Past due, Suspended and Cancelled.
- Show a store's catalogue or orders anywhere in this console (staff see them only by
  impersonating a store user), or a customer's addresses, order contents or payment details.
- Let an impersonation be silent, run past its time, or go unlogged.
- Treat DripFunnel as special beyond the "House partner" badge and not being pausable.
- Show raw error codes or technical terms first.
- Perform any change without saying what will happen first.

## 9. How to work

1. Start by restating in your own words what a partner is, what a store is, and who uses this
   console. List anything this brief leaves unclear, then wait for my go-ahead.
2. Design the shell, then the screens in this order: Dashboard, Partners (list, detail,
   actions), Stores (list, detail, actions), Impersonate, Activity log, Approvals, Provisioning,
   Staff, Sign in.
3. For each screen, show the happy path and then the states in §6.
4. Keep one visual system: the same list, filter chips, detail header, tabs, status badges,
   confirmation dialog and activity row everywhere.
5. When this brief is silent, ask; don't invent product rules.
