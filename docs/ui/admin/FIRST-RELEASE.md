# FIRST-RELEASE.md: the admin console, kept simple

The first version of the admin console (`apps/ui/admin`, `admin.dripfunnel.com`): only what
DripFunnel staff need to **manage partners and stores**. Everything else in
[CONSOLE-DESIGN.md](CONSOLE-DESIGN.md) waits for a later release (§11).

**Status: specification, not built.** Decided 2026-09-28: the menu starts with Dashboard,
Partners and Stores; the other menus in §2 are *(proposed)* as the minimum needed to manage
those two.

Last updated: 2026-09-28.

Rules that still apply in full: [README.md](README.md) (roles, never-do list),
[../README.md](../README.md) (how every SPA is built), [../../api/ACCESS.md](../../api/ACCESS.md)
(staff identity, support sessions, audit), [../../api/SAAS.md](../../api/SAAS.md) (partner
and store states).

---

## 1. Principles for this release

- **Manage, not configure.** Staff see and act on partners and stores. Partners configure
  their own branding, domains and plans in the partner console; staff only view them here.
- **Every screen is a list or a detail page**, with the same patterns everywhere: search,
  filters in the URL, a status column, a detail page with tabs, actions in one place.
- **Every action states its consequence, asks for a reason where it changes someone's
  business, and is audited.** Nothing is deleted in this release.
- **Designed states on every screen**: empty, loading, error, permission denied (disabled
  with the reason), and the environment marker (Production in red, Staging).

---

## 2. Menu

| # | Menu | For | Badge (work waiting) | Status |
|---|---|---|---|---|
| 1 | **Dashboard** | Everyone | none | decided |
| 2 | **Partners** | Everyone | partners awaiting approval | decided |
| 3 | **Stores** | Everyone | none | decided |
| 4 | **Approvals** | Super admin, Partner manager | partners awaiting approval | *(proposed)* |
| 5 | **Provisioning** | Super admin, Support, Engineer on call | failed or stuck signups | *(proposed)* |
| 6 | **Support sessions** | Super admin, Support | sessions open now | *(proposed)* |
| 7 | **Activity log** | Everyone | none | *(proposed)* |
| 8 | **Staff** | Super admin | none | *(proposed)* |

Always visible in the header: the environment marker, a search box (partners and stores by
name, domain, code or owner email), and the signed-in staff member's name and role.

---

## 3. Dashboard

One page, today at a glance. Every number links to the list it counts, already filtered.

| Card | Shows | Links to |
|---|---|---|
| Partners | Count by state: Live, Awaiting approval, Draft, Paused | Partners, filtered by state |
| Awaiting approval | The oldest waiting, and how long | Approvals |
| Stores | Total; new this week (by partner) | Stores |
| Needs attention | Stores past due, suspended, failed or stuck in provisioning | Stores or Provisioning, filtered |
| Signups | Started, completed and failed in the last 7 days; median time to first store | Provisioning |

- A **partner filter** at the top applies to every card ("All partners" by default).
- No revenue, usage or fleet numbers in this release (§11).

---

## 4. Partners

### 4.1 Partners list

| Column | Notes |
|---|---|
| Partner | Logo and name; "House partner" badge for DripFunnel |
| State | Draft · Awaiting approval · Live · Paused · Offboarding · Closed (SAAS.md §3.1) |
| Stores | Count, links to Stores filtered by this partner |
| Portal host | e.g. `store.northstar.com`, with its status (live, waiting for DNS, failed) |
| Setup | Checklist progress ("5 of 7"), or "Complete" |
| Owner | Partner Owner's name and email |
| Created | Date |

Filters: state, setup complete or not. Search: name, host, owner email. Sorted by newest.

### 4.2 Partner detail

Header: logo, name, state, portal host, and the actions (§4.3). Tabs:

