---
'@dripfunnel/storefront-core': minor
---

The account's list of orders (#813): `useOrders` (from `./theme`) reads the signed-in shopper's orders from the Shop API's new `orderHistory`, newest first, 20 at a time, with `loadMore`, and each `OrderRow`'s day, item count, payment and total; it is `signedOut` and asks nothing on a preview or in the studio frame. Core's messages add `orders.title`.
