---
'@dripfunnel/storefront-core': patch
---

The order summary at checkout shows each line's picture in the studio's preview again (#1537). It asked for the picture at the shop's own address, which the studio frame can't reach without a cookie, so it showed as a broken image in every theme; it now addresses it under the frame's path, as `<Image>` does. Live sites and previews are unchanged.