| Tab | Contents |
|---|---|
| **Overview** | Partner details and contacts, state history, setup checklist with each item's status |
| **Stores** | This partner's stores (the Stores list, pre-filtered) |
| **Branding** | Read-only preview of its look, words and "Powered by" setting |
| **Domains** | Portal host, preview and shop wildcards, email sender domain: each with the expected DNS records and status, and "Re-check now" |
| **Plans** | Read-only list of its plans, prices and entitlements (the partner edits them in its console) |
| **Team** | Its partner users and roles, last sign-in (read-only) |
| **Activity** | Audit entries about this partner |

### 4.3 Partner actions

| Action | Who | Needs | Consequence stated before confirming |
|---|---|---|---|
| **Create partner** | Super admin, Partner manager | Name, Owner email, country | Creates a Draft partner and invites its Owner to the partner console |
| **Approve** | Super admin, Partner manager | Go-live checks pass; note on contract and KYC | "Merchants can sign up at store.northstar.com from now on." |
| **Send back** | Super admin, Partner manager | Reason (shown to the partner) | Back to Draft with the reason |
| **Pause** | Super admin | Reason | "No new merchant signups; its 86 stores keep running." |
| **Resume** | Super admin | | Sign-ups open again |
| **Resend Owner invitation** | Super admin, Partner manager, Support | | New link, old one stops working |

- The house partner has no Pause action.
- Offboarding, closing and moving stores between partners are **not** in this release.

---

## 5. Stores

### 5.1 Stores list

Across all partners.

| Column | Notes |
|---|---|
| Store | Name and code |
| Partner | Which partner it belongs to |
| Owner | Name and email |
| Plan | The partner's plan name |
| Status | Trial · Active · Past due · Suspended · Cancelled (SAAS.md §4.2), each unmistakable |
| Storefront | AI storefront (live / building / failed) or "Own storefront" |
| Domain | Live link, or the custom domain and its status |
| Created | Date |

Filters: partner, status, storefront state, created date. Search: name, code, domain, owner
email. Saved in the URL so a filtered list can be shared.

### 5.2 Store detail

Header: name, partner, status, live link, and the actions (§5.3). Tabs:

| Tab | Contents |
|---|---|
| **Overview** | Identity (name, code, partner, owner, country, created), plan and status with history, counts: people by role, vendors, products, orders |
| **Storefront** | Kind (AI or own), last build and publish, live and preview links, core version |
| **Domains** | Custom domain and its status, expected vs found DNS records, "Re-check now" |
| **Provisioning** | Signup steps and their results; retry from here (§6) |
| **Support** | Whether the merchant allows support access; past and open support sessions |
| **Activity** | Audit entries about this store |
| **Notes** | Internal staff notes, never shown to the partner or merchant |

No catalogue, orders or customers here: those are seen only inside a support session.

### 5.3 Store actions

| Action | Who | Needs | Consequence stated before confirming |
|---|---|---|---|
| **Suspend** | Super admin; Engineer on call (emergency) | Reason (shown to the Owner) | "Mehta Textiles can't make changes; its storefront shows a notice." |
| **Restore** | Super admin | Reason | Back to its previous status |
| **Extend trial** | Super admin | New end date | New trial end date |
| **Retry provisioning** | Super admin, Support, Engineer on call | A failed step | Runs the failed step again |
| **Open support session** | Super admin, Support | Merchant allows it; reason or ticket | Read-only, 30 minutes, visible to the merchant (§7) |
| **Resend Owner invitation** | Super admin, Support | | New link, old one stops working |

Change plan, move to another partner, transfer ownership and close are **not** in this
release; changing a plan is the partner's job.

---

## 6. Approvals *(proposed)*

The queue of partners in *Awaiting approval*, oldest first: partner, submitted, go-live
checks (pass/fail each), who is reviewing. Opens the partner detail with **Approve** and
**Send back** (§4.3). A shortcut, not a separate data model: it is the Partners list filtered
by state.

---

## 7. Provisioning *(proposed)*

Signups in progress, failed or stuck (running too long), across partners: store, partner,
step reached, started, attempts, error in plain words (details behind a click). Actions:
**Retry** the failed step, **Undo and clean up** (runs the compensations, SAAS.md §5).
Filters: partner, state, step.

