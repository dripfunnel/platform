---
'@dripfunnel/storefront-core': patch
---

No theme has to change (#1134). While a listing loads after a filter or sort changes, `useListing` (and so `useCollection` and `useSearch`) keeps the last facets of the same collection or search, so a theme's filter panel stays on screen and only the products reload.
