# DF Store: incomplete features

This lists what the DF Store prototype starts but doesn't finish:

- actions that only show a toast,
- promises the UI makes with nothing behind them,
- flows that stop partway,
- things that contradict each other.

Features with no design at all are in [MISSING-FEATURES.md](MISSING-FEATURES.md).

Last updated: 2026-09-29. Line numbers refer to the files in this folder. "Toast only"
means the button shows a message and nothing else happens.

Everything in the prototype is dummy data. This list covers **design** gaps, meaning things
a developer can't build from the prototype without making a decision first. It doesn't list
the missing backend.

---

## 1. Cross-cutting

| # | Issue | Evidence |
|---|---|---|
| 1 | **Upgrade prompt names the wrong plan.** `app.upgrade(f)` drops the plan key. Any caller that passes a text label falls through to "Partner · Talk to us". This affects Reports, Remove "Powered by", more products, 25 photos, A+, more size charts and Catalogue settings. | `DF Store Prototype.dc.html:610`; PortalReports:61, PortalStorefront:133, CatEditor:524/814/833, CatSizeCharts:101, CatSettings:87/123 |
| 2 | **Plan names mixed up in the copy.** The internal key `starter` is shown as "Growth", and `growth` as "Growth Pro". Offers and Carts gate at Growth Pro but say "Growth". "Growth allows 5,000 / 25" should say Growth Pro. "Own domain is on Starter" should say Growth. Billing says "Enterprise", but that plan is called Partner. | Offers:199, CatEditor:524/752, CatImport:169, CatSizeCharts:101, SetStore:90, PortalBilling:64/92, shell:588 |
| 3 | **Trial length differs across screens:** 10 days (Pricing), 14 days (sign-up), about 15 days (CatSettings "until 12 Oct"). | PortalAuth:73/107, CatSettings:118 |
| 4 | **DripFunnel prices always in ₹**, even for the US and DE stores. | shell:506, PortalBilling:59 |
| 5 | **No dark mode** in the Store. Platform and Admin have it. The Store hard-codes hex colours. | design.md §13 |
| 6 | **Loading, error, not-found and denied states are generic**, in the shell only. No screen has its own error state. The offline state is honoured only in CatEditor, OfferEditor, Offers, Carts and CatImport. | shell Scenario control |
| 7 | **Read-only (past due) isn't enforced everywhere.** Import still adds products. A+ still publishes. Catalogue settings still save. | CatImport:142, CatAPlus, CatSettings |
| 8 | **No Store activity log**, only per-object histories. | — |
| 9 | **Pricing page disagrees with the app.** It lists "Discount codes" and "Abandoned-cart emails" as *Planned*, but both are fully designed. It says the Growth Pro card includes suppliers (they are Business only). The FAQ puts AI on the wrong plan. There are no rows for the Offers limits the app enforces. | `DF Store Pricing.dc.html:100/120/124/138/141` |
| 10 | **Pricing's "Sign in" and "Start free" links** point at `DF Catalogue Prototype.dc.html`, which doesn't exist. | Pricing:26; design.md §13 |
| 11 | **Links that go nowhere.** "Edit branding" (white-label banner) and the `brand`, `plans` and `partner` routes land on the "isn't part of the Catalogue prototype" placeholder. | shell:148/391/560 |
| 12 | **Four unmounted files.** Decide whether to keep or delete `PortalBrand`, `PortalPartner`, `PortalPayouts` and `PortalPlans`. | design.md §1 |
| 13 | **Open decisions still unresolved:** what a supplier may see of a customer, who owns refunds across suppliers, whether editing an approved product sends it back for approval, what happens to a removed supplier's products, and whether 2FA applies to Owners only or to everyone. | uploads/DESIGN-BRIEF.md §4 |

---

## 2. By screen

### Sign-in and sign-up (PortalAuth)
- "Use a backup code instead" and "Contact support" are toast only (:115).
- There is no screen to set up or turn off two-step sign-in, and only SMS codes are
  supported.
- Sign-up never asks for country, currency or language. That is left to a card on Home.
- An invitation always assigns the Staff role, whatever the inviter chose.
- The "Privacy" and "Help" footer items aren't links.

