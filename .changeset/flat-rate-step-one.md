---
'@dripfunnel/storefront-core': patch
---

The sealed order summary shows the flat delivery price from checkout's first step (#1521). Core's code is unchanged: it already shows the cart's `shipping`, "Free" at zero, and "Next step" only when the cart has none. What changed is the engine, which now carries a switched-on flat rate as the cart's delivery price before an address, so a theme needs no update. A test now covers the three cases.
