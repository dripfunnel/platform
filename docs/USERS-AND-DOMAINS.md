# USERS-AND-DOMAINS.md

Who uses the platform, where each of them signs in, and which hostnames exist. **Decided
2026-09-27; Admin moved to its own console and host 2026-09-28.** Where older documents say
"brand" they mean a **partner**'s white-label identity, and where they say "DF Admin" they
mean the admin console at `admin.dripfunnel.com`.

---

## 1. The five kinds of user

| User | Who | Signs in at | Does | Never sees |
|---|---|---|---|---|
| **Admin** | DripFunnel staff | `admin.dripfunnel.com` (staff only) | Runs the whole platform: approves and manages partners, sees every partner and merchant at account level, fleet, billing, integrations | Nothing is hidden, but store-level access follows the same audited support rules as partners (§4) |
| **Partner** | A company that white-labels the platform and sells it to its merchants. **DripFunnel is also a partner** (the house partner) and onboards its own merchants the same way | `platform.dripfunnel.com` (the same host for every partner; not white-labeled) | Self-onboards, sets its branding and domains, its plans and prices, and manages its merchants at account level | Other partners; merchants' customers, orders and catalogues (§4) |
| **Merchant** | Owns a store, with their staff (Owner, Manager, Staff) | The partner's **portal host**, e.g. `store.partnerdomain.com`, in the partner's look | Lists products, sets up the storefront and its domain, runs orders and offers, invites vendors | Other merchants; the partner's other data |
| **Vendor** (seller) | A supplier the merchant invites to list products in the merchant's store | The same partner portal host as the merchant | Manages only their own products, stock and (by tier) their order lines | The merchant's and other vendors' data (unchanged from the archived design) |
| **Customer** | Buys from a merchant's store | The merchant's storefront domain | Browses, buys, manages their account and orders | Everything else |

**Customer accounts are per store** (decided): a person who buys from two merchants has two
separate customer accounts, because each is the merchant's customer, not the platform's.
Each store chooses whether shoppers sign in by email, mobile number or both (decided
2026-09-28, api/ACCESS.md §2.1).

**Merchant and supplier accounts are per partner** (decided 2026-09-28): one login covers
every store a person belongs to under one partner; the same email under another partner is
a separate, unrelated account, so white label never leaks (api/ACCESS.md §2).

---

## 2. Hostnames

| Hostname | Serves | Who uses it | Set up by |
|---|---|---|---|
| `admin.dripfunnel.com` | The admin console (`apps/ui/admin`) and the Admin API at `/api` | DripFunnel staff (Admin) only | Fixed |
| `platform.dripfunnel.com` | The platform console (`apps/ui/platform`) and the Platform API at `/api` | Partner users only | Fixed |
| **Partner portal host**, chosen by the partner (suggested `store.<partnerdomain>`) | The merchant portal (`apps/ui/store`) in the partner's look, and the Store API at `/api` | Merchants, their staff, vendors | Partner, on `platform.dripfunnel.com` |
| `{shop}.preview.<partnerdomain>` | Each merchant's storefront **preview** (client-rendered SPA, live data) | The merchant and their team | Partner adds one wildcard DNS record |
| `{shop}.<partner shop domain>`, e.g. `{shop}.shops.<partnerdomain>` | Each merchant's **live** storefront until they connect their own domain | Customers | Partner adds one wildcard DNS record |
| The merchant's own domain, e.g. `www.merchantbrand.com` | The merchant's **live** storefront (static build) | Customers | Merchant, in the portal |
| The partner's email sender domain | Email from the partner's platform (verification, invitations, receipts, order emails) | None (email only) | Partner (SES DKIM, SPF, DMARC records) |

DripFunnel, as the house partner, uses the same pattern (decided): `store.dripfunnel.com`,
`{shop}.preview.dripfunnel.com` and `{shop}.shops.dripfunnel.com`.

**One portal host per partner** (decided): a partner has exactly one brand, one look and one
portal host.

---

## 3. Onboarding

**Partner** (invite only, decided 2026-09-29: there is **no partner sign-up** on
`platform.dripfunnel.com`)
1. **Admin creates the partner** on `admin.dripfunnel.com` (name, Owner email, country) as
   *Draft*, and its Owner gets an invitation to the partner console. The Owner accepts it,
   sets a password and 2-factor (never a password sent by email), and signs in.
2. Sets up branding, portal host, preview and shop wildcard domains, email sender domain,
   plans and prices, and its billing with DripFunnel. Each domain shows the DNS records to add
   and live verification status.
3. **Admin approves** the partner, on `admin.dripfunnel.com` (contract, KYC, billing). Until then the partner can set
   everything up, but **merchants can't sign up under it**.
4. The Owner invites the rest of the partner's team; nobody joins a partner any other way.
5. **DripFunnel staff can do all of this for the partner** (decided 2026-09-29), in part or
   in full, when the partner needs help: every step from 2 onward, including submitting for
   approval, through a **setup session** opened from the admin console (ACCESS §8.2). It
   works before the Owner has accepted, and the Owner's invitation can be held until the
   setup is done. The partner enters its own payment method and payout details.

Partner states: *Draft → Awaiting approval → Live → Paused (no new merchant signups) →
Offboarding → Closed*.

