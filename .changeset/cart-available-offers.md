---
'@dripfunnel/storefront-core': minor
---

The cart lists the offers a shopper can use on it (#1698). `useAvailableOffers()` returns `{ status, offers, applying, refused, apply, retry }`: each offer is `{ name, code, saves, savesText }`, best first, at most five, only a shared code this cart qualifies for now and gains from (who an offer is for, its limits and what it combines with decide, exactly as when the shopper types the code), and never one already on the cart; `apply(code)` applies it as typing it would. Nothing is priced in the browser. The starting themes show the list in the cart's Summary card above the Discount code field, and ship `shop.cart.offers.*`; an existing store shows it only when its theme is updated.
