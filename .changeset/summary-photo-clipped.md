---
'@dripfunnel/storefront-core': patch
---

The checkout's order summary keeps each line's picture inside its 56 by 70 box (#1669). A wide picture was painted at full width around the box, over the product's name and past the card's left padding, because core's locked `overflow: visible` on every sealed part cancelled the browser's clipping of a picture; the picture's rule now clips it. No change to the package's API or to any theme.
