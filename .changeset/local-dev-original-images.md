---
'@dripfunnel/storefront-core': patch
---

A store repo's `next dev` shows each catalogue picture and checkout summary photo at its original address instead of through Cloudflare's `/cdn-cgi/image/` resizer, which only the live host has, so pictures no longer fail to load on localhost. Live and preview pages are unchanged.
