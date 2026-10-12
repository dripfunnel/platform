---
'@dripfunnel/storefront-core': minor
---

`storeCsp` takes an optional `portalOrigin` (an https origin with no path) and lists it in `frame-ancestors`, so the store's portal can show its live site and preview pages in a frame (storefront ARCHITECTURE §3.5); without one the header keeps `frame-ancestors 'none'`. The catalogue snapshot's `csp` carries it.
