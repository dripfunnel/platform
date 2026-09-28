# ui/platform: the partner console

`apps/ui/platform` at **`platform.dripfunnel.com`**: the console **partners** use to run
their white-label business on DripFunnel. It calls the **Platform API** at `/api` on the
same host. It is DripFunnel-branded for every partner (not white-labelled), and serves
**partner users only**: DripFunnel staff use the admin console
([../admin/](../admin/README.md)), merchants use their partner's portal
([../store/](../store/README.md)).

A **partner** is a company that resells the platform to its own merchants under its own
brand: an agency, reseller, payments company or marketplace operator. **DripFunnel is also a
partner** (the house partner) and uses this console exactly like the others.

**Status: skeleton** (sign-in and home routes). No design document of its own yet: every
part of the admin console's design marks its partner counterpart, and this guide lists
them (§5).

Last updated: 2026-09-29.

The design prompt for Claude Design is [CLAUDE-DESIGN-PROMPT.md](CLAUDE-DESIGN-PROMPT.md).

---

## 1. What it does

- **Onboard**: invite only, no sign-up. The Owner accepts DripFunnel's invitation, then
  sets everything up while in *Draft*; submit for
  approval; go live once DripFunnel's Admin approves (contract, KYC, billing). Until then,
  merchants can't sign up under the partner.
- **Brand**: the portal's look (logo, colours, font, favicon, sign-in page), words (product
  name, support contacts, legal pages, "Powered by" line), and email templates.
- **Addresses**: its one portal host (`store.<partnerdomain>`), the preview and shop
  wildcards (`*.preview.<partnerdomain>`, `*.shops.<partnerdomain>`) and the email sender
  domain, each with the DNS records to add and live verification.
- **Offer**: its plans, prices and entitlements for its merchants, within DripFunnel's
  platform ceilings; allowed templates, regions, currencies, languages and providers.
- **Merchants, at account level**: list and search its merchants; create a merchant (the
  Owner gets an invitation); plans, trials, limits, billing status; domain, provisioning and
  publishing status; usage against plan; suspend and restore.
- **Support**: open a merchant's portal **read-only**, under the merchant's consent setting,
  with a reason, time-limited and logged (USERS-AND-DOMAINS.md §4.1).
- **Money**: DripFunnel collects merchants' subscriptions on the partner's behalf and pays
  the partner out monthly (first); a "bill my own merchants" setting follows (SAAS.md §7.1).
  Plus its own invoices from DripFunnel.
- **Reports**: signups, active stores, trial conversion, churn, plan mix, subscription
  revenue and payouts, usage, setup health, and each store's monthly sales and order totals
  (never orders, customers or products).
- **Team**: its own users and their roles; its activity log (LOGGING.md §6).

**Never**: another partner's anything; a merchant's customers, orders or catalogue outside a
support session; any change inside a merchant's store; platform-wide settings; whether a
person also has a store under another partner.

---

## 2. Who uses it

**Partner users**: the partner's own staff. They are a separate identity from merchant
accounts (ACCESS.md §2): signing in here never grants anything in a merchant portal.

### Roles *(proposed 2026-09-28; confirm before the Platform API's permissions are built)*

Fixed templates, no role editor, like merchant roles.

The authoritative matrix is [ACCESS.md](../../api/ACCESS.md) §5.3; this table is the same
rules by screen area and must stay in step with it.

