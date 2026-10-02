# ui/admin: the admin console (DF Admin)

`apps/ui/admin` at **`admin.dripfunnel.com`**: the internal console **DripFunnel staff**
use to run the whole platform: every partner, every merchant account, billing at both
levels, the storefront fleet, domains, integrations and platform settings. It calls the
**Admin API** at `/api` on the same host, is DripFunnel-branded, and serves **staff only**.
Cloudflare Access guards the whole host in front of the app's own sign-in.

Older documents call it "DF Admin". It replaces the framework dashboard of the archived
platform; there is no other operations console.

**Status: the shell** (header, side bar, environment banner; #17), the Dashboard (#18) and
Partners, list and detail (#19), all on fixtures, with a placeholder screen for Stores. The design is
[CONSOLE-DESIGN.md](CONSOLE-DESIGN.md).

**The prototype is `designs/DF Admin Prototype.dc.html`** — open it in a browser and click
through the screen you are building before you build it. It has Dashboard, Partners, Stores,
Customers, Approvals, Provisioning, Impersonate, Activity log and Staff; the first release
ships only what [FIRST-RELEASE.md](FIRST-RELEASE.md) §2 lists. The prototype decides
**behaviour**, `docs/` decides **scope and rules** ([../../README.md](../../README.md) §3).

Last updated: 2026-10-02 (#115, #116: list and detail pieces moved to shared).

| Document | Covers |
|---|---|
| This guide | Purpose, users, roles, navigation, code specifics, rules |
| [FIRST-RELEASE.md](FIRST-RELEASE.md) | **What we build first**: a simple console with Dashboard, Partners, Stores and the few menus needed to manage them; what waits |
| [CLAUDE-DESIGN-PROMPT.md](CLAUDE-DESIGN-PROMPT.md) | The self-contained prompt to paste into Claude Design for the first release's screens |
| [CLAUDE-DESIGN-PROMPT-IMPERSONATION.md](CLAUDE-DESIGN-PROMPT-IMPERSONATION.md) | The follow-up Claude Design prompt for the Impersonate feature only |
| [CLAUDE-DESIGN-PROMPT-CUSTOMERS.md](CLAUDE-DESIGN-PROMPT-CUSTOMERS.md) | The follow-up Claude Design prompt for the Customers menu only |
| [CONSOLE-DESIGN.md](CONSOLE-DESIGN.md) | The design prompt: vocabulary, platform facts, staff roles, sample data, parts A–S with scenarios, states, never-do rules, open questions; each part marks its partner-console counterpart |
| [../README.md](../README.md) | How every SPA is built |
| [../../api/ACCESS.md](../../api/ACCESS.md) | Staff identity, roles, support sessions, audit |
| [../../api/SAAS.md](../../api/SAAS.md) | Partners, merchant accounts, provisioning, plans, billing, domains, publishing, fleet, metrics |

---

## 1. What it does

The hierarchy is **Platform** (this console) → **Partner** (a white-label reseller, or
DripFunnel as the house partner) → **Store** (one merchant) → **Vendor** (a supplier inside
a store). Every screen is clear about which level it is on.

- **Partners**: create a partner and invite its Owner (partners are invite only; there is
  no partner sign-up), review and approve it (contract, KYC, billing), pause, offboard and close; see each partner's setup, health, stores and
  revenue. The house partner looks the same but can't be paused, offboarded or deleted.
- **Stores**: every store across partners, at account level: plan, subscription status,
  storefront and domain status, usage, provisioning history; suspend and restore, move a
  store between partners, transfer ownership, close.
- **Support**: search everything; **impersonate** any partner user or store user with full
  access, no consent needed (USERS-AND-DOMAINS.md §4.2); retry failed jobs; resend emails.
- **Money**: partner (wholesale) billing, merchant billing where DripFunnel bills, dunning,
  payouts to partners, usage billing.
- **Fleet**: storefront core versions, rollouts with canaries, build failures, catalogue
  publishing (and publishing for a store without using its allowance).
- **Platform**: integration health (never secret values), feature flags, platform ceilings
  partners can't exceed, the automatic publish schedule, legal documents.
- **Staff and activity**: staff and their roles; the platform-wide activity log of every write
  and sign-in at every level, searchable by person across all stores and partners
  ([../../api/LOGGING.md](../../api/LOGGING.md)), which can't be edited.

---

## 2. Who uses it

DripFunnel staff only: founders, support agents, finance, partner managers, engineers on
call. They hold dangerous power (suspending a store takes a business offline), so the
console is **search first, one click from any customer, and slow on purpose for anything
destructive**.

**Staff are a separate identity** (ACCESS.md §2): company SSO with 2-factor, no
self-signup, their own roles, and never a merchant or partner session with a flag.

### Roles (decided, CONSOLE-DESIGN §4)

| Area | Super admin | Partner manager | Support | Finance | Engineer on call | Read-only |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Home, search | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Partners: create, configure, approve, plans and prices | ✓ | ✓ (the partners a Super admin assigned to them, ACCESS.md §5.4; the others are invisible to them) | view | view | view | view |
| Partners: pause, offboard, close | ✓ | | | | | |
| Stores: detail | ✓ | ✓ (their assigned partners' stores) | ✓ | ✓ | ✓ | ✓ |
| Stores: suspend, restore | ✓ | | | | emergency only | |
| Stores: move partner, transfer owner, close | ✓ (second approver) | | | | | |
| Customers: list (masked), detail, activity | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Customers: full email and phone | ✓ | | ✓ | | | |
| Impersonate partner and store users (full access, 30 min, extendable once) | ✓ | | ✓ | | | |
| Retry jobs, resend emails | ✓ | | ✓ | | ✓ (jobs) | |
| Billing: invoices, credits, refunds, dunning | ✓ | view (their assigned partners) | | ✓ | | view |
| Fleet, builds, domains, integration health | ✓ | view | view | | ✓ | view |
| Platform settings, flags, ceilings | ✓ | | | | | |
| Staff and roles | ✓ | | | | | |
| Activity log (security entries and IPs included) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

- At least two Super admins; never a shared account; the last Super admin can't be removed
  or demoted. The server enforces only the last one; with one, the Staff page asks for a second
  (FIRST-RELEASE.md §10).
- A control a role can't use is **visible and disabled with the reason** ("Finance can issue
  refunds").
- Which actions need a **second approver** is open (CONSOLE-DESIGN §9); moving a store
  between partners always does.
- Keys: `staff-super-admin`, `staff-partner-manager`, `staff-support`, `staff-finance`,
  `staff-engineer`, `staff-read-only`.

---

## 3. Navigation

**First release**: Dashboard, Partners, Stores, Customers, then Approvals, Provisioning, Impersonate, Activity log and Staff ([FIRST-RELEASE.md](FIRST-RELEASE.md) §2). The full
navigation below, from the parts of CONSOLE-DESIGN §6, is the target:

| Row | Part | Contents |
|---|---|---|
| Home | B | Today at a glance, the two business numbers (build minutes, AI cost), revenue, needs attention; a partner filter applied to every number |
| Search (everywhere, keyboard shortcut) | C | Stores, people, partners, invoices, jobs; a person's result lists every store in every partner |
| Partners | D, E, F, G | List, overview, onboarding and approval, branding, plans |
| Stores | I | List across partners, store detail, actions |
| Customers | new | Shoppers across every store, masked contact details, read-only (FIRST-RELEASE §5.4) |
| Impersonate | J | Every partner and store user; sign in as them; open and past sessions |
| Billing | H | Partner billing and merchant billing, never mixed without labels |
| Jobs | K | Provisioning and job health |
| Fleet | L | Core versions, rollouts, builds, publishing |
| Domains | M | Every domain and its status |
| Usage | N | Costs vs revenue, outliers |
| Communication | Q | Announcements, incident banners |
| Settings | O, R, S | Staff and roles, integrations, flags, ceilings, publish schedule, data and compliance |
| Activity log | P | Every write and sign-in at every level; search by person (LOGGING.md §7) |

Always visible: the **environment marker** (Production in red, Staging), the signed-in
staff member's name and role, and the **current partner filter**, which is never silently
kept when opening a store under another partner.

---

## 4. What is special about this app's code

The shared structure is in [../README.md](../README.md) §2. On top of it:

- **Cross-partner by design.** Every list can span partners and shows each row's partner.
  The partner filter is explicit state in the URL, never a hidden default.
- **Re-authentication** before dangerous actions (suspend, refund, delete, impersonate,
  change a price); the Admin API enforces it, the UI prompts for it.
- **Reasons are required input** for suspend, refund, impersonation and moves; the API
  records them in the activity log.
- **Money previews**: every billing action shows its effect before confirming ("Refund
  ₹4,999.00 to card ending 4242").
- **Desktop first**; on a phone an on-call engineer must still find a store and see its
  status.
- **No `brand/` folder**: the branding studio previews partner looks by rendering portal
  screens with the partner's tokens.

```
apps/ui/admin/src/
  features/
    shell/                  the app shell: header, side bar, nav drawer, environment banner
    sign-in/                the signed-out screens
    common/                 what two areas of this app share: the activity tab and its filters, the gallery
    dashboard/              #18
    partners/               #19
    stores/                 placeholder until #20
  api/                      one file per Admin API area
  messages/  nav.ts  routes/
```

Planned areas, as each menu lands: `search/`, `customers/`, `approvals/`, `provisioning/`,
`impersonate/`, `activity/`, `staff/`, and later `branding/`, `plans/`, `billing/`, `fleet/`,
`domains/`, `usage/`, `communication/`, `settings/` (§11 of FIRST-RELEASE says which wait).

---

## 5. Rules this app must never break

From CONSOLE-DESIGN §8:

- Show a secret, a full card number, a password or a session token.
- Let an action on one partner's stores quietly affect another partner; platform-wide
  changes say "every partner".
- Confuse **past due**, **suspended**, **cancelled** and **closed**.
- Confuse partner billing with merchant billing, or show a price without its currency and
  who charges it.
- Let an impersonation be silent, unbounded in time, or unlogged.
- Delete a store or a partner without an export offered and a retention period stated.
- Treat DripFunnel as special other than the "House partner" badge and not being deletable.
- Perform any write without an audit entry.
- Show raw errors first; plain words first, details behind a click.

---

## 6. Open questions

The design's open questions are in CONSOLE-DESIGN §9. The ones that change this app's
structure first:

- Which actions need a second approver?
- The money model (SAAS.md §7), which decides the Billing area.
- Dunning policy: when past due becomes suspended. (What a suspended storefront shows was
  decided 2026-09-30: a notice telling shoppers to contact the store, and the Owner is sent
  to **their partner's** support — SAAS.md §4.2.)
- Retention after cancellation and after a partner closes.
