# ui/merchant-mobile-app: the first release

What the merchant mobile app's first release contains. The framework is in
[REACT-NATIVE.md](REACT-NATIVE.md); builds and store accounts are in
[BUILDS-AND-STORE-ACCOUNTS.md](BUILDS-AND-STORE-ACCOUNTS.md).

**Status: decided, not built.**

Last updated: 2026-10-08.

---

## 1. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **The same scope as the web portal's first release** ([store/FIRST-RELEASE.md](../store/FIRST-RELEASE.md) §1), with the same roles, permissions and supplier views (decided 2026-10-08) | A smaller mobile-only set (orders, stock, notifications) | One product on one Store API: a merchant can do on the phone what they do on the web, and every rule (permissions, plan limits, supplier isolation) is already enforced by the server. |
| **Behaviour comes from the Store prototype's Phone frame** (`designs/DF Store Prototype.dc.html`, `device=phone`) and the phone rules in `designs/design.md` §4 and §7 (decided 2026-10-08) | A separate mobile design | The prototype already draws every screen at phone width, and the web portal is built phone first at 360 px (store/FIRST-RELEASE.md §2). |
| **Plan changes and extra bandwidth are bought through in-app purchase**: the App Store on iOS, Google Play Billing on Android (decided 2026-10-08) | No purchasing in the app (Apple 3.1.3(f)); Billing left out of the app | The Owner can manage the plan on the phone as on the web, so Billing keeps its place in the release. The store rules leave only in-app purchase for that (§3). |

---

## 2. What differs from the web

Everything in store/FIRST-RELEASE.md §3–§17 is in the app. The differences:

- **Layout**, from the prototype's Phone frame: the menu becomes an overlay drawer, lists become
  stacked cards, fields are 44–48 px tall, content padding is 14–16 px.
- **Billing** (store/FIRST-RELEASE.md §16): switching plan and buying extra bandwidth go through
  in-app purchase (§3). The card in a hosted field isn't shown in the app, because the store
  takes the payment. The plan, usage and invoices are shown as on the web.
- **Plan gates** (store/FIRST-RELEASE.md §2): the upgrade prompt opens the in-app purchase.
- **Close my store** stays in the app: Apple (5.1.1(v)) and Google require an app that creates
  accounts to let people delete them from inside the app.

---

## 3. In-app purchase

### 3.1 What the store rules require

- **Apple 3.1.1:** "If you want to unlock features or functionality within your app, (by way of
  example: subscriptions…) you must use in-app purchase."
- **Apple 3.1.3(b):** a merchant who bought a plan on the web keeps it in the app, "provided
  those items are also available as in-app purchases within the app."
- **Google Play** ([Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738)):
  in-app purchases of digital features and subscriptions go through Google Play's billing.

### 3.2 How it works

- **The money goes to the partner's own developer account** (BUILDS-AND-STORE-ACCOUNTS.md §1),
  less the store's commission: 15–30% depending on the programme and the subscription's age.
- **Each partner's plans become subscription products** in its own App Store Connect and Play
  Console accounts. Prices are set from Apple's and Google's price points, so they may not match
  the web price exactly.
- **The API learns about purchases from the stores**: Apple's App Store Server Notifications and
  Google's Real-time developer notifications, per partner account. Each is verified and handled
  idempotently, as Stripe's webhooks are (SAAS.md §7.2), and updates `store_subscription`.
- **A plan bought in the app is managed in the phone's settings** (cancel, payment method), not
  in the portal. The web portal says where it was bought.

**What this adds** to the platform: two webhook endpoints (Apple, Google); subscription products
set up in every partner's store accounts; a billing source on the store's subscription (Stripe,
Apple or Google), which is a migration; and the purchase screens in the app.

---

## 4. Open questions

- **Where in-app revenue fits the billing model** *(ask)*: SAAS.md §7.1 ships "DripFunnel bills
  on the partner's behalf" first, with merchant payments through DripFunnel's Stripe and payouts
  to the partner. In-app revenue lands in the partner's own store account instead, so
  DripFunnel's share has to be invoiced to the partner.
- **Partners that bill their own merchants** (`billing_mode = own`, SAAS.md §7.1) *(ask)*: do
  their apps sell plans in-app too?
- **App prices** *(ask)*: whether the app may charge a different price from the web, to cover
  the commission or to fit Apple's and Google's price points.
- **One billing source per store** *(decide)*: what happens when a store paying through Stripe
  buys in the app, or the reverse, and how a store moves between them.
- **Plan change rules** *(decide)*: Apple and Google apply their own upgrade and downgrade
  timing, not SAAS.md §7.2's proration. Accept theirs for in-app plans, or adjust.
- **Extra bandwidth** *(decide)*: a consumable in-app product, with its price points per
  partner.
- **Receipt handling** *(decide)*: validate purchases and handle notifications in `apps/api`,
  or use a third-party service such as RevenueCat. A service means less code but a new
  dependency and another place where billing data is kept.
- **The docs that change when this is built:** SAAS.md §7, store/FIRST-RELEASE.md §16 and
  DATA-MODEL.md (the billing source).