### Home (PortalHome)
- The "Choose how you ship" and "Make your storefront yours" checklist items are hard-coded
  to not done, so they never tick (:137–138).
- "Average order · last 7 days" is calculated over all orders (:110).
- "Returning customers" is calculated wrongly (order count minus unique emails).
- "Restock" and "Fix" open Products without applying the matching filter.

### Orders and Customers (PortalOrders)
- Print packing slip, Print invoice and Export are toast only (:191, :228).
- The restock tick box on a refund doesn't change stock.
- The courier booking and label promise ("Filled in when the courier books it") has nothing
  behind it. When the tracking number is left empty, a random one is made up.
- Clicking a customer on an order opens Customers without selecting that customer (:215).
- Customers is a read-only list built from orders:
  - no create, edit, groups, tags or notes;
  - no export;
  - no consent information.
- **Returns and cancellations across suppliers:** the brief leaves these undesigned on
  purpose. They still need a decision.

### Offers and Offer editor
- "See orders with this offer" opens the unfiltered Orders list. Orders has no filter by
  offer (Offers:311).
- Export uses, Download codes, Download QR and bulk Export are toast only (Offers:313).
- The customer groups used by offers (VIP, Wholesale) are seed data. No screen manages them,
  although OfferEditor:160 says "Add people to groups on the Customers screen".
- "Specific customers" offers the 5 seed names, with no customer search.
- The rule "percentages only in multi-currency stores" is switched off in the code
  (`const dis = false`, OfferEditor:429), but the spec note describes it.
- The schedule uses "store time zone from Settings › Store info" (:301). **That field
  doesn't exist.**
- US tax in the test cart and receipt is hard-coded to Ohio 7.25% (`offers-lib.js:148`,
  OfferEditor:538).
- On an edit conflict, "Load their version" is toast only (:543).
- An offline draft is saved but never reloaded.
- In the storefront cart mock, "Apply" and "Checkout" are static text.

### Abandoned carts (Carts)
- "View order" opens the Orders list rather than that order (:339).
- "View customer" doesn't select the shopper (:440).
- "Send me a test" and Export are toast only (:465).
- Bulk send never includes a discount code, although a single send can.

### Reports (PortalReports)
- Custom reports is toast only: "builder opens (demo)" (:62).
- Every export is toast only.
- There is no traffic or conversion data ("Visitor sources need analytics — not shown", :57).
- The locked view has upgrade bug #1.

### Products (CatList)
- The supplier filter options are hard-coded (Northwind, Sanganer).
- The "Not in French" chip is hard-coded to French.
- Quick-edit stock only writes to the default warehouse.
- The checklist items "Choose how you ship" and "Set up your store details" are toast only
  (:335/338).
- Supplier bulk Export is toast only (:310).
- Export has no plan gate, but Pricing puts Export on Growth Pro.
- There is no bulk selection on phone.

### Product editor (CatEditor)
- **Stock history:** stock changes ask for a reason, "Shown in the stock history" (:819). No
  stock history exists anywhere.
- **Reserved stock:** "2 reserved for orders" is fixed text (:154).
- **Stock across warehouses:** only two hard-coded locations, and only for products without
  variants. Variants have a single stock number.
- **Per-market fixed price:** SetMarkets says to set it on each product (:95). The editor
  has no such field.
- **"More options … where it ships"** (:697): there is no such control.
- **Product types:**
  - Services are toast only, "not in the first release" (:732).
  - Digital downloads have no file upload.
- **Product video:** gated by plan, but there is no upload in the editor.
- **Translation:** only into French, even when Settings adds another language.
- **Barcode:** the import template has a barcode column, the editor has none.
- **Per-version values:** a version has no compare price, cost or weight of its own.
- **AI and lookup helpers are placeholders:**
  - "Write it for me" returns canned text.
  - "Suggest a translation" uses a small word list.
  - HS/HSN "Find" is a regex guess.
- **Edit conflict:** "Review her changes" is toast only (:520).
- **Photo upload** is simulated.

### A+ content (CatAPlus)
- The module limit is hard-coded (`trial ? 10 : 7`, :76) instead of coming from the plan.
- There is no image upload or crop, although the panel promises a crop tool (:53).
- Feature items, gallery, box and video contents can't be edited.
- The comparison chart uses fixed rival products (:94).
- "Save draft" saves nothing (:124).
- The "shared" Brand story block has no sharing logic.
- There are no role or read-only checks.

