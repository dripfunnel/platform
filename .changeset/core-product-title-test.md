---
'@dripfunnel/storefront-core': patch
---

Tests only: the product page's title test waits for the head to follow the page, which it does in an effect, instead of reading it once (it failed at random on slower CI runners). No change to what core ships.
