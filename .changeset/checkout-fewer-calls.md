---
'@dripfunnel/storefront-core': minor
---

Checkout asks the Shop API twice less (#1105): Review shows the cart its `checkout` answer holds instead of reading it again, and the ways to pay are asked alongside the cart when checkout opens, not after it, and only when the browser holds a cart or a signed-in shopper. A refused Review or Place order still reads the cart again. Themes change nothing.