### Collections, Filters and Menus (CatCollections, CatSizeCharts)
- Price-range rules "aren't possible yet" (:79).
- Filters can't be deleted, only their values.
- Collections have no image, no SEO fields and no product sort order.
- Menus:
  - one main menu only;
  - items can only be collections;
  - two levels at most.
- Size charts: "+ Other size systems" makes up the numbers.
- The size-chart limit copy names the wrong plan.

### Import and export (CatImport)
- **Leaving the page stops the import.** The screen says "You can leave this page" (:77),
  but `componentWillUnmount` stops the run (:101).
- The file picker is a demo with canned rows.
- Template, error-file and export downloads are toast only (:159).
- The warehouse choice lists only the two hard-coded locations.
- There is no read-only check and no plan gate on export.
- There is no column-mapping step, no image ZIP and no customer or order import.

### Storefront (PortalStorefront)
- The AI can edit **only the hero section** (headline, subheading, button, colours).
- "Go back to this" (revert) doesn't really restore that version (:131).
- "View live site" is toast only (:133).
- There is no preview link to share, and no page, header or footer editing.

### Settings
- **Tab host (PortalSettings):**
  - CatSettings still has its own unused tab bar showing the placeholder text (CatSettings:95).
  - There are no tabs for notifications, checkout, policies, domains, API or time zone.
- **Store info (SetStore):**
  - Logo "Replace" is toast only (:99).
  - Connecting your own domain shows a CNAME and then a toast. There is no
    verify → certificate → live status. The brief says this is a multi-day asynchronous
    flow.
  - There are no time zone, unit or order-number fields.
- **People and Suppliers (SetTeam):**
  - Resend invite is toast only (:64).
  - There is an unused `invite` function with an empty handler (:50).
  - A supplier invite asks for the company and access level but **never for the first user's
    email**, although the brief says it creates the supplier and their first user.
  - Supplier users can't be managed one by one.
- **Payments, Shipping and Warehouse (SetOps):**
  - The courier "Manage" button (pickups, labels, tracking) is toast only (:70).
  - "Test all" is toast only.
  - Uploading a postcode list makes up "1,240 codes" (:72).
  - "Save invoice settings" doesn't save (:95).
  - Pickup promises "address and hours show at checkout" (:61), but there is no hours field.
  - Warehouses can't be edited, renamed or deleted.
- **Catalogue (CatSettings):**
  - Badges can be switched on, but nowhere defines or assigns them.
  - There are no read-only checks.
- **Markets (SetMarkets):**
  - "Its own domain (Business)" has no domain field (:41).
  - The duties toggle has no settings behind it.
  - The country list is hard-coded to 13 countries.

### Billing and plan changes (PortalBilling, PortalKeep)
- Invoice PDF, export and "Change card" are toast only.
- The card form asks for a raw card number in a plain text field (:101). It needs a hosted
  payment field so the card number never touches DripFunnel.
- "Download my data first" also starts closing the store (:102).
- There is no billing address or GST/VAT number for DripFunnel's invoice. It exists only in
  the unmounted PortalPayouts.
- A plan change shows no proration.
- PortalKeep asks the merchant to keep one courier, but never applies that choice. Only
  payment gateways get switched off (:66).

### Shell
- "My profile" is toast only (shell:635). There is no screen for name, email, password or
  two-step sign-in.
- "Ask Farhan for access" and "Send request" (upgrade request from a Manager) are toast only.
- "View on your store" after saving a product is toast only.

---

## 3. Suggested fixes, quickest first

1. Fix the upgrade-prompt key (#1), plan names (#2), trial length (#3), currency (#4) and
   Pricing links (#10). These are copy and one-line fixes.
2. Make the two promises the UI makes but doesn't keep:
   - import keeps running after you leave the page,
   - revert really restores the chosen version.
3. Design the pieces other screens already point to:
   - store time zone,
   - customer groups,
   - stock history,
   - the per-market price field,
   - the market domain field,
   - badges,
   - My profile.
4. Design the custom-domain status flow and the supplier first-user invite.
5. Decide the five open questions in #13, then design returns and refunds across suppliers.
