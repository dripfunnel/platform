# DESIGN-BRIEF.md

The prompt to give Claude when designing the merchant portal, plus the full list of
flows to work through one at a time.

Paste §1 to start a design session, then name a flow from §3.

---

## 1. The prompt

> You are designing the **DripFunnel merchant portal** — the web app merchants and
> vendors use to run their store. It does not exist yet; nothing is designed.
>
> **Read these first.** They are the specification, and they settle questions you
> would otherwise have to guess at:
>
> - [SAAS-PLAN.md](https://github.com/SoftoboticsTechnologies/df-store/blob/main/SAAS-PLAN.md) — what the platform is and what it does
> - [AUTH-PLAN.md](https://github.com/SoftoboticsTechnologies/df-store/blob/main/AUTH-PLAN.md) — who the users are, what each may do, and the rules the UI must not contradict
> - [ARCHITECTURE.md](https://github.com/SoftoboticsTechnologies/df-store/blob/main/ARCHITECTURE.md) — how it is built, if you need it
>
> **The system in one paragraph.** DripFunnel hosts online stores. A *merchant*
> signs up, gets their own store, pays a subscription, and designs their storefront
> by describing changes in words rather than editing code. A merchant can invite
> *vendors* — suppliers whose products appear in the merchant's catalogue, and who
> see only their own. Shoppers never see this portal; they see the storefront,
> which is a separate site.
>
> **Design one flow at a time.** I will name one. Produce the screens for it,
> including the states that are not the happy path — empty, loading, error,
> permission-denied, and the degraded state when a subscription has lapsed. Ask me
> when the specification is silent rather than inventing an answer; when it does
> decide something, follow it.
>
> **Nine facts that shape the interface.** These are not implementation trivia —
> each one changes what a screen must show:
>
> 1. **A person can belong to several marketplaces at once**, and can be staff in
>    one and a vendor in another. Every screen is scoped to one marketplace, and
>    the app must never pick for them when more than one is available. There is a
>    marketplace switcher, and the current one must always be visible.
> 2. **Vendors and staff appear in the same user list** and must be visually
>    distinct — they have different powers and different risks.
> 3. **A vendor's access level is chosen by the merchant**, one of three:
>    catalogue only, catalogue plus read-only orders, or catalogue plus fulfilling
>    their own order lines. The navigation itself differs between them.
> 4. **The merchant can edit a vendor's product, and the vendor sees that edit** —
>    it is one shared record, not a copy. The interface has to say so on both
>    sides, or it reads as a bug. Only price is genuinely per-marketplace.
> 5. **Whether vendor products need approval is a per-merchant setting.** Design
>    both journeys: straight to the storefront, and held in a review queue.
> 6. **An order can contain several vendors' products.** A vendor sees only their
>    own lines. Never show them an order total — shipping, discounts and tax span
>    sellers and cannot honestly be attributed to one.
> 7. **The AI storefront designer never publishes straight to production.** The
>    shape is: describe a change → preview → approve → publish. Undo is a
>    first-class action.
> 8. **Signup is meant to take under two minutes and involve no staff**, but it is
>    several slow steps behind the scenes. It needs a real progress experience, and
>    a way to fail gracefully.
> 9. **When a subscription lapses the portal blocks changes but does not lock the
>    merchant out**, and the storefront degrades rather than disappearing. That is a
>    designed state, not an error page.
>
> **Two things the interface must never do**, both for security rather than taste:
>
> - **Never reveal whether an email address already has an account.** Inviting
>   someone who already has one is normal — they may belong to another marketplace.
>   The response must look identical either way.
> - **Never show a vendor anything belonging to the merchant or to another
>   vendor**, including in search results, counts, empty states and exports.
>
> Start by telling me what you understand the system to be and who its users are,
> in your own words, and name anything the specification leaves genuinely open.
> Then wait for me to pick a flow.

---

## 2. Who the users are

| Role | Who they are | Where they work |
|---|---|---|
| **Merchant Owner** | Runs the store. The only role that invites people, manages vendors, approves products and publishes the storefront. | Portal |
| **Merchant Manager** | Runs catalogue and orders day to day. No billing, no user management, no payment/shipping configuration. | Portal |
| **Merchant Staff** | Handles orders and customers. Read-only on catalogue. | Portal |
| **Vendor · Catalogue** | Supplies products. Never sees orders. | Portal |
| **Vendor · Orders (read)** | As above, plus sees which of their products sold. | Portal |
| **Vendor · Orders (fulfil)** | As above, plus fulfils their own order lines. | Portal |
| **DripFunnel staff** | Internal operations — tenants, impersonation, deploys. | Existing Vendure Dashboard, **not** this portal |

---

## 3. The flows

Ordered roughly by dependency — earlier ones are needed to reach later ones. Each
line says who it is for and the thing most likely to be missed.

### A. Getting in

1. **Sign up / store provisioning** — new merchant. Under two minutes, no staff.
   Needs a genuine progress state and a failure path that does not leave a
   half-made store.
2. **Log in** — everyone. Must handle the person who belongs to no marketplace at
   all, which is refused rather than empty.
3. **Choose a marketplace** — anyone in more than one. The app must not pick.
4. **Switch marketplace** — same. Always-visible current context; consider what
   happens to a half-finished form.
5. **Forgot password → reset** — everyone. Must not reveal whether the address
   exists.
6. **Accept an invitation** — new user setting a password; and the existing
   account simply joining another marketplace, which skips the password step.
7. **Log out** — everyone. One session across all marketplaces, not one each.

### B. People

8. **User list** — Owner. Staff and vendors together, visibly distinct, with
   pending invitations shown alongside active people.
9. **Invite a user** — Owner. Email, name, role from a fixed list. Identical
   response whether or not the account already existed.
10. **Pending invitation: resend, revoke, expiry** — Owner. Invitations expire
    after seven days; expired ones must be obvious and recoverable.
11. **Change someone's role** — Owner. Includes refusing to demote the last Owner.
12. **Remove someone** — Owner. Removing from *this* marketplace, not deleting the
    person, who may belong to others.
13. **My profile** — everyone. Name, email, password.

### C. Vendors

14. **Vendor list** — Owner. Each vendor's access level and product count.
15. **Invite a vendor** — Owner. Heavier than a user invite: it creates the vendor
    as well as their first user.
16. **Change a vendor's access level** — Owner. Note it can take a few minutes to
    take effect; do not imply it is instant.
17. **Suspend or remove a vendor** — Owner. Their products remain in the
    catalogue; the interface must make clear what happens to them.
18. **Approval setting** — Owner. The per-merchant switch that decides whether
    vendor products go live immediately.
19. **Approval queue** — Owner, only when that setting is on. Review, approve,
    reject with a reason.
20. **Vendor's own product list** — vendor. Strictly their own, including counts
    and empty states.

### D. Catalogue

21. **Product list** — merchant sees everything with vendor attribution; vendor
    sees only their own. One screen, two very different views.
22. **Create a product** — merchant and vendor. The vendor's version has no
    control over publication status when approval is required.
23. **Edit a product** — both. The merchant's version must say that the vendor
    will see these edits.
24. **Variants and pricing** — both. Prices are tax-inclusive in rupees; only
    price differs per marketplace.
25. **Images and media** — both.
26. **Collections** — merchant.
27. **Facets and filters** — merchant.
28. **Import products from a file** — merchant. Long-running, partial-failure
    reporting.
29. **Export products** — merchant. Long-running, produces a download.

### E. Orders and customers

30. **Order list** — merchant sees all; vendor sees only orders containing their
    products.
31. **Order detail** — merchant sees the whole order. **The vendor sees only their
    own lines and no order total.**
32. **Fulfil an order** — merchant fulfils anything; a top-tier vendor fulfils only
    their own lines. Partial fulfilment is normal, not an edge case.
33. **What a vendor may see of a customer** — they need a delivery address to ship;
    they probably should not have email or phone. Settle this before designing 31.
34. **Customer list and detail** — merchant only.
35. **Refunds, cancellations and returns** — **undesigned, and deliberately so.**
    They span several vendors and need a decision before any screen exists.

### F. Storefront

36. **Storefront overview** — Owner. Current state, last published, what changed.
37. **Describe a change** — Owner. The AI prompt surface; the heart of the product.
38. **Preview and approve** — Owner. Before and after, and what to do when the
    change broke the build.
39. **Publish** — Owner. Progress, then confirmation the live site has changed.
40. **History and undo** — Owner. Every change is revertible; make that obvious
    rather than buried.
41. **Usage against the plan** — Owner. Prompts and build minutes are metered, and
    running out must not be a surprise.

### G. Store settings

42. **Shipping methods** — Owner. Only one can be active at a time; the interface
    has to make that rule visible rather than surprising.
43. **Shipping charges** — Owner. Free, charged, or free above a threshold.
44. **Payment methods** — Owner. Razorpay and Stripe credentials.
45. **Taxes and HSN codes** — Owner. India-specific and required for real orders.
46. **Custom domain** — Owner. Enter a domain → prove ownership via a DNS record →
    wait for a certificate → live. Multi-day, asynchronous, easy to get lost in.

### H. Billing

47. **Choose a plan** — Owner. At signup and when changing later.
48. **Subscription and invoices** — Owner.
49. **Payment method for the subscription** — Owner. Distinct from the store's own
    payment methods; do not let the two be confused.
50. **Past due** — Owner. The designed degraded state, not an error.
51. **Trial ending** — Owner.
52. **Cancel** — Owner. What happens to the store, the products and the domain.

### I. States that cut across everything

Not screens of their own, but they must be designed once and applied everywhere:

53. **Empty states** — no products, no orders, no vendors, no users. A new store is
    empty at every screen, so this is the merchant's actual first impression.
54. **Loading and slow operations** — imports, exports, publishes, AI runs.
55. **Permission denied** — a Manager reaching an Owner-only screen, or a vendor
    reaching anything that is not theirs.
56. **Read-only mode** — everything above while a subscription is past due.
57. **Something went wrong** — including the case where Vendure itself is
    unreachable.

---

## 4. Open questions the design will force

These are unresolved in the specification. Designing the relevant flow will
probably settle them — flag them when you hit one rather than assuming:

- What a vendor may see of a customer (flow 33).
- Whether editing an approved product sends it back for re-approval, which would
  let a vendor pull a live product off the storefront by editing it (flow 23).
- What happens to a removed vendor's products (flow 17).
- Whether refunds spanning vendors are the merchant's problem alone (flow 35).
- Whether the portal remembers the last marketplace or asks every time (flow 3).
- Whether two-factor authentication applies to Owners only or everyone (flow 13).
