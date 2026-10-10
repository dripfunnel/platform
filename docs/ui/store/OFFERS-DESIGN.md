# OFFERS-DESIGN.md

The prompt for a design session on the **Offers** part of the merchant portal
(`apps/ui/store`): automatic discounts, coupon codes, buy-one-get-one, free shipping, who an
offer is for, when it runs, how often it can be used, how offers combine, what the shopper
sees, and how an offer performed. It was ported from the first
platform's OFFERS-DESIGN-PROMPT on 2026-09-28, with its framework facts replaced by the requirements of our own engine's
promotions module ([PLATFORM-PROMPT](../../api/PLATFORM-PROMPT.md) §3.2, §3.3, §5.4, §5.10).
The vocabulary, principles, parts, scenarios, states, "never do" rules and open questions
carry over. Where this document disagrees with [docs/ARCHITECTURE.md](../../ARCHITECTURE.md)
or [docs/USERS-AND-DOMAINS.md](../../USERS-AND-DOMAINS.md), those two win.

Last updated: 2026-10-05.

It is written for stores anywhere in the world, with region-driven tax, currency and pricing
law (PLATFORM-PROMPT §2 item 9). It expands [DESIGN-BRIEF.md](DESIGN-BRIEF.md) §1 fact 11 and
flows 42–47, and follows the conventions of [CATALOG-DESIGN.md](CATALOG-DESIGN.md)
(vocabulary, regions, plans, states). Paste §1 to start. Then name a part from §6, or say
"all of it, in order".

**How to read the markers.** Nothing in the engine is built yet, so every fact in §3 is an
engine requirement. "**Engine provides**" means PLATFORM-PROMPT decides the engine must do it
(§3.2 lists what the first release must cover; §5.4 lists what the promotions module must
support). "**`(release: decide)`**" means it is an engine requirement whose release is
undecided (PLATFORM-PROMPT §3.3, §8, §10). `*(ask)*` and `*(decide)*` mark product questions
that are still open (§9).

---

## 1. The prompt

