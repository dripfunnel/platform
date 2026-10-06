# CLAUDE-DESIGN-PROMPT.md: design the partner console

The prompt to paste into a **Claude Design** session to design the partner console
(`apps/ui/platform`, `platform.dripfunnel.com`). It is self-contained: the design session
doesn't read this repo. Its sources are [FIRST-RELEASE.md](FIRST-RELEASE.md) (what the first
release contains, screen by screen), [README.md](README.md),
[../../USERS-AND-DOMAINS.md](../../USERS-AND-DOMAINS.md), [../../api/SAAS.md](../../api/SAAS.md)
and [../../api/ACCESS.md](../../api/ACCESS.md) §5.3; where they disagree with this prompt, they
win and this prompt should be updated. The clickable prototype,
`designs/DF Platform Prototype.dc.html`, decides behaviour; §12 below lists the places where
the documents overrule it, and the two behaviours kept exactly as it draws them.

Refreshed 2026-10-02 on #123 after the decisions taken on #109: the five roles and their
permissions, 2-factor optional with an Owner switch, the ten menu rows, support sessions
read-only with merchant-allowed writes, the hosted payment field, the environment marker on
non-production hosts only.

Paste everything below the line.

Last updated: 2026-10-02.

---

You are designing the **DripFunnel partner console**: the web app a **partner** uses to run
its own white-label commerce business on DripFunnel. Produce a **clickable, high-fidelity
prototype** with realistic sample data. A first prototype exists and this brief restates what
it draws; where the brief corrects it (§12), the brief wins.

## 1. The business in one paragraph

DripFunnel is a commerce platform that other companies resell under their own name. A
**partner** (an agency, reseller, payments company or marketplace operator) is invited by
DripFunnel, sets up its **own branded store platform**, and sells it to **merchants**. Each
merchant gets a **store**: they sign in to the partner's **merchant portal** (at the partner's
own address, e.g. `store.northstar.com`, in the partner's logo, colours and name) and build
their online shop there. The partner's merchants may never see the word "DripFunnel" unless
the partner's contract keeps a "Powered by" line. The partner decides the look of that
portal, the plans and prices merchants can buy, and it looks after its merchants' accounts.
**DripFunnel collects the merchants' subscription payments on the partner's behalf and pays
the partner out every month**, keeping its wholesale fee; a partner may instead bill its
merchants itself.

This console is the partner's control room. It is **DripFunnel-branded** (it's our product
for our customers, the partners) and is used by partner staff only.

## 2. What the partner can and can't do

**Can**, for its own merchants only:
- white-label the merchant portal: its look, words, addresses and emails;
- create plans, prices and limits merchants buy, within DripFunnel's maximums;
- see and manage its merchants' **accounts**: create a store, plan, trial, limit overrides,
  billing status, domains, setup and publishing status, usage; suspend and restore; retry a
  stuck setup step;
- see each store's **monthly sales and order totals** in reports;
- open a merchant's portal **read-only for support**, if the merchant allows it, and ask the
  merchant to allow changes for that one session;
- see its money: merchant payments, payouts, DripFunnel's invoices;
- run its team and its own activity log.

**Can't, and the design must never suggest it can**:
- see a merchant's individual orders, customers or products, or export them;
- change anything inside a merchant's store, or design a merchant's online shop;
- change a merchant user's password, 2-factor, payment details or the store's ownership, even
  in a support session;
- see anything of another partner, or learn that a person also has a store elsewhere;
- sign up: partners are invite only, and so is every member of a partner's team.

## 3. Who uses it

The partner's own team: founders, account managers, support, finance. They are commercially
minded, not engineers. The standard is **Shopify Partners' structure with Stripe
Dashboard's clarity**: every number explained, every merchant one click away, money always
with its currency and who charges it.

