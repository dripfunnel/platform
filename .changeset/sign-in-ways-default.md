---
'@dripfunnel/storefront-core': patch
---

`useSignIn` counts the shop as email only until its sign-in options answer, instead of both ways (#1173), so a store that allows email only no longer shows a "Mobile number" tab that disappears after a moment. A preview still shows both ways. Nothing changes for themes.
