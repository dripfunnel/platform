# mobile-app/shop: the first release

The store's own shopping app: what its first release contains. Who gives it to whom and how it is
built per store is [../README.md](../README.md); the code is [ARCHITECTURE.md](ARCHITECTURE.md);
delivery tracking is [api/DELIVERY.md](../../api/DELIVERY.md) §7.

**Status: specification, not built.** No prototype yet (§3).

Last updated: 2026-10-22 (every payment method in the app; the handover code). Before: 2026-10-22 (first version, with Gaurav).

---

## 1. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **Native, in a fixed layout, branded with the store's logo, colours and font**, on the Shop API (decided 2026-10-22) | The storefront website in a web view | Apple rejects apps that only wrap a website (4.2), and checkout in a web view is fragile. The AI-designed theme is website code a native app can't run, so the app looks like the store's brand, not like its website. |
| **The storefront's rules hold** (storefront/DESIGN.md, AGENTS.md "Storefronts"): no invented data; the price with its tax label, legal and compliance notices and the order summary at review are always shown as the Shop API gives them, but not the "Powered by" line (below) *(proposed)* | App-only rules | The same store, the same customers, the same law. |
| **Customers sign in the way the store chose** (Settings › Customer accounts; ACCESS.md §2.1), and their account is the one they have on the website *(proposed)* | A separate app account | Customer accounts are per store already (USERS-AND-DOMAINS §1); the app is one more door to the same account. |
| **Every payment method the store offers on the website, through each provider's native SDK**: Stripe (Payment Sheet), PayPal, Razorpay, Cashfree and PhonePe, plus cash on delivery and bank transfer (decided 2026-10-22) | A web checkout page inside the app | The payment element is sealed on the website; in the app the provider's own sheet plays that part. Physical goods must not use in-app purchase (Apple 3.1.3(e)). |
| **No "Powered by" line in the store's apps**, shop or delivery (decided 2026-10-22) | The line in Account, following the plan, as on the website | The apps carry only the store's brand, published under the merchant's name. The website's sealed line is unchanged. |
| **No offline cart or checkout**: browsing shows the last loaded page with a banner; writes need a connection *(proposed)* | An offline queue | As the merchant app (merchant/ARCHITECTURE.md §5). |

---

## 2. What the release contains

| Area | Contains |
|---|---|
| **Getting in** | Browse without signing in. Sign in, register and reset by the store's methods (email and password, mobile code, or both). Delete my account in Account (Apple 5.1.1(v)) |
| **Home** | The store's collections and products as the Shop API offers them, the announcement, search |
| **Browse** | Collections with the store's filters and sorting, search, product (photos, video, options and versions, price with tax label, stock as the API words it, the store's product sections) |
| **Cart** | Lines, quantities, offer codes (OFFERS-DESIGN rules), the totals the engine prices |
| **Checkout** | Contact, address with a **map pin** (asked always, so own delivery can decide; api/DELIVERY.md §2), the delivery option the address gets, payment, review with the order summary, confirmation |
| **Orders** | List and detail; for own delivery, **tracking**: the steps, the rider's name, photo, vehicle and phone (tap to call), the **handover code** to give the rider, the live map and arrival time (api/DELIVERY.md §3, §7); for a courier, its tracking link |
| **Account** | Profile, addresses (with pins), sign out, delete account |
| **Notifications** | Order placed, rider assigned, on the way, delivered, not delivered, courier shipped (api/DELIVERY.md §6) |
| **Markets** | The store's languages and currencies, chosen as on the website |
| **Legal** | The store's legal pages, opened in the in-app browser from the storefront *(proposed)* |

Not in the first release: wish lists, reviews, the journal, the store's content pages beyond
legal ones, and any theme section the AI built on the website.

---

## 3. Design

There is no prototype yet. **Before any screen is built**, `designs/DF Shop App Prototype.dc.html`
is drawn, with every screen above at phone width and its empty, loading, error and offline
states, and `designs/design.md` maps it. The prototype decides behaviour and wording; this
document decides scope (docs/README.md §3).

---

## 4. Open questions

None. Payments, the "Powered by" line and website tracking were settled on 2026-10-22 (§1, api/DELIVERY.md §7).
