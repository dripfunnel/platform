# CLAUDE-DESIGN-PROMPT.md: design the partner console

The prompt to paste into a **Claude Design** session to design the partner console
(`apps/ui/platform`, `platform.dripfunnel.com`). It is self-contained: the design session
doesn't read this repo. Its sources are [README.md](README.md),
[../../USERS-AND-DOMAINS.md](../../USERS-AND-DOMAINS.md), [../../api/SAAS.md](../../api/SAAS.md)
and [../../api/ACCESS.md](../../api/ACCESS.md) §5.3; where they disagree, they win and this
prompt should be updated.

Paste everything below the line.

Last updated: 2026-09-29.

---

You are designing the **DripFunnel partner console**: the web app a **partner** uses to run
its own white-label commerce business on DripFunnel. Produce a **clickable, high-fidelity
prototype** with realistic sample data. Nothing exists yet; you are defining how it looks and
behaves.

## 1. The business in one paragraph

DripFunnel is a commerce platform that other companies resell under their own name. A
**partner** (an agency, reseller, payments company or marketplace operator) signs up here,
sets up its **own branded store platform**, and sells it to **merchants**. Each merchant
gets a **store**: they sign in to the partner's **merchant portal** (at the partner's own
address, e.g. `store.northstar.com`, in the partner's logo, colours and name) and build
their online shop there. The partner's merchants may never see the word "DripFunnel". The
partner decides the look of that portal, the plans and prices merchants can buy, and it
looks after its merchants' accounts. **DripFunnel collects the merchants' subscription
payments on the partner's behalf and pays the partner out every month**, keeping its
wholesale fee.

This console is the partner's control room. It is **DripFunnel-branded** (it's our product
for our customers, the partners) and is used by partner staff only.

## 2. What the partner can and can't do

**Can**, for its own merchants only:
- white-label the merchant portal: its look, words, address and emails;
- create plans, prices and limits merchants buy, within DripFunnel's maximums;
- see and manage its merchants' **accounts**: create a merchant, plan, trial, limits, billing
  status, domains, setup and publishing status, usage; suspend and restore;
- see each store's **monthly sales and order totals** in reports;
- open a merchant's portal **read-only for support**, if the merchant allows it;
- see its money: merchant payments, payouts, DripFunnel's invoices.

**Can't, and the design must never suggest it can**:
- see a merchant's individual orders, customers or products, or export them;
- change anything inside a merchant's store, or design a merchant's online shop;
- see anything of another partner, or learn that a person also has a store elsewhere.

## 3. Who uses it

The partner's own team: founders, account managers, support, finance. They are commercially
minded, not engineers. The standard is **Shopify Partners' structure with Stripe
Dashboard's clarity**: every number explained, every merchant one click away, money always
with its currency and who charges it.