> You are designing the **Offers** section of the **DripFunnel merchant portal**
> (`apps/ui/store`): the screens where a merchant creates and manages discounts on their
> store. The portal runs on the partner's portal host in the partner's look, and talks only
> to the **Store API** (GraphQL). Sign-in, store settings, people, suppliers and warehouses
> are specified, and Catalogue is being designed ([CATALOG-DESIGN.md](CATALOG-DESIGN.md)).
> Offers is not built. It gets its own row in the left bar, **Offers**, for the Owner and the
> Manager only.
>
> **Who this is for.** Picture a first-time seller anywhere in the world: a boutique in Ohio, a
> ceramicist in Lisbon, a spice shop in Manchester, a kurta brand in Jaipur. They know what
> "10% off", "Buy 2 get 1 free" and "Free delivery over $50" mean, because they have seen them
> in shops all their life. They do **not** know what a condition, an action, a filter
> value, a priority score or an order-line adjustment is, and they should never need to. The
> standard is **Shopify's discount builder, simplified further**: start from what the seller
> wants to happen ("Give 20% off the Summer collection"), never from the machinery.
>
> **The core idea.** Every offer answers five plain questions, in this order, on one page:
> 1. **What does the shopper get?** (the discount)
> 2. **How do they get it?** (automatically, or by typing a code)
> 3. **What must they buy?** (the minimum, if any)
> 4. **Who is it for?** (everyone, or some customers)
> 5. **When and how often?** (dates and usage limits)
>
> A live **summary card** beside the form restates the offer as one sentence a shopper would
> understand ("20% off everything in Summer Collection · code SUMMER20 · orders over $50 · ends
> 31 Aug · once per customer"). If the sentence reads wrong, the offer is wrong.
>
> **Read first.** [DESIGN-BRIEF.md](DESIGN-BRIEF.md) (portal-wide facts, especially 6, 9 and
> 11), [CATALOG-DESIGN.md](CATALOG-DESIGN.md) §2 (vocabulary), §3 facts 5–6 and 36–41 (money,
> tax, regions, "was" prices) and part P (plans). Everything below is also specification.
>
> **The backend is our own commerce engine** (one Cloudflare Worker, `apps/api`, on Postgres;
> PLATFORM-PROMPT §5.4 "Promotions"). Nothing is built yet. Its promotions module is a
> registry of platform-defined, typed **operations** (conditions and actions) that merchants
> configure per store and never extend with code (PLATFORM-PROMPT §5.10). The engine computes
> every discount server-side; the storefront only displays it. The UI may use any words it
> likes, but it must not promise anything the engine will not do. §3 lists the engine facts
> that shape each screen. Features the engine must provide but whose release is undecided
> (collections as targets, "can't be combined", bulk unique codes, first order only,
> per-currency amounts, and more) are labelled **`(release: decide)`**. Design them anyway,
> so the release decision is a decision, not a surprise.
>
> **How to work.** One part at a time (§6). For each screen, produce:
> 1. The happy path, then **every** state in §7: empty, loading, error, permission denied,
>    read-only (subscription past due), Store API unreachable, slow network, and the phone
>    layout.
> 2. The **actual words**: labels, helper text, button copy, errors, empty states, and the
>    summary sentence. Words are most of this job.
> 3. A short table mapping each control to the engine field, condition or action behind it
>    (§3), so an engineer can build the Store API and the screen without guessing.
> 4. The scenarios from §6 the screen covers, ticked off, so gaps are visible.
>
> Ask me when the spec is silent (§9 lists what is known to be open). When it decides
> something, follow it. Start by restating, in your own words, who the users are and what an
> "offer" means to them. Then wait for me to pick a part.

---

## 2. Plain-language vocabulary

The UI speaks the left column. Engine terms appear only in the engineer mapping, never on
screen. Engine names below are **proposed** until the data model (DATA-MODEL.md, not yet
written) fixes them.

| Say this on screen | Engine concept (proposed) | Explain it as |
|---|---|---|
| **Offer** | `promotion` row (store-scoped) | "A discount on your store: money off, something free, or free delivery." |
| **Automatic discount** | a promotion with no coupon code | "Applies by itself at checkout when the order qualifies. No code needed." |
| **Coupon code** | the promotion's coupon code (unique per store; bulk codes in a codes table) | "A word shoppers type at checkout, like SUMMER20." The storefront box reads "Discount code or coupon". |
| **What the shopper gets** | action operations | Never "action". |
| **What they must buy** / **Minimum** | condition operations | Never "condition" or "rule". |
| **Customer group** | customer group + a customer-group condition | "A list of customers you choose, like 'VIP' or 'Wholesale'." |
| **Products / versions** | product and version ids in a product-picker argument | Pick products; how later versions are treated is §3 fact 5. |
| **Filter value** (e.g. Fabric: Cotton) | catalogue filter value | "Every product tagged Cotton", using the catalogue's own filter words. |
| **Collection** | collection as a condition or action target | Engine provides (§3 fact 5). |
| **Starts / Ends** | `starts_at` / `ends_at` | In the store's time zone, never UTC (§3 fact 9). |
| **Total uses** | usage limit | "How many times this offer can be used across your whole store." |
| **Uses per customer** | per-customer usage limit | "How many times one shopper can use it." |
| **On / Off** | `enabled` | "Off" pauses it without deleting anything. |
| **Scheduled / Live / Ended / Used up / Off** | derived from `enabled`, dates, limits | See §3 fact 9. Never show "enabled: false". |
| **Name shoppers see** | promotion name (translatable), snapshotted on the order's discount line | Appears on the shopper's cart, receipt and invoice (§3 fact 13). |
| **Note for your team** | internal name or note, separate from the shopper-facing name | `(release: decide)`. "Only you see this, e.g. 'Instagram giveaway, Oct'." |
| **Discount given** | order discount adjustments | "How much shoppers saved." Shown in the store's currency. |
| **Combines with** | combination rules | Engine provides (§3 fact 7). |

---

## 3. Engine facts that shape the interface

Each of these changes what a screen can show or promise. Nothing is built yet: each fact is
a requirement on the engine's promotions module, and the numbering is kept from the first platform
so citations such as "OFFERS §3 fact 10" stay valid. Once the Store API exists, verify
anything doubtful against its generated schema (`apps/api/schema/`) and the engine's
promotions tests before relying on it.

1. **An offer is: a name, zero or more conditions, one or more actions, an optional coupon
   code, optional dates, optional limits, and an on/off switch.** This is the model the
   engine carries over (PLATFORM-PROMPT §3.2 "Promotions": automatic and code offers,
   conditions, actions, dates, limits, all first release).
   - With **no conditions and no code**, it applies to **every order** automatically. The UI
     must make that loud ("This gives 10% off every order on your store, starting now").
   - The five questions of §1 are a presentation over this one record. In this model there
     is no draft state: an offer that is saved and **On** with no start date is **live
     immediately**. So "Save" on a new offer asks **Start now / Schedule / Keep off**, and the
     engine has **no draft state** (decided 2026-10-05 on #337).
2. **Conditions combine with AND, and the engine also supports OR.** PLATFORM-PROMPT §5.4
   requires "conditions with AND/OR". AND stays the default and the plain reading of the
   form.
   - The first release's form does **not** expose "either A or B" in one offer; the engine
     still supports OR (decided 2026-10-05 on #337). An offer for "VIP customers **or** orders over $100" is
     two offers.
   - Design the words so the combination is never ambiguous ("Orders over $50 **and**
     containing a Summer product").
3. **Conditions** (these map to question 3, "What must they buy?", and 4, "Who is it
   for?"). Each is a platform-defined operation with typed arguments (PLATFORM-PROMPT §5.10).
   Keys are proposed.

   | On screen | Engine operation (proposed key) | Release | Notes |
   |---|---|---|---|
   | Order total at least $X | `minimum_order_amount` (`amount`, `tax_inclusive`) | Engine provides (first release) | Ask "including tax?" only as the store's own default (§3 fact 11); never as a raw checkbox. Amount per currency (fact 10). |
   | Buys at least N of these products | `contains_products` (`minimum`, products) | Engine provides (first release) | |
   | Buys at least N items tagged … | `at_least_n_with_filter_values` (`minimum`, filter values) | Engine provides (first release) | Uses catalogue filter values. |
   | Customer is in group … | `customer_group` (group ids) | Engine provides (first release) | Several groups as "any of" relies on OR (fact 2). |
   | Buys X of these, gets Y of those | `buy_x_get_y` (pairs with the action below) | Engine provides (first release) | |
   | Buys from this collection | `contains_collection` | Engine provides (§5.4, §5.10) | Fact 5. |
   | First order only | `first_order` | `(release: decide)` | PLATFORM-PROMPT §3.3, §5.10. |
   | Specific customers | `specific_customers` | `(release: decide)` | PLATFORM-PROMPT §3.3. Replaces the first platform's "hidden group" workaround. **Wanted**, with a customer picker (decided 2026-10-05 on #337). |
   | Shipping country / region | `shipping_country` | `(release: decide)` | PLATFORM-PROMPT §5.10. |

   Also engine requirements, all `(release: decide)`: a minimum *quantity* across the whole
   cart, payment method, "not already on sale", signed-in customers only, a **maximum**
   order total.
4. **Actions** (question 1, "What does the shopper get?"). Keys are proposed.

   | On screen | Engine operation (proposed key) | Release | Notes |
   |---|---|---|---|
   | % off the whole order | `order_percentage_discount` | Engine provides (first release) | |
   | $ off the whole order | `order_fixed_discount` | Engine provides (first release) | Capped at the order subtotal, so it never goes negative. Amount per currency (fact 10). |
   | % off chosen products | `products_percentage_discount` | Engine provides (first release) | Product targets: fact 5. |
   | % off products tagged … | `filter_value_discount` | Engine provides (first release) | Follows the catalogue's filter values, so new matching products are included. |
   | $ off chosen products | `line_fixed_discount` | Engine provides (first release) | **Per unit** (decided 2026-10-05 on #337): 2 × T-shirt at $5 off = $10 off. Word it exactly so; the first platform's action was per line. |
   | % or $ off a collection | `collection_discount` | Engine provides (§5.4, §5.10) | Fact 5. |
   | Free shipping | `free_shipping` | Engine provides (first release) | Removes **all** shipping on the order. |
   | Y free when buying X | `buy_x_get_y` | Engine provides (first release) | The **cheapest** qualifying item is made free, **repeating per qualifying set** unless "once per order" is set (decided 2026-10-05 on #337); state the rule in the summary. |
   | Tiered ("10% over $50, 15% over $100") | `tiered_discount` | `(release: decide)` | PLATFORM-PROMPT §3.3, §5.10. |
   | A cap on a % discount ("20% off, up to $30") | argument on the % actions | `(release: decide)` | PLATFORM-PROMPT §3.3. |

   Also engine requirements, all `(release: decide)`: $ off *per item* (if the line action
   is per line); % or $ off the "get" item in buy X get Y (e.g. "second one half price"); a
   **fixed price** ("any 3 for $50"); partial shipping discounts ("$5 off delivery") or free
   shipping on one method only; an automatic **free gift** added to the cart; "applies to
   the cheapest item".
5. **Targets: products, versions, filter values and collections.**
   - The engine provides **collections as targets** for conditions and actions
     (PLATFORM-PROMPT §5.4 "actions on products, collections, order and shipping"). Shopify
     sellers think in collections, so a collection is a first-class choice on the form, next
     to specific products and filter values ("Discount everything tagged Summer", linked to
     Catalogue › Filters).
   - **Versions added later.** Picking a product means **all its versions, now and later**,
     resolved when the cart is priced (decided 2026-10-05 on #337).
   - **Exclusions** ("everything except gift cards") are an engine requirement,
     `(release: decide)` (PLATFORM-PROMPT §3.3).
6. **Coupon codes are unique per store** (PLATFORM-PROMPT §5.1: unique constraints are per
   store, never global).
   - **Bulk unique codes** ("1,000 single-use codes for an influencer campaign") are one offer
     with many codes, each with its own usage. The engine provides them (PLATFORM-PROMPT
     §5.4); release `(release: decide)`. Design the bulk generator.
   - **Case.** Shoppers type "summer20". The UI normalises codes to uppercase on save and says
     so; the engine matches codes **case-insensitively** (decided 2026-10-05 on #337).
   - **Clash on save**: "SUMMER20 is already used by another offer (Summer sale 2025)", with a
     link. A deleted offer **keeps** its code: codes stay unique per store including
     deleted ones (fact 14, settled on #188).
   - **Shopper-facing errors** come from the Shop API as distinct results: invalid, expired,
     limit reached (names to be fixed in the Shop API contract). Design the storefront copy
     for each (part O).
7. **Combining offers: deterministic order and combination rules.** PLATFORM-PROMPT §5.4
   requires **combination rules** and a **deterministic application order**, so "everything
   stacks, in an order the merchant can't see" (the first platform's behaviour) is not the
   target.
   - The application order is fixed and documented by the engine (for example product
     discounts, then order discounts, then shipping (decided 2026-10-05 on #337)), and the same cart always
     prices the same way. The portal can therefore explain it.
   - **Combination rules**, designed Shopify-style: this offer *combines with* product
     discounts · order discounts · shipping discounts · other codes. "This code can't be used
     with other codes", "doesn't combine with automatic discounts" and "one coupon per order"
     are all expressions of these rules. A new offer combines with **nothing** by default; the
     merchant opts in (decided 2026-10-05 on #337).
   - "Only the best discount applies" is an engine requirement, `(release: decide)`.
   - **The UX consequence is unchanged**: a 20% code plus a 30% sale is a common and
     expensive mistake. Whatever the rules allow, the portal **warns** when a new offer can
     stack with a live or scheduled one ("This stacks with 'Summer 30%' on 42 products: a
     shopper could get 50% off"). If combination rules are not in the first release,
     everything that qualifies stacks, and the warning is the only protection.
8. **Usage limits are counted from placed orders.**
   - Total uses and uses per customer work for codes and for automatic offers. The engine's
     usage counting must survive concurrency (PLATFORM-PROMPT §5.4, §5.9): two shoppers
     placing orders at once can't both take the last use.
   - "Per customer" only works once the shopper is known. A **guest** is recognised by normalised
     email, or by phone only once proven by a code (mobile sign-in, ACCESS §2.1); a typed,
     unproven phone never counts (decided 2026-10-05 on #337). Limits are best-effort for guests. The form's helper
     text (a `messages/` key) says so: guests are recognised by email, and shoppers who signed
     in with a mobile code by their number.
   - An order **cancelled before fulfilment gives the use back**; a refund does not (decided 2026-10-05 on #337).
   - Show usage as "38 of 100 used".
9. **Status is derived, not stored.** The portal (or the Store API) computes it from
   `enabled`, `starts_at`, `ends_at` and usage:
   - **Off**: switched off by the merchant.
   - **Scheduled**: on, starts in the future ("Starts in 3 days, Fri 3 Oct, 9:00").
   - **Live**: on, within dates, not used up.
   - **Ending soon**: live, ends within 48 h *(threshold: ask)*.
   - **Ended**: past its end date.
   - **Used up**: total uses reached.

   These are the states [DESIGN-BRIEF.md](DESIGN-BRIEF.md) fact 11 warns are routinely
   confused. Each needs a distinct colour, icon **and** word; never colour alone.
   - Dates are stored as instants. The UI shows and accepts them in the **store's time zone**
     and says which ("Ends 31 Aug, 23:59 London time"). The store's time-zone setting lives
     in **Settings › Store info** and ships in the first release (decided 2026-10-02,
     PLATFORM-PROMPT §3.3). "Ends at midnight" means 23:59:59 local, not 00:00 the next day.
10. **Money is in minor units, with a currency on every amount.**
    - Fixed amounts ($ off, minimum order total) are integers in minor units with a currency
      code (PLATFORM-PROMPT §5.4 "Money"). The UI shows and accepts major units formatted
      with `Intl.NumberFormat` (see [CATALOG-DESIGN.md](CATALOG-DESIGN.md) §3 fact 5).
    - **Per-currency amounts** are an engine requirement (PLATFORM-PROMPT §5.4), and "a single
      integer amount applied in every currency" is on the list of mistakes not to
      copy (PLATFORM-PROMPT §5.10). In a **multi-currency** store a fixed-amount offer carries
      one amount per currency the store sells in (10.00 USD, 9.00 EUR, 1,500 JPY), never the
      same integer read as different money.
    - The form shows **one value per currency, pre-filled by conversion from the main
      currency and editable** (decided 2026-10-05 on #337). Percentages are safe in every currency.
11. **Tax changes what "$10 off" and "over $50" mean.**
    - In a **tax-inclusive** store (EU, UK, India, Australia) the discount comes off the price
      the shopper sees, and the tax inside it shrinks with it.
    - In a **tax-exclusive** store (US, Canada) the discount comes off before sales tax is
      added.
    - The minimum order condition compares either with or without tax (`tax_inclusive`).
      Default it to the store's own setting and show it in words ("Order total, including
      VAT, at least €50").
    - Order-level discounts are spread across the lines, and tax is recalculated per line.
      The engine owns that allocation and its rounding in one place, with golden tests per
      region (PLATFORM-PROMPT §5.4 "Money", §5.9). The preview (part O) must show the
      shopper's real total from the engine, not a naive subtraction.
12. **Customer groups are part of the engine; segments are not yet.** The engine provides
    customer groups (PLATFORM-PROMPT §3.2 "Customers", §5.4). A merchant can make a group
    ("VIP") and add customers to it (the Customers screen's Groups tab and each customer's
    page, designed 2026-10-02; the same list the offer editor picks from and creates into).
    Automatic segments ("spent over
    $500", "hasn't ordered in 90 days", "subscribed to emails") are an engine requirement,
    `(release: decide)`. Design picking a group, creating one inline, and seeing "12
    customers in VIP".
13. **The offer's name is shown to shoppers.** The engine snapshots the promotion name onto
    the order's discount line (discounts are adjustments on the order, PLATFORM-PROMPT
    §5.10), which appears in the cart, emails and invoices. So "Test — do not use" or
    "Priya's Diwali experiment" would reach shoppers.
    - Label the field **"Name shoppers see"**, with a preview ("Summer sale −$12.00").
    - An **internal name** separate from the shopper-facing one is an engine requirement,
      `(release: decide)` (PLATFORM-PROMPT §3.3).
    - The name and description are **translatable** (part S).
14. **Deleting stops an offer applying; past orders keep their discount.** Order lines carry
    immutable price snapshots (PLATFORM-PROMPT §5.4 "Orders"), so orders already placed still
    show what was taken off. ~~Whether deletion is soft (the row kept and hidden) *(decide)*.~~
    **Settled 2026-10-02 on #188's review** (DATA-MODEL §7.7): soft; the code stays unique per store including
    spent and deleted ones.
15. **Offers are the merchant's alone** ([DESIGN-BRIEF.md](DESIGN-BRIEF.md) fact 11,
    PLATFORM-PROMPT §2 item 5).
    - Promotions are store-scoped rows (`store_id`), read and written only through the scoped
      query layer (PLATFORM-PROMPT §5.1), so one merchant never sees another's.
    - The Owner and the Manager have the offers permissions (read, create, update, delete) in
      their code-defined permission sets. **Staff have none** *(ask whether Staff should at
      least read offers to answer customer questions)*. **Vendors, in every tier, have none,
      have no Offers screen, and never see an offer's name, code or rules.**
    - Every offers resolver in the Store API declares its permission and tenant scope, and a
      structural test proves it (PLATFORM-PROMPT §2 item 17). Hiding a button is not a gate.
16. **Offers apply when the cart is priced.**
    - The engine re-evaluates prices and offers whenever a cart changes (PLATFORM-PROMPT §5.4
      "Cart and checkout"). Changing or ending a live offer affects carts already in progress
      the next time they are priced. Placed orders are never changed.
    - So "Turn off" and "Change the discount" on a live offer are high-consequence
      ([DESIGN-BRIEF.md](DESIGN-BRIEF.md) flow 46) and must say what happens to carts in
      progress.
17. **Automatic discounts are invisible until the cart, unless the Shop API exposes them.**
    Offers apply to orders, not to product prices. A "20% off Summer" offer does **not**
    change the price on the product page or in listings unless the Shop API returns a
    discounted price and the storefront shows it.
    - The engine computing a product's price after automatic offers for the Shop API, and
      `@dripfunnel/storefront-core` showing "Sale −20%" badges and crossed-out prices, are
      engine and storefront requirements, `(release: decide)`. The storefront may display
      them but never assert them (PLATFORM-PROMPT §5.5).
    - **A "was / now" price on the product page is regulated** (EU Omnibus: the lowest price
      of the last 30 days; UK and US equivalents; India's MRP ceiling). See
      [CATALOG-DESIGN.md](CATALOG-DESIGN.md) §3 fact 41. A permanent reduced price is a
      catalogue "compare-at price", not an offer. Explain the difference where a merchant
      might confuse them.
18. **Vendors' products can be discounted by the merchant.** An order-wide offer spreads
    across lines from several suppliers, and so across **vendor sub-orders**
    (PLATFORM-PROMPT §3.3, §5.4 "Orders").
    - The vendor never sees order totals ([DESIGN-BRIEF.md](DESIGN-BRIEF.md) fact 6) or any
      offer's name, code or rules (fact 15). Whether a vendor's "Your sales" shows the line
      price before or after the merchant's discount, and **who pays for the discount**, is
      *open* and commercially important (and ties into vendor payouts, PLATFORM-PROMPT §10).
    - The offer form can warn: "This includes 14 products from Northwind Textiles."
19. **Results are computable but not ready-made.** Orders are linked to the promotions they
    used, so uses, discount given and sales with the offer can be counted. Aggregating them
    for the portal is engine reporting work, `(release: decide)`. Anything like "extra sales
    because of this offer" is out of reach *(don't promise it)*.
20. **A test cart can be priced without placing it.** Because pricing is server-side, the
    engine can offer a dry-run: price a hypothetical cart for this store with a draft or
    saved offer and return lines, discounts, tax, shipping and total. It must not count a
    use, reserve stock or create an order. Engine requirement, `(release: decide)`. It powers
    "Try this offer" (part O).

### 3.1 What the engine built (#320, SAPI 14)

`apps/api/src/engine/modules/promotions` (`definition.ts` holds every argument, `pricing.ts` the pricing). Amounts are
minor units per currency (`{ "INR": "50000", "USD": "600" }`); ids are the store's own.

| Kind | Key | Arguments |
|---|---|---|
| Condition | `minimum_order_amount` | `amounts` |
| | `minimum_quantity` | `minimum` (units in the whole cart) |
| | `contains_products`, `contains_collection`, `at_least_n_with_filter_values` | `minimum`, and `productIds`, `collectionIds` or `filterValueIds` |
| | `customer_group`, `specific_customers` | `groupIds` (any of), `customerIds` |
| | `first_order` · `shipping_country` | none · `countries` |
| | `recurrence` | `days` (0 is Sunday), `from`, `to` (`HH:MM`, the store's time zone) |
| | `any_of` | `conditions`: two to ten of the above (the engine's OR) |
| Action | `order_percentage_discount` · `order_fixed_discount` | `percent` (1–100) and an optional `cap` · `amounts` |
| | `products_percentage_discount` · `line_fixed_discount` (per unit) | `percent` and optional `cap` · `amounts`; both `targets` and `exclude` (`giftCards`, `onSale`) |
| | `free_shipping` · `shipping_fixed_discount` | none · `amounts` |
| | `buy_x_get_y` | `buy` and `get` (`quantity`, `targets`; `get.targets` null is "the same"), `percent` off (100 is free), `oncePerOrder` |
| | `tiered_discount` | `kind` (`percent` or `fixed`), two to five `tiers` (`minimum`, then `percent` or `amounts`) |

**Decided here** (#320), where the facts above left the engine a choice:
- **One action per offer.** The four types of §5 are one action each; the tables hold more for later.
- **Targets are one argument** (products, collections and filter values, any of them) on the two product actions,
  rather than separate `filter_value_discount` and `collection_discount` keys; `buy_x_get_y` is an action only.
- **Inside a stage the biggest discount goes first** (as each would price alone, then the oldest offer, then by id), and
  an offer is skipped when it and one already taken don't combine both ways. So the same cart always prices the same way,
  and two offers that don't combine give the shopper the better one.
- **An amount not set in the cart's currency means the offer doesn't apply in it** (a fixed amount, a minimum, a cap or a
  tier), never a conversion at pricing time (fact 10).
- **The minimum compares with the goods as priced in the store's own tax setting** (including tax in a tax-inclusive
  store, before tax otherwise: fact 11's default), after the product stage's discounts for an order or shipping offer.
- **Status ignores a repeating offer's windows**: it is Live between them; its time line says when it runs.
- **A shipping offer applies once a delivery is chosen**, to what that delivery costs.
- **Amounts are in the store's own tax mode**, so tax is computed afterwards, on what the lines come to after their discounts.
- **A guest who has given only a phone number can't use a once-per-customer offer** (`SIGN_IN_REQUIRED`): a typed number
  never says who they are (fact 8), so they sign in with a code by text first; before any contact is given it applies, and
  placement checks it again.
- **A preview's test order takes no use**, so trying an offer on the preview never spends a real limit or code.
- **A cart holds up to five codes**; a code that can't work whatever is added comes straight back off it, one whose
  conditions aren't met yet stays and applies once they are.
- **Used up or ended between pricing and paying**: placement refuses `OFFER_CHANGED` and the shopper sees the cart again
  without it, never an order at a price they didn't see.

---

## 4. Who uses it, and what they see

| Role | Offers |
|---|---|
| **Owner** (`owner`) | Everything: create, edit, pause, end, duplicate, delete, see results. Sees plan prompts (part U). |
| **Manager** (`manager`) | Same as Owner, without plan or billing prompts ("Ask your store owner to add this"). |
| **Staff** (`staff`) | A read-only Offers list, so they can answer "why didn't my code work?" (decided 2026-10-04 on #184). |
| **Vendor**, every tier: **Stock only** (`vendor-stock`), **Products and stock** (`vendor-catalogue`), **Products, stock and their orders** (`vendor-orders-fulfil`), read-only orders (`vendor-orders-read`) | **Nothing** (decided). No nav row, no URL, no mention. Opening an offers URL looks like "not found". |
| Partner **support session** (read-only, [USERS-AND-DOMAINS.md](../../USERS-AND-DOMAINS.md) §4.1; DripFunnel staff impersonate instead, §4.2) | Sees offers as the store sees them, read-only, while the merchant allows support access. Can't change anything without the merchant's per-session approval. |

Roles are fixed templates with permission sets in code; there is no role editor
([ACCESS.md](../../api/ACCESS.md)).

---

## 5. Design principles

1. **Start from the outcome.** The first screen is "What kind of offer?" with four big, visual
   choices, each with an everyday example:
   - **Money off products** ("20% off the Summer collection")
   - **Money off the order** ("$10 off orders over $50")
   - **Buy X, get Y** ("Buy 2 T-shirts, get 1 free")
   - **Free shipping** ("Free delivery over $40")

   Plus a row of ready-made **recipes** (part V). Automatic vs code is chosen *inside*, not
   first, because sellers think "what" before "how".
2. **One page, five questions, one sentence.** No wizard to edit. The live summary sentence
   (§1) is the source of truth for the merchant and updates as they type.
3. **Sensible defaults.** Automatic off, code on (most sellers mean a code); no minimum;
   everyone; starts now *(or off, fact 1)*; no end; unlimited uses; once per customer for
   codes. Every default is visible in the summary.
4. **Show the money.** Every choice shows its effect on a real example from their catalogue:
   "On a $40 Linen Shirt: shopper pays $32.00, you receive $32.00 (−$8.00)". In tax-inclusive
   stores include the tax line.
5. **Warn before it costs money.** Overlaps with live offers, discounts over 50%, no minimum on
   a fixed amount, no end date and unlimited uses on a public code: each gets a calm, specific
   warning, never a block.
6. **Live changes feel live.** Editing a live offer shows "Live now: changes apply to shoppers
   immediately" in the save bar. Turning one off asks for confirmation with the number of uses
   today.
7. **Status is always obvious.** Word + icon + colour, and a line of time ("Ends in 2 days",
   "Started 3 Oct", "Ended 31 Aug").
8. **Copy is shopper-proof.** Anything the shopper sees (name, code, error messages) is
   previewed as the shopper sees it.
9. **Phone first.** A merchant creates a flash-sale code from their phone in under a minute:
   big type choices, numeric keypads for amounts, a date picker in the store's time zone.
10. **Local by default, global by design.** Currency, tax words, date format, "delivery" vs
    "shipping", seasonal suggestions and pricing law come from the store's country. Show a US,
    an EU and an Indian version of any screen that differs.

---

## 6. Parts and scenarios

Numbered so coverage can be ticked off. Items marked *(ask)* need a decision first (§9).
Items marked `(release: decide)` are engine requirements whose release is open (§3).

### A. First-time experience

- A1. Empty Offers screen: one line of explanation, the four offer types as cards, and three
  recipes suggested by the store's region and season (part V).
- A2. A nudge from Home after the first 5 products: "Try a welcome code for new shoppers."
- A3. The first-save moment: "Your code WELCOME10 is live. Share it" (copy code, copy link
  (part Q), preview on store), or explain why it isn't live yet (scheduled, off, store not
  published).

### B. Offers list

- B1. Grouped or tabbed by status: **Live · Scheduled · Off · Ended** (Used up counts as
  Ended, with its own badge). Live first. Counts on each tab.
- B2. Each row: name shoppers see, code (or "Automatic"), what they get in words ("20% off ·
  Summer"), status with its time line, uses ("38 / 100"), and discount given so far.
- B3. Search by name or code, including a code a customer quotes on the phone.
- B4. Filter by type (products / order / buy X get Y / shipping), automatic vs code, status.
- B5. Quick actions per row: turn on/off, duplicate, copy code, view results, end now.
- B6. Bulk: turn off, end, delete, export (with a count and a list of what's affected).
- B7. Overlap marker: a small "Stacks with 2 live offers" note on rows that can combine (§3
  fact 7).
- B8. Empty tabs with specific copy ("No scheduled offers. Plan your Black Friday sale ahead").
- B9. Phone layout: cards with status first, a floating "Create offer" button.

### C. Create an offer: the shared frame

- C1. Type picker (§5 principle 1), then one page with five sections in §1 order, the summary
  card sticky on desktop and a collapsible bar on phone.
- C2. **How shoppers get it**: "Automatic at checkout" or "With a coupon code". Switching keeps
  everything else.
- C3. **Name shoppers see** (§3 fact 13), prefilled from the offer ("20% off Summer"), with a
  cart-line preview, and a separate internal note `(release: decide)`.
- C4. Save and turn on / Save as off / Schedule. Unsaved-changes guard, and the draft kept
  locally after a lost connection or session expiry.
- C5. Validation in plain words: "Choose at least one product", "Percentage must be between 1
  and 100", "End date is before the start date", "That code is already used by 'Summer
  2025'".

### D. Money off products

- D1. Percentage or fixed amount. Whether a fixed amount is **per cart line or per unit** is
  decided in the engine (§3 fact 4): word it as "$5 off each product in the cart" if per unit,
  or "$5 off each line (whatever the quantity)" if per line. The other variant is
  `(release: decide)`.
- D2. **Applies to**: specific products (search, multi-select, with version count and, if it
  applies, the "versions added later" note, §3 fact 5), products with a filter value
  ("Fabric: Linen"), or a collection (engine provides, §3 fact 5).
- D3. A preview of 3 real products with before/after prices, and a count ("Applies to 42
  products").
- D4. Exclusions ("except gift cards", "except products already on sale"): `(release: decide)`.
- D5. Warn when some chosen products already have a compare-at price ("12 products are
  already reduced; this takes a further 20% off").
- D6. Vendor products included: "Includes 14 products from Northwind Textiles" (§3 fact 18).

### E. Money off the order

- E1. Percentage or fixed amount off the whole order.
- E2. A fixed amount never makes an order negative (§3 fact 4); explain the cap in helper
  text only if a minimum is lower than the discount.
- E3. Strong nudge to add a minimum for fixed amounts ("$20 off with no minimum means a $20
  product is free").
- E4. Tiered ("$10 off $50, $25 off $100"): design as one offer with steps, mark
  `(release: decide)`, and show the fallback (separate offers, whose stacking then depends on
  the combination rules, §3 fact 7).
- E5. A cap on a percentage ("20% off, up to $30"): `(release: decide)`.

### F. Buy X, get Y

- F1. "Customer buys [N] of [these products]" and "gets [M] of [these products] free". Same or
  different products, with a one-line example ("Buy 2 socks, get 1 socks free").
- F2. Make clear whether the free item must be in the cart. In the model carried over it
  must be; the shopper adds it. Say so, and design the storefront hint ("Add 1 more to get it
  free", part O). An automatic free gift is F6.
- F3. Which item is free when several qualify (§3 fact 4, *decide*), stated in the summary.
- F4. "Get Y at 50% off" and "Get Y for $1": `(release: decide)`.
- F5. Repeats: does buying 4 give 2 free? *Decide the engine's behaviour* and offer "Limit to
  once per order" if it repeats.
- F6. Automatic free gift added to the cart: `(release: decide)`.

### G. Free shipping

- G1. Free shipping on the whole order, with an optional minimum ("Free delivery over £40").
- G2. The storefront progress hint ("£6.50 away from free delivery"), part O.
- G3. Only some countries, only some shipping methods, or "$5 off shipping":
  `(release: decide)` (§3 fact 4). The UI shows "Applies to all delivery methods and
  countries" until then.
- G4. Words follow the region: "shipping" (US) vs "delivery" (UK, India, EU English).

### H. Coupon codes

- H1. Type a code or "Generate one" (readable, no 0/O or 1/I confusion). Uppercase
  normalisation (§3 fact 6), allowed characters, and a live uniqueness check.
- H2. Code clash with a live, scheduled, ended or deleted offer, each worded differently.
- H3. Copy, share and QR code for print (in-store flyers, packaging inserts).
- H4. **Bulk unique codes**: "Make 500 single-use codes", prefix ("INSTA-"), length, download
  CSV, list with used/unused. Engine provides, `(release: decide)` (§3 fact 6).
- H5. Changing the code of a live offer: warn that the old code stops working for shoppers who
  already have it *(and ask: keep both?)*.

### I. Who it's for

- I1. Everyone (default).
- I2. Customer groups: pick one or more. Several groups mean "any of", which relies on OR
  conditions (§3 fact 2: the engine supports OR; whether the portal exposes it, *ask*).
  Create a group inline, see its size, link to the Customers screen.
- I3. Specific customers (search by name or email; designed 2026-10-02 over the real customer
  list): `(release: decide)` (§3 fact 3).
- I4. First order only / new customers: `(release: decide)`. This is the most requested
  welcome offer; design it.
- I5. Signed-in customers only, email subscribers, segments ("spent over $500"):
  `(release: decide)` (§3 fact 12).
- I6. Per-market offers ("UK shoppers only"): `(release: decide)` (shipping-country
  condition).

### J. What they must buy (minimums)

- J1. No minimum (default) / order total at least X / at least N items.
- J2. Order total uses the store's tax setting, in words (§3 fact 11).
- J3. "At least N items" across the whole cart is `(release: decide)`; "at least N of these
  products" and "at least N tagged…" are first release (§3 fact 3). Word each so the
  difference is clear.
- J4. Minimums combine with AND (§3 fact 2); the summary sentence shows it.

### K. When it runs

- K1. Start now or on a date and time; no end or an end date. Store time zone shown (§3
  fact 9).
- K2. Quick picks: "This weekend", "7 days", "Until end of month", and the next regional event
  (Black Friday, Boxing Day, Diwali, Eid, Singles' Day).
- K3. The **Scheduled** state (flow 45): "Starts in 3 days". Editable freely until it starts.
- K4. An offer whose end date has passed while the merchant is editing: explain and offer to
  extend.
- K5. Recurring offers ("every Friday", "happy hour"): `(release: decide)`. Suggest duplicate
  instead.
- K6. Countdown on the storefront ("Ends in 5 h"): **optional per offer** (decided 2026-10-05 on #337).

### L. How often (usage limits)

- L1. Total uses (unlimited by default) and uses per customer (once by default for codes).
- L2. The guest caveat in helper text (§3 fact 8).
- L3. Usage shown as a meter; "Used up" becomes a status (§3 fact 9).
- L4. Raising a limit on a used-up offer brings it back to Live, and says so.
- L5. An order cancelled before fulfilment gives the use back; refunds don't (decided 2026-10-05 on #337).
- L6. "Once per order" for buy X get Y (F5).

### M. Combining offers

- M1. A **stacking check** on save lists live and scheduled offers that could apply to the
  same cart under the combination rules and the engine's application order (§3 fact 7), with
  the worst-case example ("Linen Shirt: $40 → $22.40 with Summer 30% and SUMMER20"). If
  combination rules are not in the first release, the check says plainly that everything
  that qualifies stacks.
- M2. Shopify-style "Combines with" controls (product / order / shipping discounts, other
  codes): engine provides (§3 fact 7), `(release: decide)`. Design them and their summary
  wording.
- M3. "Only the best discount applies": `(release: decide)`.
- M4. One code per order: a combination rule, `(release: decide)` *(ask whether it is a
  store-wide setting or per offer)*.

### N. Edit, pause, end, duplicate, delete

- N1. Editing a live offer: the "Live now" save bar, and what happens to carts in progress
  (§3 fact 16).
- N2. **Turn off** a live offer (flow 46): confirm with "Used 14 times today. Shoppers with it
  in their cart will lose the discount". It becomes Off, with "Turn back on".
- N3. **End now**: sets the end date to now; different from Off, and permanent in intent.
  Explain the difference.
- N4. **Duplicate**: "Copy of …", Off, code cleared, usage reset. The standard way to rerun
  last year's sale.
- N5. **Delete**: prefer End. Deleting keeps past orders' discounts (§3 fact 14) and frees or
  keeps the code (*decide*).
- N6. Two people edit the same offer: "Someone changed this 2 minutes ago".
- N7. Change history ("Turned off by Priya, 2 h ago") *(ask whether exposed; every privileged
  write is audited with the real actor, PLATFORM-PROMPT §2 item 20, so the data exists)*.

### O. What the shopper sees (flow 47)

- O1. **Try this offer**: a test cart built from real products, showing each line, the
  discount, tax, shipping and total, including other offers that stack (§3 fact 20).
- O2. Storefront previews on phone and desktop: the code box, "Code applied −$8.00", the
  discount line with the name shoppers see, and the free-shipping or buy-X hint.
- O3. The three code errors in shopper words: "This code isn't valid", "This code has
  expired", "You've already used this code" (§3 fact 6). The last must not reveal other
  customers' usage.
- O4. Product page and listing: badge and crossed-out price **only if** the Shop API and the
  storefront provide them (§3 fact 17), and only in the form pricing law allows.
- O5. Order confirmation email and invoice preview with the discount line (tax-correct per
  region).
- O6. Where the merchant sees an offer used on an order: the Orders screen shows the offer name
  and code, linked back.

### P. Results

- P1. On each offer: uses, orders, discount given, sales with the offer, average order value,
  and a small chart by day (§3 fact 19). Never "revenue caused by".
- P2. Orders list filtered by this offer.
- P3. Top offers **appear** on Reports (decided 2026-10-05 on #337).
- P4. Export uses (orders, customer, code, discount) as CSV.

### Q. Shareable links

- Q1. "Copy link": a storefront URL that applies the code on arrival (`?code=SUMMER20`).
  Storefront work in `@dripfunnel/storefront-core` with the Shop API: `(release: decide)`.
- Q2. Link to a specific product or collection with the code attached.

### R. Customers screen links

- R1. From a customer: "Offers they've used", and "Add to group" for group offers.
- R2. From a group: "Offers for this group".

### S. Languages and currencies (only when Settings has more than one)

- S1. Single-language, single-currency store: no language or currency controls at all.
- S2. Name shoppers see and description per language (translatable), with the main language
  as fallback, same pattern as [CATALOG-DESIGN.md](CATALOG-DESIGN.md) part N.
- S3. Coupon codes are the same in every language.
- S4. Multi-currency: percentages work everywhere; fixed amounts and minimums carry one value
  per currency (engine provides, §3 fact 10). Entered as one value per currency, pre-filled by
  conversion and editable (decided 2026-10-05 on #337).

### T. Regions, tax and pricing law

- T1. The money preview in a US (tax added after), a German (VAT included) and an Indian (GST
  included) store.
- T2. Invoices: in India the discount must appear on the GST invoice and reduce taxable value;
  in the EU/UK it reduces the VAT base. Show it in the invoice preview. *(Confirm with
  compliance.)*
- T3. Sale prices shown on product pages follow the region's rules (§3 fact 17). A "was" price
  in an EU store uses the 30-day lowest price.
- T4. Seasonal suggestions follow the store's markets, never one culture's calendar.
- T5. Vocabulary per region: coupon / voucher / promo code; shipping / delivery.

### U. Plans

- U1. The partner gates offers per plan through entitlements: the number of live offers,
  bulk codes and tiered offers (decided 2026-10-05 on #337), using the four states from [CATALOG-DESIGN.md](CATALOG-DESIGN.md) part P:
  included and on, turned off, not in plan, at limit. Plans and entitlements are set by the
  partner and enforced by the server (PLATFORM-PROMPT §3.3, [SAAS.md](../../api/SAAS.md)).
- U2. Only the Owner sees upgrade prompts. Vendors never see offers at all.
- U3. Downgrade: live offers keep running until they end (decided 2026-10-05 on #337); creating more is blocked with
  the limit named.

### V. Recipes

Ready-made starting points that fill the form and leave the merchant to adjust:

- V1. Welcome code: 10% off, once per customer (first order only when built).
- V2. Free shipping over a threshold, suggested from the store's average order value.
- V3. Buy 2 get 1 free on a chosen product.
- V4. Flash sale: 24 hours, 20% off a collection or filter value.
- V5. VIP: 15% off for a customer group.
- V6. Seasonal: Black Friday, Christmas, Diwali, Eid, back to school, by market and date.
- V7. Win back: a single-use code to send one customer (specific customers,
  `(release: decide)`).

---

## 7. States that apply to every screen

- **Empty**: every list and tab, with an action and an example.
- **Loading**: skeletons for lists; the summary card never shows a stale sentence.
- **Saving / saved / failed**: in the sticky bar, with "Live now" when editing a live offer.
- **Validation errors**: inline, plus a summary at the top.
- **Permission denied**: Staff opening an offer URL. **Vendors see "not found".**
- **Read-only (subscription past due)**: everything visible, nothing editable (PLATFORM-PROMPT
  §2 item 7). Ask whether live offers keep running on the degraded storefront.
- **Read-only partner support session**: the support banner is shown and nothing is editable
  ([USERS-AND-DOMAINS.md](../../USERS-AND-DOMAINS.md) §4.1).
- **Store API unreachable**: the form is kept, retry offered.
- **Slow or offline network** on a phone.
- **Stacking warning**: calm, specific, with the worst-case example.
- **`(release: decide)`**: a feature designed but not yet available is shown only in design
  deliverables, never as a dead control in production.
- **Regional variants**: US, EU and Indian versions wherever money, tax or words differ.

---

## 8. What the interface must never do

- Show a vendor any offer, code, offer name, discount rule or Offers screen.
- Show a raw engine term (promotion, condition, action, operation, argument, version id,
  adjustment, priority, application order) or a raw error.
- Let an offer go live by accident: a new offer with no conditions, no code and no dates must
  say "every order, starting now" before it saves.
- Show a status by colour alone, or confuse Scheduled, Live, Off, Ended and Used up.
- Show dates in UTC, or in the viewer's time zone without naming it.
- Promise "can't be combined", collection targeting, bulk codes, first-order-only or
  per-currency amounts before the engine ships them.
- Apply a fixed amount across currencies as if it were the same money.
- Show prices in minor units, or tax-exclusive where the store is tax-inclusive.
- Let an internal-sounding name reach shoppers without previewing it.
- Tell a shopper how many times other people used a code.
- Show a "was" price that the store's market forbids.
- Change a live offer without saying it is live.
- Gate anything only in the UI.

---

## 9. Open questions: ask, don't assume

- ~~Does a new offer save as Off, or live immediately when it has no start date? Should the
  engine have a draft state? (§3 fact 1)~~ Save asks Start now / Schedule / Keep off; no draft
  state (decided 2026-10-05 on #337).
- ~~Does the portal expose "any of" (OR) conditions, or keep one offer per alternative? (§3
  fact 2, I2)~~ One offer per alternative in the form; the engine keeps OR (decided 2026-10-05 on #337).
- Which `(release: decide)` items are in the first release: exclusions, combination rules,
  "best discount wins", bulk codes, first order only, specific customers, shipping country,
  tiered discounts, discount caps, % off the "get" item, free gifts, internal names,
  per-currency amounts, segments, recurring offers, shareable links, results, the test cart?
  (§3 facts 3–7, 10, 12–13, 19–20; PLATFORM-PROMPT §10)
- ~~Are coupon codes matched case-insensitively, and does a deleted (or soft-deleted) offer
  keep its code? (§3 facts 6, 14)~~ Case-insensitive; a deleted offer keeps its code (#188) (decided 2026-10-05 on #337).
- ~~Is the fixed product discount per line or per unit? Which items does buy X get Y make free,
  and does it repeat? (§3 fact 4, F3, F5)~~ Per unit; the cheapest, repeating per set unless
  "once per order" (decided 2026-10-05 on #337).
- ~~Do product targets include versions added later? (§3 fact 5)~~ Yes, resolved at pricing (decided 2026-10-05 on #337).
- ~~What is the engine's fixed application order, and what does a new offer combine with by
  default?~~ Product, then order, then shipping; combines with nothing by default (decided 2026-10-05 on #337).
  Is "one code per order" store-wide or per offer? (§3 fact 7, M4)
- ~~Do cancelled or refunded orders give a use back? How are guests recognised for
  per-customer limits? (§3 fact 8)~~ Cancelled before fulfilment gives it back, refunds don't;
  guests by email, or a phone proven by a code (decided 2026-10-05 on #337).
- ~~When does the store time-zone setting ship, and where in Settings does it live? (§3 fact 9)~~
  **Settled 2026-10-02**: first release, Settings › Store info.
- ~~Multi-currency stores: how are per-currency amounts entered, and what is the fallback if
  they are not in the first release? (§3 fact 10)~~ One value per currency, pre-filled by
  conversion, editable (decided 2026-10-05 on #337).
- Can Staff read offers? (§4)
- Who pays for a discount on a vendor's product, and what does the vendor see in "Your
  sales"? (§3 fact 18)
- Does the Shop API return discounted product prices, and does the storefront show sale
  badges, a code box, free-shipping progress, countdowns and `?code=` links? (§3 fact 17,
  O4, Q1, K6)
- ~~Which offer features are plan-gated, and what happens to live offers on downgrade? (part U)~~
  The partner gates live-offer count, bulk codes and tiered offers per plan; live offers run
  until they end (decided 2026-10-05 on #337).
- Do live offers keep running when the subscription is past due? (§7)
- Is change history exposed? (N7)
- Changing a live offer's code: keep the old code working too? (H5)