**Merchant** (on the partner's portal host, or created by the partner)
1. Signs up in the partner's look, **or the partner creates the merchant from
   `platform.dripfunnel.com`** and the merchant's Owner gets an invitation to set a password
   (never a password sent by email). Either way the store is provisioned automatically.
2. Gets a preview link (`{shop}.preview.<partnerdomain>`) and a live link
   (`{shop}.shops.<partnerdomain>`) straight away.
3. Designs the storefront with the AI, publishes, and connects their own domain whenever
   they like.

**Vendor**: invited by a merchant; signs in at the same partner portal host.

**Customer**: creates an account on the merchant's storefront, or checks out as a guest.

---

## 4. What a partner can see and do

**Account level, plus audited support access.**

A partner **can**, for its own merchants only:
- see and manage merchant accounts: plans, prices, limits and entitlements (including
  "Publish now" allowances), billing status, trials, suspend and restore;
- see domain, provisioning and publishing status, and usage against the plan;
- see **each store's aggregate sales and order count per month** in reports (decided
  2026-09-28): totals only, never an order, customer or product;
- **open a merchant's portal read-only for support**, under the consent rules in §4.1.

A partner **can't**:
- browse or export a merchant's customers, orders or catalogue outside a support session;
- change anything inside a merchant's store;
- see anything of another partner.

**Admin** has the same support-access rules inside stores, and account-level access to every
partner and merchant.

### 4.1 Support access (decided: a standing setting)

- **Setting**: in the merchant's portal, *Settings › Support access*: "Allow [partner name]
  support to view my store: On / Off". **On by default**; the Owner can switch it off at any
  time. When it's off, support can only ask the merchant to switch it on.
- **Sessions are read-only**, **time-limited** (30 minutes by default *(confirm)*), and need a
  **reason or ticket number** before they start. They can't change passwords, payment
  methods, payouts or ownership.
- **Visible**: while a session is open, the merchant's portal shows a banner to everyone
  signed in to that store: "[Partner] support (Priya) is viewing your store. Read-only. Ends
  in 28 min."
- **Logged**: every session appears in the merchant's *Support access log* (who, when, why,
  how long) and in the platform audit log. The merchant is notified by email when a session
  starts *(confirm)*.
- **Changing anything** (for example fixing a product for the merchant) needs the merchant's
  approval for that one session: support requests write access, the merchant clicks
  "Allow" or "Deny", and the elevation is logged.
- These rules are for **partner support**. DripFunnel staff don't use support sessions; they
  impersonate users (§4.2).

### 4.2 Staff impersonation (decided 2026-09-28)

- **DripFunnel staff can sign in as any partner user or any store user** (Owner, Manager,
  Staff, supplier users), from the admin console, to see and do exactly what that person can.
  Never as another staff member, never as a shopper.
- **Full access as the user**: the staff member acts with that person's permissions,
  including writes, **except** changing the user's password, 2-factor or sign-in methods, payment or payout details, or ownership (transferring the store or partner, or changing the Owner). Those stay blocked even while impersonating, so
  the real user can never be locked out and money can never be redirected.
- **No consent needed**: it works whatever the merchant's Support access setting says. **The
  platform's terms must say so**: partners' and merchants' terms state that DripFunnel
  staff may sign in as their users for support, without asking (decided; exact wording by
  legal).
- **Only Super admin and Support** can start one, with a **reason or ticket**, after
  re-authentication; it lasts **30 minutes**, with no silent extension.
- **Visible**: the impersonated side sees a banner while it's open (every person signed in
  to that store, or that partner's console): "Support (Arjun) is signed in as Priya. Ends in
  28 min." Always "Support", never "DripFunnel", so white label holds. The staff member sees an unremovable bar
  naming the user, the store or partner, and the time left.
- **Customer accounts** (shoppers) are the one kind of store data staff also see directly,
  read-only, in the admin console's Customers menu, without impersonating (decided
  2026-09-28): contact details masked in lists, every detail view logged, never addresses,
  order contents or payment details. Shoppers are never impersonated.
- **Logged as both**: every action is recorded as "Arjun as Priya" (the user as actor, the
  staff member as the real agent), on the platform activity log, the store's or partner's
  log, and the user's own "My activity".

---

## 5. DNS and certificates

Every partner and merchant hostname is added to our zone as a **Cloudflare for SaaS custom
hostname**, with certificates issued automatically. The console shows each record to add,
checks it, and reports progress (the archived domain flow, DESIGN-BRIEF flow 58).

**Verify before building:**
- **Wildcard custom hostnames** (`*.preview.<partnerdomain>`, `*.shops.<partnerdomain>`) and
  which Cloudflare plan supports them.
- **Apex domains** for merchants (`merchantbrand.com` without `www`): most DNS providers can't
  point an apex at a CNAME, so decide between requiring `www` with a redirect, or supporting
  apex records.
- Limits and pricing per custom hostname at thousands of merchants.

---

## 6. What this means for routing (docs/ARCHITECTURE.md §2)

| Hostnames | How many | Risk for "Pages + `/api` Worker route on the same host" |
|---|---|---|
| `admin.dripfunnel.com`, `platform.dripfunnel.com` | Two, on our own zone | Low: standard Pages custom domain plus a Worker route |
| Partner portal hosts | One per partner, on partners' domains | **Test this**: Pages custom domains on Cloudflare for SaaS custom hostnames, and per-project domain limits. Fallback: serve the portal through Workers static assets |
| Previews and live storefronts | One or more per merchant | Already planned on Workers and Cloudflare for SaaS |

---

## 7. Open questions

- Support access defaults: session length, the email notice when a session starts, and the
  Admin exception for investigations (§4.1).
