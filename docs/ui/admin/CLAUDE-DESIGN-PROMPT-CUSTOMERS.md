# CLAUDE-DESIGN-PROMPT-CUSTOMERS.md: design the Customers menu

The prompt to paste into the **Claude Design** session that already designed the admin
console, to add a **Customers** menu listing every shopper account. It is self-contained.
Its source is [FIRST-RELEASE.md](FIRST-RELEASE.md) §5.4 (with
[../../api/ACCESS.md](../../api/ACCESS.md) §5.4 and [../../api/LOGGING.md](../../api/LOGGING.md)
§3); where they disagree, they win and this prompt should be updated.

Paste everything below the line.

Last updated: 2026-09-28.

---

You've already designed the **DripFunnel admin console**. Now add one menu: **Customers**,
where DripFunnel staff can find and look at **shopper accounts** (the people who buy on
merchants' online stores) across every partner and every store. **Reuse the existing visual
system** (list, filter chips, search, detail header, tabs, status badges, activity rows,
sample data); don't restyle anything that already exists.

## 1. The rules (decided; follow them exactly)

- **Read-only.** Staff can find a customer, open their account and read their activity.
  **No actions** in this release: no password reset, no block, no export, no delete. Don't
  design disabled buttons for them either; they simply aren't there.
- **Accounts are per store.** A shopper who buys from three stores has **three separate
  accounts**, one per store, each with its own sign-in. The list shows one row per account,
  and the design must make that obvious (the same person can appear more than once, each
  time with a different store).
- **Personal data is protected:**
  - in the **list**, email and phone are **masked**: `pr***@gmail.com`, `+91 ***** 43210`;
  - on the **detail page**, the full email and phone are shown to **Super admin and
    Support** only; every other staff role still sees them masked, with a quiet note ("Full
    contact details: Super admin and Support");
  - **opening a customer's detail page is logged** ("Neha viewed customer Priya S. at Mehta
    Textiles"); say so discreetly on the page ("Your view is recorded");
  - **never shown anywhere**: addresses, order contents, payment details, passwords.
- **Order data is a count only** (e.g. "12 orders"). Staff see orders only by impersonating a
  store user, never here.
- Search can match a **full** email or phone typed exactly, even though the list shows them
  masked.

## 2. Where it lives

- A new sidebar item **Customers**, directly under **Stores**. No badge.
- A **Customers** tab on each **store's** detail page: the same list, pre-filtered to that
  store.
- **Global search** (⌘K): a "Customers" group in the results, masked like the list.

## 3. Screens and states to design

### 3.1 Customers list

Header: "Customers" and a line of context ("Shopper accounts on every store. One row per
store account.").

| Column | Example |
|---|---|
| Name | Priya Sharma |
| Email | pr***@gmail.com |
| Phone | +91 ***** 43210 |
| Store | Mehta Textiles (link) |
| Partner | Bazaar Cloud (link) |
| Signs in with | Email · Mobile · Both |
| Status | Active · Unverified · Deleted |
| Orders | 12 |
| Created | 3 Mar 2026 |
| Last sign-in | 2 days ago |

- **Search box** first: "Search by name, exact email or exact phone". When the search is an
  exact email or phone, show a hint above the results: "3 accounts use this email, one per
  store".
- **Filters** as chips: partner, store, status, signs in with, created, last sign-in.
  Filters live in the URL.
- **Deleted** accounts (a shopper asked to be erased) show as "Deleted customer" with every
  personal field blank; they stay in the list so order counts and history still make sense.
- Newest first; load more on scroll; row click opens the detail.

States: **empty** (no customers yet on the platform, or in this store), **no results** for a
search (with "Clear filters"), **loading** skeletons, **error** with retry.

### 3.2 Customer detail

Header: name, status badge, "Customer of **Mehta Textiles** (Bazaar Cloud)", and the
discreet "Your view is recorded" note.

**Overview** section:
- Email and phone: **full** for Super admin and Support; **masked** with the note for other
  roles. Show "verified" or "not verified" beside each.
- Signs in with: email, mobile or both (the store decides which it offers).
- Created, last sign-in, orders (count).
- **Other accounts with this email**: a small, linked list of the same email's accounts in
  other stores ("Also a customer of 2 other stores"), each opening that account. Show this
  for Super admin and Support only.

**Activity** tab (from the activity log): this customer's sign-ins, failed sign-ins,
password resets, email or phone changes, address added or changed (as an event only, never
the address), orders placed and cancelled (as events with the order number, never the
contents). Filters: action, result, date. Rows in plain words ("Signed in with a one-time
code", "Placed order #1042"). Newest first.

States: **loading**; **deleted customer** (a clear explanation: "This customer asked for their
data to be deleted on 12 Aug 2026. Their history is kept without personal details."); a
customer whose **store is suspended** (a note linking to the store); the **masked view** for
a Finance or Read-only staff member.

### 3.3 Store detail › Customers tab

The list from 3.1 without the Store and Partner columns, with a count ("1,284 customers") and
the same search and filters.

### 3.4 How viewing shows in the Activity log

In the admin console's Activity log, a detail view reads: "**Neha** viewed customer **Priya
S.** at Mehta Textiles". Staff-only; never shown to the partner or the merchant.

## 4. Sample data

Use the existing sample data. Customers to include:
- **Priya Sharma**, customer of **Mehta Textiles** (Bazaar Cloud, India, ₹), signs in with
  mobile, 12 orders; she also has accounts at two other stores with the same email.
- **Daniel Brooks**, customer of **Juniper & Co.** (Northstar, US, $), signs in with email, 3
  orders, email not verified.
- A **deleted** customer at Mehta Textiles.
- A customer of a **suspended** store.
- Staff: **Neha** (Support) sees full details; **Tom** (Finance) sees masked ones.

## 5. The interface must never

- Show an address, order contents, payment details or a password.
- Show a full email or phone in the list, or to a staff role other than Super admin and
  Support.
- Offer any action on a customer (reset, block, export, delete) in this release.
- Suggest that one person has one account across stores: each row is one store's account.
- Show "DripFunnel" or any other partner's name in anything a partner or merchant sees
  (nothing in this feature is visible to them).

## 6. How to work

1. Restate the rules in §1 in your own words and list anything unclear, then wait for my
   go-ahead.
2. Design in this order: the Customers list (with every state), the customer detail (full
   and masked views, deleted customer), the store's Customers tab, the ⌘K results group, the
   activity-log row.
3. When this brief is silent, ask; don't invent product rules.