Five fixed roles (decided 2026-10-01). Show the signed-in role in the header. **A menu row a
role can't use is absent; inside a screen, a control a role can't use stays visible but
disabled, with the reason and who can** ("Your role (Finance) can't suspend stores. Owners and
Admins can."). The server decides every permission; the screen only shows the answer.

| Area | Owner | Admin | Support | Finance | Read-only |
|---|:--:|:--:|:--:|:--:|:--:|
| Dashboard and Reports | ✓ | ✓ | ✓ | ✓ | ✓ |
| Onboarding checklist, submit for approval | ✓ | ✓ | view | view | view |
| Branding: look, words, emails, publish, schedule, roll back | ✓ | ✓ | view | view | view |
| Domains: add or change an address (everyone may re-check) | ✓ | ✓ | view | view | view |
| Plans and defaults for new stores | ✓ | ✓ | view | prices only | view |
| Stores: view, export the accounts list | ✓ | ✓ | ✓ | ✓ | ✓ |
| Stores: create, change plan, limit overrides, suspend, restore, resend invitation, retry a setup step | ✓ | ✓ | | | |
| Stores: extend trial; billing status when the partner bills itself | ✓ | ✓ | | ✓ | |
| Support sessions (read-only; ask the merchant for write access) | ✓ | ✓ | ✓ | | |
| Billing: merchant payments, payouts, DripFunnel's invoices (the Billing menu is absent for Support) | ✓ | view | | ✓ | view |
| Billing settings, payout account, payment method | ✓ | | | ✓ | |
| Team: invite, change role, remove | ✓ | not Owners | | | |
| Transfer ownership; require 2-factor for the team | ✓ | | | | |
| Activity log | ✓ | ✓ | ✓ | ✓ | ✓ |

The Support menu is absent for Finance and Read-only; the Billing menu is absent for Support.

## 4. Look and feel

- **DripFunnel-branded**, clean and commercial, in the DripFunnel style guide's look: orange
  `#EC844F` actions with a `#4A1B0C` label, navy `#0A2A4A` headings and side bar, text
  `#14181F` on `#FDFAF7`, Manrope headings and Inter text, IBM Plex Mono for small labels,
  8 px buttons and fields, 12 px cards, 16 px dialogs. Design **light and dark**.
- **Desktop first** (1440 px), a narrow-laptop layout (1100 px, where the side bar becomes a
  64 px icon rail), and a phone layout (375 px) where the side bar is a drawer behind a menu
  button, the search collapses to an icon and a partner can still find a store and see its
  status.
- Left side bar, top header, lists and detail pages, charts only where a trend matters.
- **Status is word + colour + icon**, never colour alone. WCAG 2.2 AA; every control reachable
  by keyboard, focus visible, reduced motion respected.
- **Money always with its currency and who charges it** ("$49.00 / month, charged by
  DripFunnel for Northstar"; "billed by Northstar" when the partner bills itself). Dates with
  the time zone. Plain words, sentence case.
- **The partner's own brand appears only inside preview frames** (Branding's portal preview,
  the email preview, the plan-picker preview), clearly framed as "In your brand. The console
  itself doesn't change." Never restyle the console.
- **Lists end in "Show 25 more"**, never page numbers or a total that is not known.

## 5. The shell

- **Header**: the DripFunnel mark and the small label "Partners"; the partner's name and
  initials as "Signed in for"; a search box (⌘K) over its stores by name, code, domain or
  owner email, with results showing owner email, domain and status; a Help link; the
  signed-in user's name and role with a menu holding Appearance (System · Light · Dark), **My
  activity** (their own timeline) and **Sign out**.
- **Side bar**, ten rows in this order, with a badge only for work waiting and a spoken label
  for every badge ("2 need attention"). Under the rows: "Your merchants see **{product}**. This
  console is only for your team."

| # | Menu | For | Badge |
|---|---|---|---|
| 1 | Dashboard (the setup checklist until Live) | Everyone | |
| 2 | Stores | Everyone | failed or stuck setups + merchants' domains stuck |
| 3 | Plans | Everyone | |
| 4 | Branding | Everyone | setup items left, until Live |
| 5 | Domains | Everyone | records waiting for DNS + merchants' domains stuck |
| 6 | Reports | Everyone | |
| 7 | Billing | Owner, Admin, Finance, Read-only (absent for Support) | failed merchant payments |
| 8 | Support | Owner, Admin, Support (absent for Finance and Read-only) | sessions open now |
| 9 | Activity log | Everyone | |
| 10 | Settings | Everyone; actions by role | |

- **Strips under the header**, full width, in this order when several apply: the partner's
  state while not Live (Draft → "Open checklist"; Awaiting approval → "What happens next";
  Sent back → "See what to fix"); the setup-session bar a DripFunnel staff member sees
  ("Setting up Northstar · 1 h 12 min left" with End) and the notice the partner's team sees
  meanwhile ("DripFunnel is setting up your console: Priya, until 16:30" → See their changes);
  Paused, Offboarding and Closed; contract ending, in grace, lapsed; store limit reached;
  payout account failed; payment method declined; domains stopped working; offline; stale
  ("Some numbers are from 17:12. Stripe and GitHub are slow to answer."). Read-only states
  (Closed, lapsed, offline) disable every save with the strip's reason; nothing is hidden.
- **Environment marker**: nothing in production. On development, feature and local hosts a
  grey strip names the environment ("DEV · Test data. Nothing here reaches real merchants").
- **Dialogs the shell owns**: session expired ("You were signed out after 12 hours to keep
  the console safe. Sign in again and you'll come back to this page."), load error (plain
  words, Try again, the request id behind a click), save conflict ("Someone else changed this
  a moment ago, so we didn't overwrite it."), not found ("This link doesn't work anymore.").

## 6. Screens to design

### 6.1 Accept invitation and sign in

There is **no sign-up** and no Google button anywhere: DripFunnel creates the partner and
emails its Owner an invitation; the Owner or an Admin invites the rest of the team.

- **Accept invitation** ("Join {partner}"): the partner, the role, the invited email ("The
  email can't be changed") and who invited them; your name; a password of at least 10
  characters. Then **2-factor, step 2 of 2**: a QR code and a text key for an authenticator
  app, then the 6-digit code — **required when the partner's Owner has turned on "Require
  2-factor for everyone on the team"**, otherwise offered with "Skip for now". Link states:
  expired ("Invitation links work for 7 days. Ask whoever invited you to send a new one."),
  already used, replaced by a newer one — each with "Go to sign in" and nothing more.
- **Sign in**: work email and password ("For partner teams. Merchants sign in at their
  partner's portal."), then the 2-factor code when the user has one, with "Use a different
  account". Below the form: "New to the console? Use the link in your invitation email."
  States: wrong email or password (**one message, same timing**: never reveal whether an email
  has an account), wrong code ("That code isn't right. 3 tries left."), expired code, **locked
  after five wrong codes** ("…signing in is paused for 15 minutes. We've emailed you about
  it."), session expired. **Forgot password** → "If there's an account for {email}, we've sent
  a link to reset the password. It works for 30 minutes." — identical whether or not the email
  exists.
- When the Owner turns the 2-factor requirement on, every user without it enrols at their
  next sign-in before reaching the console.

### 6.2 Onboarding: the Dashboard until Live

While the partner is **Draft**, **Awaiting approval** or **Sent back**, the Dashboard is "Set
up {product}" with "You can leave and come back; your progress is saved."

- **The checklist**, ten items plus Submit ("4 of 11 done" and a progress bar), each Done · In
  progress · To do with one line of detail, a link to its screen, and when done, who did it:
  company details → branding → portal address → preview and shop addresses → email sender → at
  least one priced plan → legal pages → payment method → payout details.
  Payment method and payout details are **the partner's own**: in a staff setup session they read
  "{partner} enters this itself" with a lock; to the Owner "Your turn"; to any other role "Owner
  adds this". They are not go-live checks: Submit says "Payment method and payout details can come
  later."
- **Who completed it**: items done in a staff setup session say "Done by DripFunnel"; the
  Owner's first sign-in after staff set things up shows a welcome card ("DripFunnel has set up
  most of {product} for you. Check what's done and finish the rest.").
- **Submit for approval** (Owner, Admin) runs the go-live checks first (portal host live,
  email domain verified or the fallback sender accepted, a priced plan, legal pages, a test
  signup). Disabled with "Finish the N items above first" until they pass. Confirmation:
  "DripFunnel reviews your contract, KYC and setup. That usually takes 2 business days. You can
  keep editing, but merchants can't sign up until you're approved."
- **Awaiting approval**: "Submitted on {date}"; **What happens next** in three steps (Contract
  and KYC check → Setup review → Decision, "Usually within 2 business days"). **Sent back**:
  DripFunnel's reason verbatim, the fix as a link (e.g. "Add an Impressum to your legal
  pages"), the checklist reopened, **Submit again**. **Live**: a one-time card — "{product} is
  live at {host}. New signups there become your stores. Share your sign-up link:
  {host}/signup" — then the Dashboard of §6.3.
- Until Live, the screens that need merchants (Stores, Reports, Support, Billing's payments
  and payouts) say "{Stores} appear once {product} is live" with a link to the checklist.

### 6.3 Dashboard (once Live)

Every number links to the list it counts, already filtered. A **date range** (This month ·
Last month · Last 90 days) applies to every card and lives in the URL. Comparisons are plain
words ("94% of August so far, with 2 days to go", "+4% vs July").

| Card | Shows |
|---|---|
| Stores | Active, On trial, Past due, Suspended, each a link; "N in total"; "N new this month" |
| Revenue | Merchant subscriptions collected, DripFunnel's fee, your payout so far, comparison, next payout date; "Collected by DripFunnel for {partner}. CAD is converted at the payout rate." |
| Needs attention | Past due (days) → Open billing; Setup stuck ("Storefront building for 43 min") → Retry setup; Domain stuck ("waiting for DNS for 2 days") → Re-check; Trial ending → Extend trial; "Nothing needs you right now." when empty |
| Signups | Started and completed in the range; "34% of trials became paid stores · up from 29% last month" |
| Usage | "N near a limit"; the four closest with a bar ("4,210 of 5,000 products"); "No store is at 80% of a limit." |
| Top stores by sales | Top five last month, totals only, in each store's currency, with plan; "No sales yet."; a link to Reports › Store performance |

Each action button carries its own permission (Retry setup: Owner, Admin; Extend trial:
Owner, Admin, Finance). A brand-new Live partner sees zeros with "Your first payments arrive
when merchants pay" and the Stores empty state "Create your first store, or share your sign-up
link: {host}/signup".

### 6.4 Stores (the partner's merchants)

"Your merchants' store accounts. Their orders, customers and products stay theirs."

**List**: Store (name, code), Owner (name, email), Plan ("80% of products" under it when
near a limit), Status, Sales last month (total, in the store's currency), Storefront (Live ·
Building · Failed · Own storefront), Domain (a link, "Waiting for DNS" under it), Created, and
**Billing status only when the partner bills its merchants itself** (Active · Past due ·
Suspended, set inline by Owner, Admin, Finance). Filters: Status, Plan, Created, Storefront,
Near a limit (80%+). Search by name, code, domain, owner email. All in the URL as removable
chips with "Clear all"; "12 of 86 stores"; "No stores match". Newest first, "Show 25 more". On
a phone, cards. Header buttons: **Export accounts (CSV)** ("Orders, customers and products are
never included.") and **Create store** (Owner, Admin).

**Statuses**, unmistakable from each other: **Trial** (days left; "Ends tomorrow") ·
**Active** · **Past due** ("9 days · changes blocked, still selling") · **Suspended** (the first
sentence of the reason) · **Cancelled** ("Since 2 Sep").

**Create store**: "For a merchant you've signed yourself. Merchants can also sign up at
{host}/signup." Store name, owner's name and email, country (the partner's countries), plan
(Live plans with the monthly price in that currency), trial (No trial · 7 · 14 · 30 days); a
price line ("$49.00 / month, charged by DripFunnel for Northstar, after a 14-day trial." — the trial length is the plan's, SAAS.md §6.1);
"The owner gets an invitation to set their own password." Then **Setting up {store}** with
five steps (Account · Store · Portal ready · Storefront building · Done), "This takes under
two minutes. You can leave this page.", and "Ready in 1 min 42 s." → Open the store · Create
another. Refused with the reason when the partner is not Live, Paused, Offboarding, at its
store limit, or when the role can't.

**Store detail**: header with initials, "Store · {product}", name, status, code, live link
and **Actions ▾**. A suspended store shows "Suspended on {date}: {reason}"; a past-due one
"Past due for 9 days. {owner}'s team can't make changes, but the shop is still selling. We
retry the card on {date}." Tabs:

| Tab | Contents |
|---|---|
| Overview | "You see this store's account. Its orders, customers and products are the merchant's; open a support session to view them." Account (owner, country, created, plan and price with who charges, people and suppliers count, sales last month and orders as totals), Contacts (the merchant-side users), Plan and status history (before → after, who) |
| Plan and limits | The plan and price with Change plan; usage bars (products, staff seats, suppliers, AI design prompts, "Publish now" presses) with "Near the limit" at 80% and "At the limit" at 100%; Overrides for this store (what, reason, who, when) and Add override |
| Billing | Subscription, price, next charge ("First charge 11 Oct, when the trial ends"), payment status (Paid · Failed · No card yet), card ending 4417, "Charged by DripFunnel for Northstar" or "You bill this merchant yourself"; Invoices; a Billing status select when the partner bills itself |
| Storefront | Live · Building · Failed · Own storefront; live and preview links; last publish; "Read-only. The merchant designs and publishes their shop." |
| Domains | The custom domain, status, "Waiting since {date}", the CNAME record with Copy and what we found, Re-check now |
| Setup | The five signup steps with Done · Working · "Taking longer than usual" · Failed · Waiting, and **Retry this step** (Owner, Admin) |
| Support | "{store} allows {partner} support to sign in as its users." or "{owner} has turned partner support off for {store}."; the people in the store (name, email, role, status, last sign-in) with Open support session or Return to session; past sessions |
| Activity | This account's entries, newest first |

**Actions**, listed only when the store's state allows them and disabled with the reason when
the role can't; each states its consequence first and asks for a reason where it changes the
merchant's business: Change plan (from the next billing date, or now with proration: "$3.33
charged today"); Extend trial (3, 7 or 14 days; Owner, Admin, Finance); Add a limit override
(this month only or until removed); Resend owner invitation; Restore; Suspend (the reason the
merchant sees; the store name typed); Retry this step ("The merchant's products and settings
aren't touched.").

### 6.5 Plans

"What your merchants can buy, within DripFunnel's maximums." Prices are what merchants pay;
"DripFunnel keeps its wholesale fee and pays you the rest monthly."

- **Plans list**: name and description, prices (monthly · yearly per currency, with
  "DripFunnel's fee $18.00 / store / month" under them), trial, stores on it (a link), status
  (Live · Draft · Retired). Buttons: Compare plans, Defaults for new stores, New plan.
- **Plan editor**: name and description merchants see, trial, prices per currency; beside each
  price DripFunnel's fee and the margin ("You keep $31.00 of $49.00", or in red "Below
  DripFunnel's fee: you'd lose $3.00 per store"); the **entitlement matrix** with three kinds
  of row — **on/off** (custom domain, offers, suppliers, remove "Powered by", A+ content, size
  charts), **limits** (products, staff seats, suppliers, languages, currencies), **monthly
  allowances** ("Publish now" presses, AI design prompts). Every row shows "DripFunnel max
  20,000" (or, for "Powered by", "Allowed by your contract" / "Not allowed in your first
  contract year"); a value above the maximum is marked "Can't be more than 20,000." and Save is
  disabled with "Fix the highlighted rows first." Make live is refused until every currency has
  a price. **Finance edits prices only**.
- **Saving a plan stores are on**: "86 stores are on Growth. Who gets the change?" — New
  signups only, or Everyone at their next renewal (they get an email 30 days ahead). "Check the
  plan picker preview before you apply."
- **Retiring**: "{plan} disappears from signup now. 44 stores are on it." — keep it as it is,
  or move them to another plan on a date you pick. The last Live plan can't be retired.
- **Compare plans**: every non-retired plan as a column, every entitlement as a row, and
  below it **Preview · what merchants see at signup**: the plan picker in the partner's look,
  framed "In your brand. The console itself doesn't change."
- **Defaults for new stores**: default plan, trial length, and the countries, currencies,
  languages, payment providers and couriers merchants may use, from what DripFunnel offers in
  the partner's region. "Only new stores get these; existing stores don't change."

### 6.6 Branding (white-labelling the merchant portal)

"How your merchant portal and every email to your merchants and their suppliers look." Four
tabs; Owner and Admin edit, others view. Unpublished changes show "Unpublished changes.
Merchants still see the published version. This affects 86 stores." with Discard and Publish.

- **Look**: product name merchants see; primary and accent colours with a **contrast check**
  ("White text on primary · 6.2:1 Passes", "Dark text on accent · 3.9:1 Fails" with the fix);
  font (Nunito, Source Sans 3, Manrope, Lora, DM Sans); corners (Rounded · Soft · Square);
  sign-in background; logo for light and dark backgrounds, mark, favicon. Publish is disabled
  with "Fix the contrast first." while a pair fails. **Preview · merchant portal**: Sign in ·
  Sign up · Home · Products · Settings, at Desktop or Phone, Light or Dark, in a frame.
- **Words**: support email and URL, help-centre link, terms, privacy policy, data-processing
  agreement ("Needed before DripFunnel can approve you."), Impressum for a German partner
  ("Required in Germany."), and Show "Powered by DripFunnel" with the contract's note ("Your
  contract lets you remove it." / "Your contract keeps this line on for the first year.",
  disabled).
- **Emails**: seven templates — Verification code, Invitation, Password reset, Trial ending,
  Payment failed, Store suspended, Receipt. Subject, heading and message; **Insert a variable**
  shown as chips ("{store name}"), never raw braces; Reset to default; **Send a test to {me}**;
  **Preview · in your brand** with sample values filled in.
- **Publishing and History**: Publish now or on a date at 00:00 in the partner's zone ("This
  changes the merchant portal and emails for 86 stores. Their shops don't change."). History
  lists every change with before → after, who and when; a scheduled one offers Cancel
  schedule; a past one offers **Roll back** ("This goes back to {before} for every store's
  portal and emails, right away.").

### 6.7 Domains

"Every address your platform uses." Four cards — **Merchant portal** (`store.northstar.com`),
**Preview address, all stores** (`*.preview.northstar.com`), **Shop address, all stores**
(`*.shops.northstar.com`), **Email sender** (`mail.northstar.com`, DKIM, SPF and DMARC, with
"Until it's live, emails come from no-reply@northstar.dripfunnel-mail.com with your product
name.") — each with status (Waiting for DNS · Verifying · Issuing certificate · Live ·
Failed), "Waiting since {date}" or "Checked 12 min ago", **Re-check now** (every role), and a
record table: Type, Name, Value to add (Copy, and a plain-words line: "DKIM: signs every
email so inboxes trust it."), What we see.

**Add an address** (Owner, Admin, while fewer than four exist), three steps: what it is for
and the hostname (refused: not an address, a DripFunnel domain, already yours, a bare domain
for a wildcard or the sender — "Use a subdomain, like mail.northstar.com"; a root domain for
the portal is allowed with a warning that the website would stop working) → the DNS records
to add, with Copy ("Changes usually show up within an hour, and can take up to 48.") → "Saved.
We haven't found the record yet, which is normal right after adding it. We check every 10
minutes and email you when it's live."

**Merchants' own domains**: "Merchants connect these themselves. You can see their status and
help." Store, host, status, each linking to the store's Domains tab.

### 6.8 Reports

"Totals over time. No report lists an order, customer or product." Six tabs with filters
(Range: Last 6 months · Last 3 months; Plan; Country), **Export CSV** per tab, and a
plain-words summary above every chart. A new partner sees "Reports fill in as your first
merchants sign up."

- **Growth**: "Trials converted at 34% this month, up from 29%." Signups per month; Month ·
  Signups · New stores · Trial to paid · Churned · Net stores.
- **Revenue**: collected per month; Month · Collected for you · DripFunnel's fee · Your
  payout; MRR by plan; failed payments and recoveries. "All amounts in USD; CAD payments are
  converted at the payout rate."
- **Plans**: stores per plan; plan changes this month (Starter → Growth · 3).
- **Store performance**: top stores (Store · Plan · Sales last month · Orders · vs month
  before) and declining stores. "Totals only. Individual orders, customers and products stay
  with each merchant."
- **Usage**: stores at 80% or more of a limit; AI prompts and "Publish now" presses used.
- **Setup health**: time to a ready store (median), failed setups, domains stuck over 24 h.

### 6.9 Billing

"Your merchants' payments, your payouts and DripFunnel's invoices, kept apart." Absent for
Support; Owner, Admin, Finance and Read-only see it; Owner and Finance change it. A stale
strip ("Payment status from 17:42; Stripe is slow to respond.") with Refresh now. Before Live:
"Merchant payments and payouts appear once {product} is live."

- **Your merchants' payments** ("Collected by DripFunnel for Northstar."): failed payments
  being retried (store, amount, why, "Retry 30 Sep, 06:00 PT · attempt 4 of 4"), then every
  payment: Date · Store · Amount · Charged by · Status (Paid · Failed · Recovered · Refunded)
  · Card.
- **Your payouts** ("What DripFunnel pays you: merchant payments minus DripFunnel's fees."):
  "Next payout 1 Oct: about $2,522.40 so far, to Chase ending 1180." — or held because the
  payout account failed verification or the contract lapsed. Month · Collected · DripFunnel's
  fee · Adjustments (with the note) · Payout · Paid on · Status · To (last 4 only).
- **DripFunnel's invoices** ("What you owe DripFunnel for separate fees in your contract. Not
  merchant payments."): id, date, what, amount, status, Tax invoice (PDF).
- **Who bills your merchants** (Owner, Finance): **DripFunnel, on your behalf** or **You, with
  your own billing**. Design the second as a variant: Billing then shows only DripFunnel's
  invoices and this setting, the Stores list gains a Billing status column, each store's
  Billing tab a Billing status select, and "charged by DripFunnel for Northstar" reads "billed
  by Northstar" everywhere.

### 6.10 Support

"Sign in as one of your merchants' users to fix things with them. 30 minutes, logged as you
acting as them." Owner, Admin and Support; two tabs, **Users** and **Sessions · N open now**.

**The rules, shown at the top of Users**: 30 minutes, no extension ("Start a new session if
you need more time."); only for stores that have partner support turned on; everyone in the
store sees it ("Northstar support (Priya) is signed in as Jenna. Ends in 28 min."); logged as
you ("Every action shows as 'Priya as Jenna' in your log and the merchant's."); passwords,
2-factor, payment details and ownership can't be changed.

**A session is read-only.** It opens the merchant's portal with the Owner's read permissions
and nothing credential-shaped. **Write access needs the merchant's approval for that one
session**: support asks, the merchant clicks Allow or Deny in their portal, and the elevation
is logged. Design the read-only bar, the "ask to make changes" request, and the bar once
writes are allowed; the blocked list above stays blocked even then.

- **Users**: "Find a user" (name, email or store); Name and email · Type (Store user ·
  Supplier user) · Store and role · Last sign-in · Status · **Open support session** or
  **Return to session**. Refused with the reason: the role; "{owner} has turned off partner
  support for {store}. Ask them to turn it on in Settings › Support access."; the user hasn't
  accepted their invitation; the account is suspended; the store is cancelled; "{colleague} is
  signed in as {user} now. Ends in 12 min." Never lists the partner's own team, DripFunnel
  staff or shoppers.
- **Starting a session**, two steps: **Why** (reason required, ticket link optional) →
  **Confirm**: "You'll act as {user} ({role}, {store}) for 30 minutes, read-only until {owner}
  allows changes. You can't change {user}'s password, 2-factor, payment details or the store's
  ownership. Everyone signed in to {store} sees it. Everything you do is logged as {me} as
  {user}." Then **your 2-factor code** → Start session. One session at a time ("You already
  have an open session… End it and continue"). The portal opens in a new tab with an
  unremovable bar ("You are signed in as {user} ({role}) · {partner} support session by {me} ·
  Ends in 28 min" with End now); at five minutes the bar turns red; expiry shows "Your 30
  minutes as {user} are up." with Back to the partner console.
- **Sessions**: open now (user and where, who, reason and ticket, minutes left, Return to tab,
  End) and history (Ended by staff · Expired).

### 6.11 Activity log

"Everything done in this console and on your store accounts. Never what happens inside a
store." Its team's actions; DripFunnel staff actions on its account and its merchants'
accounts; DripFunnel setup sessions; partner support sessions; account events (signups, plan
and status changes, payments, payouts, DNS checks, stuck setups). Never anything inside a
store, never a shopper.

- **Find a person first**: a typeahead over the partner's team ("Your team · Admin") and its
  merchants' owners ("Owner of Juniper & Co."); choosing one shows "{name}'s timeline" with
  Show everyone.
- **Filters** as chips: Who (Your team · DripFunnel staff · DripFunnel setup · Support
  sessions · Account events), Action, Result (Success · Denied · Failed), Store, Date. "17
  entries · newest first"; "Nothing matches. Try another person or remove a filter."
- Rows in plain words ("Maya extended Lumen Candle Co.'s trial to 4 Oct: customer request"),
  setup-session rows tagged "DripFunnel setup", each expandable to When · Who · Store · Before ·
  After · Reason. Show more; Export CSV. Read-only. The same entries appear on each store's
  Activity tab and as My activity.

### 6.12 Settings

"Your company, team, payouts and security." Four tabs.

- **Company**, read-only: legal name, address, tax id, region; main contact (the Owner) and
  billing contact (Finance); the contract (agreement, term, wholesale fees per plan, the
  "Powered by" clause, payout schedule) with "Read-only. Ask your DripFunnel partner manager
  to change it."
- **Team**: name ("(you)"), email, role (a select; Owner offered to Owners only), last sign-in
  ("Invitation sent" when pending), 2-factor (On · Off), Remove; **Transfer ownership**
  (Owner; "TRANSFER" typed; "The new Owner can manage billing, payouts and the team. You
  become an Admin.") and **Invite** (Owner; Admin, not as Owner: "They get an email to set a
  password and turn on 2-factor."). Rules: there must be at least one Owner ("Transfer
  ownership first."); you can't remove yourself; removing someone signs them out now and keeps
  what they did in the activity log; an invitation never reveals whether an email has an
  account elsewhere.
- **Payout and payment**: the payout account ("Chase ending 1180 · Verified", or Verifying ·
  Verification failed · Missing; "Only the last 4 digits are ever shown. Payouts go out on
  the 1st of each month in USD.") with Add / Change account (Owner, Finance: account holder,
  account number or IBAN; "DripFunnel checks it with a small test deposit. Payouts pause until
  it's verified."); the payment method ("Visa ending 3009 · On file", or Declined · Missing;
  "DripFunnel charges this card for its invoices, such as priority support.") with Add /
  Change card (Owner, Finance) **through a hosted payment field: the card number is typed into
  the payment provider's frame, never into a DripFunnel form**. In a staff setup session both
  read "Payment method and payout details stay with {partner}. {partner} enters these itself."
- **Security**: one switch, Owner only — "Require 2-factor for everyone on the team", with
  "2-factor is off for: Alex Kim. If you require it, they'll set it up at their next sign-in."
  Turning it off never removes anyone's 2-factor.

## 7. States to design on every screen

- **Empty**: an explanation and the action that fills it ("Create your first store, or share
  your sign-up link: store.northstar.com/signup").
- **Loading**: skeletons, never a zero that later becomes real.
- **Error**: plain words first, details behind a click, retry, and keep what was typed.
- **Permission denied**: disabled with the reason and who can.
- **Read-only**: the role (Read-only), or a Closed or lapsed partner, or offline.
- **Stale**: "Payment status from 17:42; Stripe is slow to respond."
- **Confirmation**: consequence first, target named, reason where needed, the name typed for
  the worst actions.
- **Not live yet**: before approval, screens that need merchants say so and link to the
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
Sam (Finance), Alex Kim (Read-only, 2-factor off). Last payout: $2,712.40 on 1 Sep 2026; next
payout about $2,522.40 on 1 Oct to Chase ending 1180.

Also design the **onboarding** version of the console for **Kaufladen Digital** (Germany and
Austria, EUR, German and English; Jonas, Owner; Petra, Admin), a partner **sent back** for a
missing Impressum: branding done, plans not priced, email sender pending DNS, and DripFunnel
staff (Priya) in a setup session.

## 9. The interface must never

- Show a merchant's orders, customers or products, or any report that lists them.
- Show a secret, password, full card or bank number, or take a card number in its own form.
- Show a price without its currency and who charges it, or mix merchant payments, payouts
  and DripFunnel's invoices without labels.
- Confuse Trial, Active, Past due, Suspended and Cancelled.
- Let a branding or plan change reach merchants without a preview and a clear "this affects
  86 stores".
- Show anything from another partner, or whether an email has an account.
- Offer a sign-up, a Google button, or a way to change company details or the contract.
- Show raw error codes or technical terms first.

## 10. Not in this release

Do not design these; the first release leaves them out: **Announcements** (messages and
incident banners to merchants), **partner state changes** (pause, offboard, close and the
contract's renewal are DripFunnel's actions; the console only shows their strips, §5),
**promotions on plans**, **a user's own profile and 2-factor settings** (a user who skipped
2-factor enrols when the Owner requires it), **changing company details** (a request to the
partner manager), and **Google sign-in**.

## 11. How to work

1. Restate in your own words what a partner, a merchant and a store are, and what the partner
   can and can't see. List anything this brief leaves unclear, then wait for my go-ahead.
2. Design the shell, then in this order: Dashboard, Stores (list, detail, create, actions),
   Plans, Branding, Domains, Reports, Billing, Support, Activity log, Settings, then accepting
   an invitation, sign in, onboarding and approval.
3. For each screen, show the happy path, then the states in §7.
4. Keep one visual system: the same list, filter chips, detail header, tabs, status badges,
   money formatting, confirmation dialog and activity row everywhere.
5. When this brief is silent, ask; don't invent product rules.

## 12. Where the earlier prototype differs

The existing prototype decides behaviour. Two lists: what the product's rules overrule, which
you must not reproduce, and what is kept exactly as the prototype draws it.

**Overruled: design this instead**

| The prototype shows | Design this instead |
|---|---|
| Support sessions with full access as the user ("Impersonate"; "Changes you save are logged as Priya as Jenna") | Read-only, with write access only after the merchant allows it for that session (§6.10). The flow, the banner and the blocked list stay |
| A payment-method dialog that takes a raw card number | A hosted payment field from the payment provider; the card number never touches DripFunnel (§6.12) |
| No environment marker | A grey strip naming the environment on every host but production (§5) |
| Everyone sets up an authenticator app when accepting an invitation | 2-factor offered with "Skip for now", and required only when the Owner's Security switch is on (§6.1, §6.12) |

**Kept as the prototype has it**

- Lists end in "Show 25 more": never page numbers or a total (§4).
- Retrying a stuck setup step is a partner action, for Owner and Admin (§6.4).
