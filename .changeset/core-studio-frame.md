---
'@dripfunnel/storefront-core': minor
---

The studio frame's hot-swap entry point (storefront AI-STUDIO §4 step 5): `studioBasePath` reads `/__studio/{session}/` from core's own module address, `studioShopEndpoint` points the Shop API client under it, `studioPagePath` gives a page's path inside the frame, and `connectHotReload` loads each new bundle the store's Durable Object announces and applies only the newest, keeping the scroll.