| Area | Owner | Admin | Support | Finance | Read-only |
|---|:--:|:--:|:--:|:--:|:--:|
| Home and reports | ✓ | ✓ | ✓ | ✓ | ✓ |
| Onboarding checklist, submit for approval | ✓ | ✓ | view | view | view |
| Branding, words, email templates | ✓ | ✓ | view | view | view |
| Portal host, preview and shop domains, email sender | ✓ | ✓ | view | view | view |
| Plans and prices offered to merchants | ✓ | ✓ | view | prices only | view |
| Merchants: accounts, plans, billing status, domains, provisioning, publishing, usage | ✓ | ✓ | ✓ | ✓ | ✓ |
| Merchants: create (Owner invitation) | ✓ | ✓ | | | |
| Merchants: change plan, price, limits, entitlements ("Publish now" allowance), trial | ✓ | ✓ | | trial and billing fields only | |
| Merchants: suspend, restore | ✓ | ✓ | | | |
| Support sessions (read-only), request write elevation | ✓ | ✓ | ✓ | | |
| Partner billing with DripFunnel: invoices, payment method | ✓ | | | ✓ | |
| Team: invite, change role, remove | ✓ | not Owners | | | |
| Close or offboard the partner, transfer partner ownership | ✓ | | | | |
| Activity log (own users, own account, merchants' accounts) | ✓ | ✓ | ✓ | ✓ | ✓ |

"view" rows and the activity log are this guide's reading of the proposal; ACCESS.md §5.3
lists only the actions.

- **The last Owner** can't be removed or demoted.
- A control a role can't use is **visible and disabled with the reason** (docs/ui/README.md §5).
- Keys: `partner-owner`, `partner-admin`, `partner-support`, `partner-finance`,
  `partner-read-only`.

---

## 3. Navigation *(proposed)*

| Row | Contents | Admin-console counterpart |
|---|---|---|
| Home | Its merchants at a glance: new, failing signups, past due, suspended, domains stuck, builds failing; usage (build minutes, AI cost) and revenue | B |
| Merchants | List, detail, actions (account level) | I (scoped) |
| Support | Open sessions, start one, session log | J (scoped) |
| Branding | Look, words, live preview of the portal in its look, email templates | F |
| Domains | Portal host, wildcards, email sender, merchants' custom domains status | M (scoped) |
| Plans | Plan catalogue, entitlement matrix (including the "Publish now" allowance) within platform ceilings, grandfathering | G (within ceilings) |
| Billing | Its invoices from DripFunnel; its merchants' billing if it bills them | H (payer side) |
| Announcements | Messages and incident banners to its own merchants, in its look | Q (scoped) |
| Settings | Partner details, contacts, legal pages, team, activity log (search by person) | O, P (scoped) |

While the partner is *Draft* or *Awaiting approval*, Home is the **setup checklist** (the
admin console's part E seen from the partner's side), with each failed go-live check linked
to its fix.

---

## 4. What is special about this app's code

The shared structure is in [../README.md](../README.md) §2. On top of it:

- **Every query is the caller's partner.** The Platform API scopes every operation to the
  signed-in user's partner; the SPA never sends a partner id as authority and has no
  partner switcher. *(If one company may own several partners, decide how, SAAS.md §14.)*
- **DripFunnel look**, no `brand/` folder. The branding studio *previews* the partner's
  look by rendering portal screens with the partner's tokens, never by restyling this app.
- **Support sessions** hand off to the merchant's portal host; the mechanism is
  *(decide)* (docs/api/README.md §2.1).
- **Desktop first**; on a phone a partner must still find a merchant and see its status.

```
apps/ui/platform/src/
  features/
    auth/  onboarding/  home/  merchants/  support/  branding/  domains/  plans/
    billing/  team/  audit/  settings/
  api/                      one file per Platform API area
  nav.ts
```

---

## 5. Where it is specified

| Topic | Where |
|---|---|
| Partners, hosts, what a partner sees and can't | [../../USERS-AND-DOMAINS.md](../../USERS-AND-DOMAINS.md) §1–4 |
| Partner lifecycle, onboarding, plans, billing, domains | [../../api/SAAS.md](../../api/SAAS.md) |
| Partner identity, roles, support sessions, audit | [../../api/ACCESS.md](../../api/ACCESS.md) |
| Screen-level design: each admin console part and its "Partner console" line | [../admin/CONSOLE-DESIGN.md](../admin/CONSOLE-DESIGN.md) §3 facts 17–22, §6 |
| Every SPA's conventions | [../README.md](../README.md) |

When this console gets its own design prompt, write it here as `CONSOLE-DESIGN.md` and
remove the partner lines from the admin one.

---

## 6. Rules this app must never break

- Show nothing of another partner, including that a person or merchant also exists under
  another partner.
- Show nothing inside a merchant's store outside a support session; support sessions are
  read-only, time-limited, need a reason, and are visible to the merchant.
- Never display a secret, full card number, password or token.
- Every write is audited with the actor, target and reason; destructive actions (suspend a
  merchant, retire a plan, change a domain) restate their consequence and name the target.
- Label every price with its currency and who charges it; never mix partner billing and
  merchant billing on one screen without labels.

---

## 7. Open questions

- Confirm the partner roles above (§2).
- Can a partner hide DripFunnel completely, or is "Powered by" sometimes required?
- Can a partner override the automatic publish interval for its plans? (The "Publish now"
  allowance is the partner's, within DripFunnel's ceiling: SAAS.md §6.1.)
- Can one company own several partners?
- Partner sign-in: 2-factor required? Google sign-in?
