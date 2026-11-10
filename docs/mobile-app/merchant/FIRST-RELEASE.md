# mobile-app/merchant: the first release

What the merchant mobile app's first release contains. The framework is in
[REACT-NATIVE.md](REACT-NATIVE.md); builds and store accounts are in
[BUILDS-AND-STORE-ACCOUNTS.md](BUILDS-AND-STORE-ACCOUNTS.md).

**Status: decided, and being built:** what each card built, product customisation (#1374) among them, is listed in [ARCHITECTURE.md](ARCHITECTURE.md) §5.

Last updated: 2026-11-10 (#1374: built; reordering, currencies and choice photos on the phone, §2). Before: 2026-11-09 (#1367: product customisation, answers on orders and the question editor, §2). Before: 2026-10-09 (#493: no Billing and no in-app purchase in the app).

---

## 1. Decisions

| Decision | Rejected | Why |
|---|---|---|
| **The same scope as the web portal's first release** ([store/FIRST-RELEASE.md](../../ui/store/FIRST-RELEASE.md) §1), with the same roles, permissions and supplier views, except Billing (decided 2026-10-08; Billing out, decided 2026-10-09) | A smaller mobile-only set (orders, stock, notifications) | One product on one Store API: a merchant can do on the phone what they do on the web, and every rule (permissions, plan limits, supplier isolation) is already enforced by the server. |
| **Behaviour comes from the Store prototype's Phone frame** (`designs/DF Store Prototype.dc.html`, `device=phone`) and the phone rules in `designs/design.md` §4 and §7 (decided 2026-10-08) | A separate mobile design | The prototype already draws every screen at phone width, and the web portal is built phone first at 360 px (store/FIRST-RELEASE.md §2). |
| **Billing is not in the app, and in-app purchase is not required.** Plan gates and plan banners show their message with no buy or upgrade action (decided 2026-10-09) | Plans and extra bandwidth bought through in-app purchase (the 2026-10-08 decision, replaced) | The Owner manages the plan in the web portal. An app that sells nothing needs no in-app purchase, so the platform needs no store webhooks, billing source or per-partner subscription products. |
| **Close my store is at the end of Settings › Store info**, Owner only (decided 2026-10-09) | Keeping it in Billing, as on the web (store/FIRST-RELEASE.md §16) | Billing isn't in the app, and Apple (5.1.1(v)) and Google require an app that creates accounts to let people delete them from inside the app. |

---

## 2. What differs from the web

Everything in store/FIRST-RELEASE.md §3–§17 is in the app except Billing. The differences:

- **Layout**, from the prototype's Phone frame: the menu becomes an overlay drawer, lists become
  stacked cards, fields are 44–48 px tall, content padding is 14–16 px.
- **Billing** (store/FIRST-RELEASE.md §16) is not in the app (§1). The plan, usage and invoices
  are managed in the web portal.
- **Plan gates and plan banners** (store/FIRST-RELEASE.md §2) show their message with no buy or
  upgrade action.
- **Close my store**, with "Download my data first", is at the end of **Settings › Store info**,
  for the Owner only (§1).
- **Product customisation** (specified on #1367, built by #1374; store/FIRST-RELEASE.md §6 and §11):
  the order screen shows each customised line's answers with each extra's amount, and its
  uploads open through the Store API's signed link; the product editor has the collapsed "Ask
  the shopper before they buy" section with every type, rule, price, limit and Copy
  (CATALOG-DESIGN part U), laid out by [DESIGN.md](DESIGN.md): each question a stacked card,
  its form full screen, reordered with Move up and Move down (decided on #1374: no dragging, as the
  app's other lists). Amounts are typed in the pricing currency, other currencies' go back as they
  came, and a choice's photo is added on the web portal (#1374). A product with no questions looks as today.

---

## 3. In-app purchase

Not in the app (decided 2026-10-09, §1).

---

## 4. Open questions

None. The in-app purchase questions were retired with §3 (decided 2026-10-09).
