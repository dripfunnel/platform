---
'@dripfunnel/storefront-core': patch
---

Nothing changes for themes or the published package (#1152). Core's own tests get 20 s each and testing-library's `waitFor` 5 s, so a loaded CI runner no longer times out the baseline checkout and listing tests.
