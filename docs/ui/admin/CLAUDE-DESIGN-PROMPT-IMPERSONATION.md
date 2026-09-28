# CLAUDE-DESIGN-PROMPT-IMPERSONATION.md: design staff impersonation

The prompt to paste into the **Claude Design** session that already designed the admin
console, to add the impersonation feature. It is self-contained. Its sources are
[../../USERS-AND-DOMAINS.md](../../USERS-AND-DOMAINS.md) §4.2,
[../../api/ACCESS.md](../../api/ACCESS.md) §8.1, [FIRST-RELEASE.md](FIRST-RELEASE.md) §8 and
[CONSOLE-DESIGN.md](CONSOLE-DESIGN.md) part J; where they disagree, they win and this prompt
should be updated.

Paste everything below the line.

Last updated: 2026-09-28.

---

You've already designed the **DripFunnel admin console**, the **partner console** and the
**merchant portal**. Now add one feature: **Impersonate**, which lets DripFunnel staff
**sign in as a partner's user or a store's user** to see exactly what they see and fix
things for them. **Reuse the existing visual system** (lists, filter chips, detail headers,
tabs, status badges, confirmation dialogs, activity rows, sample data); don't restyle
anything that already exists.

## 1. The rules (decided; the design must follow them exactly)

- **Who can be impersonated**: any **partner user** (in the partner console) and any **store
  user**: the merchant's Owner, Managers and Staff, and each supplier's admins and members (in
  the merchant portal). **Never** another DripFunnel staff member, **never** a shopper.
