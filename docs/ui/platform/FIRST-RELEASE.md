# FIRST-RELEASE.md: the partner console

The first version of the partner console (`apps/ui/platform`, `platform.dripfunnel.com`):
**everything the prototype draws**, `designs/DF Platform Prototype.dc.html` (decided
2026-10-01 on #109, replacing the "run merchants" cut made earlier that day). Ten menus,
twenty screens, every state the prototype's Scenario control reaches.

**Status: specification, not built.** Build order is not scope: Billing, Reports and Support
depend on Stripe Connect, the Store API and the support-session handoff, none of which exist,
so their API cards come after the others' (§16). The screens are specified here so the
fixtures they are built on are honest about the contract.

Last updated: 2026-10-03.

Rules that still apply in full: [README.md](README.md) (what the console is, roles, never-do
list), [../README.md](../README.md) (how every SPA is built),
[../../api/ACCESS.md](../../api/ACCESS.md) (partner identity, sessions, roles, support
sessions), [../../api/SAAS.md](../../api/SAAS.md) (partner and store states, plans, billing,
domains), [../../api/LOGGING.md](../../api/LOGGING.md) §6 (what a partner sees of the activity
log).

**The prototype decides behaviour; this document decides scope and rules** (docs/README.md
§3). §17 lists where the two differ and which wins. Everything not listed there — wording,
the order of steps, each dialog's consequence sentence, the statuses and their colours, the
80% "near a limit" threshold, the five-attempt lock, the 30-minute reset link — is taken from
the prototype as drawn.

---

## 1. Principles

- **Account level, never inside a store.** A partner sees its merchants' accounts and their
  **monthly sales and order totals**. Never an order, a customer or a product
  (USERS-AND-DOMAINS §4). The Stores, Reports and Store detail screens say so in one line.
- **Get approved first.** Until the partner is Live, Home is the setup checklist (§4) and the
  screens that need merchants (Stores, Reports, Support, Billing's payments and payouts) show
  "{product} appear once {product} is live" with a link to the checklist.
- **Every screen is a list or a detail page** with the same patterns: search, filters in the
  URL as removable chips, a status column, a detail page with tabs, actions in one place.
- **Every action states its consequence first, asks for a reason where it changes a
  merchant's business, and is audited.** Nothing is deleted in this release.
- **Money always with its currency and who charges it** ("$49.00 / month, charged by
  DripFunnel for Northstar"). Merchant payments, payouts and DripFunnel's invoices are never on
  one screen without labels. Dates with the zone named.
- **The API decides; the screen displays.** Permissions, margins, comparisons, contrast
  results and conversions come from the API. A component computes nothing.
- **Designed states on every screen**: empty, loading, error, permission denied (disabled with
  the reason and who can), stale, offline, not live yet, and the partner-state banners (§2).
- **The console is DripFunnel-branded.** The partner's look appears only inside Branding's
  preview frames and the plan-picker preview, never on the console's chrome (README.md §4).

---

## 2. Shell: menu, header, banners

### 2.1 Menu

| # | Menu | For | Badge (work waiting) |
|---|---|---|---|
| 1 | **Dashboard** (Home; the checklist until Live, §4) | Everyone | none |
| 2 | **Stores** | Everyone | failed or stuck setups + merchants' domains stuck |
| 3 | **Plans** | Everyone | none |
| 4 | **Branding** | Everyone | setup items left, until Live |
| 5 | **Domains** | Everyone | partner records waiting for DNS + merchants' domains stuck |
| 6 | **Reports** | Everyone | none |
| 7 | **Billing** | Owner, Admin, Finance, Read-only — **absent for Support** | merchants' failed payments (when DripFunnel bills) |
| 8 | **Support** | Owner, Admin, Support — **absent for Finance and Read-only** | sessions open now |
| 9 | **Activity log** | Everyone | none |
| 10 | **Settings** | Everyone; actions by role (§14) | none |

A row a role can't use is **absent** (../README.md §5); inside a screen, a control a role can't
use is **visible and disabled with the reason and who can** ("Your role (Finance) can't
suspend stores. Owners and Admins can."). Under the menu: "Your merchants see **{product}**.
This console is only for your team."

### 2.2 Header

The DripFunnel logo and "Partners"; the partner's name and initials as "Signed in for"; a
**search box (⌘K)** over its stores by name, code, domain or owner email, results showing
owner email, domain and status; a Help link; the signed-in user's name and role with a menu
holding **My activity** (their own timeline, §13) and **Sign out**. On a phone the sidebar is a
drawer behind a menu button and the search collapses to an icon.

### 2.3 Banners, strips and dialogs the shell owns

| What | When | Says |
|---|---|---|
| **Partner-state strip** | Draft · Awaiting approval · Sent back | "Draft: merchants can't sign up yet. Finish the setup checklist…" → Open checklist · "Awaiting approval: DripFunnel is reviewing your contract, KYC and setup…" → What happens next · "Sent back: DripFunnel needs a change before approving you." → See what to fix |
| **Setup-session bar** (staff) | A DripFunnel staff member is in a setup session | "Setting up {partner} · 1 h 12 min left" with **End** (ACCESS §8.2; `StaffSessionLayer`, #46) |
| **Setup-session notice** (partner side) | Same session, seen by the partner's team | "DripFunnel is setting up your console: Priya, until 16:30" → See their changes (Activity log filtered to DripFunnel setup) |
| **Paused** | SAAS §3.1 Paused | "DripFunnel paused {product}. New merchants can't sign up at {host} and you can't create stores. Your N stores keep running. Reason: …" → Contact your partner manager |
| **Offboarding** | SAAS §3.1 Offboarding | "{partner} is offboarding. Your contract ends on {date}. No new stores or signups…" → What happens next |
| **Closed** | SAAS §3.1 Closed | "{partner} is closed. The console is read-only. Your stores were moved on {date}. You can still download invoices and your activity log." → Billing |
| **Contract ending / grace / lapsed** | From the contract term (§18) | "Your DripFunnel contract ends on {date}, in 9 days…" · "Your contract ended on {date}. 12 days of grace left. On {date} the console becomes read-only…" · "Your contract lapsed on {date}. The console is read-only. Merchants can't sign up and payouts are held. Your stores keep running." |
| **Store limit reached** | The contract's store limit | "You've reached your N-store limit. Existing stores keep running, but new merchants can't sign up and you can't create stores." → Contact your partner manager |
| **Payout account failed** | Verification failed | "Your payout account couldn't be verified. The test deposit to {account} was returned: … Payouts are held until you add a working account." → Fix payout details |
| **Payment method declined** | DripFunnel's charge failed | "DripFunnel couldn't charge your card. {card} was declined for invoice {id}. Update it by {date}; nothing is paused until then." → Update payment method |
| **Domains stopped working** | Portal host or email sender records changed | "{host} and {mail} stopped pointing at DripFunnel. Merchants can't reach your portal and emails aren't sending…" → Open Domains |
| **Offline** | No network | "You're offline. You can keep reading. Saving is paused and comes back when you reconnect." Save dialogs refuse with "Nothing was sent… what you entered is kept." |
| **Stale** | Stripe or GitHub slow | "Some numbers are from 17:12. Stripe and GitHub are slow to answer. We'll refresh automatically." |
| **Session expired** (dialog) | ACCESS §4: idle 2 h, absolute 12 h | "You were signed out after 12 hours to keep the console safe. Sign in again and you'll come back to this page. Nothing you saved was lost." |
| **Load error** | The API didn't answer | "We couldn't load {page}. The partner service didn't answer in time. Nothing was changed." Try again · DripFunnel status; the request id behind a click |
| **Save conflict** | Someone else changed it | "We couldn't save this. Someone else changed this a moment ago, so we didn't overwrite it. Nothing was changed. Close this, reload and try again." |
| **Not found** | A removed store, plan or bad link | "This link doesn't work anymore. The store, plan or page may have been removed, or the link is wrong." |

Read-only states (Closed, contract lapsed, offline) disable every save with that banner's
reason; nothing is hidden.

**Environment marker** (decided 2026-10-01, settling CONSOLE-DESIGN A3's *(ask)* for
partners): **nothing in production** — partner users see the console as the prototype draws
it. On `dev-platform.dripfunnel.ai`, feature hosts and localhost, the same grey Dev, Feature
or Local strip as the admin console, from one shared `environmentFor` (#65, #111).

---

## 3. Accept invitation and sign in

There is **no sign-up** anywhere on `platform.dripfunnel.com` (USERS-AND-DOMAINS §3): the
Owner is invited when Admin creates the partner; everyone else by the Owner or an Admin
(§14.2). No "create an account" link; no Google button (decided 2026-10-01: Google sign-in is
not in this release, ACCESS §2).

**Accept invitation** (`/accept-invite?token=`), "Join {partner}": the partner, the role, the
invited email ("The email can't be changed") and who invited them (DripFunnel, or the Owner
by name); your name; a password of at least 10 characters. Then **2-factor, step 2 of 2**: a
QR code and a text key for an authenticator app, then the 6-digit code — **required when the
partner's Security switch is on** (§14.4), otherwise offered with "Skip for now". The link
states: **expired** ("Invitation links work for 7 days. Ask whoever invited you to send a new
one."), **already used**, **replaced by a newer one** — each with "Go to sign in" and nothing
more (ACCESS §6.3).

**Sign in**: work email and password ("For partner teams. Merchants sign in at their
partner's portal."), then the 2-factor code when the user has one ("Open your authenticator
app and enter the code for DripFunnel Partners."), with "Use a different account". Below the
form: "New to the console? Use the link in your invitation email." States: wrong email or
password (**one message, same timing** — never reveal whether an email has an account, ACCESS
§2), wrong code ("That code isn't right. 3 tries left."), expired code, **locked after five
wrong codes** ("…signing in is paused for 15 minutes. We've emailed you about it."), session
expired (§2.3). **Forgot password** → "If there's an account for {email}, we've sent a link to
reset the password. It works for 30 minutes." — identical whether or not the email exists.

The `next` redirect after sign-in is same-origin only (ACCESS §4). After accepting, an Owner
lands on the checklist with the welcome card (§4); a team member on the Dashboard.

**Decided 2026-10-01 (on #109): 2-factor is optional per user; the partner's Owner may require
it for the whole team.** When the switch is turned on, every user without 2-factor enrols at
their next sign-in before reaching the console. ACCESS §2 records it.

---

## 4. Onboarding: Home until Live

The admin console's part E seen from the partner's side (CONSOLE-DESIGN E, SAAS.md §3.2).
Home is "Set up {product}" while the partner is **Draft**, "Awaiting approval" or "Sent back
by DripFunnel"; "You can leave and come back; your progress is saved."

**The checklist**, ten items plus Submit ("4 of 11 done" and a progress bar), each Done · In
progress · To do with one line of detail, a link to its screen, and when done, who did it:

| # | Item | Links to | Done when |
|---|---|---|---|
| 1 | Company details | Settings › Company (§14.1) | Legal name, address, tax id, region present |
| 2 | Branding | Branding (§8) | Logo, colours and font saved |
| 3 | Portal address | Domains (§9) | The portal host is Live |
| 4 | Preview and shop addresses | Domains | Both wildcards Live |
| 5 | Email sender | Domains | DKIM, SPF and DMARC verified; until then "Emails use a fallback sender" (SAAS §3.6) |
| 6 | At least one priced plan | Plans (§7) | A Live plan with a price in every currency |
| 7 | Legal pages | Branding › Words | Terms, privacy and data-processing agreement set; **Impressum** too for a German partner |
| 8 | Payment method | Settings › Payout and payment (§14.3) | The card DripFunnel charges for its invoices |
| 9 | Payout details | Settings › Payout and payment | The bank account DripFunnel pays into, **verified** |
| 10 | A test merchant signup | **Run test signup** on the item (Owner, Admin) | A test store created and removed; "ready in 1 min 38 s" |

Items 8 and 9 are **the partner's own**: in a staff setup session they read "{partner} enters
this itself" with a lock (ACCESS §8.2); to the Owner they read "Your turn"; to any other role
"Owner adds this". They are **not go-live checks** (SAAS §3.2 step 5): Submit says "Payment
method and payout details can come later." Payouts wait for item 9.

**Who completed it.** Items done in a staff setup session say "Done by DripFunnel"; the
Owner's first sign-in after staff set things up shows a welcome card: "DripFunnel has set up
most of {product} for you. Check what's done and finish the rest." — or, when staff already
submitted, "…and submitted it for approval. While they review it, add the two things only you
can." with "N steps left, plus payment method and payout details, which only you can add."

**Submit for approval** (Owner, Admin) runs the **go-live checks** first (SAAS §3.2 step 3):
portal host live, email domain verified or the fallback sender accepted, at least one priced
plan, legal pages set, a test signup completed. The button is disabled with "Finish the N
items above first" until they pass. Confirmation: "DripFunnel reviews your contract, KYC and
setup. That usually takes 2 business days. You can keep editing, but merchants can't sign up
until you're approved."

**Awaiting approval**: "Submitted (by DripFunnel) on {date}"; **What happens next** in three
numbered steps — Contract and KYC check → Setup review ("We sign up as a test merchant and
check your branding, plans and legal pages") → Decision ("Usually within 2 business days.
You'll get an email either way."); "Merchants can't sign up at your portal until you're
approved. You can still change branding and plans."

**Sent back**: "DripFunnel's reason" verbatim, the fix as a link ("Add an Impressum to your
legal pages" → Branding › Words, where the field says "Required in Germany. DripFunnel sent
your setup back for this."), the checklist reopened, and **Submit again**.

**Live**: a one-time card on the Dashboard — "{product} is live at {host}. New signups there
become your stores. Share your sign-up link: {host}/signup" — then Home is the Dashboard (§5).

---

## 5. Dashboard (once Live)

Every number links to the list it counts, already filtered. A **date range** (This month ·
Last month · Last 90 days) applies to every card and lives in the URL. Comparisons are plain
words ("94% of August so far, with 2 days to go", "+4% vs July") **computed by the API**.

| Card | Shows | Links to |
|---|---|---|
| **Stores** | Active, On trial, Past due, Suspended, each a link; "N in total"; "N new this month" | Stores filtered by status / created |
| **Revenue** | Merchant subscriptions collected, DripFunnel's fee, your payout so far, comparison, next payout date; "Collected by DripFunnel for {partner}. CAD is converted at the payout rate." | Billing › payments, Billing › payouts |
| **Needs attention** | Past due (days) → **Open billing**; Setup stuck ("Storefront building for 43 min") → **Retry setup**; Domain stuck ("waiting for DNS for 2 days") → **Re-check**; Trial ending ("ends tomorrow") → **Extend trial**. "Nothing needs you right now." when empty | The store's tab |
| **Signups** | Started and completed in the range; "34% of trials became paid stores · up from 29% last month" | Stores filtered `created` |
| **Usage** | "N near a limit"; the four closest with a bar ("4,210 of 5,000 products"); "No store is at 80% of a limit." when none | The store's Plan and limits tab; Stores filtered `near` |
| **Top stores by sales** | Top five, last month, totals only, in each store's currency, with plan; "No sales yet." | The store's page; **Report** → Reports › Store performance |

Each action button carries its own permission (Retry setup: Owner, Admin; Extend trial: Owner,
Admin, Finance). A brand-new Live partner sees zeros with "Your first payments arrive when
merchants pay" and "No trials have ended yet."; the Stores empty state is "Create your first
store, or share your sign-up link: {host}/signup".

---

## 6. Stores

### 6.1 Stores list

"Your merchants' store accounts. Their orders, customers and products stay theirs."

| Column | Notes |
|---|---|
| Store | Name and code |
| Owner | Name and email |
| Plan | The partner's plan name; "80% of products" under it when near a limit |
| Status | **Trial** (days left; "Ends tomorrow") · **Active** · **Past due** ("9 days · changes blocked, still selling") · **Suspended** (first sentence of the reason) · **Cancelled** ("Since 2 Sep") — word, colour and icon, never confused (SAAS §4.2) |
| Sales last month | Total in the store's currency; "—" when none |
| Storefront | Live · Building · Failed · Own storefront |
| Domain | A link, with "Waiting for DNS" under it when a custom domain is not live |
| Created | Date |
| Billing status | **Only when the partner bills its merchants itself** (§11.4): Active · Past due · Suspended, set inline (Owner, Admin, Finance) |

Filters: Status, Plan, Created (This month · Last 30 days · Last 90 days), Storefront, Near a
limit (80%+). Search: name, code, domain, owner email. All in the URL as removable chips with
"Clear all"; "No stores match" with Clear filters. Newest first, **"Show 25 more"** (§16 for the
contract: cursor pages carry no total, so the prototype's "12 of 86 stores" is not drawn;
decided 2026-10-02 on #115). On a phone, cards: name and status, plan · domain. Header
buttons: **Export accounts (CSV)** ("Orders, customers and products are never included.") and
**Create store** (Owner, Admin).

### 6.2 Create store

"For a merchant you've signed yourself. Merchants can also sign up at {host}/signup." Fields:
store name, owner's name, owner's email, country (the partner's countries), plan (Live plans
with their monthly price in the country's currency), trial (No trial · 7 · 14 · 30 days); a
price line ("$49.00 / month, charged by DripFunnel for Northstar, after a 14-day trial." — the trial length is the plan's, SAAS.md §6.1);
"The owner gets an invitation to set their own password." Then **Setting up {store}** with the
five provisioning steps from SAAS §5 (Account · Store · Portal ready · Storefront building ·
Done), "This takes under two minutes. You can leave this page.", and when done "Ready in 1 min
42 s. {owner} has an invitation to set their password." → Open the store · Create another.

Refused with the reason when the partner is not Live, Paused ("no new stores for now"),
Offboarding, at its store limit, or when the role can't (Owner and Admin only).

### 6.3 Store detail

Header: initials, "Store · {product}", name, status, code, the live link, and **Actions ▾**
(§6.4). A suspended store shows "Suspended on {date}: {reason}"; a past-due store "Past due
for 9 days. {owner}'s team can't make changes, but the shop is still selling. We retry the
card on {date}."

| Tab | Contents |
|---|---|
| **Overview** | The sentence "You see this store's account. Its orders, customers and products are the merchant's; open a support session to view them." **Account**: owner, country, created, plan ("Growth · $49.00 / month, charged by DripFunnel for Northstar"), people ("9 people · 3 suppliers"), sales last month ("$18,420.00 · 612 orders (totals)"). **Contacts**: the merchant-side users by name, email and role ("Only the owner so far."). **Plan and status history**: each change with before → after and who |
| **Plan and limits** | The plan and price with **Change plan**; usage bars for products, staff seats, suppliers, AI design prompts (this month), "Publish now" presses (this month) — "Near the limit" at 80%, "At the limit" at 100%, "not included" when the plan lacks it; **Overrides for this store** ("None. This store gets exactly what its plan includes.") with what, reason, who and when, and **Add override** |
| **Billing** | Subscription (plan and cycle), price, next charge ("First charge 11 Oct, when the trial ends" · "No upcoming charge"), payment status (Paid · Failed · No card yet), card ("Card ending 4417" · "No card on file"), "Charged by DripFunnel for Northstar" or "You bill this merchant yourself"; **Invoices** (id, date, amount, Paid/Failed, card). When the partner bills itself: a **Billing status** select (Owner, Admin, Finance) |
| **Storefront** | Live · Building · Failed · Own storefront; live and preview links; last publish ("Not published yet"); "Read-only. The merchant designs and publishes their shop." For an own storefront: "This merchant runs its own storefront and uses {store}'s account for products, orders and checkout behind it." |
| **Domains** | The custom domain, status, "Waiting since {date}", the CNAME record (type, name, value with Copy, what we found), **Re-check now** |
| **Setup** | The five signup steps with Done · Working · "Taking longer than usual" ("Running for 43 min. It usually takes under two minutes.") · Failed · Waiting, and **Retry this step** (Owner, Admin — decided 2026-10-01, settling CONSOLE-DESIGN K's *(ask)*: the prototype offers it and nothing it touches is the merchant's data) |
| **Support** | "{store} allows {partner} support to sign in as its users." or "{owner} has turned partner support off for {store}. Only {owner} can turn it on, in their Settings › Support access."; **People in {store}** — name, email, role (suppliers as "Supplier admin · Loomcraft"), status, last sign-in, **Open support session** (§12.2) or **Return to session**; **Past sessions** (who as whom, reason, when, Ended by staff · Expired · Open now) |
| **Activity** | This account's entries (§13), newest first; "Nothing has happened on this account yet." |

### 6.4 Store actions

The menu lists only the actions the store's state allows; those the role can't use are
disabled with the reason.

| Action | Who | Offered when | Needs | Consequence stated before confirming |
|---|---|---|---|---|
| **Change plan** | Owner, Admin | Not cancelled | A Live plan; **from the next billing date** or **now with proration** ("$3.33 charged today" / "credit on the next invoice"); reason | "{store} moves from Growth ($49.00 / month) to Pro ($99.00 / month), charged by DripFunnel for Northstar. Its limits change to Pro's." The merchant gets an email |
| **Extend trial** | Owner, Admin, Finance | On trial | 3, 7 or 14 days; reason | "The trial ends 30 Sep. It will end 7 Oct instead. Nothing is charged until then." |
| **Add a limit override** | Owner, Admin | Not cancelled | Limit, amount, **this month only** or **until removed**; reason | "{store} gets +10 'Publish now' presses this month only. Its plan and price stay the same." |
| **Resend owner invitation** | Owner, Admin | Always | | "{owner} ({email}) gets a new invitation to set their password. The old link stops working." |
| **Restore** | Owner, Admin | Suspended | Reason | "Its shop takes orders again and its team can sign in and make changes. Billing restarts from today." |
| **Suspend** | Owner, Admin | Active, Trial or Past due | Reason (the merchant sees it); the store name typed | "Its shop stops taking orders and its team can't make changes until you restore it. {owner} gets the 'Store suspended' email. Billing pauses." (SAAS §4.2–4.3) |
| **Retry this step** | Owner, Admin | A stuck or failed setup step | | "We start this step again. The merchant's products and settings aren't touched. It usually takes under two minutes." |

Who may act is **the API's answer**: `store(id)` returns each action as allowed, refused with
a stable code, or absent for the state. Codes: `OWNERS_AND_ADMINS_ONLY`, `FINANCE_TRIAL_ONLY`,
`ALREADY_SUSPENDED`, `NOT_SUSPENDED`, `NOT_ON_TRIAL`, `NO_PENDING_INVITATION`,
`PARTNER_NOT_LIVE`, `PARTNER_PAUSED`, `STORE_LIMIT_REACHED`, `READ_ONLY` (closed or lapsed).

---

## 7. Plans

"What your merchants can buy, within DripFunnel's maximums." Prices are what merchants pay;
"DripFunnel keeps its wholesale fee and pays you the rest monthly." (SAAS §6, CONSOLE-DESIGN G)

### 7.1 Plans list

Plan (name and description), Prices (monthly · yearly per currency, with "DripFunnel's fee
$18.00 / store / month" under them), Trial, Stores (a link to the filtered list), Status
(Live · Draft · Retired). Header buttons: **Compare plans**, **Defaults for new stores**, **New
plan** (Owner, Admin).

### 7.2 Plan editor

Status pill, **Preview the plan picker** (→ §7.4), **Make live** (Draft only; refused until
every currency has a price), **Retire plan** (Live only), **Save changes**.

- **Name merchants see**, **description merchants see**, **trial** (No trial · 7 · 14 · 30).
- **Prices** per currency, monthly and yearly ("Not priced" placeholder). Beside each:
  "DripFunnel's fee $18.00 / month" ("converted at the contract rate" for a second currency)
  and the margin — "You keep $31.00 of $49.00", or in red "Below DripFunnel's fee: you'd lose
  $3.00 per store". Fee and margin come from the API as `Money`.
- **What's included**: the entitlement matrix (SAAS §6.1) — **On/off** rows (custom domain,
  offers, suppliers, remove "Powered by", A+ content, size charts), **Limit** rows (products,
  staff seats, suppliers, languages, currencies), **Monthly allowance** rows ("Publish now"
  presses, AI design prompts). Every row shows "DripFunnel max 20,000" (or "Allowed by your
  contract" / "Not allowed in your first contract year" for "Powered by"). A value above the
  maximum is marked "Can't be more than 20,000." and Save is disabled with "Fix the
  highlighted rows first." — **the API refuses it too** (`ABOVE_CEILING`, naming the row); the
  UI never clamps.

**Who**: Owner and Admin edit everything; **Finance edits prices only** ("Your role (Finance)
can't edit plans. Owners and Admins can. You can change prices."); Support and Read-only view.

### 7.3 Saving and retiring

- **Saving a plan stores are on** asks who gets the change (SAAS §6.3): "86 stores are on
  Growth. Who gets the change?" — **New signups only** (the 86 keep what they have) or
  **Everyone, at their next renewal** (they get an email 30 days ahead). "Check the plan picker
  preview before you apply." A new plan: "Nobody is on this plan yet. It shows at signup once
  it's Live." Plans are versioned so a subscription points at the version it bought.
- **Retiring**: "{plan} disappears from signup now. 44 stores are on it." — **Keep {plan} as it
  is** or **Move them to another plan on a date** (1 Nov · 1 Dec · 1 Jan). Retiring the last
  Live plan is refused (`LAST_LIVE_PLAN`).

### 7.4 Compare plans

Every non-retired plan as a column (name, monthly price in the first currency), every
entitlement as a row ("Included" / "—" / "5,000" / "60 / month"). Below, **Preview · what
merchants see at signup**: the plan picker rendered in the partner's look — product name,
"Choose your plan", each plan's name, description, price, first five included features and
"Start free trial" — inside a frame that says "In your brand. The console itself doesn't
change."

### 7.5 Defaults for new stores

"What a new store starts with, from what DripFunnel offers." Default plan; trial length;
checkbox groups for **Countries merchants can sign up from**, **Currencies**, **Languages**,
**Payment providers**, **Couriers** — "Only what DripFunnel offers in your region is listed.
Existing stores keep their settings." Save (Owner, Admin): "Saved. Only new stores get these;
existing stores don't change." (CONSOLE-DESIGN G4–G5; the options come from the API's
platform-allowed lists.)

Promotions on plans are not drawn and not in this release (SAAS §14).

---

## 8. Branding

"How your merchant portal and every email to your merchants and their suppliers look."
Four tabs. **Owner and Admin** edit; others view. Unpublished changes show "Unpublished
changes. Merchants still see the published version. This affects 86 stores." with **Discard**
and **Publish…**.

### 8.1 Look

Product name merchants see; primary and accent colours (picker and hex); **Contrast check** —
"White text on primary · 6.2:1 Passes", "Dark text on accent · 3.9:1 Fails", with the fix
("…needs 4.5:1 to be readable; try a darker primary"); font (Nunito, Source Sans 3, Manrope,
Lora, DM Sans); corners (Rounded · Soft · Square); sign-in background (Sand texture · Plain
colour · Photo); the four files — logo for light backgrounds, logo for dark, mark, favicon —
with Replace. Publish is disabled with "Fix the contrast first." while a pair fails; **the API
refuses a failing pair too** (`CONTRAST_FAILS`, SAAS §3.3), the hint on screen is a courtesy.

**Preview · merchant portal**: Sign in · Sign up · Home · Products · Settings, at Desktop or
Phone, Light or Dark, rendered with the partner's tokens inside a frame. Until `apps/ui/store`
has real screens the preview renders the prototype's sample screens (the sign-in card, a
portal header and nav, a home with two numbers, a product list, a settings page); the
console's own tokens never change (README.md §4).

### 8.2 Words

Support email, support URL, help-centre link, terms of service, privacy policy,
**data-processing agreement** ("Needed before DripFunnel can approve you."), **Impressum** for a
German partner ("Required in Germany."), and **Show "Powered by DripFunnel"** with the
contract's note ("Your contract lets you remove it." / "Your contract keeps this line on for
the first year.", disabled). The API says which the contract allows
(`POWERED_BY_FIXED_BY_CONTRACT`; CONSOLE-DESIGN §3 fact 18).

### 8.3 Emails

Seven templates (SAAS §3.4): Verification code, Invitation, Password reset, Trial ending,
Payment failed, Store suspended, Receipt. For each: subject (shown "Reads as:" with variables
as chips), heading, message, **Insert a variable** (store name, product name, owner name,
support email, days left, code, amount, plan name, card last 4), **Reset to default**, **Send a
test to {me}**, **Save email…** (through the publish dialog). **Preview · in your brand**: from,
subject, heading, body, "Open {product}", "Questions? {support email}", with sample values
filled in. Variables are never shown as raw braces (CONSOLE-DESIGN F6).

### 8.4 Publishing and History

**Publish…**: "This changes the merchant portal and emails for 86 stores. Their shops don't
change." — **Now**, or **On {date}, 00:00 {zone}** (scheduled). **History** lists every
change: what, before → after, who, when; a scheduled one says "Scheduled" with **Cancel
schedule**; a past one with a before value offers **Roll back** ("This goes back to {before}
for every store's portal and emails, right away."). (CONSOLE-DESIGN F8; SAAS §3.3 "versioned".)

---

## 9. Domains

"Every address your platform uses." (SAAS §3.5–3.6, §8; CONSOLE-DESIGN M)

### 9.1 The four addresses

One card each — **Merchant portal** (`store.northstar.com`, "Where your merchants sign in and
build their shops."), **Preview address, all stores** (`*.preview.…`), **Shop address, all
stores** (`*.shops.…`), **Email sender** (`mail.…`, "Emails to your merchants and their
suppliers come from here.") — with status (Waiting for DNS · Verifying · Issuing certificate ·
Live · Failed), "Waiting since {date}" or "Checked 12 min ago", **Re-check now** (every role),
and a record table: Type, Name, Value to add (with Copy and a plain-words line — "DKIM: signs
every email so inboxes trust it."), What we see ("Nothing found yet", or the found value with
"Doesn't match yet"). The email card adds "Until it's live, emails come from
no-reply@{partner}.dripfunnel-mail.com with your product name." (SAAS §3.6).

### 9.2 Add an address

Offered (Owner, Admin) while fewer than four exist; "All four addresses are set up" otherwise.
Three steps:

1. **Address**: what it is for (the four kinds; added ones marked); the hostname, with `*.`
   fixed in front for the wildcards. Refused: not an address; a DripFunnel domain ("Use a
   domain your company owns"); already one of yours; a bare domain for a wildcard or the email
   sender ("Use a subdomain, like mail.northstar.com, so it doesn't clash with your
   website."). A root domain for the portal is allowed with a warning ("If northstar.com is
   also your website, the website will stop working.") and gets an A record instead of a CNAME.
2. **DNS records**: "Add this record at your DNS provider. Sign in where you manage DNS for
   {apex}… Keep this page open." Each record with Copy on name and value; "Some providers add
   your domain to the name for you… Changes usually show up within an hour, and can take up to
   48." → **I've added it. Check now**.
3. **Check**: "Saved. We haven't found the record yet, which is normal right after adding it.
   We check every 10 minutes and email you when it's live. Nothing else waits on this." →
   Check again · Go to Domains · Add the next address. When found: "We found the record and
   issued the certificate. Merchants can sign in here now."

Changing a live portal host keeps the old one redirecting for a period still *(ask)* (SAAS
§3.5).

### 9.3 Merchants' own domains

"Merchants connect these themselves. You can see their status and help." Store, host, status,
"Since {date}" or "Live", each linking to the store's Domains tab (§6.3).

---

## 10. Reports

"Totals over time. No report lists an order, customer or product." Six tabs; filters Range
(Last 6 months · Last 3 months), Plan, Country; **Export CSV** per tab; a plain-words summary
above every chart. A new partner sees "Reports fill in as your first merchants sign up."
(CONSOLE-DESIGN B3, N; the design prompt §6.7.)

| Tab | Shows |
|---|---|
| **Growth** | "Trials converted at 34% this month, up from 29%. You have 86 stores, 8 more than in August." Signups per month (bars); table Month · Signups · New stores · Trial to paid · Churned · Net stores |
| **Revenue** | "You've collected $3,988.40 so far in September, on track to beat August's $4,261.40." Collected per month (bars); table Month · Collected for you · DripFunnel's fee · Your payout; **MRR by plan** ("Approximate: CAD converted, trials excluded."); **Failed payments and recoveries** → Billing. "All amounts in USD; CAD payments are converted at the payout rate." |
| **Plans** | "Growth is your most popular plan, with 44 of 86 stores. 4 stores upgraded and 1 downgraded this month." Stores per plan (bars); **Plan changes this month** (Starter → Growth · 3) |
| **Store performance** | "{store} sold the most last month ($18,420). 2 stores sold less than the month before." **Top stores** (Store · Plan · Sales last month · Orders · vs month before) and **Declining** (more than 3% down). "Totals only. Individual orders, customers and products stay with each merchant." |
| **Usage** | "N stores are at 80% or more of a limit. AI prompts used this month: 1,234; 'Publish now' presses: 312." Each store near or at a limit, linking to its Plan and limits tab |
| **Setup health** | "A new store is ready in 1 min 42 s on average. 1 setup is stuck and 1 custom domain is waiting for DNS." Time to a ready store (median, last 30 days), Failed setups, Domains stuck (over 24 h); the stores concerned |

Every number, trend and conversion is **the API's**; the screen draws bars and words it is
given.

---

## 11. Billing

"Your merchants' payments, your payouts and DripFunnel's invoices, kept apart." **Absent for
Support**; Owner, Admin, Finance and Read-only see it; **Owner and Finance change it**. A
stale strip ("Payment status from 17:42; Stripe is slow to respond.") with **Refresh now**
(CONSOLE-DESIGN H7). Before the partner is Live, payments and payouts say "Merchant payments
and payouts appear once {product} is live."

### 11.1 Your merchants' payments

"Collected by DripFunnel for Northstar. Money from your merchants." **Failed, being retried**:
store, amount, why ("Card declined · card ending 1881"), "Retry 30 Sep, 06:00 PT · attempt 4
of 4". Then every payment: Date · Store · Amount · Charged by · Status (Paid · Failed ·
Recovered · Refunded, with the note) · Card.

### 11.2 Your payouts

"What DripFunnel pays you: merchant payments minus DripFunnel's fees." "Next payout 1 Oct:
about $2,522.40 so far, to Chase ending 1180." — or "Next payout held: your payout account
failed verification." / "…your contract lapsed." / "Your first payout comes the month after
your first merchant pays." Table: Month · Collected · DripFunnel's fee · Adjustments (with the
note, "Refund to Summit Supply for a double charge") · Payout · Paid on · Status (Paid ·
Scheduled · Failed) · To (last 4 only). (SAAS §7.1 "DripFunnel bills on the partner's behalf"
ships first.)

### 11.3 DripFunnel's invoices

"What you owe DripFunnel for separate fees in your contract. Not merchant payments." Id, date,
what, amount, status, **Tax invoice (PDF)**; "No invoices yet. Your contract has no separate
fees so far."

### 11.4 Settings: who bills your merchants

**DripFunnel, on your behalf** ("We charge your merchants, retry failed payments and pay you
monthly, minus our fee.") or **You, with your own billing** ("You charge merchants yourself and
set each store's billing status. DripFunnel invoices you for its fees."), Owner and Finance;
the payout account with a link to change it (§14.3). **When the partner bills itself**: Billing
shows only DripFunnel's invoices and Settings; the Stores list gains a Billing status column
and each store's Billing tab a Billing status select (§6.1, §6.3); "charged by DripFunnel for
Northstar" reads "billed by Northstar" everywhere. SAAS §7.1 says this mode follows the first;
its API card comes after (§16). How the platform learns a store's status in this mode is open
(SAAS §14).

---

## 12. Support

"Sign in as one of your merchants' users to fix things with them. 30 minutes, logged as you
acting as them." **Owner, Admin and Support**; absent for Finance and Read-only. Two tabs:
**Users** and **Sessions · N open now**. (USERS-AND-DOMAINS §4.1, ACCESS §8, CONSOLE-DESIGN J.)

**The rules, shown at the top of Users**: 30 minutes, no extension ("Start a new session if
you need more time."); merchant consent ("Only for stores that have partner support turned
on."); everyone sees it ("A banner in the store: 'Northstar support (Priya) is signed in as
Jenna. Ends in 28 min.'"); logged as you ("Every action shows as 'Priya as Jenna' in your log
and the merchant's."); some things stay theirs ("Passwords, 2-factor, payment details and
ownership can't be changed.").

**The rule the prototype draws differently** (§17): a partner support session is **read-only**
(the Owner's read permissions, nothing credential-shaped), and **write access needs the
merchant's approval for that one session** — support requests it, the merchant clicks Allow or
Deny, the elevation is logged (ACCESS §8, decided 2026-09-30 in designs/design.md §8). The
prototype's "Changes you save are logged as Priya as Jenna" therefore applies only after the
merchant has allowed writes; before that the portal shows the read-only bar. The
prototype's blocked list (password, 2-factor, payment details, ownership) stays blocked even
when elevated.

### 12.1 Users

"Find a user" (name, email or store). Name and email · Type (Store user · Supplier user) ·
Store and role ("Juniper & Co. · Owner", "Supplier admin for Loomcraft") · Last sign-in ·
Status (Active · Invited · Suspended) · **Open support session**, or **Return to session** when
yours is open with that user. Refused with the reason: the role; "{owner} has turned off
partner support for {store}. Ask them to turn it on in Settings › Support access."; "{user}
hasn't accepted the invitation yet."; "{user}'s account is suspended in {store}."; "{store} is
cancelled."; "{colleague} is signed in as {user} now. Ends in 12 min." Never lists the
partner's own team, staff or shoppers.

### 12.2 Starting a session

From Users or a store's Support tab (§6.3). **Step 1 · Why**: reason (required), ticket link
(optional). **Step 2 · Confirm**: "You'll act as {user} ({role}, {store}) for 30 minutes
[read-only until {owner} allows changes]. You can't change {user}'s password, 2-factor, payment
details or the store's ownership. Everyone signed in to {store} sees '{partner} support ({me})
is signed in as {user}.' Everything you do is logged as {me} as {user}, in your log and
{store}'s." Reason and ticket restated, then **your 2-factor code** (re-authentication, ACCESS
§8) → **Start session**. One session at a time: a second attempt says "You already have an
open session… You can have one session at a time." with **End it and continue**. The store's
portal opens in a **new tab** on the partner's portal host (FIRST-RELEASE admin §8's rule, same
here), with the unremovable bar: "You are signed in as {user} ({role}) · {partner} support
session by {me} · Ends in 28 min" and **End now**; at five minutes the bar turns red with a
countdown and "No extension. Start a new session if you need more time."; expiry shows "Your
30 minutes as {user} are up." with **Back to the partner console**.

### 12.3 Sessions

**Open now**: user and where, who, reason and ticket, minutes left, **Return to tab** (yours),
**End** ("The banner goes away for everyone signed in to {store}."). **History**: user and
where, who, reason, started, ended, Ended by staff · Expired. The merchant sees every session
in its own Support access log (ACCESS §8).

---

## 13. Activity log

"Everything done in this console and on your store accounts. Never what happens inside a
store." Within the partner's scope (LOGGING.md §6): its team's actions; DripFunnel staff
actions on its partner account and merchants' accounts; DripFunnel setup sessions; partner
support sessions; account events (signups, plan and status changes, payments, payouts, DNS
checks, stuck setups). **Never** anything inside a store, and never a shopper.

- **Find a person** first: a typeahead over the partner's team ("Your team · Admin") and its
  merchants' owners ("Owner of Juniper & Co."); choosing one shows "{name}'s timeline" with
  **Show everyone**. The typed text is never in the URL, only the chosen person's id.
- **Filters** as chips: Who (Your team · DripFunnel staff · DripFunnel setup · Support
  sessions · Account events), Action, Result (Success · Denied · Failed), Store, Date (Today ·
  Last 7 days · Last 30 days). All in the URL; "17 entries · newest first"; "Nothing matches.
  Try another person or remove a filter."
- Rows in plain words ("Maya extended Lumen Candle Co.'s trial to 4 Oct: customer request"),
  setup-session rows tagged "DripFunnel setup", each expandable to When · Who (with kind) ·
  Store · Before · After · Reason. **Show more**; **Export CSV**. Read-only.
- The same entries appear on each store's Activity tab (§6.3) and as **My activity** (§2.2).

---

## 14. Settings

"Your company, team, payouts and security." Four tabs.

### 14.1 Company

Read-only: legal name, address, tax id, region; **Main contact** (the Owner) and **Billing
contact** (Finance); **Contract** ("Read-only. Ask your DripFunnel partner manager to change
it."): the agreement, term, wholesale fees per plan, the "Powered by" clause, payout schedule.

### 14.2 Team

Name (with "(you)"), email, Role (a select, Owner only offered to Owners), Last sign-in
("Invitation sent" for pending), 2-factor (On · Off), **Remove**. Header: **Transfer
ownership** (Owner) and **Invite** (Owner, Admin).

| Action | Who | Needs | Consequence stated before confirming |
|---|---|---|---|
| **Invite** | Owner; Admin (not as Owner — "Admins can't invite Owners.") | Name, work email, role | "They get an email to set a password and turn on 2-factor." |
| **Change role** | Owner; Admin (not to or from Owner) | | Applies on their next request; the last Owner: "There must be at least one Owner. Transfer ownership first." |
| **Remove** | Owner; Admin (not an Owner) | Not yourself ("You can't remove yourself."), not the last Owner | "{name} is signed out now and can't sign in again. What they did stays in the activity log." |
| **Transfer ownership** | Owner | An active non-Owner; "TRANSFER" typed | "The new Owner can manage billing, payouts and the team. You become an Admin." |

Resend and Revoke on a pending invitation work as ACCESS §6.3 (a new link; the old stops).
Refusals: `LAST_OWNER`, `OWNERS_ONLY`, `CANNOT_REMOVE_SELF`, `ALREADY_ON_TEAM` (the one case
the response may name, ACCESS §6.2). An invitation never reveals whether an email has an
account elsewhere.

### 14.3 Payout and payment

**Payout account**: "Chase ending 1180 · Verified" (or Verifying · Verification failed ·
Missing), "Only the last 4 digits are ever shown. Payouts go out on the 1st of each month in
USD."; **Add / Change account** (Owner, Finance): account holder, account number or IBAN —
"DripFunnel checks it with a small test deposit. Payouts pause until it's verified (1–2
business days)." **Payment method**: "Visa ending 3009 · On file" (or Declined · Missing),
"DripFunnel charges this card for its invoices, such as priority support."; **Add / Change
card** (Owner, Finance) through a hosted payment field — **the card number never touches
DripFunnel** (THIRD-PARTY-ACCESS §2.7; the prototype's plain field is a drawing, §17). In a
staff setup session both read "Payment method and payout details stay with {partner}. {partner}
enters these itself." (ACCESS §8.2).

### 14.4 Security

One switch, **Owner only**: "Require 2-factor for everyone on the team" (decided 2026-10-01,
§3). "2-factor is off for: Alex Kim. If you require it, they'll set it up at their next
sign-in." Turning it off never removes anyone's 2-factor.

---

## 15. Not in this release

Only what the prototype does not draw:

| Part | What waits |
|---|---|
| **Announcements** (CONSOLE-DESIGN Q, README §3) | Messages and incident banners to merchants. The prototype has no such screen |
| **Partner state changes** (D) | Pause, offboard, close and the contract's renewal are Admin and contractual actions; the console shows their banners (§2.3) |
| **Promotions on plans** (G8) | Open in SAAS §14; not drawn |
| **A user's own profile and 2-factor settings** | A user who skipped 2-factor enrols when the Owner requires it (§14.4); a voluntary later enrolment and a password change from inside the console need a profile screen the prototype lacks |
| **Changing company details** (§14.1) | A request to the partner manager, by design |
| **Google sign-in** | Decided out (§3, ACCESS §2) |

---

## 16. What the Platform API needs for this release

For planning `apps/api/src/apis/platform`; names are *(proposed)*. **Every operation is scoped
to the caller's partner** from the session, never from an argument (README.md §4,
api/README.md §2.1); a partner id in a request is not authority.

| Area | Queries | Mutations |
|---|---|---|
| Sign-in (`/api/auth/*` routes, like the admin console's) | | `acceptInvitation(token, name, password)`, `signIn(email, password)`, `verifySecondFactor(code)`, `enrolSecondFactor`, `skipSecondFactor` (refused when required), `requestPasswordReset(email)`, `resetPassword(token, password)`, `signOut` |
| Header and shell | `me`, `search(query)`, `navBadges`, `partnerState` (state, contract term, grace, store limit, held payouts, declined card, broken domains: what §2.3's banners need) | |
| Onboarding | `onboarding` (checklist with status and who did each item, go-live checks, the sent-back reason, submitted when and by whom) | `runTestSignup`, `submitForApproval` |
| Dashboard | `dashboard(range)` | |
| Stores | `stores(filter, after, before)`, `store(id)` (with the per-action permission block, §6.4) | `createStore`, `changeStorePlan(id, planId, when, reason)`, `extendTrial(id, days, reason)`, `addLimitOverride(id, limit, amount, duration, reason)`, `removeLimitOverride(id, overrideId, reason)`, `suspendStore(id, reason)`, `restoreStore(id, reason)`, `resendStoreOwnerInvite(id)`, `retryProvisioningStep(id)`, `setStoreBillingStatus(id, status)` (own billing only), `exportStores(filter)` (a job) |
| Plans | `plans`, `plan(id)` (ceilings, wholesale fee, margin per currency), `planComparison`, `planPickerPreview`, `storeDefaults` (with the platform-allowed options) | `createPlan`, `updatePlan(id, …, applyTo)`, `makePlanLive(id)`, `retirePlan(id, keepOrMoveTo, date)`, `updateStoreDefaults` |
| Branding | `branding` (look, words, what the contract fixes, contrast results), `emailTemplates`, `brandingHistory` | `saveBrandingDraft`, `publishBranding(when)`, `cancelScheduledBranding(id)`, `rollbackBranding(id)`, `updateEmailTemplate`, `sendTestEmail(template)` |
| Domains | `partnerDomains`, `merchantDomains(after, before)` | `addPartnerDomain(kind, host)`, `recheckPartnerDomain(kind)`, `recheckMerchantDomain(storeId)` |
| Reports | `reportGrowth(range, plan, country)`, `reportRevenue(…)`, `reportPlans(…)`, `reportStorePerformance(…)`, `reportUsage(…)`, `reportSetupHealth(…)` | `exportReport(tab, filter)` (a job) |
| Billing | `merchantPayments(after, before)`, `payouts(after, before)`, `nextPayout`, `partnerInvoices(after, before)`, `billingSettings` | `setBillingMode(mode)`, `downloadInvoice(id)` |
| Support | `supportTargets(search, after, before)`, `supportSessions(filter, after, before)`, `mySupportSession` | `reauthenticate(code)` (a single-use proof), `startSupportSession(membershipId, reason, ticket, proof)`, `endSupportSession(id)`, `returnToSupportSession(id)` (a fresh handoff link); the merchant's Allow/Deny of write access is the Store API's (ACCESS §8) |
| Activity log | `activityLog(filter, after, before)`, `personTimeline(personRef, filter, after, before)`, `activityPeople(query)` | `exportActivity(filter)` (a job) |
| Settings | `partnerCompany`, `team(after, before)`, `payoutAccount`, `paymentMethod` | `inviteTeamMember`, `resendTeamInvite`, `revokeTeamInvite`, `changeTeamRole`, `removeTeamMember`, `transferOwnership`, `setPayoutAccount`, `setPaymentMethod(token)` (a hosted-field token, never a card number), `setSecondFactorPolicy(required)` |

**Built on #158** (the shell and onboarding rows, `apis/platform/shell.ts`, `saas/partnerConsole`):
- `partnerState` returns facts, never sentences: `state`, `sentBackReason`, `pausedAt`,
  `pauseReason`, `storeCount`, `brokenHosts` (portal or email sender hosts now `broken`) and
  `setupSession { staffName, endsAt }`. The contract term, grace, lapse and store limit
  have no model yet, nor do held payouts or a declined card (#201); their banners wait for
  them, and nothing reports a guess.
- `navBadges`: `storesAttention` (failed or stuck signups, plus merchants whose latest domain is
  failed, broken or waiting over 24 h), `brandingSetupLeft` (Branding and Legal items not
  done, until first approved) and
  `domainsWaiting` are counted. `billingFailedPayments` and `supportOpenSessions` are 0
  until #201 and #202.
- `search(query)`: two characters or more, at most 8 matches, the caller's partner only.
- `onboarding`: each item has `key`, `status`, `detail`, `doneBy` (DripFunnel or a first
  name) and `to` (its screen). A payment or payout item a staff session marked done reads as
  missing. `fixes` lists the items behind the failing go-live checks, as `{ item, to }`
  keys the console words itself. `canSubmit` is the action's permission block.
- `submitForApproval` returns `GO_LIVE_CHECK_FAILED` with `check`, `ALREADY_SUBMITTED` (Awaiting
  approval) or `ALREADY_APPROVED` (Live, Paused, Offboarding; the console adds this code). A
  role without `onboarding.submit` gets `FORBIDDEN` from the policy;
  `canSubmit.reason = OWNERS_AND_ADMINS_ONLY` is what disables the button first.
- "Priced" in the go-live checks now means a Live plan whose current version has a monthly
  price (#157's catalogue), for the admin console too.

**Built on #161** (Plans, `apis/platform/plans.ts`, `saas/partnerPlans`):
- **`plans(after, first)`**, cursor-paged, oldest first, at most 50 a page, no total; and
  **`planEditor(id)`** (not `plan(id)`; `id` null for a new plan). The editor's
  `plan` is `{ row, entitlements }`. It carries the ceilings per row, the contract's
  "Powered by" rule (`powered { allowed, note }`), the currencies the partner sells in, the
  trials, `chargedBy`, the `edit` and `price` permissions, the retire targets and the three
  first-of-month dates.
- **`quotePlanPrices(id, prices)` carries the fee and the margin**, as `Money`: a second
  currency's fee is converted at the contract rate with integer arithmetic, and a price below the
  fee is a `loss`. Where the contract states no rate for a currency, `fee` is null and the
  margin `noFee`. A new plan's fee is the lowest the partner's contract charges today, until
  DripFunnel sets one.
- `createPlan(input)`, `updatePlan(id, input, applyTo)` (`plans.price`, so Finance reaches it
  and is held to prices), `makePlanLive(id)` and `retirePlan(id, { keep } | { keep: false,
  moveTo, on })`. They refuse with the fixture's codes, plus `NOT_FOUND`, `INVALID_STATE` (not
  Draft or not Live, or editing a retired plan), `INVALID_TARGET` (not another Live plan, or not
  an offered date), `INVALID_CURRENCY` (an amount in another currency than its row, or a
  currency the contract states no fee in) and `INVALID_INPUT` (input that fails validation). Make live requires the contract's currencies. With
  no contract yet, it requires the plan's own. Retiring locks the Live plans, so two retirements
  at once never leave none.
- A role without `plans.write` gets `FORBIDDEN` from the policy. The permission blocks carry
  `OWNERS_AND_ADMINS_ONLY`.
- **Everyone at renewal** schedules each subscription on the plan for its first renewal at least
  30 days away (a past-due one too) and queues `plan-change-at-renewal` (§7.3's 30 days). A
  subscription already moving within this plan is re-pointed to the newest version and date; one
  moving to another plan (the store's own change) keeps it. Retiring with a move does the same for
  the chosen date and queues `plan-retired-move` for each store moved. Both are written in the
  change's own transaction.

**Built on #162** (Branding, `apis/platform/branding.ts`, `saas/partnerBranding`):
- `branding` returns the live look and words, or the draft while nothing is live
  (`published` says which). It also carries `affects` (stores not closed), the contrast
  report, `poweredByRule` (`choice` | `fixedOn`, from the contract), `impressumRequired`
  (the partner's country is DE, AT or CH), `dpaRequired` and the publish permission.
- `checkContrast(primary, accent)` and the publish use one function (`contrast.ts`, WCAG 2.2,
  4.5:1).
- `publishBranding(input)` refuses with the fixture's codes: `INVALID_INPUT` carries `field`,
  and `CONTRAST_FAILS` carries `fix`. A role without `branding.write` gets `FORBIDDEN` from the
  policy.
- A publish adds a version with who and when. It keeps the partner row's look and "Powered by"
  equal to it (`0017`), marks Branding (and Legal pages, once terms, privacy, the DPA and any
  required Impressum are there) and queues the portal cache purge.
- **Files are R2 keys under the partner's prefix**; a key under another prefix, or a URL, is
  `INVALID_INPUT`. **The upload, built on #219**: `POST /api/uploads/brand-file?kind=logoLight|
  logoDark|mark|favicon` with the file as the body. The session (`UNAUTHENTICATED`) and
  `branding.write` (`FORBIDDEN`) are checked before the kind, the bucket or the body; then
  SVG, PNG or WebP by its bytes, at most 512 KB, an SVG that could run script or load anything
  refused (`UNSAFE_SVG`); it answers the key `partners/<partner>/brand/<uuid>.<ext>` and logs
  `branding.file_uploaded`. `NOT_CONNECTED` until the environment's assets bucket is bound
  (THIRD-PARTY-ACCESS §2.1). The file is written inside the log entry's transaction, so a
  failed write logs nothing; a commit that fails after the write leaves an unlogged object
  that no branding names, and nothing sweeps those yet.
- This card ships the publish-now path only. `saveBrandingDraft`, `publishBranding(when)`
  (scheduling), `cancelScheduledBranding`, `rollbackBranding`, the history and the email
  templates are §8.3–§8.4's.

**Built on #159** (Stores, `apis/platform/stores.ts`, `saas/partnerStores`):
- `stores(filter, after, before, first)`: newest first, cursor-paged both ways, at most 25 a
  page, no total.
  Filters: status (`pastdue` spelt as the console spells it; `cancelled` takes closed stores
  too), plan, created window, storefront, near a limit (80%+ of any limit), search. A filter or cursor it can't read is `INVALID_INPUT`. The page carries
  `plans`, `billingMode`, and the export and billing-status permissions.
- `store(id)` returns `{ row, … }` with the tabs from today's rows: account, contacts, usage,
  overrides, billing (subscription, next charge, card's last four, the billing mode and the partner's name, from
  which the console words who charges), site links,
  DNS records, setup, trial extensions, support (consent and people) and the account's
  activity. Usage is measured once for both the list and the detail: against the plan version
  the store bought plus every active override, a monthly meter counting only this month. An id
  that isn't one finds nothing. Overrides, trial extensions and activity show their newest 25,
  people their first 100, and `more` says which tab has further rows. **Sales, invoices and past support sessions arrive with #163, #201 and #202.**
- `actions` is the §6.4 block, following the prototype. An action the state does not offer is
  absent. One whose ACCESS §5.3 permission the role lacks is refused: `FINANCE_TRIAL_ONLY` on Extend trial,
  `OWNERS_AND_ADMINS_ONLY` on the rest. The record refusals (`ALREADY_SUSPENDED`, …) are the
  mutations' (#160).
- `setStoreBillingStatus(id, status)`: `stores.billingStatus` (else `BILLING_ROLES_ONLY`). It refuses `NOT_SELF_BILLING`
  while DripFunnel bills, `CANCELLED` on a cancelled store, and `NOT_FOUND` and
  `INVALID_INPUT`. It is logged once.
- No type in the Platform API names an order, a customer or a product (a schema test).

**Built on #221** (create and export, `apis/platform/storeCreate.ts`, `saas/partnerStores/create.ts`, `export.ts`):
- `createStoreForm`: the permission (the role, then the partner's state: `OWNERS_AND_ADMINS_ONLY`,
  `PARTNER_PAUSED`, `PARTNER_NOT_LIVE`), the countries (code, name, currency) whose currency a
  Live plan is priced in (`core/countries.ts`), each Live plan with its trial days and monthly
  prices, the trials 0, 7, 14 and 30, and `billingMode`, from which the console words who
  charges. The Stores page carries the same `createPermission`.
- `createStore(input)` (`stores.create`): name, owner's name and email, country by **code**, plan,
  trial. It creates, under one lock per partner, the store (its code from the name, `-2`… when
  taken), the Owner (the person the email already is under the partner, or a new invited one)
  with an invited Owner membership, the subscription in Trial (or Active with no trial) at the
  plan's current version and its own monthly price in the country's currency, the setup job, and
  the Owner's invitation, emailed through the outbox; logged as `store.created`. A plan or
  country that doesn't fit is `INVALID_INPUT` with its `field`. **No store limit and no
  read-only state exist yet** (§18), so `STORE_LIMIT_REACHED` and `READ_ONLY` are never answered.
  0026 grants each insert by column and holds it by a policy: an invited Owner only, the store's
  first job only, the plan's own price only.
- `provisioning(storeId)`: SAAS §5's steps as the screen's five. Account, store and portal are
  done in the creating transaction (their work today is those rows); the storefront **waits**
  for its runner (decided on #159) unless the store runs its own, and `done` says the account is
  ready.
- `exportStores(filter)` (`exports`, every role) queues an `export_job` of kind `stores` with the
  list's filter, logged as `stores.exported`; `storesExport(id)` answers it with the account
  columns only (store, code, owner, plan, status, storefront, domain, country, created), up to
  10,000 rows with a line saying when cut, readable for an hour.

**Built on #160** (store actions, `apis/platform/storeActions.ts`, `saas/partnerStores/actions.ts`):
- Every mutation locks the store and asks the same `actionsFor` as `store(id)`'s block. A role
  without the action's permission is `FORBIDDEN` (the block names the code). An action the
  state doesn't offer is refused: `NOT_ON_TRIAL`, `ALREADY_SUSPENDED`, `NOT_SUSPENDED`,
  `CANCELLED`, or `NOT_STUCK` for Retry. Another partner's store, or an id that isn't one, is
  `NOT_FOUND`. Every write logs one entry, with the reason, in its transaction.
- `changePlanOptions(storeId)` (`stores.plan`): the Live plans priced in the subscription's
  currency and interval, or monthly in USD before billing subscribes the store (SAAS §6.1);
  unpriced plans are left out, each with the API's proration for
  moving now (`charge` and `credit` with an amount, or `none`; nothing on trial), and
  `nextBillingAt`. `changeStorePlan(id, planId, when, reason)` moves the subscription to the
  plan's current version now and records the proration for billing (#201), or schedules the
  move for the next billing date. `PLAN_NOT_LIVE`, `SAME_PLAN`, `UNPRICED_CURRENCY`, and
  `NO_BILLING_DATE` for "next" on a store billing has not subscribed yet. The
  merchant's email goes through the outbox.
- `extendTrial(id, days, reason)`: 3, 7 or 14 days from the later of the trial's end and now.
  A plan change scheduled for the trial's end moves with it.
- `addLimitOverride` and `removeLimitOverride(id, overrideId, reason)`: `stores.plan`, since
  ACCESS §5.3 has no permission of its own for overrides. A month override is for the
  current UTC month.
- `suspendStore(id, reason)`: the reason is shown to the merchant, so it is trimmed, 1–500
  characters, with no control characters or angle brackets. It queues the "Store suspended"
  email and the storefront purge. Billing reads the suspended status and charges nothing until
  the store is restored (#201). `restoreStore` puts back the status the store had.
- `resendStoreOwnerInvite(id)` revokes the open owner invitation and sends a new one.
  `retryProvisioningStep(id)` restarts the latest job's current step and queues
  `provisioning.retry` keyed by the attempt. The job is checked again once it is locked, so a
  step that finished meanwhile, or a second call, is refused.
- No `READ_ONLY`: a closed partner has no session (ACCESS.md §4), and the contract's lapse is
  not stored yet; that code arrives with the contract term (§2.3).

**Built on #163** (Dashboard, `apis/platform/dashboard.ts`, `saas/partnerDashboard`):
- `dashboard(range)` (`partner.read`) for `month`, `last` and `q` returns the §5 cards. The
  windows are: this month so far against all of last month; last month against the month
  before; the last 90 days against the 90 before. Each card is one SQL count or sum over the
  partner's rows. Revenue is what was charged (DATA-MODEL §7.9), in the contract's payout currency
  (USD without a contract). Every amount on the Platform API is the one `Money` type, whose `amount` is the `MinorUnits`
  scalar: whole minor units past GraphQL's 32-bit `Int`, refused if not exact. `asOf` and `staleSince` come from the sync job's
  `partner_billing_feed`, and `fresh` is a Live partner with no store and no charge.
- **Comparisons are English sentences composed by the API**, as §5 requires ("94% of August so
  far, with 2 days to go", "+4% vs July", "+15% vs the 90 days before"; "up from 29% last
  month"). Conversion is the share of trials that ended in the range and became paid, `null`
  when none ended.
- Each store count matches the Stores list under the filter its link applies: status,
  `created=month` (also Signups started), and `near=yes`.
- Needs attention lists past-due stores, stuck setup (the console's step names), a domain
  waiting for DNS for more than a day, and trials ending within 3 days, at most 10 rows. Retry
  and Extend take their verdicts from `store(id)`'s block. Open billing and Re-check are
  allowed for every role.
- Top stores are the five with the highest `store_sales_month` totals for last month, ranked in
  the payout currency and shown in each store's own. Refunds subtract from revenue, and only a
  store's latest domain is checked.

**Built on #197** (Domains, `apis/platform/domains.ts`, `saas/partnerDomains`):
- `partnerDomains` (`partner.read`): the four kinds, each with `added`, host, status, since,
  checked and its records (purpose, type, name, value to add, what DNS returned, `matches`);
  `fallbackSender` (`no-reply@{label}.dripfunnel-mail.com`) while the email sender isn't live;
  `add.allowed` for `domains.write` while fewer than four exist.
- `addPartnerDomain(kind, host)` (`domains.write`; ACCESS §5.3's `domains.manage` is this
  permission). The refusals are `NOT_A_HOSTNAME`, `DRIPFUNNEL_DOMAIN`, `ALREADY_YOURS`,
  `HOST_TAKEN` (another partner's, without saying whose), `BARE_DOMAIN_FOR_WILDCARD` (a
  wildcard or the email sender on a bare domain), `KIND_TAKEN` and `INVALID_INPUT`. A root
  portal domain is refused with `APEX_NOT_AVAILABLE` until SAAS §8's apex question gives us an
  address to publish; then it gets an A record and `apex: true` for the warning. A wildcard's
  `*.` is added by the API. Each address also gets an ownership TXT with its own token, so a
  claim on someone else's host waits and fails rather than blocking them; `HOST_TAKEN` means the
  host is verified by another partner. The address is created waiting, its first check is
  queued, and it's logged.
- `recheckPartnerDomain(kind)` and `recheckMerchantDomain(storeId)` (`domains.recheck`, every
  role) queue the existing deliverers: `TOO_SOON` within a minute of the last check, and a
  press that folds into one already queued is not logged again. `merchantDomains(after, before,
  first)` pages the partner's stores' domains, 25 at most, no total.
- Waiting and failed addresses are re-checked every 10 minutes, and "We'll email you when it's live" is
  `partner-domain-live` queued in the outbox; it's delivered once SES's `email` deliverer is
  wired, as every email effect is.

**Built on #198** (Activity log, `apis/platform/activity.ts`, `saas/partnerActivity`):
- `activityLog(filter, after, before, first)` (`partner.read`): the §13 chips are `who` (team,
  staff, setup, support, events), `action`, `result`, `storeId` and `date` (today, 7d, 30d).
  What a partner may read is the log's own policy (LOGGING §6): entries with `partner`
  visibility in its partner, never one inside a store or a shopper's. Each entry is the code
  and its facts (actor, through a setup or support session, store, target, changes, reason),
  which the console words per locale (LOGGING §7). The store's Activity tab is `storeId`, and
  My activity is `personTimeline` with the caller.
- `personTimeline(person, filter, …)`: `person` is `team:{id}` or `owner:{id}`, a team member
  or one of the partner's merchants' Owners; anyone else is `INVALID_INPUT`.
  `activityPeople(query)`: at least 2 characters, at most 8 matches, the team and merchants'
  Owners only, with no email in the answer.
- `exportActivity(filter)` (`activity.export`: Owner and Admin, ACCESS §5.3) queues an
  `export_job` and logs `activity.exported`. `activityExport(id)` answers queued, done (with the
  CSV, its row count and `truncated` past 10,000), failed, or expired an hour later, to Owners
  and Admins only (anyone else gets null). An Owner of several stores is one person in the search.

**Built on #199** (Settings, `apis/platform/settings.ts`, `saas/partnerTeam`):
- `partnerCompany` (`partner.read`): name, country, region, kind, the main contact
  and billing contact (an active Owner and an active Finance user), the contract (fee currency, the "Powered by"
  clause, the fee per plan as `Money`, at most 50 with `moreFees` past that) and
  `secondFactorRequired`. The legal address and tax id
  aren't stored yet; they arrive with the company-details request (§15).
- `team(after, before, first)`: everyone not removed, with role, `you`, last sign-in, the open
  invitation (sent, expired) and 2-factor on or off; cursor-paged, 25 at most.
- `inviteTeamMember`, `resendTeamInvite`, `revokeTeamInvite`, `changeTeamRole`,
  `removeTeamMember` (`team.manage`) and `transferOwnership` (`team.transfer`, Owner): every team
  change takes the partner's team lock, so the last active Owner survives concurrent requests
  (`LAST_OWNER`). An Admin never invites, changes or removes an Owner (`OWNERS_ONLY`); nobody
  removes themselves (`CANNOT_REMOVE_SELF`). The caller's own role is read again under the lock,
  so a demotion made meanwhile counts (`NOT_ACTIVE` if they were removed). `ALREADY_ON_TEAM` names only this team's own
  member. Accounts are per partner (ACCESS §2), so an address with an account under another
  partner gets a new account here, answered identically; a fourth partner account for an
  address (0011's limit) is answered identically too and creates nothing. Removal sets
  `removed`, revokes an open invitation and ends the person's sessions at once (0022's
  `end_partner_user_sessions`); re-inviting a removed address invites the same account again.
  The invitation email (`partner-team-invitation`) goes through the outbox, throttled to 20 an
  hour per inviter and 3 a day per address (`RATE_LIMITED`, ACCESS §6.3); accepting it is #208's.
- `setSecondFactorPolicy(required)` (`security.manage`, Owner) sets
  `partner.second_factor_required` under the team lock, on the caller's role as it is now, which
  sign-in already reads; turning it off removes nobody's
  2-factor.

**Built on #200** (Reports, `apis/platform/reports.ts`, `saas/partnerReports`, `db/scoped/reports.ts`):
- `reportGrowth`, `reportRevenue`, `reportPlans`, `reportStorePerformance`, `reportUsage` and
  `reportSetupHealth` (`partner.read`), each with `range` (`6m`, `3m`: the months up to this one),
  `plan` and `country`. Each returns its table rows, the bar series and the summary sentence,
  composed by the API from its own figures; `fresh` and "Reports fill in as your first
  merchants sign up." for a partner with nothing yet. Money is integer minor units with its
  currency (revenue and MRR in the contract's payout currency, other currencies converted at the
  contract rate, minding each currency's minor digits, and marked approximate); percentages are basis points.
- The figures: Growth counts stores created, setups finished, trials ended and converted,
  cancellations and stores at month end; Revenue sums `merchant_charge` per month (refunds
  subtract) with failed and recovered payments and MRR by plan from active subscriptions; Plans
  counts open stores per plan and this month's plan changes from the log's `store.plan_changed`
  entries (up or down by monthly price in a currency both plans share; a first plan isn't a
  change); Store performance reads `store_sales_month` (up to 50 stores, `truncated` past that;
  the declining count, every store more than 3% down including one that sold nothing, is counted
  in SQL; `changeBps` is a whole number past 32 bits, so a Float); Usage reuses the near-limit measure and this month's
  meters; Setup health is the median time to a ready store over 30 days, failed setups, and
  the stores stuck or waiting for DNS over a day.
- Only account-level tables are read (LOGGING §6); a structural test checks every report
  field's scope and every table `db/scoped/reports.ts` names.
- `exportReport(tab, filter)` (`exports`, every role) queues an `export_job` of kind `report`,
  logged as `report.exported`; `reportExport(id)` answers it, never an activity export (and the
  activity read-back never a report). The CSV has fixed columns per tab, so an empty report still
  has its header; a list cut at 50 rows ends with a line saying so, and the job reports `truncated`.
- Report lists are capped at 50 rows rather than cursor-paged (each is a top-N view, not a
  browsable list): Store performance, its Declining list (its own query, biggest fall first), Usage
  and Setup health each say `truncated` when cut.

**Pagination is cursor-based**, as ui/admin/FIRST-RELEASE.md §12 decided on #19: every list
takes `after` and `before`, a maximum page size, and returns **no total count**. The prototype
renders lists as **"Show 25 more"** (`after` only) and that is what this console builds; the
`before` cursor exists so a screen can add Previous later without an API change.

Every mutation checks the partner role on the server (ACCESS.md §5.3 names the permissions),
requires a reason where §6.4 and §14.2 say so, refuses with the stable codes listed above, and
writes an activity entry in the same transaction (LOGGING.md §5). `FORBIDDEN` for a signed-in
user without the permission, `UNAUTHENTICATED` for no session, as #14 decided for the admin
console. **Exports are jobs** that survive leaving the page, like the admin console's (#44).

**Build order** (not scope): the Platform API cards for sign-in, onboarding, stores, plans,
branding, domains, activity and settings can follow #14, #15 and #32 directly. Billing needs
Stripe Connect (THIRD-PARTY-ACCESS §2.7); Support needs the Store API's support caller and the
handoff (ACCESS §8, api/README §2.1 *(decide)*); own-mode billing follows DripFunnel-bills
(SAAS §7.1). Their screens are built on fixtures first, like every other screen.

---

## 17. Prototype differences

Where `designs/DF Platform Prototype.dc.html` and this document disagree. **Rule** differences:
the document wins, because the rule was decided in a document that outranks a prototype
(docs/README.md §3). **Behaviour** differences: decided with the user on 2026-10-01 (on #109)
and recorded here, so a builder does not have to pick. Scope: nothing is cut; §15 lists only
what is not drawn.

| The prototype | This release | Kind |
|---|---|---|
| Support sessions are full access as the user ("Impersonate"; "Changes you save are logged as Priya as Jenna") | **Read-only, with write access only after the merchant allows it for that session** (ACCESS §8, USERS-AND-DOMAINS §4.1). The flow, the banner and the blocked list are kept (§12) | rule |
| The payment-method dialog takes a raw card number | A **hosted payment field**; the card number never touches DripFunnel (§14.3; THIRD-PARTY-ACCESS §2.7) | rule |
| No environment marker | A marker on non-production hosts only (§2.3) | behaviour, decided |
| Everyone sets up an authenticator app when accepting an invitation; the Owner's Security switch also exists | 2-factor optional, offered at acceptance; required at acceptance and at the next sign-in when the Owner's switch is on (§3, §14.4) | behaviour, decided |
| Retrying a stuck setup step is a partner action | Kept — **decided 2026-10-01**, settling CONSOLE-DESIGN K's *(ask)*: Owner and Admin may retry (§6.3, §6.4) | behaviour, decided |
| Lists end in "Show 25 more" | Kept; the API contract is cursor-based with `after` and `before`, and this console uses `after` (§16) | behaviour, decided |
| Contract-ending, grace, lapsed and store-limit banners | Kept; SAAS.md has no contract term, grace period or store limit yet (§18) | open in SAAS |
| The Dashboard's "Retry setup" uses the create-store permission | A permission of its own, `setup.retry`, held by the same roles (ACCESS §5.3) | naming only |

---

## 18. Open questions

- **The partner's contract in the data model**: term and end date, renewal, the 14-day grace
  period, read-only after lapse, the store limit — the banners in §2.3 need them and SAAS.md §3
  has none of them *(decide; SAAS §14)*.
- How a Draft partner's portal host accepts the checklist's **test merchant signup** while
  SAAS.md §3.1 says the host serves a "not open yet" page (§4 item 10) *(decide)*.
- How long an old portal host keeps redirecting after a change (§9.2; SAAS.md §3.5 *(ask)*).
- How the support-session handoff reaches the merchant's portal host (api/README.md §2.1
  *(decide)*), and who in the store may allow write elevation (ACCESS §8 *(confirm)*).
- When the partner bills its merchants itself, how the platform learns a store's status
  (§11.4; SAAS §14).
