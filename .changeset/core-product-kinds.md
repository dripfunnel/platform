---
'@dripfunnel/storefront-core': minor
---

Gift cards, downloads and services (#324): `useCart` adds a gift card with its recipient (`AddToCart` and `BuyNow` take `gift`), applies or removes a gift card's number, and gives the cart's `giftCard` and each line's `gift`; `useProduct` gives the product's `kind` (a gift card's expiry, a download's limit and days, a service's duration and place); `useOrder` gives an order's `giftCard`, `downloads` and `licenceKeys`, and each line's gift recipient. `OrderSummary` shows a gift card's part and what is left after it. `TextField` takes `type="date"`.
