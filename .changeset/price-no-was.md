---
'@dripfunnel/storefront-core': patch
---

The sealed `<Price>` no longer puts the word "Was" before the crossed-out compare-at price (#1357): it shows the old price struck through, with a screen-reader-only "Original price" label in front, since a line-through is not announced. The `price.was` message now reads "Original price".
