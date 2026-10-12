---
'@dripfunnel/storefront-core': minor
---

The store's brand and the home page's search and sharing through `useStorefront()` (#471): `loadStore` asks the Shop API for `favicon`, `tagline`, `social` (each network's https profile address; one that doesn't parse as https is dropped) and `seo` (`title`, `description`, `image`), and `ShopStoreSettings` carries them, with the new `StoreSeo` type. The catalogue snapshot (`snapshotStoreSchema`) takes the same fields, each optional, so a publish builds with them.
