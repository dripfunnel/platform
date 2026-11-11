---
'@dripfunnel/storefront-core': patch
---

Buy now no longer adds a product again when the cart already holds it (#1359): it opens checkout with the line at the quantity it had, so Add to cart followed by Buy now gives one, not two. A gift card is still added each time. No code change is needed in a theme.