Partner roles (show the signed-in role in the header; design the permission-denied state:
**a control a role can't use stays visible but disabled, with the reason and who can**):

| Area | Owner | Admin | Support | Finance | Read-only |
|---|:--:|:--:|:--:|:--:|:--:|
| Dashboard, reports | ✓ | ✓ | ✓ | ✓ | ✓ |
| Branding, domains, emails | edit | edit | view | view | view |
| Plans and prices | edit | edit | view | prices only | view |
| Stores: view | ✓ | ✓ | ✓ | ✓ | ✓ |
| Stores: create, change plan, extend trial | ✓ | ✓ | | trial and billing only | |
| Stores: suspend, restore | ✓ | ✓ | | | |
| Support sessions | ✓ | ✓ | ✓ | | |
| Billing and payouts | ✓ | view | | ✓ | view |
| Team | ✓ | invite, except Owners | | | |
| Activity log | ✓ | ✓ | ✓ | ✓ | ✓ |

## 4. Look and feel

- **DripFunnel-branded**, clean and commercial, in the DripFunnel style guide's look
  ([designs/design.md](../../../designs/design.md) §5–7, the source of truth for tokens):
  orange `#EC844F` actions with a `#4A1B0C` label, navy `#0A2A4A` headings, text `#14181F` on
  `#FDFAF7`, Manrope headings and Inter text, 8 px buttons and fields, 12 px cards, 16 px
  dialogs. Design **light and dark**.
- **Desktop first** (1280–1440 px), with a narrow-laptop layout; on a phone a partner can
  still find a store and see its status (design that one flow at 375 px).
- Left sidebar, top header, lists and detail pages, charts only where a trend matters.
- **Status is word + colour + icon**, never colour alone. WCAG 2.2 AA.
- **Money always with its currency and who charges it** ("$49.00 / month, charged by
  DripFunnel for Northstar"). Dates with the time zone. Plain words, sentence case.
- **Where the partner's own brand appears** (branding studio previews, email previews),
  render it in the partner's look, clearly framed as a preview, never restyling the console
  itself.

## 5. The shell

- **Header**: the partner's name and logo (small, as "who you're signed in for"), a search
  box (⌘K) across its stores by name, domain or owner email, a help link, and the signed-in
  user's name and role with a menu (My activity, Sign out).
- **Sidebar**, with badges only for work waiting:

| # | Menu | Badge |
|---|---|---|
| 1 | Dashboard | |
| 2 | Stores | failed setups, domains stuck |
| 3 | Plans | |
| 4 | Branding | setup items left |
| 5 | Domains | records waiting for DNS |
| 6 | Reports | |
| 7 | Billing | failed merchant payments |
| 8 | Support | sessions open now |
| 9 | Activity log | |
| 10 | Settings | |

## 6. Screens to design

### 6.1 Invitation, sign in and onboarding

There is **no sign-up**: partners are invite only. DripFunnel creates the partner and emails
its Owner an invitation; the Owner invites the rest of the team.

- **Accept invitation**: the invitation link opens a screen showing the partner's name and the
  invited email; set your name and password, then set up 2-factor. States: link expired,
  link already used, link replaced by a newer one (each says to ask whoever invited you).
- **Sign in** with email and password, then 2-factor. Forgot password. No "create an
  account" link anywhere. States: wrong code, expired code, locked after too many attempts.
  Never reveal whether an email already has an account.
- **Onboarding** (while the partner is *Draft*): the Dashboard becomes a **setup checklist**
  that can be left and resumed: company details → branding → portal address → preview and
  shop addresses → email sender → at least one priced plan → legal pages → payout details →
  a test merchant signup → **Submit for approval**. Each item shows done, in progress, or
  what's missing, and links to its screen.
- **DripFunnel setting up for you**: DripFunnel staff can do any or all of the checklist for
  the partner, in this same console. Design the staff member's bar (partner name, time left,
  End) and the banner a partner user sees meanwhile ("DripFunnel is setting up your console:
  Priya, until 16:30"). Checklist items show who completed them ("Done by DripFunnel").
  Payment method and payout details say "Northstar enters this itself" to staff.
- **Awaiting approval**: DripFunnel reviews the contract and KYC. Show what happens next and
  that merchants can't sign up yet. **Sent back**: DripFunnel's reason, and what to fix.
- **Live**: a one-time moment: "Northstar Shops is live at store.northstar.com. New signups
  there become your stores."

### 6.2 Dashboard (once live)

Every number links to the list it counts, already filtered.

| Card | Shows |
|---|---|
| Stores | Active, on trial, past due, suspended; new this month |
| Revenue | This month's merchant subscriptions collected, DripFunnel's fee, your payout so far; next payout date |
| Needs attention | Stores past due, failed setups, domains stuck, trials ending in 3 days, each with one action |
| Signups | Started and completed this week; trial-to-paid conversion |
| Usage | Stores near a plan limit (products, AI, "Publish now" presses) |
| Top stores | By monthly sales (totals only) |

A date range control for the cards; comparisons to the previous period in plain words
("+12% vs last month").

### 6.3 Stores (the partner's merchants)

**List**: Store (name, code), Owner (name, email), Plan, Status, Monthly sales (total, in the
store's currency), Storefront ("live", "building", "failed", or "own storefront"), Domain
(live link or custom domain with status), Created. Filters: status, plan, created,
storefront state, near a limit. Search. Saved in the URL as removable chips. Export the list
(accounts only).

**Statuses**, unmistakable from each other: **Trial** (days left) · **Active** · **Past due**
(days; "changes blocked, still selling") · **Suspended** (reason) · **Cancelled**.

**Create store**: store name, owner's name and email, country, plan, trial length. "The
owner gets an invitation to set their own password." Then show provisioning progress
(account → store → portal ready → storefront building → done), under two minutes.

**Store detail**: header with name, status, live link, and an actions menu. Tabs:

| Tab | Contents |
|---|---|
| Overview | Owner and contacts, country, created; plan, price and status with history; people and suppliers count; monthly sales and orders (totals) |
| Plan and limits | Current plan, usage against each limit (products, staff, suppliers, AI, publishes), per-store overrides ("+10 publishes this month") with reason |
| Billing | Subscription, next charge, payment status, invoices (card last 4 only); "Charged by DripFunnel for Northstar" |
| Storefront | Live and preview links, last publish, build status (read-only; the merchant designs it) |
| Domains | Custom domain and DNS status |
| Setup | Signup steps and their result |
| Support | Whether the merchant allows support access; start a session; past sessions |
| Activity | What happened on this account |

**Actions** (each confirmation states the consequence first, and asks for a reason where it
changes the merchant's business): change plan ("from next billing date, or now with
proration?"), extend trial, add a limit override, suspend (type the store name), restore,
resend owner invitation.

Say plainly on the Overview tab: "You see this store's account. Its orders, customers and
products are the merchant's; open a support session to view them read-only."

### 6.4 Plans

The partner's plan catalogue for its merchants.

- **Plans list**: name, monthly and yearly price per currency, trial length, stores on it,
  status (Draft, Live, Retired).
- **Plan editor**: name and description merchants see, prices per currency (monthly, yearly),
  trial length, and an **entitlement matrix** with three kinds of row:
  - **on/off**: custom domain, offers, suppliers, "Powered by" removal, A+ content, size charts;
  - **limits**: products, staff seats, suppliers, languages, currencies;
  - **monthly allowances**: "Publish now" presses, AI design prompts.

  Each row shows **DripFunnel's maximum** as a ceiling the partner can't exceed.
- **Money beside every price**: DripFunnel's wholesale fee for that plan and **your margin**
  ("You keep $31.00 of $49.00").
- **Compare plans** side by side, with a preview of the plan picker merchants will see, in
  the partner's look.
- **Changing a plan stores are on**: "86 stores are on Growth. Apply to new signups only, or
  to everyone at their next renewal?" Grandfathering is explicit.
- **Retiring a plan**: hidden from signup; existing stores keep it or move on a date you pick.
- **Defaults for new stores**: default plan, trial length, allowed countries, currencies,
  languages, payment providers and couriers (from what DripFunnel offers).

### 6.5 Branding (white-labelling the merchant portal)

The partner's brand, applied to **its merchant portal and every email its merchants and
their suppliers receive**, for all its stores. (Merchants design their own online shops
separately; the partner doesn't control those.)

- **Look**: product name ("Northstar Shops"), logo for light and dark backgrounds, mark and
  favicon, primary and accent colours, font (from a list), corner style, sign-in page
  background. **Contrast checked** before saving, with the reason when a colour fails.
- **Live preview**: the real merchant portal screens in the partner's look (sign-in,
  sign-up, home, product list, settings), desktop and phone, light and dark, switchable.
- **Words**: support email and URL, help centre link, terms, privacy policy,
  data-processing agreement, and the "Powered by DripFunnel" line (on or off, where the
  partner's contract allows).
- **Emails**: verification code, invitation, password reset, trial ending, payment failed,
  store suspended, receipt. Edit the subject and a few blocks, preview in the brand's look,
  send a test; variables shown as chips ("{store name}"), never raw braces.
- **History**: every branding change is recorded and can be rolled back or scheduled ("switch
  to the new logo on 1 Nov").

### 6.6 Domains

Every address the partner's platform uses, each with the DNS records to add, what was
found, a status (Waiting for DNS · Verifying · Issuing certificate · Live · Failed), and
"Re-check now":
- the **portal address** (`store.northstar.com`);
- the **preview address** for all stores (`*.preview.northstar.com`);
- the **shop address** for all stores until they connect their own (`*.shops.northstar.com`);
- the **email sender** (`mail.northstar.com`), DKIM, SPF and DMARC, with a fallback sender
  while it's pending;
- a table of **merchants' own domains** and their status.

Explain each record in plain words, with copy buttons.

### 6.7 Reports

Charts and tables over a date range, filterable by plan and country, exportable as CSV:
- **Growth**: signups, new stores, trial-to-paid conversion, churned stores, net store count.
- **Revenue**: merchant subscriptions collected, DripFunnel's fee, payouts, MRR by plan,
  failed payments and recoveries.
- **Plans**: stores per plan, upgrades and downgrades.
- **Store performance**: each store's monthly sales and order count (totals only), growth,
  top and declining stores.
- **Usage**: stores near or over limits, AI prompts and "Publish now" presses used.
- **Setup health**: time to a ready store, failed setups, domains stuck.

Every chart has a plain-words summary above it ("Trials converted at 34% this month, up from
29%"). No report ever lists an order, customer or product.

### 6.8 Billing

Two relationships, never mixed without labels:
- **Your merchants' payments** (collected by DripFunnel for you): payments by store, failed
  payments and retries, refunds, per-store invoices.
- **Your payouts**: each month's gross collected, DripFunnel's fee, adjustments, payout
  amount, status (scheduled, paid, failed), payout bank account (last 4 only).
- **DripFunnel's invoices to you** (if your contract has any separate fees): invoice list,
  what each counts, tax invoice download.
- A **settings** panel: "Who bills your merchants: DripFunnel on your behalf (current) or
  you, with your own billing." Design the second option's screen as a variant: then this
  area only shows DripFunnel's invoices, and the Stores list lets the partner set each
  store's billing status.

### 6.9 Support

Start a support session from a store (reason or ticket link required; refused with a clear
message if the merchant has support access turned off), open sessions with time left, and
the history. The rules, shown when starting: read-only, 30 minutes, the merchant sees a
banner "Northstar support (Maya) is viewing your store. Read-only. Ends in 28 min.", and
write access needs the merchant's approval for that session.

### 6.10 Activity log

Everything done in this console and on the partner's store accounts: by the partner's team,
by DripFunnel staff on the partner's account, support sessions, and account events (plan
changes, suspensions, setups).

- **Search by person first** (a typeahead over the partner's team and its merchants'
  owners); choosing one shows their timeline.
- Filters as chips: who, action, result, store, date range. Rows in plain words ("Maya
  extended Mehta Textiles' trial to 14 Oct: customer request"), expandable to before/after
  and the reason. Newest first; export CSV. Read-only.
- It never shows anything that happened inside a store.

### 6.11 Settings

- **Company**: legal name, address, tax id, contacts, contract summary (read-only).
- **Team**: users, roles, last sign-in, 2-factor on/off; invite, change role, remove. The
  last Owner can't be removed.
- **Payout details**: bank account (last 4 shown), verification status.
- **Security**: require 2-factor for the team.

## 7. States to design on every screen

- **Empty**: an explanation and the action that fills it (a new partner has no stores:
  "Create your first store, or share your sign-up link: store.northstar.com/signup").
- **Loading**: skeletons, never a zero that later becomes real.
- **Error**: plain words first, details behind a click, retry, and keep what was typed.
- **Permission denied**: disabled with the reason and who can.
- **Stale**: "Payment status from 10:42; Stripe is slow."
- **Confirmation**: consequence first, target named, reason where needed.
- **Not live yet**: before approval, screens that need a live partner say so and link to the
  checklist.

## 8. Sample data

You are signed in as **Maya Chen (Owner)** at **Northstar Commerce**, an agency in the US and
Canada, whose merchants see **"Northstar Shops"** at `store.northstar.com`. Brand: a deep
teal primary, warm sand accent, a rounded sans-serif.

Plans (USD and CAD):

| Plan | Monthly | Yearly | Wholesale fee | Stores |
|---|---|---|---|---|
| Starter | $29 / C$39 | $290 / C$390 | $12 | 31 |
| Growth | $49 / C$65 | $490 / C$650 | $18 | 44 |
| Pro | $99 / C$129 | $990 / C$1,290 | $35 | 11 |

86 stores in total. Include: a healthy store (Juniper & Co., $18,420 sales last month); one on
trial ending tomorrow; one past due for 9 days; one suspended for a chargeback; one stuck at
"storefront building" in setup; one with a custom domain waiting for DNS; one using its own
storefront; one near its product limit. Team: Maya (Owner), Diego (Admin), Priya (Support),
Sam (Finance). Last payout: $2,712.40 on 1 Sep 2026.

Also design the **onboarding** version of the console for **Kaufladen Digital** (Germany and
Austria, EUR, German and English), a Draft partner: branding done, plans not priced, email
sender pending DNS.

## 9. The interface must never

- Show a merchant's orders, customers or products, or any report that lists them.
- Show a secret, password, full card or bank number.
- Show a price without its currency and who charges it, or mix merchant payments with
  DripFunnel's invoices without labels.
- Confuse Past due, Suspended and Cancelled.
- Let a branding or plan change reach merchants without a preview and a clear "this affects
  86 stores".
- Show anything from another partner.
- Show raw error codes or technical terms first.

## 10. How to work

1. Restate in your own words what a partner, a merchant and a store are, and what the partner
   can and can't see. List anything this brief leaves unclear, then wait for my go-ahead.
2. Design the shell, then in this order: Dashboard, Stores (list, detail, create, actions),
   Plans, Branding, Domains, Reports, Billing, Support, Activity log, Settings, then accepting
   an invitation, onboarding and approval.
3. For each screen, show the happy path, then the states in §7.
4. Keep one visual system: the same list, filter chips, detail header, tabs, status badges,
   money formatting, confirmation dialog and activity row everywhere.
5. When this brief is silent, ask; don't invent product rules.