- **Who can impersonate**: staff with the **Super admin** or **Support** role only. Other
  staff roles see the feature, with the button disabled and the reason ("Only Super admins
  and Support can impersonate").
- **Before starting**: a **reason or ticket link** (required) and **re-authentication**
  (confirm with company sign-in again).
- **Full access as the user**: the staff member sees and does exactly what that user can,
  **except** these, which stay blocked even while impersonating: changing the user's
  **password, 2-factor or sign-in methods**, **payment or payout details**, and **ownership**
  (transferring the store or partner, or changing the Owner). Those controls appear
  **disabled** with "Only Priya can change this".
- **No consent needed**: it works even if the merchant has turned "Support access" off (that
  setting only governs the partner's own support team).
- **30 minutes**, no silent extension; the staff member can end it any time. It also ends if
  the user is suspended or removed meanwhile.
- **Visible on both sides**:
  - the staff member sees an **unremovable bar** across the top of the impersonated app;
  - everyone signed in to that store (or that partner's console) sees a **banner**: "Support
    (Arjun) is signed in as Priya. Ends in 28 min." It always says **"Support"**, never
    "DripFunnel": a white-label partner's merchants must never see our name.
- **Logged as both**: every action is recorded as "Arjun as Priya", in the platform activity
  log, the store's or partner's activity log, and Priya's own activity.

## 2. Screens and states to design

### 2.1 Impersonate (sidebar menu item 6)

A new page in the admin console with two tabs.

**Users** tab: everyone who can be impersonated, in one searchable list.

| Column | Example |
|---|---|
| Name and email | Priya Mehta · priya@mehtatextiles.in |
| Type | Store user · Supplier user · Partner user (badge) |
| Partner | Bazaar Cloud |
| Where and role | "Mehta Textiles · Owner"; for several: "Mehta Textiles · Owner, +2 more" (expandable) |
| Last sign-in | 2 hours ago |
| Status | Active · Invited · Suspended |
| Action | **Impersonate** |

- A large search box ("Find a user by name or email"), then filter chips: type, partner,
  store, role, status.
- **Invited** users (haven't accepted yet) and **Suspended** users: the button is disabled
  with the reason ("Priya hasn't accepted her invitation yet").
- Empty and no-results states; loading skeletons.

**Sessions** tab: impersonations **open now** (user, where, staff member, reason, time left,
**End**) and **history** (same columns plus started, ended, how it ended: ended by staff /
expired / user suspended). Filters: staff member, partner, store, date. Each row links to its
activity-log entries.

Sidebar badge on "Impersonate": number of sessions open now.

### 2.2 Other entry points

- **Partner detail › Team tab**: each partner user row gets an **Impersonate** button.
- **Store detail › Users tab**: everyone in the store, grouped: the merchant's people (Owner,
  Managers, Staff), then each supplier's users under the supplier's name. Each row has
  **Impersonate**.
- **Global search** (⌘K): a person result shows "Impersonate" as a secondary action.

### 2.3 Starting an impersonation (a dialog, three steps)

1. **Where**: if the user belongs to more than one store or supplier, choose which one to act
   in (radio list: "Mehta Textiles · Owner", "Juniper & Co. · Supplier admin for Loomcraft").
   Skipped when there's only one.
2. **Why**: reason (required text) and optional ticket link.
3. **Confirm**: states the consequence plainly, then re-authentication:
   "You'll be signed in as **Priya Mehta** (Owner, Mehta Textiles) with her access for **30
   minutes**. You can't change her password, 2-factor, payment or payout details, or the
   store's ownership. Everyone signed in to Mehta Textiles will see that Support is signed in
   as Priya. Everything you do is logged as Arjun acting as Priya."
   Buttons: "Confirm with Google Workspace" and Cancel.

Then the target's app opens **in a new browser tab** (the merchant portal at the partner's
address, in the partner's look; or the partner console). The admin console shows the
session under Sessions › Open now.

States: re-authentication failed or cancelled; the user was suspended between listing and
starting ("Priya can't be impersonated: her account was suspended at 10:42"); the staff
member already has an open impersonation (only one at a time: offer to end it and continue).

### 2.4 While impersonating: the staff bar

On top of the **merchant portal** (in the partner's look) and on top of the **partner
console**, design a fixed, full-width bar that can't be closed or hidden, in a colour that
can't be mistaken for the partner's brand (e.g. a strong amber with dark text):

"You are signed in as **Priya Mehta** (Owner, Mehta Textiles) · Support session by Arjun ·
Ends in 28 min · **End now**"

- Show the ticking time; at **5 minutes left** it changes to a warning style ("Ends in 4
  min"); it offers no extension.
- **End now** confirms ("End this session? You'll return to the admin console.") and closes
  the tab back to the admin console.
- **Expired**: the portal is replaced by a full-page state: "Your 30 minutes as Priya are up.
  Start a new session from the admin console if you still need it." with a button back.
- **Blocked controls**: design at least three: Settings › Profile (change password, 2-factor),
  Billing › Payment method, and Settings › Transfer ownership, each disabled with "Only Priya
  can change this". Also design what happens if a blocked action is reached another way (a
  clear inline message, no error page).

### 2.5 The impersonated side: the banner

What the real users see while it's open:

- **Merchant portal** (in the partner's look, e.g. Bazaar Cloud's): a calm but visible banner
  at the top for **everyone signed in to that store**: "**Support** (Arjun) is signed in as
  Priya. Ends in 28 min." Never the word "DripFunnel". If Priya herself is signed in, the
  banner is the same.
- **Partner console**: the same banner for everyone signed in to that partner's console:
  "Support (Arjun) is signed in as Maya. Ends in 22 min."
- After it ends: nothing persistent, but the store's Activity log shows the entries.

### 2.6 How it shows in the activity logs

- **Admin console Activity log**: rows read "**Arjun as Priya Mehta** changed the price of
  Linen Kurta from ₹1,499 to ₹1,299 · Mehta Textiles". Expanded: before/after, the reason and
  ticket for the impersonation, and a link to the session. "Impersonation started" and
  "Impersonation ended (expired)" are rows too.
- **Merchant portal › Settings › Activity log** and **Priya's own activity**: the same rows,
  worded "**Support (Arjun) as Priya**", never "DripFunnel".
- **Partner console Activity log**: impersonations of the partner's own users, worded the
  same way.

## 3. Sample data

Use the existing sample data. The people in this feature:

- Staff: **Arjun** (Super admin), **Neha** (Support), **Tom** (Finance: sees everything, but
  can't impersonate, so use him for the disabled state).
- Store users: **Priya Mehta**, Owner of **Mehta Textiles** (Bazaar Cloud, ₹), also a Supplier
  admin for **Loomcraft** in **Juniper & Co.**; **Rohan**, a Manager at Mehta Textiles;
  **Aisha**, invited but not yet accepted (disabled).
- Partner users: **Maya Chen**, Owner of **Northstar Commerce**; **Diego**, its Admin.
- Open sessions: Neha as Rohan (12 min left); history: Arjun as Maya yesterday (expired),
  Neha as Priya last week (ended by staff).

## 4. The interface must never

- Let impersonation start without a reason and re-authentication, or run past 30 minutes.
- Hide, dismiss or shrink the staff bar, or make it look like part of the partner's brand.
- Show "DripFunnel" in anything a partner's merchants or partner users see.
- Offer to impersonate a staff member or a shopper.
- Let the blocked actions (password, 2-factor, sign-in methods, payment and payout details,
  ownership) look available.
- Record an action as the user alone: it's always "Arjun as Priya".

## 5. How to work

1. Restate the rules in §1 in your own words and list anything unclear, then wait for my
   go-ahead.
2. Design in this order: Impersonate › Users, the start dialog (all three steps and its
   states), the staff bar on the merchant portal and on the partner console (normal, 5-minute
   warning, blocked controls, expired), the impersonated-side banners, Impersonate ›
   Sessions, the Team and Users tab entry points, the activity-log rows.
3. Show every state, including the permission-denied view for Tom.
4. When this brief is silent, ask; don't invent product rules.
