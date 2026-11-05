---
'@dripfunnel/storefront-core': patch
---

A click on a store link inside the studio's frame stays under the frame's session path instead of leaving it for the preview host, which refused it. Live and preview pages, modified clicks and other hosts are unchanged. `navigate()` now keeps a `#fragment` out of the page path and scrolls to it, so an in-page link works in the frame.