---

## 8. Support sessions *(proposed)*

Open sessions now, and a log of past ones: store, partner, staff member, reason, started,
ends, read-only or elevated. Staff start a session from a store (§5.3); the rules are
ACCESS.md §8 and USERS-AND-DOMAINS.md §4.1: merchant consent setting, reason required,
read-only, time-limited, banner in the merchant's portal, write access only with the
merchant's approval for that session. Actions: **End session** (own sessions; Super admin
any).

---

## 9. Activity log *(proposed)*

The platform-wide activity log ([../../api/LOGGING.md](../../api/LOGGING.md)): every write and
sign-in by anyone, at every level: staff, partner users, merchants, vendors, API keys,
support sessions, shoppers and the system, plus staff-only security events.

- **Search by person first**: a typeahead over every person on the platform. Choosing one
  opens their timeline **across every store and partner** they belong to.
- **Filters**: actor kind, level (admin, partner, store, storefront, system, security),
  action, result, partner, store, target, date range, IP. All in the URL.
- **Every name links** to that person's timeline; every target to its page.
- An expanded entry shows the changes, the reason, the support agent behind a session, and
  the request id.
- **Export** the filtered view as CSV; the export is itself logged.
- Read-only; can't be edited or deleted. The same entries appear on the Activity tab of each
  partner and store, and "Own activity" in each staff member's profile.

---

## 10. Staff *(proposed)*

Staff list: name, email, role, last sign-in, 2-factor status. Super admin can invite (by
company email, signing in through company SSO), change role and remove. The last Super admin
can't be removed or demoted. Roles are the six in [README.md](README.md) §2.

---

## 11. Not in this release

From CONSOLE-DESIGN §6, deliberately left out; each stays specified there:

| Part | What waits |
|---|---|
| F, G | Editing a partner's branding or plans on its behalf (view only here) |
| H | Billing: partner invoices, merchant billing, dunning, refunds, payouts |
| I3 | Change plan, move a store between partners, transfer ownership, close |
| D (Offboarding, Closed) | Offboarding and closing a partner |
| L | Fleet: core versions, rollouts, publishing |
| M | A separate Domains menu (domains are tabs on partner and store pages) |
| N, B2, B3 | Usage, costs, revenue |
| Q | Announcements and incident banners |
| R | Integrations, feature flags, platform ceilings, publish schedule |
| S | Data export and personal-data requests |

---

## 12. What the Admin API needs for this release

For planning `apps/api/src/apis/admin`; names are *(proposed)*.

| Menu | Queries | Mutations |
|---|---|---|
| Dashboard | `dashboard(partnerId)` | |
| Partners | `partners(filter, page)`, `partner(id)` | `createPartner`, `approvePartner`, `sendBackPartner`, `pausePartner`, `resumePartner`, `resendPartnerOwnerInvite`, `recheckDomain` |
| Stores | `stores(filter, page)`, `store(id)` | `suspendStore`, `restoreStore`, `extendTrial`, `resendStoreOwnerInvite`, `addStoreNote`, `recheckDomain` |
| Provisioning | `provisioningJobs(filter, page)` | `retryJob`, `undoJob` |
| Support sessions | `supportSessions(filter, page)` | `startSupportSession`, `endSupportSession` |
| Activity log | `activityLog(filter, after)`, `personTimeline(personRef, filter, after)`, `activityPeople(query)` | `exportActivity(filter)` |
| Staff | `staff(page)` | `inviteStaff`, `changeStaffRole`, `removeStaff` |
| Header | `search(query)`, `me` | |

Every mutation checks the staff role on the server, requires a reason where §4.3 and §5.3
say so, and writes an audit entry.

---

## 13. Open questions

- Confirm the proposed menus 4–8, or fold Approvals into Partners and Provisioning into
  Stores to keep the menu at three.
- Does a partner's approval need a second approver?
- May Partner managers pause a partner, or only Super admins?
- What does a suspended store's storefront show (SAAS.md §4.2)?
